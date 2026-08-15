import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentRuntime,
  type AgentEvent,
  type AgentRuntime,
  type AgentRunHandle as SdkAgentRunHandle,
  type AgentSpec,
  type HookEntry,
  type ToolCallFacts,
  type ToolUseId,
} from "@ephai/agent-core";
import {
  ScriptedLlmClient,
  assistantMessage,
  complete,
  scriptedTurn,
  toolUseBlock,
  userMessage,
} from "@ephai/agent-core/testkit";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AdvisorPassRegistry,
  buildAgentFactory,
  createAgentOutcomeFnWithAdvisory,
  type AgentProfile,
  type AgentProfileRegistry,
} from "../../src/agents/index.js";
import { JsonlAgentRunStore, type AgentRunId } from "../../src/runs/index.js";

const MainOutcome = z.object({ summary: z.string().min(1) });

function recordsDir(): string {
  return mkdtempSync(join(tmpdir(), "ephai-agent-records-"));
}

function factory(
  agentRuntime: AgentRuntime,
  profiles: AgentProfileRegistry,
): ReturnType<typeof buildAgentFactory> {
  return buildAgentFactory({
    agentRuntime,
    profiles,
    agentRunStore: new JsonlAgentRunStore(recordsDir()),
    agentHooks: {
      advisorApproval: requireAdvisoryPass,
    },
  });
}

