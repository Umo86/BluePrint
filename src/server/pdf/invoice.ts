import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fit, hexToRgb, safe, wrap } from './text';

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPence: number;
  vatRateBps: number;
  netPence: number;
  vatPence: number;
};

export type InvoiceDocument = {
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: Date;
  /** The date of supply for VAT: when a card order was paid, or when the invoice was issued. */
  taxPointAt: Date;
  dueAt: Date | null;
  /** Shows a PAID mark and no payment instructions. */
  paid: boolean;
  /** Credit notes: the invoice being credited. */
  creditFor: string | null;
  reason: string | null;
  seller: { legalName: string; address: string; vatNumber: string; companyNumber: string; email: string; phone: string };
  buyer: { name: string; address: string[]; vatNumber: string | null; contact: string | null };
  show: { name: string; venue: string | null; standNumber: string; hall: string | null };
  orderNumber: string;
  poNumber: string | null;
  lines: InvoiceLine[];
  cardFeePence: number;
  totalPence: number;
  paymentInstructions: string | null;
  footer: string | null;
  brandColor: string | null;
};

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

const money = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const pct = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;

type Ctx = { pdf: PDFDocument; page: PDFPage; y: number; font: PDFFont; bold: PDFFont; brand: ReturnType<typeof rgb>; doc: InvoiceDocument };

function text(c: Ctx, value: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right'; maxWidth?: number } = {}) {
  const size = opts.size ?? 9.5;
  const font = opts.bold ? c.bold : c.font;
  const s = opts.maxWidth ? fit(value, font, size, opts.maxWidth) : safe(value);
  const width = font.widthOfTextAtSize(s, size);
  c.page.drawText(s, { x: opts.align === 'right' ? x - width : x, y, size, font, color: opts.color ?? INK });
}

function newPage(c: Ctx) {
  c.page = c.pdf.addPage([W, H]);
  c.y = H - M;
  text(c, `${c.doc.kind === 'invoice' ? 'Invoice' : 'Credit note'} ${c.doc.number} (continued)`, M, c.y, { size: 9, color: MUTED });
  c.y -= 24;
}

function ensure(c: Ctx, needed: number) {
  if (c.y - needed < M + 40) {
    newPage(c);
    return true;
  }
  return false;
}

// Table columns: description, quantity, unit price, VAT rate, net amount.
const COL = { desc: M, qty: 340, unit: 410, vat: 465, net: W - M };

function tableHeader(c: Ctx) {
  c.page.drawRectangle({ x: M, y: c.y - 6, width: W - 2 * M, height: 20, color: rgb(0.95, 0.96, 0.97) });
  text(c, 'Description', COL.desc + 6, c.y, { bold: true, size: 9 });
  text(c, 'Qty', COL.qty, c.y, { bold: true, size: 9, align: 'right' });
  text(c, 'Unit price', COL.unit + 12, c.y, { bold: true, size: 9, align: 'right' });
  text(c, 'VAT', COL.vat + 12, c.y, { bold: true, size: 9, align: 'right' });
  text(c, 'Net', COL.net - 6, c.y, { bold: true, size: 9, align: 'right' });
  c.y -= 22;
}

