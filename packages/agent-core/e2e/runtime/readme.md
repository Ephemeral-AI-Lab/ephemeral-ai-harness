# Runtime E2E Suite

## Overview

`e2e/runtime` is the live-provider E2E suite for the mechanism-only
`@ephai/agent-core` runtime. These tests exercise `createAgentRuntime` against the
configured Codex client, with SDK-local mock tools, hooks, background tasks,
notifications, and event streams. They deliberately do not import
`@ephai/coding-agent`.

Current live suite: 29 tests across 13 focused E2E files.

The suite covers SDK-owned runtime behavior:

- LLM-driven agent loop completion in terminal-tool and text modes.
- Custom tool execution, validation, batch execution, and result ordering.
- Terminal submission gates, rejection recovery, duplicate submission latching,
  and commit-window steering refusal.
- Hook callbacks, post-hook denial, and a host-expressible advisory gate.
- Background task registration, cancellation, failure settlement, notification
  wakeups, and text/terminal gates.
- Notification coalescing, steer priority, and spoof-safe rendering.
- Run interruption during tool execution and while parked on background work.
- Steering as a park wake source and as a text-mode run extension.
- Dense event sequencing, stream finality, and early consumer detach.
- Runtime fixture configuration loaded from JSON and Markdown files.

Host-policy behavior remains out of scope here: profile loading, subprocess hook
runners, built-in coding-agent tools, advisor implementation details, subagent
tool families, workflow submission bindings, and coding-agent notification rule
wording belong in `@ephai/coding-agent` or unit tests around the owning package.

## Run Instructions

Run commands from the TypeScript workspace:

```bash
cd /Users/yifanxu/machine_learning/LoVC/EphemeralOS/@ephai/agent-core
```

The tests read live credentials through the same helper as `e2e/llm-client`:
`EOS_LLM_CLIENTS_PATH` if set, otherwise
`/Users/yifanxu/machine_learning/LoVC/EphemeralOS/packages/coding-agent/.ephai/llm-clients/llm-clients.json`.
If the config or auth is unavailable, each suite clean-skips with the loader
reason. These tests are manual laptop checks, not part of `pnpm run check`.

Run the whole runtime suite:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime
```

Run one feature suite:

| Feature | Command |
| --- | --- |
| Agent loop | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/agent-loop/agent-loop.e2e.ts` |
| Background tasks | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/background-tasks/background-tasks.e2e.ts` |
| Fixture configuration | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/configuration/configuration.e2e.ts` |
| Event stream | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/events/events.e2e.ts` |
| Hooks and advisory gate | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/hooks/hooks.e2e.ts` |
| Interruption | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/interruption/interruption.e2e.ts` |
| Notifications | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/notification/notification.e2e.ts` |
| SDK composition | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/sdk-composition/sdk-composition.e2e.ts` |
| Steering | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/steering/steering.e2e.ts` |
| Submission gates | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/submission-gates/submission-gates.e2e.ts` |
| Terminal submission | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/terminal-submission/terminal-submission.e2e.ts` |
| Text gates | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/text-gates/text-gates.e2e.ts` |
| Tool pipeline | `pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/tool/tool.e2e.ts` |

Run one test by title:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/tool/tool.e2e.ts -t "executes a concurrent batch"
```

Local verification ladder for changes in this folder:

```bash
pnpm run typecheck
pnpm run lint
pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime/<feature>/<file>.e2e.ts
pnpm exec vitest run --config vitest.e2e.config.ts e2e/runtime
```

## Test Infrastructure

Shared runtime setup lives under `support/`. `support/runtime.ts` is a facade
that preserves existing `../support/runtime.js` imports.

```text
support/
├── agents.ts     # SDK/agent factories, outcome schema, prompt/message helpers
├── config.ts     # live Codex loader, suite constants, clean skip reason
├── events.ts     # live event collection, polling, sleeps, tool-event filters
├── fixtures.ts   # JSON and Markdown fixture loaders
└── runtime.ts    # compatibility re-export facade
```

| Helper | Purpose |
| --- | --- |
| `createRuntimeAgentRuntime()` | Creates an agent runtime bound to the configured live Codex client, global hooks, and task completion timeout. |
| `createRuntimeOutcomeAgent()` | Standard terminal-outcome agent factory for most runtime E2E cases; keeps LLM id, system prompt, terminal schema, and default turn budget consistent. |
| `runtimeSystemPrompt()` | Terse common prompt that keeps provider behavior deterministic while allowing per-test extra instructions. |
| `runtimeUserSteps()` | Turns numbered step arrays into a single user message. |
| `collectEvents()`, `toolEvents()`, `waitUntil()` | Event stream collection and polling helpers for live timing windows. |
| `loadRuntimeJsonFixture()` | Reads `e2e/runtime/fixtures/*.json` with a caller-supplied Zod schema. |
| `loadRuntimeMarkdownFixture()` | Reads `e2e/runtime/fixtures/*.md` for prompt or fixture text. |

