# @ephai/agent-core

A **mechanism-only** agent runtime for TypeScript. It runs the agent loop —
provider turns, a tool-call batch executor, hooks, background tasks,
notifications, steering/interruption, and a JSONL run record — and **ships zero
tools and zero policy**. Every tool, every prompt, and every gate is authored by
the host. The coding-agent product is one such host; this package owns only the
runtime spine beneath it.

> Status: pre-release (`0.0.0`, private workspace package). Consumed as TypeScript
> source within the EphemeralOS monorepo, not published to npm. ESM-only
> (`NodeNext`), package-managed with **pnpm**.

## Design stance

- **The SDK ships no tools.** `AgentSpec.tools` is where *all* tools arrive; the
  engine never branches on tool identity.
- **Hooks are callbacks, not config files.** Three events (`preToolUse`,
  `postToolUse`, `turnBoundary`), matched by tool name.
- **Outcomes are typed.** A run finishes either through a host-defined *terminal
  tool* (with a Zod payload schema) or, if none is given, from a bare-text
  assistant turn (outcome is `string`).
- **Providers live at the edge.** Anthropic + OpenAI wire shapes are normalized
  behind one `LlmClient`; nothing provider-specific leaks into the contracts.
- **Narrow public surface.** Everything you can construct or hold is re-exported
  from `src/index.ts` — the construction values (`createAgentRuntime`, `defineTool`,
  `createAgentOutcomeFn`, and the `agentOutcomeToolName` read-back) plus a set of
  types. No schemas, no subprocess execution, no filesystem beyond `recordsDir`.

## Run anatomy

```
createAgentRuntime(config)                         src/agents/agent-runtime.ts
  └─ runtime.createAgent(spec)    → Agent       (validates llm ref + tool names)
       └─ agent.start({messages}) → AgentRunHandle
            run loop                         ─▶  src/agents/engine/
              ├─ provider turn      ─────────▶  src/agents/llm-client/
              ├─ tool batch         ─────────▶  src/agents/tool/
              │    ├─ preToolUse / postToolUse hooks
              │    ├─ background tasks ───────▶  src/agents/background/
              │    └─ notifications  ─────────▶  src/agents/notification/
              ├─ steer() / interrupt() at boundaries
              └─ records ────────────────────▶  src/agents/engine/records.ts
```

## Quick start

```ts
import {
  createAgentRuntime,
  defineTool,
  createAgentOutcomeFn,
  type UserMessage,
} from "@ephai/agent-core";
import { z } from "zod";

// 1 — a host-authored tool (the SDK ships none)
const getWeather = defineTool({
  name: "get_weather",
  description: "Current weather for a city.",
  input: z.object({ city: z.string() }),
  execute: async ({ city }, ctx) => ({ output: `${city}: 21°C, clear` }),
});

// 2 — a typed terminal outcome (omit to use plain-text termination)
const submit = createAgentOutcomeFn({
  name: "submit_answer",
  schema: z.object({ summary: z.string() }),
  // optional: vet the payload, or send the model back in-run
  onSubmit: async (payload) => ({ accept: payload }),
});

// 3 — bind process config: providers, global hooks, records dir
const runtime = createAgentRuntime({
  llmClients: {
    main: {
      model: "claude-sonnet-4-6",
      connection: { provider: "anthropic_api", api_key: process.env.ANTHROPIC_API_KEY! },
    },
  },
  recordsDir: "./.runs",
});

// 4 — a reusable agent template (concurrent runs allowed)
const agent = runtime.createAgent({
  name: "weather-bot",
  llm: "main",
  systemPrompt: "Use get_weather, then call submit_answer.",
  tools: [getWeather],
  agentOutcomeFn: submit, // outcome type T is inferred as { summary: string }
});

// 5 — start a run, stream live events, await the typed outcome
const seed: UserMessage = { role: "user", content: [{ type: "text", text: "Weather in Paris?" }] };
const run = agent.start({ messages: [seed] });

for await (const event of run.events()) {
  if (event.type === "tool_execution_completed") console.log(event.name, "→", event.output);
}

const result = await run.outcome();
if (result.status === "completed") console.log(result.outcome.summary);
```

Drop `agentOutcomeFn` and the run completes from a bare-text turn with
`outcome: string` instead.

## Testing without a network

The `@ephai/agent-core/testkit` subpath ships a scripted client and message builders,
so unit tests drive the real loop deterministically — no credentials, no sockets.

```ts
import { createAgentRuntime } from "@ephai/agent-core";
import {
  ScriptedLlmClient, scriptedTurn, complete, assistantMessage, textBlock, userMessage,
} from "@ephai/agent-core/testkit";

const runtime = createAgentRuntime({
  llmClients: {
    test: {
      model: "m",
      client: new ScriptedLlmClient([
        scriptedTurn([complete(assistantMessage(textBlock("done")))]),
      ]),
    },
  },
});

const agent = runtime.createAgent({ name: "t", llm: "test", systemPrompt: "x", tools: [] });
const out = await agent.start({ messages: [userMessage("hi")] }).outcome();
// out → { status: "completed", outcome: "done", usage, turns }
```

## Core concepts

