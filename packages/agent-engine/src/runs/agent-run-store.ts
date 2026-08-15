import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentEvent,
  AgentOutcome,
  AgentRunHandle as SdkAgentRunHandle,
} from "@ephai/agent-core";

import { LiveEventStream } from "./live-event-stream.js";
import {
  type AgentRunId,
  mintAgentRunId,
} from "./ids.js";

export interface AgentRunHandle<T = string> {
  readonly agentRunId: AgentRunId;
  steer(message: Parameters<SdkAgentRunHandle<T>["steer"]>[0]): boolean;
  interrupt(): void;
  outcome(): Promise<AgentOutcome<T>>;
  events(): AsyncIterable<AgentEvent>;
  readonly backgroundTaskSupervisor: SdkAgentRunHandle<T>["backgroundTaskSupervisor"];
  readonly notifier: SdkAgentRunHandle<T>["notifier"];
}

export async function bridgeAgentRun<T>(input: {
  agentRunId: AgentRunId;
  sdkHandle: SdkAgentRunHandle<T>;
  store: AgentRunStore;
}): Promise<AgentRunHandle<T>> {
  const stream = new LiveEventStream<AgentEvent>();
  const outcome = input.sdkHandle.outcome().then(async (result) => {
    await input.store.finish({
      agentRunId: input.agentRunId,
      outcome: result,
    });
    return result;
  });
  void (async () => {
    try {
      for await (const event of input.sdkHandle.events()) {
        await input.store.appendEvent({
          agentRunId: input.agentRunId,
          event,
        });
        stream.push(event);
      }
    } finally {
      stream.close();
    }
  })();
  const handle: AgentRunHandle<T> = {
    agentRunId: input.agentRunId,
    steer: (message) => input.sdkHandle.steer(message),
    interrupt: () => {
      input.sdkHandle.interrupt();
    },
    outcome: () => outcome,
    events: () => stream,
    backgroundTaskSupervisor: input.sdkHandle.backgroundTaskSupervisor,
    notifier: input.sdkHandle.notifier,
  };
  await input.store.registerHandle({
    agentRunId: input.agentRunId,
    handle,
  });
  return handle;
}

export interface CreateAgentRunInput {
  agentName: string;
}

export interface AgentRunStore {
  create(input: CreateAgentRunInput): Promise<{ agentRunId: AgentRunId }>;
  registerHandle(input: { agentRunId: AgentRunId; handle: AgentRunHandle<unknown> }): Promise<void>;
  appendEvent(input: { agentRunId: AgentRunId; event: AgentEvent }): Promise<void>;
  finish(input: {
    agentRunId: AgentRunId;
    outcome: AgentOutcome<unknown>;
  }): Promise<void>;
  failStart(input: { agentRunId: AgentRunId; reason: string }): Promise<void>;
  readEvents(input: {
    agentRunId: AgentRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }>;
}

export class JsonlAgentRunStore implements AgentRunStore {
  readonly #rootDir: string;
  readonly #handles = new Map<AgentRunId, AgentRunHandle<unknown>>();

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async create(input: CreateAgentRunInput): Promise<{ agentRunId: AgentRunId }> {
    const agentRunId = mintAgentRunId();
    const dir = this.#runDir(agentRunId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "meta.json"),
      `${JSON.stringify({
        agentRunId,
        agentName: input.agentName,
        status: "running",
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    return { agentRunId };
  }

  registerHandle(input: { agentRunId: AgentRunId; handle: AgentRunHandle<unknown> }): Promise<void> {
    this.#handles.set(input.agentRunId, input.handle);
    return Promise.resolve();
  }

  appendEvent(input: { agentRunId: AgentRunId; event: AgentEvent }): Promise<void> {
    return appendFile(
      join(this.#runDir(input.agentRunId), "events.jsonl"),
      `${JSON.stringify(input.event)}\n`,
      "utf8",
    );
  }

  async finish(input: {
    agentRunId: AgentRunId;
    outcome: AgentOutcome<unknown>;
  }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.agentRunId), "outcome.json"),
      `${JSON.stringify({
        status: "finished",
        finishedAt: new Date().toISOString(),
        outcome: input.outcome,
      })}\n`,
      "utf8",
    );
  }

  async failStart(input: { agentRunId: AgentRunId; reason: string }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.agentRunId), "outcome.json"),
      `${JSON.stringify({
        status: "start_failed",
        finishedAt: new Date().toISOString(),
        reason: input.reason,
      })}\n`,
      "utf8",
    );
  }

  async readEvents(input: {
    agentRunId: AgentRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }> {
    let raw: string;
    try {
      raw = await readFile(
        join(this.#runDir(input.agentRunId), "events.jsonl"),
        "utf8",
      );
    } catch {
      return { total: 0, lines: [], eof: true };
    }
    const lines = raw.split("\n").filter((line) => line.length > 0);
    const page = lines.slice(input.offset, input.offset + input.limit);
    return {
      total: lines.length,
      lines: page,
      eof: input.offset + input.limit >= lines.length,
    };
  }

  #runDir(agentRunId: AgentRunId): string {
    return join(this.#rootDir, agentRunId);
  }
}
