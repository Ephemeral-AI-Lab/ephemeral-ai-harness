import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const EPHAI_DIR_NAME = ".ephai";

/**
 * The operator config root: the nearest `.ephai` directory walking up
 * from the working directory, so a process started anywhere inside the
 * checkout loads the repo-root config. Falls back to `<cwd>/.ephai`
 * when no ancestor owns one.
 */
export function ephaiConfigRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, EPHAI_DIR_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return resolve(EPHAI_DIR_NAME);
    dir = parent;
  }
}

/** The directory owning `.ephai`; config-relative paths resolve here. */
export function configBaseDir(): string {
  return dirname(ephaiConfigRoot());
}
