import type { ToolDefinition } from "@ephai/agent-core";

export type ExtraToolProvider<TContext> = (context: TContext) => readonly ToolDefinition[];
