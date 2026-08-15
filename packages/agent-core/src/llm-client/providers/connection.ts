import { z } from "zod";

import { SecretString } from "../secret.js";

const secretString = z.union([
  z.instanceof(SecretString),
  z.string().transform((raw) => new SecretString(raw)),
]);

/**
 * A provider connection identifies an endpoint and credential. The model key
 * remains on `LlmRequest.model`, so one connection can serve every model its
 * provider endpoint supports.
 */
export const ProviderConnectionSchema = z.discriminatedUnion("provider", [
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

export type ProviderConnection = z.input<typeof ProviderConnectionSchema>;
