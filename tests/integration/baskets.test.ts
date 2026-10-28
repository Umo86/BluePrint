import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { cartItems, editions, emailOutbox, reminderLog } from '@/server/db/schema';
import { SimulatedPayments, setPaymentsForTests } from '@/server/payments/provider';
import { createCategory, createProduct } from '@/server/services/catalogue';
import { addToBasket, basketForStand, checkout, removeBasketItem, updateBasketItem } from '@/server/services/shop';
import { basketNudge, basketReminderSettings, basketsForStaff, dueBasketReminder, runBasketReminders, sendBasketReminderNow, updateBasketReminderSettings } from '@/server/services/baskets';
import { runStaffDigest } from '@/server/services/reminders';
import { actorFor, makeEdition, makeExhibitor, makeStaff } from '../support/factories';

const DAY = 86_400_000;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
beforeEach(() => setPaymentsForTests(new SimulatedPayments()));
afterEach(() => setPaymentsForTests(null));

/** A live show with chairs on an early-bird price until 30 days before build-up (60 days away). */
async function fixture() {
  const { edition, shell } = await makeEdition();
  const adminUser = await makeStaff(edition.id, 'show_admin');
  const admin = actorFor(adminUser);
  const furniture = await createCategory(admin, edition.id, { name: 'Furniture' });
  const chair = await createProduct(admin, edition.id, { categoryId: furniture.id, name: 'Chair', pricePence: 2500, vatRateBps: 2000, earlyPricePence: 2000, earlyUntilOffsetDays: 30 });
  const ex = await makeExhibitor(edition.id, shell.id);
  return { edition, shell, admin, furniture, chair, ex, me: actorFor(ex.user) };
}

/** Moves a stand's basket back in time, as if it had been left there. */
async function leftAgo(standId: string, days: number) {
  const db = await getDb();
  const at = new Date(Date.now() - days * DAY);
  await db.update(cartItems).set({ createdAt: at, updatedAt: at }).where(eq(cartItems.standId, standId));
}

async function basketEmailsTo(email: string) {
  const db = await getDb();
  return db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, email.toLowerCase()), eq(emailOutbox.templateKey, 'basket_reminder')));
}

