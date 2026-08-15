import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  Api,
  Credential,
  CredentialStore,
  Model as PiModel,
  Provider as PiProvider,
  ProviderAuth,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { ProviderError } from "../../errors.js";
import type { ProviderClientOptions } from "../../config.js";
import type { Provider } from "../provider.js";
import type { ParsedCatalogProviderConnection as CatalogProviderConnection } from "../connection.js";
import { toPiContext, toPiToolChoice } from "./context.js";
import { PiStreamDecoder } from "./events.js";

/** Build a provider backed by pi-ai's complete built-in provider catalog. */
export function catalogProvider(
  connection: CatalogProviderConnection,
  options: ProviderClientOptions = {},
): Provider {
  void options;
  const catalog = builtinModels();
  const base = catalog.getProvider(connection.provider);
  if (base === undefined) {
    throw new ProviderError(
      "request",
      `pi-ai provider is not available: ${connection.provider}`,
    );
  }

  return {
    async open(request, signal) {
      const credential = connectionCredential(connection);
      const models = builtinModels({
        ...(credential === undefined
          ? {}
          : { credentials: staticCredentialStore(base.id, credential) }),
      });
      const active = models.getProvider(connection.provider);
      if (active === undefined) {
        throw new ProviderError(
          "request",
          `pi-ai provider is not available: ${connection.provider}`,
        );
      }
      if (active.getModels().length === 0 && active.refreshModels !== undefined) {
        await models.refresh({ allowNetwork: true, signal });
      }
      const refreshed = models.getProvider(connection.provider) ?? active;
      const model = modelForRequest(refreshed, request.model, connection.base_url);
      const route = builtinRoute(refreshed, model, connection);
      models.setProvider(route);
      const streamOptions: SimpleStreamOptions & { toolChoice?: unknown } = {
        signal,
        ...(connection.api_key === undefined
          ? {}
          : { apiKey: connection.api_key.expose() }),
        maxTokens: request.max_tokens,
        maxRetries: 0,
        ...(request.tool_choice === undefined
          ? {}
          : { toolChoice: toPiToolChoice(request.tool_choice, model.api) }),
        ...(request.reasoning_effort === undefined
          ? {}
          : { reasoning: request.reasoning_effort }),
      };
      const stream = models.streamSimple(
        model,
        toPiContext(request, model),
        streamOptions,
      );
      return { stream };
    },
    decoder: () => new PiStreamDecoder(),
  };
}

function modelForRequest(
  provider: PiProvider,
  requestedId: string,
  baseUrl: string | undefined,
): PiModel<Api> {
  const models = provider.getModels();
  const known = models.find((model) => model.id === requestedId);
  const template = known ?? models.at(0);
  if (template === undefined) {
    throw new ProviderError(
      "request",
      `pi-ai provider has no model catalog: ${provider.id}`,
    );
  }
  return {
    ...template,
    id: requestedId,
    name: requestedId,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

function builtinRoute(
  provider: PiProvider,
  model: PiModel<Api>,
  connection: CatalogProviderConnection,
): PiProvider {
  const credential =
    connection.api_key?.expose() ?? connection.access_token?.expose();
  const useNativeOAuth =
    connection.access_token !== undefined && provider.auth.oauth !== undefined;
  const auth: ProviderAuth =
    credential === undefined || useNativeOAuth
      ? provider.auth
      : {
          ...provider.auth,
          apiKey: {
            name: `${provider.name} credential`,
            resolve: () => Promise.resolve({
              auth: { apiKey: credential },
              source: "configured connection",
            }),
          },
        };

  return {
    ...provider,
    auth,
    getModels: () => [model],
    stream: (requestedModel, context, options) =>
      provider.stream(requestedModel, context, options),
    streamSimple: (requestedModel, context, options) =>
      provider.streamSimple(requestedModel, context, options),
  };
}

function connectionCredential(
  connection: CatalogProviderConnection,
): Credential | undefined {
  if (connection.access_token !== undefined) {
    const access = connection.access_token.expose();
    return {
      type: "oauth",
      access,
      // The connection contract currently carries an access token only. It
      // is deliberately treated as non-refreshing until a host supplies a
      // real pi-ai OAuth credential store.
      refresh: access,
      expires: Number.MAX_SAFE_INTEGER,
    };
  }
  if (connection.api_key !== undefined) {
    return { type: "api_key", key: connection.api_key.expose() };
  }
  return undefined;
}

function staticCredentialStore(
  providerId: string,
  credential: Credential,
): CredentialStore {
  return {
    read: (requestedProviderId) =>
      Promise.resolve(
        requestedProviderId === providerId ? credential : undefined,
      ),
    list: () => Promise.resolve([{ providerId, type: credential.type }]),
    modify: (requestedProviderId, fn) =>
      requestedProviderId === providerId
        ? fn(credential)
        : Promise.resolve(undefined),
    delete: () => Promise.resolve(),
  };
}
