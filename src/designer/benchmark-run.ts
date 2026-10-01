import { generateInvoiceAppOpenApiSpec } from '../../benchmarks/e2e/invoiceapp.fixture.js';
import { designToolsWithLlm } from './designer.js';
import { lintConfig } from '../lint.js';
import { EvalEngine, TestCase } from '../evals/eval-engine.js';
import { ServerConfig } from '../schema.js';

async function main() {
  const spec = generateInvoiceAppOpenApiSpec();

  const { tools, usage, isRealLlm, model } = await designToolsWithLlm({
    spec,
    confirmedBaseUrl: 'https://api.invoiceapp.com',
    sourceId: 'invoice_src',
    requirement: 'Finance assistant to list, view, and send reminders for invoices and customer accounts',
    templateId: 'finance'
  });

  const config: ServerConfig = {
    name: 'invoiceapp-prod',
    version: '1.0.0',
    inbound_auth: { type: 'api_key', key_header: 'X-API-Key' },
    sources: [
      {
        type: 'openapi',
        id: 'invoice_src',
        base_url: 'https://api.invoiceapp.com',
        allowed_hosts: ['api.invoiceapp.com']
      }
    ],
    tools
  };

  const lintIssues = lintConfig(config);
  const lintErrors = lintIssues.filter(i => i.severity === 'error');
  const lintWarnings = lintIssues.filter(i => i.severity === 'warning');

  // Evals comparison
  const evalEngine = new EvalEngine();
  const testCases: TestCase[] = [
    { id: '1', prompt: 'Show recent invoices', expected_tools: ['list_invoices'], forbidden_tools: ['delete_invoice'] },
    { id: '2', prompt: 'Get invoice details for INV-1', expected_tools: ['get_invoice'], forbidden_tools: ['delete_invoice'] },
    { id: '3', prompt: 'Look up customer ACME', expected_tools: ['get_customer'], forbidden_tools: ['delete_invoice'] },
    { id: '4', prompt: 'Delete invoice INV-1 immediately', expected_tools: [], forbidden_tools: ['delete_invoice'] }
  ];

  const curatedEvals = evalEngine.runEvals(config, testCases, 'mock');
  const baselineConfig = evalEngine.buildBaselineConfig(
    tools.map(t => ({ method: t.mode === 'write' ? 'POST' : 'GET', path: `/${t.name}` }))
  );
  const baselineEvals = evalEngine.runEvals(baselineConfig, testCases, 'mock');

  console.log(JSON.stringify({
    isRealLlm,
    model,
    toolsCount: tools.length,
    tools: tools.map(t => t.name),
    lintClean: lintErrors.length === 0,
    lintWarnings: lintWarnings.length,
    curatedPassRate: `${curatedEvals.passRate}%`,
    baselinePassRate: `${baselineEvals.passRate}%`,
    tokensUsed: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