describe('basket reminders', () => {
  it('reminds the morning after, then a few days later, and no more', async () => {
    const { edition, chair, ex, me } = await fixture();
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 2 });

    // Too soon: nothing yet.
    await runBasketReminders();
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(0);

    // Left for a day: the first reminder lists the basket, its total and the early-bird deadline.
    await leftAgo(ex.stand.id, 1);
    await runBasketReminders();
    const [first] = await basketEmailsTo(ex.user.email);
    expect(first.subject).toBe(`${edition.name}: your basket for stand ${ex.stand.number} is waiting`);
    expect(first.text).toContain('2 × Chair: £48.00');
    expect(first.text).toContain('Total £48.00 including VAT');
    expect(first.text).toContain('Early-bird prices end on');
    expect(first.text).toContain(`/portal/${edition.slug}/shop/basket`);
    // Running again the same morning sends nothing more.
    await runBasketReminders();
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(1);

    // Four days after it was left: the second reminder. After that, no more.
    await runBasketReminders(new Date(Date.now() + 3 * DAY));
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(2);
    await runBasketReminders(new Date(Date.now() + 10 * DAY));
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(2);

    // Changing the basket starts again: nothing until it has been left for another day.
    await updateBasketItem(me, ex.stand.id, (await basketForStand(me, ex.stand.id)).items[0].itemId, 3);
    await runBasketReminders();
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(2);
    await runBasketReminders(new Date(Date.now() + DAY));
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(3);
  });

  it('stops once they order, and skips baskets being paid for right now', async () => {
    const { chair, ex, me, edition } = await fixture();
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1 });
    await leftAgo(ex.stand.id, 2);
    // A card checkout in progress: leave them alone.
    const b = await basketForStand(me, ex.stand.id, 'card');
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: b.totals.totalPence });
    await runBasketReminders();
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(0);
    const team = await basketsForStaff(actorFor(await makeStaff(edition.id, 'show_team', ['manage_orders'])), edition.id);
    expect(team.rows[0]).toMatchObject({ payingNow: true, nextReminderAt: null });
    // Paying empties the basket, so nothing is left to remind them about.
    const { simulateCheckout } = await import('@/server/services/shop');
    await simulateCheckout(me, placed.orderId, 'pay');
    await runBasketReminders(new Date(Date.now() + 2 * DAY));
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(0);
    expect((await basketsForStaff(actorFor(await makeStaff(edition.id, 'show_admin')), edition.id)).rows).toHaveLength(0);
  });

  it('follows each show’s settings', async () => {
    const { edition, admin, chair, ex, me } = await fixture();
    const settings = basketReminderSettings(edition);
    expect(settings).toEqual({ enabled: true, firstAfterDays: 1, secondAfterDays: 4 });
    // Exhibitor services can change them; the second reminder must come after the first.
    const viewer = actorFor(await makeStaff(edition.id, 'show_team', ['view_reports']));
    await expect(updateBasketReminderSettings(viewer, edition.id, { enabled: false, firstAfterDays: 1, secondAfterDays: 0 })).rejects.toThrow(/permission/);
    await expect(updateBasketReminderSettings(admin, edition.id, { enabled: true, firstAfterDays: 3, secondAfterDays: 2 })).rejects.toThrow(/after the first/);
    await updateBasketReminderSettings(admin, edition.id, { enabled: false, firstAfterDays: 2, secondAfterDays: 0 });
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1 });
    await leftAgo(ex.stand.id, 5);
    await runBasketReminders();
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(0);
    await updateBasketReminderSettings(admin, edition.id, { enabled: true, firstAfterDays: 2, secondAfterDays: 0 });
    await runBasketReminders();
    await runBasketReminders(new Date(Date.now() + 5 * DAY));
    // Only one: there is no second reminder.
    expect(await basketEmailsTo(ex.user.email)).toHaveLength(1);
    const db = await getDb();
    const [e] = await db.select().from(editions).where(eq(editions.id, edition.id));
    expect(basketReminderSettings(e)).toEqual({ enabled: true, firstAfterDays: 2, secondAfterDays: 0 });
  });

  it('works out the timing: the next morning, then days later, never twice in a day', () => {
    const s = { enabled: true, firstAfterDays: 1, secondAfterDays: 4 };
    const left = new Date('2027-03-01T09:00:00Z');
    // Left at 9am; the 8am run the next day is 23 hours later and counts as the morning after.
    expect(dueBasketReminder(s, left, [], new Date('2027-03-02T08:00:00Z'))).toBe('r1');
    expect(dueBasketReminder(s, left, [], new Date('2027-03-01T20:00:00Z'))).toBeNull();
    const first = [{ at: new Date('2027-03-02T08:00:00Z') }];
    expect(dueBasketReminder(s, left, first, new Date('2027-03-04T08:00:00Z'))).toBeNull();
    expect(dueBasketReminder(s, left, first, new Date('2027-03-05T08:00:00Z'))).toBe('r2');
    expect(dueBasketReminder(s, left, [...first, { at: new Date('2027-03-05T08:00:00Z') }], new Date('2027-03-20T08:00:00Z'))).toBeNull();
    expect(dueBasketReminder({ ...s, enabled: false }, left, [], new Date('2027-03-09T08:00:00Z'))).toBeNull();
  });

  it('lets the team see open baskets and send a reminder now, and counts orders that followed', async () => {
    const { edition, admin, chair, ex, me } = await fixture();
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 4 });
    // A colleague's item: the reminder goes to the people who filled the basket.
    const list = await basketsForStaff(admin, edition.id);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ standNumber: ex.stand.number, totalPence: 9600, reminders: [] });
    expect(list.rows[0].items[0]).toMatchObject({ name: 'Chair', quantity: 4 });
    expect(list.rows[0].addedBy[0].email).toBe(ex.user.email);
    expect(list.totals).toMatchObject({ baskets: 1, valuePence: 9600, recoveredOrders: 0 });

    // Reports only: they can see the list but not send.
    const viewer = actorFor(await makeStaff(edition.id, 'show_team', ['view_reports']));
    expect((await basketsForStaff(viewer, edition.id)).canManage).toBe(false);
    await expect(sendBasketReminderNow(viewer, edition.id, ex.stand.id)).rejects.toThrow(/permission/);
    // Someone from another show cannot see it.
    const other = await makeEdition();
    const stranger = actorFor(await makeStaff(other.edition.id, 'show_admin'));
    await expect(basketsForStaff(stranger, edition.id)).rejects.toThrow();
    await expect(sendBasketReminderNow(stranger, edition.id, ex.stand.id)).rejects.toThrow();

    // Sent now; not again within 12 hours.
    expect(await sendBasketReminderNow(admin, edition.id, ex.stand.id)).toEqual({ emails: 1, recipients: 1 });
    await expect(sendBasketReminderNow(admin, edition.id, ex.stand.id)).rejects.toThrow(/12 hours/);
    const after = await basketsForStaff(admin, edition.id);
    expect(after.rows[0].reminders).toHaveLength(1);
    expect(after.rows[0].reminders[0].manual).toBe(true);
    expect(after.totals.remindersLast30Days).toBe(1);

    // They order: it counts as an order placed after a reminder.
    const b = await basketForStand(me, ex.stand.id, 'card');
    const placed = await checkout(me, ex.stand.id, { method: 'card', expectedTotalPence: b.totals.totalPence });
    const { simulateCheckout } = await import('@/server/services/shop');
    await simulateCheckout(me, placed.orderId, 'pay');
    const done = await basketsForStaff(admin, edition.id);
    expect(done.rows).toHaveLength(0);
    expect(done.totals.recoveredOrders).toBe(1);
    expect(done.totals.recoveredPence).toBe(b.totals.totalPence);
  });

  it('nudges the exhibitor on their home page, and tells the team in the morning summary', async () => {
    const { edition, chair, ex, me, shell } = await fixture();
    expect(await basketNudge(me, ex.stand.id)).toBeNull();
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1 });
    const nudge = await basketNudge(me, ex.stand.id);
    expect(nudge).toMatchObject({ items: 1, totalPence: 2400 });
    expect(nudge?.next?.what).toBe('Early-bird prices end');
    // Another exhibitor cannot look at it.
    const other = await makeExhibitor(edition.id, shell.id);
    await expect(basketNudge(actorFor(other.user), ex.stand.id)).rejects.toThrow();
    // Removing the last item: nothing to nudge about.
    const item = (await basketForStand(me, ex.stand.id)).items[0];
    await removeBasketItem(me, ex.stand.id, item.itemId);
    expect(await basketNudge(me, ex.stand.id)).toBeNull();

    // Left for two days: the team's morning summary mentions it.
    await addToBasket(me, ex.stand.id, { productId: chair.id, quantity: 1 });
    await leftAgo(ex.stand.id, 2);
    const ops = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    await runStaffDigest();
    const db = await getDb();
    const [summary] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, ops.email), eq(emailOutbox.templateKey, 'staff_digest')));
    expect(summary.text).toContain('1 exhibitor has left services in their basket for more than a day without ordering.');
    // The reminder log only ever holds basket reminders under "basket:".
    expect(await db.select().from(reminderLog).where(like(reminderLog.subject, 'basket:%'))).toBeDefined();
  });
});
