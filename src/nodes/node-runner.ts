import type { JsonObject, JsonValue } from "../contracts/index.js";

import type { NodeStartSpec } from "./node-input.js";
import type { NodeCompletionPort } from "./node-outcome.js";
import type { NodeRunHandle } from "./node-run.js";

export interface WorkflowNodeDispatch<
  TPayload extends JsonValue = JsonValue,
> {
  start: NodeStartSpec<TPayload>;
  metadata?: JsonObject;
}

export interface NodeLaunchRequest<
  TPayload extends JsonValue = JsonValue,
> {
  start: NodeStartSpec<TPayload>;
  metadata?: JsonObject;
  completion: NodeCompletionPort<TPayload>;
  signal?: AbortSignal;
}

export interface NodeRunner {
  launch<TPayload extends JsonValue = JsonValue>(
    request: NodeLaunchRequest<TPayload>,
  ): Promise<NodeRunHandle<TPayload>>;
}
