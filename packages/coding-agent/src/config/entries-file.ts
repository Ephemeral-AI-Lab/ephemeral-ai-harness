import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { z } from "zod";

import { zodIssues } from "./diagnostics.js";

/**
 * The mechanics shared by the operator config loaders (`hooks.json`,
 * `notification_rules.json`): a missing file means no entries; anything
 * else malformed is a startup error naming the Zod issues. `fillCwd`
 * gives commands without a `cwd` the config's owning directory.
 */
export function loadEntriesFile<E>(
  path: string,
  label: string,
  schema: z.ZodType<E[]>,
  fillCwd: (entry: E, cwd: string) => E,
): E[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`${label} ${path} is not readable`, { cause: error });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} ${path} is not valid JSON`, { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label} ${path} is invalid: ${zodIssues(parsed.error)}`);
  }
  const cwd = commandCwdFor(path);
  return parsed.data.map((entry) => fillCwd(entry, cwd));
}

export function withDefaultCwd<C extends { cwd?: string }>(command: C, cwd: string): C {
  return command.cwd === undefined ? { ...command, cwd } : command;
}

function commandCwdFor(path: string): string {
  const configDir = dirname(resolve(path));
  return basename(configDir) === ".ephai" ? dirname(configDir) : configDir;
}
