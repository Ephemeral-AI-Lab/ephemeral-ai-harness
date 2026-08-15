import { z } from "zod";

import type { KnownProvider as PiKnownProvider } from "@earendil-works/pi-ai";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

import { SecretString } from "../secret.js";

const secretString = z.union([
  z.instanceof(SecretString),
  z.string().transform((raw) => new SecretString(raw)),
]);

const builtinProviderIds = new Set<string>(getBuiltinProviders());

const catalogProviderConnectionSchema = z.object({
  provider: z.string().refine((value) => builtinProviderIds.has(value), {
    message: "unknown catalog provider",
  }),
  base_url: z.string().optional(),
  api_key: secretString.optional(),
  access_token: secretString.optional(),
});

/**
 * A provider connection identifies an endpoint and credential. The model key
 * remains on `LlmRequest.model`, so one connection can serve every model its
 * provider endpoint supports.
 */
const directProviderConnectionSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("anthropic_api"),
    base_url: z.string().default("https://api.anthropic.com"),
    api_key: secretString,
  }),
  z.object({
    provider: z.literal("openai_api"),
    base_url: z.string().default("https://api.openai.com/v1"),
    api_key: secretString,
  }),
  z.object({
    provider: z.literal("claude_coding_plan"),
    base_url: z.string().default("https://api.anthropic.com"),
    access_token: secretString,
  }),
  z.object({
    provider: z.literal("codex_coding_plan"),
    base_url: z.string().default("https://chatgpt.com/backend-api/codex"),
    access_token: secretString,
  }),
]);

const rawProviderConnectionSchema = z.union([
  directProviderConnectionSchema,
  catalogProviderConnectionSchema,
]);

type SecretInput = string | SecretString;

export type ProviderConnection =
  | { provider: "anthropic_api"; base_url?: string; api_key: SecretInput }
  | { provider: "openai_api"; base_url?: string; api_key: SecretInput }
  | {
      provider: "claude_coding_plan";
      base_url?: string;
      access_token: SecretInput;
    }
  | {
      provider: "codex_coding_plan";
      base_url?: string;
      access_token: SecretInput;
    }
  | CatalogProviderConnection;

export interface CatalogProviderConnection {
  provider: PiKnownProvider;
  base_url?: string;
  api_key?: SecretInput;
  access_token?: SecretInput;
}

export type ParsedProviderConnection =
  | { provider: "anthropic_api"; base_url: string; api_key: SecretString }
  | { provider: "openai_api"; base_url: string; api_key: SecretString }
  | {
      provider: "claude_coding_plan";
      base_url: string;
      access_token: SecretString;
    }
  | {
      provider: "codex_coding_plan";
      base_url: string;
      access_token: SecretString;
    }
  | ParsedCatalogProviderConnection;

export interface ParsedCatalogProviderConnection {
  provider: PiKnownProvider;
  base_url?: string;
  api_key?: SecretString;
  access_token?: SecretString;
}

export const ProviderConnectionSchema = rawProviderConnectionSchema as unknown as z.ZodType<
  ParsedProviderConnection,
  ProviderConnection
>;
