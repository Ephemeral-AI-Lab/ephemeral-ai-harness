import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineTool,
  type HookEntry,
  type ToolCallFacts,
  type ToolResult,
} from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  RuntimeOutcomeSchema,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  toolEvents,
  userMessage,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime hooks e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)("runtime hooks over live codex (e2e)", () => {
  it(
    "denies a terminal prehook attempt, observes post hooks, and lets the model recover",
    { timeout: 240_000 },
    async () => {
      const preCalls: ToolCallFacts[] = [];
      const postCalls: { call: ToolCallFacts; result: ToolResult }[] = [];
      let lookupExecutions = 0;

      const lookupHookCodeword = defineTool({
        name: "lookup_hook_codeword",
        description: "Return the hook e2e recovery codeword. Takes {}.",
        input: z.object({}),
        execute: () => {
          lookupExecutions += 1;
          return Promise.resolve({ output: { codeword: "hook-allowed" } });
        },
      });
      const hooks: HookEntry[] = [
        {
          event: "preToolUse",
          run: (call) => {
            preCalls.push(call);
            if (
              call.toolName === "submit_runtime_outcome" &&
              call.input.codeword === "pre-denied"
            ) {
              return {
                decision: "deny",
                reason: "runtime prehook denied pre-denied submission",
              };
            }
            return { decision: "passthrough" };
          },
        },
        {
          event: "postToolUse",
          matcher: { toolName: "lookup_hook_codeword" },
          run: (call, result) => {
            postCalls.push({ call, result });
            return { decision: "passthrough" };
          },
        },
      ];

      const sdk = createRuntimeAgentRuntime({ hooks });
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-hooks-live",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [lookupHookCodeword],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 6,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              "1. Call lookup_hook_codeword with {}.",
              '2. Then call submit_runtime_outcome with {"status":"completed","codeword":"pre-denied"}. That call will be denied by a hook.',
              '3. After the tool error, call submit_runtime_outcome with {"status":"completed","codeword":"hook-allowed"}.',
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
        outcome: { status: "completed", codeword: "hook-allowed" },
      });
      expect(lookupExecutions, "ordinary tool executed once").toBe(1);
      expect(
        preCalls.map((call) => call.toolName),
        "pre hooks observed ordinary and terminal tools",
      ).toEqual(
        expect.arrayContaining(["lookup_hook_codeword", "submit_runtime_outcome"]),
      );
      expect(postCalls, "post hook observed the custom tool result").toHaveLength(1);
      expect(postCalls[0]?.result).toMatchObject({
        output: { codeword: "hook-allowed" },
      });

      const submissions = toolEvents(collected.events, "submit_runtime_outcome");
      expect(
        submissions.some(
          (event) =>
            event.is_error &&
            event.output.includes("runtime prehook denied pre-denied submission"),
        ),
        "the denied terminal attempt was returned as a tool error",
      ).toBe(true);
      expect(
        submissions.some((event) => !event.is_error && event.is_terminal),
        "the later terminal attempt was accepted",
      ).toBe(true);
    },
  );

  it(
    "expresses an advisory pass gate as a host tool plus terminal prehook",
    { timeout: 240_000 },
    async () => {
      const advisoryPasses = new Set<string>();
      const targetPayload: RuntimeOutcome = {
        status: "completed",
        codeword: "advisor-approved",
      };
      const askRuntimeAdvisor = defineTool({
        name: "ask_runtime_advisor",
        description:
          "Record an advisory pass. Input is {tool_name, payload} for submit_runtime_outcome.",
        input: z.object({
          tool_name: z.literal("submit_runtime_outcome"),
          payload: RuntimeOutcomeSchema,
        }),
        execute: (input) => {
          advisoryPasses.add(advisoryKey(input.tool_name, input.payload));
          return Promise.resolve({
            output: {
              verdict: "pass",
              tool_name: input.tool_name,
              payload: input.payload,
            },
          });
        },
      });
      const hooks: HookEntry[] = [
        {
          event: "preToolUse",
          matcher: { toolName: "submit_runtime_outcome" },
          run: (call) =>
            advisoryPasses.has(advisoryKey(call.toolName, call.input))
              ? { decision: "passthrough" }
              : {
                  decision: "deny",
                  reason:
                    "submit_runtime_outcome requires ask_runtime_advisor for this exact payload",
                },
        },
      ];
      const sdk = createRuntimeAgentRuntime({ hooks });
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-advisory-gate",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [askRuntimeAdvisor],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 7,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              `1. First call submit_runtime_outcome with ${JSON.stringify(targetPayload)}. This will be denied because the advisory pass is missing.`,
              `2. After the tool error, call ask_runtime_advisor with {"tool_name":"submit_runtime_outcome","payload":${JSON.stringify(targetPayload)}}.`,
              `3. After the advisor tool returns pass, call submit_runtime_outcome again with ${JSON.stringify(targetPayload)}.`,
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
        outcome: targetPayload,
      });
      const submissions = toolEvents(collected.events, "submit_runtime_outcome");
      expect(
        submissions.some(
          (event) =>
            event.is_error &&
            event.output.includes("requires ask_runtime_advisor"),
        ),
        "first terminal attempt was blocked by the advisory prehook",
      ).toBe(true);
      expect(
        toolEvents(collected.events, "ask_runtime_advisor").some(
          (event) => !event.is_error,
        ),
        "host advisory tool recorded the exact pass",
      ).toBe(true);
      expect(
        submissions.some((event) => !event.is_error && event.is_terminal),
        "the same terminal payload succeeded after the pass",
      ).toBe(true);
    },
  );

  it(
    "maps postToolUse denial to a recoverable tool error",
    { timeout: 240_000 },
    async () => {
      const executions: string[] = [];
      const postFilteredLookup = defineTool({
        name: "post_filtered_lookup",
        description: 'Return a value. Input is {"value": string}.',
        input: z.object({ value: z.string() }),
        execute: (input) => {
          executions.push(input.value);
          return Promise.resolve({ output: { value: input.value } });
        },
      });
      const hooks: HookEntry[] = [
        {
          event: "postToolUse",
          matcher: { toolName: "post_filtered_lookup" },
          run: (call) =>
            call.input.value === "blocked"
              ? {
                  decision: "deny",
                  reason: "post hook blocked value",
                }
              : { decision: "passthrough" },
        },
      ];
      const sdk = createRuntimeAgentRuntime({ hooks });
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-post-hook-denial",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [postFilteredLookup],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 7,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              '1. Call post_filtered_lookup with {"value":"blocked"}.',
              "2. That post hook will deny the result as a tool error.",
              '3. After the tool error, call post_filtered_lookup with {"value":"allowed"}.',
              '4. Then call submit_runtime_outcome with {"status":"completed","codeword":"post-hook-recovered"}.',
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
        outcome: { status: "completed", codeword: "post-hook-recovered" },
      });
      expect(executions, "post hook runs after both tool executions").toEqual([
        "blocked",
        "allowed",
      ]);
      const lookupEvents = toolEvents(collected.events, "post_filtered_lookup");
      expect(
        lookupEvents.some(
          (event) =>
            event.is_error && event.output.includes("post hook blocked value"),
        ),
        "post-hook denial replaced the first result with a tool error",
      ).toBe(true);
      expect(
        lookupEvents.some(
          (event) => !event.is_error && event.output.includes("allowed"),
        ),
        "the allowed retry reached the model as a normal result",
      ).toBe(true);
    },
  );
});

function advisoryKey(toolName: string, payload: unknown): string {
  return `${toolName}:${stableJson(payload)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
