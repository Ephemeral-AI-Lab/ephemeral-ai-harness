# ephemeral-ai-harness

`ephemeral-ai-harness` is a three-package agent runtime stack:

```text
@ephai/agent-core       generic runtime kernel
          ↑
@ephai/agent-engine     agent profiles, subagents, run stores
          ↑
@ephai/coding-agent     product composition root and CLI
```

Packages live under [`packages/`](./packages/). The core package owns the
provider-neutral agent loop, contracts, tools, notifications, background tasks,
and LLM adapters. The engine adds reusable agent orchestration. The coding-agent
package composes those capabilities into a host application.

Run all package checks with:

```bash
pnpm install
pnpm check
```

See [`packages/agent-core/README.md`](./packages/agent-core/README.md) for the
runtime API documentation.
