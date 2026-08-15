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

