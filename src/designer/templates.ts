export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  requirement_prefill: string;
  guidance_text: string;
  expected_tool_patterns: string[];
  eval_seed_prompts: string[];
}

export const TEMPLATES: Record<string, TemplateDefinition> = {
  support: {
    id: 'support',
    name: 'Customer Support',
    description: 'Support agent handling order status, ticket creation, customer details, and FAQ searches.',
    requirement_prefill: 'Enable the AI support assistant to check customer details, look up order statuses, create tickets, and search help center articles.',
    guidance_text: 'Prioritize read tools for customer and order status. Group ticket creation into a single write tool. Ensure sensitive customer PII is not exposed directly.',
    expected_tool_patterns: ['get_customer', 'get_order_status', 'search_help', 'create_ticket'],
    eval_seed_prompts: [
      'Where is my order #1042?',
      'Can you look up customer info for user@example.com?',
      'Submit a support ticket regarding delayed shipment'
    ]
  },
  finance: {
    id: 'finance',
    name: 'Finance & Invoicing',
    description: 'Finance workflows covering invoices, payments, refunds, and expense inquiries.',
    requirement_prefill: 'Allow finance assistants to search and inspect invoices, list customer balances, and prepare draft refunds.',
    guidance_text: 'Invoices should have list/get tools. Write tools like issuing refunds or sending reminders must be disabled by default and flagged destructive. Never allow bulk invoice deletion.',
    expected_tool_patterns: ['list_invoices', 'get_invoice', 'send_invoice_reminder', 'create_refund_draft'],
    eval_seed_prompts: [
      'What are the outstanding invoices for customer ACME?',
      'Retrieve details for invoice #INV-2024',
      'Send a payment reminder for invoice 99'
    ]
  },
  hr: {
    id: 'hr',
    name: 'HR & People Operations',
    description: 'Internal employee lookups, leave balance queries, and policy search.',
    requirement_prefill: 'Provide employees with an assistant that answers leave balance questions, company directory lookups, and benefits queries.',
    guidance_text: 'Strictly limit fields returned by directory lookups. Omit salary, social security, and performance review data from all response shaping. Ensure write tools for leave booking are disabled by default.',
    expected_tool_patterns: ['get_leave_balance', 'search_directory', 'get_company_policy'],
    eval_seed_prompts: [
      'How many days of PTO do I have remaining?',
      'Who is the engineering manager for team Apollo?',
      'What is the parental leave policy?'
    ]
  }
};
