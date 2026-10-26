import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { signInWithCode, staffSession } from './helpers';

/**
 * Automated accessibility checks (WCAG 2.2 A and AA rules that a machine can test) on the main pages
 * of every part of BluePrint. They catch missing labels, poor contrast, broken landmarks and similar;
 * keyboard use and screen reader wording are covered by the journeys and by hand.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function audit(page: Page, label: string): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map(
    (v) =>
      `${label} (${new URL(page.url()).pathname}): ${v.id} [${v.impact}] ${v.help}\n    ${v.nodes
        .slice(0, 4)
        .map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1, 2).join('') ?? ''}`)
        .join('\n    ')}`,
  );
}

/** The address of the first link on the page that matches, for pages reached by clicking through a list. */
async function firstLink(page: Page, pattern: RegExp) {
  const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  const href = hrefs.find((h) => pattern.test(h));
  if (!href) throw new Error(`No link matching ${pattern} on ${page.url()}`);
  return href;
}

async function auditPages(page: Page, base: string, pages: [string, string][]) {
  const problems: string[] = [];
  for (const [label, path] of pages) {
    const res = await page.goto(base + path);
    expect(res?.ok(), `${label} (${base + path}) should load`).toBeTruthy();
    problems.push(...(await audit(page, label)));
  }
  return problems;
}

test.describe.configure({ mode: 'serial' });

test('the public pages, sign-in and the exhibitor portal', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = await auditPages(page, '', [
    ['home', '/'],
    ['about', '/about'],
    ['sign in', '/sign-in'],
  ]);

  await signInWithCode(page, 'chloe@cladtech.test');
  await page.waitForURL(/\/portal\/[^/]+$/);
  const base = new URL(page.url()).pathname;
  problems.push(
    ...(await auditPages(page, base, [
      ['portal home', ''],
      ['checklist', '/checklist'],
      ['manual', '/manual'],
      ['shop', '/shop'],
      ['basket', '/shop/basket'],
      ['orders', '/orders'],
      ['announcements', '/announcements'],
      ['help', '/help'],
      ['assistant', '/assistant'],
      ['company', '/company'],
    ])),
  );

  await page.goto(`${base}/checklist`);
  await page.goto(await firstLink(page, /\/tasks\/[0-9a-f-]{36}$/));
  problems.push(...(await audit(page, 'task')));

  await page.goto(`${base}/manual`);
  // The demo show may not have manual pages yet (another journey adds one).
  const manualPage = await firstLink(page, /\/portal\/[^/]+\/manual\/[^/?#]+$/).catch(() => null);
  if (manualPage) {
    await page.goto(manualPage);
    problems.push(...(await audit(page, 'manual page')));
  }

  await page.goto(base);
  await page.getByRole('button', { name: 'Ask the assistant' }).click();
  await expect(page.getByRole('dialog', { name: 'Your exhibitor assistant' })).toBeVisible();
  problems.push(...(await audit(page, 'assistant window')));

  await page.goto('/account');
  problems.push(...(await audit(page, 'account')));
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the supplier portal', async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithCode(page, 'sophie@showsound.test');
  await page.waitForURL(/\/supplier\/[^/]+$/);
  const base = new URL(page.url()).pathname;
  const problems = await auditPages(page, base, [
    ['supplier home', ''],
    ['catalogue', '/catalogue'],
    ['orders', '/orders'],
    ['payouts', '/payouts'],
    ['details', '/details'],
  ]);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the show dashboard and the super admin dashboard', async ({ page }) => {
  test.setTimeout(420_000);
  await staffSession(page);
  const problems = await auditPages(page, '/admin', [
    ['admin home', ''],
    ['shows', '/shows'],
    ['users', '/users'],
    ['companies', '/companies'],
    ['suppliers', '/suppliers'],
    ['library', '/library'],
    ['payments', '/payments'],
    ['platform settings', '/settings'],
    ['system', '/system'],
    ['audit log', '/audit'],
    ['data requests', '/gdpr'],
  ]);

  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  problems.push(...(await audit(page, 'edition setup')));
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  // The first visit can be slow on the development server while the page is compiled.
  await page.waitForURL(/\/manage\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  const dashboard = new URL(page.url()).pathname.replace(/\/$/, '');
  problems.push(
    ...(await auditPages(page, dashboard, [
      ['overview', ''],
      ['exhibitors', '/exhibitors'],
      ['stands', '/stands'],
      ['tasks', '/tasks'],
      ['manual', '/manual'],
      ['announcements', '/announcements'],
      ['shop', '/shop'],
      ['orders', '/orders'],
      ['space-only', '/space-only'],
      ['emails', '/emails'],
      ['help desk', '/help-desk'],
      ['assistant', '/assistant'],
      ['reports', '/reports'],
      ['team', '/team'],
      ['settings', '/settings'],
    ])),
  );

  await page.goto(`${dashboard}/exhibitors`);
  await page.goto(await firstLink(page, /\/exhibitors\/[0-9a-f-]{36}$/));
  problems.push(...(await audit(page, 'exhibitor record')));

  await page.goto(`${dashboard}/tasks`);
  await page.goto(await firstLink(page, /\/tasks\/[0-9a-f-]{36}$/));
  problems.push(...(await audit(page, 'task editor')));

  await page.goto(`${dashboard}/orders`);
  const order = await firstLink(page, /\/orders\/[0-9a-f-]{36}$/).catch(() => null);
  if (order) {
    await page.goto(order);
    problems.push(...(await audit(page, 'order')));
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
