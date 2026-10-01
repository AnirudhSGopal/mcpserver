import crypto from 'node:crypto';
import { ServerConfig } from '../schema.js';

export interface SpecObject {
  sha256: string;
  filename: string;
  content: string;
  uploadedAt: string;
}

export interface JobRecord {
  id: string;
  type: 'parse_spec' | 'design_tools' | 'run_evals';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  spec_sha256?: string;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedVersion {
  id: string;
  tenantId: string;
  serverSlug: string;
  versionNumber: number;
  contentHash: string;
  config: ServerConfig;
  publishedAt: string;
  isImmutable: true;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  action: 'publish' | 'rollback' | 'secret_change' | 'credential_create' | 'credential_revoke';
  target: string;
  details: Record<string, any>;
  timestamp: string;
}

export class VersionAndStorageManager {
  // F12: Object storage for uploaded specs
  private specStorage = new Map<string, SpecObject>();
  // F12: Jobs table
  private jobsTable = new Map<string, JobRecord>();
  // Published versions (immutable)
  private publishedVersions = new Map<string, PublishedVersion>();
  // Active version pointers: slug -> versionId
  private activeVersionPointers = new Map<string, string>();
  // Audit logs
  private auditLogs: AuditLogEntry[] = [];

  // 1. Upload spec
  uploadSpec(filename: string, content: string): SpecObject {
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const obj: SpecObject = {
      sha256,
      filename,
      content,
      uploadedAt: new Date().toISOString()
    };
    this.specStorage.set(sha256, obj);
    return obj;
  }

  getSpec(sha256: string): SpecObject | undefined {
    return this.specStorage.get(sha256);
  }

  // 2. Job tracking (F12)
  createJob(type: JobRecord['type'], spec_sha256?: string): JobRecord {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      type,
      status: 'pending',
      spec_sha256,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.jobsTable.set(job.id, job);
    return job;
  }

  completeJob(jobId: string, result: any): void {
    const job = this.jobsTable.get(jobId);
    if (job) {
      job.status = 'completed';
      job.result = result;
      job.updatedAt = new Date().toISOString();
    }
  }

  // 3. Publish version (Immutable + content hash)
  publishVersion(tenantId: string, serverSlug: string, config: ServerConfig): PublishedVersion {
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const versionId = `${tenantId}:${serverSlug}:v${Date.now()}`;

    // Read previous versions to determine version number
    const existing = Array.from(this.publishedVersions.values()).filter(
      (v) => v.tenantId === tenantId && v.serverSlug === serverSlug
    );
    const nextVer = existing.length + 1;

    const published: PublishedVersion = Object.freeze({
      id: versionId,
      tenantId,
      serverSlug,
      versionNumber: nextVer,
      contentHash,
      config: JSON.parse(JSON.stringify(config)), // deep snapshot
      publishedAt: new Date().toISOString(),
      isImmutable: true
    });

    this.publishedVersions.set(versionId, published);
    // Repoint active version
    this.activeVersionPointers.set(serverSlug, versionId);

    // Write audit log
    this.addAuditLog(tenantId, 'publish', serverSlug, {
      versionNumber: nextVer,
      contentHash,
      versionId
    });

    return published;
  }

  // 4. Rollback
  rollback(tenantId: string, serverSlug: string, targetVersionNumber: number): PublishedVersion {
    const target = Array.from(this.publishedVersions.values()).find(
      (v) => v.tenantId === tenantId && v.serverSlug === serverSlug && v.versionNumber === targetVersionNumber
    );

    if (!target) {
      throw new Error(`Target version ${targetVersionNumber} not found for server ${serverSlug}`);
    }

    // Repoint active version pointer immediately
    this.activeVersionPointers.set(serverSlug, target.id);

    this.addAuditLog(tenantId, 'rollback', serverSlug, {
      rolledBackToVersionNumber: targetVersionNumber,
      versionId: target.id
    });

    return target;
  }

  getActiveVersion(serverSlug: string): PublishedVersion | undefined {
    const versionId = this.activeVersionPointers.get(serverSlug);
    if (!versionId) return undefined;
    return this.publishedVersions.get(versionId);
  }

  addAuditLog(
    tenantId: string,
    action: AuditLogEntry['action'],
    target: string,
    details: Record<string, any>
  ): void {
    this.auditLogs.push({
      id: crypto.randomUUID(),
      tenantId,
      action,
      target,
      details,
      timestamp: new Date().toISOString()
    });
  }

  getAuditLogs(tenantId?: string): AuditLogEntry[] {
    if (!tenantId) return [...this.auditLogs];
    return this.auditLogs.filter((l) => l.tenantId === tenantId);
  }
}
