import { describe, it, expect } from 'vitest';
import { validateUrlForSsrf, isBlockedIp, parseAndNormalizeIp } from '../src/ssrf-guard.js';

describe('SSRF Guard Suite', () => {
  it('blocks 169.254.169.254 and link-local ranges', async () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    await expect(validateUrlForSsrf('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/forbidden|blocked/i);
  });

  it('blocks localhost and loopback IPv4', async () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.0.1.10')).toBe(true);
    await expect(validateUrlForSsrf('http://localhost:8080')).rejects.toThrow(/localhost/i);
    await expect(validateUrlForSsrf('http://127.0.0.1/api')).rejects.toThrow(/forbidden|blocked/i);
  });

  it('blocks IPv6 loopback ::1 and IPv4-mapped IPv6', async () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    await expect(validateUrlForSsrf('http://[::1]:3000')).rejects.toThrow(/forbidden|blocked/i);
  });

  it('normalizes and blocks decimal IP notation (e.g. 2130706433 for 127.0.0.1)', () => {
    expect(parseAndNormalizeIp('2130706433')).toBe('127.0.0.1');
    expect(isBlockedIp('2130706433')).toBe(true);
  });

  it('normalizes and blocks hex IP notation (e.g. 0x7f000001 for 127.0.0.1)', () => {
    expect(parseAndNormalizeIp('0x7f000001')).toBe('127.0.0.1');
    expect(isBlockedIp('0x7f000001')).toBe(true);
  });

  it('normalizes and blocks octal IP notation (e.g. 0177.0.0.1)', () => {
    expect(parseAndNormalizeIp('0177.0.0.1')).toBe('127.0.0.1');
    expect(isBlockedIp('0177.0.0.1')).toBe(true);
  });

  it('blocks private 10.x, 172.16-31.x, 192.168.x networks', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.0.5')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });

  it('enforces allowed_hosts when provided', async () => {
    await expect(
      validateUrlForSsrf('https://untrusted-domain.com/data', { allowedHosts: ['api.mycompany.com'] })
    ).rejects.toThrow(/not in source allowed_hosts/i);
  });

  it('detects and blocks DNS rebinding attack (returns public IP first, then 127.0.0.1)', async () => {
    let callCount = 0;
    const alternatingResolver = async (hostname: string) => {
      callCount++;
      if (callCount === 1) {
        // First lookup: benign public IP
        return [{ address: '93.184.216.34' }];
      } else {
        // Rebound lookup: loopback internal IP
        return [{ address: '127.0.0.1' }];
      }
    };

    await expect(
      validateUrlForSsrf('https://rebind-test.com/endpoint', {
        lookupFn: alternatingResolver,
        verifyRebinding: true
      })
    ).rejects.toThrow(/DNS rebinding attack detected/i);
  });

  it('asserts connection is pinned to the initial resolved IP when resolver changes after validation', async () => {
    let resolutionCount = 0;
    const initialIp = '93.184.216.34';
    const changedIp = '127.0.0.1';

    const mutatingResolver = async () => {
      resolutionCount++;
      return [{ address: resolutionCount === 1 ? initialIp : changedIp }];
    };

    // First validation resolves to initialIp
    const { resolvedIp } = await validateUrlForSsrf('https://pinned-test.com/api', {
      lookupFn: mutatingResolver
    });
    expect(resolvedIp).toBe(initialIp);

    // On second check, if rebinding verification is requested, it is actively refused
    await expect(
      validateUrlForSsrf('https://pinned-test.com/api', {
        lookupFn: mutatingResolver,
        verifyRebinding: true
      })
    ).rejects.toThrow(/DNS rebinding attack detected|blocked/i);
  });
});
