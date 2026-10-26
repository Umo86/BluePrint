import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { cartItems, companies, companyMembers, files, orderLines, suppliers, supplierUsers } from '@/server/db/schema';
import { MemoryStorage, setStorageForTests } from '@/server/storage';
import { SimulatedPayments, setPaymentsForTests } from '@/server/payments/provider';
import { catalogueForStaff, createCategory, createProduct, updateProduct } from '@/server/services/catalogue';
import { addToBasket, basketForStand, checkout, shopForStand } from '@/server/services/shop';
import { exportOrdersCsv, orderForExhibitor, supplierOrdersCsv } from '@/server/services/orders';
import { beginUpload, canReadFile, completeUpload, getFile, purgeUnusedOrderFiles, receiveLocalUpload } from '@/server/services/files';
import { typeFromName } from '@/lib/upload-rules';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';
import type { Actor } from '@/server/auth/actor';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
beforeEach(() => {
  setStorageForTests(new MemoryStorage());
  setPaymentsForTests(new SimulatedPayments());
});
afterEach(() => {
  setStorageForTests(null);
  setPaymentsForTests(null);
});

async function upload(actor: Actor, standId: string, opts: { purpose?: 'order' | 'submission'; name?: string; type?: string } = {}) {
  const b = await beginUpload(actor, { purpose: opts.purpose ?? 'order', filename: opts.name ?? 'artwork.pdf', contentType: opts.type ?? 'application/pdf', size: PDF.length, standId });
  await receiveLocalUpload(actor, b.fileId, new Uint8Array(PDF));
  return completeUpload(actor, b.fileId);
}

async function makeSupplier(name: string) {
  const db = await getDb();
  const [s] = await db.insert(suppliers).values({ name, email: `${name.toLowerCase().replace(/\W+/g, '')}@supplier.example` }).returning();
  const user = await makeUser({ name: `${name} user` });
  await db.insert(supplierUsers).values({ supplierId: s.id, userId: user.id });
  return { supplier: s, user, actor: actorFor(user) };
}

/** A show whose graphics supplier sells a printed panel that needs the exhibitor's artwork. */
async function graphicsShop() {
  const { edition, shell } = await makeEdition();
  const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
  const printer = await makeSupplier(`Printer ${Math.random().toString(36).slice(2, 6)}`);
  const graphics = await createCategory(admin, edition.id, { name: 'Graphics', supplierId: printer.supplier.id });
  const panel = await createProduct(admin, edition.id, {
    categoryId: graphics.id,
    name: 'Printed panel',
    pricePence: 20_000,
    vatRateBps: 2000,
    requiredDetails: [
      { id: 'artwork', label: 'Artwork', type: 'file', required: true },
      { id: 'notes', label: 'Notes for the printer', type: 'text' },
    ],
  });
  const ex = await makeExhibitor(edition.id, shell.id);
  const db = await getDb();
  await db.update(companies).set({ invoiceAllowed: true }).where(eq(companies.id, ex.company.id));
  return { edition, shell, admin, printer, panel, ex, me: actorFor(ex.user) };
}

