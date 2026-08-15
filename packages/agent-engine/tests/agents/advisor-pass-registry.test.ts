import type { HookEntry, JsonObject, ToolCallFacts, ToolUseId } from "@ephai/agent-core";
import { describe, expect, it } from "vitest";

import { AdvisorPassRegistry } from "../../src/agents/outcome-advisory.js";
import type { AgentRunId } from "../../src/runs/index.js";

const RUN = "run-1" as AgentRunId;

function facts(input: JsonObject): ToolCallFacts {
  return {
    toolUseId: "tu-1" as ToolUseId,
    toolName: "submit_main_outcome",
    input,
    backgroundTaskCount: 0,
  };
}

function requireAdvisoryPass(opts: {
  agentRunId: AgentRunId;
  toolName: string;
  passes: AdvisorPassRegistry;
}): HookEntry {
  return {
    event: "preToolUse",
    matcher: { toolName: opts.toolName },
    run: (facts) =>
      opts.passes.hasPass(opts.agentRunId, {
        tool_name: facts.toolName,
        payload: facts.input,
      })
        ? { decision: "passthrough" }
        : { decision: "deny", reason: "advisor has not passed this terminal submission" },
  };
}

async function decide(gate: HookEntry, call: ToolCallFacts) {
  if (gate.event !== "preToolUse") throw new Error("expected a preToolUse gate");
  return gate.run(call);
}

describe("advisor pass registry and gate", () => {
  it("denies a terminal submission until the exact submission has passed", async () => {
    const passes = new AdvisorPassRegistry();
    const gate = requireAdvisoryPass({ agentRunId: RUN, toolName: "submit_main_outcome", passes });

    expect(await decide(gate, facts({ summary: "done" }))).toMatchObject({ decision: "deny" });

    passes.recordPass(RUN, { tool_name: "submit_main_outcome", payload: { summary: "done" } });
    expect(await decide(gate, facts({ summary: "done" }))).toEqual({ decision: "passthrough" });
  });

  it("matches by canonical payload, not key order, and rejects a different payload", async () => {
    const passes = new AdvisorPassRegistry();
    const gate = requireAdvisoryPass({ agentRunId: RUN, toolName: "submit_main_outcome", passes });
    passes.recordPass(RUN, { tool_name: "submit_main_outcome", payload: { a: 1, b: 2 } });

    expect(await decide(gate, facts({ b: 2, a: 1 })), "key order is irrelevant").toEqual({
      decision: "passthrough",
    });
    expect(await decide(gate, facts({ a: 1, b: 3 })), "a different payload is not authorized").toMatchObject({
      decision: "deny",
    });
  });

  it("scopes passes per run", () => {
    const passes = new AdvisorPassRegistry();
    passes.recordPass(RUN, { tool_name: "submit_main_outcome", payload: { x: 1 } });
    expect(passes.hasPass("run-2" as AgentRunId, { tool_name: "submit_main_outcome", payload: { x: 1 } })).toBe(false);
  });
});
