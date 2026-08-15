import { ModelsError } from "@earendil-works/pi-ai";

import { ProviderError } from "../errors.js";

function classifyMessage(message: string): ProviderError["kind"] {
  const lower = message.toLowerCase();
  if (/(401|403|unauthori|forbidden|api key|credential|oauth)/.test(lower)) {
    return "authentication";
  }
  if (/(429|rate.?limit|too many requests|quota)/.test(lower)) {
    return "rate_limit";
  }
  if (/(500|502|503|529|server error|service unavailable)/.test(lower)) {
    return "server";
  }
  if (/(timeout|timed out|network|fetch|socket|connection|econn)/.test(lower)) {
    return "transport";
  }
  return "decode";
}

export function toPiAiProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ModelsError) {
    const kind =
      error.code === "auth" || error.code === "oauth"
        ? "authentication"
        : error.code === "stream"
          ? "transport"
          : "request";
    return new ProviderError(kind, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(classifyMessage(message), message);
}

export function piAiMessageError(message: string): ProviderError {
  return new ProviderError(classifyMessage(message), message);
}

