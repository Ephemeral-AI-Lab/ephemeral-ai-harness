import type { LlmClient } from "./client.js";
import type { ProviderClientOptions } from "./config.js";
import { createProvider } from "./providers/registry.js";
import type { ProviderConnection } from "./providers/connection.js";
import { LlmStreamClient } from "./stream-client.js";

/**
 * Construct an `LlmClient` for a named direct provider connection. Provider
 * modules own credentials, request encoding, native stream decoding, and
 * provider-specific options; the shared stream client owns retry and
 * lifecycle policy.
 */
export function createLlmClient(
  connection: ProviderConnection,
  options: ProviderClientOptions = {},
): LlmClient {
  return new LlmStreamClient(createProvider(connection, options), options);
}
