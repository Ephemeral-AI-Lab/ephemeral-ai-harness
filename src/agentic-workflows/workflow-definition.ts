import type { JsonObject } from "../contracts/index.js";
import type { NodeDefinition } from "../nodes/index.js";

export interface WorkflowDefinition {
  description?: string;
  nodes?: readonly NodeDefinition[];
  args?: JsonObject;
  metadata?: JsonObject;
}
