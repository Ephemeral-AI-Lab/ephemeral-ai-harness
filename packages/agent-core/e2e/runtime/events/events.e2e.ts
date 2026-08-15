import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../../../src/index.js";
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
  console.warn(`runtime events e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)("runtime event stream over live codex (e2e)", () => {
  it(
    "stamps dense seq values and preserves tool lifecycle ordering",
    { timeout: 180_000 },
    async () => {
      const sequenceProbe = defineTool({
        name: "sequence_probe",
        description: "Return a sequence marker. Takes {}.",
        input: z.object({}),
        execute: () =>
          Promise.resolve({
            output: { marker: "sequence-ok" },
            metadata: { focus: "events" },
          }),
      });
      const sdk = createRuntimeAgentRuntime();
      const agent = sdk.createAgent<RuntimeOutcome>({
        name: "runtime-events-sequence",
        llm: RUNTIME_CLIENT_ID,
        systemPrompt: runtimeSystemPrompt(),
        tools: [sequenceProbe],
        agentOutcomeFn: runtimeOutcomeFn(),
        maxTurns: 5,
      });
      const run = agent.start({
        messages: [
          userMessage(
            [
              "1. Call sequence_probe with {}.",
              '2. Then call submit_runtime_outcome with {"status":"completed","codeword":"events-ok"}.',
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
        outcome: { status: "completed", codeword: "events-ok" },
      });
      expect(
        collected.events.map((event) => event.seq),
        "live stream seq is dense and starts at zero",
      ).toEqual(collected.events.map((_event, index) => index));
      expect(collected.events[0], "first event starts the run").toMatchObject({
        type: "run_started",
      });
      expect(collected.events.at(-1), "last event closes the run").toMatchObject({
        type: "run_finished",
      });
      const startedIndex = collected.events.findIndex(
        (event) =>
          event.type === "tool_execution_started" &&
          event.name === "sequence_probe",
      );
      const completedIndex = collected.events.findIndex(
        (event) =>
          event.type === "tool_execution_completed" &&
          event.name === "sequence_probe",
      );
      expect(startedIndex, "tool start event exists").toBeGreaterThanOrEqual(0);
      expect(completedIndex, "tool completion event exists").toBeGreaterThanOrEqual(0);
      expect(startedIndex, "tool start precedes completion").toBeLessThan(
        completedIndex,
      );
      expect(toolEvents(collected.events, "sequence_probe")).toEqual([
        expect.objectContaining({
          is_error: false,
          is_terminal: false,
          metadata: { focus: "events" },
        }),
      ]);
    },
  );
});
