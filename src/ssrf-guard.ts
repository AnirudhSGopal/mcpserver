import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfSecurityError';
  }
}

// Convert various IP representations (decimal, octal, hex) to canonical IPv4
export function parseAndNormalizeIp(ipStr: string): string | null {
  // Check if standard IPv4
  if (net.isIPv4(ipStr)) {
    return ipStr;
  }
  // Check if IPv6
  if (net.isIPv6(ipStr)) {
    return ipStr;
  }

  // Handle single integer / decimal IP (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(ipStr)) {
    const num = parseInt(ipStr, 10);
    if (num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
      ].join('.');
    }
  }

  // Handle hex format (e.g. 0x7f000001)
  if (/^0x[0-9a-fA-F]+$/.test(ipStr)) {
    const num = parseInt(ipStr, 16);
    if (num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
      ].join('.');
    }
  }

  // Handle octal parts (e.g. 0177.0.0.1)
  const parts = ipStr.split('.');
  if (parts.length === 4) {
    const canonicalParts: number[] = [];
    for (const part of parts) {
      let val: number;
      if (part.startsWith('0x') || part.startsWith('0X')) {
        val = parseInt(part, 16);
      } else if (part.startsWith('0') && part.length > 1) {
        val = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        val = parseInt(part, 10);
      } else {
        return null;
      }
      if (isNaN(val) || val < 0 || val > 255) return null;
      canonicalParts.push(val);
    }
    return canonicalParts.join('.');
  }

  return null;
}

export function isBlockedIp(rawIp: string): boolean {
  const ip = parseAndNormalizeIp(rawIp) || rawIp;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [b0, b1] = parts;

    // 0.0.0.0/8 (current network)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (private)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (private: 172.16.x.x - 172.31.x.x)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (private)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (link-local and cloud metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.replace('::ffff:', '');
      return isBlockedIp(v4Part);
    }
    // Unique local (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return false;
}

export interface ValidateUrlOptions {
  allowedHosts?: string[];
  allowLoopback?: boolean;
  lookupFn?: (hostname: string) => Promise<Array<{ address: string }>>;
  verifyRebinding?: boolean;
}

export async function validateUrlForSsrf(urlStr: string, options?: ValidateUrlOptions): Promise<{ hostname: string; resolvedIp: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new SsrfSecurityError(`Malformed URL: ${urlStr}`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new SsrfSecurityError(`Blocked unsupported protocol: ${parsedUrl.protocol}`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 1. Localhost check
  if (!options?.allowLoopback && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
    throw new SsrfSecurityError(`Access to localhost is blocked: ${hostname}`);
  }

  const isLoopbackIp = (ipStr: string) => {
    return ipStr === '127.0.0.1' || ipStr.startsWith('127.') || ipStr === '::1';
  };

  // 2. Check direct IP address in hostname
  if (isBlockedIp(hostname)) {
    if (!options?.allowLoopback || !isLoopbackIp(hostname)) {
      throw new SsrfSecurityError(`Access to blocked IP/range is forbidden: ${hostname}`);
    }
  }

  // 3. Allowed hosts check
  if (options?.allowedHosts && options.allowedHosts.length > 0) {
    const isAllowed = options.allowedHosts.some((h) => {
      const lowerH = h.toLowerCase();
      return hostname === lowerH || hostname.endsWith(`.${lowerH}`);
    });
    if (!isAllowed) {
      throw new SsrfSecurityError(`Hostname "${hostname}" is not in source allowed_hosts: [${options.allowedHosts.join(', ')}]`);
    }
  }

  // 4. DNS resolution to prevent rebinding to internal IP
  let resolvedIps: string[] = [];
  try {
    if (options?.lookupFn) {
      const res = await options.lookupFn(hostname);
      resolvedIps = res.map((l) => l.address);
    } else {
      const lookups = await dns.lookup(hostname, { all: true });
      resolvedIps = lookups.map((l) => l.address);
    }
  } catch (err: any) {
    throw new SsrfSecurityError(`DNS resolution failed for host "${hostname}": ${err.message}`);
  }

  if (resolvedIps.length === 0) {
    throw new SsrfSecurityError(`No DNS records found for host: ${hostname}`);
  }

  for (const resolvedIp of resolvedIps) {
    if (isBlockedIp(resolvedIp)) {
      if (!options?.allowLoopback || !isLoopbackIp(resolvedIp)) {
        throw new SsrfSecurityError(`Host "${hostname}" resolved to blocked private/internal IP: ${resolvedIp}`);
      }
    }
  }

  // 5. Consecutive resolution check to detect active DNS rebinding attack
  if (options?.verifyRebinding) {
    const secondLookups = options.lookupFn ? await options.lookupFn(hostname) : await dns.lookup(hostname, { all: true });
    for (const item of secondLookups) {
      if (isBlockedIp(item.address)) {
        throw new SsrfSecurityError(`DNS rebinding attack detected! Host "${hostname}" re-resolved to blocked internal IP: ${item.address}`);
      }
    }
  }

  return { hostname, resolvedIp: resolvedIps[0] };
}
