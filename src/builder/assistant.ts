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

  const systemPrompt = `You are MCPForge's AI Builder Assistant. You help users build custom MCP (Model Context Protocol) servers that securely connect their business systems and data to AI assistants like Claude and ChatGPT.

CORE INTERACTION PATTERN:
1. When a user states what they want to build (e.g. "I need an MCP for company details and employee data" or mentions invoices, orders, crm, etc.):
   - Explain briefly (1-2 sentences) how this MCP server will help them (e.g. "An MCP server acts as a secure bridge so Claude can query company records and look up employee details in natural language.").
   - Recommend a clean, safe set of 3-4 tools tailored to their request.
   - Always call the propose_plan function with:
     { "summary": "<Concise Goal Name>", "recommendedTools": ["tool_1", "tool_2", "tool_3"] }
   - Tell the user: "If this plan looks good to you, click 'Proceed' or reply 'ok' to move to Step 2: Connect Data."

2. When the user agrees ("ok", "proceed", "yes", "sounds good", "continue"):
   - Acknowledge their approval and confirm we are moving to Step 2 (Connect Data Source).

Your available abilities (function calls):
- propose_plan: { "summary": "...", "recommendedTools": ["tool1", "tool2"] }
- ask_clarifying_question: { "question": "..." }
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
  "reply": "Plain language explanation and recommendation to the user",
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

      if (lower.includes('ok') || lower.includes('proceed') || lower.includes('yes') || lower.includes('confirm')) {
        return JSON.stringify({
          reply: 'Great! Moving forward to Step 2: Connect Data Source. Please verify your base API URL and schema.',
          action: { name: 'start_design', arguments: { requirement: params.projectSummary || 'Connect data' } },
          updatedProjectSummary: 'User confirmed plan. Advanced to Connect Data milestone.'
        });
      }

      if (lower.includes('company') || lower.includes('employee')) {
        return JSON.stringify({
          reply: `An MCP (Model Context Protocol) server will securely connect Claude to your company's records so you can ask natural questions like "Who reports to the Head of Engineering?" or "Find Jane's contact details". I recommend starting with safe read tools for company profile, staff directory, and department lookups.`,
          action: {
            name: 'propose_plan',
            arguments: {
              summary: 'Company & Employee Records MCP',
              recommendedTools: ['get_company_profile', 'list_employees', 'get_employee_details', 'search_departments']
            }
          },
          updatedProjectSummary: 'Goal set to Company & Employee Records MCP.'
        });
      }

      return JSON.stringify({
        reply: `An MCP (Model Context Protocol) server lets your AI assistant interact safely with your system. For "${params.userMessage}", I recommend setting up read tools to query and inspect this data. If this plan looks good to you, click "Proceed" or reply "ok" to move to Connect Data.`,
        action: {
          name: 'propose_plan',
          arguments: {
            summary: `MCP for ${params.userMessage}`,
            recommendedTools: ['list_items', 'get_item_details', 'search_records']
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
