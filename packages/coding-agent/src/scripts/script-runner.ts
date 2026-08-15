import { extname, isAbsolute, resolve } from "node:path";

import { executeJsonCommand, type ExecutedCommandResult } from "./execute-json-command.js";

const TSX_LOADER = import.meta.resolve("tsx");

export interface ScriptCommand {
  command: string;
  cwd: string;
}

/**
 * Resolve a configured script path against a base directory and choose the
 * runtime command from the file extension. The path may live anywhere the
 * config author points it; callers own any domain-specific policy.
 */
export function resolveScriptCommand(baseDir: string, path: string): ScriptCommand {
  const scriptPath = isAbsolute(path) ? path : resolve(baseDir, path);
  const quoted = JSON.stringify(scriptPath);
  const ext = extname(scriptPath);
  if (ext === ".cjs" || ext === ".mjs" || ext === ".js") {
    return { command: `node ${quoted}`, cwd: baseDir };
  }
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    return { command: `node --import ${JSON.stringify(TSX_LOADER)} ${quoted}`, cwd: baseDir };
  }
  throw new Error(`script ${scriptPath} must be a .cjs, .mjs, .js, .ts, .mts, or .cts file`);
}

export function runJsonScript(
  script: ScriptCommand,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ExecutedCommandResult> {
  return executeJsonCommand(script, payload, signal);
}
