import {
  type Api,
  type Models,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import type { ProviderClientOptions } from "../config.js";
import { ProviderError } from "../errors.js";
import { LlmStreamClient } from "../stream-client.js";
import type { LlmClient } from "../client.js";
import type { Wire, WireOptions } from "../wires/wire.js";
import type { SecretString } from "../secret.js";
import type { LlmRequest, ReasoningEffort } from "../types.js";
import { toPiContext } from "./context.js";
import { PiAiStreamDecoder } from "./events.js";
import { toPiAiProviderError } from "./errors.js";
import { createPiAiModels } from "./providers.js";

function reasoningLevel(effort: ReasoningEffort | undefined): SimpleStreamOptions["reasoning"] {
  return effort;
}

function toolChoice(
  model: Model<Api>,
  choice: LlmRequest["tool_choice"],
): unknown {
  if (choice === undefined || choice === "auto") return choice;
  if (choice === "any") {
    return model.api === "anthropic-messages" ? "any" : "required";
  }
  if (model.api === "anthropic-messages") {
    return { type: "tool", name: choice.tool };
  }
  return { type: "function", function: { name: choice.tool } };
}

class PiAiWire implements Wire {
  readonly #models: Models;
  readonly #route: string;
  readonly #apiKey: SecretString;

  constructor(models: Models, route: string, apiKey: SecretString) {
    this.#models = models;
    this.#route = route;
    this.#apiKey = apiKey;
  }

  open(
    request: LlmRequest,
    _options: WireOptions,
    signal: AbortSignal,
  ): Promise<{ stream: AsyncIterable<unknown>; requestId?: string }> {
    const model = this.#models.getModel(this.#route, request.model);
    if (!model) {
      throw new ProviderError(
        "request",
        `unknown pi-ai model "${this.#route}/${request.model}"`,
      );
    }
    const options = {
      apiKey: this.#apiKey.expose(),
      maxTokens: request.max_tokens,
      maxRetries: 0,
      reasoning: reasoningLevel(request.reasoning_effort),
      signal,
      ...(request.tool_choice !== undefined && {
        toolChoice: toolChoice(model, request.tool_choice),
      }),
    } as SimpleStreamOptions & Record<string, unknown>;
    try {
      return Promise.resolve({
        stream: this.#models.stream(model, toPiContext(request, model), options),
        requestId: undefined,
      });
    } catch (error) {
      throw toPiAiProviderError(error);
    }
  }

  decoder(): PiAiStreamDecoder {
    return new PiAiStreamDecoder();
  }
}

export function createPiAiClient(
  route: string,
  apiKey: SecretString,
  options: ProviderClientOptions = {},
): LlmClient {
  if (options.fetch !== undefined) {
    throw new Error("pi-ai clients do not support ProviderClientOptions.fetch");
  }
  const models = createPiAiModels(route);
  return new LlmStreamClient(new PiAiWire(models, route, apiKey), {}, options);
}

export function createPiAiClientForModels(
  models: Models,
  route: string,
  apiKey: SecretString,
  options: ProviderClientOptions = {},
): LlmClient {
  if (options.fetch !== undefined) {
    throw new Error("pi-ai clients do not support ProviderClientOptions.fetch");
  }
  return new LlmStreamClient(new PiAiWire(models, route, apiKey), {}, options);
}
