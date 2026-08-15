import {
  createAgentRuntime,
  type AgentRuntime,
  type HookEntry,
  type LlmClientConfig,
} from "@ephai/agent-core";

import {
  buildAgentFactory,
  type AgentFactory,
  type AgentFactoryBuildOptions,
  type AgentProfileRegistry,
} from "./agents/index.js";
import {
  JsonlAgentRunStore,
  type AgentRunStore,
} from "./runs/index.js";

export interface AgentHarnessConfig {
  /** Provider credentials and model profiles supplied by the host. */
  llmClients: LlmClientConfig;
  /** Agent profiles supplied by the host. */
  profiles: AgentProfileRegistry;
  /** Directory where durable run records are written. */
  recordsDir: string;
  /** Process-wide callback hooks. */
  hooks?: HookEntry[];
  /** Bounds each background-task completion callback. */
  taskCompletionTimeoutMs?: number;
  /** Optional host tools added to each profile's selected tools. */
  extraTools?: AgentFactoryBuildOptions["extraTools"];
}

export interface AgentHarness {
  readonly agentRuntime: AgentRuntime;
  readonly agentRunStore: AgentRunStore;
  readonly agents: AgentFactory;
}

/**
 * Compose the reusable core runtime with the harness-owned agent factory and
 * durable run store. Configuration is fully injected; this package does not
 * read files, discover a working directory, or provide a CLI.
 */
export function createAgentHarness(config: AgentHarnessConfig): AgentHarness {
  const agentRuntime = createAgentRuntime({
    llmClients: config.llmClients,
    hooks: config.hooks,
    taskCompletionTimeoutMs: config.taskCompletionTimeoutMs,
  });
  const agentRunStore = new JsonlAgentRunStore(config.recordsDir);
  const agents = buildAgentFactory({
    agentRuntime,
    profiles: config.profiles,
    agentRunStore,
    extraTools: config.extraTools,
  });
  return { agentRuntime, agentRunStore, agents };
}
