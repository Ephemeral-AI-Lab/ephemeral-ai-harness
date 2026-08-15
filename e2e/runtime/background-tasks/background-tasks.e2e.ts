import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineTool,
  type BackgroundTaskOutcome,
  type BackgroundTaskTag,
} from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  sawToolEvent,
  toolEvents,
  userMessage,
  waitUntil,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime background-tasks e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime background tasks over live codex (e2e)",
  () => {
    it(
      "parks on an open task and wakes when host cancellation publishes completion",
      { timeout: 240_000 },
      async () => {
        const tag: BackgroundTaskTag = { type: "runtime_e2e", id: "host-cancel" };
        const completions: BackgroundTaskOutcome[] = [];
        const cancelReasons: string[] = [];

        const startHostCancelledTask = defineTool({
          name: "start_host_cancelled_task",
          description:
            "Start background work that the host will cancel. Takes {} and returns its tag.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const done = new Promise<BackgroundTaskOutcome>(() => undefined);
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag,
              title: "runtime host-cancelled task",
              cancel: (reason) => {
                cancelReasons.push(reason ?? "cancelled");
              },
              done,
              onCompletion: (outcome, completionCtx) => {
                completions.push(outcome);
                completionCtx.notifier.publish(
                  `runtime task cancelled: ${outcome.outcome}`,
                  { key: "runtime-task" },
                );
              },
            });
            return Promise.resolve({
              output: { taskId, tag: { type: tag.type, id: tag.id } },
            });
          },
        });

        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-background-host-cancel",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startHostCancelledTask],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 6,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_host_cancelled_task with {}.",
                '2. If you have not received the notification "runtime task cancelled: host complete", reply exactly "waiting" with no tool calls.',
                '3. After that notification arrives, call submit_runtime_outcome with {"status":"completed","codeword":"background-cancelled"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        const collected = collectEvents(run);

        await waitUntil(
          "task registration",
          () => collected.events.some((event) => event.type === "task_registered"),
          90_000,
        );
        expect(run.backgroundTaskSupervisor.list(), "handle lists the open task").toEqual([
          expect.objectContaining({ tag, title: "runtime host-cancelled task" }),
        ]);
        await expect(
          run.backgroundTaskSupervisor.cancel(tag, "host complete"),
          "host can cancel by opaque tag",
        ).resolves.toBe(true);

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "background-cancelled" },
        });
        expect(cancelReasons, "cancel callback received the host reason").toEqual([
          "host complete",
        ]);
        expect(completions, "completion handler ran once for the cancellation").toEqual([
          { status: "cancelled", outcome: "host complete" },
        ]);
        expect(run.backgroundTaskSupervisor.list(), "settled tasks leave the open set").toEqual(
          [],
        );
        expect(sawToolEvent(collected.events, "start_host_cancelled_task")).toBe(true);
        expect(
          collected.events.some(
            (event) =>
              event.type === "task_settled" &&
              event.outcome.status === "cancelled" &&
              event.outcome.outcome === "host complete",
          ),
          "task settlement is visible in the live SDK event stream",
        ).toBe(true);
      },
    );

    it(
      "denies terminal submission while a task is open, then wakes and submits after completion",
      { timeout: 240_000 },
      async () => {
        const completions: BackgroundTaskOutcome[] = [];
        let finishTask!: (outcome: BackgroundTaskOutcome) => void;
        const done = new Promise<BackgroundTaskOutcome>((resolve) => {
          finishTask = resolve;
        });
        const startBlockingWork = defineTool({
          name: "start_blocking_work",
          description:
            "Start background work that blocks terminal submission until the host completes it.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_e2e", id: "blocking-gate" },
              title: "runtime blocking gate task",
              cancel: () => undefined,
              done,
              onCompletion: (outcome, completionCtx) => {
                completions.push(outcome);
                completionCtx.notifier.publish(
                  `runtime gate opened: ${outcome.outcome}`,
                  { key: "runtime-gate" },
                );
              },
            });
            return Promise.resolve({ output: { taskId } });
          },
        });
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-background-terminal-gate",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startBlockingWork],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 7,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_blocking_work with {}.",
                '2. Immediately call submit_runtime_outcome with {"status":"completed","codeword":"too-early"}. It will be denied while the task is open.',
                '3. After the denial, if you have not received "runtime gate opened: ready", reply exactly "waiting" with no tool calls.',
                '4. After that notification arrives, call submit_runtime_outcome with {"status":"completed","codeword":"gate-open"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        const collected = collectEvents(run);

        await waitUntil(
          "terminal gate denial",
          () =>
            toolEvents(collected.events, "submit_runtime_outcome").some(
              (event) =>
                event.is_error &&
                event.output.includes("submission denied") &&
                event.output.includes("background task"),
            ),
          180_000,
        );
        finishTask({ status: "success", outcome: "ready" });

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "gate-open" },
        });
        expect(completions, "completion handler ran once after the denial").toEqual([
          { status: "success", outcome: "ready" },
        ]);
        const submissions = toolEvents(collected.events, "submit_runtime_outcome");
        expect(
          submissions.some((event) => event.is_error),
          "the early terminal call was a recoverable tool error",
        ).toBe(true);
        expect(
          submissions.some((event) => !event.is_error && event.is_terminal),
          "the final terminal call succeeded after completion notification",
        ).toBe(true);
      },
    );

    it(
      "settles a rejected task as failed and wakes through its completion handler",
      { timeout: 240_000 },
      async () => {
        const completions: BackgroundTaskOutcome[] = [];
        let rejectTask!: (error: Error) => void;
        const done = new Promise<BackgroundTaskOutcome>((_resolve, reject) => {
          rejectTask = reject;
        });
        const startFailingWork = defineTool({
          name: "start_failing_work",
          description: "Start background work that the host will fail. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_e2e", id: "failing-work" },
              title: "runtime failing work",
              cancel: () => undefined,
              done,
              onCompletion: (outcome, completionCtx) => {
                completions.push(outcome);
                completionCtx.notifier.publish(
                  `runtime failure noticed: ${outcome.outcome}`,
                  { key: "runtime-failure" },
                );
              },
            });
            return Promise.resolve({ output: { taskId } });
          },
        });
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-background-failed-task",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startFailingWork],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 6,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_failing_work with {}.",
                '2. If you have not received "runtime failure noticed: background exploded", reply exactly "waiting" with no tool calls.',
                '3. After that notification arrives, call submit_runtime_outcome with {"status":"completed","codeword":"background-failed"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        const collected = collectEvents(run);

        await waitUntil(
          "failed task registration",
          () => collected.events.some((event) => event.type === "task_registered"),
          90_000,
        );
        rejectTask(new Error("background exploded"));

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "background-failed" },
        });
        expect(completions, "completion handler receives the failed task outcome").toEqual([
          { status: "failed", outcome: "background exploded" },
        ]);
        expect(
          collected.events.some(
            (event) =>
              event.type === "task_settled" &&
              event.outcome.status === "failed" &&
              event.outcome.outcome === "background exploded",
          ),
          "task_settled records the failed outcome",
        ).toBe(true);
        expect(
          toolEvents(collected.events, "submit_runtime_outcome").some(
            (event) => !event.is_error && event.is_terminal,
          ),
          "the model submitted after the failure notification",
        ).toBe(true);
      },
    );

    it(
      "records completion handler errors without wedging the run",
      { timeout: 240_000 },
      async () => {
        let finishTask!: (outcome: BackgroundTaskOutcome) => void;
        const done = new Promise<BackgroundTaskOutcome>((resolve) => {
          finishTask = resolve;
        });
        const startThrowingCompletion = defineTool({
          name: "start_throwing_completion",
          description:
            "Start background work whose completion handler publishes and throws. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            const { taskId } = ctx.backgroundTaskSupervisor.register({
              tag: { type: "runtime_e2e", id: "completion-error" },
              title: "runtime completion error task",
              cancel: () => undefined,
              done,
              onCompletion: (outcome, completionCtx) => {
                completionCtx.notifier.publish(
                  `runtime completion handler ran: ${outcome.outcome}`,
                  { key: "runtime-completion-error" },
                );
                throw new Error("completion callback exploded");
              },
            });
            return Promise.resolve({ output: { taskId } });
          },
        });
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-background-completion-error",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [startThrowingCompletion],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 6,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call start_throwing_completion with {}.",
                '2. If you have not received "runtime completion handler ran: ok", reply exactly "waiting" with no tool calls.',
                '3. After that notification arrives, call submit_runtime_outcome with {"status":"completed","codeword":"completion-error-recorded"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        const collected = collectEvents(run);

        await waitUntil(
          "completion-error task registration",
          () => collected.events.some((event) => event.type === "task_registered"),
          90_000,
        );
        finishTask({ status: "success", outcome: "ok" });

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: {
            status: "completed",
            codeword: "completion-error-recorded",
          },
        });
        expect(
          collected.events.some(
            (event) =>
              event.type === "task_settled" &&
              event.outcome.status === "success" &&
              event.outcome.outcome === "ok" &&
              event.completionError === "completion callback exploded",
          ),
          "task_settled records the completion handler error",
        ).toBe(true);
      },
    );
  },
);
