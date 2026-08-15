import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  AgentMaxStepsError,
  AgentToolNotFoundError,
} from "../dist/index.js";

test("runs a model response through a tool and preserves the transcript", async () => {
  const requests = [];
  let call = 0;
  const agent = new Agent({
    instructions: "You are concise.",
    model: {
      async generate(request) {
        requests.push(request);
        call += 1;
        if (call === 1) {
          return {
            message: { content: "I will inspect the file.", role: "assistant" },
            toolCalls: [{ id: "call-1", input: { path: "README.md" }, name: "read" }],
          };
        }
        return {
          message: { content: "The file is ready.", role: "assistant" },
        };
      },
    },
    tools: [
      {
        name: "read",
        description: "Read a text file.",
        execute(input) {
          assert.deepEqual(input, { path: "README.md" });
          return "hello";
        },
      },
    ],
  });

  const events = [];
  const result = await agent.run("Prepare a summary.", {
    onEvent(event) {
      events.push(event.type);
    },
  });

  assert.equal(result.output, "The file is ready.");
  assert.equal(result.steps, 2);
  assert.deepEqual(
    result.messages.map(({ role, content, name }) => ({ role, content, name })),
    [
      { role: "system", content: "You are concise.", name: undefined },
      { role: "user", content: "Prepare a summary.", name: undefined },
      { role: "assistant", content: "I will inspect the file.", name: undefined },
      { role: "tool", content: "hello", name: "read" },
      { role: "assistant", content: "The file is ready.", name: undefined },
    ],
  );
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.deepEqual(events, [
    "model.request",
    "model.response",
    "tool.start",
    "tool.end",
    "model.request",
    "model.response",
    "run.complete",
  ]);
});

test("returns a structured tool error so the model can recover", async () => {
  let call = 0;
  const agent = new Agent({
    model: {
      async generate(request) {
        call += 1;
        if (call === 1) {
          return {
            message: { content: "Trying a tool.", role: "assistant" },
            toolCalls: [{ id: "call-missing", input: null, name: "missing" }],
          };
        }
        assert.match(request.messages.at(-1).content, /unknown tool/);
        return { message: { content: "I can continue.", role: "assistant" } };
      },
    },
  });

  const result = await agent.run("Continue.");
  assert.equal(result.output, "I can continue.");
});

test("bounds the model loop", async () => {
  const agent = new Agent({
    maxSteps: 1,
    model: {
      async generate() {
        return {
          message: { content: "Still working.", role: "assistant" },
          toolCalls: [{ id: "call-1", input: null, name: "missing" }],
        };
      },
    },
  });

  await assert.rejects(() => agent.run("Work."), AgentMaxStepsError);
});

test("rejects duplicate tools and exposes missing-tool errors", () => {
  assert.throws(
    () => new Agent({
      model: { generate: async () => ({ message: { content: "done", role: "assistant" } }) },
      tools: [
        { name: "same", execute: () => null },
        { name: "same", execute: () => null },
      ],
    }),
    /unique/,
  );
  assert.equal(new AgentToolNotFoundError("x").code, "AGENT_TOOL_NOT_FOUND");
});
