import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool, type BackgroundTaskOutcome, type TurnFacts } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeSystemPrompt,
  userMessage,
  waitUntil,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime text-gates e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime text termination gates over live codex (e2e)",
  () => {
    it(
      "parks a text-mode answer on an open task and completes it on silent removal",
      { timeout: 240_000 },
      async () => {
        let finishTask!: (outcome: BackgroundTaskOutcome) => void;
        const done = new Promise<BackgroundTaskOutcome>((resolve) => {
          finishTask = resolve;
        });
        const boundaryFacts: TurnFacts[] = [];
        const startSilentTextGate = defineTool({
          name: "start_silent_text_gate",
          description: "Start silent work that gates text termination. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_text_gate", id: "silent" },
              title: "runtime silent text gate",
              cancel: () => undefined,
              done,
              silent: true,
            });
            return Promise.resolve({ output: { taskId } });
          },
        });
        const sdk = createRuntimeAgentRuntime({
          hooks: [
            {
              event: "turnBoundary",
              run: (facts) => {
                boundaryFacts.push(facts);
              },
            },
          ],
        });
        const agent = sdk.createAgent({
          name: "runtime-text-gate-silent-task",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startSilentTextGate],
          maxTurns: 4,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_silent_text_gate with {}.",
                '2. Then reply exactly "text-gate-waiting" with no tool calls. That text is the final answer once the task gate opens.',
              ].join("\n"),
            ),
          ],
        });

        await waitUntil(
          "text turn to park on an open task",
          () =>
            boundaryFacts.some(
              (facts) =>
                facts.turn === 2 &&
                facts.toolCalls === 0 &&
                facts.backgroundTaskCount === 1,
            ),
          180_000,
        );
        expect(run.backgroundTaskSupervisor.list(), "the silent task is still open").toEqual([
          expect.objectContaining({
            tag: { type: "runtime_text_gate", id: "silent" },
          }),
        ]);
        finishTask({ status: "success", outcome: "gate open" });

        const outcome = await run.outcome();

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: "text-gate-waiting",
          turns: 2,
        });
        expect(
          run.backgroundTaskSupervisor.list(),
          "silent removal clears the text-mode gate",
        ).toEqual([]);
      },
    );
  },
);
