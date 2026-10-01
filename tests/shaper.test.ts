import { describe, it, expect } from 'vitest';
import { shapeResponse, pickFields } from '../src/shaper.js';

describe('Response Shaper', () => {
  it('picks specified fields from an object', () => {
    const raw = { id: 1, title: 'Test Post', internal_secret: 'ignore_me', body: 'Post content' };
    const shaped = pickFields(raw, ['id', 'title']);
    expect(shaped).toEqual({ id: 1, title: 'Test Post' });
  });

  it('caps arrays to max_items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shaped = shapeResponse(items, { max_items: 3 });
    expect(shaped).toEqual([1, 2, 3]);
  });

  it('picks fields and caps items simultaneously', () => {
    const items = [
      { id: 1, name: 'Alice', secret: 'a' },
      { id: 2, name: 'Bob', secret: 'b' },
      { id: 3, name: 'Charlie', secret: 'c' }
    ];
    const shaped = shapeResponse(items, { pick: ['id', 'name'], max_items: 2 });
    expect(shaped).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]);
  });

  it('truncates response exceeding max_bytes safely', () => {
    const bigData = { text: 'A'.repeat(500) };
    const shaped = shapeResponse(bigData, { max_bytes: 100 });
    expect(shaped.warning).toContain('Response truncated');
    expect(shaped.raw_preview).toBeDefined();
  });
});
