import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentRuntime,
  type AgentEvent,
  type AgentRuntime,
  type AgentRunHandle as SdkAgentRunHandle,
  type AgentSpec,
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

import {
  buildAgentFactory,
  type AgentProfile,
  type AgentProfileRegistry,
} from "../../src/agents/index.js";
import { JsonlAgentRunStore } from "../../src/runs/index.js";

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
  it.each(["run_subagent"])(
    "rejects a profile that lists factory-injected tool %s in allowed_tools",
    (toolName) => {
      const agentRuntime = createAgentRuntime({
        llmClients: { op: { client: new ScriptedLlmClient([]), model: "m" } },
      });
      const agents = factory(
        agentRuntime,
        profiles([
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
      profiles([profile("operator"), profile("subagent")]),
    );

    const operator = agents.createAgent({
      agentName: "operator",
      dynamicTools: { subagents: ["subagent"] },
    });
    await operator.start({ messages: [userMessage("delegate")] });

    expect(captured[0]?.tools.map((tool) => tool.name)).toContain("run_subagent");
    expect(agents.getAgentProfile("operator").name).toBe("operator");
  });

});

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
