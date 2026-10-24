/**
 * Money maths for the shop. Everything is in whole pence and rounded once per line, so totals
 * on screen, on invoices and in Stripe always agree.
 *
 * The model (agree it with finance before going live):
 * - Media10 sells to the exhibitor and issues the VAT invoice for the whole order.
 * - Each supplier is paid their share: the line's net price minus Media10's commission, plus VAT
 *   on that share when the supplier is VAT registered (their own supply to Media10).
 * - The card processing fee is either added on top for the exhibitor ("exhibitor_pays") or taken
 *   from the suppliers' shares in proportion to their lines ("deduct_from_supplier").
 */

export type CommissionRule = { type: 'percent' | 'fixed'; value: number };

export type PricedProduct = {
  pricePence: number;
  earlyPricePence: number | null;
  earlyUntilOffsetDays: number | null;
  latePricePence: number | null;
  lateFromOffsetDays: number | null;
};

const DAY = 86_400_000;

/** VAT included in a VAT-inclusive amount (used to split refunds into net and VAT). */
export function vatWithin(grossPence: number, rateBps: number) {
  if (!rateBps) return 0;
  return roundPence((grossPence * rateBps) / (10_000 + rateBps));
}

/** Supplier's share of a refund on a line, in proportion to what they were paid for it. */
export function reversalFor(refundPence: number, lineGrossPence: number, linePayoutPence: number) {
  if (lineGrossPence <= 0) return 0;
  return Math.min(linePayoutPence, roundPence((refundPence / lineGrossPence) * linePayoutPence));
}

/** VAT and percentages: round half away from zero, the usual rule for UK VAT. */
export function roundPence(x: number) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

export function vatOn(netPence: number, rateBps: number) {
  return roundPence((netPence * rateBps) / 10_000);
}

/** Which price applies today: early-bird before its cut-off, late price after its start, otherwise standard. */
export function currentUnitPrice(p: PricedProduct, buildUpStartsAt: Date | null, now = new Date()) {
  if (buildUpStartsAt) {
    const t = now.getTime();
    if (p.earlyPricePence !== null && p.earlyUntilOffsetDays !== null && t <= buildUpStartsAt.getTime() - p.earlyUntilOffsetDays * DAY) {
      return { unitPence: p.earlyPricePence, band: 'early' as const, until: new Date(buildUpStartsAt.getTime() - p.earlyUntilOffsetDays * DAY) };
    }
    if (p.latePricePence !== null && p.lateFromOffsetDays !== null && t >= buildUpStartsAt.getTime() - p.lateFromOffsetDays * DAY) {
      return { unitPence: p.latePricePence, band: 'late' as const, until: null };
    }
  }
  return { unitPence: p.pricePence, band: 'standard' as const, until: null };
}

/** The first commission rule that is set wins: product, then category, then supplier, then edition, then platform. */
export function resolveCommission(...rules: ({ type: 'percent' | 'fixed' | null; value: number | null } | null | undefined)[]): CommissionRule {
  for (const r of rules) {
    if (r && r.type && r.value !== null && r.value !== undefined) return { type: r.type, value: r.value };
  }
  return { type: 'percent', value: 0 };
}

export function commissionFor(netPence: number, rule: CommissionRule) {
  const raw = rule.type === 'percent' ? roundPence((netPence * rule.value) / 10_000) : rule.value;
  return Math.max(0, Math.min(netPence, raw));
}

export type LineInput = {
  key: string;
  unitPence: number;
  quantity: number;
  vatRateBps: number;
  /** Null when Media10 provides the service itself. */
  supplierId: string | null;
  /** Whether the supplier charges Media10 VAT on their share (true unless they are not VAT registered). */
  supplierChargesVat?: boolean;
  commission: CommissionRule;
};

export type PricedLine = LineInput & {
  netPence: number;
  vatPence: number;
  grossPence: number;
  commissionPence: number;
  cardFeeSharePence: number;
  supplierPayoutPence: number;
};

export type CardFee = { percentBps: number; fixedPence: number };

/**
 * The card fee to add on top so that, after Stripe takes its percentage and fixed fee from the
 * whole charge, Media10 is left with the order total.
 */
export function grossUpCardFee(totalPence: number, fee: CardFee) {
  if (totalPence <= 0) return 0;
  const charged = Math.ceil((totalPence + fee.fixedPence) / (1 - fee.percentBps / 10_000));
  return charged - totalPence;
}

/** Stripe's fee on a charge of this size. */
export function stripeFeeOn(chargedPence: number, fee: CardFee) {
  return roundPence((chargedPence * fee.percentBps) / 10_000) + fee.fixedPence;
}

/** Splits an amount across lines in proportion to their weights, so the parts always add up exactly. */
export function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

/** Prices a whole order. */
export function priceOrder(lines: LineInput[], opts: { method: 'card' | 'invoice'; feeMode: 'exhibitor_pays' | 'deduct_from_supplier'; cardFee: CardFee }) {
  const priced: PricedLine[] = lines.map((l) => {
    const netPence = l.unitPence * l.quantity;
    const vatPence = vatOn(netPence, l.vatRateBps);
    const commissionPence = l.supplierId ? commissionFor(netPence, l.commission) : netPence;
    return { ...l, netPence, vatPence, grossPence: netPence + vatPence, commissionPence, cardFeeSharePence: 0, supplierPayoutPence: 0 };
  });
  const netPence = priced.reduce((a, l) => a + l.netPence, 0);
  const vatPence = priced.reduce((a, l) => a + l.vatPence, 0);
  const goodsPence = netPence + vatPence;
  let cardFeePence = 0;
  if (opts.method === 'card' && goodsPence > 0) {
    if (opts.feeMode === 'exhibitor_pays') {
      cardFeePence = grossUpCardFee(goodsPence, opts.cardFee);
    } else {
      // Deducted from suppliers' shares; lines Media10 provides itself carry their own share.
      const fee = stripeFeeOn(goodsPence, opts.cardFee);
      const shares = allocate(fee, priced.map((l) => l.grossPence));
      priced.forEach((l, i) => (l.cardFeeSharePence = shares[i]));
    }
  }
  for (const l of priced) {
    if (!l.supplierId) {
      l.supplierPayoutPence = 0;
      continue;
    }
    const share = l.netPence - l.commissionPence;
    const shareVat = l.supplierChargesVat === false ? 0 : vatOn(share, l.vatRateBps);
    l.supplierPayoutPence = Math.max(0, share + shareVat - l.cardFeeSharePence);
  }
  const commissionPence = priced.reduce((a, l) => a + l.commissionPence, 0);
  return { lines: priced, netPence, vatPence, cardFeePence, commissionPence, totalPence: goodsPence + cardFeePence };
}
