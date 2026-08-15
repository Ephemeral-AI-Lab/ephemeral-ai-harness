import type { JsonObject } from "../contracts/index.js";
import type { SteerResult } from "../contracts/index.js";
import type { EventBase } from "../nodes/events.js";
import type { NodeRunSnapshot } from "../nodes/index.js";

import type { WorkflowDefinition } from "./workflow-definition.js";
import type {
  StateSnapshot,
  WorkflowOutcome,
  WorkflowTimelineEntry,
} from "./workflow-implementation.js";

export interface WorkflowRunHandle {
  readonly definition: WorkflowDefinition;
  outcome(): Promise<WorkflowOutcome>;
  events(): AsyncIterable<WorkflowRunEvent>;
  snapshot(): WorkflowRunSnapshot;
  steer(input: WorkflowSteer): SteerResult;
  interrupt(reason: string): Promise<void>;
}

export interface WorkflowRunSnapshot {
  definitionMetadata?: JsonObject;
  state: JsonObject;
  runningNodes: NodeRunSnapshot[];
  finishedNodes: NodeRunSnapshot[];
  snapshots: StateSnapshot[];
  timeline: WorkflowTimelineEntry[];
}

export interface WorkflowSteer {
  type: "note";
  message: string;
}

export type WorkflowRunEventBody =
  | {
      type: "workflow_started";
      metadata?: JsonObject;
    }
  | {
      type: "workflow_snapshot_recorded";
      stateVersion: number;
      path?: string;
    }
  | {
      type: "workflow_dispatched";
      nodeRuns: JsonObject[];
    }
  | {
      type: "workflow_node_outcome_received";
      nodeName: string;
    }
  | {
      type: "workflow_transition_applied";
      transition: JsonObject;
      stateVersion: number;
    }
  | {
      type: "workflow_deadlocked";
      report: JsonObject;
    }
  | {
      type: "workflow_finished";
      outcome: WorkflowOutcome;
    };

export type WorkflowRunEvent = EventBase & WorkflowRunEventBody;
