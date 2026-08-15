import type { z } from "zod";

/** One-line `path: message; ...` summary of a Zod error, for startup diagnostics. */
export function zodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
    .join("; ");
}
