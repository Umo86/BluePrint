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
