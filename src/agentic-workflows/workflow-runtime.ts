import {
  JsonObjectSchema,
  zodIssueSummary,
  type JsonObject,
  type JsonValue,
  type SteerResult,
} from "../contracts/index.js";
import {
  createRunEventStream,
  systemClock,
  type Clock,
} from "../nodes/events.js";
import type {
  NodeLaunchRequest,
  NodeOutcome,
  NodeOutcomeSubmissionResult,
  NodeRunHandle,
  NodeRunSnapshot,
  NodeRunner,
  NodeStartSpec,
  WorkflowNodeDispatch,
  WorkflowNodeSettlement,
} from "../nodes/index.js";

import type { WorkflowDefinition } from "./workflow-definition.js";
import type {
  StateSnapshot,
  StateTransitionRecord,
  StateTransitionResult,
  WorkflowImplementation,
  WorkflowOutcome,
  WorkflowStateBase,
  WorkflowTimelineEntry,
} from "./workflow-implementation.js";
import type {
  WorkflowRunEvent,
  WorkflowRunEventBody,
  WorkflowRunHandle,
  WorkflowRunSnapshot,
} from "./workflow-run.js";
export interface WorkflowRuntimeConfig {
  nodeRunner: NodeRunner;
  clock?: Clock;
}

export interface WorkflowStartRequest<
  TState extends WorkflowStateBase = WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement = WorkflowNodeSettlement,
> {
  definition: WorkflowDefinition;
  implementation: WorkflowImplementation<TState, TSettlement>;
  args: JsonObject;
}

export interface WorkflowRuntime {
  start<
    TState extends WorkflowStateBase,
    TSettlement extends WorkflowNodeSettlement,
  >(
    request: WorkflowStartRequest<TState, TSettlement>,
  ): Promise<WorkflowRunHandle>;
}

export function createWorkflowRuntime(
  config: WorkflowRuntimeConfig,
): WorkflowRuntime {
  return new WorkflowRuntimeImpl(config);
}

class WorkflowRuntimeImpl implements WorkflowRuntime {
  readonly #config: WorkflowRuntimeConfig;

  constructor(config: WorkflowRuntimeConfig) {
    this.#config = config;
  }

