import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool, type BackgroundTaskOutcome, type TurnFacts } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  userMessage,
  waitUntil,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime steering e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime steering over live codex (e2e)",
  () => {
    it(
      "wakes a run parked on an open background task with a steer",
      { timeout: 240_000 },
      async () => {
        // The park races a steer, an inbox publish, a task removal, and
        // abort. Settlement, cancellation, and interrupt wakes are covered
        // elsewhere; this pins the steer arm. The task never settles on its
        // own — only the steered turn's `clear_park` resolves it, so a
        // completed run is itself proof the steer woke the park.
        let finishTask!: (outcome: BackgroundTaskOutcome) => void;
        const done = new Promise<BackgroundTaskOutcome>((resolve) => {
          finishTask = resolve;
        });
        let clearedFromSteeredTurn = false;
        const boundaryFacts: TurnFacts[] = [];

        const startParkTask = defineTool({
          name: "start_park_task",
          description: "Start background work that parks the run until it is cleared. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_steer_park", id: "parked" },
              title: "runtime steer park task",
              cancel: () => undefined,
              done,
              silent: true,
            });
            return Promise.resolve({ output: { taskId } });
          },
        });
        const clearPark = defineTool({
          name: "clear_park",
          description: "Clear the parked background work so the run can finish. Takes {}.",
          input: z.object({}),
          execute: () => {
            clearedFromSteeredTurn = true;
            finishTask({ status: "success", outcome: "cleared" });
            return Promise.resolve({ output: { cleared: true } });
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
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-steering-park-wake",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startParkTask, clearPark],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 6,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_park_task with {}.",
                '2. Then reply exactly "parked" with no tool calls and wait.',
                "3. When you receive a new instruction, follow it exactly.",
              ].join("\n"),
            ),
          ],
        });

        await waitUntil(
          "run to park on the open background task",
          () =>
            boundaryFacts.some(
              (facts) =>
                facts.turn === 2 &&
                facts.toolCalls === 0 &&
                facts.backgroundTaskCount === 1,
            ),
          180_000,
        );
        expect(
          run.backgroundTaskSupervisor.list(),
          "the park task is open before the steer",
        ).toEqual([
          expect.objectContaining({ tag: { type: "runtime_steer_park", id: "parked" } }),
        ]);
        expect(
          run.steer(
            userMessage(
              [
                "New instruction: First call clear_park with {}.",
                'After it returns, call submit_runtime_outcome with {"status":"completed","codeword":"steered-wake"}.',
              ].join(" "),
            ),
          ),
          "a parked run accepts a steer",
        ).toBe(true);

        const outcome = await run.outcome();

        expect(
          clearedFromSteeredTurn,
          "the steer woke the park and the steered turn executed clear_park",
        ).toBe(true);
        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "steered-wake" },
        });
      },
    );

    it(
      "extends a text-mode run with a steer and finishes on the steered text",
      { timeout: 180_000 },
      async () => {
        // Text mode finishes on a bare-text turn under the submission gate.
        // A steer arriving while a tool turn runs must extend the run past
        // that tool turn, and the steered turn's text becomes the outcome —
        // the text-mode analog of the terminal boundary-steer case.
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
            await new Promise<void>((resolve) => setTimeout(resolve, input.ms));
            return { output: { waited_ms: input.ms } };
          },
        });

        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent({
          name: "runtime-steering-text-extend",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [waitForSteer],
          maxTurns: 5,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                '1. Call wait_for_steer with {"ms":600}.',
                "2. After it returns, your final answer is exactly the text the newest user instruction gives you.",
                "3. Reply with that exact text and no tool calls.",
              ].join("\n"),
            ),
          ],
        });

        await started;
        expect(
          run.steer(userMessage("New instruction: your final answer is exactly: steered-text-answer")),
          "a live text-mode run accepts a steer during the tool turn",
        ).toBe(true);

        const outcome = await run.outcome();

        expect(outcome.status, "the text-mode run completes").toBe("completed");
        expect(
          outcome.status === "completed" ? outcome.outcome : "",
          "the steered turn's text is the final outcome",
        ).toContain("steered-text-answer");
        expect(
          outcome.turns,
          "the run extended past the tool turn into a steered text turn",
        ).toBeGreaterThanOrEqual(2);
      },
    );
  },
);
