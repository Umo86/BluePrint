import { test as base, expect, type Page } from '@playwright/test';

/** Waits until React has taken over the page, so typing and uploads are not lost. */
export async function waitForApp(page: Page) {
  await page.locator('html[data-ready="true"]').waitFor({ state: 'attached', timeout: 15_000 });
}

/**
 * The standard `page`, except that `goto` and `reload` also wait for the app to be interactive.
 * Pages that are plain responses (404s, downloads) are returned as soon as they load.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      if (res && res.ok() && (res.headers()['content-type'] ?? '').includes('text/html')) await waitForApp(page);
      return res;
    };
    page.reload = async (options) => {
      const res = await reload(options);
      if (res && res.ok()) await waitForApp(page);
      return res;
    };
    await provide(page);
  },
});

export { expect };
