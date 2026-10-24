import { test, expect } from './fixtures';
import { expectToast, signInWithCode, staffSession, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

const title = `Rigging plans due ${Date.now().toString(36)}`;

test('the team posts an announcement for space-only stands and starts an email from it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Announcements' }).click();
  await expect(page.getByRole('heading', { name: 'Announcements', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'New announcement' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Send your rigging plans by Friday so the venue can check them.');
  await page.getByRole('combobox', { name: 'Shown to' }).click();
  await page.getByRole('option', { name: 'Space only' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('radiogroup').getByText('Now', { exact: true }).click();
  await page.getByRole('button', { name: 'Save announcement' }).click();
  await expectToast(page, 'Announcement saved.');
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Email it to exhibitors…' }).click();
  await page.waitForURL(/\/emails\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Subject')).toHaveValue(title);
  await expect(page.getByText(/^2 people at 2 stands/)).toBeVisible();

  await page.goto(page.url().replace(/\/emails\/campaigns\/.*$/, '/announcements'));
  await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText('On the portal');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('space-only exhibitors see it on their portal; shell scheme exhibitors do not', async ({ browser }) => {
  test.setTimeout(120_000);
  const space = await (await browser.newContext()).newPage();
  await signInWithCode(space, 'ella@evergreen.test');
  await space.waitForURL(/\/portal\//);
  await space.goto('/portal/ukcw-london-2027');
  await expect(space.getByRole('heading', { name: title })).toBeVisible();
  await expect(space.getByText('Send your rigging plans by Friday')).toBeVisible();
  await space.goto('/portal/ukcw-london-2027/announcements');
  await expect(space.getByRole('heading', { name: title })).toBeVisible();
  await space.context().close();

  const shell = await (await browser.newContext()).newPage();
  await signInWithCode(shell, 'ben@brightbuild.test');
  await shell.waitForURL(/\/portal\//);
  await shell.goto('/portal/ukcw-london-2027');
  await expect(shell.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await expect(shell.getByRole('heading', { name: title })).toHaveCount(0);
  await shell.context().close();
});
