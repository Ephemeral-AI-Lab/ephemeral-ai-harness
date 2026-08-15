import type { ProviderClientOptions } from "../config.js";
import {
  apiKeyAuth,
} from "./api-key-auth.js";
import {
  claudeCodingPlanAuth,
} from "./claude-coding-plan-auth.js";
import {
  codexCodingPlanAuth,
} from "./codex-coding-plan-auth.js";
import { ProviderConnectionSchema, type ProviderConnection } from "./connection.js";
import { anthropicProvider } from "./anthropic.js";
import { openAiProvider } from "./openai.js";
import type { Provider, ProviderOptions, ProviderTransport } from "./provider.js";

const CLAUDE_CODE_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

function transport(
  auth: ReturnType<typeof apiKeyAuth>,
  options: ProviderClientOptions,
): ProviderTransport {
  return {
    baseUrl: auth.baseUrl,
    credential: auth.credential,
    headers: () => auth.headers(),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  };
}

function providerOptions(
  dialect?: ProviderOptions["dialect"],
  systemPrefix?: string,
): ProviderOptions {
  return {
    ...(dialect !== undefined ? { dialect } : {}),
    ...(systemPrefix !== undefined ? { systemPrefix } : {}),
  };
}

/** Construct one direct provider implementation from a public connection. */
export function createProvider(
  connection: ProviderConnection,
  options: ProviderClientOptions = {},
): Provider {
  const parsed = ProviderConnectionSchema.parse(connection);
  switch (parsed.provider) {
    case "anthropic_api":
      return anthropicProvider(
        transport(apiKeyAuth(parsed.base_url, parsed.api_key), options),
        providerOptions(),
      );
    case "openai_api":
      return openAiProvider(
        transport(apiKeyAuth(parsed.base_url, parsed.api_key), options),
        providerOptions("public"),
      );
    case "claude_coding_plan":
      return anthropicProvider(
        transport(
          claudeCodingPlanAuth(parsed.base_url, parsed.access_token),
          options,
        ),
        providerOptions(undefined, CLAUDE_CODE_SYSTEM_PREFIX),
      );
    case "codex_coding_plan":
      return openAiProvider(
        transport(
          codexCodingPlanAuth(parsed.base_url, parsed.access_token),
          options,
        ),
        providerOptions("codex"),
      );
  }
}
