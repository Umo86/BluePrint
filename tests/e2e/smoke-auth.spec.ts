import { test, expect } from '@playwright/test';
import { latestCode, totp } from './helpers';

const token = process.env.E2E_SUPER_INVITE_TOKEN!;

test('a super admin accepts the bootstrap invitation and sets up two-factor', async ({ page }) => {
  test.skip(!token, 'needs E2E_SUPER_INVITE_TOKEN');
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: /super admin/i })).toBeVisible();
  await page.getByLabel('Your name').fill('First Admin');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await latestCode(page, 'first.admin@example.com');
  await page.getByLabel('Code from the email').fill(code);
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page).toHaveURL(/two-factor-setup/);
  const keyText = await page.getByText(/^Key:/).innerText();
  const secret = keyText.replace('Key:', '').replace(/\s/g, '');
  await page.getByLabel('Six-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
  await expect(page.getByText('Two-factor sign-in is on.')).toBeVisible();
  await page.getByRole('button', { name: 'I have saved my codes' }).click();
  await expect(page).toHaveURL(/\/admin/);
});
