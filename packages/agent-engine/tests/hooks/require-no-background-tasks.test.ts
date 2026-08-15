import type { JsonObject, ToolCallFacts, ToolUseId } from "@ephai/agent-core";
import { describe, expect, it } from "vitest";

import { requireNoBackgroundTasks } from "../../src/agents/outcome-advisory.js";

function facts(input: JsonObject, backgroundTaskCount: number): ToolCallFacts {
  return {
    toolUseId: "tu-1" as ToolUseId,
    toolName: "submit_main_outcome",
    input,
    backgroundTaskCount,
  };
}

async function decide(gate: ReturnType<typeof requireNoBackgroundTasks>, call: ToolCallFacts) {
  if (gate.event !== "preToolUse") throw new Error("expected a preToolUse gate");
  return gate.run(call);
}

describe("requireNoBackgroundTasks", () => {
  it("passes terminal submissions when no background task is open", async () => {
    const gate = requireNoBackgroundTasks({ toolName: "submit_main_outcome" });

    await expect(decide(gate, facts({ summary: "done" }, 0))).resolves.toEqual({
      decision: "passthrough",
    });
  });

  it("denies terminal submissions while background tasks are open", async () => {
    const gate = requireNoBackgroundTasks({ toolName: "submit_main_outcome" });

    await expect(decide(gate, facts({ summary: "done" }, 2))).resolves.toEqual({
      decision: "deny",
      reason:
        "BLOCKED: 2 background task(s) still open for this run. " +
        "Use list_background_tasks and cancel_background_task before calling submit_main_outcome, then retry.",
    });
  });
});
