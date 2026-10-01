import crypto from 'node:crypto';
import { ServerConfig, ToolDefinition } from '../schema.js';

export type EvalMode = 'live-read' | 'mock';

export interface TestCase {
  id: string;
  prompt: string;
  expected_tools: string[];
  forbidden_tools?: string[];
  expected_args_subset?: Record<string, any>;
}

export interface EvalRunResult {
  mode: EvalMode;
  configHash: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  forbiddenViolations: number;
  caseDetails: Array<{
    id: string;
    passed: boolean;
    calledTools: string[];
    reason?: string;
  }>;
}

export class EvalEngine {
  private cache = new Map<string, EvalRunResult>();

  computeConfigHash(config: ServerConfig): string {
    return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  }

  // Naive 1:1 baseline generator for comparison
  buildBaselineConfig(specOperations: Array<{ method: string; path: string }>): ServerConfig {
    return {
      name: 'baseline-1-to-1-server',
      version: '1.0.0',
      sources: [],
      inbound_auth: { type: 'none', warning_accepted: true },
      tools: specOperations.map((op) => ({
        name: `${op.method.toLowerCase()}_${op.path.replace(/\W+/g, '_')}`,
        description: `Raw endpoint ${op.method} ${op.path}`,
        enabled: true,
        mode: ['POST', 'PUT', 'DELETE'].includes(op.method) ? 'write' : 'read',
        input_schema: { type: 'object', properties: {} },
        executor: {
          type: 'http',
          source_id: 'default',
          steps: [{ method: op.method as any, path: op.path }]
        }
      }))
    };
  }

  runEvals(
    config: ServerConfig,
    testCases: TestCase[],
    mode: EvalMode = 'mock',
    mockToolSelector?: (prompt: string, availableTools: ToolDefinition[]) => { tools: string[]; args: Record<string, any> }
  ): EvalRunResult {
    const configHash = this.computeConfigHash(config);
    const cacheKey = `${configHash}-${mode}`;

    const enabledTools = config.tools.filter((t) => t.enabled);
    const enabledToolNames = new Set(enabledTools.map((t) => t.name));

    let passedCases = 0;
    let forbiddenViolations = 0;
    const caseDetails: EvalRunResult['caseDetails'] = [];

    for (const testCase of testCases) {
      // Execute mock or simulated selector
      let selected: { tools: string[]; args: Record<string, any> };
      if (mockToolSelector) {
        selected = mockToolSelector(testCase.prompt, enabledTools);
      } else {
        // Deterministic keyword matching heuristic simulating LLM tool selection
        const lowerPrompt = testCase.prompt.toLowerCase();
        const matched = enabledTools
          .filter((t) => {
            const words = t.name.split('_');
            return words.some((w) => w.length > 3 && lowerPrompt.includes(w));
          })
          .map((t) => t.name);
        selected = { tools: matched, args: {} };
      }

      // Check forbidden tools
      let forbiddenViolated = false;
      if (testCase.forbidden_tools) {
        for (const f of testCase.forbidden_tools) {
          if (selected.tools.includes(f)) {
            forbiddenViolated = true;
            forbiddenViolations++;
            break;
          }
        }
      }

      // Check expected tools
      const expectedMet = testCase.expected_tools.every((et) => selected.tools.includes(et));
      const passed = expectedMet && !forbiddenViolated;

      if (passed) {
        passedCases++;
      }

      caseDetails.push({
        id: testCase.id,
        passed,
        calledTools: selected.tools,
        reason: forbiddenViolated ? 'Forbidden tool called' : (!expectedMet ? 'Expected tool missing' : undefined)
      });
    }

    const result: EvalRunResult = {
      mode,
      configHash,
      totalCases: testCases.length,
      passedCases,
      passRate: testCases.length > 0 ? (passedCases / testCases.length) * 100 : 0,
      forbiddenViolations,
      caseDetails
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
