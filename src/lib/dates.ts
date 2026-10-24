/**
 * Date pickers return wall-clock strings such as "2027-05-01 08:00:00". BluePrint stores
 * instants in UTC, so these helpers convert between a show's local time (Europe/London by
 * default, including British Summer Time) and UTC.
 */
export const DEFAULT_TZ = 'Europe/London';

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/** Parses "YYYY-MM-DD", "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" as local time in `timeZone`. ISO strings with Z or an offset are taken as-is. */
export function parseLocalDateTime(value: string | null | undefined, timeZone = DEFAULT_TZ): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  let result = guess - tzOffsetMs(guess, timeZone);
  const second = tzOffsetMs(result, timeZone);
  if (guess - second !== result) result = guess - second;
  return new Date(result);
}

/** The reverse: a UTC instant as a "YYYY-MM-DD HH:mm:ss" wall-clock string in `timeZone`. */
export function toLocalDateTimeString(date: Date | string | null | undefined, timeZone = DEFAULT_TZ): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + tzOffsetMs(d.getTime(), timeZone));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}`;
}

export function toLocalDateString(date: Date | string | null | undefined, timeZone = DEFAULT_TZ): string | null {
  return toLocalDateTimeString(date, timeZone)?.slice(0, 10) ?? null;
}
