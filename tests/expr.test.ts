import { describe, it, expect } from 'vitest';
import { resolveExpression, resolveObjectExpressions } from '../src/expr.js';

describe('Expression Resolver', () => {
  it('resolves {{input.field}} correctly', () => {
    const context = { input: { order_id: '1042', status: 'shipped' } };
    expect(resolveExpression('https://api.com/orders/{{input.order_id}}', context))
      .toBe('https://api.com/orders/1042');
  });

  it('resolves {{env.VARIABLE}} correctly', () => {
    const context = { env: { API_KEY: 'secret-token-123' } };
    expect(resolveExpression('Bearer {{env.API_KEY}}', context))
      .toBe('Bearer secret-token-123');
  });

  it('replaces missing values with empty string safely', () => {
    const context = { input: {} };
    expect(resolveExpression('https://api.com/users/{{input.missing}}', context))
      .toBe('https://api.com/users/');
  });

  it('resolves nested objects and query parameters', () => {
    const context = { input: { userId: '5', active: true } };
    const query = {
      user: '{{input.userId}}',
      status: 'active'
    };
    const resolved = resolveObjectExpressions(query, context);
    expect(resolved).toEqual({
      user: '5',
      status: 'active'
    });
  });
});
