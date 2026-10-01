import { describe, it, expect } from 'vitest';
import {
  validateAssistantAction,
  validateChatForCredentials,
  generateAndHashApiKey,
  AssistantSecurityError,
  ProjectState
} from '../src/builder/assistant.js';
import { McpRuntimeServer } from '../src/protocol/server.js';
import { ServerConfig } from '../src/schema.js';

describe('Assistant Guardrails & Policy Enforcement (STEP B)', () => {
  const sampleProjectState: Partial<ProjectState> = {
    name: 'Invoice Assistant',
    slug: 'invoiceapp',
    tools: [
      { name: 'list_invoices', description: 'List invoices', mode: 'read', enabled: true },
      { name: 'get_invoice', description: 'Get invoice', mode: 'read', enabled: true },
      { name: 'delete_invoice', description: 'Delete invoice', mode: 'write', enabled: false }
    ]
  };

  it('server-side rejection: assistant CANNOT enable a write tool', () => {
    expect(() => {
      validateAssistantAction(
        'enable_tool',
        { toolName: 'delete_invoice', enabled: true },
        sampleProjectState
      );
    }).toThrowError(AssistantSecurityError);

    try {
      validateAssistantAction(
        'enable_tool',
        { toolName: 'delete_invoice', enabled: true },
        sampleProjectState
      );
    } catch (err: any) {
      expect(err.code).toBe('WRITE_TOOL_BLOCKED');
      expect(err.message).toMatch(/cannot enable write tool/i);
    }
  });

  it('server-side rejection: assistant CANNOT publish connections', () => {
    expect(() => {
      validateAssistantAction('publish', {}, sampleProjectState);
    }).toThrowError(AssistantSecurityError);

    try {
      validateAssistantAction('publish', {}, sampleProjectState);
    } catch (err: any) {
      expect(err.code).toBe('PUBLISH_BLOCKED');
      expect(err.message).toMatch(/cannot publish/i);
    }
  });

  it('server-side rejection: chat messages containing raw credentials are blocked', () => {
    // API key pattern
    expect(() => {
      validateChatForCredentials('Here is my key: sk-ant-api03-123456789012345678901234567890');
    }).toThrowError(AssistantSecurityError);

    // Secret pattern
    expect(() => {
      validateChatForCredentials('Use secret key_live_abcdef1234567890abcdef');
    }).toThrowError(AssistantSecurityError);

    // Password pattern
    expect(() => {
      validateChatForCredentials('password = "mySecretPassword123"');
    }).toThrowError(AssistantSecurityError);

    try {
      validateChatForCredentials('sk-ant-12345678901234567890123456');
    } catch (err: any) {
      expect(err.code).toBe('CREDENTIAL_IN_CHAT');
      expect(err.message).toMatch(/credentials cannot be sent directly in chat/i);
    }
  });

  it('allowed actions: propose_plan and request_secure_form pass validation', () => {
    expect(() => {
      validateAssistantAction(
        'propose_plan',
        { summary: 'Set up billing', recommendedTools: ['list_invoices'] },
        sampleProjectState
      );
    }).not.toThrow();

    expect(() => {
      validateAssistantAction(
        'request_secure_form',
        { kind: 'api_key', prompt: 'Enter your API key' },
        sampleProjectState
      );
    }).not.toThrow();
  });

  it('key security: generates random key, stores only SHA-256 hash, authenticates correctly', () => {
    const { rawKey, keyHash } = generateAndHashApiKey();

    expect(rawKey.startsWith('sec_live_')).toBe(true);
    expect(keyHash.length).toBe(64); // SHA-256 hex string

    const config: ServerConfig = {
      name: 'hashed-auth-server',
      version: '1.0.0',
      inbound_auth: { type: 'api_key', key_header: 'X-API-Key' },
      tools: []
    };

    const runtime = new McpRuntimeServer(config);
    // Register by hash only! Raw key is never stored in runtime memory.
    runtime.registerApiKeyHash(keyHash, 'tenant-secure-corp');

    // Authenticate with raw key
    const auth = runtime.authenticateInbound({ 'x-api-key': rawKey });
    expect(auth.authenticated).toBe(true);
    expect(auth.tenantId).toBe('tenant-secure-corp');

    // Wrong key fails
    expect(() => {
      runtime.authenticateInbound({ 'x-api-key': 'wrong-key-value' });
    }).toThrow(/Unauthorized/);
  });
});
