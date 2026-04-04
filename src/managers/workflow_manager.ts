import * as fs from 'fs';
import * as path from 'path';
import { WorkflowToolDefinition, WorkflowParameter } from '../models/workflow';

interface WorkflowFileInfo {
  path: string;
  mtime: number;
}

export class WorkflowManager {
  private workflowDir: string;
  private workflows: Map<string, WorkflowFileInfo> = new Map();
  private workflowCache: Map<string, WorkflowToolDefinition> = new Map();

  constructor(workflowDir: string) {
    this.workflowDir = workflowDir;
    this._discoverWorkflows();
  }

  private _discoverWorkflows(): void {
    if (!fs.existsSync(this.workflowDir)) {
      console.warn(`Workflow directory not found: ${this.workflowDir}`);
      return;
    }

    const files = fs.readdirSync(this.workflowDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.workflowDir, file);
        const stat = fs.statSync(filePath);
        const workflowId = file.replace('.json', '');
        this.workflows.set(workflowId, {
          path: filePath,
          mtime: stat.mtimeMs,
        });
      }
    }
  }

  public listWorkflows(): WorkflowToolDefinition[] {
    const result: WorkflowToolDefinition[] = [];
    
    for (const [workflowId, fileInfo] of this.workflows) {
      const workflow = this._loadWorkflow(workflowId);
      if (workflow) {
        result.push(workflow);
      }
    }
    
    return result;
  }

  public getWorkflow(workflowId: string): WorkflowToolDefinition | null {
    return this._loadWorkflow(workflowId);
  }

  private _loadWorkflow(workflowId: string): WorkflowToolDefinition | null {
    const fileInfo = this.workflows.get(workflowId);
    if (!fileInfo) {
      return null;
    }

    // Check cache and mtime
    const cached = this.workflowCache.get(workflowId);
    if (cached) {
      const stat = fs.statSync(fileInfo.path);
      if (stat.mtimeMs <= fileInfo.mtime) {
        return cached;
      }
    }

    // Load and parse workflow
    try {
      const content = fs.readFileSync(fileInfo.path, 'utf-8');
      const workflowData = JSON.parse(content);
      
      const toolDef = this._buildToolDefinition(workflowId, workflowData);
      if (toolDef) {
        this.workflowCache.set(workflowId, toolDef);
        // Update mtime
        const stat = fs.statSync(fileInfo.path);
        this.workflows.set(workflowId, { ...fileInfo, mtime: stat.mtimeMs });
      }
      
      return toolDef;
    } catch (error) {
      console.error(`Failed to load workflow ${workflowId}:`, error);
      return null;
    }
  }

  private _buildToolDefinition(
    workflowId: string,
    workflowData: Record<string, any>
  ): WorkflowToolDefinition | null {
    // Extract parameters from workflow
    const parameters = this._extractParameters(workflowData);
    
    // If no parameters, this is a hardcoded test workflow - don't register
    if (parameters.length === 0) {
      return null;
    }

    // Build tool name and description
    const toolName = workflowId.replace(/_/g, '_');
    
    // Extract prompt parameter to build description
    const promptParam = parameters.find(p => p.name.toLowerCase().includes('prompt'));
    let description = `Execute workflow: ${workflowId}`;
    if (promptParam) {
      description = `Generate content using ${workflowId} workflow`;
    }

    // Extract output preferences
    const outputPreferences = this._extractOutputPreferences(workflowData);

    return {
      workflow_id: workflowId,
      tool_name: toolName,
      description,
      template: workflowData,
      parameters,
      output_preferences: outputPreferences,
    };
  }

  private _extractParameters(workflowData: Record<string, any>): WorkflowParameter[] {
    const parameters: Map<string, WorkflowParameter> = new Map();

    for (const [nodeId, nodeData] of Object.entries(workflowData)) {
      if (typeof nodeData !== 'object' || !nodeData.inputs) continue;

      for (const [inputKey, inputValue] of Object.entries(nodeData.inputs)) {
        if (typeof inputValue === 'string' && inputValue.startsWith('PARAM_')) {
          const placeholder = inputValue;
          const paramInfo = this._parseParamPlaceholder(placeholder, inputKey, nodeId);
          
          if (!parameters.has(paramInfo.name)) {
            parameters.set(paramInfo.name, paramInfo);
          } else {
            // Add binding
            const existing = parameters.get(paramInfo.name)!;
            if (!existing.bindings.includes(`${nodeId}.${inputKey}`)) {
              existing.bindings.push(`${nodeId}.${inputKey}`);
            }
          }
        }
      }
    }

    return Array.from(parameters.values());
  }

  private _parseParamPlaceholder(
    placeholder: string,
    inputKey: string,
    nodeId: string
  ): WorkflowParameter {
    // PARAM_INT_SEED -> type: int, name: seed
    // PARAM_FLOAT_CFG -> type: float, name: cfg
    // PARAM_STR_SAMPLER_NAME -> type: string, name: sampler_name
    // PARAM_PROMPT -> type: string, name: prompt
    
    const parts = placeholder.split('_');
    if (parts.length < 2 || parts[0] !== 'PARAM') {
      throw new Error(`Invalid parameter placeholder: ${placeholder}`);
    }

    const typePart = parts[1].toLowerCase();
    const name = parts.slice(2).map(p => p.toLowerCase()).join('_');
    
    let annotation: string;
    switch (typePart) {
      case 'int':
        annotation = 'integer';
        break;
      case 'float':
        annotation = 'number';
        break;
      case 'str':
        annotation = 'string';
        break;
      default:
        annotation = 'string';
    }

    // Determine if required
    const required = name === 'prompt' || name === 'tags' || name === 'lyrics';

    return {
      name,
      placeholder,
      annotation,
      bindings: [`${nodeId}.${inputKey}`],
      required,
    };
  }

  private _extractOutputPreferences(workflowData: Record<string, any>): string[] {
    const preferences = new Set<string>();
    
    for (const [, nodeData] of Object.entries(workflowData)) {
      if (typeof nodeData !== 'object' || nodeData.class_type !== 'SaveImage') continue;
      
      // Check what this node outputs
      if (nodeData.inputs?.filename_prefix) {
        preferences.add('images');
      }
    }

    return Array.from(preferences);
  }

  public renderWorkflow(
    workflowId: string,
    parameterValues: Record<string, any>,
    defaults: Record<string, any>,
    constrainedOverrides: Record<string, any> = {}
  ): Record<string, any> | null {
    const toolDef = this.getWorkflow(workflowId);
    if (!toolDef) {
      return null;
    }

    // Deep clone the template
    const workflow = JSON.parse(JSON.stringify(toolDef.template));

    // Apply parameter values
    for (const param of toolDef.parameters) {
      let value = parameterValues[param.name];
      
      // Fall back to defaults
      if (value === undefined || value === null) {
        value = defaults[param.name];
      }

      // Apply constrained overrides
      if (param.name in constrainedOverrides) {
        const overrideValue = constrainedOverrides[param.name];
        // Only apply if it's a valid type
        if (this._isValidType(overrideValue, param.annotation)) {
          value = overrideValue;
        }
      }

      // Coerce type
      value = this._coerceType(value, param.annotation);

      // Apply to all bindings
      for (const binding of param.bindings) {
        const [nodeId, ...keyParts] = binding.split('.');
        const key = keyParts.join('.');
        
        if (workflow[nodeId] && workflow[nodeId].inputs && key in workflow[nodeId].inputs) {
          workflow[nodeId].inputs[key] = value;
        }
      }
    }

    return workflow;
  }

  private _isValidType(value: any, annotation: string): boolean {
    if (value === undefined || value === null) return false;
    
    switch (annotation) {
      case 'integer':
        return Number.isInteger(value);
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      default:
        return true;
    }
  }

  private _coerceType(value: any, annotation: string): any {
    if (value === undefined || value === null) return value;
    
    switch (annotation) {
      case 'integer':
        return typeof value === 'string' ? parseInt(value, 10) : Math.floor(Number(value));
      case 'number':
        return typeof value === 'string' ? parseFloat(value) : Number(value);
      case 'string':
        return String(value);
      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1';
        }
        return Boolean(value);
      default:
        return value;
    }
  }
}
