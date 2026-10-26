/** Formatting helpers shared by server and client components. */

export function money(pence: number | null | undefined, currency = 'GBP'): string {
  const value = (pence ?? 0) / 100;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value);
}

export function dateLong(d: Date | string | null | undefined, timeZone = 'Europe/London'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone });
}

export function dateShort(d: Date | string | null | undefined, timeZone = 'Europe/London'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

export function dateTime(d: Date | string | null | undefined, timeZone = 'Europe/London'): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
}

export function percentFromBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
}

export function commissionLabel(type: 'percent' | 'fixed' | null | undefined, value: number | null | undefined, currency = 'GBP') {
  if (!type || value === null || value === undefined) return 'Default';
  return type === 'percent' ? percentFromBps(value) : `${money(value, currency)} per line`;
}

export function daysUntil(d: Date | string | null | undefined, from = new Date()): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - from.getTime()) / (24 * 3600 * 1000));
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

type Measure = string | number | null | undefined;
const measure = (v: Measure) => (v === null || v === undefined || v === '' ? null : Number(v));
const metres = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });

/**
 * A stand's size as people say it: "6 m × 3 m (18 sqm)", or "18 sqm" when only the area is known,
 * or '' when nothing is. The database hands numbers back as strings, so both are accepted.
 */
export function standSize(s: { sizeSqm?: Measure; widthM?: Measure; depthM?: Measure }): string {
  const w = measure(s.widthM);
  const d = measure(s.depthM);
  const area = measure(s.sizeSqm);
  const sqm = area !== null ? `${metres(area)} sqm` : '';
  if (w !== null && d !== null) return `${metres(w)} m × ${metres(d)} m${sqm ? ` (${sqm})` : ''}`;
  return sqm;
}
