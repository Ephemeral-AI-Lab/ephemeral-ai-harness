import { describe, expect, it } from "vitest";

import {
  buildLlmRequest,
  type LlmStreamEvent,
} from "../../src/llm-client/index.js";
import { loadCatalogCodex } from "./support/catalog-codex.js";

const codex = loadCatalogCodex();

if (!codex.available) {
  console.warn(`live pi-ai Codex test skipped: ${codex.reason}`);
}

describe.skipIf(!codex.available)("live pi-ai Codex provider", () => {
  it(
    "writes and prints an original song through the agent-core contract",
    { timeout: 120_000 },
    async () => {
      if (!codex.available) throw new Error("unreachable: Codex is unavailable");

      const events: LlmStreamEvent[] = [];
      const client = codex.createClient();
      const request = buildLlmRequest({
        model: codex.model,
        system_prompt:
          "You are a songwriter. Return lyrics only. Do not imitate any existing artist or song.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Write a complete original song about an AI agent building something meaningful through a proxy.",
                  "Use exactly these sections: [Verse 1], [Chorus], [Verse 2], [Bridge], [Final Chorus].",
                  "Make the chorus recur and write at least two lines per section.",
                  "Return lyrics only.",
                ].join("\n"),
              },
            ],
          },
        ],
        reasoning_effort: "medium",
      });

      for await (const event of client.streamMessage(request)) {
        events.push(event);
      }

      const song = events
        .filter(
          (event): event is Extract<LlmStreamEvent, { type: "assistant_text_delta" }> =>
            event.type === "assistant_text_delta",
        )
        .map((event) => event.text)
        .join("");

      process.stdout.write(
        `\n--- live Codex song (${codex.model}) ---\n${song}\n--- end song ---\n`,
      );

      expect(song.length).toBeGreaterThan(80);
      expect(song).toMatch(/verse\s*1/i);
      expect(song).toMatch(/chorus/i);
      expect(song).toMatch(/verse\s*2/i);
      expect(song).toMatch(/bridge/i);
      expect(song).toMatch(/final\s+chorus/i);
      expect(events.at(-1)?.type).toBe("assistant_message_complete");
    },
  );
});
