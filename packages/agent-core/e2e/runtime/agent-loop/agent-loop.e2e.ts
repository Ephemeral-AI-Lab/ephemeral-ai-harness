import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../../../src/index.js";
import {
  CODEWORD,
  RUNTIME_CLIENT_ID,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  sleep,
  userMessage,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime agent-loop e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)("runtime agent-loop over live codex (e2e)", () => {
  it(
    "completes through the terminal outcome tool",
    { timeout: 180_000 },
    async () => {
      const runtime = createRuntimeAgentRuntime();
      const agent = runtime.createAgent<RuntimeOutcome>({
        name: "runtime-agent-loop-terminal",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 3,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              'Call submit_runtime_outcome exactly once with {"status":"completed","codeword":"agent-loop-terminal"}.',
              "Do not write final prose.",
            ].join("\n"),
          ),
        ],
      });
      const collected = collectEvents(run);

      expect(
        () => run.events()[Symbol.asyncIterator](),
        "events() is a live single-consumer stream",
      ).toThrow(/single consumer/);

      const outcome = await run.outcome();
      await collected.done;

      expect(outcome).toMatchObject({
        status: "completed",
        outcome: { status: "completed", codeword: "agent-loop-terminal" },
      });
      expect(outcome.turns, "a live provider turn ran").toBeGreaterThanOrEqual(1);
      expect(outcome.usage.input_tokens, "live input usage is accounted").toBeGreaterThan(0);
      expect(
        outcome.usage.output_tokens,
        "live output usage is accounted",
      ).toBeGreaterThan(0);
      expect(run.steer(userMessage("too late")), "steer is refused after finish").toBe(
        false,
      );
      expect(
        collected.events.at(-1),
        "run_finished is the final live event",
      ).toMatchObject({ type: "run_finished" });

    },
  );

  it(
    "completes text mode from a bare-text assistant turn",
    { timeout: 120_000 },
    async () => {
      const runtime = createRuntimeAgentRuntime();
      const agent = runtime.createAgent({
        name: "runtime-agent-loop-text",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [],
        maxTurns: 2,
      });

      const run = agent.start({
        messages: [
          userMessage(
            'Reply exactly "runtime-text-complete" with no tool calls. That text is the final answer.',
          ),
        ],
      });

      const outcome = await run.outcome();

      expect(outcome.status).toBe("completed");
      if (outcome.status === "completed") {
        expect(outcome.outcome).toContain("runtime-text-complete");
      }
      expect(run.steer(userMessage("too late")), "text-mode finish latches the run").toBe(
        false,
      );
    },
  );

  it(
    "round-trips a custom tool before completing by text mode",
    { timeout: 180_000 },
    async () => {
      let lookups = 0;
      const lookupTextCodeword = defineTool({
        name: "lookup_text_codeword",
        description: "Return the text-mode e2e codeword. Takes {}.",
        input: z.object({}),
        execute: () => {
          lookups += 1;
          return Promise.resolve({ output: { codeword: CODEWORD } });
        },
      });
      const runtime = createRuntimeAgentRuntime();
      const agent = runtime.createAgent({
        name: "runtime-agent-loop-text-tool",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [lookupTextCodeword],
        maxTurns: 4,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              "1. Call lookup_text_codeword with {}.",
              "2. After the result, reply with only the codeword as plain text and make no tool calls. That text ends the run.",
            ].join("\n"),
          ),
        ],
      });
      const collected = collectEvents(run);

      const outcome = await run.outcome();
      await collected.done;

      expect(lookups, "the text-mode tool round-trip executed").toBe(1);
      expect(outcome.status).toBe("completed");
      if (outcome.status === "completed") {
        expect(outcome.outcome).toContain(CODEWORD);
      }
      expect(
        collected.events.some(
          (event) =>
            event.type === "tool_execution_completed" &&
            event.name === "submit_runtime_outcome",
        ),
        "text mode exposes no terminal submit tool",
      ).toBe(false);
    },
  );

  it(
    "fails with max_turns after a live tool-only turn and records the failure",
    { timeout: 180_000 },
    async () => {
      let lookups = 0;
      const lookupLoopCodeword = defineTool({
        name: "lookup_loop_codeword",
        description: "Return the loop e2e codeword. Takes {}.",
        input: z.object({}),
        execute: () => {
          lookups += 1;
          return Promise.resolve({ output: { codeword: CODEWORD } });
        },
      });
      const runtime = createRuntimeAgentRuntime();
      const agent = runtime.createAgent<RuntimeOutcome>({
        name: "runtime-agent-loop-max-turns",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [lookupLoopCodeword],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 1,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              "Your first assistant response must call lookup_loop_codeword with {}.",
              "Only after seeing that tool result may you submit. Do not submit in the first assistant response.",
            ].join("\n"),
          ),
        ],
      });

      const outcome = await run.outcome();

      expect(lookups, "the live model spent its single turn on the tool").toBe(1);
      expect(outcome).toMatchObject({
        status: "failed",
        error: { kind: "max_turns" },
        turns: 1,
      });
    },
  );

  it(
    "applies a steer at the next boundary after an in-flight tool settles",
    { timeout: 180_000 },
    async () => {
      let startWait!: () => void;
      const started = new Promise<void>((resolve) => {
        startWait = resolve;
      });
      const waitForSteer = defineTool({
        name: "wait_for_steer",
        description: 'Wait briefly. Input: {"ms": number}.',
        input: z.object({ ms: z.number().int().positive() }),
        execute: async (input) => {
          startWait();
          await sleep(input.ms);
          return { output: { waited_ms: input.ms } };
        },
      });
      const runtime = createRuntimeAgentRuntime();
      const agent = runtime.createAgent<RuntimeOutcome>({
        name: "runtime-agent-loop-steer",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [waitForSteer],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 5,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              '1. Call wait_for_steer with {"ms":600}.',
              "2. After it returns, follow the newest user instruction.",
              '3. If no newer instruction arrived, submit {"status":"completed","codeword":"not-steered"}.',
            ].join("\n"),
          ),
        ],
      });

      await started;
      expect(
        run.steer(
          userMessage(
            'New instruction: call submit_runtime_outcome with {"status":"completed","codeword":"steered-runtime"}.',
          ),
        ),
        "steer is accepted while the run is live",
      ).toBe(true);

      const outcome = await run.outcome();

      expect(outcome).toMatchObject({
        status: "completed",
        outcome: { status: "completed", codeword: "steered-runtime" },
      });
    },
  );
});
