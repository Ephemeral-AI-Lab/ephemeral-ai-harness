import type { HookDecision, HookEntry } from "@ephai/agent-core";
import type { AgentHookFactories } from "@ephai/agent-engine/agents";
import { z } from "zod";

import { requireAdvisoryPass } from "../../.ephai/hooks/advisor-hook.js";
import { executeJsonCommand } from "../scripts/execute-json-command.js";
import { zodIssues } from "./diagnostics.js";
import { loadEntriesFile, withDefaultCwd } from "./entries-file.js";

/**
 * Host hook config: subprocess command hooks on the SDK's three events,
 * compiled into callbacks. The SDK never parses hook config; the host wraps
 * each command with the `executeJsonCommand` runner — facts JSON on stdin, a
 * verdict (or notification) on stdout. Notification *rules* are not a concept:
 * a `turnBoundary` hook publishes through the run notifier.
 */
const HookCommandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
});

const AdvisorHookModuleSchema = z.object({
  path: z.literal("advisor-hook.ts"),
  export: z.literal("requireAdvisoryPass").default("requireAdvisoryPass"),
});
const ToolMatcherSchema = z.object({ toolName: z.string().min(1) }).optional();

const HookConfigEntrySchema = z.union([
  z.object({ event: z.literal("preToolUse"), matcher: ToolMatcherSchema, command: HookCommandSchema }),
  z.object({ event: z.literal("postToolUse"), matcher: ToolMatcherSchema, command: HookCommandSchema }),
  z.object({
    event: z.literal("preToolUse"),
    hook: z.literal("advisor_approval"),
    module: AdvisorHookModuleSchema,
  }),
  z.object({ event: z.literal("turnBoundary"), command: HookCommandSchema }),
]);

type HookConfigEntry = z.infer<typeof HookConfigEntrySchema>;
type HookCommand = z.infer<typeof HookCommandSchema>;

const DecisionSchema = z.object({ decision: z.enum(["passthrough", "deny"]), reason: z.string().optional() });
const NotificationSchema = z.object({ notification: z.string().min(1).optional() });

export interface LoadedHookConfig {
  sdkHooks: HookEntry[];
  agentHooks: AgentHookFactories;
}

export function loadHookConfig(path: string): LoadedHookConfig {
  const entries = loadEntriesFile(
    path,
    "hook config",
    z.array(HookConfigEntrySchema),
    (entry, cwd) => ("command" in entry ? { ...entry, command: withDefaultCwd(entry.command, cwd) } : entry),
  );
  const sdkHooks: HookEntry[] = [];
  const agentHooks: AgentHookFactories = {};
  for (const entry of entries) {
    if ("hook" in entry) {
      if (agentHooks.advisorApproval !== undefined) {
        throw new Error(`hook config ${path} declares duplicate advisor_approval hooks`);
      }
      agentHooks.advisorApproval = compileAgentHook(entry);
    } else {
      sdkHooks.push(compileHook(entry));
    }
  }
  return { sdkHooks, agentHooks };
}

function compileAgentHook(entry: Extract<HookConfigEntry, { hook: "advisor_approval" }>) {
  // The module schema pins the process-local implementation. This is a host hook
  // factory, not a subprocess hook, because it closes over AdvisorPassRegistry.
  void entry.module;
  return requireAdvisoryPass;
}

function compileHook(entry: Exclude<HookConfigEntry, { hook: "advisor_approval" }>): HookEntry {
  if (entry.event === "turnBoundary") {
    return {
      event: "turnBoundary",
      run: async (turn, ctx) => {
        const parsed = await runCommand(entry.command, turn, NotificationSchema);
        if (parsed?.notification !== undefined) ctx.notifier.publish(parsed.notification);
      },
    };
  }
  const decide = async (facts: unknown): Promise<HookDecision> => {
    const parsed = await runCommand(entry.command, facts, DecisionSchema);
    if (parsed?.decision === "deny") {
      return { decision: "deny", reason: parsed.reason ?? "denied by hook" };
    }
    return { decision: "passthrough" };
  };
  return entry.event === "preToolUse"
    ? { event: "preToolUse", ...(entry.matcher && { matcher: entry.matcher }), run: (call) => decide(call) }
    : { event: "postToolUse", ...(entry.matcher && { matcher: entry.matcher }), run: (call) => decide(call) };
}

/** Run one hook command; a fault or unparseable stdout fails closed (deny/skip). */
async function runCommand<T>(
  command: HookCommand,
  payload: unknown,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const result = await executeJsonCommand(command, payload);
  if (result.kind !== "exited" || result.code !== 0) {
    throw new Error(
      `hook command "${command.command}" failed: ${result.kind === "exited" ? `exit ${String(result.code)} ${result.stderr}` : result.kind}`,
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed === "") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error(`hook command "${command.command}" produced non-JSON output`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`hook command "${command.command}" output is invalid: ${zodIssues(parsed.error)}`);
  }
  return parsed.data;
}
