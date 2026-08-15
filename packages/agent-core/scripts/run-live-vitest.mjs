import { spawn } from "node:child_process";
import process from "node:process";

const child = spawn(
  process.execPath,
  [
    "--use-env-proxy",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.e2e.config.ts",
    ...process.argv.slice(2),
  ],
  {
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
  }
  process.exitCode = code ?? 1;
});
