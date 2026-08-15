import type { SecretString } from "../secret.js";

/** How a credential rides the request: `x-api-key` or `Authorization: Bearer`. */
export interface ProviderCredential {
  kind: "api_key" | "bearer";
  secret: SecretString;
}

/**
 * Provider authentication: where requests go (`baseUrl`) and as-whom
 * (`credential` plus per-attempt headers). An access scheme knows nothing
 * about wire protocols.
 *
 * `headers()` is deliberately async and called once per attempt: it is the
 * seam a future token-exchange scheme (e.g. copilot) plugs into without
 * touching the client, wires, or retry gate. Static schemes return a
 * constant.
 */
export interface ProviderAuth {
  baseUrl: string;
  credential: ProviderCredential;
  headers(): Promise<Record<string, string>>;
}
