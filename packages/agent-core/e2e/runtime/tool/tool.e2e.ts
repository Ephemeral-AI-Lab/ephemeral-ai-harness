import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  CODEWORD,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  sleep,
  toolEvents,
  userMessage,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime tool e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)("runtime tool pipeline over live codex (e2e)", () => {
  it(
    "returns validation errors in-run, then executes the corrected custom tool",
    { timeout: 240_000 },
    async () => {
      const executions: { payload: string; llmMessages: number }[] = [];
      const echoRuntimePayload = defineTool({
        name: "echo_runtime_payload",
        description:
          'Echo a validated runtime payload. Input is {"payload":"ok:<value>"}.',
        input: z.object({ payload: z.string().regex(/^ok:/) }),
        execute: (input, ctx) => {
          executions.push({
            payload: input.payload,
            llmMessages: ctx.llmMessages.length,
          });
          return Promise.resolve({ output: { echoed: input.payload } });
        },
      });

      const sdk = createRuntimeAgentRuntime();
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-tool-validation",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [echoRuntimePayload],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 7,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              '1. Call echo_runtime_payload with {"payload":"bad-value"}. That call will fail validation.',
              `2. After the tool error, call echo_runtime_payload with {"payload":"ok:${CODEWORD}"}.`,
              `3. Then call submit_runtime_outcome with {"status":"completed","codeword":"tool-schema-ok"}.`,
              "Do not write final prose.",
            ].join("\n"),
          ),
        ],
      });
      const collected = collectEvents(run);

      const outcome = await run.outcome();
      await collected.done;

      expect(outcome).toMatchObject({
        status: "completed",
        outcome: { status: "completed", codeword: "tool-schema-ok" },
      });
      expect(executions, "invalid input never reached execute(); valid input did").toEqual([
        { payload: `ok:${CODEWORD}`, llmMessages: expect.any(Number) as number },
      ]);
      expect(
        executions[0]?.llmMessages,
        "custom tool received a conversation snapshot",
      ).toBeGreaterThan(0);

      const echoEvents = toolEvents(collected.events, "echo_runtime_payload");
      expect(
        echoEvents.some(
          (event) => event.is_error && event.output.includes("invalid input"),
        ),
        "schema failure was surfaced as a tool error",
      ).toBe(true);
      expect(
        echoEvents.some(
          (event) => !event.is_error && event.output.includes(`ok:${CODEWORD}`),
        ),
        "corrected tool call executed successfully",
      ).toBe(true);
    },
  );

  it(
    "executes a concurrent batch in tool order and recovers from a throwing sibling",
    { timeout: 240_000 },
    async () => {
      const windows: Partial<Record<string, { start: number; end: number }>> = {};
      const probeAlpha = defineTool({
        name: "probe_alpha",
        description: "Probe alpha. Takes {} and returns alpha.",
        input: z.object({}),
        execute: async () => {
          const start = Date.now();
          await sleep(900);
          const end = Date.now();
          windows.probe_alpha = { start, end };
          return { output: { probe: "alpha" } };
        },
      });
      const probeBeta = defineTool({
        name: "probe_beta",
        description: "Probe beta. Takes {} and throws after a delay.",
        input: z.object({}),
        execute: async () => {
          const start = Date.now();
          await sleep(900);
          const end = Date.now();
          windows.probe_beta = { start, end };
          throw new Error("probe beta failed");
        },
      });
      const sdk = createRuntimeAgentRuntime();
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-tool-batch",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(
          "When the user asks for a batch, put every requested tool call in one assistant response.",
        ),
        tools: [probeAlpha, probeBeta],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 6,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              "1. Your first assistant response must contain exactly two tool calls in the same response: probe_alpha with {} and probe_beta with {}.",
              "2. Do not wait for one result before issuing the other call.",
              '3. After both results arrive, call submit_runtime_outcome with {"status":"completed","codeword":"batch-recovered"}.',
              "The probe_beta error is expected; recover by submitting anyway.",
            ].join("\n"),
          ),
        ],
      });
      const collected = collectEvents(run);

      const outcome = await run.outcome();
      await collected.done;

      expect(outcome).toMatchObject({
        status: "completed",
        outcome: { status: "completed", codeword: "batch-recovered" },
      });
      const alphaEvents = toolEvents(collected.events, "probe_alpha");
      const betaEvents = toolEvents(collected.events, "probe_beta");
      expect(alphaEvents, "alpha executed once").toHaveLength(1);
      expect(betaEvents, "beta executed once").toHaveLength(1);
      expect(alphaEvents[0]?.is_error, "alpha succeeded").toBe(false);
      expect(alphaEvents[0]?.output, "alpha output is recorded").toContain("alpha");
      expect(betaEvents[0]?.is_error, "beta failure is mapped to a tool error").toBe(
        true,
      );
      expect(betaEvents[0]?.output, "beta error text is recorded").toContain(
        "probe beta failed",
      );
      expect(
        windows.probe_alpha !== undefined && windows.probe_beta !== undefined,
        "both tool windows were recorded",
      ).toBe(true);
      if (windows.probe_alpha !== undefined && windows.probe_beta !== undefined) {
        expect(
          Math.max(windows.probe_alpha.start, windows.probe_beta.start) <
            Math.min(windows.probe_alpha.end, windows.probe_beta.end),
          "batched tools overlapped in wall-clock execution",
        ).toBe(true);
      }
      expect(
        collected.events
          .filter((event) => event.type === "tool_execution_completed")
          .map((event) => event.name),
        "live events preserve tool completion order",
      ).toEqual([
        expect.stringContaining("probe_alpha"),
        expect.stringContaining("probe_beta"),
        expect.stringContaining("submit_runtime_outcome"),
      ]);
    },
  );
});
