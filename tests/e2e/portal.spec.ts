import type { Page } from '@playwright/test';
import { test, expect, waitForApp } from './fixtures';
import { expectToast, staffSession, signInWithCode, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let dashboard = '';
let taskTitle = '';

async function openUkcwDashboard(page: Page) {
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return page.url().replace(/\/$/, '');
}

test('the show team builds a manual page and a form task', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  const stamp = Date.now().toString(36);
  taskTitle = `Stand team details ${stamp}`;
  await staffSession(page);
  dashboard = await openUkcwDashboard(page);

  await test.step('manual page with a download', async () => {
    await page.goto(`${dashboard}/manual/new`);
    await page.getByLabel('Title').fill('Deliveries and access');
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('All deliveries use the Eastern entrance.');
    await page.locator('input[type=file]').setInputFiles({ name: 'site-plan.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.locator('.ProseMirror a', { hasText: 'site-plan.pdf' })).toBeVisible();
    await page.getByLabel('Published').check();
    await page.getByRole('button', { name: 'Save page' }).click();
    await expectToast(page, 'Page saved.');
    await expect(page).toHaveURL(/\/manual\/[0-9a-f-]{36}$/);
  });

  await test.step('form task with conditions, an upload and a declaration', async () => {
    await page.goto(`${dashboard}/tasks/new`);
    await page.getByLabel('Title').fill(taskTitle);
    // Only shell scheme stands have to do it.
    await page.getByRole('radiogroup', { name: 'Requirement for Space only' }).getByText('Not shown').click();
    await page.getByLabel('The team checks and approves answers').check();
    await page.getByRole('tab', { name: /Questions/ }).click();
    const add = async (type: string) => {
      await page.getByRole('button', { name: 'Add a question' }).click();
      await page.getByRole('menuitem', { name: type, exact: true }).click();
    };
    await add('Short answer');
    await page.getByRole('textbox', { name: 'Question', exact: true }).last().fill('Stand manager');
    await page.getByLabel('Required', { exact: true }).last().check();
    await add('Choose one');
    await page.getByRole('textbox', { name: 'Question', exact: true }).last().fill('Delivery vehicle');
    await add('Short answer');
    await page.getByRole('textbox', { name: 'Question', exact: true }).last().fill('Lorry registration');
    await page.getByRole('combobox', { name: 'Only show if' }).last().click();
    await page.getByRole('option', { name: 'Delivery vehicle' }).click();
    await add('File upload');
    await add('Declaration');
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByLabel('Stand manager')).toBeVisible();
    await expect(page.getByLabel('Lorry registration')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Delivery vehicle' }).click();
    await page.getByRole('option', { name: 'Option 1' }).click();
    await expect(page.getByLabel('Lorry registration')).toBeVisible();
    await page.getByLabel('Published (exhibitors can see it)').check();
    await page.getByRole('button', { name: 'Save task' }).click();
    await expectToast(page, 'Task saved.');
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an exhibitor completes their checklist', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'amira@acme-insulation.test');
  await page.waitForURL(/\/portal\/ukcw-london-2027$/);
  await waitForApp(page);
  await expect(page.getByRole('heading', { name: 'Welcome, Amira' })).toBeVisible();

  await test.step('manual page and its download', async () => {
    await page.getByRole('navigation').getByRole('link', { name: 'Exhibitor manual' }).click();
    await page.getByRole('link', { name: 'Deliveries and access' }).click();
    await expect(page.getByText('All deliveries use the Eastern entrance.')).toBeVisible();
    const href = await page.getByRole('link', { name: 'site-plan.pdf' }).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain('attachment');
  });

  await test.step('fill in, save and submit the form', async () => {
    await page.getByRole('navigation').getByRole('link', { name: /Your checklist/ }).click();
    await page.getByRole('link', { name: taskTitle }).click();
    await waitForApp(page);
    await page.getByLabel('Stand manager').fill('Amira Khan');
    await page.getByRole('button', { name: 'Save and finish later' }).click();
    await expectToast(page, 'Saved.');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText('Tick the declaration and type your full name.')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'team-list.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByRole('link', { name: 'team-list.pdf' })).toBeVisible();
    await page.getByLabel('I confirm the statement above').check();
    await page.getByLabel('Your full name').fill('Amira Khan');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expectToast(page, 'Sent. Thank you.');
    await expect(page.getByText('Waiting for review')).toBeVisible();
  });

  await test.step('invite a colleague', async () => {
    await page.getByRole('navigation').getByRole('link', { name: 'Your company and team' }).click();
    await page.getByLabel("Colleague's email").fill('sam@acme-insulation.test');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expectToast(page, 'Invitation sent.');
    await expect(page.getByText('sam@acme-insulation.test')).toBeVisible();
  });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the team asks for changes, and the exhibitor sees it; space-only stands do not get the task', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await staffSession(page);
  await page.goto(`${dashboard}/tasks`);
  await page.getByRole('link', { name: taskTitle }).click();
  await page.getByRole('tab', { name: /Responses/ }).click();
  await page.getByRole('row', { name: /Acme Insulation/ }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('dialog').getByText('Amira Khan').first()).toBeVisible();
  await page.getByLabel('Note to the exhibitor').fill('Please add your stand builder’s name.');
  await page.getByRole('button', { name: 'Ask for changes' }).click();
  await expectToast(page, 'Decision saved.');

  const ctx = await browser.newContext();
  const ex = await ctx.newPage();
  await signInWithCode(ex, 'amira@acme-insulation.test');
  await ex.waitForURL(/\/portal\//);
  await ex.goto(`/portal/ukcw-london-2027/checklist`);
  await expect(ex.getByText('Changes needed').first()).toBeVisible();
  await ex.getByRole('link', { name: taskTitle }).click();
  await expect(ex.getByText('Please add your stand builder’s name.')).toBeVisible();
  await ctx.close();

  const ctx2 = await browser.newContext();
  const space = await ctx2.newPage();
  await signInWithCode(space, 'ella@evergreen.test');
  await space.waitForURL(/\/portal\//);
  await space.goto('/portal/ukcw-london-2027/checklist');
  await expect(space.getByRole('heading', { name: 'Your checklist' })).toBeVisible();
  await expect(space.getByRole('link', { name: taskTitle })).toHaveCount(0);
  await ctx2.close();
});

test('admins can see the portal as an exhibitor, read-only', async ({ page }) => {
  test.setTimeout(120_000);
  await staffSession(page);
  await page.goto(`${dashboard}/exhibitors`);
  await page.getByRole('link', { name: 'Acme Insulation Ltd' }).click();
  await page.getByRole('button', { name: 'See their portal' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open their portal' }).click();
  await expect(page).toHaveURL(/\/portal\/ukcw-london-2027/);
  await expect(page.getByText(/Viewing as Amira Khan/)).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: /Your checklist/ }).click();
  await page.getByRole('link', { name: taskTitle }).click();
  await expect(page.getByText('You are viewing as someone else, so nothing can be changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Send/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop viewing' }).click();
  await expect(page).toHaveURL(/\/manage\/.*\/exhibitors/);
});
