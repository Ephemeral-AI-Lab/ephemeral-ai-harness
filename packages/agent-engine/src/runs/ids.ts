import { randomUUID } from "node:crypto";

type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type AgentRunId = Brand<string, "AgentRunId">;

export function agentRunIdFrom(value: string): AgentRunId {
  return value as AgentRunId;
}

export function mintAgentRunId(): AgentRunId {
  return agentRunIdFrom(`agent-${randomUUID()}`);
}
