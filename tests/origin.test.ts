import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createMcpHttpServer } from '../src/protocol/http-server.js';
import { McpRuntimeServer } from '../src/protocol/server.js';
import { ServerConfig } from '../src/schema.js';

describe('HTTP Origin Validation & OAuth Metadata Suite', () => {
  let server: http.Server;
  let port: number;

  const config: ServerConfig = {
    name: 'origin-test-server',
    version: '1.0.0',
    inbound_auth: { type: 'none', warning_accepted: true },
    tools: []
  };

  beforeAll(async () => {
    const runtime = new McpRuntimeServer(config, undefined, ['https://claude.ai', 'https://chatgpt.com']);
    server = createMcpHttpServer(runtime);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Item 3: Origin validation test
  it('rejects HTTP requests with an untrusted Origin header with 403 Forbidden', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'GET',
      headers: {
        'Origin': 'https://evil-hacker-site.com'
      }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden: Invalid Origin');
  });

  it('accepts HTTP requests with an allowed Origin header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'GET',
      headers: {
        'Origin': 'https://claude.ai'
      }
    });

    expect(res.status).toBe(200);
  });

  // Item 4: Expose OAuth metadata endpoints
  it('exposes authorization-server metadata with PKCE and Claude redirect URIs', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const meta = await res.json();

    expect(meta.issuer).toBeDefined();
    expect(meta.authorization_endpoint).toBeDefined();
    expect(meta.token_endpoint).toBeDefined();
    expect(meta.code_challenge_methods_supported).toContain('S256'); // PKCE support
    // RFC 8414: redirect_uris_supported — exact URIs from claude.com/docs/connectors/building/authentication#callback-urls
    expect(meta.redirect_uris_supported).toContain('https://claude.ai/api/mcp/auth_callback');
    expect(meta.redirect_uris_supported).toContain('http://localhost/callback');  // Claude Code loopback (port-agnostic)
    expect(meta.redirect_uris_supported).toContain('http://127.0.0.1/callback'); // Claude Code loopback (RFC 8252 §7.3)
  });

  it('exposes protected-resource metadata per RFC 9728', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const meta = await res.json();

    expect(meta.resource).toContain('/mcp');
    expect(meta.authorization_servers).toBeDefined();
  });
});
