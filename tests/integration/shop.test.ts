import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import {
  auditLog,
  refunds,
  cartItems,
  companies,
  companyMembers,
  editions,
  emailOutbox,
  files,
  invoices,
  orderLines,
  orders,
  products,
  stripeEvents,
  submissions,
  supplierTransfers,
  supplierUsers,
  suppliers,
} from '@/server/db/schema';
import { MemoryStorage, setStorageForTests } from '@/server/storage';
import { SimulatedPayments, payments, resetPaymentsForTests, setPaymentsForTests } from '@/server/payments/provider';
import { resetEnvCache } from '@/server/env';
import {
  catalogueForStaff,
  createCategory,
  createProduct,
  createSupplierProduct,
  setProductStatus,
  submitSupplierProduct,
  updateProduct,
  updateSupplierProduct,
} from '@/server/services/catalogue';
import { addToBasket, basketForStand, checkout, confirmCheckoutReturn, shopForStand, simulateCheckout, updateBasketItem } from '@/server/services/shop';
import {
  PENDING_ORDER_TTL_MS,
  cancelOrder,
  commissionReport,
  expireStaleOrders,
  exportOrdersCsv,
  handleStripeEvent,
  markInvoicePaid,
  markOrderPaid,
  orderForExhibitor,
  orderForStaff,
  refundOrder,
  setLineFulfilment,
  settleManualTransfer,
  supplierOrders,
} from '@/server/services/orders';
import { completeSimulatedOnboarding, startStripeOnboarding } from '@/server/services/supplier-portal';
import { createTask } from '@/server/services/tasks';
import { canReadFile } from '@/server/services/files';
import { updatePlatformSettings } from '@/server/services/settings';
import { grossUpCardFee } from '@/lib/pricing';
import { actorFor, lastEmailTo, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

let sim: SimulatedPayments;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
beforeEach(() => {
  setStorageForTests(new MemoryStorage());
  sim = new SimulatedPayments();
  setPaymentsForTests(sim);
});
afterEach(() => {
  setStorageForTests(null);
  setPaymentsForTests(null);
});

async function makeSupplier(name: string, opts: { stripe?: boolean } = {}) {
  const db = await getDb();
  const [s] = await db
    .insert(suppliers)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, '')}@supplier.example`,
      stripeAccountId: opts.stripe ? `acct_${Math.random().toString(36).slice(2, 12)}` : null,
      stripePayoutsEnabled: Boolean(opts.stripe),
      stripeDetailsSubmitted: Boolean(opts.stripe),
    })
    .returning();
  const user = await makeUser({ name: `${name} user` });
  await db.insert(supplierUsers).values({ supplierId: s.id, userId: user.id });
  return { supplier: s, user, actor: actorFor(user) };
}

/** A show with a furniture category (supplier, 15% commission, 5 chairs in stock) and Media10's own cleaning. */
async function shopFixture() {
  const { edition, shell, space } = await makeEdition();
  const admin = await makeStaff(edition.id, 'show_admin');
  const adminActor = actorFor(admin);
  const furnitureCo = await makeSupplier(`Furniture ${Math.random().toString(36).slice(2, 6)}`, { stripe: true });
  const furniture = await createCategory(adminActor, edition.id, { name: 'Furniture', supplierId: furnitureCo.supplier.id, commissionType: 'percent', commissionValue: 1500 });
  const cleaning = await createCategory(adminActor, edition.id, { name: 'Stand cleaning', visibleToTypes: [shell.id] });
  const chair = await createProduct(adminActor, edition.id, {
    categoryId: furniture.id,
    name: 'Chair',
    pricePence: 2500,
    vatRateBps: 2000,
    stockLimit: 5,
    options: [{ name: 'Colour', values: ['Black', 'White'] }],
  });
  const clean = await createProduct(adminActor, edition.id, {
    categoryId: cleaning.id,
    name: 'Daily clean',
    pricePence: 4000,
    vatRateBps: 2000,
    requiredDetails: [{ id: 'access', label: 'Access notes', type: 'text', required: true }],
  });
  return { edition, shell, space, admin, adminActor, furnitureCo, furniture, cleaning, chair, clean };
}

describe('catalogue', () => {
  it('lets the show team run the catalogue, but only admins set commission', async () => {
    const { edition, adminActor, furniture } = await shopFixture();
    const team = await makeStaff(edition.id, 'show_team', ['manage_orders']);
    const viewer = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    await expect(createCategory(actorFor(viewer), edition.id, { name: 'Nope' })).rejects.toThrow();
    await expect(createCategory(actorFor(team), edition.id, { name: 'AV', commissionType: 'percent', commissionValue: 500 })).rejects.toThrow(/Only show admins/);
    const av = await createCategory(actorFor(team), edition.id, { name: 'AV' });
    expect(av.commissionType).toBeNull();
    await expect(createCategory(adminActor, edition.id, { name: 'Odd', commissionType: 'percent' })).rejects.toThrow();
    await expect(createProduct(adminActor, edition.id, { categoryId: furniture.id, name: 'Table', pricePence: 100, vatRateBps: 2000, earlyPricePence: 50 })).rejects.toThrow();
    const cat = await catalogueForStaff(actorFor(team), edition.id);
    expect(cat.canSetCommission).toBe(false);
    expect(cat.products.map((p) => p.name).sort()).toEqual(['Chair', 'Daily clean']);
    // Someone from another show cannot see it at all.
    const other = await makeEdition();
    const outsider = await makeStaff(other.edition.id, 'show_admin');
    await expect(catalogueForStaff(actorFor(outsider), edition.id)).rejects.toThrow(/could not find/);
  });

  it('only sells supplier products once the show team approves them, and again after changes', async () => {
    const { edition, adminActor, furnitureCo, furniture, shell } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const sofa = await createSupplierProduct(furnitureCo.actor, furnitureCo.supplier.id, { categoryId: furniture.id, name: 'Sofa', pricePence: 15_000, vatRateBps: 2000 });
    expect(sofa.status).toBe('draft');
    const names = async () => (await shopForStand(actorFor(ex.user), ex.stand.id)).categories.flatMap((c) => c.products.map((p) => p.name));
    expect(await names()).not.toContain('Sofa');
    await submitSupplierProduct(furnitureCo.actor, furnitureCo.supplier.id, sofa.id);
    const db = await getDb();
    const approvalMail = await db.select().from(emailOutbox).where(eq(emailOutbox.subject, 'Product to approve: Sofa'));
    expect(approvalMail.length).toBeGreaterThan(0);
    await expect(setProductStatus(adminActor, sofa.id, 'rejected')).rejects.toThrow(/Explain/);
    await setProductStatus(adminActor, sofa.id, 'approved');
    expect(await names()).toContain('Sofa');
    // A price change by the supplier takes it off sale until approved again.
    const { status } = await updateSupplierProduct(furnitureCo.actor, furnitureCo.supplier.id, sofa.id, { categoryId: furniture.id, name: 'Sofa', pricePence: 19_000, vatRateBps: 2000 });
    expect(status).toBe('pending_approval');
    expect(await names()).not.toContain('Sofa');
    // Another supplier, and a category the supplier does not fulfil, are both off limits.
    const rival = await makeSupplier('Rival Hire');
    await expect(updateSupplierProduct(rival.actor, rival.supplier.id, sofa.id, { categoryId: furniture.id, name: 'Mine now', pricePence: 1, vatRateBps: 0 })).rejects.toThrow();
    await expect(updateSupplierProduct(rival.actor, furnitureCo.supplier.id, sofa.id, { categoryId: furniture.id, name: 'Mine now', pricePence: 1, vatRateBps: 0 })).rejects.toThrow();
    const cleaningCat = (await catalogueForStaff(adminActor, edition.id)).categories.find((c) => c.name === 'Stand cleaning')!;
    await expect(createSupplierProduct(furnitureCo.actor, furnitureCo.supplier.id, { categoryId: cleaningCat.id, name: 'Sneaky', pricePence: 1, vatRateBps: 0 })).rejects.toThrow();
  });
});

describe('shop and basket', () => {
  it('shows each stand type only its categories, and checks choices and stock', async () => {
    const { edition, shell, space, chair, clean } = await shopFixture();
    const shellEx = await makeExhibitor(edition.id, shell.id);
    const spaceEx = await makeExhibitor(edition.id, space.id);
    const spaceShop = await shopForStand(actorFor(spaceEx.user), spaceEx.stand.id);
    expect(spaceShop.categories.map((c) => c.name)).toEqual(['Furniture']);
    const shellShop = await shopForStand(actorFor(shellEx.user), shellEx.stand.id);
    expect(shellShop.categories.map((c) => c.name)).toEqual(['Furniture', 'Stand cleaning']);
    const shownChair = shellShop.categories[0].products[0];
    expect(shownChair).toMatchObject({ name: 'Chair', unitPence: 2500, stockLeft: 5 });
    expect(shownChair).not.toHaveProperty('commissionValue');

    const me = actorFor(shellEx.user);
    await expect(addToBasket(me, shellEx.stand.id, { productId: chair.id, quantity: 1 })).rejects.toThrow(/colour/);
    await expect(addToBasket(me, shellEx.stand.id, { productId: chair.id, quantity: 1, options: { Colour: 'Pink' } })).rejects.toThrow(/colour/);
    await expect(addToBasket(me, shellEx.stand.id, { productId: clean.id, quantity: 1 })).rejects.toThrow(/Access notes/);
    await expect(addToBasket(actorFor(spaceEx.user), spaceEx.stand.id, { productId: clean.id, quantity: 1, details: { access: 'x' } })).rejects.toThrow(/no longer available/);
    await expect(addToBasket(me, shellEx.stand.id, { productId: chair.id, quantity: 6, options: { Colour: 'Black' } })).rejects.toThrow(/Only 5/);
    await addToBasket(me, shellEx.stand.id, { productId: chair.id, quantity: 2, options: { Colour: 'Black' }, details: { ignored: 'dropped' } });
    await addToBasket(me, shellEx.stand.id, { productId: chair.id, quantity: 1, options: { Colour: 'Black' } });
    const db = await getDb();
    const items = await db.select().from(cartItems).where(eq(cartItems.standId, shellEx.stand.id));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].details).toEqual({});

    // Another exhibitor cannot touch this basket; a colleague without payment rights cannot pay.
    await expect(updateBasketItem(actorFor(spaceEx.user), shellEx.stand.id, items[0].id, 1)).rejects.toThrow();
    const colleague = await makeUser();
    await db.insert(companyMembers).values({ companyId: shellEx.company.id, userId: colleague.id, role: 'colleague', canPay: false });
    const b = await basketForStand(actorFor(colleague), shellEx.stand.id);
    expect(b.canPay).toBe(false);
    await expect(checkout(actorFor(colleague), shellEx.stand.id, { method: 'card', expectedTotalPence: b.totals.totalPence })).rejects.toThrow(/permission to pay/);
    // Viewing as the exhibitor changes nothing.
    const admin = await makeUser({ isSuperAdmin: true });
    await expect(addToBasket(actorFor(shellEx.user, { readOnly: true, realUserId: admin.id, viewAsEditionId: shellEx.stand.editionId }), shellEx.stand.id, { productId: chair.id, quantity: 1, options: { Colour: 'White' } })).rejects.toThrow(/viewing as/);
  });
});

describe('card checkout and payouts', () => {
  it('takes payment, issues the invoice, pays the supplier and completes the order task', async () => {
    const { edition, shell, adminActor, chair, clean, furniture, furnitureCo } = await shopFixture();
    await updatePlatformSettings(adminActor.isSuperAdmin ? adminActor : actorFor(await makeUser({ isSuperAdmin: true })), { feeMode: 'exhibitor_pays', stripeFeePercentBps: 150, stripeFeeFixedPence: 20 });
    const task = await createTask(adminActor, edition.id, {
      title: 'Order your furniture',
      kind: 'order',
      linkedCategoryId: furniture.id,
      deadline: { mode: 'offset', offsetDays: 21 },
      published: true,
      requirements: { [shell.id]: 'required' },
    });
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 4, options: { Colour: 'White' } });
    await addToBasket(me, ex.stand.id, { productId: clean.id, quantity: 1, details: { access: 'Back door' } });
    const basket = await basketForStand(me, ex.stand.id, 'card');
    // 4 × £25 + £40 = £140 net, £28 VAT, card fee on top.
    expect(basket.totals).toMatchObject({ netPence: 14_000, vatPence: 2800 });
    expect(basket.totals.cardFeePence).toBe(grossUpCardFee(16_800, { percentBps: 150, fixedPence: 20 }));

    await expect(checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: 100 })).rejects.toThrow(/Prices have changed/);
    await expect(checkout(me, ex.stand.id, { method: 'invoice', expectedTotalPence: 16_800 })).rejects.toThrow(/invoice has not been set up/);
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: basket.totals.totalPence, poNumber: 'PO-77' });
    expect(placed.redirectUrl).toBe(`/shop/test-checkout/${placed.orderId}`);
    const db = await getDb();
    let [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order).toMatchObject({ status: 'pending_payment', totalPence: basket.totals.totalPence, poNumber: 'PO-77' });
    expect(order.number).toMatch(/^ORD-\d{6}$/);
    const session = sim.calls.find((c) => c.method === 'createCheckout')!.args as { lines: { amountPence: number }[] };
    expect(session.lines.reduce((a, l) => a + l.amountPence, 0)).toBe(order.totalPence);
    // The chairs are held while the payment is open.
    expect((await shopForStand(me, ex.stand.id)).categories[0].products[0].stockLeft).toBe(1);

    // A payment for the wrong amount is refused and recorded.
    const wrong = await markOrderPaid(order.id, { paymentIntentId: 'pi_x', amountPence: 1, via: 'webhook' });
    expect(wrong.problem).toBe('amount_mismatch');
    const alerts = await db.select().from(auditLog).where(and(eq(auditLog.action, 'shop.payment_problem'), eq(auditLog.entityId, order.id)));
    expect(alerts).toHaveLength(1);

    await simulateCheckout(me, order.id, 'pay');
    [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order.status).toBe('paid');
    expect(order.stripeChargeId).toMatch(/^sim_ch_/);
    expect(await db.select().from(cartItems).where(eq(cartItems.standId, ex.stand.id))).toHaveLength(0);

    // VAT invoice, marked paid, readable by the exhibitor and the team but nobody else.
    const docs = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(docs).toHaveLength(1);
    expect(docs[0].number).toMatch(/^INV-\d{6}$/);
    const [pdf] = await db.select().from(files).where(eq(files.id, docs[0].fileId!));
    expect(pdf.mimeType).toBe('application/pdf');
    expect(await canReadFile(me, pdf)).toBe(true);
    expect(await canReadFile(adminActor, pdf)).toBe(true);
    expect(await canReadFile(furnitureCo.actor, pdf)).toBe(false);
    const stranger = await makeExhibitor(edition.id, shell.id);
    expect(await canReadFile(actorFor(stranger.user), pdf)).toBe(false);
    await expect(orderForExhibitor(actorFor(stranger.user), order.id)).rejects.toThrow();

    // The supplier is paid their share (£100 less 15%, plus VAT) from this charge.
    const [transfer] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, order.id));
    expect(transfer).toMatchObject({ supplierId: furnitureCo.supplier.id, amountPence: 10_200, status: 'created' });
    const tr = sim.calls.find((c) => c.method === 'createTransfer')!.args as { destination: string; sourceTransaction: string; amountPence: number };
    expect(tr).toMatchObject({ destination: furnitureCo.supplier.stripeAccountId, sourceTransaction: order.stripeChargeId, amountPence: 10_200 });

    // Emails and the order task.
    const exMail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, ex.user.email));
    expect(exMail.map((m) => m.subject)).toContain(`Order ${order.number} confirmed: ${edition.name}`);
    const supplierMail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, furnitureCo.supplier.email));
    expect(supplierMail.some((m) => m.subject.startsWith(`New order ${order.number}`))).toBe(true);
    expect(supplierMail.some((m) => m.text.includes('Daily clean'))).toBe(false);
    const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, task.id), eq(submissions.standId, ex.stand.id)));
    expect(sub.status).toBe('completed');

    // Paying again (a webhook after the return page) changes nothing.
    const again = await markOrderPaid(order.id, { paymentIntentId: order.stripePaymentIntentId, amountPence: order.totalPence, via: 'webhook' });
    expect(again.changed).toBe(false);
    expect(await db.select().from(invoices).where(eq(invoices.orderId, order.id))).toHaveLength(1);
    expect(sim.calls.filter((c) => c.method === 'createTransfer')).toHaveLength(1);
    expect(await confirmCheckoutReturn(me, order.id)).toBe('paid');

    // The supplier sees only their own lines, and can move them along; not other suppliers' lines.
    const theirs = await supplierOrders(furnitureCo.actor, furnitureCo.supplier.id);
    expect(theirs.lines.map((l) => l.description)).toEqual(['Chair']);
    expect(theirs.lines[0].contact?.email).toBe(ex.user.email);
    await setLineFulfilment(furnitureCo.actor, theirs.lines[0].id, 'confirmed');
    const cleanLine = (await db.select().from(orderLines).where(and(eq(orderLines.orderId, order.id), eq(orderLines.description, 'Daily clean'))))[0];
    await expect(setLineFulfilment(furnitureCo.actor, cleanLine.id, 'delivered')).rejects.toThrow();
    const rival = await makeSupplier('Rival AV');
    await expect(supplierOrders(rival.actor, furnitureCo.supplier.id)).rejects.toThrow();

    // Commission report: Media10 keeps 15% of furniture and all of its own cleaning.
    const report = await commissionReport(adminActor, edition.id);
    const furnitureRow = report.suppliers.find((r) => r.key === furnitureCo.supplier.id)!;
    expect(furnitureRow).toMatchObject({ commissionPence: 1500, payoutPence: 10_200 });
    expect(furnitureRow.transfers?.sent).toBe(10_200);
    expect(report.suppliers.find((r) => r.key === 'media10')?.commissionPence).toBe(4000);
    const csv = await exportOrdersCsv(adminActor, edition.id);
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain('PO-77');
  });

  it('refunds part then all of an order, taking the supplier’s share back in proportion', async () => {
    const { edition, shell, adminActor, chair, furniture } = await shopFixture();
    const task = await createTask(adminActor, edition.id, { title: 'Furniture', kind: 'order', linkedCategoryId: furniture.id, deadline: { mode: 'none' }, published: true, requirements: { [shell.id]: 'required' } });
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 2, options: { Colour: 'Black' } });
    const b = await basketForStand(me, ex.stand.id, 'card');
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: b.totals.totalPence });
    await simulateCheckout(me, placed.orderId, 'pay');
    const db = await getDb();
    const [line] = await db.select().from(orderLines).where(eq(orderLines.orderId, placed.orderId));
    // Two chairs: £50 + £10 VAT = £60; supplier payout (50 - 7.50) * 1.2 = £51.
    expect(line.supplierPayoutPence).toBe(5100);

    const viewer = await makeStaff(edition.id, 'show_team', ['view_reports']);
    await expect(refundOrder(actorFor(viewer), placed.orderId, { lines: [{ lineId: line.id, amountPence: 100 }], reason: 'Damaged' })).rejects.toThrow();
    await expect(refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 99_999 }], reason: 'Damaged' })).rejects.toThrow(/at most/);
    await expect(refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 3000 }], reason: '' })).rejects.toThrow();

    const first = await refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 3000 }], reason: 'One chair was damaged' });
    expect(first.creditNote).toMatch(/^CRN-\d{6}$/);
    expect(sim.calls.find((c) => c.method === 'refund')!.args).toMatchObject({ amountPence: 3000 });
    expect(sim.calls.find((c) => c.method === 'reverseTransfer')!.args).toMatchObject({ amountPence: 2550 });
    let [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order).toMatchObject({ status: 'partially_refunded', refundedPence: 3000 });
    let [transfer] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, placed.orderId));
    expect(transfer).toMatchObject({ reversedPence: 2550, status: 'partially_reversed' });
    expect((await db.select().from(submissions).where(and(eq(submissions.taskId, task.id), eq(submissions.standId, ex.stand.id))))[0].status).toBe('completed');

    // The rest of the line and the card fee: the order is fully refunded and the task is open again.
    const detail = await orderForStaff(adminActor, placed.orderId);
    await refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 3000 }], cardFeePence: detail.cardFeeRefundable, reason: 'Cancelled' });
    [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order.status).toBe('refunded');
    expect(order.refundedPence).toBe(order.totalPence);
    [transfer] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, placed.orderId));
    expect(transfer).toMatchObject({ reversedPence: 5100, status: 'reversed' });
    expect((await db.select().from(orderLines).where(eq(orderLines.id, line.id)))[0].fulfilmentStatus).toBe('cancelled');
    expect((await db.select().from(submissions).where(and(eq(submissions.taskId, task.id), eq(submissions.standId, ex.stand.id))))[0].status).toBe('draft');
    await expect(refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 1 }], reason: 'Again' })).rejects.toThrow();
    const notes = await db.select().from(invoices).where(and(eq(invoices.orderId, placed.orderId), eq(invoices.kind, 'credit_note')));
    expect(notes).toHaveLength(2);
    // Stock is free again.
    expect((await shopForStand(me, ex.stand.id)).categories[0].products[0].stockLeft).toBe(5);
  });

  it('holds payouts until the supplier finishes Stripe set-up, then sends them', async () => {
    const { edition, shell, adminActor } = await shopFixture();
    const newCo = await makeSupplier('New Supplier');
    const cat = await createCategory(adminActor, edition.id, { name: 'Plants', supplierId: newCo.supplier.id });
    const plant = await createProduct(adminActor, edition.id, { categoryId: cat.id, name: 'Fern', pricePence: 1000, vatRateBps: 2000 });
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: plant.id, quantity: 1 });
    const b = await basketForStand(me, ex.stand.id, 'card');
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: b.totals.totalPence });
    await simulateCheckout(me, placed.orderId, 'pay');
    const db = await getDb();
    let [t] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, placed.orderId));
    expect(t.status).toBe('pending');
    expect(t.error).toMatch(/Stripe/);

    const url = await startStripeOnboarding(newCo.actor, newCo.supplier.id);
    expect(url).toMatch(/^\/supplier\/test-onboarding\?account=acct_sim/);
    const rival = await makeSupplier('Other');
    await expect(startStripeOnboarding(rival.actor, newCo.supplier.id)).rejects.toThrow();
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, newCo.supplier.id));
    await expect(completeSimulatedOnboarding(rival.actor, s.stripeAccountId!)).rejects.toThrow();
    await completeSimulatedOnboarding(newCo.actor, s.stripeAccountId!);
    [t] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, placed.orderId));
    expect(t.status).toBe('created');
  });
});

describe('invoice orders', () => {
  it('invoices approved companies, records payment and manual payouts, and credits cancellations', async () => {
    const { edition, shell, adminActor, chair, furnitureCo } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    const db = await getDb();
    await db.update(companies).set({ invoiceAllowed: true }).where(eq(companies.id, ex.company.id));
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 2, options: { Colour: 'Black' } });
    const b = await basketForStand(me, ex.stand.id, 'invoice');
    expect(b.totals.cardFeePence).toBe(0);
    const placed = await checkout(me, ex.stand.id, { method: 'invoice', expectedTotalPence: b.totals.totalPence });
    expect(placed.redirectUrl).toBeNull();
    let [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order.status).toBe('invoiced');
    expect(order.dueAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await db.select().from(invoices).where(eq(invoices.orderId, order.id))).toHaveLength(1);
    expect(await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, order.id))).toHaveLength(0);
    expect((await supplierOrders(furnitureCo.actor, furnitureCo.supplier.id)).lines).toHaveLength(1);

    await expect(markInvoicePaid(adminActor, order.id, '')).rejects.toThrow(/reference/);
    await markInvoicePaid(adminActor, order.id, 'BACS 12345');
    [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order).toMatchObject({ status: 'paid', paymentReference: 'BACS 12345' });
    const [manual] = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, order.id));
    expect(manual).toMatchObject({ status: 'manual', amountPence: 5100 });
    await settleManualTransfer(adminActor, manual.id, 'Paid 1 June');
    expect((await db.select().from(supplierTransfers).where(eq(supplierTransfers.id, manual.id)))[0].settledAt).not.toBeNull();
    expect(sim.calls.filter((c) => c.method === 'createTransfer')).toHaveLength(0);

    // A second invoice order is cancelled before payment: full credit note, stock released.
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 3, options: { Colour: 'White' } });
    const b2 = await basketForStand(me, ex.stand.id, 'invoice');
    const second = await checkout(me, ex.stand.id, { method: 'invoice', expectedTotalPence: b2.totals.totalPence });
    expect((await shopForStand(me, ex.stand.id)).categories[0].products[0].stockLeft).toBe(0);
    await cancelOrder(adminActor, second.orderId, 'Exhibitor withdrew');
    const [cancelled] = await db.select().from(orders).where(eq(orders.id, second.orderId));
    expect(cancelled.status).toBe('cancelled');
    expect(await db.select().from(invoices).where(and(eq(invoices.orderId, second.orderId), eq(invoices.kind, 'credit_note')))).toHaveLength(1);
    expect((await shopForStand(me, ex.stand.id)).categories[0].products[0].stockLeft).toBe(3);
    await expect(cancelOrder(adminActor, placed.orderId, 'Too late')).rejects.toThrow(/refunded rather than cancelled/);
  });
});

describe('stock and abandoned checkouts', () => {
  it('never sells more than the stock, and releases checkouts left unpaid', async () => {
    const { edition, shell, chair } = await shopFixture();
    const a = await makeExhibitor(edition.id, shell.id);
    const b = await makeExhibitor(edition.id, shell.id);
    await addToBasket(actorFor(a.user), a.stand.id, { productId: chair.id, quantity: 4, options: { Colour: 'Black' } });
    await addToBasket(actorFor(b.user), b.stand.id, { productId: chair.id, quantity: 3, options: { Colour: 'Black' } });
    const aTotal = (await basketForStand(actorFor(a.user), a.stand.id)).totals.totalPence;
    const bTotal = (await basketForStand(actorFor(b.user), b.stand.id)).totals.totalPence;
    const first = await checkout(actorFor(a.user), a.stand.id, { method: 'card', expectedTotalPence: aTotal });
    await expect(checkout(actorFor(b.user), b.stand.id, { method: 'card', expectedTotalPence: bTotal })).rejects.toThrow(/sold out/);

    // A's checkout is abandoned; once it is old enough it is released and B can buy.
    const db = await getDb();
    await db.update(orders).set({ createdAt: new Date(Date.now() - PENDING_ORDER_TTL_MS - 1000) }).where(eq(orders.id, first.orderId));
    expect((await expireStaleOrders()).cancelled).toBe(1);
    expect((await db.select().from(orders).where(eq(orders.id, first.orderId)))[0].status).toBe('cancelled');
    const placed = await checkout(actorFor(b.user), b.stand.id, { method: 'card', expectedTotalPence: bTotal });
    expect(placed.redirectUrl).toBeTruthy();
    // A starting a new checkout closes any earlier open one first, so nothing is paid twice.
    const again = await checkout(actorFor(b.user), b.stand.id, { method: 'card', expectedTotalPence: bTotal });
    expect((await db.select().from(orders).where(eq(orders.id, placed.orderId)))[0].status).toBe('cancelled');
    expect(sim.calls.some((c) => c.method === 'expireCheckout')).toBe(true);
    expect(again.orderId).not.toBe(placed.orderId);
  });
});

describe('Stripe webhooks', () => {
  it('marks orders paid once, ignores sessions it did not create, and syncs supplier accounts', async () => {
    const { edition, shell, chair } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1, options: { Colour: 'Black' } });
    const total = (await basketForStand(me, ex.stand.id)).totals.totalPence;
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: total });
    const db = await getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));

    const event = (id: string, obj: Record<string, unknown>, type = 'checkout.session.completed') => ({ id, type, data: { object: obj } });
    // A session for another order id is ignored.
    await handleStripeEvent(event('evt_1', { id: order.stripeCheckoutSessionId, client_reference_id: '00000000-0000-0000-0000-000000000001', payment_status: 'paid', amount_total: total, currency: 'gbp', payment_intent: 'pi_1' }));
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('pending_payment');
    const good = event('evt_2', { id: order.stripeCheckoutSessionId, client_reference_id: order.id, payment_status: 'paid', amount_total: total, currency: 'gbp', payment_intent: 'pi_2' });
    expect(await handleStripeEvent(good)).toEqual({ duplicate: false });
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]).toMatchObject({ status: 'paid', stripePaymentIntentId: 'pi_2' });
    expect(await handleStripeEvent(good)).toEqual({ duplicate: true });
    const [recorded] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_2'));
    expect(recorded.processedAt).not.toBeNull();

    const late = await makeSupplier('Late Supplier');
    await db.update(suppliers).set({ stripeAccountId: 'acct_late' }).where(eq(suppliers.id, late.supplier.id));
    await handleStripeEvent(event('evt_3', { id: 'acct_late', charges_enabled: true, payouts_enabled: true, details_submitted: true }, 'account.updated'));
    expect((await db.select().from(suppliers).where(eq(suppliers.id, late.supplier.id)))[0].stripePayoutsEnabled).toBe(true);
  });
});

describe('editing products keeps placed orders unchanged', () => {
  it('snapshots prices on the order', async () => {
    const { edition, shell, adminActor, chair, furniture } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1, options: { Colour: 'Black' } });
    const total = (await basketForStand(me, ex.stand.id)).totals.totalPence;
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: total });
    await simulateCheckout(me, placed.orderId, 'pay');
    await updateProduct(adminActor, chair.id, { categoryId: furniture.id, name: 'Chair (new)', pricePence: 9999, vatRateBps: 2000, options: [{ name: 'Colour', values: ['Black'] }] });
    const view = await orderForExhibitor(me, placed.orderId);
    expect(view.lines[0]).toMatchObject({ description: 'Chair', unitPricePence: 2500 });
    expect(view).not.toHaveProperty('transfers');
    expect(JSON.stringify(view)).not.toContain('commission');
    const db = await getDb();
    expect((await db.select().from(products).where(eq(products.id, chair.id)))[0].pricePence).toBe(9999);
    expect((await db.select().from(editions).where(eq(editions.id, edition.id)))[0].id).toBe(edition.id);
  });
});

describe('payment safety', () => {
  it('never runs the payment simulator on a live web address', () => {
    const saved = { ...process.env };
    try {
      setPaymentsForTests(null);
      Object.assign(process.env, { NODE_ENV: 'production', BLUEPRINT_ALLOW_LOCAL_PRODUCTION: 'true', STRIPE_SECRET_KEY: '' });
      // On a real address the local-trial switch does nothing: the site will not even start without its settings.
      process.env.APP_URL = 'https://blueprint.media10.co.uk';
      resetEnvCache();
      resetPaymentsForTests();
      expect(() => payments()).toThrow(/Missing required production settings/);
      // Only on this computer does the simulator stand in for Stripe.
      process.env.APP_URL = 'http://localhost:3000';
      resetEnvCache();
      resetPaymentsForTests();
      expect(payments()?.kind).toBe('simulator');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetEnvCache();
      resetPaymentsForTests();
    }
  });

  it('does not let two refunds take the same money twice', async () => {
    const { edition, shell, adminActor, chair } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 2, options: { Colour: 'Black' } });
    const total = (await basketForStand(me, ex.stand.id)).totals.totalPence;
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: total });
    await simulateCheckout(me, placed.orderId, 'pay');
    const db = await getDb();
    const [line] = await db.select().from(orderLines).where(eq(orderLines.orderId, placed.orderId));
    const results = await Promise.allSettled([
      refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 4000 }], reason: 'First' }),
      refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 4000 }], reason: 'Second' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order.refundedPence).toBe(4000);
  });
});

describe('refunds confirmed by Stripe', () => {
  it('applies each refund exactly once, even when Stripe’s webhook arrives too', async () => {
    const { edition, shell, adminActor, chair } = await shopFixture();
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 2, options: { Colour: 'Black' } });
    const total = (await basketForStand(me, ex.stand.id)).totals.totalPence;
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: total });
    await simulateCheckout(me, placed.orderId, 'pay');
    const db = await getDb();
    const [line] = await db.select().from(orderLines).where(eq(orderLines.orderId, placed.orderId));
    const { refundId } = await refundOrder(adminActor, placed.orderId, { lines: [{ lineId: line.id, amountPence: 1000 }], reason: 'Scratched' });
    const [made] = await db.select().from(refunds).where(eq(refunds.id, refundId));
    expect(made.appliedAt).not.toBeNull();
    await handleStripeEvent({ id: `evt_r_${refundId}`, type: 'refund.updated', data: { object: { id: made.stripeRefundId, status: 'succeeded', metadata: { blueprintRefundId: refundId } } } });
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order.refundedPence).toBe(1000);
    expect(await db.select().from(invoices).where(and(eq(invoices.orderId, placed.orderId), eq(invoices.kind, 'credit_note')))).toHaveLength(1);

    // If BluePrint stopped after Stripe made a refund but before recording it, the webhook finishes the job.
    const [orphan] = await db
      .insert(refunds)
      .values({ orderId: placed.orderId, amountPence: 2000, lineAmounts: { [line.id]: 2000 }, reason: 'Second chair', status: 'pending' })
      .returning();
    await handleStripeEvent({ id: `evt_r_${orphan.id}`, type: 'refund.updated', data: { object: { id: 're_sim_orphan', status: 'succeeded', metadata: { blueprintRefundId: orphan.id } } } });
    const [after] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(after.refundedPence).toBe(3000);
    const [done] = await db.select().from(refunds).where(eq(refunds.id, orphan.id));
    expect(done).toMatchObject({ status: 'succeeded', stripeRefundId: 're_sim_orphan' });
    expect(done.appliedAt).not.toBeNull();
    expect(await db.select().from(invoices).where(and(eq(invoices.orderId, placed.orderId), eq(invoices.kind, 'credit_note')))).toHaveLength(2);
    // ...and only once.
    await handleStripeEvent({ id: `evt_r2_${orphan.id}`, type: 'refund.updated', data: { object: { id: 're_sim_orphan', status: 'succeeded' } } });
    expect((await db.select().from(orders).where(eq(orders.id, placed.orderId)))[0].refundedPence).toBe(3000);

    // If Stripe later says a refund failed, the orders team is told to repay the exhibitor another way.
    const ordersTeam = await makeStaff(edition.id, 'show_team', ['manage_orders']);
    await handleStripeEvent({ id: `evt_rf_${refundId}`, type: 'refund.failed', data: { object: { id: made.stripeRefundId, status: 'failed', metadata: { blueprintRefundId: refundId } } } });
    const [failed] = await db.select().from(refunds).where(eq(refunds.id, refundId));
    expect(failed.status).toBe('failed');
    const alert = await lastEmailTo(ordersTeam.email);
    expect(alert?.subject).toMatch(/^A card refund failed: ORD-/);
    expect(alert?.text).toContain('another way');
  });
});
