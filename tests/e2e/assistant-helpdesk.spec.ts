import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, waitForApp } from './fixtures';
import { expectToast, signInWithCode, staffSession, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

let exhibitor: BrowserContext;
let ex: Page;

test.afterAll(async () => {
  await exhibitor?.close();
});

test('an exhibitor is reminded, asks the assistant, and hands a question to the show team', async ({ browser }) => {
  test.setTimeout(180_000);
  exhibitor = await browser.newContext();
  ex = await exhibitor.newPage();
  const errors = watchForErrors(ex);
  await signInWithCode(ex, 'dev@duraroofing.test');
  await ex.waitForURL(/\/portal\/ukcw-london-2027$/);
  await waitForApp(ex);

  // The assistant's reminder about something due soon, shown once.
  const reminder = ex.getByRole('alert').filter({ hasText: 'A reminder from your assistant' });
  await expect(reminder).toContainText('Read the build-up and breakdown rules');

  await ex.getByRole('button', { name: 'Ask the assistant' }).click();
  const chat = ex.getByRole('dialog', { name: 'Your exhibitor assistant' });
  await expect(chat.getByText(/Next up is “Read the build-up and breakdown rules”/)).toBeVisible();
  await chat.getByRole('button', { name: 'What do I still need to do?' }).click();
  await expect(chat.getByText('Here is what is still to do:')).toBeVisible();
  await expect(chat.getByRole('link', { name: 'Read the build-up and breakdown rules' })).toBeVisible();

  // Something the manual does not cover is logged for the team, and handed over on request.
  await chat.getByLabel('Your question').fill('Is there coach parking at the venue?');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(/passed the question on to the show team/)).toBeVisible();
  await chat.getByLabel('Your question').fill('Please contact the team for me about coach parking');
  await chat.getByLabel('Your question').press('Enter');
  await expect(chat.getByText('For the show team: Question from the assistant')).toBeVisible();
  await chat.getByRole('button', { name: 'Send to the show team' }).click();
  await expectToast(ex, 'Sent to the show team.');
  await expect(chat.getByText(/^Sent \(HD-\d{6}\)$/)).toBeVisible();
  await ex.keyboard.press('Escape');

  await ex.getByRole('navigation').getByRole('link', { name: 'Help' }).click();
  await expect(ex.getByRole('link', { name: 'Question from the assistant' })).toBeVisible();
  await expect(ex.getByText('With the show team')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the team replies from the help desk and answers the question for the assistant', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByText('Questions for the team')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: /Help desk/ }).click();
  await page.getByRole('link', { name: 'Question from the assistant' }).click();
  await expect(page.getByText('Dura Roofing Group')).toBeVisible();
  await page.getByLabel('Reply to the exhibitor').fill('Coach parking is in the Orange car park. Book it with the venue.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expectToast(page, 'Reply sent.');
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('Waiting for the exhibitor');

  await page.getByRole('navigation').getByRole('link', { name: /Assistant/ }).click();
  await expect(page.getByText('Is there coach parking at the venue?')).toBeVisible();
  await page.getByRole('button', { name: 'Add an answer' }).click();
  await page.getByLabel('Answer to: Is there coach parking at the venue?').fill('Yes: the Orange car park, bookable with the venue.');
  await page.getByRole('button', { name: 'Save answer' }).click();
  await expectToast(page, 'Answer saved.');
  await expect(page.getByText('Nothing waiting. Well done.')).toBeVisible();
  await page.getByRole('link', { name: 'Dura Roofing Group' }).first().click();
  await expect(page.getByText('Assistant conversation')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the exhibitor sees the reply, and the assistant now knows the answer', async () => {
  test.setTimeout(120_000);
  await ex.goto('/portal/ukcw-london-2027/help');
  await ex.getByRole('link', { name: 'Question from the assistant' }).click();
  await expect(ex.getByText('Coach parking is in the Orange car park.')).toBeVisible();
  await expect(ex.getByText('Reply from the team')).toBeVisible();

  await ex.goto('/portal/ukcw-london-2027/assistant');
  await ex.getByLabel('Your question').fill('Where can a coach park?');
  await ex.getByRole('button', { name: 'Send' }).click();
  await expect(ex.getByText(/Orange car park, bookable with the venue/)).toBeVisible();
  // The home page reminder is not repeated.
  await ex.goto('/portal/ukcw-london-2027');
  await expect(ex.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await expect(ex.getByText('A reminder from your assistant')).toHaveCount(0);
});