function inertSdkHandle<T>(): SdkAgentRunHandle<T> {
  return {
    steer: () => false,
    interrupt: () => undefined,
    outcome: () => Promise.resolve({
      status: "cancelled",
      turns: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
    events: () => emptyAgentEvents(),
    backgroundTaskSupervisor: {} as SdkAgentRunHandle<T>["backgroundTaskSupervisor"],
    notifier: { publish: () => undefined },
  };
}

async function* emptyAgentEvents(): AsyncIterable<AgentEvent> {
  yield* [];
  await Promise.resolve();
}

describe("buildAgentFactory", () => {
  it("runs the advisory loop: ask_advisor pass authorizes the gated terminal submission", async () => {
    const operatorTurns = [
      scriptedTurn([
        complete(
          assistantMessage(
            toolUseBlock("t1", "ask_advisor", {
              tool_name: "submit_main_outcome",
              payload: { summary: "shipped" },
            }),
          ),
        ),
      ]),
      scriptedTurn([
        complete(assistantMessage(toolUseBlock("t2", "submit_main_outcome", { summary: "shipped" }))),
      ]),
    ];
    const advisorTurns = [
      scriptedTurn([
        complete(
          assistantMessage(
            toolUseBlock("a1", "submit_advisor_outcome", { verdict: "pass", reason: "looks correct" }),
          ),
        ),
      ]),
    ];
    const agentRuntime = createAgentRuntime({
      llmClients: {
        op: { client: new ScriptedLlmClient(operatorTurns), model: "m" },
        adv: { client: new ScriptedLlmClient(advisorTurns), model: "m" },
      },
    });
    const agents = factory(
      agentRuntime,
      profiles([
        profile("operator", { llm_client_id: "op" }),
        profile("advisor", { llm_client_id: "adv" }),
      ]),
    );

    const operator = agents.create(
      "operator",
      createAgentOutcomeFnWithAdvisory({
        name: "submit_main_outcome",
        schema: MainOutcome,
        advisoryPrompt: "Confirm the operator finished the goal.",
      }),
    );
    const run = await operator.start({ messages: [userMessage("ship it")] });
    const outcome = await run.outcome();

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.outcome).toEqual({ summary: "shipped" });
  });

  it("installs the no-background prehook before the advisor gate", async () => {
    const captured: AgentSpec<unknown>[] = [];
    const agentRuntime: AgentRuntime = {
      createAgent<T>(spec: AgentSpec<T>) {
        captured.push(spec as AgentSpec<unknown>);
        return { start: () => inertSdkHandle<T>() };
      },
    };
    const agents = factory(
      agentRuntime,
      profiles([profile("operator"), profile("advisor")]),
    );

    const operator = agents.create(
      "operator",
      createAgentOutcomeFnWithAdvisory({
        name: "submit_main_outcome",
        schema: MainOutcome,
        advisoryPrompt: "Confirm the operator finished the goal.",
      }),
    );
    await operator.start({ messages: [userMessage("ship it")] });

    const hooks = captured[0]?.hooks ?? [];
    const facts: ToolCallFacts = {
      toolUseId: "tu-1" as ToolUseId,
      toolName: "submit_main_outcome",
      input: { summary: "done" },
      backgroundTaskCount: 1,
    };
    if (hooks[0]?.event !== "preToolUse" || hooks[1]?.event !== "preToolUse") {
      throw new Error("expected terminal prehooks");
    }

    const first = await hooks[0].run(facts);
    const second = await hooks[1].run(facts);
    expect(first.decision).toBe("deny");
    if (first.decision === "deny") expect(first.reason).toContain("background task(s)");
    expect(second.decision).toBe("deny");
    if (second.decision === "deny") expect(second.reason).toContain("advisor has not passed");
  });

  it.each(["ask_advisor", "run_subagent"])(
    "rejects a profile that lists factory-injected tool %s in allowed_tools",
    (toolName) => {
      const agentRuntime = createAgentRuntime({
        llmClients: { op: { client: new ScriptedLlmClient([]), model: "m" } },
      });
      const agents = factory(
        agentRuntime,
        profiles([
          profile("advisor"),
          profile("subagent"),
          profile("rogue", {
            allowed_tools: [toolName],
            subagents: ["subagent"],
          }),
        ]),
      );

      expect(() => agents.create("rogue")).toThrow(new RegExp(`factory-injected tool "${toolName}"`));
    },
  );

  it("injects dynamic subagent tools from createAgent input", async () => {
    const captured: AgentSpec<unknown>[] = [];
    const agentRuntime: AgentRuntime = {
      createAgent<T>(spec: AgentSpec<T>) {
        captured.push(spec as AgentSpec<unknown>);
        return { start: () => inertSdkHandle<T>() };
      },
    };
    const agents = factory(
      agentRuntime,
      profiles([profile("operator"), profile("subagent"), profile("advisor")]),
    );

    const operator = agents.createAgent({
      agentName: "operator",
      dynamicTools: { subagents: ["subagent"] },
    });
    await operator.start({ messages: [userMessage("delegate")] });

    expect(captured[0]?.tools.map((tool) => tool.name)).toContain("run_subagent");
    expect(agents.getAgentProfile("operator").name).toBe("operator");
  });

  it("requires a configured advisor profile", () => {
    const agentRuntime = createAgentRuntime({
      llmClients: { op: { client: new ScriptedLlmClient([]), model: "m" } },
    });

    expect(() =>
      factory(agentRuntime, profiles([profile("operator")])),
    ).toThrow(/"advisor" profile/);
  });
});

function requireAdvisoryPass(opts: {
  agentRunId: AgentRunId;
  toolName: string;
  passes: AdvisorPassRegistry;
}): HookEntry {
  return {
    event: "preToolUse",
    matcher: { toolName: opts.toolName },
    run: (facts) =>
      opts.passes.hasPass(opts.agentRunId, {
        tool_name: facts.toolName,
        payload: facts.input,
      })
        ? { decision: "passthrough" }
        : { decision: "deny", reason: "advisor has not passed this terminal submission" },
  };
}

function profiles(values: readonly AgentProfile[]): AgentProfileRegistry {
  const byName = new Map(values.map((value) => [value.name, value]));
  return {
    require(name) {
      const value = byName.get(name);
      if (value === undefined) throw new Error(`unknown profile ${name}`);
      return value;
    },
    list: () => [...byName.values()],
  };
}

function profile(
  name: string,
  overrides: Partial<Omit<AgentProfile, "name" | "system_prompt" | "source_path">> = {},
): AgentProfile {
  return {
    name,
    llm_client_id: "op",
    allowed_tools: [],
    subagents: [],
    system_prompt: "test prompt",
    source_path: `${name}.md`,
    ...overrides,
  };
}
