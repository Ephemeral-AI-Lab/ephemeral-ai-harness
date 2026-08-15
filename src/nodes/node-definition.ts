export type NodeName = string;

export type NodeKind = "agent" | "workflow";

export type NodeDefinition = AgentNodeDefinition | WorkflowNodeDefinition;

export interface BaseNodeDefinition {
  kind: NodeKind;
  name: NodeName;
  description?: string;
}

export interface AgentNodeDefinition extends BaseNodeDefinition {
  kind: "agent";
}

export interface WorkflowNodeDefinition extends BaseNodeDefinition {
  kind: "workflow";
}