describe('files sent with an order', () => {
  it('accepts print artwork, going by the name when the browser gives no type', async () => {
    expect(typeFromName('logo.AI')).toBe('application/postscript');
    expect(typeFromName('panel.tiff')).toBe('image/tiff');
    expect(typeFromName('notes.svg')).toBeNull();
    const { ex, me } = await graphicsShop();
    // An Illustrator file saved with PDF compatibility reads as a PDF once its bytes are checked.
    const ai = await upload(me, ex.stand.id, { name: 'stand-logo.ai', type: '' });
    expect(ai.mimeType).toBe('application/pdf');
    await expect(beginUpload(me, { purpose: 'order', filename: 'art.svg', contentType: 'image/svg+xml', size: 10, standId: ex.stand.id })).rejects.toThrow(/isn’t accepted/);
    // Only people who act for the stand can upload for it.
    const stranger = await makeExhibitor((await makeEdition()).edition.id, ex.stand.exhibitorTypeId);
    await expect(beginUpload(actorFor(stranger.user), { purpose: 'order', filename: 'a.pdf', contentType: 'application/pdf', size: 10, standId: ex.stand.id })).rejects.toThrow();
  });

  it('needs the artwork before the item goes in the basket, and only takes the person’s own upload for this stand', async () => {
    const { edition, shell, panel, ex, me } = await graphicsShop();
    await expect(addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1 })).rejects.toThrow(/Upload: Artwork/);
    // Someone else's upload, another kind of upload, or nonsense are all refused.
    const other = await makeExhibitor(edition.id, shell.id);
    const theirs = await upload(actorFor(other.user), other.stand.id);
    await expect(addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1, details: { artwork: theirs.id } })).rejects.toThrow(/upload it again/);
    const formFile = await upload(me, ex.stand.id, { purpose: 'submission' });
    await expect(addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1, details: { artwork: formFile.id } })).rejects.toThrow(/upload it again/);
    await expect(addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1, details: { artwork: 'not-a-file' } })).rejects.toThrow(/upload it again/);

    const art = await upload(me, ex.stand.id, { name: 'Panel artwork.pdf' });
    await addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1, details: { artwork: art.id, notes: 'Matt finish' } });
    const db = await getDb();
    const [item] = await db.select().from(cartItems).where(eq(cartItems.standId, ex.stand.id));
    expect(item.details).toEqual({ artwork: { file: art.id, name: 'Panel artwork.pdf' }, notes: 'Matt finish' });
    const basket = await basketForStand(me, ex.stand.id);
    expect(basket.items[0].details).toEqual({ Artwork: { file: art.id, name: 'Panel artwork.pdf' }, 'Notes for the printer': 'Matt finish' });
  });

  it('lets the supplier open the artwork once the order is placed, and nobody outside the order', async () => {
    const { edition, shell, panel, printer, ex, me } = await graphicsShop();
    const art = await upload(me, ex.stand.id);
    await addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 2, details: { artwork: art.id } });
    const file = (await getFile(art.id))!;
    // In the basket it is still the exhibitor's alone.
    expect(await canReadFile(printer.actor, file)).toBe(false);

    const b = await basketForStand(me, ex.stand.id, 'invoice');
    await checkout(me, ex.stand.id, { method: 'invoice', expectedTotalPence: b.totals.totalPence });
    const db = await getDb();
    const lines = await db.select().from(orderLines).where(eq(orderLines.supplierId, printer.supplier.id));
    expect(lines[0].details).toEqual({ Artwork: { file: art.id, name: 'artwork.pdf' } });

    expect(await canReadFile(printer.actor, file)).toBe(true);
    expect(await canReadFile(me, file)).toBe(true);
    const colleague = await makeUser();
    await db.insert(companyMembers).values({ companyId: ex.company.id, userId: colleague.id, role: 'colleague' });
    expect(await canReadFile(actorFor(colleague), file)).toBe(true);
    // A different supplier, another exhibitor, and staff without order rights cannot.
    const rival = await makeSupplier('Rival Print');
    expect(await canReadFile(rival.actor, file)).toBe(false);
    const other = await makeExhibitor(edition.id, shell.id);
    expect(await canReadFile(actorFor(other.user), file)).toBe(false);
    expect(await canReadFile(actorFor(await makeStaff(edition.id, 'show_team', ['manage_orders'])), file)).toBe(true);
    expect(await canReadFile(actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors'])), file)).toBe(false);
    expect(await canReadFile(actorFor(await makeStaff(edition.id, 'hs_reviewer')), file)).toBe(false);

    // The supplier's download names the file.
    const csv = await supplierOrdersCsv(printer.actor, printer.supplier.id, null);
    expect(csv).toContain('Artwork: artwork.pdf (uploaded file)');
  });

  it('tidies away artwork that never became part of an order', async () => {
    const { panel, ex, me } = await graphicsShop();
    const ordered = await upload(me, ex.stand.id, { name: 'ordered.pdf' });
    const dropped = await upload(me, ex.stand.id, { name: 'dropped.pdf' });
    const recent = await upload(me, ex.stand.id, { name: 'recent.pdf' });
    await addToBasket(me, ex.stand.id, { productId: panel.id, quantity: 1, details: { artwork: ordered.id } });
    const db = await getDb();
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    for (const f of [ordered, dropped]) await db.update(files).set({ createdAt: old }).where(eq(files.id, f.id));
    const r = await purgeUnusedOrderFiles();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect((await getFile(dropped.id))?.deletedAt).not.toBeNull();
    expect((await getFile(ordered.id))?.deletedAt).toBeNull();
    expect((await getFile(recent.id))?.deletedAt).toBeNull();
  });
});

describe('product codes', () => {
  it('shows the supplier’s code in the shop and carries it onto the order and downloads', async () => {
    const { edition, admin, printer, ex, me } = await graphicsShop();
    const graphics = (await catalogueForStaff(admin, edition.id)).categories.find((c) => c.name === 'Graphics')!;
    await expect(createProduct(admin, edition.id, { categoryId: graphics.id, name: 'Banner', code: '<b>', pricePence: 100, vatRateBps: 2000 })).rejects.toThrow();
    await expect(createProduct(admin, edition.id, { categoryId: graphics.id, name: 'Banner', code: 'X'.repeat(41), pricePence: 100, vatRateBps: 2000 })).rejects.toThrow();
    const banner = await createProduct(admin, edition.id, { categoryId: graphics.id, name: 'Roller banner', code: 'RB-850/2', pricePence: 9_000, vatRateBps: 2000 });
    const shop = await shopForStand(me, ex.stand.id);
    expect(shop.categories.flatMap((c) => c.products).find((p) => p.name === 'Roller banner')?.code).toBe('RB-850/2');
    await addToBasket(me, ex.stand.id, { productId: banner.id, quantity: 1 });
    const b = await basketForStand(me, ex.stand.id, 'invoice');
    expect(b.items[0].code).toBe('RB-850/2');
    const placed = await checkout(me, ex.stand.id, { method: 'invoice', expectedTotalPence: b.totals.totalPence });
    const view = await orderForExhibitor(me, placed.orderId);
    expect(view.lines[0].productCode).toBe('RB-850/2');
    expect(await supplierOrdersCsv(printer.actor, printer.supplier.id, null)).toContain('RB-850/2');
    expect(await exportOrdersCsv(admin, edition.id)).toContain('RB-850/2');
    // Changing the code later does not rewrite orders already placed.
    await updateProduct(admin, banner.id, { categoryId: graphics.id, name: 'Roller banner', code: 'RB-NEW', pricePence: 9_000, vatRateBps: 2000 });
    expect((await orderForExhibitor(me, placed.orderId)).lines[0].productCode).toBe('RB-850/2');
  });
});
