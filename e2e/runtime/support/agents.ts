import { z } from "zod";

import {
  createAgentOutcomeFn,
  type HookEntry,
  type Message,
  type ToolDefinition,
  type UserMessage,
} from "../../../src/index.js";
import {
  createAgentRuntime,
  type Agent,
  type AgentRuntime,
  type AgentRuntimeConfig,
} from "../../../src/agents/index.js";

import { RUNTIME_CLIENT_ID, runtimeCodex } from "./config.js";

export const RuntimeOutcomeSchema = z.object({
  status: z.literal("completed"),
  codeword: z.string(),
});

export type RuntimeOutcome = z.infer<typeof RuntimeOutcomeSchema>;

export function userMessage(text: string): UserMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

export function messageText(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function createRuntimeAgentRuntime(options: {
  hooks?: HookEntry[];
  taskCompletionTimeoutMs?: number;
} = {}): AgentRuntime {
  if (!runtimeCodex.available) {
    throw new Error("unreachable: the suite is skipped without credentials");
  }
  const config: AgentRuntimeConfig = {
    llmClients: {
      [RUNTIME_CLIENT_ID]: {
        client: runtimeCodex.createClient(),
        model: runtimeCodex.model,
        reasoningEffort: runtimeCodex.reasoningEffort,
      },
    },
  };
  if (options.hooks !== undefined) config.hooks = options.hooks;
  if (options.taskCompletionTimeoutMs !== undefined) {
    config.taskCompletionTimeoutMs = options.taskCompletionTimeoutMs;
  }
  return createAgentRuntime(config);
}

export function createRuntimeOutcomeAgent(options: {
  name: string;
  tools?: ToolDefinition[];
  hooks?: HookEntry[];
  agentHooks?: HookEntry[];
  systemPromptExtra?: string;
  maxTurns?: number;
  taskCompletionTimeoutMs?: number;
}): Agent<RuntimeOutcome> {
  const runtime = createRuntimeAgentRuntime({
    ...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
    ...(options.taskCompletionTimeoutMs !== undefined
      ? { taskCompletionTimeoutMs: options.taskCompletionTimeoutMs }
      : {}),
  });
  return runtime.createAgent<RuntimeOutcome>({
    name: options.name,
    llm: RUNTIME_CLIENT_ID,
    systemPrompt: runtimeSystemPrompt(options.systemPromptExtra),
    tools: options.tools ?? [],
    agentOutcomeFn: runtimeOutcomeFn(),
    maxTurns: options.maxTurns ?? 6,
    ...(options.agentHooks !== undefined ? { hooks: options.agentHooks } : {}),
  });
}

export function runtimeOutcomeFn() {
  return createAgentOutcomeFn({
    name: "submit_runtime_outcome",
    description:
      "Finish the runtime e2e by submitting {status:'completed', codeword}.",
    schema: RuntimeOutcomeSchema,
  });
}

export function runtimeSystemPrompt(extra?: string): string {
  return [
    "You are a terse runtime E2E agent.",
    "Follow the user's numbered instructions exactly and in order.",
    "Make at most one tool call per assistant turn unless the user explicitly asks for a batch.",
    "Do not write prose unless explicitly asked to wait.",
    extra,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
}

export function runtimeUserSteps(steps: readonly string[]): UserMessage {
  return userMessage(steps.join("\n"));
}
