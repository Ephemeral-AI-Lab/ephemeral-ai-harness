import type {
  AssistantMessage,
  Context,
  Message as PiMessage,
  Model as PiModel,
  Tool as PiTool,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

import type {
  ContentBlock,
  Message,
  ToolSpec,
} from "../../../contracts/index.js";
import type { LlmRequest } from "../../types.js";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Convert our neutral request into pi-ai's private context representation. */
export function toPiContext(request: LlmRequest, model: PiModel): Context {
  const toolNames = new Map<string, string>();
  const messages: PiMessage[] = [];

  for (const message of request.messages) {
    if (message.role === "assistant") {
      messages.push(toPiAssistantMessage(message, model, toolNames));
      continue;
    }
    appendUserMessage(messages, message, toolNames);
  }

  return {
    ...(request.system_prompt === undefined
      ? {}
      : { systemPrompt: request.system_prompt }),
    messages,
    ...(request.tools.length === 0
      ? {}
      : { tools: request.tools.map(toPiTool) }),
  };
}

function appendUserMessage(
  messages: PiMessage[],
  message: Message,
  toolNames: ReadonlyMap<string, string>,
): void {
  let text: { type: "text"; text: string }[] = [];
  const flushText = (): void => {
    if (text.length === 0) return;
    messages.push({
      role: "user",
      content: text,
      timestamp: Date.now(),
    });
    text = [];
  };

  for (const block of message.content) {
    if (block.type === "text" || block.type === "reasoning") {
      text.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "tool_result") {
      flushText();
      messages.push(toPiToolResult(block, toolNames));
    }
  }
  flushText();
}

function toPiAssistantMessage(
  message: Extract<Message, { role: "assistant" }>,
  model: PiModel,
  toolNames: Map<string, string>,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  let hasToolCall = false;

  for (const block of message.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "reasoning") {
      content.push({ type: "thinking", thinking: block.text });
    } else if (block.type === "tool_use") {
      hasToolCall = true;
      toolNames.set(block.tool_use_id, block.name);
      const toolCall: ToolCall = {
        type: "toolCall",
        id: block.tool_use_id,
        name: block.name,
        arguments: block.input,
      };
      content.push(toolCall);
    }
  }

  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: hasToolCall ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function toPiToolResult(
  block: Extract<ContentBlock, { type: "tool_result" }>,
  toolNames: ReadonlyMap<string, string>,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: block.tool_use_id,
    toolName: toolNames.get(block.tool_use_id) ?? "unknown_tool",
    content: [{ type: "text", text: block.content }],
    isError: block.is_error,
    timestamp: Date.now(),
  };
}

function toPiTool(spec: ToolSpec): PiTool {
  return {
    name: spec.name,
    description: spec.description,
    // Our schema is already JSON Schema; pi-ai's ToolBox type is structural.
    parameters: spec.input_schema as PiTool["parameters"],
  };
}
