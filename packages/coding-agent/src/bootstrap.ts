import { createAgentRuntime } from "@ephai/agent-core";
import {
  type Agent,
  buildAgentFactory,
  createAgentOutcomeFnWithAdvisory,
  type AgentFactory,
} from "@ephai/agent-engine/agents";
import { JsonlAgentRunStore } from "@ephai/agent-engine/runs";
import { z } from "zod";

import { loadCodingAgentConfig } from "./config/load.js";
import { ephaiConfigRoot } from "./config/config-root.js";

const MainOutcomeSchema = z.object({ summary: z.string().min(1) });
type MainOutcome = z.infer<typeof MainOutcomeSchema>;

const SUBMIT_MAIN_DESCRIPTION =
  "Finish the operator run by submitting its final outcome summary.";
const MAIN_ADVISOR_PROMPT =
  "Review whether the operator's terminal submission faithfully completes the user's goal.";

export interface CodingAgent {
  agents: AgentFactory;
  operator: Agent<MainOutcome>;
}

/**
 * The composition root: build each value once and wire only public SDK values.
 * Config parsing lives in the coding-agent package. The engine receives parsed
 * profiles and stores.
 */
export function bootstrap(configRoot: string = ephaiConfigRoot()): CodingAgent {
  const cfg = loadCodingAgentConfig(configRoot);

  const agentRuntime = createAgentRuntime({
    llmClients: cfg.llmClients,
    hooks: cfg.hooks,
  });
  const agentRunStore = new JsonlAgentRunStore(cfg.recordsDir);

  const agents = buildAgentFactory({
    agentRuntime,
    profiles: cfg.profiles,
    agentRunStore,
    agentHooks: cfg.agentHooks,
  });

  const mainOutcomeFn = createAgentOutcomeFnWithAdvisory({
    name: "submit_main_outcome",
    description: SUBMIT_MAIN_DESCRIPTION,
    schema: MainOutcomeSchema,
    advisoryPrompt: MAIN_ADVISOR_PROMPT,
  });

  const operator = agents.create("operator", mainOutcomeFn);
  return { agents, operator };
}
