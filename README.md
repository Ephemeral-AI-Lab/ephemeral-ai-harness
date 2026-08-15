# Ephemeral Agent Core

Provider-neutral runtime primitives for building AI agents.

This package owns the small, reusable part of an agent runtime: message
history, model calls, bounded tool dispatch, cancellation, and observable run
events. Model providers, prompt policies, persistence, and integrations stay
outside the core so they can evolve independently.

> **Status:** early foundation. The API is intentionally small and may change
> before the first stable release.

## Quick start

```ts
import { Agent } from "@ephemeralai/agent-core"

const agent = new Agent({
  instructions: "Answer briefly.",
  model: {
    async generate({ messages, tools }) {
      // Adapt your model provider here.
      console.log({ messages, tools })
      return { message: { role: "assistant", content: "Hello from the model." } }
    },
  },
})

const result = await agent.run("Say hello.")
console.log(result.output)
```

Tools are provider-neutral functions. When a model returns a tool call, the
agent executes it, appends the result to the transcript, and asks the model to
continue until it returns a final response or reaches its step limit.

```ts
const agent = new Agent({
  model,
  tools: [{
    name: "add",
    description: "Add two numbers.",
    execute(input) {
      const { left, right } = input as { left: number; right: number }
      return left + right
    },
  }],
})
```

## Design goals

- Keep the runtime independent of any model vendor or agent framework.
- Make every model and tool boundary explicit and strongly typed.
- Bound autonomous work with a configurable maximum number of model steps.
- Surface progress through a small event stream without requiring an event bus.
- Preserve a complete, inspectable transcript for persistence and evaluation.

## Development

Requires Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm typecheck
pnpm test
```

## License

MIT. See [LICENSE](LICENSE).