Fixture files are intentionally ordinary files, loaded with `node:fs` instead
of TypeScript import assertions. That keeps JSON and Markdown fixtures usable
under NodeNext/Vitest without adding loader configuration, and lets each test
validate its fixture with a narrow Zod schema.

The `configuration` suite is the reference pattern for custom test files:

1. Put data in `fixtures/<scenario>.json`.
2. Put long prompt text in `fixtures/<prompt>.md`.
3. Define a Zod schema in the owning test.
4. Build SDK-local mock tools from the fixture data.
5. Start a `createRuntimeOutcomeAgent()` run and assert the structured outcome.

## Suite Inventory

| Suite | Tests | Focus |
| --- | --- | --- |
| `agent-loop/agent-loop.e2e.ts` | completes through terminal outcome; completes text mode; tool before text; max-turn failure; boundary steer | Core loop exits, usage, single-consumer stream, text termination, failure classification, and steering. |
| `background-tasks/background-tasks.e2e.ts` | host cancellation wake; terminal gate while task open; failed task wake; completion-handler error | SDK background supervisor lifecycle, completion handlers, terminal blockers, failure settlement, completion-error events, and notification wakeups. |
| `configuration/configuration.e2e.ts` | loads JSON scenario and Markdown system prompt | Reusable fixture/config architecture for custom scenario files. |
| `events/events.e2e.ts` | dense sequence and tool lifecycle ordering | Live `AgentEvent` order, `seq` density, metadata propagation, and stream finality. |
| `hooks/hooks.e2e.ts` | prehook denial and post observation; advisory gate; post-hook denial | Callback hook channels, recoverable hook denials, terminal hook visibility, and host-side advisory gating without `@ephai/coding-agent`. |
| `interruption/interruption.e2e.ts` | interrupt in-flight tool; interrupt parked task | Abort propagation, cancellation outcome, suppressed straggler completions, and run-end task disposal. |
| `notification/notification.e2e.ts` | coalesced turn-boundary notification; steer priority and spoof escaping; tool-batch turn facts | Notification drain semantics, keyed replacement, event visibility, steer-before-notification order, safe rendering, and `turnBoundary` facts for tool turns. |
| `sdk-composition/sdk-composition.e2e.ts` | global and per-agent hooks; concurrent template reuse | SDK construction composition, hook merge behavior, and isolated concurrent starts from one agent template. |
| `steering/steering.e2e.ts` | steer wakes a parked run; steer extends a text-mode run | Steer as the park wake source (distinct from settlement/cancel/interrupt) and text-mode steer extension where the steered turn's text becomes the outcome. |
| `submission-gates/submission-gates.e2e.ts` | same-batch notification blocks terminal submission | Terminal submission guard against undrained notifications. |
| `terminal-submission/terminal-submission.e2e.ts` | `onSubmit` rejection recovery; duplicate terminal batch | Rejected terminal attempts as tool errors, distinct submission ids, finishing latch, commit-window steer refusal, and duplicate terminal denial. |
| `text-gates/text-gates.e2e.ts` | text answer parks on open task then completes on silent removal | Text-mode gate parity with terminal submission blockers. |
| `tool/tool.e2e.ts` | schema error recovery; concurrent batch with throwing sibling | Zod validation, tool context snapshots, parallel execution, sibling failure recovery, and batch result event order. |

## Feature Matrix

