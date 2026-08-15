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
  console.warn(`runtime submission-gates e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime submission gates over live codex (e2e)",
  () => {
    it(
      "denies terminal submission until a same-batch notification drains",
      { timeout: 240_000 },
      async () => {
        let publishes = 0;
        const publishRuntimeNotice = defineTool({
          name: "publish_runtime_notice",
          description: "Publish a runtime notification. Takes {}.",
          input: z.object({}),
          execute: (_input, ctx) => {
            publishes += 1;
            ctx.notifier.publish("runtime notification gate opened", {
              key: "runtime-gate",
            });
            return Promise.resolve({ output: { published: true } });
          },
        });
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-notification-terminal-gate",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(
            "When the user asks for a batch, put every requested tool call in one assistant response.",
          ),
          tools: [publishRuntimeNotice],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 7,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Your first assistant response must contain exactly two tool calls in the same response: publish_runtime_notice with {} and submit_runtime_outcome with {\"status\":\"completed\",\"codeword\":\"notification-too-early\"}.",
                "2. The early submission will be denied because the notification has not drained yet.",
                "3. After the system notification arrives, call submit_runtime_outcome with {\"status\":\"completed\",\"codeword\":\"notification-cleared\"}.",
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
          outcome: { status: "completed", codeword: "notification-cleared" },
        });
        expect(publishes, "the notification-producing tool ran once").toBe(1);
        const submissions = toolEvents(collected.events, "submit_runtime_outcome");
        expect(
          submissions.some(
            (event) =>
              event.is_error &&
              event.output.includes("submission denied") &&
              event.output.includes("undrained notification"),
          ),
          "same-batch notification blocked the early terminal submission",
        ).toBe(true);
        expect(
          submissions.some((event) => !event.is_error && event.is_terminal),
          "terminal submission succeeded after the notification drained",
        ).toBe(true);
      },
    );
  },
);
