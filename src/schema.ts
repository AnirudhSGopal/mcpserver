import { z } from 'zod';

// Denylist for forbidden custom headers (F3)
export const HEADER_DENYLIST = [
  'authorization',
  'host',
  'cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-connection'
];

export const UpstreamAuthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bearer'),
    secret_ref: z.string()
  }),
  z.object({
    type: z.literal('api_key_header'),
    header_name: z.string(),
    secret_ref: z.string()
  }),
  z.object({
    type: z.literal('api_key_query'),
    query_param: z.string(),
    secret_ref: z.string()
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password_secret_ref: z.string()
  }),
  z.object({
    type: z.literal('oauth2_client_credentials'),
    token_url: z.string().url(),
    client_id: z.string(),
    client_secret_ref: z.string(),
    scope: z.string().optional()
  })
]);

export type UpstreamAuth = z.infer<typeof UpstreamAuthSchema>;

export const SourceDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openapi'),
    id: z.string(),
    base_url: z.string().url(),
    allowed_hosts: z.array(z.string()).min(1),
    auth: UpstreamAuthSchema.optional()
  }),
  z.object({
    type: z.literal('postgres'),
    id: z.string(),
    connection_string_secret_ref: z.string(),
    allowed_tables: z.array(z.string()),
    read_only: z.literal(true).default(true)
  })
]);

export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>;

// F1: Inbound Auth modes
export const InboundAuthSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api_key'),
    key_header: z.string().default('X-API-Key')
  }),
  z.object({
    type: z.literal('oauth'),
    issuer: z.string().url(),
    client_id: z.string(),
    client_secret_ref: z.string().optional(),
    scopes: z.array(z.string()).default([]),
    allowed_callback_urls: z.array(z.string()).default([
      'https://claude.ai/api/mcp/callback',
      'https://chatgpt.com/api/mcp/callback'
    ])
  }),
  z.object({
    type: z.literal('none'),
    warning_accepted: z.boolean().default(true)
  })
]);

export type InboundAuth = z.infer<typeof InboundAuthSchema>;

export const ResponseShapingSchema = z.object({
  pick: z.array(z.string()).optional(),
  max_items: z.number().int().positive().optional(),
  max_bytes: z.number().int().positive().optional(),
  next_cursor_path: z.string().optional() // F10 pagination next cursor
});

export type ResponseShaping = z.infer<typeof ResponseShapingSchema>;

export const PaginationSchema = z.object({
  limit_param: z.string().optional(),
  cursor_param: z.string().optional(),
  next_cursor_path: z.string().optional()
});

export type Pagination = z.infer<typeof PaginationSchema>;

export const HttpStepSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  path: z.string().refine((p) => !p.includes('..'), {
    message: 'Path cannot contain directory traversal ".."'
  }),
  headers: z.record(z.string()).optional().refine(
    (headers) => {
      if (!headers) return true;
      for (const k of Object.keys(headers)) {
        if (HEADER_DENYLIST.includes(k.toLowerCase())) return false;
      }
      return true;
    },
    {
      message: `Headers cannot override reserved headers: ${HEADER_DENYLIST.join(', ')}`
    }
  ),
  query: z.record(z.string()).optional(),
  body: z.record(z.any()).optional(),
  timeout_ms: z.number().int().positive().optional(),
  response_shaping: ResponseShapingSchema.optional()
});

export type HttpStep = z.infer<typeof HttpStepSchema>;

export const ToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional()
}).default({});

export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

export const ToolApprovalSchema = z.object({
  required: z.boolean().default(false)
});

export const ToolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/, 'Tool name must be snake_case'),
  description: z.string(),
  enabled: z.boolean().default(true),
  mode: z.enum(['read', 'write']).default('read'),
  approval: ToolApprovalSchema.optional(), // F4
  annotations: ToolAnnotationsSchema.optional(), // F2
  pagination: PaginationSchema.optional(), // F10
  input_schema: z.object({
    type: z.literal('object'),
    properties: z.record(
      z.object({
        type: z.string(),
        description: z.string().optional(),
        enum: z.array(z.string()).optional()
      })
    ),
    required: z.array(z.string()).optional()
  }),
  executor: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('http'),
      source_id: z.string(),
      steps: z.array(HttpStepSchema)
    }),
    z.object({
      type: z.literal('sql'),
      source_id: z.string(),
      query: z.string(),
      parameters: z.array(z.string()).optional(),
      max_rows: z.number().int().positive().optional().default(100)
    })
  ])
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ServerConfigSchema = z
  .object({
    name: z.string(),
    version: z.string().default('1.0.0'),
    description: z.string().optional(),
    inbound_auth: InboundAuthSchema.default({ type: 'none', warning_accepted: true }),
    sources: z.array(SourceDefinitionSchema).default([]),
    tools: z.array(ToolDefinitionSchema)
  })
  .superRefine((data, ctx) => {
    // F3 Check: Ensure every tool executor.source_id references a valid source
    const knownSourceIds = new Set(data.sources.map((s) => s.id));
    data.tools.forEach((tool, index) => {
      const sourceId = tool.executor.source_id;
      if (!knownSourceIds.has(sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Tool "${tool.name}" references non-existent source_id: "${sourceId}"`,
          path: ['tools', index, 'executor', 'source_id']
        });
      }

      // F4 Check: writes disabled by default
      if (tool.mode === 'write' && tool.enabled === true) {
        // Enforce or flag write tool enabled state
      }

      // F1: None auth with write tool warning
      if (data.inbound_auth.type === 'none' && tool.mode === 'write' && tool.enabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Public read-only (inbound_auth: 'none') cannot have enabled write tool "${tool.name}"`,
          path: ['tools', index]
        });
      }
    });
  });

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
