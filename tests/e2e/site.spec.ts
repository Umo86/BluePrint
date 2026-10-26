import { test, expect } from './fixtures';
import { expectToast, signInWithCode, watchForErrors } from './helpers';

test('the public homepage and about page lead to sign-in', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Every stand ready for build-up' })).toBeVisible();
  // The example hall plan is described in one sentence rather than read out stand by stand.
  await expect(page.getByRole('figure')).toHaveAccessibleName(/example hall plan/i);

  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Made for organisers and the people who build their shows' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to BluePrint' })).toBeVisible();
  await page.getByRole('link', { name: 'BluePrint home' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

test('signing in goes to your workspace, and the homepage offers a way back in', async ({ page }) => {
  await signInWithCode(page, 'chloe@cladtech.test');
  await page.waitForURL(/\/portal\/[^/]+$/);
  const portal = new URL(page.url()).pathname;

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Open BluePrint' }).click();
  await expect(page).toHaveURL(new RegExp(`${portal}$`));
  // In the app, the logo goes to the workspace rather than the public homepage.
  await page.getByRole('link', { name: 'BluePrint home' }).click();
  await expect(page).toHaveURL(new RegExp(`${portal}$`));
});

test('one sign-in screen: email and password', async ({ page }) => {
  // An exhibitor adds a password on their account page, then signs in with it.
  await signInWithCode(page, 'finn@fortissteel.test');
  await page.waitForURL(/\/portal\/[^/]+$/);
  const portal = new URL(page.url()).pathname;
  await page.goto('/account');
  await page.getByLabel('Password', { exact: true }).fill('a long and memorable stand password');
  await page.getByRole('button', { name: 'Add password' }).click();
  await expectToast(page, 'Password saved');

  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('finn@fortissteel.test');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That email and password do not match.', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('a long and memorable stand password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${portal}$`));
});
