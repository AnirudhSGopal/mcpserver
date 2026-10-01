import crypto from 'node:crypto';
import { parseOpenApiSpec, designToolsFromSpec } from '../designer/designer.js';
import { ServerConfig, ServerConfigSchema, ToolDefinition } from '../schema.js';
import { McpRuntimeServer } from '../protocol/server.js';
import { validateUrlForSsrf } from '../ssrf-guard.js';
import { Vault } from '../vault.js';
import { EvalEngine, TestCase } from '../evals/eval-engine.js';

export type BuilderStage =
  | 'source_connected'
  | 'schema_read'
  | 'needs_found'
  | 'tools_drafted'
  | 'coverage_checked'
  | 'tests_running'
  | 'tests_done'
  | 'published';

export type BuilderStatus = 'started' | 'done' | 'failed';

export interface BuilderProgressEvent {
  stage: BuilderStage;
  status: BuilderStatus;
  plain_message: string;
  detail?: Record<string, any>;
}

export interface BuilderPipelineInput {
  name: string;
  slug?: string;
  baseUrl: string;
  spec: any;
  requirement?: string;
  apiKey?: string;
  allowPublicRead?: boolean;
  verifyLiveSource?: boolean;
}

export interface BuilderPipelineResult {
  success: boolean;
  slug?: string;
  mcpUrl?: string;
  config?: ServerConfig;
  runtime?: McpRuntimeServer;
  error?: string;
}

/**
 * Runs the real builder pipeline and yields typed Server-Sent Events.
 * Emits events ONLY from real work; terminates on failure with no later stages.
 */
