import { ResponseShaping } from './schema.js';

export function pickFields(obj: any, fields: string[]): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => pickFields(item, fields));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const field of fields) {
      if (field in obj) {
        result[field] = obj[field];
      }
    }
    return result;
  }
  return obj;
}

export function shapeResponse(data: any, shaping?: ResponseShaping): any {
  if (!shaping) return data;

  let result = data;

  // 1. Cap items in array
  if (Array.isArray(result) && shaping.max_items !== undefined) {
    result = result.slice(0, shaping.max_items);
  }

  // 2. Pick fields
  if (shaping.pick && shaping.pick.length > 0) {
    result = pickFields(result, shaping.pick);
  }

  // 3. Cap bytes
  if (shaping.max_bytes !== undefined) {
    const jsonStr = JSON.stringify(result);
    const bytes = Buffer.byteLength(jsonStr, 'utf8');
    if (bytes > shaping.max_bytes) {
      const truncated = jsonStr.slice(0, shaping.max_bytes);
      return {
        warning: `Response truncated because it exceeded ${shaping.max_bytes} bytes`,
        raw_preview: truncated
      };
    }
  }

  return result;
}
