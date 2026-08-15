// @ephai/agent-core — the complete public surface (spec §3). Three construction
// values and types only: no tool implementations, no Zod schemas, no
// subprocess execution, no SDK-owned run identifiers.

// ── construction ────────────────────────────────────────────────
export {
  createAgentRuntime,
  type Agent,
  type AgentRuntime,
  type AgentRuntimeConfig,
  type AgentSpec,
} from "./agents/index.js";
export type {
  LlmClientConfig,
  LlmClientProfile,
  LlmRef,
} from "./agents/llm-client/registry.js";

// ── agents & runs ───────────────────────────────────────────────
export type {
  AgentEvent,
  AgentOutcome,
  AgentRunError,
  AgentRunHandle,
  TurnFacts,
} from "./agents/agent-run.js";

// ── run-scoped capabilities ─────────────────────────────────────
export type {
  BackgroundTask,
  BackgroundTaskCompletionContext,
  BackgroundTaskOutcome,
  BackgroundTaskRow,
  BackgroundTaskSupervisor,
  BackgroundTaskTag,
} from "./agents/background/index.js";
export type { Notifier } from "./agents/notification/index.js";

// ── authoring ───────────────────────────────────────────────────
export {
  agentOutcomeToolName,
  createAgentOutcomeFn,
  defineTool,
  type AgentOutcomeFn,
  type HookDecision,
  type HookEntry,
  type HookMatcher,
  type SubmitCtx,
  type ToolCallContext,
  type ToolCallFacts,
  type ToolDefinition,
  type ToolSpec,
  type ToolResult,
} from "./agents/tool/index.js";

// ── exported types (no values, no schemas) ──────────────────────
export type {
  BackgroundTaskId,
  ContentBlock,
  JsonObject,
  JsonValue,
  Message,
  ToolUseId,
  UserMessage,
} from "./contracts/index.js";
export type {
  LlmClient,
  ProviderConnection,
  ReasoningEffort,
  UsageSnapshot,
} from "./agents/llm-client/index.js";
