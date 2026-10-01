import crypto from 'node:crypto';
import { UpstreamAuth } from './schema.js';

export interface SecretBinding {
  secretRef: string;
  sourceId: string;
  allowedHosts: string[];
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class Vault {
  private masterKey: Buffer;
  private secrets = new Map<string, SecretBinding>();

  constructor(masterKeyHex?: string) {
    if (masterKeyHex) {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      this.masterKey = crypto.randomBytes(32);
    }
  }

  storeSecret(secretRef: string, plaintext: string, sourceId: string, allowedHosts: string[]): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    this.secrets.set(secretRef, {
      secretRef,
      sourceId,
      allowedHosts: allowedHosts.map(h => h.toLowerCase()),
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag
    });
  }

  getSecret(secretRef: string, targetHost: string): string {
    const entry = this.secrets.get(secretRef);
    if (!entry) {
      throw new Error(`Secret reference not found in vault: ${secretRef}`);
    }

    // F6 HIGH: Bind each secret to its source's allowed_hosts
    const normalizedTarget = targetHost.toLowerCase();
    const hostAllowed = entry.allowedHosts.some(
      (h) => normalizedTarget === h || normalizedTarget.endsWith(`.${h}`)
    );

    if (!hostAllowed) {
      throw new Error(`Security violation: Secret ${secretRef} cannot be transmitted to untrusted host "${targetHost}"`);
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
    let decrypted = decipher.update(entry.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // F8: Inject upstream auth
  applyUpstreamAuth(
    auth: UpstreamAuth,
    targetUrl: URL,
    headers: Record<string, string>,
    targetHost: string
  ): void {
    switch (auth.type) {
      case 'bearer': {
        const token = this.getSecret(auth.secret_ref, targetHost);
        headers['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'api_key_header': {
        const key = this.getSecret(auth.secret_ref, targetHost);
        headers[auth.header_name] = key;
        break;
      }
      case 'api_key_query': {
        const key = this.getSecret(auth.secret_ref, targetHost);
        targetUrl.searchParams.set(auth.query_param, key);
        break;
      }
      case 'basic': {
        const password = this.getSecret(auth.password_secret_ref, targetHost);
        const encoded = Buffer.from(`${auth.username}:${password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;
      }
      case 'oauth2_client_credentials': {
        const secret = this.getSecret(auth.client_secret_ref, targetHost);
        // Emitted as client auth token header
        headers['Authorization'] = `Bearer ${secret}`;
        break;
      }
    }
  }
}

export const defaultVault = new Vault();
