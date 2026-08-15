import { randomUUID } from "node:crypto";

import {
  type Agent,
  defineTool,
  type AgentOutcome,
  type BackgroundTaskOutcome,
  type ToolDefinition,
} from "@ephai/agent-core";
import { z } from "zod";

export type SubagentResolver = (agentName: string) => Agent;

/**
 * Start another agent by name. The host supplies the name allow-list and the
 * resolver, so this tool does not own profiles, agent factories, or run IDs.
 * Foreground (`wait`) returns the outcome; background registers exactly one
 * task whose `onCompletion` is the only completion publisher.
 */
export function runSubagent(
  resolveAgent: SubagentResolver,
  subagents: readonly [string, ...string[]],
): ToolDefinition {
  return defineTool({
    name: "run_subagent",
    description: "Run another configured agent.",
    input: z.object({
      agent_name: z.enum(subagents),
      prompt: z.string().min(1),
      wait: z.boolean().default(true),
    }),
    execute: async (input, ctx) => {
      const child = resolveAgent(input.agent_name);
      const run = child.start({
        messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }],
      });
      ctx.signal.addEventListener("abort", () => {
        run.interrupt();
      });

      if (input.wait) {
        return { output: renderAgentOutcome(await run.outcome()) };
      }

      const taskId = randomUUID();
      ctx.backgroundTaskSupervisor.register({
        tag: { type: "subagent", id: taskId },
        title: `${input.agent_name}: ${input.prompt.slice(0, 80)}`,
        cancel: () => {
          run.interrupt();
        },
        done: run.outcome().then(toBackgroundTaskOutcome),
        onCompletion: (out, { notifier }) => {
          notifier.publish(renderSubagentCompletion(input.agent_name, taskId, out), {
            key: `subagent:${taskId}`,
          });
        },
      });
      return { output: `subagent started: ${taskId}` };
    },
  });
}

function toBackgroundTaskOutcome(outcome: AgentOutcome): BackgroundTaskOutcome {
  if (outcome.status === "completed") return { status: "success", outcome: outcome.outcome.slice(0, 280) };
  if (outcome.status === "cancelled") return { status: "cancelled", outcome: "cancelled" };
  return { status: "failed", outcome: outcome.error.message };
}

function renderAgentOutcome(outcome: AgentOutcome): string {
  if (outcome.status === "completed") return outcome.outcome;
  if (outcome.status === "cancelled") return "subagent cancelled";
  return `subagent failed: ${outcome.error.message}`;
}

function renderSubagentCompletion(
  agentName: string,
  taskId: string,
  out: BackgroundTaskOutcome,
): string {
  return `subagent ${agentName} (${taskId}) ${out.status}: ${out.outcome}`;
}
