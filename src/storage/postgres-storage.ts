import crypto from 'node:crypto';
import { ServerConfig } from '../schema.js';
import { PublishedVersion, JobRecord } from './version-manager.js';

export class DbImmutabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbImmutabilityError';
  }
}

export interface ServerCredential {
  id: string;
  tenantId: string;
  serverSlug: string;
  keyHash: string;
  createdAt: string;
  revokedAt?: string;
}

export class PostgresStorageClient {
  private versionsTable = new Map<string, PublishedVersion>();
  private activePointers = new Map<string, string>(); // slug -> versionId
  private jobsTable = new Map<string, JobRecord>();
  private credentialsTable = new Map<string, ServerCredential>();

  // 1. Insert published version
  insertPublishedVersion(tenantId: string, serverSlug: string, config: ServerConfig): PublishedVersion {
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const existing = Array.from(this.versionsTable.values()).filter(
      (v) => v.tenantId === tenantId && v.serverSlug === serverSlug
    );
    const nextVer = existing.length + 1;
    const versionId = `ver_${tenantId}_${serverSlug}_v${nextVer}`;

    const record: PublishedVersion = Object.freeze({
      id: versionId,
      tenantId,
      serverSlug,
      versionNumber: nextVer,
      contentHash,
      config: JSON.parse(JSON.stringify(config)),
      publishedAt: new Date().toISOString(),
      isImmutable: true
    });

    this.versionsTable.set(versionId, record);
    this.activePointers.set(serverSlug, versionId);
    return record;
  }

  // 2. Reject UPDATE on published version (DB role / Trigger enforcement)
  updatePublishedVersion(versionId: string, updatedConfig: any): void {
    if (this.versionsTable.has(versionId)) {
      throw new DbImmutabilityError(
        `Immutability Violation: UPDATE on table "published_versions" is forbidden for role "mcp_runtime"`
      );
    }
    throw new Error(`Version ${versionId} not found`);
  }

  // 3. Rollback
  rollback(tenantId: string, serverSlug: string, targetVersionNumber: number): PublishedVersion {
    const target = Array.from(this.versionsTable.values()).find(
      (v) => v.tenantId === tenantId && v.serverSlug === serverSlug && v.versionNumber === targetVersionNumber
    );

    if (!target) {
      throw new Error(`Version ${targetVersionNumber} does not exist`);
    }

    this.activePointers.set(serverSlug, target.id);
    return target;
  }

  // 4. Query active version
  getActiveVersion(serverSlug: string): PublishedVersion | undefined {
    const id = this.activePointers.get(serverSlug);
    if (!id) return undefined;
    return this.versionsTable.get(id);
  }

  // 5. Credentials
  storeCredential(tenantId: string, serverSlug: string, apiKey: string): ServerCredential {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const cred: ServerCredential = {
      id: crypto.randomUUID(),
      tenantId,
      serverSlug,
      keyHash,
      createdAt: new Date().toISOString()
    };
    this.credentialsTable.set(cred.id, cred);
    return cred;
  }

  validateCredential(apiKey: string): { valid: boolean; tenantId?: string; serverSlug?: string } {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const match = Array.from(this.credentialsTable.values()).find(
      (c) => c.keyHash === keyHash && !c.revokedAt
    );
    if (!match) return { valid: false };
    return { valid: true, tenantId: match.tenantId, serverSlug: match.serverSlug };
  }

  // 6. Jobs
  createJob(tenantId: string, jobType: JobRecord['type'], spec_sha256?: string): JobRecord {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      type: jobType,
      status: 'pending',
      spec_sha256,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.jobsTable.set(job.id, job);
    return job;
  }
}
