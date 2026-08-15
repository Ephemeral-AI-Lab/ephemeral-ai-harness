import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool, type HookEntry, type ToolCallFacts } from "../../../src/index.js";
import {
  RUNTIME_CLIENT_ID,
  createRuntimeAgentRuntime,
  runtimeCodex,
  runtimeOutcomeFn,
  runtimeSystemPrompt,
  userMessage,
  type RuntimeOutcome,
} from "../support/runtime.js";

if (!runtimeCodex.available) {
  console.warn(`runtime sdk-composition e2e skipped: ${runtimeCodex.reason}`);
}

describe.skipIf(!runtimeCodex.available)(
  "runtime sdk composition over live codex (e2e)",
  () => {
    it(
      "runs global and per-agent hooks against one live run",
      { timeout: 180_000 },
      async () => {
        const seen: string[] = [];
        const globalHooks: HookEntry[] = [hookRecorder("global", seen)];
        const agentHooks: HookEntry[] = [hookRecorder("agent", seen)];
        const compositionProbe = defineTool({
          name: "composition_probe",
          description: "Return an SDK-composition marker. Takes {}.",
          input: z.object({}),
          execute: () => Promise.resolve({ output: { marker: "composition-ok" } }),
        });
        const sdk = createRuntimeAgentRuntime({ hooks: globalHooks });
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-sdk-composition",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [compositionProbe],
          agentOutcomeFn: runtimeOutcomeFn(),
          hooks: agentHooks,
          maxTurns: 5,
        });
        const run = agent.start({
          messages: [
            userMessage(
              [
                "1. Call composition_probe with {}.",
                '2. Then call submit_runtime_outcome with {"status":"completed","codeword":"composition-ok"}.',
                "Do not write final prose.",
              ].join("\n"),
            ),
          ],
        });

        const outcome = await run.outcome();

        expect(outcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "composition-ok" },
        });
        expect(seen, "global and per-agent hooks both saw the custom tool").toEqual(
          expect.arrayContaining([
            "global:composition_probe",
            "agent:composition_probe",
          ]),
        );
        expect(seen, "global and per-agent hooks both saw the terminal tool").toEqual(
          expect.arrayContaining([
            "global:submit_runtime_outcome",
            "agent:submit_runtime_outcome",
          ]),
        );
      },
    );

    it(
    "reuses one agent template for concurrent isolated runs",
    { timeout: 240_000 },
    async () => {
        const terminalCalls: string[] = [];
        const sdk = createRuntimeAgentRuntime({
          hooks: [
            {
              event: "preToolUse",
              matcher: { toolName: "submit_runtime_outcome" },
              run: (call) => {
                const codeword =
                  typeof call.input.codeword === "string"
                    ? call.input.codeword
                    : "<invalid>";
                terminalCalls.push(codeword);
                return { decision: "passthrough" };
              },
            },
          ],
        });
        const agent = sdk.createAgent<RuntimeOutcome>({
          name: "runtime-sdk-template-reuse",
          llm: RUNTIME_CLIENT_ID,
          systemPrompt: runtimeSystemPrompt(),
          tools: [],
          agentOutcomeFn: runtimeOutcomeFn(),
          maxTurns: 3,
        });

        const first = agent.start({
          messages: [
            userMessage(
              'Call submit_runtime_outcome with {"status":"completed","codeword":"template-first"}. Do not write final prose.',
            ),
          ],
        });
        const second = agent.start({
          messages: [
            userMessage(
              'Call submit_runtime_outcome with {"status":"completed","codeword":"template-second"}. Do not write final prose.',
            ),
          ],
        });

        const [firstOutcome, secondOutcome] = await Promise.all([
          first.outcome(),
          second.outcome(),
        ]);

        expect(firstOutcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "template-first" },
        });
        expect(secondOutcome).toMatchObject({
          status: "completed",
          outcome: { status: "completed", codeword: "template-second" },
        });
        expect(terminalCalls).toEqual(
          expect.arrayContaining([
            "template-first",
            "template-second",
          ]),
        );
      },
    );
  },
);

function hookRecorder(label: string, seen: string[]): HookEntry {
  return {
    event: "preToolUse",
    run: (call: ToolCallFacts) => {
      seen.push(`${label}:${call.toolName}`);
      return { decision: "passthrough" };
    },
  };
}
