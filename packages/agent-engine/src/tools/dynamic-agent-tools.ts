export interface DynamicAgentToolSelection {
  subagents?: readonly string[];
  advisor?: { prompt: string };
}
