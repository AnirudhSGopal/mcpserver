import { createMcpHttpServer } from './protocol/http-server.js';
import { McpRuntimeServer } from './protocol/server.js';
import { ServerConfig } from './schema.js';
import { Vault } from './vault.js';

process.env.ALLOW_LOOPBACK_DEV = '1';

const PORT = 3000;

export const invoiceAppConfig: ServerConfig = {
  name: 'invoiceapp',
  version: '1.0.0',
  inbound_auth: {
    type: 'api_key',
    key_header: 'X-API-Key'
  },
  sources: [
    {
      type: 'openapi',
      id: 'local_invoiceapp_api',
      base_url: `http://127.0.0.1:${PORT}`,
      allowed_hosts: ['127.0.0.1', 'localhost']
    }
  ],
  tools: [
    {
      name: 'list_invoices',
      description: 'List all recent customer invoices from the InvoiceApp database.',
      enabled: true,
      mode: 'read',
      pagination: { limit_param: 'limit' },
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max invoices to return' }
        }
      },
      executor: {
        type: 'http',
        source_id: 'local_invoiceapp_api',
        steps: [
          {
            method: 'GET',
            path: '/invoiceapp/invoices',
            response_shaping: {
              pick: ['id', 'invoice_number', 'customer', 'amount', 'status']
            }
          }
        ]
      }
    },
    {
      name: 'get_invoice',
      description: 'Get details of an invoice by ID.',
      enabled: true,
      mode: 'read',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Invoice ID' }
        },
        required: ['id']
      },
      executor: {
        type: 'http',
        source_id: 'local_invoiceapp_api',
        steps: [
          {
            method: 'GET',
            path: '/invoiceapp/invoices/{{input.id}}',
            response_shaping: {
              pick: ['id', 'invoice_number', 'customer', 'amount', 'status', 'due_date']
            }
          }
        ]
      }
    },
    {
      name: 'delete_invoice',
      description: 'Permanently delete an invoice by ID (Destructive write action).',
      enabled: false, // Non-negotiable: write tools are disabled by default
      mode: 'write',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true
      },
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Invoice ID to delete' }
        },
        required: ['id']
      },
      executor: {
        type: 'http',
        source_id: 'local_invoiceapp_api',
        steps: [
          {
            method: 'DELETE',
            path: '/invoiceapp/invoices/{{input.id}}'
          }
        ]
      }
    }
  ]
};

export function startInvoiceAppServer(port: number = PORT) {
  const vault = new Vault();
  const runtime = new McpRuntimeServer(invoiceAppConfig, vault);
  runtime.registerApiKey('mcp_live_claude_connector_key_8888', 'tenant-invoice-corp');

  const server = createMcpHttpServer(runtime);
  server.listen(port, '127.0.0.1', () => {
    console.log(`InvoiceApp MCP Server listening at http://127.0.0.1:${port}/mcp`);
  });
  return server;
}

if (process.argv[1]?.includes('serve-invoiceapp')) {
  startInvoiceAppServer(PORT);
}
