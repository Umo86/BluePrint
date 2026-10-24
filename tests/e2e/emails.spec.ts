import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectToast, staffSession, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

async function openEmails(page: Page) {
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Emails' }).click();
  await expect(page.getByRole('heading', { name: 'Emails', exact: true })).toBeVisible();
}

/** The newest email to `to` whose subject contains `subject`, from the development mailbox. */
async function latestEmailHtml(page: Page, to: string, subject: string) {
  const mailbox = await page.context().newPage();
  await mailbox.goto('/dev/mailbox');
  const row = mailbox.locator('tr', { hasText: to }).filter({ hasText: subject }).first();
  await expect(row).toBeVisible();
  const href = await row.getByTestId('mail-subject').getAttribute('href');
  const html = await (await mailbox.request.get(href!)).text();
  await mailbox.close();
  return html;
}

test('the team rewords the invitation email and previews it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await openEmails(page);
  await page.getByRole('link', { name: 'Invitation to the exhibitor portal' }).click();
  const preview = page.frameLocator('iframe[title="Email preview"]');
  await expect(preview.getByText('Welcome to UKCW London 2027')).toBeVisible();

  await page.getByLabel('Subject').fill('Your {{show}} portal is ready');
  await page.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(page.getByText('Subject: Your UKCW London 2027 portal is ready')).toBeVisible();
  await page.getByRole('radiogroup').getByText('HTML', { exact: true }).click();
  await expect(page.locator('pre').first()).toContainText('<!doctype html>');

  // The invitation link cannot be removed.
  await page.getByRole('button', { name: 'Remove block 3' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, /must include \{\{invite_link\}\}/);
  await page.reload();
  await page.getByLabel('Subject').fill('Your {{show}} portal is ready');
  await page.getByRole('button', { name: 'Send me a test' }).click();
  await expectToast(page, 'Test sent to your inbox.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Email saved. It is used from now on.');
  await page.getByRole('link', { name: '← Emails' }).click();
  await expect(page.getByRole('row', { name: /Invitation to the exhibitor portal/ })).toContainText('Your own');
  const testMail = await latestEmailHtml(page, 'admin@blueprint.test', '[Test] Your UKCW London 2027 portal is ready');
  expect(testMail).toContain('Open your exhibitor portal');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the team sends an update to space-only exhibitors, who can unsubscribe', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await openEmails(page);
  await page.getByRole('tab', { name: 'Updates to exhibitors' }).click();
  await page.getByRole('link', { name: 'New email to exhibitors' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rigging reminder');
  await page.getByLabel('Subject').fill('Rigging plans for {{company}}');
  await page.getByLabel('Paragraph 2').fill('Rigging plans for stand {{stand}} are due next week.');
  await page.getByRole('combobox', { name: 'Stand types' }).click();
  await page.getByRole('option', { name: 'Space only' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^2 people at 2 stands/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expectToast(page, 'Saved as a draft.');
  await page.waitForURL(/\/emails\/campaigns\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Send me a test' }).click();
  await expectToast(page, 'Test sent to your inbox.');
  await page.getByRole('button', { name: 'Send…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click();
  await page.waitForURL(/tab=campaigns&sent=1/);
  await expect(page.getByText('Sending now.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Rigging reminder/ })).toContainText('Sent');

  const html = await latestEmailHtml(page, 'ella@evergreen.test', 'Rigging plans for Evergreen Timber Frames');
  expect(html).toContain('Rigging plans for stand N3-501');
  const link = html.match(/href="https?:\/\/[^"]*(\/unsubscribe\/[^"]+)"/);
  expect(link).toBeTruthy();

  // The exhibitor unsubscribes without signing in.
  await page.context().clearCookies();
  await page.goto(link![1]);
  await expect(page.getByText('Stop emailing ella@evergreen.test')).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByText('Done. You will not get show updates by email any more.')).toBeVisible();
  const forged = await page.request.post(`/api/unsubscribe/${link![1].split('/unsubscribe/')[1]}x`);
  expect(forged.status()).toBe(404);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the super admin runs the reminder job and exhibitors are reminded', async ({ page }) => {
  test.setTimeout(120_000);
  await staffSession(page);
  await page.goto('/admin/system');
  await page.getByRole('button', { name: 'Run reminders' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send reminders' }).click();
  await expectToast(page, 'Done.');
  const html = await latestEmailHtml(page, 'ben@brightbuild.test', 'to do for stand N1-214');
  expect(html).toContain('Read the build-up and breakdown rules');
  // Scheduled jobs refuse callers without the secret.
  const res = await page.request.get('/api/cron/reminders');
  expect(res.status()).toBe(404);
});
