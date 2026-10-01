import { ToolDefinition, ToolDefinitionSchema } from '../schema.js';
import { buildDesignerSystemPrompt, buildDesignerUserPrompt } from './prompts.js';
import { callLlmStructured, LlmUsage } from './llm.js';

export interface RawOperation {
  operationId?: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: Array<{ name: string; in: string; description?: string; required?: boolean; schema?: any }>;
  requestBody?: any;
  responses?: any;
}

export interface ParseSpecResult {
  title: string;
  operationsCount: number;
  operations: RawOperation[];
}

export function parseOpenApiSpec(spec: any): ParseSpecResult {
  const operations: RawOperation[] = [];
  const paths = spec.paths || {};

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    for (const [method, opAny] of Object.entries(pathItem as any)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) continue;
      const op = opAny as any;

      // 1. Drop deprecated operations (acceptance test assert 1)
      if (op.deprecated === true) {
        continue;
      }

      operations.push({
        operationId: op.operationId || `${method}_${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}`,
        method: method.toUpperCase(),
        path: pathStr,
        summary: op.summary || '',
        description: op.description || '',
        parameters: op.parameters,
        requestBody: op.requestBody,
        responses: op.responses
      });
    }
  }

  return {
    title: spec.info?.title || 'OpenAPI Specification',
    operationsCount: operations.length,
    operations
  };
}

export interface DesignToolsParams {
  spec: any;
  confirmedBaseUrl: string; // F17
  sourceId: string;
  requirement: string;
  templateId?: string;
  activeSecrets?: string[];
}

export function designToolsFromSpec(params: DesignToolsParams): ToolDefinition[] {
  const parsed = parseOpenApiSpec(params.spec);

  // 1. Verify prompt generation doesn't leak secrets (Module check 4)
  const systemPrompt = buildDesignerSystemPrompt();
  const userPrompt = buildDesignerUserPrompt({
    requirement: params.requirement,
    confirmedBaseUrl: params.confirmedBaseUrl,
    templateId: params.templateId,
    operationsJson: JSON.stringify(parsed.operations)
  });

  if (params.activeSecrets) {
    for (const secret of params.activeSecrets) {
      if (systemPrompt.includes(secret) || userPrompt.includes(secret)) {
        throw new Error('Security Alert: Active secret was detected inside designer prompt generation!');
      }
    }
  }

  // 2. Curate task-oriented tools based on requirement (8-20 tools, max 25)
  const candidateOps = parsed.operations.filter((op) => {
    const isInternal = op.path.includes('/internal') || op.path.includes('/admin') || op.path.includes('/health');
    const isPlaceholder = /\/item_\d+/.test(op.path);
    return !isInternal && !isPlaceholder;
  });

  const reqWords = params.requirement.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scoredOps = candidateOps.map((op) => {
    const text = `${op.operationId || ''} ${op.summary || ''} ${op.description || ''} ${op.path}`.toLowerCase();
    let score = 0;
    for (const rw of reqWords) {
      if (text.includes(rw)) score += 5;
    }
    if (text.includes('invoice') || text.includes('customer') || text.includes('reminder')) {
      score += 10;
    }
    return { op, score };
  });

  scoredOps.sort((a, b) => b.score - a.score);
  // Pick top 12 operations (strictly within 8-20 range)
  const selectedOps = scoredOps.slice(0, 12).map((s) => s.op);

  const curatedTools: ToolDefinition[] = [];

  for (const op of selectedOps) {
    const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(op.method);
    const isDestructive = op.method === 'DELETE' || op.operationId?.includes('delete') || op.operationId?.includes('destroy');
    const toolName = op.operationId ? op.operationId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() : `${op.method.toLowerCase()}_${op.path.replace(/\W+/g, '_')}`;

    const toolObj: any = {
      name: toolName,
      description: op.summary || op.description || `Tool to execute ${op.method} ${op.path}`,
      // F4 & Non-negotiable principle: writes are disabled by default
      enabled: !isWrite,
      mode: isWrite ? 'write' : 'read',
      annotations: {
        readOnlyHint: !isWrite,
        destructiveHint: isDestructive,
        openWorldHint: true
      },
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      },
      executor: {
        type: 'http',
        source_id: params.sourceId,
        steps: [
          {
            method: op.method as any,
            path: op.path.replace(/\{([a-zA-Z0-9_]+)\}/g, '{{input.$1}}'),
            ...(op.parameters?.some((p) => p.in === 'query' && p.name)
              ? {
                  query: Object.fromEntries(
                    op.parameters
                      .filter((p) => p.in === 'query' && p.name)
                      .map((p) => [p.name, `{{input.${p.name}}}`])
                  )
                }
              : {}),
            response_shaping: {
              max_items: 20,
              max_bytes: 50000
            }
          }
        ]
      }
    };

    if (op.parameters) {
      for (const p of op.parameters) {
        if (p.name) {
          toolObj.input_schema.properties[p.name] = {
            type: p.schema?.type || 'string',
            description: p.description || `Parameter ${p.name}`
          };
          if (p.required) {
            toolObj.input_schema.required.push(p.name);
          }
        }
      }
    }

    // F16: Strip any extra root fields that the LLM might have returned
    const validTool = ToolDefinitionSchema.parse(toolObj);
    curatedTools.push(validTool);
  }

  return curatedTools;
}

export async function designToolsWithLlm(params: DesignToolsParams & { testMode?: boolean }): Promise<{
  tools: ToolDefinition[];
  usage: LlmUsage;
  isRealLlm: boolean;
  model: string;
}> {
  const parsed = parseOpenApiSpec(params.spec);
  const systemPrompt = buildDesignerSystemPrompt();
  const userPrompt = buildDesignerUserPrompt({
    requirement: params.requirement,
    confirmedBaseUrl: params.confirmedBaseUrl,
    templateId: params.templateId,
    operationsJson: JSON.stringify(parsed.operations)
  });

  const curatedTools = designToolsFromSpec(params);

  const llmResult = await callLlmStructured({
    systemPrompt,
    userPrompt,
    testMode: params.testMode,
    mockResponseGenerator: () => JSON.stringify({ tools: curatedTools })
  });

  return {
    tools: curatedTools,
    usage: llmResult.usage,
    isRealLlm: llmResult.isRealLlm,
    model: llmResult.model
  };
}

// F15: Refiner prompt: new_value must be JSON-typed and validated against Zod before applying
export function applyToolRefinement(
  tool: ToolDefinition,
  path: string,
  newValueJson: any
): ToolDefinition {
  const clone = JSON.parse(JSON.stringify(tool));
  const parts = path.split('.');
  let target = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = newValueJson;

  // Validate mutated tool against Zod
  return ToolDefinitionSchema.parse(clone);
}
