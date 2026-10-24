import { describe, expect, it } from 'vitest';
import {
  allocate,
  commissionFor,
  currentUnitPrice,
  grossUpCardFee,
  priceOrder,
  resolveCommission,
  reversalFor,
  stripeFeeOn,
  vatOn,
  vatWithin,
  type LineInput,
} from '@/lib/pricing';
import { isAllowedPaymentRedirect } from '@/lib/safe-redirect';

const DAY = 86_400_000;

describe('VAT and rounding', () => {
  it('rounds VAT half away from zero, per line', () => {
    expect(vatOn(1002, 2000)).toBe(200);
    expect(vatOn(1003, 2000)).toBe(201);
    expect(vatOn(2500, 2000)).toBe(500);
    expect(vatOn(999, 500)).toBe(50);
    expect(vatOn(0, 2000)).toBe(0);
  });

  it('splits VAT back out of a VAT-inclusive refund', () => {
    expect(vatWithin(1200, 2000)).toBe(200);
    expect(vatWithin(1000, 2000)).toBe(167);
    expect(vatWithin(1000, 0)).toBe(0);
  });
});

describe('price bands', () => {
  const buildUp = new Date('2027-05-01T08:00:00Z');
  const p = { pricePence: 1000, earlyPricePence: 800, earlyUntilOffsetDays: 60, latePricePence: 1300, lateFromOffsetDays: 14 };

  it('uses the early price until its cut-off, then standard, then late', () => {
    expect(currentUnitPrice(p, buildUp, new Date(buildUp.getTime() - 90 * DAY))).toMatchObject({ unitPence: 800, band: 'early' });
    expect(currentUnitPrice(p, buildUp, new Date(buildUp.getTime() - 60 * DAY))).toMatchObject({ unitPence: 800, band: 'early' });
    expect(currentUnitPrice(p, buildUp, new Date(buildUp.getTime() - 30 * DAY))).toMatchObject({ unitPence: 1000, band: 'standard' });
    expect(currentUnitPrice(p, buildUp, new Date(buildUp.getTime() - 14 * DAY))).toMatchObject({ unitPence: 1300, band: 'late' });
    expect(currentUnitPrice(p, buildUp, new Date(buildUp.getTime() + DAY))).toMatchObject({ unitPence: 1300, band: 'late' });
  });

  it('falls back to the standard price without dates', () => {
    expect(currentUnitPrice(p, null).unitPence).toBe(1000);
    expect(currentUnitPrice({ ...p, earlyPricePence: null, earlyUntilOffsetDays: null, latePricePence: null, lateFromOffsetDays: null }, buildUp, new Date(buildUp.getTime() - 90 * DAY)).band).toBe('standard');
  });
});

describe('commission', () => {
  it('takes the first rule that is set', () => {
    expect(resolveCommission(null, { type: null, value: null }, { type: 'fixed', value: 500 }, { type: 'percent', value: 1000 })).toEqual({ type: 'fixed', value: 500 });
    expect(resolveCommission({ type: 'percent', value: 0 }, { type: 'percent', value: 2000 })).toEqual({ type: 'percent', value: 0 });
    expect(resolveCommission(undefined, null)).toEqual({ type: 'percent', value: 0 });
  });

  it('works out percentages and fixed amounts, never more than the line', () => {
    expect(commissionFor(10_000, { type: 'percent', value: 1500 })).toBe(1500);
    expect(commissionFor(333, { type: 'percent', value: 1000 })).toBe(33);
    expect(commissionFor(10_000, { type: 'fixed', value: 250 })).toBe(250);
    expect(commissionFor(100, { type: 'fixed', value: 250 })).toBe(100);
  });
});

