import type { JsonObject, JsonValue, SteerResult } from "../contracts/index.js";

import type { EventBase } from "./events.js";
import type { NodeName } from "./node-definition.js";
import type { NodeStartSpec } from "./node-input.js";
import type { NodeSettlement } from "./node-outcome.js";

export interface NodeRunHandle<
  TPayload extends JsonValue = JsonValue,
  TSteer = NodeSteer,
> {
  readonly start: NodeStartSpec<TPayload>;
  settlement(): Promise<NodeSettlement<TPayload>>;
  events(): AsyncIterable<NodeRunEvent>;
  snapshot(): NodeRunSnapshot;
  steer(input: TSteer): SteerResult;
  interrupt(reason: string): Promise<void>;
}

export interface NodeRunSnapshot {
  nodeName: NodeName;
  metadata?: JsonObject;
  status: "running" | "completed" | "rejected" | "cancelled" | "failed";
  startedAt: string;
  completedAt?: string;
}

export type NodeSteer =
  | { type: "interrupt"; reason: string }
  | { type: "note"; message: string };

export type NodeRunEventBody =
  | {
      type: "node_started";
      spec: JsonObject;
    }
  | {
      type: "node_outcome_submitted";
      outcome: JsonObject;
    }
  | {
      type: "node_outcome_rejected";
      reason: string;
    }
  | {
      type: "node_settled";
      settlement: NodeSettlement;
    };

export type NodeRunEvent = EventBase & { nodeName: string } & NodeRunEventBody;
