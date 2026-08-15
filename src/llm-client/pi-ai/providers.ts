import {
  createModels,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";

import { ProviderError } from "../errors.js";

type ProviderFactory = () => Provider;

/**
 * Provider imports stay explicit so applications do not pay for pi-ai's
 * heavy `providers/all` entry point. More providers can be added here without
 * changing the public LlmClient contract.
 */
const PROVIDER_FACTORIES = new Map<string, ProviderFactory>([
  ["anthropic", anthropicProvider],
  ["cerebras", cerebrasProvider],
  ["deepseek", deepseekProvider],
  ["google", googleProvider],
  ["groq", groqProvider],
  ["mistral", mistralProvider],
  ["openai", openaiProvider],
  ["openrouter", openrouterProvider],
  ["xai", xaiProvider],
]);

export function createPiAiModels(route: string): MutableModels {
  const factory = PROVIDER_FACTORIES.get(route);
  if (!factory) {
    throw new ProviderError(
      "request",
      `unsupported pi-ai provider route "${route}"`,
    );
  }
  const models = createModels();
  models.setProvider(factory());
  return models;
}
