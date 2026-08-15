import type { HookEntry } from "@ephai/agent-core";

import type { AdvisorPassRegistry } from "@ephai/agent-engine/agents";
import type { AgentRunId } from "@ephai/agent-engine/runs";

/**
 * Deny a terminal submission until the advisor has approved the exact payload.
 */
export function requireAdvisoryPass(opts: {
  agentRunId: AgentRunId;
  toolName: string;
  passes: AdvisorPassRegistry;
}): HookEntry {
  return {
    event: "preToolUse",
    matcher: { toolName: opts.toolName },
    run: (facts) =>
      opts.passes.hasPass(opts.agentRunId, { tool_name: facts.toolName, payload: facts.input })
        ? { decision: "passthrough" }
        : {
            decision: "deny",
            reason: `advisor has not passed this ${facts.toolName} submission; call ask_advisor with the intended payload first`,
          },
  };
}
