import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";

import {
  toolUseIdFrom,
  type JsonObject,
  type Message,
} from "../../contracts/index.js";
import type { LlmStreamEvent, StopReason } from "../events.js";
import type { UsageSnapshot } from "../types.js";
import { piAiMessageError } from "./errors.js";

function usageOf(message: AssistantMessage): UsageSnapshot {
  return {
    input_tokens: message.usage.input,
    output_tokens: message.usage.output,
    cache_read_input_tokens: message.usage.cacheRead,
    cache_creation_input_tokens: message.usage.cacheWrite,
  };
}

function stopReason(reason: Extract<AssistantMessageEvent, { type: "done" }>['reason']): StopReason {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "toolUse":
      return "tool_use";
    case "stop":
      return "end_turn";
  }
}

function toMessage(message: AssistantMessage): Message {
  const content: Message["content"] = [];
  for (const block of message.content) {
    switch (block.type) {
      case "text":
        content.push({ type: "text", text: block.text });
        break;
      case "thinking":
        content.push({ type: "reasoning", text: block.thinking });
        break;
      case "toolCall":
        content.push({
          type: "tool_use",
          tool_use_id: toolUseIdFrom(block.id),
          name: block.name,
          input: block.arguments as JsonObject,
        });
        break;
    }
  }
  return {
    role: "assistant",
    content,
  };
}

export class PiAiStreamDecoder {
  #completed = false;

  get completed(): boolean {
    return this.#completed;
  }

  handle(event: AssistantMessageEvent): Iterable<LlmStreamEvent> {
    switch (event.type) {
      case "text_delta":
        return event.delta.length > 0
          ? [{ type: "assistant_text_delta", text: event.delta }]
          : [];
      case "thinking_delta":
        return event.delta.length > 0
          ? [{ type: "reasoning_delta", text: event.delta }]
          : [];
      case "toolcall_end":
        return [
          {
            type: "tool_use_delta",
            tool_use_id: toolUseIdFrom(event.toolCall.id),
            name: event.toolCall.name,
            input: event.toolCall.arguments as JsonObject,
          },
        ];
      case "done":
        this.#completed = true;
        return [
          {
            type: "assistant_message_complete",
            message: toMessage(event.message),
            usage: usageOf(event.message),
            stop_reason: stopReason(event.reason),
          },
        ];
      case "error":
        throw piAiMessageError(event.error.errorMessage ?? "pi-ai stream failed");
      default:
        return [];
    }
  }
}
