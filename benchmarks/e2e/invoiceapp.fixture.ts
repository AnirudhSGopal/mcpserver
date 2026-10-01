export function generateInvoiceAppOpenApiSpec() {
  const paths: Record<string, any> = {};

  // 1. Invoices operations (list, get, create, send_reminder, delete, etc.)
  paths['/invoices'] = {
    get: {
      operationId: 'list_invoices',
      summary: 'List recent customer invoices',
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'cursor', in: 'query', schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'List of invoices' } }
    },
    post: {
      operationId: 'create_invoice',
      summary: 'Create a new invoice',
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { '201': { description: 'Invoice created' } }
    }
  };

  paths['/invoices/{id}'] = {
    get: {
      operationId: 'get_invoice',
      summary: 'Retrieve invoice details by ID',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Invoice details' } }
    },
    delete: {
      operationId: 'delete_invoice',
      summary: 'Delete an invoice permanently (destructive)',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Invoice deleted' } }
    }
  };

  paths['/invoices/{id}/send-reminder'] = {
    post: {
      operationId: 'send_invoice_reminder',
      summary: 'Send invoice payment reminder notification',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Reminder sent' } }
    }
  };

  // 2. Customers operations
  paths['/customers'] = {
    get: {
      operationId: 'list_customers',
      summary: 'Search customer accounts',
      responses: { '200': { description: 'List of customers' } }
    },
    post: {
      operationId: 'create_customer',
      summary: 'Register a new customer',
      responses: { '201': { description: 'Customer created' } }
    }
  };

  paths['/customers/{id}'] = {
    get: {
      operationId: 'get_customer',
      summary: 'Get customer details',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Customer details' } }
    }
  };

  // 3. Deprecated operation (assert 1: must be dropped)
  paths['/invoices/legacy-search'] = {
    get: {
      operationId: 'legacy_search_invoices',
      summary: 'Old invoice search (deprecated)',
      deprecated: true,
      responses: { '200': { description: 'Legacy results' } }
    }
  };

  // 4. Admin and Internal operations (assert 3: must be omitted)
  paths['/internal/health'] = {
    get: {
      operationId: 'get_internal_health',
      summary: 'System health check',
      responses: { '200': { description: 'Health status' } }
    }
  };

  paths['/admin/system-config'] = {
    get: {
      operationId: 'get_admin_system_config',
      summary: 'Admin configurations',
      responses: { '200': { description: 'Config' } }
    }
  };

  // Real domain resources to reach ~40 operations without placeholder names
  const domainResources = [
    'payments', 'refunds', 'subscriptions', 'disputes', 'tax_rates',
    'coupons', 'bank_accounts', 'payouts', 'credit_notes', 'ledger_entries',
    'quotes', 'transactions', 'billing_schedules', 'audit_events', 'statements'
  ];

  for (const resource of domainResources) {
    paths[`/${resource}`] = {
      get: {
        operationId: `list_${resource}`,
        summary: `List ${resource.replace(/_/g, ' ')}`,
        responses: { '200': { description: `List of ${resource}` } }
      },
      post: {
        operationId: `create_${resource.slice(0, -1)}`,
        summary: `Create new ${resource.slice(0, -1)}`,
        responses: { '201': { description: 'Created' } }
      }
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'InvoiceApp API',
      version: '1.0.0',
      description: 'API for managing customer invoices and payments'
    },
    servers: [
      { url: 'https://api.invoiceapp-untrusted-auto.com' } // F17: must not auto-follow
    ],
    paths
  };
}
