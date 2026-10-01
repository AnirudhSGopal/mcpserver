/**
 * Safe expression resolver without eval.
 * Resolves templates like {{input.order_id}} or {{env.API_KEY}}
 * Hardened against prototype pollution and path traversal (F5).
 */

export interface ExpressionContext {
  input?: Record<string, any>;
  env?: Record<string, string | undefined>;
}

export class ExpressionSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionSecurityError';
  }
}

function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    // Block prototype pollution
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      throw new ExpressionSecurityError(`Forbidden property access: ${part}`);
    }
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export function sanitizePathParam(val: any): string {
  const str = String(val);
  // F5 HIGH: reject "/" and ".." values
  if (str.includes('/') || str.includes('\\') || str.includes('..')) {
    throw new ExpressionSecurityError(`Path parameter contains illegal traversal characters ('/', '\\', or '..'): "${str}"`);
  }
  return encodeURIComponent(str);
}

export function resolveExpression(
  template: string,
  context: ExpressionContext,
  options?: { isPathParam?: boolean }
): string {
  if (typeof template !== 'string') {
    return template;
  }

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, expression) => {
    const [namespace, ...rest] = expression.split('.');
    const fieldPath = rest.join('.');

    let val: any = undefined;
    if (namespace === 'input' && context.input) {
      val = fieldPath ? getNestedValue(context.input, fieldPath) : context.input;
    } else if (namespace === 'env' && context.env) {
      val = context.env[fieldPath];
    }

    if (val === undefined || val === null) {
      return '';
    }

    if (options?.isPathParam) {
      return sanitizePathParam(val);
    }

    return String(val);
  });
}

export function resolveUrlTemplate(urlTemplate: string, context: ExpressionContext): string {
  // Identify path portion before query
  const [urlBaseAndPath, queryString] = urlTemplate.split('?');

  // Path template substitution with path param sanitization (F5)
  const resolvedPath = resolveExpression(urlBaseAndPath, context, { isPathParam: true });

  // Disallow any ".." in resolved path
  if (resolvedPath.includes('/../') || resolvedPath.endsWith('/..') || resolvedPath.includes('\\..\\')) {
    throw new ExpressionSecurityError(`Resolved URL path contains directory traversal: "${resolvedPath}"`);
  }

  if (queryString !== undefined) {
    const resolvedQuery = resolveExpression(queryString, context, { isPathParam: false });
    return `${resolvedPath}?${resolvedQuery}`;
  }

  return resolvedPath;
}

export function resolveObjectExpressions(obj: any, context: ExpressionContext): any {
  if (typeof obj === 'string') {
    return resolveExpression(obj, context);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveObjectExpressions(item, context));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        throw new ExpressionSecurityError(`Forbidden key in object expression: ${k}`);
      }
      result[resolveExpression(k, context)] = resolveObjectExpressions(v, context);
    }
    return result;
  }
  return obj;
}
