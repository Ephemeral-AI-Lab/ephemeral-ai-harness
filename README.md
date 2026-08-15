# ephemeral-ai-harness

`ephemeral-ai-harness` is a two-package agent runtime stack:

```text
@ephai/agent-core       generic runtime kernel
@ephai/agent-harness    concrete subagent and background tools
```

Packages live under [`packages/`](./packages/). The core package owns the
provider-neutral agent loop, contracts, tools, notifications, background tasks,
and LLM adapters. The harness package provides optional concrete tools for
subagent delegation and background-task control.

Run all package checks with:

```bash
pnpm install
pnpm check
```

See [`packages/agent-core/README.md`](./packages/agent-core/README.md) for the
runtime API documentation.