| Concept | Type / entry | Notes |
|---|---|---|
| **Agent runtime** | `createAgentRuntime(config)` → `AgentRuntime` | Builds every llm client eagerly; bad config fails here, never mid-run. |
| **Agent** | `runtime.createAgent(spec)` → `Agent<T>` | Reusable template. Validates the llm ref + tool-name uniqueness at construction. |
| **Run** | `agent.start({ messages })` → `AgentRunHandle<T>` | One live run. Many concurrent runs per template are allowed. |
| **Tool** | `defineTool({ name, description, input, execute })` | `execute(input, ctx)` → `ToolResult` = `{ output }` \| `{ error }`. |
| **Terminal outcome** | `createAgentOutcomeFn({ name, schema, onSubmit? })` | Mints the terminal tool; `onSubmit` returns `{ accept: T }` or `{ reject: reason }`. |
| **Hooks** | `HookEntry[]` (global + per-agent) | `preToolUse` · `postToolUse` · `turnBoundary`. |
| **Background tasks** | `ctx.backgroundTaskSupervisor` | `register` / `list` / `cancel`; each task declares `onCompletion` or `silent: true`. |
| **Notifications** | `ctx.notifier.publish(msg, { key? })` | Drains into the conversation at the next turn boundary; same `key` coalesces. |
| **Records** | `recordsDir` | Writes `<recordsDir>/<runId>/events.jsonl` + `messages.jsonl`. |

### The run handle

```ts
interface AgentRunHandle<T = string> {
  runId: AgentRunId;
  steer(message: UserMessage): boolean;   // queue for next boundary; false once finishing
  interrupt(): void;                      // idempotent stop → outcome status "cancelled"
  outcome(): Promise<AgentOutcome<T>>;    // always resolves, memoized, never rejects
  events(): AsyncIterable<AgentEvent>;    // live-only, single consumer, run_finished is last
  backgroundTaskSupervisor: BackgroundTaskSupervisor;
  notifier: Notifier;
}

type AgentOutcome<T> = { usage; turns } & (
  | { status: "completed"; outcome: T }
  | { status: "failed"; error: { kind: "max_turns" | "provider_error" | "internal"; message } }
  | { status: "cancelled" }
);
```

### Hooks

| Event | Signature | Effect |
|---|---|---|
| `preToolUse` | `(call) => HookDecision` | `deny` ⇒ the call never executes; the reason returns to the model as a recoverable tool error. |
| `postToolUse` | `(call, result) => HookDecision` | `deny` ⇒ replaces the executed result with a recoverable error. |
| `turnBoundary` | `(turnFacts, { notifier, runId }) => void` | Observe-only; may publish notifications. The seam where a host compiles its notification rules. |

`HookDecision` is `{ decision: "passthrough" }` or `{ decision: "deny"; reason }`.
Pre/post hooks see per-call facts only (no conversation), so terminal payload
schemas must be self-contained enough to vet. A throwing pre/post hook fails
closed (deny); a throwing `turnBoundary` is recorded and skipped.

### Providers

`llmClients` maps a name (`LlmRef`) to a profile: `{ model, reasoningEffort?,
maxTokens? }` plus either a `connection` (built for you) or an injected `client`.

| `connection.provider` | wire | credential |
|---|---|---|
| `anthropic_api` | Anthropic Messages | `api_key` |
| `openai_api` | OpenAI Responses | `api_key` |
| `claude_coding_plan` | Anthropic Messages (+ Claude Code system prefix) | `access_token` |
| `codex_coding_plan` | OpenAI Responses (codex dialect) | `access_token` |

`base_url` defaults per provider and can be overridden (gateways, proxies,
self-hosted). Credentials accept a raw string or a `SecretString`.

## Package layout

| Module | Owns |
|---|---|
| `src/contracts` | Typed IDs, the JSON value model, message/content-block schemas, the settled tool-call DTO. |
| `src/agents` | Generic agent contracts, `createAgentRuntime`, direct agent run handles, and the SDK-owned agent runtime infrastructure. |
| `src/agents/llm-client` | `LlmClient`, the Anthropic/OpenAI wires, access (auth) strategies, retry, streaming, and the runtime profile registry. |
| `src/agents/engine` | The run loop: `RunHandle` + events, `Conversation`, the provider turn, the tool-executor port, and the agent JSONL records writer. |
| `src/agents/tool` | `defineTool`, the batch executor + pipeline, the `HookEngine`, and the terminal-outcome factory. |
| `src/agents/background` | The run-scoped background-task supervisor. |
| `src/agents/notification` | The inbox the loop drains and the host-facing `Notifier`. |
| `src/runs` | Shared run handles, event streams, interruption, and record-scope primitives. |
| `src/nodes` | Node definitions, node inputs, node outcome contracts, node run handles, and the `NodeRunner` boundary. |
| `src/workflows` | Workflow contracts, ledger, and state-machine runtime. |

## Scripts

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint
pnpm run test        # vitest (unit; tests/)
pnpm run check       # typecheck + lint + test
pnpm run test:e2e    # live-provider suite (e2e/; manual, needs credentials)
```

Unit tests live in `tests/` (mirroring `src/`); the live-provider matrix lives in
`e2e/runtime/` (see its `readme.md`). E2E tests are excluded from `pnpm run
check` and never run in CI.

## Code explorer

Code explorer artifacts are local generated inventory output and are not tracked
in this package. In the composed workspace, keep those files under the parent
repository's ignored `code-inventory/` directory.
