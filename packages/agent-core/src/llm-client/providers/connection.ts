import { z } from "zod";

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

export const ProviderConnectionSchema = z.union([
  directProviderConnectionSchema,
  catalogProviderConnectionSchema,
]);

export type ProviderConnection = z.input<typeof ProviderConnectionSchema>;
export type CatalogProviderConnection = z.input<
  typeof catalogProviderConnectionSchema
>;
