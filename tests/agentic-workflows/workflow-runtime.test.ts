import { describe, expect, it } from "vitest";

import { FakeNodeRunner } from "@ephai/agent-core/testkit";
import {
  createWorkflowRuntime,
  defineWorkflowImplementation,
  type StateTransitionRecord,
  type WorkflowDefinition,
  type WorkflowRunEvent,
  type WorkflowStateBase,
} from "@ephai/agent-core/agentic-workflows";
import { JsonObjectSchema } from "../../src/contracts/index.js";

interface TwoStepState extends WorkflowStateBase {
  step: "planner" | "worker" | "done";
  applied: string[];
}

const agentDefinition: WorkflowDefinition = {
  description: "two-step test workflow",
  nodes: [
    { kind: "agent", name: "planner" },
    { kind: "agent", name: "worker" },
  ],
  metadata: { name: "two_step" },
};

const workflowNodeDefinition: WorkflowDefinition = {
  description: "workflow-node test workflow",
  nodes: [{ kind: "workflow", name: "node" }],
};

const twoStepImplementation = defineWorkflowImplementation<TwoStepState>({
  createInitialState: () => ({
    version: 0,
    is_workflow_done: false,
    workflow_status: "running",
    step: "planner",
    applied: [],
  }),
  dispatch: ({ definition, state, runtime }) => {
    if (state.is_workflow_done || runtime.runningNodes.length > 0) return [];
    const planner = definition.nodes?.find((node) => node.name === "planner");
    const worker = definition.nodes?.find((node) => node.name === "worker");
    if (state.step === "planner" && planner?.kind === "agent") {
      return [
        {
          start: {
            node: planner,
            input: { messages: [{ role: "user", content: [] }] },
            outcome: {
              name: "node_result",
              description: "planner result",
              schema: JsonObjectSchema,
            },
          },
          metadata: { role: "planner" },
        },
      ];
    }
    if (state.step === "worker" && worker?.kind === "agent") {
      return [
        {
          start: {
            node: worker,
            input: { messages: [{ role: "user", content: [] }] },
            outcome: {
              name: "node_result",
              description: "worker result",
              schema: JsonObjectSchema,
            },
          },
          metadata: { role: "worker" },
        },
      ];
    }
    return [];
  },
  validateNodeSettlement: () => ({ ok: true }),
  applyNodeSettlement: ({ state, settlement }) => {
    if (settlement.status !== "completed") {
      const transition = transitionRecord("node_failed");
      return {
        state: {
          ...state,
          version: state.version + 1,
          is_workflow_done: true,
          workflow_status: "failure",
          last_transition: transition,
        },
        transition,
      };
    }

    const nodeName = settlement.accepted.node.name;
    const nextStep = nodeName === "planner" ? "worker" : "done";
    const transition = transitionRecord(`applied_${nodeName}`);
    return {
      state: {
        ...state,
        version: state.version + 1,
        step: nextStep,
        applied: [...state.applied, nodeName],
        last_transition: transition,
      },
      transition,
    };
  },
  evaluateWorkflowProgress: ({ state }) => {
    if (state.step !== "done") return { state };
    const transition = transitionRecord("workflow_succeeded");
    return {
      state: {
        ...state,
        is_workflow_done: true,
        workflow_status: "success",
        last_transition: transition,
      },
      transition,
    };
  },
  deadlock: () => ({ reason: "no runnable nodes" }),
  getWorkflowOutcome: (state) => {
    if (state.is_workflow_done && state.workflow_status === "success") {
      return { status: "success", output: { applied: state.applied } };
    }
    if (state.is_workflow_done && state.workflow_status === "failure") {
      return { status: "failure", reason: "node failed" };
    }
    return null;
  },
});

