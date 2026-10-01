import { HttpStep, SourceDefinition } from './schema.js';
import { resolveExpression, resolveObjectExpressions, resolveUrlTemplate, ExpressionSecurityError } from './expr.js';
import { shapeResponse } from './shaper.js';
import { validateUrlForSsrf, SsrfSecurityError } from './ssrf-guard.js';
import { Vault, defaultVault } from './vault.js';

export interface ExecutionContext {
  input: Record<string, any>;
  env?: Record<string, string | undefined>;
  source?: SourceDefinition;
  vault?: Vault;
  isRetry?: boolean;
}

export class ExecutorError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ExecutorError';
  }
}

export async function executeHttpStep(step: HttpStep, context: ExecutionContext): Promise<any> {
  const vault = context.vault || defaultVault;
  const source = context.source;

  let baseUrl = 'http://localhost';
  let allowedHosts: string[] = [];

  if (source && source.type === 'openapi') {
    baseUrl = source.base_url;
    allowedHosts = source.allowed_hosts;
  }

  // 1. Resolve path and combine with base_url
  let resolvedPath: string;
  try {
    resolvedPath = resolveUrlTemplate(step.path, { input: context.input, env: context.env });
  } catch (err: any) {
    if (err instanceof ExpressionSecurityError) {
      throw new ExecutorError(`Path security error: ${err.message}`);
    }
    throw err;
  }

  // Full URL construction
  let fullUrlStr: string;
  if (resolvedPath.startsWith('http://') || resolvedPath.startsWith('https://')) {
    fullUrlStr = resolvedPath;
  } else {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const pathPart = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
    fullUrlStr = `${base}${pathPart}`;
  }

  const targetUrl = new URL(fullUrlStr);

  // 2. SSRF Check
  const allowLoopback = process.env.ALLOW_LOOPBACK_DEV === '1' || Boolean(context.env?.ALLOW_LOOPBACK_DEV);
  await validateUrlForSsrf(targetUrl.toString(), { allowedHosts, allowLoopback });

  // 3. Resolve query parameters
  if (step.query) {
    for (const [key, value] of Object.entries(step.query)) {
      const resolvedKey = resolveExpression(key, { input: context.input, env: context.env });
      const resolvedValue = resolveExpression(value, { input: context.input, env: context.env });
      if (resolvedValue) {
        targetUrl.searchParams.set(resolvedKey, resolvedValue);
      }
    }
  }

  // 4. Resolve headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'MCPForge-Runtime/1.0'
  };

  if (step.headers) {
    for (const [key, value] of Object.entries(step.headers)) {
      headers[resolveExpression(key, { input: context.input, env: context.env })] =
        resolveExpression(value, { input: context.input, env: context.env });
    }
  }

  // 5. Inject upstream auth from source if present (F6 & F8)
  if (source && source.type === 'openapi' && source.auth) {
    vault.applyUpstreamAuth(source.auth, targetUrl, headers, targetUrl.hostname);
  }

  // 6. Resolve body
  let body: string | undefined = undefined;
  if (step.body && ['POST', 'PUT', 'PATCH'].includes(step.method)) {
    const resolvedBody = resolveObjectExpressions(step.body, { input: context.input, env: context.env });
    body = JSON.stringify(resolvedBody);
    headers['Content-Type'] = 'application/json';
  }

  // 7. Timeout & abort controller
  const timeoutMs = step.timeout_ms ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Note: redirect: 'error' ensures cross-host redirects cannot leak credentials (F6)
    const response = await fetch(targetUrl.toString(), {
      method: step.method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'error'
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      // Short actionable error, never leak secrets or internals
      throw new ExecutorError(`Upstream API call failed with HTTP ${response.status}`, response.status);
    }

    // 8. Streamed size cap with abort
    const maxBytes = step.response_shaping?.max_bytes ?? 50000;
    let accumulatedText = '';
    const reader = response.body?.getReader();

    if (reader) {
      const decoder = new TextDecoder();
      let totalBytes = 0;
      let truncated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          truncated = true;
          // Abort further reading
          await reader.cancel();
          break;
        }
        accumulatedText += decoder.decode(value, { stream: true });
      }

      if (truncated) {
        return {
          warning: `Response exceeded maximum size limit of ${maxBytes} bytes and was truncated.`,
          raw_preview: accumulatedText.slice(0, 1000)
        };
      }
    } else {
      accumulatedText = await response.text();
    }

    let parsedData: any;
    try {
      parsedData = JSON.parse(accumulatedText);
    } catch {
      parsedData = accumulatedText;
    }

    // 9. Response shaping
    return shapeResponse(parsedData, step.response_shaping);
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ExecutorError(`Request timed out after ${timeoutMs}ms`);
    }
    if (err instanceof SsrfSecurityError) {
      throw new ExecutorError(`Security blocked: ${err.message}`);
    }
    if (err instanceof ExecutorError) {
      throw err;
    }
    throw new ExecutorError(`Request failed: ${err.message || String(err)}`);
  }
}

export async function executeTool(
  tool: { mode: 'read' | 'write'; executor: { type: 'http'; steps: HttpStep[] } },
  input: Record<string, any>,
  source?: SourceDefinition,
  vault?: Vault
): Promise<any> {
  const context: ExecutionContext = {
    input,
    env: process.env,
    source,
    vault
  };

  // Module check 2: Chained steps stop on first failure; writes never retried
  let lastResult: any = null;
  for (const step of tool.executor.steps) {
    try {
      lastResult = await executeHttpStep(step, context);
    } catch (err) {
      // Never retry writes! Stop immediately on error.
      throw err;
    }
  }

  return lastResult;
}
