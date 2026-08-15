import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

export function runtimeFixturePath(fileName: string): string {
  return join(import.meta.dirname, "..", "fixtures", fileName);
}

export function loadRuntimeJsonFixture<T>(
  fileName: string,
  schema: z.ZodType<T>,
): T {
  const path = runtimeFixturePath(fileName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read runtime JSON fixture ${path}`, {
      cause: error,
    });
  }
  return schema.parse(parsed);
}

export function loadRuntimeMarkdownFixture(fileName: string): string {
  const path = runtimeFixturePath(fileName);
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    throw new Error(`failed to read runtime Markdown fixture ${path}`, {
      cause: error,
    });
  }
}
