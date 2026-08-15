import type {
  AgentNodeDefinition,
  NodeDefinition,
  WorkflowNodeDefinition,
} from "./node-definition.js";
export interface Node {
  readonly definition: NodeDefinition;
}

export interface AgentNode extends Node {
  readonly definition: AgentNodeDefinition;
}

export interface WorkflowNode extends Node {
  readonly definition: WorkflowNodeDefinition;
}
