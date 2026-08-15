import type { AgentEvent } from "../../../src/index.js";

export function collectEvents(run: { events(): AsyncIterable<AgentEvent> }): {
  events: AgentEvent[];
  done: Promise<void>;
} {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of run.events()) events.push(event);
  })();
  return { events, done };
}

export async function waitUntil(
  label: string,
  done: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function sawToolEvent(events: AgentEvent[], name: string): boolean {
  return events.some(
    (event) => event.type === "tool_execution_completed" && event.name === name,
  );
}

export function toolEvents(
  events: AgentEvent[],
  name: string,
): Extract<AgentEvent, { type: "tool_execution_completed" }>[] {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: "tool_execution_completed" }> =>
      event.type === "tool_execution_completed" && event.name === name,
  );
}
