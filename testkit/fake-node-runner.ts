import type { JsonObject, JsonValue } from "../src/contracts/index.js";
import type { SteerResult } from "../src/contracts/index.js";
import { createRunEventStream, systemClock } from "../src/nodes/events.js";
import type {
  NodeLaunchRequest,
  NodeOutcomeSubmissionResult,
  NodeRunEvent,
  NodeRunHandle,
  NodeRunSnapshot,
  NodeRunner,
  NodeSettlement,
  NodeStartSpec,
  NodeSteer,
} from "../src/nodes/index.js";

interface FakeRunControls {
  readonly nodeName: string;
  readonly running: boolean;
  complete(payload: JsonValue): Promise<NodeOutcomeSubmissionResult>;
  fail(reason: string): void;
  cancel(reason?: string): void;
  snapshot(): NodeRunSnapshot;
}

export class FakeNodeRunner implements NodeRunner {
  readonly launches: NodeLaunchRequest[] = [];
  readonly #runs: FakeRunControls[] = [];

  launch<TPayload extends JsonValue = JsonValue>(
    request: NodeLaunchRequest<TPayload>,
  ): Promise<NodeRunHandle<TPayload>> {
    const handle = new FakeNodeRunHandle(request);
    this.launches.push(request);
    this.#runs.push(handle);
    return Promise.resolve(handle);
  }

  complete(
    nodeName: string,
    payload: JsonValue,
  ): Promise<NodeOutcomeSubmissionResult> {
    return this.#require(nodeName).complete(payload);
  }

  fail(nodeName: string, reason: string): void {
    this.#require(nodeName).fail(reason);
  }

  cancel(nodeName: string, reason?: string): void {
    this.#require(nodeName).cancel(reason);
  }

  snapshot(nodeName: string): NodeRunSnapshot {
    return this.#require(nodeName).snapshot();
  }

  #require(nodeName: string): FakeRunControls {
    const run = [...this.#runs]
      .reverse()
      .find((candidate) => candidate.nodeName === nodeName);
    if (run === undefined) throw new Error(`unknown fake node run: ${nodeName}`);
    return run;
  }
}

class FakeNodeRunHandle<TPayload extends JsonValue>
  implements NodeRunHandle<TPayload>, FakeRunControls {
  readonly start: NodeStartSpec<TPayload>;
  readonly #request: NodeLaunchRequest<TPayload>;
  readonly #events = createRunEventStream<NodeRunEvent>({ clock: systemClock });
  readonly #settlement: Promise<NodeSettlement<TPayload>>;
  #resolveSettlement!: (settlement: NodeSettlement<TPayload>) => void;
  #status: NodeRunSnapshot["status"] = "running";
  #completedAt: string | undefined;

  constructor(request: NodeLaunchRequest<TPayload>) {
    this.#request = request;
    this.start = request.start;
    this.#settlement = new Promise((resolve) => {
      this.#resolveSettlement = resolve;
    });
    this.#events.emit({
      type: "node_started",
      nodeName: request.start.node.name,
      spec: {
        nodeKind: request.start.node.kind,
        nodeName: request.start.node.name,
        outcomeName: request.start.outcome.name,
      },
    });
  }

  get nodeName(): string {
    return this.start.node.name;
  }

  get running(): boolean {
    return this.#status === "running";
  }

  settlement(): Promise<NodeSettlement<TPayload>> {
    return this.#settlement;
  }

  events(): AsyncIterable<NodeRunEvent> {
    return this.#events.events();
  }

  snapshot(): NodeRunSnapshot {
    return {
      nodeName: this.start.node.name,
      ...(this.#request.metadata && { metadata: this.#request.metadata }),
      status: this.#status,
      startedAt: "fake-start",
      ...(this.#completedAt !== undefined && { completedAt: this.#completedAt }),
    };
  }

  steer(input: NodeSteer): SteerResult {
    if (input.type === "interrupt") {
      void this.interrupt(input.reason);
      return { accepted: true };
    }
    return { accepted: false, reason: "unsupported" };
  }

  interrupt(reason: string): Promise<void> {
    this.cancel(reason);
    return Promise.resolve();
  }

  async complete(payload: JsonValue): Promise<NodeOutcomeSubmissionResult> {
    this.#events.emit({
      type: "node_outcome_submitted",
      nodeName: this.start.node.name,
      outcome: valueAsObject(payload),
    });
    const result = await this.#request.completion.submit(payload as TPayload);
    if ("reject" in result) {
      this.#events.emit({
        type: "node_outcome_rejected",
        nodeName: this.start.node.name,
        reason: result.reject,
      });
      return result;
    }
    this.#settle({ status: "completed", outcome: result.accept });
    return result;
  }

  fail(reason: string): void {
    this.#settle({ status: "failed", reason });
  }

  cancel(reason?: string): void {
    this.#settle({
      status: "cancelled",
      ...(reason !== undefined && { reason }),
    });
  }

  #settle(settlement: NodeSettlement<TPayload>): void {
    if (this.#status !== "running") return;
    this.#status = settlement.status;
    this.#completedAt = "fake-complete";
    this.#events.emit({
      type: "node_settled",
      nodeName: this.start.node.name,
      settlement: settlement as NodeSettlement,
    });
    this.#events.close();
    this.#resolveSettlement(settlement);
  }
}

function valueAsObject(value: JsonValue): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : { value };
}
