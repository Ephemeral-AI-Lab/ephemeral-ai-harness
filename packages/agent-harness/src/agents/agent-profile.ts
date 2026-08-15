export interface AgentProfile {
  name: string;
  llm_client_id: string;
  description?: string;
  max_turns?: number;
  allowed_tools: readonly string[];
  subagents: readonly string[];
  system_prompt: string;
  source_path: string;
}

export interface AgentProfileRegistry {
  require(name: string): AgentProfile;
  list(): readonly AgentProfile[];
}