describe('card fee', () => {
  const fee = { percentBps: 150, fixedPence: 20 };

  it('adds enough on top that Media10 still receives the order total after Stripe’s fee', () => {
    for (const total of [1, 99, 1000, 12_000, 123_457, 9_999_999]) {
      const extra = grossUpCardFee(total, fee);
      const charged = total + extra;
      expect(charged - stripeFeeOn(charged, fee)).toBeGreaterThanOrEqual(total);
      // ...and never more than a penny or two over.
      expect(charged - stripeFeeOn(charged, fee) - total).toBeLessThanOrEqual(2);
    }
    expect(grossUpCardFee(0, fee)).toBe(0);
  });

  it('splits an amount so the parts add up exactly', () => {
    const parts = allocate(203, [12_000, 6000, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(203);
    expect(parts[0]).toBeGreaterThan(parts[1]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('pricing an order', () => {
  const lines: LineInput[] = [
    { key: 'chair', unitPence: 2500, quantity: 4, vatRateBps: 2000, supplierId: 'furniture', commission: { type: 'percent', value: 1500 } },
    { key: 'clean', unitPence: 4000, quantity: 1, vatRateBps: 2000, supplierId: null, commission: { type: 'percent', value: 0 } },
  ];
  const fee = { percentBps: 150, fixedPence: 20 };

  it('charges the exhibitor the card fee on top and pays the supplier its share plus VAT', () => {
    const r = priceOrder(lines, { method: 'card', feeMode: 'exhibitor_pays', cardFee: fee });
    expect(r.netPence).toBe(14_000);
    expect(r.vatPence).toBe(2800);
    expect(r.cardFeePence).toBe(grossUpCardFee(16_800, fee));
    expect(r.totalPence).toBe(16_800 + r.cardFeePence);
    const chair = r.lines[0];
    expect(chair.commissionPence).toBe(1500);
    // (10,000 - 1,500) + 20% VAT on 8,500
    expect(chair.supplierPayoutPence).toBe(10_200);
    // Media10's own line: all of it is Media10's, nothing to pay out.
    expect(r.lines[1].commissionPence).toBe(4000);
    expect(r.lines[1].supplierPayoutPence).toBe(0);
  });

  it('takes the card fee from the suppliers’ shares instead when set to', () => {
    const r = priceOrder(lines, { method: 'card', feeMode: 'deduct_from_supplier', cardFee: fee });
    expect(r.cardFeePence).toBe(0);
    expect(r.totalPence).toBe(16_800);
    const shares = r.lines.reduce((a, l) => a + l.cardFeeSharePence, 0);
    expect(shares).toBe(stripeFeeOn(16_800, fee));
    expect(r.lines[0].supplierPayoutPence).toBe(10_200 - r.lines[0].cardFeeSharePence);
  });

  it('adds no card fee to invoice orders', () => {
    const r = priceOrder(lines, { method: 'invoice', feeMode: 'exhibitor_pays', cardFee: fee });
    expect(r.cardFeePence).toBe(0);
    expect(r.totalPence).toBe(16_800);
  });

  it('pays suppliers who are not VAT registered their share only', () => {
    const r = priceOrder([{ ...lines[0], supplierChargesVat: false }], { method: 'invoice', feeMode: 'exhibitor_pays', cardFee: fee });
    expect(r.lines[0].supplierPayoutPence).toBe(8500);
  });

  it('reverses a supplier payout in proportion to a refund', () => {
    expect(reversalFor(6000, 12_000, 10_200)).toBe(5100);
    expect(reversalFor(12_000, 12_000, 10_200)).toBe(10_200);
    expect(reversalFor(1, 0, 10)).toBe(0);
  });
});

describe('payment redirects', () => {
  it('only allows this site and Stripe’s hosted pages', () => {
    expect(isAllowedPaymentRedirect('/portal/x/orders/1')).toBe(true);
    expect(isAllowedPaymentRedirect('https://checkout.stripe.com/c/pay/cs_test_123')).toBe(true);
    expect(isAllowedPaymentRedirect('https://connect.stripe.com/setup/e/acct_1/abc')).toBe(true);
    expect(isAllowedPaymentRedirect('//evil.example/pay')).toBe(false);
    expect(isAllowedPaymentRedirect('/\\evil.example')).toBe(false);
    expect(isAllowedPaymentRedirect('https://checkout.stripe.com.evil.example/x')).toBe(false);
    expect(isAllowedPaymentRedirect('http://checkout.stripe.com/x')).toBe(false);
    expect(isAllowedPaymentRedirect('javascript:alert(1)')).toBe(false);
    expect(isAllowedPaymentRedirect(null)).toBe(false);
  });
});
