import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool, type BackgroundTaskOutcome, type TurnFacts } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  toolEvents,
  userMessage,
  waitUntil,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime interruption e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime interruption over live codex (e2e)",
  () => {
    it(
      "interrupts an in-flight tool run and settles as cancelled",
      { timeout: 180_000 },
      async () => {
        let started = false;
        let observedAbort = false;
        const waitForInterrupt = defineTool({
          name: "wait_for_interrupt",
          description: "Wait until the run is interrupted. Takes {}.",
          input: z.object({}),
          execute: async (_input, ctx) => {
            started = true;
            await new Promise<void>((resolve) => {
              if (ctx.signal.aborted) {
                resolve();
                return;
              }
              ctx.signal.addEventListener(
                "abort",
                () => {
                  observedAbort = true;
                  resolve();
                },
                { once: true },
              );
            });
            return { output: { observed_abort: observedAbort } };
          },
        });
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-interrupt-in-flight-tool",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [waitForInterrupt],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 4,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call wait_for_interrupt with {}.",
                '2. If it ever returns, call submit_runtime_outcome with {"status":"completed","codeword":"should-not-complete"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        const collected = collectEvents(run);

        await waitUntil("wait_for_interrupt to start", () => started, 120_000);
        run.interrupt();

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({ status: "cancelled" });
        expect(observedAbort, "tool context received the abort signal").toBe(true);
        expect(run.steer(userMessage("too late")), "cancelled run refuses steers").toBe(
          false,
        );
        expect(
          collected.events.at(-1),
          "run_finished remains the final live event on interrupt",
        ).toMatchObject({ type: "run_finished", outcome: { status: "cancelled" } });
        expect(
          collected.events.filter(
            (event) =>
              event.type === "tool_execution_started" &&
              event.name === "wait_for_interrupt",
          ),
          "the tool had begun before interruption",
        ).toHaveLength(1);
        expect(
          toolEvents(collected.events, "wait_for_interrupt"),
          "straggler tool completion is suppressed after abort",
        ).toHaveLength(0);
      },
    );

    it(
      "interrupts a parked run and disposes open background tasks",
      { timeout: 240_000 },
      async () => {
        const cancelReasons: string[] = [];
        const completions: BackgroundTaskOutcome[] = [];
        const boundaryFacts: TurnFacts[] = [];
        const startParkedTask = defineTool({
          name: "start_parked_task",
          description: "Start background work that remains open until interrupt. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const done = new Promise<BackgroundTaskOutcome>(() => undefined);
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_interrupt", id: "parked" },
              title: "runtime parked interrupt task",
              cancel: (reason) => {
                cancelReasons.push(reason ?? "cancelled");
              },
              done,
              onCompletion: (outcome) => {
                completions.push(outcome);
              },
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
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-interrupt-parked-task",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startParkedTask],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 5,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_parked_task with {}.",
                '2. If you have not received a notification, reply exactly "waiting" with no tool calls.',
                '3. If you ever continue later, call submit_runtime_outcome with {"status":"completed","codeword":"should-not-complete"}.',
              ].join("\n"),
            ),
          ],
        });

        await waitUntil(
          "run to park on open background task",
          () =>
            boundaryFacts.some(
              (facts) =>
                facts.turn === 2 &&
                facts.toolCalls === 0 &&
                facts.backgroundTaskCount === 1,
            ),
          180_000,
        );
        expect(run.backgroundTaskSupervisor.list(), "the task is open before interrupt").toEqual([
          expect.objectContaining({
            tag: { type: "runtime_interrupt", id: "parked" },
          }),
        ]);

        run.interrupt();
        const outcome = await run.outcome();

        expect(outcome).toMatchObject({ status: "cancelled" });
        await waitUntil(
          "run-end disposal to remove the parked task",
          () => run.backgroundTaskSupervisor.list().length === 0,
          30_000,
        );
        expect(cancelReasons, "disposeAll cancelled the task with the run-end reason").toEqual([
          "run finished",
        ]);
        expect(completions, "completion handler received the disposal cancellation").toEqual([
          { status: "cancelled", outcome: "run finished" },
        ]);
      },
    );
  },
);
