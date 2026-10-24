import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Same algorithm as an authenticator app. `offset` lets a test use the next 30-second step. */
export function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** Reads the newest code emailed to `email` from the local development mailbox. */
export async function latestCode(page: Page, email: string): Promise<string> {
  const mailbox = await page.context().newPage();
  await mailbox.goto('/dev/mailbox');
  const row = mailbox.locator('tr', { hasText: email }).first();
  await expect(row).toBeVisible();
  const subject = await row.getByTestId('mail-subject').innerText();
  await mailbox.close();
  const m = subject.match(/(\d{6})/);
  if (!m) throw new Error(`No code in ${subject}`);
  return m[1];
}

export async function signInWithCode(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('a code is on its way')).toBeVisible();
  const code = await latestCode(page, email);
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('Six-digit code').nth(0).locator('xpath=..').locator('input').nth(i).fill(code[i]);
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The demo super admin's authenticator key (set with SEED_TOTP_SECRET when seeding). */
export const DEMO_TOTP_SECRET = process.env.E2E_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * Signs a staff member in with an emailed code and then their authenticator code.
 * Codes can only be used once, so if this 30-second window's code was already used it waits for the next.
 */
export async function signInStaff(page: Page, email: string, secret = DEMO_TOTP_SECRET) {
  await signInWithCode(page, email);
  await expect(page).toHaveURL(/two-factor/);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('Code from your authenticator app').fill(totp(secret));
    await page.getByRole('button', { name: 'Continue' }).click();
    try {
      await expect(page).not.toHaveURL(/two-factor/, { timeout: 5000 });
      return;
    } catch {
      const wait = 30_000 - (Date.now() % 30_000) + 500;
      await page.waitForTimeout(wait);
    }
  }
  await expect(page).not.toHaveURL(/two-factor/);
}

/** Collects browser errors (failed hydration, uncaught exceptions) so a test can assert there were none. */
export function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // The browser logs 404s for deliberately missing pages; those are checked separately.
    if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

/** Waits for a Mantine notification containing `text`. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('.mantine-Notification-root', { hasText: text }).first()).toBeVisible();
}