  async start<
    TState extends WorkflowStateBase,
    TSettlement extends WorkflowNodeSettlement,
  >(
    request: WorkflowStartRequest<TState, TSettlement>,
  ): Promise<WorkflowRunHandle> {
    const instance = new WorkflowRunInstance(this.#config, request);
    await instance.start();
    return instance.handle;
  }
}

class WorkflowRunInstance<
  TState extends WorkflowStateBase,
  TSettlement extends WorkflowNodeSettlement,
> {
  readonly #nodeRunner: NodeRunner;
  readonly #clock: Clock;
  readonly #request: WorkflowStartRequest<TState, TSettlement>;
  readonly #eventStream;
  readonly #controller = new AbortController();
  readonly #nodes: WorkflowNodeRunEntry[] = [];
  readonly #snapshots: StateSnapshot[] = [];
  readonly #timeline: WorkflowTimelineEntry[] = [];
  readonly #outcome: Promise<WorkflowOutcome>;
  readonly handle: WorkflowRunHandle;
  #resolveOutcome!: (outcome: WorkflowOutcome) => void;
  #state: TState | undefined;
  #finished = false;
  #queue: Promise<void> = Promise.resolve();
  #lastDispatches: WorkflowNodeDispatch[] = [];

  constructor(
    config: WorkflowRuntimeConfig,
    request: WorkflowStartRequest<TState, TSettlement>,
  ) {
    this.#nodeRunner = config.nodeRunner;
    this.#clock = config.clock ?? systemClock;
    this.#request = request;
    this.#eventStream = createRunEventStream<WorkflowRunEvent>({
      clock: this.#clock,
    });
    this.#outcome = new Promise((resolve) => {
      this.#resolveOutcome = resolve;
    });
    this.handle = {
      definition: request.definition,
      outcome: () => this.#outcome,
      events: () => this.#eventStream.events(),
      snapshot: () => this.snapshot(),
      steer: () => this.#steer(),
      interrupt: (reason) => this.#interrupt(reason),
    };
  }

  async start(): Promise<void> {
    this.#state = this.#request.implementation.createInitialState({
      definition: this.#request.definition,
      args: this.#request.args,
    });
    this.#emit({
      type: "workflow_started",
      ...(this.#request.definition.metadata && {
        metadata: this.#request.definition.metadata,
      }),
    });
    this.#recordSnapshot();
    if (this.#finishIfDone()) return;
    await this.#dispatch();
  }

  snapshot(): WorkflowRunSnapshot {
    const metadata = this.#request.definition.metadata;
    return {
      ...(metadata && { definitionMetadata: metadata }),
      state: this.#stateToJson(),
      runningNodes: this.#nodeSnapshots("running"),
      finishedNodes: this.#nodeSnapshots("finished"),
      snapshots: this.#snapshots.map((snapshot) => ({ ...snapshot })),
      timeline: this.#timeline.map((entry) => ({ ...entry })),
    };
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #submitNodeCompletion<TPayload extends JsonValue>(
    entry: WorkflowNodeRunEntry,
    payload: TPayload,
  ): Promise<NodeOutcomeSubmissionResult<TPayload>> {
    if (entry.status !== "running") {
      return { reject: "node run is already finished" };
    }

    const payloadRejection = validateOutcomePayload(entry, payload);
    if (payloadRejection !== undefined) {
      return { reject: payloadRejection };
    }

    const outcome = {
      outcomeName: entry.start.outcome.name,
      outcome: parseOutcomePayload(entry, payload),
    } satisfies NodeOutcome;

    this.#emit({
      type: "workflow_node_outcome_received",
      nodeName: entry.start.node.name,
    });

    const settlement = {
      status: "completed",
      accepted: {
        node: entry.start.node,
        ...(entry.metadata && { metadata: entry.metadata }),
        ...outcome,
      },
    } satisfies WorkflowNodeSettlement;

    const validation = this.#request.implementation.validateNodeSettlement({
      state: this.#requireState(),
      settlement: settlement as TSettlement,
      runtime: this.#runtimeSnapshot(),
    });
    if (!validation.ok) {
      return { reject: validation.reason };
    }

    entry.status = "completed";
    entry.completedAt = this.#clock.now().toISOString();
    entry.accepted = outcome;
    await this.#applyValidatedSettlement(settlement as TSettlement);
    return { accept: outcome as NodeOutcome<TPayload> };
  }

  async #settleNodeRun(
    entry: WorkflowNodeRunEntry,
    settlement: TSettlement,
  ): Promise<void> {
    if (settlement.status === "completed") return;

    if (entry.status !== "running") throw new Error("node run is already finished");

    const validation = this.#request.implementation.validateNodeSettlement({
      state: this.#requireState(),
      settlement,
      runtime: this.#runtimeSnapshot(),
    });
    if (!validation.ok) throw new Error(validation.reason);

    entry.status = settlement.status;
    entry.completedAt = this.#clock.now().toISOString();
    await this.#applyValidatedSettlement(settlement);
  }

  async #applyValidatedSettlement(settlement: TSettlement): Promise<void> {
    const applied = this.#request.implementation.applyNodeSettlement({
      state: this.#requireState(),
      settlement,
      runtime: this.#runtimeSnapshot(),
    });
    this.#applyTransition(applied);

    const evaluated = this.#request.implementation.evaluateWorkflowProgress({
      state: this.#requireState(),
      runtime: this.#runtimeSnapshot(),
    });
    this.#applyTransition(evaluated);

    this.#recordSnapshot();
    if (this.#finishIfDone()) return;
    await this.#dispatch();
  }

  #applyTransition(result: StateTransitionResult<TState>): void {
    this.#state = result.state;
    if (result.transition === undefined) return;
    this.#emit({
      type: "workflow_transition_applied",
      transition: toJsonObject(result.transition),
      stateVersion: result.state.version,
    });
  }

  async #dispatch(): Promise<void> {
    const state = this.#requireState();
    if (state.is_workflow_done) return;

    const dispatches = this.#request.implementation.dispatch({
      definition: this.#request.definition,
      state,
      runtime: this.#runtimeSnapshot(),
    });
    this.#lastDispatches = dispatches;

    if (dispatches.length > 0) {
      this.#emit({
        type: "workflow_dispatched",
        nodeRuns: dispatches.map((dispatch) => ({
          nodeKind: dispatch.start.node.kind,
          nodeName: dispatch.start.node.name,
          ...(dispatch.metadata && { metadata: dispatch.metadata }),
        })),
      });
    }

    for (const dispatch of dispatches) {
      await this.#launchDispatch(dispatch);
    }

    if (dispatches.length === 0) {
      this.#deadlockIfIdle();
    }
  }

  async #launchDispatch(dispatch: WorkflowNodeDispatch): Promise<void> {
    const entry = this.#claimDispatch(dispatch);

    const request = {
      start: dispatch.start,
      ...(entry.metadata && { metadata: entry.metadata }),
      completion: {
        submit: (payload) => this.#submitFromPort(entry, payload),
      },
      signal: this.#controller.signal,
    } satisfies NodeLaunchRequest;

    try {
      const handle = await this.#nodeRunner.launch(request);
      entry.handle = handle;
      this.#monitorNodeSettlement(entry, handle);
    } catch (error) {
      await this.#settleNodeRun(entry, {
        status: "failed",
        node: entry.start.node,
        ...(entry.metadata && { metadata: entry.metadata }),
        reason: error instanceof Error ? error.message : String(error),
      } as TSettlement);
    }
  }

  #submitFromPort<TPayload extends JsonValue>(
    entry: WorkflowNodeRunEntry,
    payload: TPayload,
  ): Promise<NodeOutcomeSubmissionResult<TPayload>> {
    return this.#enqueue(() => this.#submitNodeCompletion(entry, payload));
  }

  #monitorNodeSettlement(
    entry: WorkflowNodeRunEntry,
    handle: NodeRunHandle,
  ): void {
    void handle
      .settlement()
      .then((settlement) => {
        if (settlement.status === "completed") return;
        if (entry.status !== "running") return;
        void this.#enqueue(() =>
          this.#settleNodeRun(entry, {
            ...settlement,
            node: entry.start.node,
            ...(entry.metadata && { metadata: entry.metadata }),
          } as WorkflowNodeSettlement as TSettlement),
        ).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  #deadlockIfIdle(): void {
    const state = this.#requireState();
    if (
      state.is_workflow_done ||
      this.#nodeSnapshots("running").length > 0
    ) {
      return;
    }
    if (this.#lastDispatches.length > 0) return;

    const report = this.#request.implementation.deadlock({
      state,
      runtime: this.#runtimeSnapshot(),
      lastDispatches: this.#lastDispatches,
    });
    if (report === null) return;

    const transition: StateTransitionRecord = {
      type: "workflow_deadlocked",
      reason: report.reason,
      ...(report.details && { details: report.details }),
    };
    this.#state = {
      ...state,
      is_workflow_done: true,
      workflow_status: "deadlocked",
      last_transition: transition,
    };
    this.#emit({ type: "workflow_deadlocked", report: toJsonObject(report) });
    this.#emit({
      type: "workflow_transition_applied",
      transition: toJsonObject(transition),
      stateVersion: this.#state.version,
    });
    this.#recordSnapshot();
    this.#finish({
      status: "deadlocked",
      reason: report.reason,
      ...(report.details && { report: report.details }),
    });
  }

  #finishIfDone(): boolean {
    const state = this.#requireState();
    if (!state.is_workflow_done) return false;
    this.#finish(this.#request.implementation.getWorkflowOutcome(state) ?? {
      status: state.workflow_status === "deadlocked" ? "deadlocked" : "failure",
      reason: state.workflow_status,
    });
    return true;
  }

  #finish(outcome: WorkflowOutcome): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#emit({ type: "workflow_finished", outcome });
    this.#eventStream.close();
    this.#resolveOutcome(outcome);
  }

  #steer(): SteerResult {
    return { accepted: false, reason: "unsupported" };
  }

  async #interrupt(reason: string): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#finished) return;
      this.#controller.abort(reason);
      const running = this.#nodes.filter(
        (entry) => entry.status === "running",
      );
      await Promise.all(
        running.map((entry) => entry.handle?.interrupt(reason) ?? Promise.resolve()),
      );
      const now = this.#clock.now().toISOString();
      for (const entry of running) {
        entry.status = "cancelled";
        entry.completedAt = now;
      }
      const transition: StateTransitionRecord = {
        type: "workflow_interrupted",
        reason,
      };
      const state = this.#requireState();
      this.#state = {
        ...state,
        is_workflow_done: true,
        workflow_status: "failure",
        last_transition: transition,
      };
      this.#emit({
        type: "workflow_transition_applied",
        transition: toJsonObject(transition),
        stateVersion: this.#state.version,
      });
      this.#recordSnapshot();
      this.#finish({ status: "cancelled", reason });
    });
  }

  #recordSnapshot(): void {
    const state = this.#requireState();
    const snapshot = {
      version: state.version,
      recordedAt: this.#clock.now().toISOString(),
      state: toJsonObject(state),
    };
    this.#snapshots.push(snapshot);
    this.#emit({
      type: "workflow_snapshot_recorded",
      stateVersion: state.version,
    });
  }

  #emit(body: WorkflowRunEventBody): void {
    const event = this.#eventStream.emit(body);
    this.#timeline.push({ type: event.type, time: event.time });
  }

  #runtimeSnapshot(): import("./workflow-implementation.js").RuntimeSnapshot {
    return {
      runningNodes: this.#nodeSnapshots("running"),
      finishedNodes: this.#nodeSnapshots("finished"),
      timeline: this.#timeline.map((entry) => ({ ...entry })),
    };
  }

  #claimDispatch(dispatch: WorkflowNodeDispatch): WorkflowNodeRunEntry {
    const entry: WorkflowNodeRunEntry = {
      start: dispatch.start,
      ...(dispatch.metadata && { metadata: dispatch.metadata }),
      status: "running",
      startedAt: this.#clock.now().toISOString(),
    };
    this.#nodes.push(entry);
    return entry;
  }

  #nodeSnapshots(kind: "running" | "finished"): NodeRunSnapshot[] {
    const statuses =
      kind === "running"
        ? new Set<NodeRunStatus>(["running"])
        : new Set<NodeRunStatus>([
            "completed",
            "failed",
            "cancelled",
            "rejected",
          ]);
    return this.#nodes
      .filter((entry) => statuses.has(entry.status))
      .map((entry) => nodeSnapshot(entry));
  }

  #stateToJson(): JsonObject {
    const state = this.#state;
    if (state === undefined) return {};
    return toJsonObject(state);
  }

  #requireState(): TState {
    if (this.#state === undefined) {
      throw new Error("workflow run has not started");
    }
    return this.#state;
  }
}

