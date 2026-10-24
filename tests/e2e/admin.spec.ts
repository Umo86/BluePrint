import { test, expect } from './fixtures';
import { expectToast, signInStaff, signInWithCode, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

test('super admin dashboard: every page works and changes are saved', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  const stamp = Date.now().toString(36);

  await test.step('sign in with email code and two-factor', async () => {
    await signInStaff(page, 'admin@blueprint.test');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('UKCW London 2027').first()).toBeVisible();
  });

  let editionUrl = '';
  await test.step('create a show and an edition', async () => {
    await page.goto('/admin/shows');
    await page.getByRole('button', { name: 'New show' }).click();
    await page.getByLabel('Show name').fill(`E2E Show ${stamp}`);
    await page.getByRole('button', { name: 'Create show' }).click();
    await expectToast(page, 'Show created.');
    const card = page.locator('.mantine-Paper-root', { hasText: `E2E Show ${stamp}` });
    await card.getByRole('button', { name: 'New edition' }).click();
    await page.getByLabel('Edition name').fill(`E2E Show ${stamp} 2028`);
    await page.getByLabel('Venue').fill('Olympia');
    await page.getByRole('button', { name: 'Create edition' }).click();
    await expect(page).toHaveURL(/\/admin\/editions\/[0-9a-f-]{36}$/);
    editionUrl = page.url();
    await expect(page.getByRole('heading', { name: `E2E Show ${stamp} 2028` })).toBeVisible();
  });

  await test.step('edit details, fees and the team', async () => {
    await page.getByLabel('City').fill('London');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expectToast(page, 'Edition saved.');

    await page.getByRole('tab', { name: 'Fees and commission' }).click();
    await page.getByLabel(/Use the platform setting/).uncheck();
    await page.getByText('Taken from the supplier’s share').click();
    await page.getByRole('button', { name: 'Save fees and commission' }).click();
    await expectToast(page, 'Commercial settings saved.');

    await page.getByRole('tab', { name: 'Team' }).click();
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await page.getByLabel('Email address').fill(`e2e.staff.${stamp}@blueprint.test`);
    await page.getByRole('checkbox', { name: /Emails/ }).check();
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expectToast(page, 'Invitation sent.');
    await expect(page.getByText(`e2e.staff.${stamp}@blueprint.test`)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expectToast(page, 'Invitation cancelled.');
    await expect(page.getByText(`e2e.staff.${stamp}@blueprint.test`)).toHaveCount(0);
  });

  await test.step('clone the edition, then delete the clone', async () => {
    await page.getByRole('tab', { name: 'Clone for next year' }).click();
    await page.getByLabel('New edition name').fill(`E2E Show ${stamp} 2029`);
    await page.getByRole('button', { name: 'Create the new edition' }).click();
    await expect(page.getByRole('heading', { name: `E2E Show ${stamp} 2029` })).toBeVisible();
    expect(page.url()).not.toBe(editionUrl);
    await page.getByRole('tab', { name: 'Delete' }).click();
    await page.getByLabel(/Type .* to confirm/).fill(`E2E Show ${stamp} 2029`);
    await page.getByRole('button', { name: 'Delete edition' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete edition' }).click();
    await expect(page).toHaveURL(/\/admin\/shows$/);
    await expect(page.getByText(`E2E Show ${stamp} 2029`)).toHaveCount(0);
  });

  await test.step('users: search, open, disable and enable', async () => {
    await page.goto('/admin/users');
    await page.getByRole('searchbox').or(page.getByPlaceholder('Search by name or email')).fill('amira');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=amira/);
    await page.getByRole('link', { name: 'Amira Khan' }).click();
    await expect(page.getByRole('heading', { name: 'Amira Khan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acme Insulation Ltd' })).toBeVisible();
    await expect(page.getByText('See the exhibitor portal as this person')).toBeVisible();
    await page.getByLabel('Account enabled').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expectToast(page, 'Account disabled and signed out everywhere.');
    await expect(page.getByLabel('Account enabled')).not.toBeChecked();
    await page.getByLabel('Account enabled').click();
    await expectToast(page, 'Account enabled.');
  });

  await test.step('companies: create, invoice and archive', async () => {
    await page.goto('/admin/companies');
    await page.getByRole('button', { name: 'New company' }).click();
    await page.getByLabel('Company name').fill(`E2E Widgets ${stamp}`);
    await page.getByLabel('Website', { exact: true }).fill('widgets.example');
    await page.getByRole('button', { name: 'Create company' }).click();
    await expect(page.getByRole('heading', { name: `E2E Widgets ${stamp}` })).toBeVisible();
    await page.getByLabel('Allow pay by invoice').click();
    await expectToast(page, 'Pay by invoice allowed.');
    await expect(page.getByLabel('Allow pay by invoice')).toBeChecked();
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expectToast(page, 'Company archived.');
    await page.getByRole('button', { name: 'Restore' }).click();
    await expectToast(page, 'Company restored.');
  });

  await test.step('suppliers: commission and invitations', async () => {
    await page.goto('/admin/suppliers');
    await page.getByRole('link', { name: 'PowerOn Electrical' }).click();
    await page.getByText('Percentage').click();
    await page.getByRole('textbox', { name: 'Percent' }).fill('12.5');
    await page.getByRole('button', { name: 'Save commission' }).click();
    await expectToast(page, 'Commission saved.');
    await page.getByLabel('Invite someone from this supplier').fill(`new.${stamp}@poweron.test`);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expectToast(page, 'Invitation sent.');
    await expect(page.getByText(`new.${stamp}@poweron.test`)).toBeVisible();
  });

  await test.step('library: add a page template', async () => {
    await page.goto('/admin/library');
    await page.getByRole('button', { name: 'New page template' }).click();
    await page.getByLabel('Template name').fill(`Venue information ${stamp}`);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Deliveries use the Eastern entrance.');
    await page.getByRole('button', { name: 'Save template' }).click();
    await expectToast(page, 'Saved to the library.');
    await expect(page.getByText(`Venue information ${stamp}`)).toBeVisible();
  });

  await test.step('settings: notice appears for everyone', async () => {
    await page.goto('/admin/settings');
    await page.getByLabel('Notice shown to everyone').fill(`Maintenance window ${stamp}`);
    await page.locator('form', { has: page.getByLabel('Notice shown to everyone') }).getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Settings saved.');
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: `Maintenance window ${stamp}` })).toBeVisible();
    await page.getByLabel('Notice shown to everyone').fill('');
    await expect(page.getByLabel('Notice shown to everyone')).toHaveValue('');
    await page.locator('form', { has: page.getByLabel('Notice shown to everyone') }).getByRole('button', { name: 'Save' }).click();
    await expectToast(page, 'Settings saved.');
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Maintenance window' })).toHaveCount(0);
  });

  await test.step('audit log, CSV download, system and privacy pages', async () => {
    await page.goto('/admin/audit');
    await expect(page.getByText('settings.updated').first()).toBeVisible();
    await page.getByLabel('Action starts with').fill('company.');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/action=company\./);
    await expect(page.getByText('company.created').first()).toBeVisible();
    const csv = await page.request.get('/admin/audit/export?action=company.');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('When (UTC),Who,Action');

    await page.goto('/admin/system');
    await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();

    await page.goto('/admin/gdpr');
    await page.getByLabel('Email address').fill('nobody@nowhere.test');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText('No BluePrint account with this address')).toBeVisible();
    await page.getByLabel('Email address').fill('ben@brightbuild.test');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText('BluePrint account found')).toBeVisible();
    const href = await page.getByRole('link', { name: 'Download their data (JSON)' }).getAttribute('href');
    const json = await page.request.get(href!);
    expect(json.status()).toBe(200);
    expect((await json.json()).profile.email).toBe('ben@brightbuild.test');
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('people without super admin rights cannot reach the dashboard or its downloads', async ({ page, browser }) => {
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  const res = await anonPage.request.get('/admin/audit/export');
  expect(res.status()).toBe(404);
  await anonPage.goto('/admin');
  await expect(anonPage).toHaveURL(/\/sign-in\?next=%2Fadmin/);
  await anon.close();

  await signInWithCode(page, 'chloe@cladtech.test');
  await expect(page).not.toHaveURL(/sign-in/);
  const admin = await page.goto('/admin/users');
  expect(admin?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
  for (const path of ['/admin', '/admin/settings', '/admin/gdpr', '/admin/audit']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  const exp = await page.request.get('/admin/audit/export');
  expect(exp.status()).toBe(404);
});
