import type { UserMessage } from "../contracts/index.js";

import type { AgentRunHandle } from "./agent-run.js";
import type { LlmRef } from "./llm-client/registry.js";
import type {
  AgentOutcomeFn,
  HookEntry,
  ToolDefinition,
} from "./tool/index.js";

export interface AgentStartOptions {
  messages: UserMessage[];
}

/**
 * One reusable agent template. `T` is the run's outcome payload type: the
 * terminal tool's accepted submission, or the final text in text mode.
 */
export interface AgentSpec<T = string> {
  name: string;
  /** Resolves against `AgentRuntimeConfig.llmClients`. */
  llm: LlmRef;
  systemPrompt: string;
  /** All tools arrive here; the SDK ships no concrete product tools. */
  tools: ToolDefinition[];
  /** Absent means text termination mode (`T` stays string). */
  agentOutcomeFn?: AgentOutcomeFn<T>;
  /** Default 32. */
  maxTurns?: number;
  /** Per-agent extension of the runtime globals. */
  hooks?: HookEntry[];
}

export interface Agent<T = string> {
  start(input: AgentStartOptions): AgentRunHandle<T>;
}

export type AgentSteer = UserMessage;
