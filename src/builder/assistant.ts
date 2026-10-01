import crypto from 'node:crypto';
import { callLlmStructured, LlmCompletionResult } from '../designer/llm.js';

export interface ProjectState {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  spec?: any;
  sources: Array<{ id: string; type: string; baseUrl: string; status: 'connected' | 'error' | 'pending' }>;
  needs: string[];
  tools: Array<{ name: string; description: string; mode: 'read' | 'write'; enabled: boolean }>;
  coverage: { coveredCount: number; totalCount: number; percentage: number };
  tests: { passed: number; total: number; passRate: number };
  published: boolean;
  mcpUrl?: string;
  apiKeyHash?: string;
  rawApiKey?: string;
}

export type AssistantFunctionCall =
  | { name: 'ask_clarifying_question'; arguments: { question: string } }
  | { name: 'propose_plan'; arguments: { summary: string; recommendedTools: string[] } }
  | { name: 'start_design'; arguments: { requirement: string } }
  | { name: 'run_tests'; arguments: Record<string, never> }
  | { name: 'apply_fix'; arguments: { toolName: string; field: 'description' | 'summary'; value: string } }
  | { name: 'request_secure_form'; arguments: { kind: 'api_key' | 'database'; prompt: string } }
  | { name: 'explain_result'; arguments: { explanation: string } };

export class AssistantSecurityError extends Error {
  constructor(message: string, public code: 'WRITE_TOOL_BLOCKED' | 'PUBLISH_BLOCKED' | 'CREDENTIAL_IN_CHAT') {
    super(message);
    this.name = 'AssistantSecurityError';
  }
}

/**
 * Patterns matching sensitive secrets/credentials in chat messages
 */
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/i,
  /ghp_[a-zA-Z0-9]{20,}/i,
  /key_live_[a-zA-Z0-9_-]{16,}/i,
  /sec_live_[a-zA-Z0-9_-]{16,}/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /bearer\s+[a-zA-Z0-9._-]{24,}/i
];

export function validateChatForCredentials(text: string): void {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      throw new AssistantSecurityError(
        'Credentials cannot be sent directly in chat. Please use the secure form instead.',
        'CREDENTIAL_IN_CHAT'
      );
    }
  }
}

/**
 * Server-side policy enforcement: validates that the assistant never enables a write tool or publishes.
 */
export function validateAssistantAction(
  actionName: string,
  args: any,
  projectState: Partial<ProjectState>
): void {
  // 1. Assistant CANNOT publish
  if (actionName === 'publish' || (args && args.publish === true)) {
    throw new AssistantSecurityError(
      'The assistant cannot publish connections. An explicit human confirmation via the UI button is strictly required.',
      'PUBLISH_BLOCKED'
    );
  }

  // 2. Assistant CANNOT enable a write tool
  if (actionName === 'enable_tool' || actionName === 'apply_fix') {
    const targetToolName = args?.toolName;
    const requestedEnabled = args?.enabled;

    if (requestedEnabled === true && targetToolName && projectState.tools) {
      const tool = projectState.tools.find((t) => t.name === targetToolName);
      if (tool && tool.mode === 'write') {
        throw new AssistantSecurityError(
          `The assistant cannot enable write tool "${targetToolName}". Write tools require human review and confirmation via UI toggle.`,
          'WRITE_TOOL_BLOCKED'
        );
      }
    }
  }
}

export interface AssistantTurnParams {
  userMessage: string;
  projectSummary: string;
  projectState: Partial<ProjectState>;
}

export interface AssistantTurnResponse {
  reply: string;
  action?: AssistantFunctionCall;
  updatedProjectSummary: string;
}

export function generateAndHashApiKey(): { rawKey: string; keyHash: string } {
  const rawKey = `sec_live_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyHash };
}

export async function processAssistantTurn(params: AssistantTurnParams): Promise<AssistantTurnResponse> {
  // 1. Guardrail: Reject credentials in chat
  validateChatForCredentials(params.userMessage);

  const systemPrompt = `You are a helpful AI Builder Assistant for non-technical business owners.
You help them connect their business data to AI assistants.
You speak in clear, plain sentence-case English (no technical jargon like OpenAPI, JSON-RPC, or slug).

Your available abilities (function calls):
- ask_clarifying_question: { "question": "..." }
- propose_plan: { "summary": "...", "recommendedTools": ["tool1"] }
- start_design: { "requirement": "..." }
- run_tests: {}
- apply_fix: { "toolName": "...", "field": "description", "value": "..." }
- request_secure_form: { "kind": "api_key" | "database", "prompt": "..." }
- explain_result: { "explanation": "..." }

CRITICAL GUARDRAILS (Server enforced):
- You CANNOT publish connections.
- You CANNOT enable write or mutation tools.
- You CANNOT accept API keys or passwords in chat; if the user mentions credentials, call request_secure_form.

Output JSON with this schema:
{
  "reply": "Plain language reply to the user",
  "action": { "name": "<function_name>", "arguments": { ... } } (optional),
  "updatedProjectSummary": "1-2 sentence rolling summary of the project state"
}`;

  // Structured state + short summary (do not resend full conversation history)
  const userPrompt = `Project Summary: ${params.projectSummary || 'New project starting.'}
Project State:
- Name: ${params.projectState.name || 'Untitled'}
- Base URL: ${params.projectState.baseUrl || 'None'}
- Actions count: ${params.projectState.tools?.length || 0}
- Tests passed: ${params.projectState.tests?.passed || 0}/${params.projectState.tests?.total || 0}

User message: "${params.userMessage}"

Respond in JSON format.`;

  const completion = await callLlmStructured({
    systemPrompt,
    userPrompt,
    mockResponseGenerator: () => {
      // Deterministic fallback for test mode
      const lower = params.userMessage.toLowerCase();
      if (lower.includes('credential') || lower.includes('key') || lower.includes('token') || lower.includes('auth')) {
        return JSON.stringify({
          reply: 'I can help you securely connect your credentials. Please enter your secret key into the secure dialog.',
          action: {
            name: 'request_secure_form',
            arguments: { kind: 'api_key', prompt: 'Please enter your API key securely.' }
          },
          updatedProjectSummary: 'Requested secure credential form from user.'
        });
      }

      if (lower.includes('test') || lower.includes('verify')) {
        return JSON.stringify({
          reply: 'Running reliability tests on your actions now.',
          action: { name: 'run_tests', arguments: {} },
          updatedProjectSummary: 'Ran automated reliability tests on actions.'
        });
      }

      return JSON.stringify({
        reply: `I understand your goal is: "${params.userMessage}". Let's set up your data connection.`,
        action: {
          name: 'propose_plan',
          arguments: {
            summary: `Configure actions for ${params.userMessage}`,
            recommendedTools: ['list_items', 'get_item']
          }
        },
        updatedProjectSummary: `User goal set to ${params.userMessage}.`
      });
    }
  });

  let parsed: any;
  let textToParse = completion.content.trim();
  if (textToParse.startsWith('```')) {
    textToParse = textToParse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    parsed = JSON.parse(textToParse);
  } catch {
    parsed = {
      reply: completion.content,
      updatedProjectSummary: params.projectSummary
    };
  }

  // Server-side validation of action
  if (parsed.action) {
    validateAssistantAction(parsed.action.name, parsed.action.arguments, params.projectState);
  }

  return {
    reply: parsed.reply || 'Understood.',
    action: parsed.action,
    updatedProjectSummary: parsed.updatedProjectSummary || params.projectSummary
  };
}