describe("createWorkflowRuntime", () => {
  it("runs dispatch, settlement, evaluation, and next dispatch in order", async () => {
    const runner = new FakeNodeRunner();
    const runtime = createWorkflowRuntime({ nodeRunner: runner });
    const run = await runtime.start({
      definition: agentDefinition,
      implementation: twoStepImplementation,
      args: {},
    });

    expect(
      runner.launches.map((launch) => launch.start.node.name),
      "initial dispatch launched the planner only",
    ).toEqual(["planner"]);

    await runner.complete("planner", { value: "plan" });

    expect(
      runner.launches.map((launch) => launch.start.node.name),
      "planner settlement dispatched the worker",
    ).toEqual(["planner", "worker"]);

    await runner.complete("worker", { value: "done" });

    await expect(run.outcome()).resolves.toEqual({
      status: "success",
      output: { applied: ["planner", "worker"] },
    });
    expect(run.snapshot().state.workflow_status).toBe("success");
    expect(run.snapshot().runningNodes).toEqual([]);
  });

  it("buffers workflow events until the live consumer reads them", async () => {
    const runner = new FakeNodeRunner();
    const runtime = createWorkflowRuntime({ nodeRunner: runner });
    const run = await runtime.start({
      definition: agentDefinition,
      implementation: twoStepImplementation,
      args: {},
    });

    await runner.complete("planner", { value: "plan" });
    await runner.complete("worker", { value: "done" });
    await run.outcome();

    const events: WorkflowRunEvent[] = [];
    for await (const event of run.events()) events.push(event);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes, "live event stream saw orchestration events").toContain(
      "workflow_started",
    );
    expect(eventTypes, "live event stream saw terminal event").toContain(
      "workflow_finished",
    );
  });

  it("rejects invalid and stale port submissions without mutating workflow state", async () => {
    const runner = new FakeNodeRunner();
    const runtime = createWorkflowRuntime({ nodeRunner: runner });
    const run = await runtime.start({
      definition: agentDefinition,
      implementation: twoStepImplementation,
      args: {},
    });

    const schemaRejected = await runner.complete("planner", "not an object");
    expect("reject" in schemaRejected, "schema submission was rejected").toBe(true);
    if ("reject" in schemaRejected) {
      expect(schemaRejected.reject).toContain("invalid node_result");
    }
    expect(
      run.snapshot().state.version,
      "schema rejection did not apply workflow state",
    ).toBe(0);

    const accepted = await runner.complete("planner", { value: "plan" });
    expect("accept" in accepted, "first valid submission accepted").toBe(true);
    const versionAfterAccept = run.snapshot().state.version;

    const stale = await runner.complete("planner", { value: "late" });
    expect(stale).toEqual({ reject: "node run is already finished" });
    expect(
      run.snapshot().state.version,
      "stale submission did not mutate state",
    ).toBe(versionAfterAccept);
  });

  it("marks a nonterminal idle workflow as deadlocked", async () => {
    const runtime = createWorkflowRuntime({ nodeRunner: new FakeNodeRunner() });
    const implementation = defineWorkflowImplementation<WorkflowStateBase>({
      createInitialState: () => ({
        version: 0,
        is_workflow_done: false,
        workflow_status: "running",
      }),
      dispatch: () => [],
      validateNodeSettlement: () => ({ ok: true }),
      applyNodeSettlement: ({ state }) => ({ state }),
      evaluateWorkflowProgress: ({ state }) => ({ state }),
      deadlock: () => ({ reason: "no runnable nodes" }),
      getWorkflowOutcome: () => null,
    });

    const run = await runtime.start({
      definition: {},
      implementation,
      args: {},
    });

    await expect(run.outcome()).resolves.toEqual({
      status: "deadlocked",
      reason: "no runnable nodes",
    });
    expect(run.snapshot().state.workflow_status).toBe("deadlocked");
  });

  it("launches workflow nodes through the same runtime-bound completion port", async () => {
    const runner = new FakeNodeRunner();
    const runtime = createWorkflowRuntime({ nodeRunner: runner });
    const implementation = workflowNodeImplementation();
    const run = await runtime.start({
      definition: workflowNodeDefinition,
      implementation,
      args: {},
    });

    expect(runner.launches[0]?.start.node.kind).toBe("workflow");
    const result = await runner.complete("node", { value: "node done" });

    expect("accept" in result, "workflow node submitted through port").toBe(true);
    await expect(run.outcome()).resolves.toEqual({
      status: "success",
      output: { applied: ["node"] },
    });
  });

  it("interrupts running node frames exactly once and resolves as cancelled", async () => {
    const runner = new FakeNodeRunner();
    const runtime = createWorkflowRuntime({ nodeRunner: runner });
    const run = await runtime.start({
      definition: agentDefinition,
      implementation: twoStepImplementation,
      args: {},
    });

    await run.interrupt("stop");

    expect(runner.snapshot("planner").status).toBe("cancelled");
    await expect(run.outcome()).resolves.toEqual({
      status: "cancelled",
      reason: "stop",
    });
    expect(run.snapshot().finishedNodes).toHaveLength(1);
    expect(run.snapshot().finishedNodes[0]?.status).toBe("cancelled");
  });
});

function workflowNodeImplementation() {
  return defineWorkflowImplementation<TwoStepState>({
    ...twoStepImplementation,
    dispatch: ({ definition, state, runtime }) => {
      if (state.is_workflow_done || runtime.runningNodes.length > 0) return [];
      const workflowNode = definition.nodes?.find((node) => node.name === "node");
      if (state.step === "planner" && workflowNode?.kind === "workflow") {
        return [
          {
            start: {
              node: workflowNode,
              input: { args: { task: "review" } },
              outcome: {
                name: "node_result",
                description: "workflow node result",
                schema: JsonObjectSchema,
              },
            },
          },
        ];
      }
      return [];
    },
    applyNodeSettlement: ({ state, settlement }) => {
      if (settlement.status !== "completed") return { state };
      const transition = transitionRecord("applied_node");
      return {
        state: {
          ...state,
          version: state.version + 1,
          step: "done",
          applied: ["node"],
          last_transition: transition,
        },
        transition,
      };
    },
  });
}

function transitionRecord(type: string): StateTransitionRecord {
  return { type };
}
