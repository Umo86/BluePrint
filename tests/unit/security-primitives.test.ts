import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, verifyTotp, totpCode, generateRecoveryCodes } from '@/server/security/totp';
import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256Hex } from '@/server/security/crypto';
import { hashPassword, passwordProblems, verifyPassword } from '@/server/security/password';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238 test vectors, 6 digits)', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [seconds, expected] of vectors) {
    it(`matches the vector at T=${seconds}`, () => {
      expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(expected);
    });
  }

  it('round-trips base32', () => {
    const buf = Buffer.from('hello world, this is a secret');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts the current code once and rejects a replay', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    const code = hotp(base32Decode(RFC_SECRET), step);
    const used = verifyTotp(RFC_SECRET, code, null, now);
    expect(used).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, used, now)).toBeNull();
  });

  it('rejects codes from far outside the window and malformed input', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(RFC_SECRET, hotp(base32Decode(RFC_SECRET), step - 5), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
  });

  it('makes ten distinct recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });
});

describe('secret encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const enc = encryptSecret('secret-value');
    const parts = enc.split('.');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

describe('tokens and hashing', () => {
  it('makes long unpredictable tokens', () => {
    const t = randomToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(randomToken()).not.toBe(t);
  });
  it('compares safely', () => {
    expect(safeEqual(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(safeEqual(sha256Hex('a'), sha256Hex('b'))).toBe(false);
  });
});

describe('passwords', () => {
  it('enforces the policy', () => {
    expect(passwordProblems('short')).toMatch(/at least 12/);
    expect(passwordProblems('password1234')).toMatch(/too common/);
    expect(passwordProblems('jane.smith-is-great', 'jane.smith@example.com')).toMatch(/email/);
    expect(passwordProblems('correct horse battery staple')).toBeNull();
  });
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'wrong horse battery staple')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});
