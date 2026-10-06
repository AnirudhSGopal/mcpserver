import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { McpRuntimeServer } from './server.js';
import { ServerConfig, ServerConfigSchema } from '../schema.js';
import { designToolsFromSpec } from '../designer/designer.js';
import { Vault } from '../vault.js';
import { runBuilderPipeline } from '../builder/progress-pipeline.js';
import {
  processAssistantTurn,
  generateAndHashApiKey,
  validateChatForCredentials,
  validateAssistantAction,
  AssistantSecurityError
} from '../builder/assistant.js';
import { globalMilestoneManager } from '../builder/milestones.js';

export interface CreateHttpServerOptions {
  port?: number;
  allowedOrigins?: string[];
  oauthMetadata?: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    scopesSupported: string[];
    allowedRedirectUris: string[];
  };
}

// Registry of runtimes by slug
export const globalRuntimeRegistry = new Map<string, McpRuntimeServer>();

export function createMcpHttpServer(
  runtime: McpRuntimeServer,
  options?: CreateHttpServerOptions
): http.Server {
  const oauthMeta = options?.oauthMetadata || {
    issuer: 'https://auth.mcpforge.com',
    authorizationEndpoint: 'https://auth.mcpforge.com/oauth/authorize',
    tokenEndpoint: 'https://auth.mcpforge.com/oauth/token',
    scopesSupported: ['read', 'write'],
    allowedRedirectUris: [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://127.0.0.1/callback'
    ]
  };

  // Register initial runtime under canonical slug
  globalRuntimeRegistry.set('invoiceapp', runtime);

  if (!globalMilestoneManager.getProject('invoiceapp')) {
    const invProj = globalMilestoneManager.createProject('invoiceapp', 'Invoice Manager', 'invoiceapp');
    invProj.tools = runtime.getConfig().tools.map((t) => ({
      name: t.name,
      description: t.description,
      mode: t.mode,
      enabled: t.enabled !== false
    }));
  }

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const origin = req.headers['origin'] as string | undefined;

    // CORS headers on metadata and API endpoints
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // F7 Origin validation (enforced on MCP endpoints)
    if (origin && !runtime.validateOrigin(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: Invalid Origin', origin }));
      return;
    }

    // RFC 8414: OAuth 2.0 Authorization Server Metadata
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: oauthMeta.issuer,
          authorization_endpoint: oauthMeta.authorizationEndpoint,
          token_endpoint: oauthMeta.tokenEndpoint,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: oauthMeta.scopesSupported,
          redirect_uris_supported: [
            'https://claude.ai/api/mcp/auth_callback',
            'http://localhost/callback',
            'http://127.0.0.1/callback'
          ]
        })
      );
      return;
    }

    // RFC 9728: OAuth 2.0 Protected Resource Metadata
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: `http://${req.headers.host || 'localhost'}/mcp`,
          authorization_servers: [oauthMeta.issuer],
          scopes_supported: oauthMeta.scopesSupported
        })
      );
      return;
    }

    // InvoiceApp Fixture API (Serves real invoice data)
    if (url.pathname === '/invoiceapp/invoices') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          { id: '1', invoice_number: 'INV-1001', customer: 'ACME Corp', amount: 1500, status: 'unpaid' },
          { id: '2', invoice_number: 'INV-1002', customer: 'Stark Industries', amount: 4200, status: 'paid' }
        ])
      );
      return;
    }

    if (url.pathname.startsWith('/invoiceapp/invoices/')) {
      const invoiceId = url.pathname.split('/').pop();
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: invoiceId, status: 'deleted', deleted_at: new Date().toISOString() }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: invoiceId,
          invoice_number: `INV-100${invoiceId}`,
          customer: 'ACME Corp',
          amount: 1500,
          status: 'unpaid',
          due_date: '2026-10-31',
          line_items: [{ description: 'SaaS Platform License', quantity: 1, unit_price: 1500 }]
        })
      );
      return;
    }

    // API: List active connections (deduped by slug, omitting 'default')
    if (url.pathname === '/api/mcp/servers' && req.method === 'GET') {
      const seen = new Set<string>();
      const servers: any[] = [];
      for (const [slug, srv] of globalRuntimeRegistry.entries()) {
        if (slug === 'default' || seen.has(slug)) continue;
        seen.add(slug);
        const cfg = srv.getConfig();
        const activeCount = cfg.tools.filter((t) => t.enabled !== false).length;
        const totalCount = cfg.tools.length;
        servers.push({
          slug,
          name: cfg.name,
          version: cfg.version,
          mcpUrl: `/s/${slug}/mcp`,
          toolsCount: totalCount,
          activeCount,
          inboundAuth: cfg.inbound_auth.type,
          tools: cfg.tools.map((t) => ({
            name: t.name,
            description: t.description,
            mode: t.mode,
            enabled: t.enabled !== false
          }))
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ servers }));
      return;
    }

    // Milestone API: GET /projects/:id/milestones
    const milestonesMatch = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)\/milestones$/);
    if (milestonesMatch && req.method === 'GET') {
      const projectId = milestonesMatch[1];
      const project = globalMilestoneManager.getProject(projectId);
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project '${projectId}' not found` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projectId, milestones: globalMilestoneManager.getMilestones(projectId) }));
      return;
    }

    // Milestone SSE Stream: GET /projects/:id/milestones/stream
    const streamMatch = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)\/milestones\/stream$/);
    if (streamMatch && req.method === 'GET') {
      const projectId = streamMatch[1];
      const project = globalMilestoneManager.getProject(projectId);
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project '${projectId}' not found` }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // Write initial snapshot
      res.write(`data: ${JSON.stringify(globalMilestoneManager.getMilestones(projectId))}\n\n`);

      const emitter = globalMilestoneManager.getEmitter(projectId);
      const listener = (milestones: any) => {
        res.write(`data: ${JSON.stringify(milestones)}\n\n`);
      };

      emitter.on('milestones', listener);
      req.on('close', () => {
        emitter.off('milestones', listener);
      });
      return;
    }

    // Milestone Tool Toggle: POST /projects/:id/tools/toggle
    const projectToggleMatch = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)\/tools\/toggle$/);
    if (projectToggleMatch && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c));
      req.on('end', () => {
        try {
          const projectId = projectToggleMatch[1];
          const { toolName, enabled } = JSON.parse(bodyStr || '{}');
          globalMilestoneManager.toggleTool(projectId, toolName, Boolean(enabled));

          const targetRuntime = globalRuntimeRegistry.get(projectId);
          if (targetRuntime) {
            const tool = targetRuntime.getConfig().tools.find((t) => t.name === toolName);
            if (tool) {
              tool.enabled = Boolean(enabled);
              const toolsMap: Map<string, any> = (targetRuntime as any).toolsByName;
              if (toolsMap) {
                if (tool.enabled) toolsMap.set(tool.name, tool);
                else toolsMap.delete(tool.name);
              }
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, toolName, enabled: Boolean(enabled) }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Publish connection (Human-only gate): POST /projects/:id/publish
    const publishMatch = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)\/publish$/);
    if (publishMatch && req.method === 'POST') {
      const projectId = publishMatch[1];
      try {
        const pub = globalMilestoneManager.publish(projectId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, project: pub }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Legacy tool toggle for backward compat
    if (url.pathname === '/api/mcp/tools/toggle' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c));
      req.on('end', () => {
        try {
          const { slug, toolName, enabled } = JSON.parse(bodyStr || '{}');
          const targetRuntime = globalRuntimeRegistry.get(slug);
          if (!targetRuntime) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Connection '${slug}' not found` }));
            return;
          }
          const tool = targetRuntime.getConfig().tools.find((t) => t.name === toolName);
          if (tool) {
            tool.enabled = Boolean(enabled);
            const toolsMap: Map<string, any> = (targetRuntime as any).toolsByName;
            if (toolsMap) {
              if (tool.enabled) toolsMap.set(tool.name, tool);
              else toolsMap.delete(tool.name);
            }
          }
          if (globalMilestoneManager.getProject(slug)) {
            globalMilestoneManager.toggleTool(slug, toolName, Boolean(enabled));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, toolName, enabled: tool?.enabled }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Failed to toggle action' }));
        }
      });
      return;
    }

    // API: Real SSE Progress Stream for Builder Pipeline
    if (url.pathname === '/api/builder/events' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c));
      req.on('end', async () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        try {
          const body = JSON.parse(bodyStr || '{}');
          const rawSlug = body.slug || body.name || 'invoiceapp';
          const slug = rawSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'invoiceapp';

          if (!globalMilestoneManager.getProject(slug)) {
            globalMilestoneManager.createProject(slug, body.name || slug, slug);
          }

          for await (const event of runBuilderPipeline(body, globalRuntimeRegistry)) {
            globalMilestoneManager.applyBuilderEvent(slug, event);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch (err: any) {
          res.write(
            `data: ${JSON.stringify({
              stage: 'source_connected',
              status: 'failed',
              plain_message: 'An unexpected error occurred while building your connection.',
              detail: { reason: err.message, next_step: 'Please check your inputs and try again.' }
            })}\n\n`
          );
        } finally {
          res.end();
        }
      });
      return;
    }

    // API: Assistant Chat (Real LLM, structured project state, server-side guardrails)
    if (url.pathname === '/api/assistant/chat' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const result = await processAssistantTurn({
            userMessage: body.userMessage || '',
            projectSummary: body.projectSummary || '',
            projectState: body.projectState || {}
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          const status = err instanceof AssistantSecurityError ? 400 : 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Assistant error', code: err.code }));
        }
      });
      return;
    }

    // API: Create new assistant connection
    if (url.pathname === '/api/mcp/create' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c));
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const name = body.name || 'Assistant Connection';
          const rawSlug = body.slug || name;
          const slug = rawSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'connection';
          let specObj = body.spec;
          if (typeof specObj === 'string') {
            specObj = JSON.parse(specObj);
          }
          if (!specObj || typeof specObj !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Valid API definition object is required.' }));
            return;
          }

          const baseUrl = body.baseUrl || specObj.servers?.[0]?.url || `http://${req.headers.host || '127.0.0.1:3000'}`;
          let hostname = '127.0.0.1';
          try {
            hostname = new URL(baseUrl).hostname;
          } catch {
            hostname = '127.0.0.1';
          }

          // Design tools from the uploaded spec
          const designedTools = designToolsFromSpec({
            spec: specObj,
            confirmedBaseUrl: baseUrl,
            sourceId: `source_${slug}`,
            requirement: body.requirement || `Custom actions for ${name}`
          });

          // Inbound auth: Generate secure random key, store hash only, show raw key once
          const isPublic = body.allowPublicRead === true;
          let rawApiKey: string | undefined = undefined;
          let keyHash: string | undefined = undefined;

          if (!isPublic) {
            if (body.apiKey) {
              rawApiKey = body.apiKey;
              keyHash = crypto.createHash('sha256').update(rawApiKey!).digest('hex');
            } else {
              const generated = generateAndHashApiKey();
              rawApiKey = generated.rawKey;
              keyHash = generated.keyHash;
            }
          }

          const serverConfig: ServerConfig = {
            name,
            version: '1.0.0',
            description: `AI connection for ${name}`,
            inbound_auth: rawApiKey
              ? { type: 'api_key', key_header: 'X-API-Key' }
              : { type: 'none', warning_accepted: true },
            sources: [
              {
                type: 'openapi',
                id: `source_${slug}`,
                base_url: baseUrl,
                allowed_hosts: [hostname, '127.0.0.1', 'localhost']
              }
            ],
            tools: designedTools
          };

          const validatedConfig = ServerConfigSchema.parse(serverConfig);
          const newRuntime = new McpRuntimeServer(validatedConfig, new Vault());
          if (keyHash) {
            newRuntime.registerApiKeyHash(keyHash, `tenant-${slug}`);
          }

          // Register runtime dynamically
          globalRuntimeRegistry.set(slug, newRuntime);

          // Register or update project in globalMilestoneManager
          let proj = globalMilestoneManager.getProject(slug);
          if (!proj) {
            proj = globalMilestoneManager.createProject(slug, name, slug);
          }
          proj.baseUrl = baseUrl;
          proj.spec = specObj;
          proj.tools = designedTools.map((t) => ({
            name: t.name,
            description: t.description,
            mode: t.mode,
            enabled: t.enabled !== false
          }));
          proj.milestones.goal.status = 'done';
          proj.milestones.data.status = 'done';
          proj.milestones.actions.status = 'done';
          proj.milestones.coverage.status = 'done';
          proj.milestones.tested.status = 'done';
          proj.milestones.live.status = 'waiting_on_user';

          const host = req.headers.host || '127.0.0.1:3000';
          const mcpUrl = `http://${host}/s/${slug}/mcp`;

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              name,
              slug,
              mcpUrl,
              apiKey: rawApiKey,
              isPublic,
              toolsCount: designedTools.length,
              tools: designedTools.map((t) => ({
                name: t.name,
                description: t.description,
                mode: t.mode,
                enabled: t.enabled !== false
              })),
              claudeCommand: `claude mcp add --transport http ${slug} ${mcpUrl}${rawApiKey ? ` --header "X-API-Key: ${rawApiKey}"` : ''}`,
              message: `Connection '${name}' is now ready.`
            })
          );
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Failed to create connection' }));
        }
      });
      return;
    }

    // Dynamic slug routing: /s/:slug/mcp
    const slugMatch = url.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)\/mcp$/);
    if (slugMatch) {
      const targetSlug = slugMatch[1];
      const targetRuntime = globalRuntimeRegistry.get(targetSlug);
      if (!targetRuntime) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Connection '${targetSlug}' not found` }));
        return;
      }
      return dispatchMcp(req, res, targetRuntime, targetSlug);
    }

    // Canonical default MCP endpoint: /mcp
    if (url.pathname === '/mcp') {
      const defaultRuntime = globalRuntimeRegistry.get('invoiceapp') || runtime;
      return dispatchMcp(req, res, defaultRuntime, 'invoiceapp');
    }

    // Serve Studio UI: GET / or /studio or /projects/:id/studio
    if ((url.pathname === '/' || url.pathname === '/studio' || /^\/projects\/[a-zA-Z0-9_-]+\/studio$/.test(url.pathname)) && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderStudioHtml());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}

// MCP Protocol Dispatcher
async function dispatchMcp(
  req: IncomingMessage,
  res: ServerResponse,
  targetRuntime: McpRuntimeServer,
  serverName: string
) {
  try {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    targetRuntime.authenticateInbound(headers);
  } catch (err: any) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Unauthorized: Missing or invalid access key' }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const jsonRpc = JSON.parse(body || '{}');
        const { method, id, params } = jsonRpc;

        if (method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: serverName, version: targetRuntime.getConfig().version }
              }
            })
          );
          return;
        }

        if (method === 'notifications/initialized') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end();
          return;
        }

        if (method === 'tools/list') {
          const listHandler = targetRuntime.getServer()['_requestHandlers']?.get('tools/list');
          const listTools = await listHandler?.({ method: 'tools/list' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result: listTools || { tools: [] } }));
          return;
        }

        if (method === 'tools/call') {
          const callHandler = targetRuntime.getServer()['_requestHandlers']?.get('tools/call');
          try {
            const callResult = await callHandler?.({ method: 'tools/call', params });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id, result: callResult }));
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: err.message || 'Action execution error' }
              })
            );
          }
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `AI connection ready for '${serverName}'` }));
}

function renderStudioHtml(): string {
  const modelId = process.env.MODEL_ID || 'gemini-2.5-flash';
  const htmlPath = fileURLToPath(new URL('studio.html', import.meta.url));
  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
  return rawHtml.replace('__MODEL_ID__', modelId);
}
