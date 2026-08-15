import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../../../src/index.js";
import {
  createRuntimeOutcomeAgent,
  loadRuntimeJsonFixture,
  loadRuntimeMarkdownFixture,
  runtimeCodex,
  runtimeUserSteps,
} from "../support/runtime.js";

const RuntimeConfiguredScenarioSchema = z.object({
  name: z.string().min(1),
  systemPromptMarkdown: z.string().min(1),
  tool: z.object({
    name: z.string().min(1),
    response: z.object({
      codeword: z.string().min(1),
      source: z.string().min(1),
    }),
  }),
  userSteps: z.array(z.string().min(1)).min(1),
  expectedCodeword: z.string().min(1),
  maxTurns: z.number().int().positive(),
});

if (!runtimeCodex.available) {
  console.warn(`runtime configuration e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime fixture configuration over live codex (e2e)",
  () => {
    it(
      "loads a custom JSON scenario and Markdown system prompt",
      { timeout: 180_000 },
      async () => {
        const scenario = loadRuntimeJsonFixture(
          "configured-outcome.json",
          RuntimeConfiguredScenarioSchema,
        );
        const markdownPrompt = loadRuntimeMarkdownFixture(
          scenario.systemPromptMarkdown,
        );
        let calls = 0;
        const configuredTool = defineTool({
          name: scenario.tool.name,
          description: "Return the configured runtime fixture response. Takes {}.",
          input: z.object({}),
          execute: () => {
            calls += 1;
            return Promise.resolve({ output: scenario.tool.response });
          },
        });
        const agent = createRuntimeOutcomeAgent({
          name: scenario.name,
          systemPromptExtra: markdownPrompt,
          tools: [configuredTool],
          maxTurns: scenario.maxTurns,
        });

        const run = agent.start({
          messages: [runtimeUserSteps(scenario.userSteps)],
        });

        const outcome = await run.outcome();

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: {
            status: "completed",
            codeword: scenario.expectedCodeword,
          },
        });
        expect(calls, "the configured fixture tool was called once").toBe(1);
      },
    );
  },
);
