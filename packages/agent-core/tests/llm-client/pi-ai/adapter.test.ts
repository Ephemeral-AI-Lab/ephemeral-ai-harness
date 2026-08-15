import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { buildLlmRequest } from "../../../src/llm-client/types.js";
import { createLlmClient } from "../../../src/llm-client/factory.js";
import { createPiAiClientForModels } from "../../../src/llm-client/pi-ai/adapter.js";
import { SecretString } from "../../../src/llm-client/secret.js";
import type { LlmStreamEvent } from "../../../src/llm-client/events.js";
import { toolUseIdFrom } from "../../../src/contracts/index.js";

async function collect(stream: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function testClient() {
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "faux-model", reasoning: true }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, client: createPiAiClientForModels(models, "faux", new SecretString("test"), {
    retry: { max_retries: 0, base_delay_s: 0, max_delay_s: 0 },
  }) };
}

describe("pi-ai LlmClient adapter", () => {
  it("is constructible through the public pi_ai connection profile", () => {
    expect(
      createLlmClient({
        provider: "pi_ai",
        route: "deepseek",
        api_key: "test-key",
      }),
    ).toBeDefined();
  });

  it("normalizes text, reasoning, tool calls, usage, and terminal events", async () => {
    const { faux, client } = testClient();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("think first"),
          fauxText("hello"),
          fauxToolCall("read_file", { path: "foo.txt" }, { id: "call_1" }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);

    const events = await collect(
      client.streamMessage(
        buildLlmRequest({
          model: "faux-model",
          reasoning_effort: "low",
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              input_schema: { type: "object" },
            },
          ],
          tool_choice: "any",
        }),
      ),
    );

    expect(events).toEqual([
      { type: "reasoning_delta", text: "think first" },
      { type: "assistant_text_delta", text: "hello" },
      {
        type: "tool_use_delta",
        tool_use_id: "call_1",
        name: "read_file",
        input: { path: "foo.txt" },
      },
      expect.objectContaining({
        type: "assistant_message_complete",
        stop_reason: "tool_use",
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "think first" },
            { type: "text", text: "hello" },
            {
              type: "tool_use",
              tool_use_id: "call_1",
              name: "read_file",
              input: { path: "foo.txt" },
            },
          ],
        },
      }),
    ]);
  });

  it("converts prior tool results into pi-ai context messages", async () => {
    const { faux, client } = testClient();
    faux.setResponses([
      (context) => {
        expect(context.messages).toHaveLength(3);
        expect(context.messages[0]).toMatchObject({ role: "user", content: "read foo.txt" });
        expect(context.messages[1]).toMatchObject({ role: "assistant" });
        expect(context.messages[2]).toMatchObject({
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "read_file",
        });
        return fauxAssistantMessage(fauxText("done"));
      },
    ]);

    const events = await collect(
      client.streamMessage(
        buildLlmRequest({
          model: "faux-model",
          messages: [
            { role: "user", content: [{ type: "text", text: "read foo.txt" }] },
            {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  tool_use_id: toolUseIdFrom("call_1"),
                  name: "read_file",
                  input: { path: "foo.txt" },
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseIdFrom("call_1"),
                  content: "file body",
                  is_error: false,
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(events.at(-1)).toMatchObject({
      type: "assistant_message_complete",
      message: { content: [{ type: "text", text: "done" }] },
    });
  });
});
