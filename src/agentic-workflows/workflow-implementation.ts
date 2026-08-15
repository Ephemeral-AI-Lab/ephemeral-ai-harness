import type { JsonObject, JsonValue } from "../contracts/index.js";
import type {
  NodeRunSnapshot,
  WorkflowNodeDispatch,
  WorkflowNodeSettlement,
} from "../nodes/index.js";

import type { WorkflowDefinition } from "./workflow-definition.js";

export interface StateTransitionRecord {
  type: string;
  [key: string]: JsonValue;
}

export interface DispatchRecord {
  nodeNames: string[];
  at: string;
}

export interface WorkflowStateBase {
  version: number;
  is_workflow_done: boolean;
  workflow_status: "running" | "success" | "failure" | "deadlocked";
  last_transition?: StateTransitionRecord;
  last_dispatch?: DispatchRecord;
}

export interface WorkflowTimelineEntry {
  type: string;
  time: string;
  [key: string]: JsonValue;
}

export interface StateSnapshot {
  version: number;
  recordedAt: string;
  state: JsonObject;
  path?: string;
}

export interface RuntimeSnapshot {
  runningNodes: NodeRunSnapshot[];
  finishedNodes: NodeRunSnapshot[];
  timeline: WorkflowTimelineEntry[];
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface StateTransitionResult<
  TState extends WorkflowStateBase = WorkflowStateBase,
> {
  state: TState;
  transition?: StateTransitionRecord;
}

export interface DeadlockReport {
  reason: string;
  details?: JsonObject;
}

export type WorkflowOutcome =
  | { status: "success"; output?: JsonValue }
  | { status: "failure"; reason?: string; output?: JsonValue }
  | { status: "deadlocked"; reason: string; report?: JsonObject }
  | { status: "cancelled"; reason: string };

export interface CreateWorkflowStateContext {
  definition: WorkflowDefinition;
  args: JsonObject;
}

export interface WorkflowDispatchContext<TState extends WorkflowStateBase> {
  definition: WorkflowDefinition;
  state: TState;
  runtime: RuntimeSnapshot;
}

export interface ValidateNodeSettlementContext<
  TState extends WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement,
> {
  state: TState;
  settlement: TSettlement;
  runtime: RuntimeSnapshot;
}

export interface ApplyNodeSettlementContext<
  TState extends WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement,
> {
  state: TState;
  settlement: TSettlement;
  runtime: RuntimeSnapshot;
}

export interface EvaluateWorkflowProgressContext<
  TState extends WorkflowStateBase,
> {
  state: TState;
  runtime: RuntimeSnapshot;
}

export interface DeadlockContext<TState extends WorkflowStateBase> {
  state: TState;
  runtime: RuntimeSnapshot;
  lastDispatches: WorkflowNodeDispatch[];
}

export interface WorkflowImplementation<
  TState extends WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement = WorkflowNodeSettlement,
> {
  createInitialState(ctx: CreateWorkflowStateContext): TState;
  dispatch(ctx: WorkflowDispatchContext<TState>): WorkflowNodeDispatch[];
  validateNodeSettlement(
    ctx: ValidateNodeSettlementContext<TState, TSettlement>,
  ): ValidationResult;
  applyNodeSettlement(
    ctx: ApplyNodeSettlementContext<TState, TSettlement>,
  ): StateTransitionResult<TState>;
  evaluateWorkflowProgress(
    ctx: EvaluateWorkflowProgressContext<TState>,
  ): StateTransitionResult<TState>;
  deadlock(ctx: DeadlockContext<TState>): DeadlockReport | null;
  getWorkflowOutcome(state: TState): WorkflowOutcome | null;
}

export function defineWorkflowImplementation<
  TState extends WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement = WorkflowNodeSettlement,
>(
  implementation: WorkflowImplementation<TState, TSettlement>,
): WorkflowImplementation<TState, TSettlement> {
  return implementation;
}
