import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  Model as PiModel,
  Provider as PiProvider,
  ProviderAuth,
} from "@earendil-works/pi-ai";

import { ProviderError } from "../../errors.js";
import type { Provider, ProviderOptions } from "../provider.js";
import type { CatalogProviderConnection } from "../connection.js";
import { toPiContext } from "./context.js";
import { PiStreamDecoder } from "./events.js";

/** Build a provider backed by pi-ai's complete built-in provider catalog. */
export function catalogProvider(
  connection: CatalogProviderConnection,
  _options: ProviderOptions = {},
): Provider {
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
      const model = modelForRequest(base, request.model, connection.base_url);
      const route = builtinRoute(base, model, connection);
      const models = builtinModels();
      models.setProvider(route);
      const stream = models.streamSimple(model, toPiContext(request, model), {
        signal,
        apiKey: connection.api_key?.expose() ?? connection.access_token?.expose(),
        maxTokens: request.max_tokens,
        maxRetries: 0,
        ...(request.reasoning_effort === undefined
          ? {}
          : { reasoning: request.reasoning_effort }),
      });
      return { stream };
    },
    decoder: () => new PiStreamDecoder(),
  };
}

function modelForRequest(
  provider: PiProvider,
  requestedId: string,
  baseUrl: string | undefined,
): PiModel {
  const known = provider.getModels().find((model) => model.id === requestedId);
  const template = known ?? provider.getModels()[0];
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
  model: PiModel,
  connection: CatalogProviderConnection,
): PiProvider {
  const credential =
    connection.api_key?.expose() ?? connection.access_token?.expose();
  const auth: ProviderAuth =
    credential === undefined
      ? provider.auth
      : {
          ...provider.auth,
          apiKey: {
            name: `${provider.name} credential`,
            resolve: async () => ({
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
