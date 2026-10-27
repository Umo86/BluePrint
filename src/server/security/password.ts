import 'server-only';
import { hash, verify } from '@node-rs/argon2';

/**
 * Passwords are optional (exhibitors normally sign in with emailed codes).
 * When set they are hashed with argon2id using OWASP's recommended minimum cost.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'administrator',
  'passwordpassword',
  'changeme1234',
  'blueprint123',
  'blueprint1234',
]);

export function passwordProblems(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose something less predictable.';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character.';
  if (email) {
    const local = email.split('@')[0]?.toLowerCase();
    if (lower === email.toLowerCase()) return 'Your password should not be your email address.';
    if (local && local.length >= 4 && lower.includes(local)) {
      return `Your password should not contain “${local}”, the first part of your email address.`;
    }
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
