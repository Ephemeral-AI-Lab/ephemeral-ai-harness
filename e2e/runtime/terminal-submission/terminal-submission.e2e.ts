import { describe, expect, it } from "vitest";

import { createAgentOutcomeFn, type AgentRunHandle } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  RuntimeOutcomeSchema,
  collectEvents,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeSystemPrompt,
  toolEvents,
  userMessage,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime terminal-submission e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime terminal submission over live codex (e2e)",
  () => {
    it(
      "returns onSubmit rejection as a tool error and accepts a later correction",
      { timeout: 240_000 },
      async () => {
        const submissionIds: string[] = [];
        const acceptedCodewords: string[] = [];
        let steerDuringCommit: boolean | undefined;
        const runRef: { current?: AgentRunHandle<RuntimeOutcome> } = {};
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-terminal-rejection",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [],
          agentOutcomeFn: createAgentOutcomeFn({
            name: "submit_runtime_outcome",
            description: "Submit the final runtime e2e outcome.",
            schema: RuntimeOutcomeSchema,
            onSubmit: (payload, ctx) => {
              submissionIds.push(ctx.submissionId);
              if (payload.codeword === "draft") {
                return Promise.resolve({
                  reject: "runtime submission needs final codeword",
                });
              }
              steerDuringCommit = runRef.current?.steer(
                userMessage("late commit-window redirect"),
              );
              acceptedCodewords.push(payload.codeword);
              return Promise.resolve({ accept: payload });
            },
          }),
          maxTurns: 6,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                '1. Call submit_runtime_outcome with {"status":"completed","codeword":"draft"}.',
                "2. That submission will be rejected as a tool error.",
                '3. After the tool error, call submit_runtime_outcome with {"status":"completed","codeword":"terminal-recovered"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });
        runRef.current = run;
        const collected = collectEvents(run);

        const outcome = await run.outcome();
        await collected.done;

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "terminal-recovered" },
        });
        expect(submissionIds, "each terminal attempt gets its tool-use id").toHaveLength(
          2,
        );
        expect(
          new Set(submissionIds).size,
          "submission ids are distinct across attempts",
        ).toBe(2);
        expect(acceptedCodewords, "only the accepted submission mutates host state").toEqual([
          "terminal-recovered",
        ]);
        expect(steerDuringCommit, "finishing latch refuses commit-window steers").toBe(
          false,
        );
        const submissions = toolEvents(collected.events, "submit_runtime_outcome");
        expect(
          submissions.some(
            (event) =>
              event.is_error &&
              event.output.includes("runtime submission needs final codeword"),
          ),
          "the rejected submission reached the model as a tool error",
        ).toBe(true);
        expect(
          submissions.some((event) => !event.is_error && event.is_terminal),
          "the corrected submission ended the run",
        ).toBe(true);
      },
    );

    it(
      "accepts only one terminal call from a batched duplicate submission",
      { timeout: 240_000 },
      async () => {
        const acceptedCodewords: string[] = [];
        const sdk = createRuntimeAgentRuntime();
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-terminal-duplicate-batch",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(
            "When the user asks for a batch, put every requested tool call in one assistant response.",
          ),
          tools: [],
          agentOutcomeFn: createAgentOutcomeFn({
            name: "submit_runtime_outcome",
            description: "Submit the final runtime e2e outcome.",
            schema: RuntimeOutcomeSchema,
            onSubmit: (payload) => {
              acceptedCodewords.push(payload.codeword);
              return Promise.resolve({ accept: payload });
            },
          }),
          maxTurns: 4,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "Your first assistant response must contain exactly two tool calls in the same response.",
                'First call submit_runtime_outcome with {"status":"completed","codeword":"first-accepted"}.',
                'Second call submit_runtime_outcome with {"status":"completed","codeword":"second-denied"}.',
                "Do not wait for one result before issuing the other call.",
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
          outcome: { status: "completed", codeword: "first-accepted" },
        });
        expect(acceptedCodewords, "only the first terminal call reached onSubmit").toEqual([
          "first-accepted",
        ]);
        const submissions = toolEvents(collected.events, "submit_runtime_outcome");
        expect(submissions, "both terminal calls were executed in the batch").toHaveLength(
          2,
        );
        expect(
          submissions.filter((event) => event.is_terminal && !event.is_error),
          "exactly one terminal result was accepted",
        ).toHaveLength(1);
        expect(
          submissions.some(
            (event) =>
              event.is_error &&
              event.output.includes("submission was already accepted"),
          ),
          "the duplicate terminal call was denied by the finishing latch",
        ).toBe(true);
      },
    );
  },
);