/** Renders a VAT invoice or credit note as an A4 PDF. The organiser is the seller on every document. */
export async function renderInvoice(doc: InvoiceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const title = doc.kind === 'invoice' ? 'Invoice' : 'Credit note';
  pdf.setTitle(`${title} ${safe(doc.number)}`);
  pdf.setAuthor(safe(doc.seller.legalName));
  pdf.setCreator('BluePrint');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { pdf, page: pdf.addPage([W, H]), y: H - M, font, bold, brand: hexToRgb(doc.brandColor), doc };

  // Header band
  c.page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: c.brand });
  text(c, doc.seller.legalName, M, c.y - 10, { size: 16, bold: true, maxWidth: 300 });
  text(c, doc.kind === 'invoice' ? 'VAT INVOICE' : 'CREDIT NOTE', W - M, c.y - 10, { size: 18, bold: true, align: 'right', color: c.brand });
  c.y -= 28;
  const sellerLines = [...doc.seller.address.split(/\r?\n/).filter(Boolean), [doc.seller.email, doc.seller.phone].filter(Boolean).join('  ·  ')].filter(Boolean);
  let sy = c.y;
  for (const l of sellerLines.slice(0, 6)) {
    text(c, l, M, sy, { size: 9, color: MUTED, maxWidth: 280 });
    sy -= 12;
  }
  if (doc.seller.vatNumber) {
    text(c, `VAT registration number: ${doc.seller.vatNumber}`, M, sy, { size: 9, color: MUTED });
    sy -= 12;
  }

  // Document details (right)
  const meta: [string, string][] = [
    [doc.kind === 'invoice' ? 'Invoice number' : 'Credit note number', doc.number],
    ['Date issued', day(doc.issuedAt)],
    ['Tax point', day(doc.taxPointAt)],
    ...(doc.creditFor ? ([['Credits invoice', doc.creditFor]] as [string, string][]) : []),
    ['Order', doc.orderNumber],
    ...(doc.poNumber ? ([['Your PO number', doc.poNumber]] as [string, string][]) : []),
    ...(doc.dueAt && !doc.paid && doc.kind === 'invoice' ? ([['Payment due', day(doc.dueAt)]] as [string, string][]) : []),
  ];
  let my = c.y;
  for (const [k, v] of meta) {
    text(c, k, 380, my, { size: 9, color: MUTED });
    text(c, v, W - M, my, { size: 9, bold: true, align: 'right', maxWidth: 120 });
    my -= 13;
  }
  c.y = Math.min(sy, my) - 18;

  // Bill to and show
  text(c, doc.kind === 'invoice' ? 'Bill to' : 'Credit to', M, c.y, { size: 9, bold: true, color: MUTED });
  text(c, 'Show', 320, c.y, { size: 9, bold: true, color: MUTED });
  c.y -= 14;
  const buyer = [doc.buyer.name, ...(doc.buyer.contact ? [`For the attention of ${doc.buyer.contact}`] : []), ...doc.buyer.address, ...(doc.buyer.vatNumber ? [`VAT number: ${doc.buyer.vatNumber}`] : [])];
  const show = [doc.show.name, ...(doc.show.venue ? [doc.show.venue] : []), `Stand ${doc.show.standNumber}${doc.show.hall ? `, hall ${doc.show.hall}` : ''}`];
  let by = c.y;
  for (const [i, l] of buyer.slice(0, 8).entries()) {
    text(c, l, M, by, { size: i === 0 ? 10 : 9, bold: i === 0, maxWidth: 250 });
    by -= 12.5;
  }
  let shy = c.y;
  for (const [i, l] of show.entries()) {
    text(c, l, 320, shy, { size: i === 0 ? 10 : 9, bold: i === 0, maxWidth: W - M - 320 });
    shy -= 12.5;
  }
  c.y = Math.min(by, shy) - 16;

  if (doc.paid && doc.kind === 'invoice') {
    c.page.drawRectangle({ x: W - M - 90, y: c.y + 2, width: 90, height: 24, borderColor: rgb(0.13, 0.55, 0.25), borderWidth: 1.5 });
    text(c, 'PAID', W - M - 45 + bold.widthOfTextAtSize('PAID', 13) / 2, c.y + 9, { size: 13, bold: true, color: rgb(0.13, 0.55, 0.25), align: 'right' });
    c.y -= 12;
  }
  if (doc.reason) {
    for (const l of wrap(`Reason: ${doc.reason}`, font, 9, W - 2 * M)) {
      text(c, l, M, c.y, { size: 9, color: MUTED });
      c.y -= 12;
    }
    c.y -= 6;
  }

  // Lines
  c.y -= 6;
  tableHeader(c);
  for (const line of doc.lines) {
    const descLines = wrap(line.description, font, 9.5, COL.qty - COL.desc - 50);
    if (ensure(c, descLines.length * 12 + 8)) tableHeader(c);
    const top = c.y;
    for (const [i, l] of descLines.entries()) text(c, l, COL.desc + 6, top - i * 12);
    text(c, String(line.quantity), COL.qty, top, { align: 'right' });
    text(c, money(line.unitPence), COL.unit + 12, top, { align: 'right' });
    text(c, pct(line.vatRateBps), COL.vat + 12, top, { align: 'right' });
    text(c, money(line.netPence), COL.net - 6, top, { align: 'right' });
    c.y = top - descLines.length * 12 - 6;
    c.page.drawLine({ start: { x: M, y: c.y + 2 }, end: { x: W - M, y: c.y + 2 }, thickness: 0.5, color: RULE });
    c.y -= 8;
  }

  // Totals, with VAT shown for each rate
  const net = doc.lines.reduce((a, l) => a + l.netPence, 0);
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of doc.lines) {
    const r = byRate.get(l.vatRateBps) ?? { net: 0, vat: 0 };
    r.net += l.netPence;
    r.vat += l.vatPence;
    byRate.set(l.vatRateBps, r);
  }
  const rows: [string, string, boolean][] = [['Total excluding VAT', money(net), false]];
  for (const [rate, r] of [...byRate.entries()].sort((a, b) => b[0] - a[0])) rows.push([`VAT at ${pct(rate)} on ${money(r.net)}`, money(r.vat), false]);
  if (doc.cardFeePence) rows.push(['Card processing fee', money(doc.cardFeePence), false]);
  rows.push([doc.kind === 'invoice' ? (doc.paid ? 'Total paid' : 'Total due') : 'Total credited', money(doc.totalPence), true]);
  ensure(c, rows.length * 16 + 20);
  c.y -= 4;
  for (const [label, value, strong] of rows) {
    if (strong) {
      c.page.drawLine({ start: { x: 330, y: c.y + 12 }, end: { x: W - M, y: c.y + 12 }, thickness: 0.8, color: INK });
    }
    text(c, label, 340, c.y, { size: strong ? 11 : 9.5, bold: strong });
    text(c, value, W - M - 6, c.y, { size: strong ? 11 : 9.5, bold: strong, align: 'right' });
    c.y -= strong ? 20 : 15;
  }

  // How to pay
  if (doc.kind === 'invoice' && !doc.paid && doc.paymentInstructions) {
    const lines = wrap(doc.paymentInstructions, font, 9, W - 2 * M - 20);
    ensure(c, lines.length * 12 + 40);
    c.y -= 10;
    const boxH = lines.length * 12 + 30;
    c.page.drawRectangle({ x: M, y: c.y - boxH + 14, width: W - 2 * M, height: boxH, borderColor: RULE, borderWidth: 1 });
    text(c, `How to pay${doc.dueAt ? ` (by ${day(doc.dueAt)})` : ''}`, M + 10, c.y, { bold: true, size: 9.5 });
    c.y -= 15;
    for (const l of lines) {
      text(c, l, M + 10, c.y, { size: 9 });
      c.y -= 12;
    }
    text(c, `Please quote ${doc.number} as the payment reference.`, M + 10, c.y, { size: 9, color: MUTED });
    c.y -= 20;
  }

  // Footer on every page
  const legal = [doc.seller.legalName, doc.seller.companyNumber ? `Registered in England and Wales no. ${doc.seller.companyNumber}` : '', doc.seller.vatNumber ? `VAT no. ${doc.seller.vatNumber}` : '']
    .filter(Boolean)
    .join('  ·  ');
  const pages = pdf.getPages();
  for (const [i, p] of pages.entries()) {
    const footerLines = [...(doc.footer ? wrap(doc.footer, font, 8, W - 2 * M) : []), legal];
    let fy = M - 6 + footerLines.length * 10;
    for (const l of footerLines) {
      p.drawText(fit(l, font, 8, W - 2 * M - 60), { x: M, y: fy, size: 8, font, color: MUTED });
      fy -= 10;
    }
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8), y: M - 6, size: 8, font, color: MUTED });
  }
  return pdf.save();
}
