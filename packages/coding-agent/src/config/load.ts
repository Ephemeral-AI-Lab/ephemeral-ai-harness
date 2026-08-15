import { dirname, join, resolve } from "node:path";

import type { HookEntry, LlmClientConfig } from "@ephai/agent-core";
import type { AgentProfileRegistry } from "@ephai/agent-engine/agents";

import { loadAgentProfiles } from "./agent-profiles.js";
import { loadHookConfig } from "./hook-config.js";
import { loadLlmClients } from "./llm-client-config.js";

/**
 * The single composition-root config value: every host config parsed into the
 * shapes the core and engine wiring consume. `configRoot` is the absolute
 * `.ephai` directory (from `ephaiConfigRoot()`); per-path resolution of
 * scripts/store/context stays in their consumers, keyed off the config base.
 */
export interface CodingAgentConfig {
  configBaseDir: string;
  llmClients: LlmClientConfig;
  hooks: HookEntry[];
  recordsDir: string;
  profiles: AgentProfileRegistry;
}

export function loadCodingAgentConfig(configRoot: string): CodingAgentConfig {
  const root = resolve(configRoot);
  const configBaseDir = dirname(root);
  const hooks = loadHookConfig(join(root, "hooks", "hooks.json"));
  return {
    configBaseDir,
    llmClients: loadLlmClients(join(root, "llm-clients", "llm-clients.json")),
    hooks: hooks.sdkHooks,
    recordsDir: join(root, "runs"),
    profiles: loadAgentProfiles({ agentsDir: join(root, "agents") }),
  };
}
