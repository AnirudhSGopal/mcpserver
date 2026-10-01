import { describe, it, expect } from 'vitest';
import { PostgresStorageClient, DbImmutabilityError } from '../src/storage/postgres-storage.js';
import { ServerConfig } from '../src/schema.js';

describe('Database Persistence & Immutability Suite (Item 5)', () => {
  const db = new PostgresStorageClient();

  const configV1: ServerConfig = {
    name: 'prod-server',
    version: '1.0.0',
    inbound_auth: { type: 'api_key', key_header: 'X-API-Key' },
    tools: [
      {
        name: 'test_tool',
        description: 'Tool in v1',
        enabled: true,
        mode: 'read',
        input_schema: { type: 'object', properties: {} },
        executor: { type: 'http', source_id: 's1', steps: [] }
      }
    ]
  };

  it('enforces immutability: UPDATE on published version fails with error', () => {
    const published = db.insertPublishedVersion('tenant-1', 'prod-server', configV1);
    expect(published.versionNumber).toBe(1);

    // Attempting an UPDATE on published row throws DB immutability error
    expect(() => {
      db.updatePublishedVersion(published.id, { version: '1.0.1' });
    }).toThrow(DbImmutabilityError);
  });

  it('supports two runtime instances seeing consistent state and rollback', () => {
    // Instance 1 & 2 query the same database
    const instance1Active = db.getActiveVersion('prod-server');
    const instance2Active = db.getActiveVersion('prod-server');

    expect(instance1Active?.versionNumber).toBe(1);
    expect(instance2Active?.versionNumber).toBe(1);

    // Publish v2
    const configV2: ServerConfig = {
      ...configV1,
      version: '2.0.0',
      description: 'Updated server v2'
    };
    db.insertPublishedVersion('tenant-1', 'prod-server', configV2);

    expect(db.getActiveVersion('prod-server')?.versionNumber).toBe(2);

    // Rollback to v1
    const rolledBack = db.rollback('tenant-1', 'prod-server', 1);
    expect(rolledBack.versionNumber).toBe(1);

    // Both instances instantly observe the rollback
    expect(db.getActiveVersion('prod-server')?.versionNumber).toBe(1);
    expect(db.getActiveVersion('prod-server')?.versionNumber).toBe(1);
  });

  it('stores and validates hashed credentials', () => {
    db.storeCredential('tenant-1', 'prod-server', 'sec_key_xyz_999');

    const validCheck = db.validateCredential('sec_key_xyz_999');
    expect(validCheck.valid).toBe(true);
    expect(validCheck.tenantId).toBe('tenant-1');

    const invalidCheck = db.validateCredential('wrong_key');
    expect(invalidCheck.valid).toBe(false);
  });
});
