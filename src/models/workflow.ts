export interface WorkflowParameter {
  name: string;
  placeholder: string;
  annotation: string;
  bindings: string[];
  required: boolean;
}

export interface WorkflowToolDefinition {
  workflow_id: string;
  tool_name: string;
  description: string;
  template: Record<string, any>;
  parameters: WorkflowParameter[];
  output_preferences: string[];
}
