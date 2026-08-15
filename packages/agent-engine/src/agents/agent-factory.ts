import {
  agentOutcomeToolName,
  type AgentOutcomeFn,
  type AgentRuntime,
  type AgentSpec,
  type HookEntry,
  type ToolDefinition,
  type UserMessage,
} from "@ephai/agent-core";

import {
  ADVISOR_AGENT_NAME,
  askAdvisor,
} from "../tools/agent/ask-advisor.js";
import { readAgentRun } from "../tools/agent/read-agent-run.js";
import { runSubagent } from "../tools/agent/run-subagent.js";
import { cancelBackgroundTask } from "../tools/background/cancel-background-task.js";
import { listBackgroundTasks } from "../tools/background/list-background-tasks.js";
import {
  AdvisorPassRegistry,
  requireNoBackgroundTasks,
  withAdvisory,
  type AgentHookFactories,
  type AgentOutcomeFnWithAdvisory,
} from "./outcome-advisory.js";

import type { AgentProfile, AgentProfileRegistry } from "./agent-profile.js";
import {
  bridgeAgentRun,
  type AgentRunHandle,
  type AgentRunId,
  type AgentRunStore,
} from "../runs/index.js";

export type { AgentOutcomeFnWithAdvisory } from "./outcome-advisory.js";

export interface AgentStartOptions {
  messages: UserMessage[];
}

export interface DynamicAgentTools {
  subagents?: readonly string[];
  advisor?: { prompt: string };
}

export interface CreateAgentInput<T = string> {
  agentName: string;
  outcome?: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>;
  dynamicTools?: DynamicAgentTools;
}

export interface Agent<T = string> {
  start(input: AgentStartOptions): Promise<AgentRunHandle<T>>;
}

export interface AgentFactory {
  createAgent<T = string>(input: CreateAgentInput<T>): Agent<T>;

  create<T = string>(
    name: string,
    agentOutcomeFn?: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>,
  ): Agent<T>;

  getAgentProfile(agentName: string): AgentProfile;
}

export interface AgentFactoryBuildOptions {
  agentRuntime: AgentRuntime;
  profiles: AgentProfileRegistry;
  agentRunStore: AgentRunStore;
  agentHooks: AgentHookFactories;
  extraTools?: (input: {
    profile: AgentProfile;
    agentRunId: AgentRunId;
  }) => readonly ToolDefinition[];
}

/**
 * The only place an engine profile becomes an agent-core `AgentSpec`.
 * Engine-owned tools are installed here. Product-specific tools arrive through
 * `extraTools` and stay outside the engine.
 */
