import { test, expect, waitForApp } from './fixtures';
import { expectToast, latestInviteLink, signInStaffFirstTime, signInWithCode, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const stamp = Date.now().toString(36);
const builder = `builder.${stamp}@buildco.test`;

test('a space-only exhibitor nominates their contractor', async ({ page }) => {
  const errors = watchForErrors(page);
  await signInWithCode(page, 'ella@evergreen.test');
  await page.waitForURL(/\/portal\//);
  await waitForApp(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Stand approval' }).click();
  await expect(page.getByRole('heading', { name: 'Space-only stand approval' })).toBeVisible();
  await page.getByRole('button', { name: 'Nominate your contractor' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Contractor company').fill('Build Co');
  await dialog.getByLabel('Contact name').fill('Bob Builder');
  await dialog.getByLabel('Contact email').fill(builder);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Contractor saved and invited to BluePrint.');
  await expect(page.getByText('Build Co')).toBeVisible();
  await expect(page.getByText('Invited', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the contractor joins, prepares the pack and sends it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  const link = await latestInviteLink(page, builder);
  await page.goto(link);
  await page.getByLabel('Your name').fill('Bob Builder');
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await page.waitForURL(/\/contractor/);
  await waitForApp(page);
  await page.getByRole('link', { name: 'N3-501' }).click();
  await expect(page.getByRole('heading', { name: /Stand N3-501/ })).toBeVisible();
  await page.getByLabel('Highest point of the stand (metres)').fill('3.5');
  await page.getByLabel('Platform height (millimetres)').fill('0');
  await page.getByLabel('Contractor’s public liability cover (£)').fill('10000000');
  await page.getByLabel('Insurance expires on').click();
  await page.getByLabel('Insurance expires on').fill('31 December 2027');
  await page.keyboard.press('Escape');
  for (const doc of ['drawings', 'risk_assessment', 'method_statement', 'construction_phase_plan', 'contractor_insurance', 'hs_declaration']) {
    const block = page.getByTestId(`doc-${doc}`);
    await block.locator('input[type=file]').setInputFiles({ name: `${doc}.pdf`, mimeType: 'application/pdf', buffer: PDF });
    await expect(block.getByRole('link', { name: `${doc}.pdf` })).toBeVisible();
  }
  await expect(page.getByText('Everything required is here.')).toBeVisible();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expectToast(page, 'Sent for review.');
  await expect(page.getByText('Sent, waiting for review').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the health and safety reviewer approves it and the certificate is issued', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInStaffFirstTime(page, 'hs@blueprint.test');
  await page.waitForURL(/\/manage\/.+\/space-only/);
  await waitForApp(page);
  await expect(page.getByRole('heading', { name: 'Space-only approvals' })).toBeVisible();
  // A reviewer only sees the space-only area.
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Exhibitors' })).toHaveCount(0);
  await page.getByRole('link', { name: 'N3-501' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1' })).toBeVisible();
  await page.getByText('Approve with conditions').click();
  await page.getByRole('textbox', { name: 'Conditions' }).fill('Rigging must follow the approved rigging plan.');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expectToast(page, 'Decision saved.');
  await expect(page.getByRole('link', { name: 'Permission to build (PDF)' })).toBeVisible();

  const ctx = await browser.newContext();
  const ex = await ctx.newPage();
  await signInWithCode(ex, 'ella@evergreen.test');
  await ex.waitForURL(/\/portal\//);
  await ex.goto('/portal/ukcw-london-2027/space-only');
  await expect(ex.getByText('Approved with conditions').first()).toBeVisible();
  await expect(ex.getByText('Rigging must follow the approved rigging plan.').first()).toBeVisible();
  const href = await ex.getByRole('link', { name: 'Download permission to build' }).getAttribute('href');
  const pdf = await ex.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // Another exhibitor cannot download it.
  const ctx2 = await browser.newContext();
  const other = await ctx2.newPage();
  await signInWithCode(other, 'finn@fortissteel.test');
  await other.waitForURL(/\/portal\//);
  expect((await other.request.get(href!)).status()).toBe(404);
  await ctx.close();
  await ctx2.close();
});
