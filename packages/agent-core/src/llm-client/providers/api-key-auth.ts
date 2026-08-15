import type { SecretString } from "../secret.js";
import type { ProviderAuth } from "./auth.js";

/** Static api-key access: first-party endpoints or any compatible base url. */
export function apiKeyAuth(baseUrl: string, apiKey: SecretString): ProviderAuth {
  return {
    baseUrl,
    credential: { kind: "api_key", secret: apiKey },
    headers: () => Promise.resolve({}),
  };
}
