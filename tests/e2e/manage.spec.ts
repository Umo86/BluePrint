import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectToast, staffSession, signInWithCode, totp, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function openUkcwDashboard(page: Page) {
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return page.url().replace(/\/$/, '');
}

let dashboard = '';

test('show team dashboard: exhibitors, stands, import and settings', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchForErrors(page);
  const stamp = Date.now().toString(36);
  await staffSession(page);
  dashboard = await openUkcwDashboard(page);

  await test.step('overview shows the seeded exhibitors', async () => {
    await expect(page.getByText('Getting the show ready')).toBeVisible();
    await expect(page.locator('.mantine-Paper-root', { hasText: 'Exhibitors' }).getByText('6', { exact: true }).first()).toBeVisible();
  });

  await test.step('exhibitors list, search and filters', async () => {
    await page.getByRole('link', { name: 'Exhibitors', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Exhibitors' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acme Insulation Ltd' })).toBeVisible();
    await page.getByLabel('Search exhibitors').fill('fortis');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=fortis/);
    await expect(page.getByRole('link', { name: 'Fortis Steel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acme Insulation Ltd' })).toHaveCount(0);
    await page.goto(`${dashboard}/exhibitors`);
  });

  await test.step('add an exhibitor with a stand and an invitation', async () => {
    await page.getByRole('button', { name: 'Add exhibitor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Company name').fill(`E2E Glazing ${stamp}`);
    await dialog.getByLabel('Stand number').fill(`N2-${stamp.slice(-3)}`);
    await dialog.getByLabel('Contact email').fill(`glazing.${stamp}@example.test`);
    await dialog.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(page.getByRole('heading', { name: `E2E Glazing ${stamp}` })).toBeVisible();
    await expect(page.getByRole('cell', { name: `glazing.${stamp}@example.test`, exact: true })).toBeVisible();
  });

  await test.step('notes, stand edits and colleague invitations', async () => {
    await page.getByLabel('New note').fill('Wants an extra power socket.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expectToast(page, 'Note added.');
    await expect(page.getByText('Wants an extra power socket.')).toBeVisible();
    await page.getByRole('button', { name: /Change stand/ }).click();
    await page.getByRole('menuitem', { name: 'Edit stand' }).click();
    await page.getByRole('dialog').getByLabel('Width (m)').fill('6');
    await page.getByRole('dialog').getByLabel('Depth (m)').fill('3');
    await expect(page.getByRole('dialog').getByLabel('Area (sqm)')).toHaveValue('18');
    await page.getByRole('dialog').getByRole('button', { name: 'Save stand' }).click();
    await expectToast(page, 'Stand saved.');
    await expect(page.getByRole('cell', { name: '6 m × 3 m (18 sqm)' })).toBeVisible();
    await page.getByLabel('Email address').fill(`colleague.${stamp}@example.test`);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expectToast(page, 'Invitation sent.');
    await expect(page.getByRole('cell', { name: `colleague.${stamp}@example.test`, exact: true })).toBeVisible();
  });

  await test.step('stands page: add, cancel and delete a stand', async () => {
    await page.goto(`${dashboard}/stands`);
    await page.getByRole('button', { name: 'Add stand' }).click();
    await page.getByRole('dialog').getByLabel('Stand number').fill(`X-${stamp}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add stand' }).click();
    await expectToast(page, 'Stand added.');
    const row = page.getByRole('row', { name: new RegExp(`X-${stamp}`) });
    await expect(row.getByText('Not assigned')).toBeVisible();
    await row.getByRole('button', { name: /Change stand/ }).click();
    await page.getByRole('menuitem', { name: 'Cancel stand' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel stand' }).click();
    await expectToast(page, 'Stand cancelled.');
    await expect(page.getByRole('row', { name: new RegExp(`X-${stamp}`) })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Cancelled stands' }).click();
    const cancelled = page.getByRole('row', { name: new RegExp(`X-${stamp}`) });
    await cancelled.getByRole('button', { name: /Change stand/ }).click();
    await page.getByRole('menuitem', { name: 'Delete stand' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expectToast(page, 'Stand deleted.');
  });

  await test.step('import a spreadsheet', async () => {
    await page.goto(`${dashboard}/exhibitors/import`);
    const csv = [
      'Company,Stand,Type,Hall,Size (sqm),Contact email',
      `Imported Bricks ${stamp},IMP-${stamp},Shell scheme,N4,9,bricks.${stamp}@example.test`,
      `Imported Frames ${stamp},IMP2-${stamp},space only,N4,50,`,
      `Broken Row ${stamp},,Shell scheme,N4,9,`,
    ].join('\n');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Spreadsheet' }).click()]);
    await chooser.setFiles({ name: 'exhibitors.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByRole('button', { name: 'Spreadsheet' })).toContainText('exhibitors.csv');
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(page.getByText('2 new stands')).toBeVisible();
    await expect(page.getByText('1 with problems')).toBeVisible();
    await expect(page.getByText('Stand number is missing.')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await expect(page).toHaveURL(/\/exhibitors$/);
    await expectToast(page, /Imported 2 new/);
    await expect(page.getByRole('link', { name: `Imported Bricks ${stamp}` })).toBeVisible();
  });

  await test.step('settings: branding with a logo upload', async () => {
    await page.goto(`${dashboard}/settings?tab=branding`);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Current logo' })).toBeVisible();
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expectToast(page, 'Branding saved.');
    await page.reload();
    const src = await page.getByRole('img', { name: 'Current logo' }).getAttribute('src');
    expect(src).toMatch(/^\/files\/[0-9a-f-]{36}$/);
    // Branding images are public so they show in emails.
    const anon = await page.context().browser()!.newContext();
    const res = await anon.request.get(new URL(src!, page.url()).toString());
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    await anon.close();
  });

  await test.step('settings: stand types, halls, email and space-only rules', async () => {
    await page.getByRole('tab', { name: 'Stand types' }).click();
    await page.getByRole('button', { name: 'Add a type' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Pavilion');
    await page.getByRole('dialog').getByRole('button', { name: 'Save type' }).click();
    await expectToast(page, 'Stand type added.');
    await page.getByRole('button', { name: 'Delete Pavilion' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expectToast(page, 'Stand type deleted.');

    await page.getByRole('tab', { name: 'Halls' }).click();
    await page.getByLabel('New hall').fill(`H-${stamp}`);
    await page.getByRole('button', { name: 'Add hall' }).click();
    await expectToast(page, 'Hall added.');
    await page.getByRole('button', { name: `Delete H-${stamp}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expectToast(page, 'Hall deleted.');

    await page.getByRole('tab', { name: 'Email sender' }).click();
    await page.getByLabel('Sender name').fill('UKCW Exhibitor Team');
    await page.getByRole('button', { name: 'Save email settings' }).click();
    await expectToast(page, 'Email settings saved.');

    await page.getByRole('tab', { name: 'Space-only rules' }).click();
    await page.getByLabel('Height limit (m)').fill('5');
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expectToast(page, 'Space-only rules saved.');
  });

  await test.step('team page lists the show team', async () => {
    await page.goto(`${dashboard}/team`);
    await expect(page.getByText('ops@blueprint.test')).toBeVisible();
    await expect(page.getByText('hs@blueprint.test')).toBeVisible();
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('team members only see what their permissions allow', async ({ page, browser }) => {
  test.setTimeout(180_000);
  expect(dashboard).not.toBe('');
  // A show team member with exhibitor and order rights signs in for the first time and sets up two-factor.
  await signInWithCode(page, 'sales@blueprint.test');
  await expect(page).toHaveURL(/two-factor-setup/);
  const keyText = await page.getByText(/^Key:/).innerText();
  const secret = keyText.replace('Key:', '').replace(/\s/g, '');
  await page.getByLabel('Six-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
  await page.getByRole('button', { name: 'I have saved my codes' }).click();

  await page.goto(dashboard);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  expect((await page.goto(`${dashboard}/team`))?.status()).toBe(404);
  await page.goto(`${dashboard}/settings`);
  await expect(page.getByRole('tab', { name: 'Halls' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Branding' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Details' })).toHaveCount(0);

  // Exhibitors and strangers get "not found" for the whole dashboard.
  const other = await browser.newContext();
  const ex = await other.newPage();
  await signInWithCode(ex, 'ben@brightbuild.test');
  // Exhibitors go straight to their show's portal after signing in.
  await ex.waitForURL(/\/portal\//);
  expect((await ex.goto(dashboard))?.status()).toBe(404);
  expect((await ex.goto(`${dashboard}/exhibitors`))?.status()).toBe(404);
  expect((await ex.request.get(`${dashboard}/exhibitors/import/template`)).status()).toBe(404);
  await other.close();
});