type NodeRunStatus =
  | "running"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

interface WorkflowNodeRunEntry {
  start: NodeStartSpec;
  metadata?: JsonObject;
  status: NodeRunStatus;
  startedAt: string;
  completedAt?: string;
  accepted?: NodeOutcome;
  handle?: NodeRunHandle;
}

function validateOutcomePayload(
  entry: WorkflowNodeRunEntry,
  payload: JsonValue,
): string | undefined {
  const parsed = entry.start.outcome.schema.safeParse(payload);
  if (parsed.success) return undefined;
  return `invalid ${entry.start.outcome.name}: ${zodIssueSummary(parsed.error)}`;
}

function parseOutcomePayload(
  entry: WorkflowNodeRunEntry,
  payload: JsonValue,
): JsonValue {
  const parsed = entry.start.outcome.schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(zodIssueSummary(parsed.error));
  }
  return parsed.data;
}

function nodeSnapshot(entry: WorkflowNodeRunEntry): NodeRunSnapshot {
  return {
    nodeName: entry.start.node.name,
    ...(entry.metadata && { metadata: entry.metadata }),
    status: entry.status,
    startedAt: entry.startedAt,
    ...(entry.completedAt !== undefined && { completedAt: entry.completedAt }),
  };
}

function toJsonObject(value: unknown): JsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  const result = JsonObjectSchema.safeParse(parsed);
  return result.success ? result.data : {};
}
