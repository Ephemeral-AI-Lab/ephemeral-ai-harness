import { homedir } from "node:os";
import { join } from "node:path";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import {
  createLlmClient,
  SecretString,
  type LlmClient,
} from "../../../src/llm-client/index.js";
import { loadCodexAuthFromPath } from "./codex-auth.js";

export type CatalogCodex =
  | {
      available: true;
      model: string;
      createClient(): LlmClient;
    }
  | { available: false; reason: string };

export function loadCatalogCodex(): CatalogCodex {
  const authPath =
    process.env.EPHAI_CODEX_AUTH_PATH ?? join(homedir(), ".codex", "auth.json");
  const auth = loadCodexAuthFromPath(authPath);
  if (!auth.available) return auth;

  const configuredModel = process.env.EPHAI_CODEX_MODEL;
  const defaultModel = builtinModels()
    .getProvider("openai-codex")
    ?.getModels()
    .at(0)?.id;
  const model = configuredModel ?? defaultModel;
  if (model === undefined) {
    return { available: false, reason: "pi-ai has no openai-codex model" };
  }

  return {
    available: true,
    model,
    createClient: () =>
      createLlmClient({
        provider: "openai-codex",
        access_token: new SecretString(auth.accessToken.expose()),
      }),
  };
}
