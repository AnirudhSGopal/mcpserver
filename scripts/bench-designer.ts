import 'dotenv/config';
import { callLlmStructured } from '../src/designer/llm.js';
import { lintConfig } from '../src/lint.js';

// InvoiceApp spec — real fixture, no placeholders
const systemPrompt = `You are an MCP tool designer. Given an OpenAPI spec, output a JSON array of MCP tool definitions.
Each tool must have: name (snake_case, descriptive), description, inputSchema (JSON Schema), annotations.readOnlyHint (true for GET, false for mutations).
Output ONLY valid JSON array. No markdown, no explanation.`;

const userPrompt = `OpenAPI spec for InvoiceApp:
paths:
  /invoices:
    get:
      operationId: listInvoices
      summary: List all invoices
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [paid, unpaid, overdue] }
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        '200':
          description: Paginated invoice list
  /invoices/{id}:
    get:
      operationId: getInvoice
      summary: Get a single invoice by ID
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
    delete:
      operationId: deleteInvoice
      summary: Delete an invoice
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
  /invoices/{id}/payments:
    post:
      operationId: createPayment
      summary: Record a payment for an invoice
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [amount, method]
              properties:
                amount: { type: number }
                method: { type: string, enum: [card, bank_transfer, cash] }

Output JSON array of MCP tools only.`;

async function runBenchmark() {
  console.log('--- InvoiceApp Designer Benchmark ---');
  console.log('Keys set:', ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'].filter(k => process.env[k]));
  console.log('MODEL_ID:', process.env.MODEL_ID);
  console.log('');

  const results = [];

  for (let run = 1; run <= 3; run++) {
    console.log(`\n=== Run ${run}/3 ===`);
    const start = Date.now();

    let result;
    try {
      result = await callLlmStructured({ systemPrompt, userPrompt });
    } catch (e: any) {
      console.error(`Run ${run} failed:`, e.message);
      process.exit(1);
    }

    const elapsed = Date.now() - start;

    // Parse tools
    let tools: any[] = [];
    try {
      tools = JSON.parse(result.content);
    } catch {
      console.error('Failed to parse LLM output as JSON:', result.content.slice(0, 200));
    }

    // Run lint
    // Build a minimal config to lint tool names
    const toolNames = Array.isArray(tools) ? tools.map((t: any) => t.name) : [];
    const lintWarnings: string[] = [];
    for (const name of toolNames) {
      if (/^(get_)?(item|tool)_\d+$/i.test(name)) {
        lintWarnings.push(`PLACEHOLDER_NAME: ${name}`);
      }
    }

    // Curated pass: read tools work, write tool (delete) is absent or marked not-read-only
    const readTools = Array.isArray(tools) ? tools.filter((t: any) => t.annotations?.readOnlyHint === true) : [];
    const writeTools = Array.isArray(tools) ? tools.filter((t: any) => t.annotations?.readOnlyHint === false) : [];
    const hasListInvoices = toolNames.some((n: string) => n.includes('list') || n.includes('invoices'));
    const hasGetInvoice = toolNames.some((n: string) => n.includes('get') && n.includes('invoice'));
    const deleteMarkedWrite = Array.isArray(tools) && tools.some((t: any) => 
      (t.name.includes('delete') || t.name.includes('delet')) && t.annotations?.readOnlyHint === false
    );

    const curatedPass = hasListInvoices && hasGetInvoice && deleteMarkedWrite;
    // Baseline: at least 3 tools produced (1:1 conversion baseline)
    const baselinePass = toolNames.length >= 3;

    const runResult = {
      run,
      isRealLlm: result.isRealLlm,
      model: result.model,
      toolCount: toolNames.length,
      tools: toolNames,
      lintClean: lintWarnings.length === 0,
      lintWarnings,
      curatedPass,
      baselinePass,
      tokensUsed: result.usage.totalTokens,
      elapsedMs: elapsed
    };

    results.push(runResult);
    console.log(JSON.stringify(runResult, null, 2));
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const curatedPassRate = results.filter(r => r.curatedPass).length / results.length;
  const baselinePassRate = results.filter(r => r.baselinePass).length / results.length;
  const tokenCounts = results.map(r => r.tokensUsed);
  const avgTokens = tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length;
  const varTokens = Math.max(...tokenCounts) - Math.min(...tokenCounts);

  console.log({
    model: results[0]?.model,
    isRealLlm: results[0]?.isRealLlm,
    curatedPassRate: `${(curatedPassRate * 100).toFixed(0)}%`,
    baselinePassRate: `${(baselinePassRate * 100).toFixed(0)}%`,
    avgTokensPerRun: Math.round(avgTokens),
    tokenVariance: varTokens,
    lintCleanAllRuns: results.every(r => r.lintClean)
  });
}

runBenchmark().catch(e => { console.error(e); process.exit(1); });
