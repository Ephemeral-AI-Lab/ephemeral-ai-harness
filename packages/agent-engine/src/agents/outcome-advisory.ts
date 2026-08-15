import {
  createAgentOutcomeFn,
  type AgentOutcomeFn,
  type HookEntry,
  type JsonObject,
  type SubmitCtx,
} from "@ephai/agent-core";
import type { z } from "zod";

import type { AgentRunId } from "../runs/index.js";

/** The exact terminal submission an advisor pass is keyed to. */
export interface AdvisorSubmission {
  tool_name: string;
  payload: JsonObject;
}

/**
 * In-memory, per-run record of advisor passes. The gate consults it; the
 * `ask_advisor` tool records into it. Keyed by `runId`, matched by
 * canonical-JSON deep equality of `{ tool_name, payload }`.
 */
export class AdvisorPassRegistry {
  readonly #passes = new Map<string, Set<string>>();

  recordPass(runId: AgentRunId, submission: AdvisorSubmission): void {
    const key = canonicalJson(submission);
    const existing = this.#passes.get(runId);
    if (existing) existing.add(key);
    else this.#passes.set(runId, new Set([key]));
  }

  hasPass(runId: AgentRunId, submission: AdvisorSubmission): boolean {
    return this.#passes.get(runId)?.has(canonicalJson(submission)) ?? false;
  }
}

/** Deterministic JSON with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export interface AgentHookFactories {
  advisorApproval?: (opts: {
    agentRunId: AgentRunId;
    toolName: string;
    passes: AdvisorPassRegistry;
  }) => HookEntry;
}

/**
 * Host-owned terminal binding: the SDK outcome contract plus the advisory
 * prompt that guards its submissions.
 */
export interface AgentOutcomeFnWithAdvisory<T> {
  kind: "with_advisory";
  outcomeFn: AgentOutcomeFn<T>;
  advisoryPrompt: string;
}

export function withAdvisory<T>(
  outcomeFn: AgentOutcomeFn<T>,
  advisoryPrompt: string,
): AgentOutcomeFnWithAdvisory<T> {
  return { kind: "with_advisory", outcomeFn, advisoryPrompt };
}

export function createAgentOutcomeFnWithAdvisory<T>(spec: {
  name: string;
  description?: string;
  schema: z.ZodType<T>;
  onSubmit?: (payload: T, ctx: SubmitCtx) => Promise<{ accept: T } | { reject: string }>;
  advisoryPrompt: string;
}): AgentOutcomeFnWithAdvisory<T> {
  const { advisoryPrompt, ...outcome } = spec;
  return withAdvisory(createAgentOutcomeFn(outcome), advisoryPrompt);
}

export function requireNoBackgroundTasks(opts: { toolName: string }): HookEntry {
  return {
    event: "preToolUse",
    matcher: { toolName: opts.toolName },
    run: (facts) => {
      if (facts.backgroundTaskCount === 0) return { decision: "passthrough" };
      return {
        decision: "deny",
        reason:
          `BLOCKED: ${String(facts.backgroundTaskCount)} background task(s) still open for this run. ` +
          `Use list_background_tasks and cancel_background_task before calling ${facts.toolName}, then retry.`,
      };
    },
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, child]) => [key, sortKeys(child)]));
  }
  return value;
}