export function buildAgentFactory(options: AgentFactoryBuildOptions): AgentFactory {
  validateAdvisorProfile(options.profiles);
  const passes = new AdvisorPassRegistry();

  const factory: AgentFactory = {
    createAgent<T = string>(input: CreateAgentInput<T>): Agent<T> {
      return createBoundAgent(input.agentName, {
        outcome: bindDynamicAdvisor(input.outcome, input.dynamicTools),
        dynamicTools: input.dynamicTools,
      });
    },

    create<T = string>(
      name: string,
      agentOutcomeFn?: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>,
    ): Agent<T> {
      return createBoundAgent(name, { outcome: agentOutcomeFn });
    },

    getAgentProfile(agentName: string): AgentProfile {
      return options.profiles.require(agentName);
    },
  };

  function createBoundAgent<T = string>(
    name: string,
    input: {
      outcome?: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>;
      dynamicTools?: DynamicAgentTools;
    },
  ): Agent<T> {
    const profile = options.profiles.require(name);
    const dynamicTools = resolveDynamicTools({
      profile,
      profiles: options.profiles,
      dynamicTools: input.dynamicTools,
    });
    validateToolSelection(profile);
    return {
      async start(startInput) {
        const { agentRunId } = await options.agentRunStore.create({
          agentName: profile.name,
        });
        try {
          const spec = buildAgentSpec({
            profile,
            factory,
            agentRunId,
            agentRunStore: options.agentRunStore,
            agentHooks: options.agentHooks,
            passes,
            extraTools: options.extraTools?.({ profile, agentRunId }) ?? [],
            agentOutcomeFn: input.outcome,
            dynamicTools,
          });
          const sdkAgent = options.agentRuntime.createAgent<T>(spec);
          const sdkHandle = sdkAgent.start(startInput);
          return await bridgeAgentRun({
            agentRunId,
            sdkHandle,
            store: options.agentRunStore,
          });
        } catch (error) {
          await options.agentRunStore.failStart({
            agentRunId,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    };
  }

  return factory;
}

interface ResolvedDynamicTools {
  subagents: readonly string[];
}

function buildAgentSpec<T>(input: {
  profile: AgentProfile;
  factory: AgentFactory;
  agentRunId: AgentRunId;
  agentRunStore: AgentRunStore;
  agentHooks: AgentHookFactories;
  passes: AdvisorPassRegistry;
  extraTools: readonly ToolDefinition[];
  agentOutcomeFn?: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>;
  dynamicTools: ResolvedDynamicTools;
}): AgentSpec<T> {
  const tools = selectOrdinaryTools(
    input.profile,
    input.factory,
    input.agentRunStore,
    input.agentRunId,
    input.dynamicTools.subagents,
    input.extraTools,
  );
  const systemPrompt = input.profile.system_prompt;

  const hooks: HookEntry[] = [];
  let outcomeFn: AgentOutcomeFn<T> | undefined;
  if (input.agentOutcomeFn !== undefined) {
    if (isAdvisoryBinding(input.agentOutcomeFn)) {
      outcomeFn = input.agentOutcomeFn.outcomeFn;
      const toolName = terminalToolName(outcomeFn);
      if (input.agentHooks.advisorApproval === undefined) {
        throw new Error("advisory binding requires advisor_approval in hooks.json");
      }
      tools.push(
        askAdvisor(
          input.factory,
          input.agentOutcomeFn.advisoryPrompt,
          input.passes,
          input.agentRunId,
        ),
      );
      hooks.push(requireNoBackgroundTasks({ toolName }));
      hooks.push(
        input.agentHooks.advisorApproval({
          agentRunId: input.agentRunId,
          toolName,
          passes: input.passes,
        }),
      );
    } else {
      outcomeFn = input.agentOutcomeFn;
      hooks.push(requireNoBackgroundTasks({ toolName: terminalToolName(outcomeFn) }));
    }
  }

  return {
    name: input.profile.name,
    llm: input.profile.llm_client_id,
    systemPrompt,
    tools,
    ...(outcomeFn !== undefined && { agentOutcomeFn: outcomeFn }),
    ...(input.profile.max_turns !== undefined && { maxTurns: input.profile.max_turns }),
    ...(hooks.length > 0 && { hooks }),
  };
}

function bindDynamicAdvisor<T>(
  outcome: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T> | undefined,
  dynamicTools: DynamicAgentTools | undefined,
): AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T> | undefined {
  const prompt = dynamicTools?.advisor?.prompt;
  if (prompt === undefined) return outcome;
  if (outcome === undefined) {
    throw new Error("dynamic advisor tool requires an outcome binding");
  }
  if (isAdvisoryBinding(outcome)) {
    throw new Error("dynamic advisor tool cannot wrap an advisory outcome binding");
  }
  return withAdvisory(outcome, prompt);
}

function resolveDynamicTools(input: {
  profile: AgentProfile;
  profiles: AgentProfileRegistry;
  dynamicTools: DynamicAgentTools | undefined;
}): ResolvedDynamicTools {
  const subagents = input.dynamicTools?.subagents ?? input.profile.subagents;
  assertUnique("subagent", subagents);
  for (const subagent of subagents) {
    input.profiles.require(subagent);
  }
  return { subagents };
}

function selectOrdinaryTools(
  profile: AgentProfile,
  factory: AgentFactory,
  agentRunStore: AgentRunStore,
  agentRunId: AgentRunId,
  subagents: readonly string[],
  extraTools: readonly ToolDefinition[],
): ToolDefinition[] {
  const available = new Map<string, ToolDefinition>();
  for (const tool of [
    listBackgroundTasks,
    cancelBackgroundTask,
    readAgentRun(agentRunStore),
    ...extraTools,
  ]) {
    available.set(tool.name, tool);
  }

  const injected = factoryInjectedToolNames();
  const selected: ToolDefinition[] = [];
  const seen = new Set<string>();
  for (const name of profile.allowed_tools) {
    if (injected.has(name)) {
      throw new Error(`profile "${profile.name}" lists factory-injected tool "${name}" in allowed_tools`);
    }
    if (seen.has(name)) {
      throw new Error(`profile "${profile.name}" lists duplicate tool "${name}"`);
    }
    const tool = available.get(name);
    if (!tool) throw new Error(`profile "${profile.name}" lists unknown tool "${name}"`);
    seen.add(name);
    selected.push(tool);
  }
  if (subagents.length > 0) {
    selected.push(runSubagent(factory, subagents as readonly [string, ...string[]]));
  }
  void agentRunId;
  return selected;
}

function validateToolSelection(profile: AgentProfile): void {
  const injected = factoryInjectedToolNames();
  const seen = new Set<string>();
  for (const name of profile.allowed_tools) {
    if (injected.has(name)) {
      throw new Error(`profile "${profile.name}" lists factory-injected tool "${name}" in allowed_tools`);
    }
    if (seen.has(name)) {
      throw new Error(`profile "${profile.name}" lists duplicate tool "${name}"`);
    }
    seen.add(name);
  }
}

function factoryInjectedToolNames(): ReadonlySet<string> {
  return new Set([
    "ask_advisor",
    "run_subagent",
  ]);
}

function assertUnique(kind: string, names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate ${kind} "${name}"`);
    seen.add(name);
  }
}

function isAdvisoryBinding<T>(
  binding: AgentOutcomeFn<T> | AgentOutcomeFnWithAdvisory<T>,
): binding is AgentOutcomeFnWithAdvisory<T> {
  return "kind" in binding;
}

function terminalToolName<T>(outcomeFn: AgentOutcomeFn<T>): string {
  return agentOutcomeToolName(outcomeFn as AgentOutcomeFn<unknown>);
}

function validateAdvisorProfile(profiles: AgentProfileRegistry): void {
  const advisor = profiles.list().find((profile) => profile.name === ADVISOR_AGENT_NAME);
  if (advisor === undefined) {
    throw new Error(`advisory requires an "${ADVISOR_AGENT_NAME}" profile, which is not configured`);
  }
}
