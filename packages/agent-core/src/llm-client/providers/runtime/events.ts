import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";

import type { Message, ToolUseId } from "../../../contracts/index.js";
import { ProviderError } from "../../errors.js";
import type { LlmStreamEvent, StopReason } from "../../events.js";
import type { UsageSnapshot } from "../../types.js";
import type { StreamDecoder } from "../provider.js";

/** Convert pi-ai's event stream into the agent-core stream contract. */
export class PiStreamDecoder implements StreamDecoder<unknown> {
  #completed = false;

  get completed(): boolean {
    return this.#completed;
  }

  handle(raw: unknown): Iterable<LlmStreamEvent> {
    if (!isAssistantMessageEvent(raw)) {
      throw new ProviderError("decode", "invalid pi-ai stream event");
    }

    switch (raw.type) {
      case "text_delta":
        return [{ type: "assistant_text_delta", text: raw.delta }];
      case "thinking_delta":
        return [{ type: "reasoning_delta", text: raw.delta }];
      case "toolcall_end":
        return [
          {
            type: "tool_use_delta",
            tool_use_id: raw.toolCall.id as ToolUseId,
            name: raw.toolCall.name,
            input: raw.toolCall.arguments,
          },
        ];
      case "done":
        if (this.#completed) {
          throw new ProviderError("decode", "duplicate pi-ai completion");
        }
        this.#completed = true;
        return [toCompletionEvent(raw.message, raw.reason)];
      case "error":
        throw new ProviderError(
          raw.reason === "aborted" ? "transport" : "request",
          raw.error.errorMessage ?? "pi-ai provider stream failed",
        );
      default:
        return [];
    }
  }
}

function toCompletionEvent(
  message: AssistantMessage,
  reason: Extract<AssistantMessageEvent, { type: "done" }>["reason"],
): LlmStreamEvent {
  return {
    type: "assistant_message_complete",
    message: toMessage(message),
    usage: toUsage(message),
    stop_reason: toStopReason(reason),
  };
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
          tool_use_id: block.id as ToolUseId,
          name: block.name,
          input: block.arguments,
        });
        break;
    }
  }
  return { role: "assistant", content };
}

function toUsage(message: AssistantMessage): UsageSnapshot {
  return {
    input_tokens: message.usage.input,
    output_tokens: message.usage.output,
    ...(message.usage.cacheRead > 0
      ? { cache_read_input_tokens: message.usage.cacheRead }
      : {}),
    ...(message.usage.cacheWrite > 0
      ? { cache_creation_input_tokens: message.usage.cacheWrite }
      : {}),
  };
}

function toStopReason(reason: "stop" | "length" | "toolUse"): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "toolUse":
      return "tool_use";
  }
}

function isAssistantMessageEvent(value: unknown): value is AssistantMessageEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}