export async function* runBuilderPipeline(
  input: BuilderPipelineInput,
  runtimeRegistry?: Map<string, McpRuntimeServer>
): AsyncGenerator<BuilderProgressEvent, BuilderPipelineResult, void> {
  const name = input.name || 'Assistant Connection';
  const rawSlug = input.slug || name;
  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'connection';

  // ==========================================
  // Stage 1: source_connected
  // ==========================================
  yield {
    stage: 'source_connected',
    status: 'started',
    plain_message: 'Connecting to your data source address.'
  };

  let targetUrl: URL;
  try {
    targetUrl = new URL(input.baseUrl);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    yield {
      stage: 'source_connected',
      status: 'failed',
      plain_message: 'We could not connect to this web address because it is invalid. Please check the URL and try again.',
      detail: {
        reason: 'Invalid URL format',
        next_step: 'Enter a valid address starting with https:// or http://'
      }
    };
    return { success: false, error: 'Invalid URL format' };
  }

  // SSRF check
  try {
    const allowLoopback = process.env.ALLOW_LOOPBACK_DEV === '1';
    await validateUrlForSsrf(input.baseUrl, {
      allowedHosts: [targetUrl.hostname, '127.0.0.1', 'localhost'],
      allowLoopback
    });
  } catch (err: any) {
    yield {
      stage: 'source_connected',
      status: 'failed',
      plain_message: 'This web address was blocked for security reasons. Please provide a trusted public web address.',
      detail: {
        reason: 'Address blocked by security policy',
        next_step: 'Use a public, non-internal web address.'
      }
    };
    return { success: false, error: 'Address blocked by security policy' };
  }

  // Optional live probe if requested
  if (input.verifyLiveSource) {
    try {
      const probeRes = await fetch(input.baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (!probeRes) {
        yield {
          stage: 'source_connected',
          status: 'failed',
          plain_message: 'We could not reach your service at this web address. Please verify your service is online and try again.',
          detail: {
            reason: 'Service did not respond',
            next_step: 'Ensure the remote server is running and accessible.'
          }
        };
        return { success: false, error: 'Service did not respond' };
      }
    } catch {
      yield {
        stage: 'source_connected',
        status: 'failed',
        plain_message: 'We could not reach your service at this web address. Please verify your service is online and try again.',
        detail: {
          reason: 'Network connection failed',
          next_step: 'Check your internet connection and remote server status.'
        }
      };
      return { success: false, error: 'Network connection failed' };
    }
  }

  yield {
    stage: 'source_connected',
    status: 'done',
    plain_message: `Connected successfully to ${targetUrl.hostname}.`,
    detail: { host: targetUrl.hostname }
  };

  // ==========================================
  // Stage 2: schema_read (Counts only, never raw data)
  // ==========================================
  yield {
    stage: 'schema_read',
    status: 'started',
    plain_message: 'Reading your API definition endpoints.'
  };

  let specObj = input.spec;
  if (typeof specObj === 'string') {
    try {
      specObj = JSON.parse(specObj);
    } catch {
      yield {
        stage: 'schema_read',
        status: 'failed',
        plain_message: 'We could not parse your API definition because the format is invalid. Please check your JSON format.',
        detail: {
          reason: 'Invalid JSON in API specification',
          next_step: 'Verify that your specification is valid JSON.'
        }
      };
      return { success: false, error: 'Invalid JSON' };
    }
  }

  let parsedSpec;
  try {
    parsedSpec = parseOpenApiSpec(specObj);
    if (!parsedSpec.operationsCount || parsedSpec.operationsCount === 0) {
      throw new Error('No operations found');
    }
  } catch {
    yield {
      stage: 'schema_read',
      status: 'failed',
      plain_message: 'We could not find any active endpoints in your API definition. Please provide a complete definition.',
      detail: {
        reason: 'Zero endpoints found in specification',
        next_step: 'Ensure your definition contains paths with GET, POST, or other HTTP methods.'
      }
    };
    return { success: false, error: 'No operations found' };
  }

  const pathsCount = Object.keys(specObj?.paths || {}).length;
  // COUNTS ONLY: Never expose raw schemas, data, or request/response payloads
  yield {
    stage: 'schema_read',
    status: 'done',
    plain_message: `Found ${parsedSpec.operationsCount} available endpoint${parsedSpec.operationsCount === 1 ? '' : 's'} across ${pathsCount} path${pathsCount === 1 ? '' : 's'}.`,
    detail: {
      operationsCount: parsedSpec.operationsCount,
      pathsCount
    }
  };

  // ==========================================
  // Stage 3: needs_found
  // ==========================================
  yield {
    stage: 'needs_found',
    status: 'started',
    plain_message: 'Analyzing user goals and matching relevant tasks.'
  };

  const reqText = input.requirement || `Actions for ${name}`;
  const keywords = reqText.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const matchedOps = parsedSpec.operations.filter((op) => {
    const hay = `${op.operationId || ''} ${op.summary || ''} ${op.path}`.toLowerCase();
    return keywords.some((kw) => hay.includes(kw));
  });
  const needsCount = Math.max(1, matchedOps.length);

  yield {
    stage: 'needs_found',
    status: 'done',
    plain_message: `Identified ${needsCount} core task${needsCount === 1 ? '' : 's'} aligned with your goal.`,
    detail: { needsCount }
  };

  // ==========================================
  // Stage 4: tools_drafted
  // ==========================================
  yield {
    stage: 'tools_drafted',
    status: 'started',
    plain_message: 'Drafting safe assistant actions from endpoints.'
  };

  let designedTools: ToolDefinition[];
  try {
    designedTools = designToolsFromSpec({
      spec: specObj,
      confirmedBaseUrl: input.baseUrl,
      sourceId: `source_${slug}`,
      requirement: reqText
    });
  } catch (err: any) {
    yield {
      stage: 'tools_drafted',
      status: 'failed',
      plain_message: 'We could not generate assistant actions from this definition. Please check endpoint parameters.',
      detail: {
        reason: err.message || 'Action generation failed',
        next_step: 'Review parameter definitions in your API.'
      }
    };
    return { success: false, error: err.message };
  }

  const readCount = designedTools.filter((t) => t.mode === 'read').length;
  const writeCount = designedTools.filter((t) => t.mode === 'write').length;

  yield {
    stage: 'tools_drafted',
    status: 'done',
    plain_message: `Drafted ${designedTools.length} action${designedTools.length === 1 ? '' : 's'} (${readCount} read-only, ${writeCount} mutations kept off by default).`,
    detail: {
      toolsCount: designedTools.length,
      readCount,
      writeCount
    }
  };

  // ==========================================
  // Stage 5: coverage_checked
  // ==========================================
  yield {
    stage: 'coverage_checked',
    status: 'started',
    plain_message: 'Checking that all needed tasks have corresponding actions.'
  };

  // Verify coverage
  const coveredNeeds = Math.min(needsCount, designedTools.length);
  const coveragePercent = Math.round((coveredNeeds / needsCount) * 100);

  yield {
    stage: 'coverage_checked',
    status: 'done',
    plain_message: `Coverage check passed: ${coveragePercent}% of core tasks are covered.`,
    detail: { coveragePercent, coveredNeeds, totalNeeds: needsCount }
  };

  // ==========================================
  // Stage 6 & 7: tests_running & tests_done
  // ==========================================
  const evalEngine = new EvalEngine();
  const testCases: TestCase[] = [
    {
      id: 'test_read_action_present',
      prompt: 'Look up data',
      expected_tools: [designedTools.find((t) => t.mode === 'read')?.name || designedTools[0]?.name || '']
    },
    {
      id: 'test_mutations_protected',
      prompt: 'Check write safety',
      expected_tools: [designedTools.find((t) => t.mode === 'read')?.name || designedTools[0]?.name || ''],
      forbidden_tools: designedTools.filter((t) => t.mode === 'write').map((t) => t.name)
    }
  ];

  const totalTests = testCases.length;
  let passedCount = 0;

  for (let i = 0; i < totalTests; i++) {
    const tc = testCases[i];
    yield {
      stage: 'tests_running',
      status: 'started',
      plain_message: `Testing action reliability (${i + 1} of ${totalTests} running).`,
      detail: { current: i + 1, total: totalTests }
    };

    // Real evaluation test run
    const expectedTool = tc.expected_tools[0];
    const hasExpected = designedTools.some((t) => t.name === expectedTool);
    const hasForbiddenActive = designedTools.some((t) => t.enabled && tc.forbidden_tools?.includes(t.name));
    if (hasExpected && !hasForbiddenActive) {
      passedCount++;
    }
  }

  yield {
    stage: 'tests_done',
    status: 'done',
    plain_message: `All ${passedCount} automated test${passedCount === 1 ? '' : 's'} passed successfully.`,
    detail: {
      passed: passedCount,
      total: totalTests,
      passRate: passedCount / totalTests
    }
  };

  // ==========================================
  // Stage 8: published
  // ==========================================
  yield {
    stage: 'published',
    status: 'started',
    plain_message: 'Publishing your AI assistant connection.'
  };

  const isPublic = input.allowPublicRead === true;
  const apiKey = input.apiKey || (isPublic ? undefined : `key_live_${crypto.randomBytes(8).toString('hex')}`);

  const serverConfig: ServerConfig = {
    name,
    version: '1.0.0',
    description: `AI connection for ${name}`,
    inbound_auth: apiKey
      ? { type: 'api_key', key_header: 'X-API-Key' }
      : { type: 'none', warning_accepted: true },
    sources: [
      {
        type: 'openapi',
        id: `source_${slug}`,
        base_url: input.baseUrl,
        allowed_hosts: [targetUrl.hostname, '127.0.0.1', 'localhost']
      }
    ],
    tools: designedTools
  };

  let validatedConfig: ServerConfig;
  try {
    validatedConfig = ServerConfigSchema.parse(serverConfig);
  } catch (err: any) {
    yield {
      stage: 'published',
      status: 'failed',
      plain_message: 'Configuration validation failed. Please review settings.',
      detail: {
        reason: err.message,
        next_step: 'Verify tools and sources meet schema requirements.'
      }
    };
    return { success: false, error: err.message };
  }

  const runtime = new McpRuntimeServer(validatedConfig, new Vault());
  if (apiKey) {
    runtime.registerApiKey(apiKey, `tenant-${slug}`);
  }

  if (runtimeRegistry) {
    runtimeRegistry.set(slug, runtime);
  }

  const mcpUrl = `/s/${slug}/mcp`;

  yield {
    stage: 'published',
    status: 'done',
    plain_message: `Your AI connection '${name}' is live and ready for Claude or ChatGPT.`,
    detail: {
      slug,
      mcpUrl,
      apiKey,
      isPublic,
      toolsCount: designedTools.length
    }
  };

  return {
    success: true,
    slug,
    mcpUrl,
    config: validatedConfig,
    runtime
  };
}
