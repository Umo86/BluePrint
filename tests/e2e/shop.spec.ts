import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectToast, staffSession, signInWithCode, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

const PORTAL = '/portal/ukcw-london-2027';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let orderNumber = '';

async function addToBasket(page: Page, product: string, fill: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.getByRole('button', { name: `Add ${product} to basket` }).click();
  const dialog = page.getByRole('dialog', { name: product });
  await expect(dialog).toBeVisible();
  await fill(dialog);
  await dialog.getByRole('button', { name: 'Add to basket' }).click();
  await expectToast(page, 'Added to your basket.');
  await expect(dialog).toBeHidden();
}

test('an exhibitor orders services and pays by card', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'amira@acme-insulation.test');
  await page.waitForURL(new RegExp(`${PORTAL}$`));

  await page.getByRole('link', { name: 'Order services' }).click();
  await expect(page.getByRole('heading', { name: 'Order services' })).toBeVisible();
  // Shell scheme stands see the organiser's cleaning service as well as the suppliers' categories.
  await expect(page.getByRole('heading', { name: 'Stand cleaning' })).toBeVisible();

  await addToBasket(page, 'Folding chair', async (dialog) => {
    await dialog.getByRole('button', { name: 'Add to basket' }).click();
    await expect(dialog.getByText('Choose a colour.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Colour' }).click();
    await page.getByRole('option', { name: 'White' }).click();
    await dialog.getByLabel('Quantity').fill('4');
  });
  await addToBasket(page, '500 W power socket', async (dialog) => {
    await dialog.getByLabel('Where on the stand should it go?').fill('Back wall, left');
  });

  await page.getByRole('link', { name: /Basket \(2\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
  // 4 × £18 + £85 = £157 before VAT, £31.40 VAT.
  await expect(page.getByText('£157.00')).toBeVisible();
  await expect(page.getByText('£31.40')).toBeVisible();
  await expect(page.getByText('Card processing fee')).toBeVisible();
  const pay = page.getByRole('button', { name: /^Pay £[\d,.]+ securely$/ });
  await expect(pay).toBeDisabled();
  await page.getByLabel('I accept these terms').check();
  await pay.click();

  // The local payment simulator stands in for Stripe's payment page.
  await page.waitForURL(/\/shop\/test-checkout\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Test payment' })).toBeVisible();
  await page.getByRole('button', { name: /^Pay £[\d,.]+ \(test\)$/ }).click();

  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?checkout=done$/);
  await expect(page.getByText('Thank you, your payment went through')).toBeVisible();
  const heading = await page.getByRole('heading', { name: /^Order ORD-\d{6}$/ }).innerText();
  orderNumber = heading.replace('Order ', '').trim();
  expect(orderNumber).toMatch(/^ORD-\d{6}$/);
  const invoice = page.getByRole('link', { name: /VAT invoice INV-\d{6}/ });
  await expect(invoice).toBeVisible();
  const pdf = await page.request.get((await invoice.getAttribute('href'))!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // The basket is empty again and the order task is done.
  await page.getByRole('link', { name: 'Your orders', exact: true }).click();
  await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
  await page.getByRole('link', { name: /^Your checklist/ }).click();
  const task = page.locator('.mantine-Paper-root').filter({ has: page.getByRole('link', { name: 'Order your stand electrics' }) }).last();
  await expect(task.getByText('Done', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an exhibitor with an account orders on invoice', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'dev@duraroofing.test');
  await page.waitForURL(new RegExp(`${PORTAL}$`));
  await page.goto(`${PORTAL}/shop`);
  await addToBasket(page, 'Daily stand clean', async (dialog) => {
    await dialog.getByLabel(/Quantity/).fill('3');
  });
  await page.goto(`${PORTAL}/shop/basket`);
  await page.getByRole('radiogroup').getByText('Pay on invoice').click();
  await expect(page.getByText('Card processing fee')).toHaveCount(0);
  await page.getByLabel('Your purchase order number (optional)').fill('PO-DURA-1');
  await page.getByLabel('I accept these terms').check();
  // 3 days × £35 + VAT = £126.
  await page.getByRole('button', { name: 'Place order on invoice (£126.00)' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
  await expect(page.getByText('Order placed', { exact: true })).toBeVisible();
  await expect(page.getByText('Your PO number: PO-DURA-1')).toBeVisible();
  await expect(page.getByRole('link', { name: /VAT invoice INV-\d{6}/ })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the supplier confirms the order and offers a new product', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'fiona@expofurniture.test');
  await page.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Expo Furniture Hire' })).toBeVisible();

  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(orderNumber) });
  await expect(row).toContainText('Acme Insulation Ltd');
  await expect(row).toContainText('Folding chair');
  // Only their own lines: the electrics on the same order belong to another supplier.
  await expect(page.getByText('500 W power socket')).toHaveCount(0);
  await row.getByRole('combobox', { name: /^Status of/ }).click();
  await page.getByRole('option', { name: 'Confirmed' }).click();
  await expectToast(page, 'Updated.');

  await page.getByRole('link', { name: 'Payouts', exact: true }).click();
  await expect(page.getByText('Payouts on')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(orderNumber) })).toContainText('Sent');

  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('link', { name: 'Add a product' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Bar stool');
  await page.getByLabel('Price (before VAT)').fill('22');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expectToast(page, 'Sent to the show team for approval.');
  await page.waitForURL(/\/catalogue$/);
  await expect(page.getByRole('row', { name: /Bar stool/ })).toContainText('Awaiting approval');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the show team approves the product and refunds part of the order', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Shop catalogue' }).click();
  await page.getByRole('tab', { name: /Awaiting approval/ }).click();
  await page.getByRole('button', { name: 'Approve Bar stool' }).click();
  await expectToast(page, 'Approved. It is on sale now.');
  await page.getByRole('tab', { name: 'Catalogue' }).click();
  await expect(page.getByRole('row', { name: /Bar stool/ })).toContainText('On sale');

  // The team adds one of its own products, with an early-bird price.
  await page.getByRole('link', { name: 'Add a product' }).first().click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Waste bin');
  await page.getByLabel('Price (before VAT)').fill('8');
  await page.getByLabel('Early-bird price', { exact: true }).check();
  await page.getByLabel('Early-bird price (before VAT)').fill('6');
  await page.getByLabel('Until (days before build-up)').fill('30');
  await page.getByRole('button', { name: 'Add and put on sale' }).click();
  await expectToast(page, 'Product added. It is on sale now.');
  await page.waitForURL(/\/shop$/);
  await expect(page.getByRole('row', { name: /Waste bin/ })).toContainText('Early £6.00');

  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await page.getByRole('link', { name: orderNumber }).click();
  await expect(page.getByRole('heading', { name: `Order ${orderNumber}` })).toBeVisible();
  await expect(page.getByRole('row', { name: /Expo Furniture Hire/ }).last()).toContainText('Paid out');

  await page.getByRole('button', { name: 'Refund' }).click();
  const dialog = page.getByRole('dialog', { name: 'Refund' });
  // One white chair: £18 + £3.60 VAT.
  await dialog.getByLabel('Refund for 4 × Folding chair').fill('21.60');
  await dialog.getByLabel('Reason').fill('One chair not needed');
  await dialog.getByRole('button', { name: 'Refund £21.60' }).click();
  await expectToast(page, 'Refund made and credit note issued.');
  await expect(page.getByRole('link', { name: /Credit note CRN-\d{6}/ })).toBeVisible();
  await expect(page.getByText('Partly taken back')).toBeVisible();
  await expect(page.getByText('Partly refunded').first()).toBeVisible();

  await page.getByRole('link', { name: '← Orders' }).click();
  await page.getByRole('link', { name: 'Commission and payouts' }).click();
  await expect(page.getByRole('row', { name: /Expo Furniture Hire/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Provided by the organiser/ })).toBeVisible();

  // The super admin's payments page shows PowerOn's payout waiting for its Stripe set-up.
  await page.goto('/admin/payments');
  await expect(page.getByText('Local simulator')).toBeVisible();
  await expect(page.getByRole('row', { name: /PowerOn Electrical/ }).first()).toContainText('Waiting');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('people cannot see orders that are not theirs', async ({ page }) => {
  await signInWithCode(page, 'ben@brightbuild.test');
  await page.waitForURL(new RegExp(`${PORTAL}$`));
  await page.goto(`${PORTAL}/orders`);
  await expect(page.getByText('No orders yet')).toBeVisible();
  const res = await page.request.get('/admin/payments');
  expect(res.status()).toBe(404);
  const csv = await page.request.get('/supplier/00000000-0000-0000-0000-000000000000/orders/export');
  expect(csv.status()).toBe(404);
});

test('an exhibitor sends artwork with an order and the supplier downloads it', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'dev@duraroofing.test');
  await page.waitForURL(new RegExp(`${PORTAL}$`));
  await page.goto(`${PORTAL}/shop`);
  await page.getByRole('button', { name: 'Add Printed graphic panel to basket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Printed graphic panel' });
  // The panel cannot go in the basket without its artwork.
  await dialog.getByRole('button', { name: 'Add to basket' }).click();
  await expect(dialog.getByText('Please upload the file.')).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'panel-artwork.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(dialog.getByRole('link', { name: 'panel-artwork.pdf' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to basket' }).click();
  await expectToast(page, 'Added to your basket.');

  await page.goto(`${PORTAL}/shop/basket`);
  await expect(page.getByRole('link', { name: 'panel-artwork.pdf' })).toBeVisible();
  await page.getByRole('radiogroup').getByText('Pay on invoice').click();
  await page.getByLabel('I accept these terms').check();
  await page.getByRole('button', { name: /^Place order on invoice/ }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
  await expect(page.getByRole('link', { name: 'panel-artwork.pdf' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);

  // The supplier sees the artwork on the order line and can download it.
  const supplier = await (await browser.newContext()).newPage();
  await signInWithCode(supplier, 'sophie@showsound.test');
  await supplier.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await supplier.getByRole('link', { name: 'Orders', exact: true }).click();
  const link = supplier.getByRole('link', { name: 'panel-artwork.pdf' });
  await expect(link).toBeVisible();
  const res = await supplier.request.get((await link.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('attachment');
});

test('an exhibitor leaves services in the basket; their home page and the team’s open baskets show it', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await signInWithCode(page, 'finn@fortissteel.test');
  await page.waitForURL(new RegExp(`${PORTAL}$`));
  await page.goto(`${PORTAL}/shop`);
  await addToBasket(page, 'Folding chair', async (dialog) => {
    await dialog.getByRole('combobox', { name: 'Colour' }).click();
    await page.getByRole('option', { name: 'Black' }).click();
    await dialog.getByLabel('Quantity').fill('2');
  });
  // The home page reminds them: 2 × £18 plus VAT.
  await page.goto(PORTAL);
  await expect(page.getByText('Your basket is waiting')).toBeVisible();
  await expect(page.getByText('2 × Folding chair worth £43.20 including VAT, not ordered yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Review and order' }).click();
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);

  // The show team sees it among the open baskets and sends a reminder now.
  const team = await (await browser.newContext()).newPage();
  const teamErrors = watchForErrors(team);
  await staffSession(team);
  await team.goto('/admin/shows');
  await team.getByRole('link', { name: 'UKCW London 2027' }).click();
  await team.getByRole('link', { name: 'Open show dashboard' }).click();
  // Open baskets is in the menu (with a count) and on the Orders page.
  await expect(team.getByRole('navigation').getByRole('link', { name: /Open baskets/ })).toBeVisible();
  await team.getByRole('navigation').getByRole('link', { name: 'Orders', exact: true }).click();
  await team.getByRole('main').getByRole('link', { name: /^Open baskets \(\d+\)$/ }).click();
  await expect(team.getByRole('heading', { name: 'Open baskets' })).toBeVisible();
  const row = team.getByRole('row', { name: /Fortis Steel/ });
  await expect(row).toContainText('2 × Folding chair');
  await expect(row).toContainText('£43.20');
  await row.getByRole('button', { name: 'Send reminder now' }).click();
  await team.getByRole('dialog').getByRole('button', { name: 'Send reminder' }).click();
  await expectToast(team, /Reminder (sent|recorded|kept)/);
  await expect(team.getByRole('row', { name: /Fortis Steel/ })).toContainText('by the team');

  // Reminders can be switched off for the show, and on again.
  await team.getByLabel('Email exhibitors who leave services in their basket').click();
  await team.getByRole('button', { name: 'Save reminder settings' }).click();
  await expectToast(team, 'Basket reminder settings saved.');
  await team.reload();
  await expect(team.getByLabel('Email exhibitors who leave services in their basket')).not.toBeChecked();
  await team.getByLabel('Email exhibitors who leave services in their basket').click();
  await team.getByRole('button', { name: 'Save reminder settings' }).click();
  await expectToast(team, 'Basket reminder settings saved.');
  expect(teamErrors, teamErrors.join('\n')).toEqual([]);
});
