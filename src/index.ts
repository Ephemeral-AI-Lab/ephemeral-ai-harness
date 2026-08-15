export type AgentRole = "assistant" | "system" | "tool" | "user";

export interface AgentMessage {
  readonly content: string;
  readonly name?: string;
  readonly role: AgentRole;
  readonly toolCallId?: string;
}

export interface AgentToolContext {
  readonly signal?: AbortSignal;
}

export interface AgentTool {
  readonly description?: string;
  execute(input: unknown, context: AgentToolContext): unknown | Promise<unknown>;
  readonly name: string;
}

export interface AgentToolDefinition {
  readonly description?: string;
  readonly name: string;
}

export interface AgentToolCall {
  readonly id: string;
  readonly input: unknown;
  readonly name: string;
}

export interface ModelRequest {
  readonly messages: readonly AgentMessage[];
  readonly signal?: AbortSignal;
  readonly tools: readonly AgentToolDefinition[];
}

export interface ModelResponse {
  readonly finishReason?: "length" | "stop" | "tool-call";
  readonly message: AgentMessage & { readonly role: "assistant" };
  readonly toolCalls?: readonly AgentToolCall[];
}

export interface AgentModel {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export type AgentRunEvent =
  | {
      readonly messages: readonly AgentMessage[];
      readonly type: "model.request";
    }
  | {
      readonly response: ModelResponse;
      readonly type: "model.response";
    }
  | {
      readonly toolCall: AgentToolCall;
      readonly type: "tool.start";
    }
  | {
      readonly error?: Error;
      readonly result?: unknown;
      readonly toolCall: AgentToolCall;
      readonly type: "tool.end";
    }
  | {
      readonly result: AgentRunResult;
      readonly type: "run.complete";
    };

export interface AgentRunOptions {
  readonly maxSteps?: number;
  readonly onEvent?: (event: AgentRunEvent) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly messages: readonly AgentMessage[];
  readonly output: string;
  readonly steps: number;
}

export interface AgentOptions {
  readonly instructions?: string;
  readonly maxSteps?: number;
  readonly model: AgentModel;
  readonly name?: string;
  readonly tools?: readonly AgentTool[];
}

export class AgentMaxStepsError extends Error {
  readonly code = "AGENT_MAX_STEPS" as const;

  constructor(maxSteps: number) {
    super(`Agent reached its maximum of ${maxSteps} model step${maxSteps === 1 ? "" : "s"}.`);
    this.name = "AgentMaxStepsError";
  }
}

export class AgentToolNotFoundError extends Error {
  readonly code = "AGENT_TOOL_NOT_FOUND" as const;

  constructor(toolName: string) {
    super(`Agent requested unknown tool \"${toolName}\".`);
    this.name = "AgentToolNotFoundError";
  }
}

/**
 * A small provider-neutral agent runtime.
 *
 * The model owns generation, while this class owns message history, tool
 * dispatch, cancellation, and the bounded tool loop.
 */
export class Agent {
  readonly instructions?: string;
  readonly model: AgentModel;
  readonly name?: string;
  readonly tools: readonly AgentTool[];

  private readonly toolByName: ReadonlyMap<string, AgentTool>;
  private readonly defaultMaxSteps: number;

  constructor(options: AgentOptions) {
    const maxSteps = options.maxSteps ?? 8;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError("maxSteps must be a positive integer.");
    }

    const tools = [...(options.tools ?? [])];
    const toolByName = new Map<string, AgentTool>();
    for (const tool of tools) {
      if (!tool.name.trim()) {
        throw new Error("Agent tools must have a non-empty name.");
      }
      if (toolByName.has(tool.name)) {
        throw new Error(`Agent tool names must be unique: \"${tool.name}\".`);
      }
      toolByName.set(tool.name, tool);
    }

    this.defaultMaxSteps = maxSteps;
    this.instructions = options.instructions;
    this.model = options.model;
    this.name = options.name;
    this.tools = tools;
    this.toolByName = toolByName;
  }

  async run(input: string | readonly AgentMessage[], options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? this.defaultMaxSteps;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError("maxSteps must be a positive integer.");
    }

    const messages: AgentMessage[] = [];
    if (this.instructions) {
      messages.push({ content: this.instructions, role: "system" });
    }
    if (typeof input === "string") {
      messages.push({ content: input, role: "user" });
    } else {
      messages.push(...input);
    }

    for (let step = 1; step <= maxSteps; step += 1) {
      throwIfAborted(options.signal);
      await emit(options.onEvent, { messages: [...messages], type: "model.request" });

      const response = await this.model.generate({
        messages: [...messages],
        signal: options.signal,
        tools: this.tools.map(({ description, name }) => ({ description, name })),
      });
      throwIfAborted(options.signal);
      await emit(options.onEvent, { response, type: "model.response" });
      messages.push(response.message);

      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const result: AgentRunResult = {
          messages: [...messages],
          output: response.message.content,
          steps: step,
        };
        await emit(options.onEvent, { result, type: "run.complete" });
        return result;
      }

      for (const toolCall of toolCalls) {
        throwIfAborted(options.signal);
        await emit(options.onEvent, { toolCall, type: "tool.start" });

        const tool = this.toolByName.get(toolCall.name);
        if (!tool) {
          const error = new AgentToolNotFoundError(toolCall.name);
          messages.push({
            content: JSON.stringify({ error: error.message }),
            name: toolCall.name,
            role: "tool",
            toolCallId: toolCall.id,
          });
          await emit(options.onEvent, { error, toolCall, type: "tool.end" });
          continue;
        }

        try {
          const result = await tool.execute(toolCall.input, { signal: options.signal });
          messages.push({
            content: serializeToolResult(result),
            name: tool.name,
            role: "tool",
            toolCallId: toolCall.id,
          });
          await emit(options.onEvent, { result, toolCall, type: "tool.end" });
        } catch (cause) {
          const error = toError(cause);
          messages.push({
            content: JSON.stringify({ error: error.message }),
            name: tool.name,
            role: "tool",
            toolCallId: toolCall.id,
          });
          await emit(options.onEvent, { error, toolCall, type: "tool.end" });
        }
      }
    }

    throw new AgentMaxStepsError(maxSteps);
  }
}

async function emit(
  onEvent: AgentRunOptions["onEvent"],
  event: AgentRunEvent,
): Promise<void> {
  await onEvent?.(event);
}

function serializeToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  const serialized = JSON.stringify(result);
  return serialized === undefined ? String(result) : serialized;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
