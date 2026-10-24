import { describe, expect, it } from 'vitest';
import { r2Origin } from '@/lib/storage-origin';

const ACCOUNT = '0123456789abcdef0123456789ABCDEF';

describe('R2 address', () => {
  it('uses the standard address, or the jurisdiction address for EU buckets', () => {
    expect(r2Origin(ACCOUNT)).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
    expect(r2Origin(ACCOUNT, 'eu')).toBe('https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com');
    expect(r2Origin(ACCOUNT, ' EU ')).toBe('https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com');
    expect(r2Origin(ACCOUNT, '')).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
  });

  it('refuses anything that is not a real account id or jurisdiction', () => {
    expect(r2Origin(undefined)).toBeNull();
    expect(r2Origin('abc')).toBeNull();
    expect(r2Origin(`${ACCOUNT}; script-src *`)).toBeNull();
    expect(r2Origin(ACCOUNT, 'evil.example')).toBeNull();
    expect(r2Origin(ACCOUNT, 'us')).toBeNull();
  });
});
