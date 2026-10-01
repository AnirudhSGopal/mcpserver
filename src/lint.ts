import { ServerConfig, ToolDefinition } from './schema.js';

export interface LintIssue {
  severity: 'error' | 'warning';
  tool?: string;
  field?: string;
  message: string;
}

export function lintConfig(config: ServerConfig): LintIssue[] {
  const issues: LintIssue[] = [];

  // Check server tool count (PRD / prompt guideline: 8-25 tools)
  if (config.tools.length > 25) {
    issues.push({
      severity: 'warning',
      field: 'tools',
      message: `Server has ${config.tools.length} tools. Recommended maximum is 25 to avoid model confusion.`
    });
  }

  for (const tool of config.tools) {
    // Lint rule: reject placeholder tool names (get_item_N, tool_N, item_N)
    if (/^(get_)?(item|tool)_\d+$/i.test(tool.name)) {
      issues.push({
        severity: 'error',
        tool: tool.name,
        message: `Placeholder tool name "${tool.name}" is rejected. Tools must be task-oriented domain verbs.`
      });
    }

    // Check write tool enabled
    if (tool.mode === 'write' && tool.enabled) {
      issues.push({
        severity: 'warning',
        tool: tool.name,
        message: `Write tool "${tool.name}" is enabled by default. Production best-practice is disabled by default.`
      });
    }

    // F10: Lint-warn list tools without pagination
    const isListTool = tool.name.startsWith('list_') || tool.name.startsWith('search_') || tool.name.includes('_list');
    if (isListTool && !tool.pagination) {
      issues.push({
        severity: 'warning',
        tool: tool.name,
        message: `List tool "${tool.name}" has no pagination configuration defined.`
      });
    }

    // F4: approval required check
    if (tool.approval?.required && tool.enabled) {
      issues.push({
        severity: 'warning',
        tool: tool.name,
        message: `Tool "${tool.name}" requires manual approval which is currently pending runtime enforcement.`
      });
    }

    // Check descriptions
    if (tool.description.length < 20) {
      issues.push({
        severity: 'warning',
        tool: tool.name,
        message: `Tool "${tool.name}" description is too brief. Provide when to use and when NOT to use.`
      });
    }
  }

  return issues;
}
