import {
  loadConfiguredCodexClient,
  type ConfiguredCodexClient,
} from "../../llm-client/support/llm-clients-config.js";

export const runtimeCodex = loadRuntimeCodex();
export const RUNTIME_CLIENT_ID = "runtime_codex";
export const CODEWORD = "zebra-7-runtime";

function loadRuntimeCodex(): ConfiguredCodexClient {
  try {
    return loadConfiguredCodexClient();
  } catch (error) {
    return { available: false, reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
