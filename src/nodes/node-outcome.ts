import type { z } from "zod";

import type { JsonObject, JsonValue } from "../contracts/index.js";

import type { NodeDefinition } from "./node-definition.js";

export interface NodeOutcomeContract<TPayload extends JsonValue = JsonValue> {
  name: string;
  description: string;
  schema: z.ZodType<TPayload>;
}

export interface NodeCompletionPort<TPayload extends JsonValue = JsonValue> {
  submit(payload: TPayload): Promise<NodeOutcomeSubmissionResult<TPayload>>;
}

export type NodeOutcomeSubmissionResult<
  TPayload extends JsonValue = JsonValue,
> =
  | { accept: NodeOutcome<TPayload> }
  | { reject: string };

export interface NodeOutcome<TPayload extends JsonValue = JsonValue> {
  outcomeName: string;
  outcome: TPayload;
}

export interface WorkflowNodeOutcome<TPayload extends JsonValue = JsonValue> {
  node: NodeDefinition;
  metadata?: JsonObject;
  outcomeName: string;
  outcome: TPayload;
}

export type NodeSettlement<TPayload extends JsonValue = JsonValue> =
  | { status: "completed"; outcome: NodeOutcome<TPayload> }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "cancelled"; reason?: string };

export type WorkflowNodeSettlement<
  TPayload extends JsonValue = JsonValue,
> =
  | { status: "completed"; accepted: WorkflowNodeOutcome<TPayload> }
  | {
      status: "rejected";
      node: NodeDefinition;
      metadata?: JsonObject;
      reason: string;
    }
  | {
      status: "failed";
      node: NodeDefinition;
      metadata?: JsonObject;
      reason: string;
    }
  | {
      status: "cancelled";
      node: NodeDefinition;
      metadata?: JsonObject;
      reason?: string;
    };