| Feature | Active coverage | Unit-only or host-only disposition |
| --- | --- | --- |
| Provider selection and wire errors | Runtime suite uses the configured live Codex client; provider auth/stream/retry taxonomy remains under `e2e/llm-client` and unit wire tests. | Provider fault injection, retry-after, malformed stream chunks, idle watchdog. |
| SDK composition | Global and per-agent hooks are composed in a live run; one agent template can start isolated concurrent runs; fixture loaders support JSON/Markdown scenario setup. | Construction faults such as duplicate tool names and empty starts are deterministic unit tests. |
| Agent loop | Terminal completion, text completion, tool-before-text, max-turn failure, steering, and event finality. | Provider restart histories and exact microtask races stay in unit/engine tests unless a live provider row is necessary. |
| Terminal submission | Rejection recovery, submission id uniqueness, commit-window latch, duplicate batch denial, and notification/background blockers. | Workflow-owned `submit_*_outcome` bindings and planner/worker mutation are outside SDK. |
| Tools | Custom tool execution, Zod input validation, context snapshot, concurrent batch overlap, throwing sibling recovery, and tool-result event ordering. | Built-in tool families, isolated workspace policy, allow lists, and unknown tool calls are host or unit territory. |
| Hooks | Callback pre/post hooks, terminal hook visibility, post-hook denial, and advisory-pass seam through host tool plus prehook. | Subprocess hook runners, hook config files, exact advisor transcript policy, and verdict parsing are coding-agent-owned. |
| Background tasks | Register/list/cancel, open-set lifecycle, completion handlers, completion-error events, task events, terminal/text blockers, natural failure settlement, and wake notifications. | Subagent recursion and fanout require host agent tools; silent empty wake is unit-covered. |
| Notifications | Turn-boundary publication, tool-turn facts, key coalescing, background completion publication, steer priority, and spoof-safe rendering. | Budget ladder, idle reminder wording, and rule-file execution are coding-agent policy. |
| Event stream | Dense live event stream, early-consumer detach, `run_finished` finality/outcome parity, and no raw stream deltas. | Durable event storage, run audit logs, transcript rollups, and cache-hit audit tables are coding-agent-owned. |
| Interruption | In-flight tool abort and parked-background interrupt, including run-end disposal of open tasks. | Multi-run cancellation isolation is unit-owned until SDK exposes a host run registry. |
| Steering | Boundary steer after an in-flight tool settles (agent-loop), steer priority over a same-boundary notification (notification), steer as a park wake source, and text-mode steer extension (steering). | The commit-window finishing latch is asserted via `steer()` returning false; the exact microtask race of a steer landing on a synchronous text finish stays unit-owned. |
| Text termination | Bare-text final answer, text-mode task gate, and steer-extended text completion. | Profile frontmatter validation and subagent settlement summaries are coding-agent/runtime-host concerns. |

## Spec Mapping

| Source spec | SDK-runtime coverage here | Out of SDK scope after split |
| --- | --- | --- |
| Phase 02 LLM client | Runtime tests consume the configured live Codex client and assert composed usage/events where the loop depends on provider behavior. | Provider wire golden tests, retry/backoff, auth taxonomy, malformed stream parsing. |
| Phase 02.5 provider composition | Live runtime suite exercises the configured client through `createAgentRuntime`; missing/unavailable config clean-skips. | Provider profile construction and auth-claim fixtures. |
| Phase 03 agent loop engine | Terminal completion, text completion, tool-before-text, max-turn failure, boundary steering, steer-driven park wake, interruption, event finality, and early event-consumer detach. | Scripted-only loop divergences and provider-history restart proofs unless promoted to an explicit live row. |
| Phase 04 tool framework | Tool validation, custom execution, terminal submission, background gates, batch concurrency, batch event order, thrown sibling recovery, completion-error events, and hook pipeline behavior. | Old batch-forbidden flags, isolated workspace mode, and built-in tool families. |
| Phase 04.5 agent runtime | Agent runtime wiring order through `createAgentRuntime`, concurrent template reuse, hooks, per-run notifier/supervisor handles, terminal submission, interruption, and fixture-driven setup. | Profile loader, run registry, subagent/advisor tools, transcript reader offsets, and durable record storage. |
| Phase 04.6 runtime E2E | The current suite implements the SDK-owned rows: loop, tools, gates, notifications, event streams, interruption, text mode, fixture configuration, and clean skip behavior. | Recursive subagent cancellation, fanout, profile-kind boundaries, durable records, and legacy host sessions. |
| Phase 04.7 run audit log | SDK exposes live events for hosts to consume. | Durable audit logs, transcript/result JSONL rollups, timeline files, and cache-hit audit tables are coding-agent-owned. |
| Phase 04.8 advisory pass | Host-expressible advisory gate is tested as a custom advisor tool plus terminal `preToolUse` callback. | `ask_advisor` implementation, advisory metadata on selected host tools, and hook config scripts. |
| Phase 04.9 notification trigger engine | `turnBoundary` hook publication, coalescing, priority, rendering, and task-completion publication are live-tested. | Notification rule files, subprocess trigger engine, budget/idle reminder wording. |
| Phase 04.10 text termination | Bare-text completion, tool-before-text completion, text-mode task gate, and steer-extended text completion are live-tested. | Text-mode profile-file validation and parent/subagent settlement summaries. |

## Legacy Migration Notes

This SDK package keeps only runtime-owned e2e coverage. Host-runtime behavior
belongs in host package suites, not in quarantined copies inside the SDK.

Portable into SDK runtime:

- Tool schema errors, custom mock tools, batch execution, sibling failure, and
  tool-result ordering.
- Hook denial/observation when expressed as in-process `HookEntry` callbacks.
- Notification wake, coalescing, steer priority, and rendering semantics.
- Background lifecycle and terminal/text submission gates.
- Interruption windows over SDK-local tools and background tasks.

Keep in host suites:

- Profile files/frontmatter, hook config JSON, subprocess hook execution,
  built-in coding-agent tools, subagent/advisor tool implementations, workflow
  bindings, transcript-offset readers, and notification rule wording.
