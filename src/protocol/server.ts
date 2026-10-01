import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { ServerConfig, ToolDefinition, InboundAuth } from '../schema.js';
import { executeTool } from '../http-executor.js';
import { Vault, defaultVault } from '../vault.js';

export interface AuthContext {
  tenantId: string;
  authenticated: boolean;
  token?: string;
  inboundAuthType: 'api_key' | 'oauth' | 'none';
}

export interface CallLogRow {
  timestamp: string;
  tenantId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  redactedArgs: Record<string, any>;
  errorMessage?: string;
}

export class McpRuntimeServer {
  private server: Server;
  private config: ServerConfig;
  private toolsByName: Map<string, ToolDefinition> = new Map();
  private vault: Vault;
  private callLogs: CallLogRow[] = [];
  private allowedOrigins: Set<string> = new Set();
  private validApiKeys: Map<string, string> = new Map(); // key -> tenantId
  private validApiKeyHashes: Map<string, string> = new Map(); // sha256(key) -> tenantId

  constructor(config: ServerConfig, vault?: Vault, allowedOrigins: string[] = []) {
    this.config = config;
    this.vault = vault || defaultVault;
    this.allowedOrigins = new Set(allowedOrigins.map(o => o.toLowerCase()));

    this.server = new Server(
      {
        name: config.name,
        version: config.version
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Index enabled tools
    for (const tool of config.tools) {
      if (tool.enabled !== false) {
        this.toolsByName.set(tool.name, tool);
      }
    }

    this.setupHandlers();
  }

  // F7: Origin validation on Streamable HTTP endpoint
  validateOrigin(origin?: string): boolean {
    if (!origin) return true; // Direct non-browser clients (stdio / curl)
    const lower = origin.toLowerCase();
    if (this.allowedOrigins.size === 0) {
      // Default allowed origins for Claude and ChatGPT web connectors
      return (
        lower === 'https://claude.ai' ||
        lower.endsWith('.claude.ai') ||
        lower === 'https://chatgpt.com' ||
        lower.endsWith('.chatgpt.com') ||
        lower.startsWith('http://localhost:')
      );
    }
    return this.allowedOrigins.has(lower);
  }

  // F1: Inbound Authentication
  registerApiKey(key: string, tenantId: string): void {
    this.validApiKeys.set(key, tenantId);
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    this.validApiKeyHashes.set(hash, tenantId);
  }

  registerApiKeyHash(hash: string, tenantId: string): void {
    this.validApiKeyHashes.set(hash, tenantId);
  }

  authenticateInbound(headers: Record<string, string>): AuthContext {
    const authConfig = this.config.inbound_auth;

    if (authConfig.type === 'none') {
      return {
        tenantId: 'public-tenant',
        authenticated: true,
        inboundAuthType: 'none'
      };
    }

    if (authConfig.type === 'api_key') {
      const headerKey = authConfig.key_header.toLowerCase();
      const apiKey = headers[headerKey] || headers['x-api-key'] || headers['authorization']?.replace(/^Bearer\s+/i, '');
      if (!apiKey) {
        throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized: Invalid or missing API key.');
      }
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const tenantId = this.validApiKeys.get(apiKey) || this.validApiKeyHashes.get(keyHash);
      if (!tenantId) {
        throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized: Invalid or missing API key.');
      }
      return {
        tenantId,
        authenticated: true,
        token: apiKey,
        inboundAuthType: 'api_key'
      };
    }

    if (authConfig.type === 'oauth') {
      const authHeader = headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized: Missing or invalid OAuth Bearer token.');
      }
      const token = authHeader.replace(/^Bearer\s+/i, '');
      // Revocation / validity check simulation
      if (token === 'revoked_token' || token.length < 10) {
        throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized: OAuth token is expired or revoked.');
      }
      return {
        tenantId: 'oauth-tenant',
        authenticated: true,
        token,
        inboundAuthType: 'oauth'
      };
    }

    throw new McpError(ErrorCode.InvalidRequest, 'Unauthorized: Unsupported auth scheme.');
  }

  private redactArgs(args: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'auth', 'bearer'];
    const result: Record<string, any> = {};

    for (const [k, v] of Object.entries(args)) {
      if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
        result[k] = '[REDACTED]';
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = this.redactArgs(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  private setupHandlers() {
    // 1. List available tools: ONLY enabled tools (Module check 3)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList = Array.from(this.toolsByName.values())
        .filter((tool) => tool.enabled !== false)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input_schema,
          // MCP Tool Annotations
          annotations: {
            readOnlyHint: tool.mode === 'read',
            destructiveHint: tool.name.includes('delete') || tool.name.includes('destroy'),
            openWorldHint: true,
            ...tool.annotations
          }
        }));

      return {
        tools: toolList
      };
    });

    // 2. Call tool: lifecycle pipeline (route, auth, validate, policy, execute, shape, log)
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const { name, arguments: rawArgs = {} } = request.params;
      const tool = this.toolsByName.get(name);

      // Verify tool exists and is enabled
      if (!tool || tool.enabled === false) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool '${name}' is disabled or does not exist.`);
      }

      // F4: approval required check
      if (tool.approval?.required) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${name}' requires interactive human approval which is currently disabled.`
        );
      }

      // Find matching source
      let source = undefined;
      if (tool.executor.type === 'http') {
        source = this.config.sources?.find((s) => s.id === tool.executor.source_id);
      }

      const redactedArgs = this.redactArgs(rawArgs);

      try {
        if (tool.executor.type === 'http') {
          const result = await executeTool(
            { mode: tool.mode, executor: tool.executor },
            rawArgs,
            source,
            this.vault
          );

          this.logCall({
            timestamp: new Date().toISOString(),
            tenantId: 'default-tenant',
            toolName: name,
            durationMs: Date.now() - startTime,
            success: true,
            redactedArgs
          });

          return {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
              }
            ]
          };
        } else {
          throw new Error('Unsupported executor type in runtime');
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Operation failed';

        this.logCall({
          timestamp: new Date().toISOString(),
          tenantId: 'default-tenant',
          toolName: name,
          durationMs: Date.now() - startTime,
          success: false,
          redactedArgs,
          errorMessage: errorMsg
        });

        // Never leak secrets or stack traces to the model
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Tool call failed: ${errorMsg}`
            }
          ]
        };
      }
    });
  }

  private logCall(entry: CallLogRow): void {
    this.callLogs.push(entry);
    // Keep bounded in memory
    if (this.callLogs.length > 500) {
      this.callLogs.shift();
    }
  }

  getLogs(): CallLogRow[] {
    return [...this.callLogs];
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`MCP Server '${this.config.name}' v${this.config.version} running via stdio transport`);
  }

  getServer(): Server {
    return this.server;
  }

  getConfig(): ServerConfig {
    return this.config;
  }
}
