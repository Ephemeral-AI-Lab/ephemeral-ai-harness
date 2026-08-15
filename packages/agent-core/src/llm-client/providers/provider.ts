import type { JsonObject } from "../../contracts/index.js";

import type { LlmStreamEvent } from "../events.js";
import type { SecretString } from "../secret.js";
import type { LlmRequest } from "../types.js";

/** Provider-specific request dialect options. */
export interface ProviderOptions {
  /** Identity text prepended as the first system block (claude coding plan). */
  systemPrefix?: string;
  /** Request-body dialect for the responses wire. */
  dialect?: "public" | "codex";
}

/**
 * What a provider needs from its connection: where, as-whom, and per-attempt
 * extra headers. Provider-specific auth constructors build this transport.
 */
export interface ProviderTransport {
  baseUrl: string;
  credential: { kind: "api_key" | "bearer"; secret: SecretString };
  /** Called once per attempt; static schemes return a constant. */
  headers(): Promise<Record<string, string>>;
  /** Injectable transport for unit tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Per-provider decoder state machine: SDK stream events in, normalized events
 * out. Decoders accumulate per-block strings linearly and parse tool
 * arguments once at block close.
 */
export interface StreamDecoder<TEvent> {
  /** Set once the provider terminal event has been decoded. */
  readonly completed: boolean;
  handle(event: TEvent): Iterable<LlmStreamEvent>;
}

/**
 * A provider codec bound to one connection: encode the neutral request, open
 * one SDK streaming call per attempt, and construct the matching decoder.
 */
export interface Provider {
  open(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<{ stream: AsyncIterable<unknown>; requestId?: string }>;
  decoder(requestId: string | undefined): StreamDecoder<unknown>;
}

/** Binds a provider to one connection; the SDK client is constructed once here. */
export type ProviderFactory = (transport: ProviderTransport, options?: ProviderOptions) => Provider;

/** Parse accumulated tool-argument json; malformed provider json yields `{}`. */
export function parseToolArgs(raw: string): JsonObject {
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // fall through to the empty object
  }
  return {};
}
