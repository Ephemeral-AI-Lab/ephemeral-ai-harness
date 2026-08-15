import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { AgentProfile, AgentProfileRegistry } from "@ephai/agent-engine/agents";

import { zodIssues } from "./diagnostics.js";

/**
 * One host profile: Markdown frontmatter plus the body as the system prompt.
 * Profiles carry no role/kind discriminator (spec §1.1); planner/worker
 * membership is validated by the pursuit provider at registration, not here.
 */
export interface AgentProfileSources {
  /** Global profiles loaded recursively from `.ephai/agents`. */
  agentsDir: string;
}

// `.strict()` rejects every unrecognized key, so dropped role/kind and
// unsupported fields fail to parse without this source naming them.
const FrontmatterSchema = z
  .object({
    name: z.string().min(1),
    llm_client_id: z.string().min(1),
    description: z.string().min(1).optional(),
    max_turns: z.number().int().positive().optional(),
    allowed_tools: z.array(z.string().min(1)),
    subagents: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** `---\n<yaml>\n---\n<body>`; the first `---` line must open the file. */
const FRONTMATTER_SHAPE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*|)$/;

/**
 * Load every profile under `.ephai/agents` and apply the self-contained
 * startup rules: unique names, and `subagents` targets that name known
 * profiles (a subagent launch supplies no outcome function).
 */
export function loadAgentProfiles(sources: AgentProfileSources): AgentProfileRegistry {
  const byName = new Map<string, AgentProfile>();
  for (const path of markdownFilesRecursive(sources.agentsDir).sort()) {
    const profile = loadAgentProfile(path);
    if (byName.has(profile.name)) {
      throw new Error(
        `duplicate agent profile name "${profile.name}" (${profile.source_path})`,
      );
    }
    byName.set(profile.name, profile);
  }

  for (const profile of byName.values()) {
    for (const target of profile.subagents) {
      const sub = byName.get(target);
      if (!sub) {
        throw new Error(`agent profile "${profile.name}" names unknown subagent "${target}"`);
      }
    }
  }

  return {
    require(name) {
      const profile = byName.get(name);
      if (!profile) {
        const known = [...byName.keys()].join(", ") || "none";
        throw new Error(`unknown agent profile "${name}" (configured: ${known})`);
      }
      return profile;
    },
    list: () => [...byName.values()],
  };
}

/** Parse one profile file; every failure names the offending path. */
export function loadAgentProfile(path: string): AgentProfile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`agent profile ${path} is not readable`, { cause: error });
  }
  const match = FRONTMATTER_SHAPE.exec(raw);
  if (!match) {
    throw new Error(`agent profile ${path} must open with a --- YAML frontmatter block`);
  }
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch (error) {
    throw new Error(`agent profile ${path} has invalid YAML frontmatter`, { cause: error });
  }
  const parsed = FrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`agent profile ${path} is invalid: ${zodIssues(parsed.error)}`);
  }
  return { ...parsed.data, system_prompt: match[2].trim(), source_path: path };
}

function markdownFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFilesRecursive(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}
