import { describe, expect, it } from "vitest";

import { toolUseIdFrom } from "../../src/contracts/index.js";

import {
  Conversation,
  type ConversationEntry,
} from "../../src/agents/engine/conversation.js";

function fixture(): { conversation: Conversation; entries: ConversationEntry[] } {
  const entries: ConversationEntry[] = [];
  const conversation = new Conversation(
    [{ role: "user", content: [{ type: "text", text: "go" }] }],
    (entry) => {
      entries.push(entry);
    },
  );
  return { conversation, entries };
}

describe("Conversation", () => {
  it("seeds llm history from the initial messages and emits them as initial", () => {
    const { conversation, entries } = fixture();
    expect(conversation.llmMessages()).toHaveLength(1);
    expect(entries).toEqual([
      { kind: "user", origin: "initial", message: conversation.llmMessages()[0] },
    ]);
  });

  it("appends every conversation message to both history and the sink", () => {
    const { conversation, entries } = fixture();
    conversation.appendAssistant({ role: "assistant", content: [{ type: "text", text: "hi" }] });
    conversation.appendUser(
      { role: "user", content: [{ type: "text", text: "more" }] },
      "steer",
    );
    conversation.appendToolResults([
      { type: "tool_result", tool_use_id: toolUseIdFrom("t1"), content: "ok", is_error: false },
    ]);
    expect(conversation.llmMessages()).toHaveLength(4);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "tool_results",
    ]);
    expect(entries[2]).toMatchObject({ origin: "steer" });
  });

  it("wraps one batch's results as a single user message in order", () => {
    const { conversation } = fixture();
    conversation.appendToolResults([
      { type: "tool_result", tool_use_id: toolUseIdFrom("t1"), content: "a", is_error: false },
      { type: "tool_result", tool_use_id: toolUseIdFrom("t2"), content: "b", is_error: true },
    ]);
    const last = conversation.llmMessages().at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content.map((block) => block.type)).toEqual([
      "tool_result",
      "tool_result",
    ]);
  });

  it("keeps salvaged partials out of provider history but visible to the observer", () => {
    const { conversation, entries } = fixture();
    conversation.appendPartialAssistant(
      { role: "assistant", content: [{ type: "text", text: "half" }] },
      "interrupted",
    );
    expect(conversation.llmMessages(), "partials never reach the provider").toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({
      kind: "assistant_partial",
      reason: "interrupted",
    });
  });
});
