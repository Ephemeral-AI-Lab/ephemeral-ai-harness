import {
  builtinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import type {
  Api,
  AssistantMessage,
  Model as PiModel,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { toolUseIdFrom } from "../../../src/contracts/ids.js";
import { ProviderConnectionSchema } from "../../../src/llm-client/providers/connection.js";
import { createProvider } from "../../../src/llm-client/providers/registry.js";
import { toPiContext } from "../../../src/llm-client/providers/runtime/context.js";
import { PiStreamDecoder } from "../../../src/llm-client/providers/runtime/events.js";
import { buildLlmRequest } from "../../../src/llm-client/types.js";

function catalogModel(): PiModel<Api> {
  const models = builtinModels();
  const model = models.getModels("anthropic").at(0);
  if (model === undefined) throw new Error("anthropic catalog is empty");
  return model;
}

const assistantMessage: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "text", text: "done" },
    {
      type: "toolCall",
      id: "call_1",
      name: "read_file",
      arguments: { path: "a.txt" },
    },
  ],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-test",
  usage: {
    input: 4,
    output: 6,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 10,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: 1,
};

describe("pi-ai catalog runtime", () => {
  it("accepts every built-in provider through our connection schema", () => {
    for (const provider of getBuiltinProviders()) {
      expect(
        ProviderConnectionSchema.safeParse({ provider, api_key: "secret" })
          .success,
        provider,
      ).toBe(true);
    }
    expect(
      ProviderConnectionSchema.safeParse({ provider: "not-a-provider", api_key: "k" })
        .success,
    ).toBe(false);
  });

  it("constructs a catalog-backed provider for every built-in provider", () => {
    for (const provider of getBuiltinProviders()) {
      expect(() => createProvider({ provider, api_key: "secret" })).not.toThrow(
        provider,
      );
    }
  });

  it("maps our history and tools into pi-ai context", () => {
    const id = toolUseIdFrom("call_1");
    const context = toPiContext(
      buildLlmRequest({
        model: "claude-test",
        system_prompt: "be concise",
        messages: [
          { role: "user", content: [{ type: "text", text: "read a.txt" }] },
          {
            role: "assistant",
            content: [
              { type: "tool_use", tool_use_id: id, name: "read_file", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content: "body",
                is_error: false,
              },
            ],
          },
        ],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: { type: "object" },
          },
        ],
      }),
      catalogModel(),
    );

    expect(context.systemPrompt).toBe("be concise");
    expect(context.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(context.messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read_file",
      isError: false,
    });
    expect(context.tools?.[0]?.name).toBe("read_file");
  });

  it("maps pi-ai deltas and completion back to our stream contract", () => {
    const decoder = new PiStreamDecoder();
    const text = [
      ...decoder.handle({ type: "text_delta", delta: "hello" }),
    ];
    const tool = [
      ...decoder.handle({
        type: "toolcall_end",
        toolCall: assistantMessage.content[1],
      }),
    ];
    const complete = [
      ...decoder.handle({
        type: "done",
        reason: "toolUse",
        message: assistantMessage,
      }),
    ];

    expect(text).toEqual([{ type: "assistant_text_delta", text: "hello" }]);
    expect(tool).toEqual([
      {
        type: "tool_use_delta",
        tool_use_id: toolUseIdFrom("call_1"),
        name: "read_file",
        input: { path: "a.txt" },
      },
    ]);
    expect(complete).toMatchObject([
      {
        type: "assistant_message_complete",
        usage: {
          input_tokens: 4,
          output_tokens: 6,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
        stop_reason: "tool_use",
      },
    ]);
    expect(decoder.completed).toBe(true);
  });
});
