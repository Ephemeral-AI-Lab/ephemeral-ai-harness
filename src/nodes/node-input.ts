import type { JsonObject, JsonValue, Message } from "../contracts/index.js";

import type {
  AgentNodeDefinition,
  WorkflowNodeDefinition,
} from "./node-definition.js";
import type { NodeOutcomeContract } from "./node-outcome.js";

export type NodeStartSpec<TPayload extends JsonValue = JsonValue> =
  | AgentNodeStartSpec<TPayload>
  | WorkflowNodeStartSpec<TPayload>;

export interface AgentNodeStartSpec<
  TPayload extends JsonValue = JsonValue,
> {
  node: AgentNodeDefinition;
  input: AgentNodeInput;
  outcome: NodeOutcomeContract<TPayload>;
}

export interface WorkflowNodeStartSpec<
  TPayload extends JsonValue = JsonValue,
> {
  node: WorkflowNodeDefinition;
  input: WorkflowNodeInput;
  outcome: NodeOutcomeContract<TPayload>;
}

export interface AgentNodeInput {
  messages: Message[];
  metadata?: JsonObject;
}

export interface WorkflowNodeInput {
  args: JsonObject;
  metadata?: JsonObject;
}
