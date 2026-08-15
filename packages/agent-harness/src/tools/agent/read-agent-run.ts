import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import { agentRunIdFrom, type AgentRunStore } from "../../runs/index.js";

/**
 * Read a run's host-recorded events by run id, paged by line. Coding-agent
 * owns these records; the SDK only emits the live stream consumed by the store.
 */
export function readAgentRun(agentRunStore: AgentRunStore): ToolDefinition {
  return defineTool({
    name: "read_agent_run",
    description: "Read an agent run's recorded events by run id.",
    input: z.object({
      run_id: z.string().min(1),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().positive().max(500).default(100),
    }),
    execute: async (input) => {
      const page = await agentRunStore.readEvents({
        agentRunId: agentRunIdFrom(input.run_id),
        offset: input.offset,
        limit: input.limit,
      });
      if (page.total === 0) return { error: `no records for run "${input.run_id}"` };
      return Promise.resolve({
        output: {
          total: page.total,
          offset: input.offset,
          lines: page.lines,
          eof: page.eof,
        },
      });
    },
  });
}
