import type {
  AssistantMessage,
  Context,
  Message as PiMessage,
  Tool,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

import { toolUseIdFrom, type Message, type ToolSpec } from "../../contracts/index.js";
import type { LlmRequest } from "../types.js";

function textBlocks(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toTool(block: ToolSpec): Tool {
  return {
    name: block.name,
    description: block.description,
    parameters: block.input_schema,
  };
}

function toAssistantMessage(
  message: Message,
  model: { api: AssistantMessage["api"]; provider: string; id: string },
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  for (const block of message.content) {
    switch (block.type) {
      case "text":
        content.push({ type: "text", text: block.text });
        break;
      case "reasoning":
        content.push({ type: "thinking", thinking: block.text });
        break;
      case "tool_use":
        content.push({
          type: "toolCall",
          id: toolUseIdFrom(block.tool_use_id),
          name: block.name,
          arguments: block.input,
        });
        break;
      case "tool_result":
        break;
    }
  }

  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function toUserMessage(message: Message): UserMessage | undefined {
  const text = textBlocks(message);
  if (text.length === 0 && message.content.every((block) => block.type === "tool_result")) {
    return undefined;
  }
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
}

function toToolResultMessage(
  block: Extract<Message["content"][number], { type: "tool_result" }>,
  toolName: string,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolUseIdFrom(block.tool_use_id),
    toolName,
    content: [{ type: "text", text: block.content }],
    isError: block.is_error,
    timestamp: Date.now(),
  };
}

function toPiMessages(
  messages: Message[],
  model: { api: AssistantMessage["api"]; provider: string; id: string },
): PiMessage[] {
  const toolNames = new Map<string, string>();
  const result: PiMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "tool_use") toolNames.set(block.tool_use_id, block.name);
      }
      result.push(toAssistantMessage(message, model));
      continue;
    }

    const user = toUserMessage(message);
    if (user) result.push(user);
    for (const block of message.content) {
      if (block.type === "tool_result") {
        result.push(toToolResultMessage(block, toolNames.get(block.tool_use_id) ?? "tool"));
      }
    }
  }

  return result;
}

export function toPiContext(
  request: LlmRequest,
  model: { api: AssistantMessage["api"]; provider: string; id: string },
): Context {
  return {
    ...(request.system_prompt !== undefined && {
      systemPrompt: request.system_prompt,
    }),
    messages: toPiMessages(request.messages, model),
    tools: request.tools.map(toTool),
  };
}
