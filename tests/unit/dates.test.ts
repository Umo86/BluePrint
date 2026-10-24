import { describe, expect, it } from 'vitest';
import { parseLocalDateTime, toLocalDateTimeString } from '@/lib/dates';

describe('UK local time handling', () => {
  it('reads summer times as BST (UTC+1)', () => {
    expect(parseLocalDateTime('2027-05-01 08:00:00')?.toISOString()).toBe('2027-05-01T07:00:00.000Z');
  });
  it('reads winter times as GMT', () => {
    expect(parseLocalDateTime('2027-01-15 09:30')?.toISOString()).toBe('2027-01-15T09:30:00.000Z');
  });
  it('treats plain dates as midnight local', () => {
    expect(parseLocalDateTime('2027-07-01')?.toISOString()).toBe('2027-06-30T23:00:00.000Z');
  });
  it('passes ISO strings with an offset through', () => {
    expect(parseLocalDateTime('2027-05-01T08:00:00Z')?.toISOString()).toBe('2027-05-01T08:00:00.000Z');
  });
  it('round-trips', () => {
    const d = parseLocalDateTime('2026-10-25 01:30:00')!; // the night the clocks go back
    expect(toLocalDateTimeString(d)).toBe('2026-10-25 01:30:00');
    expect(toLocalDateTimeString('2027-05-01T07:00:00.000Z')).toBe('2027-05-01 08:00:00');
  });
  it('rejects junk', () => {
    expect(parseLocalDateTime('next tuesday')).toBeNull();
    expect(parseLocalDateTime('')).toBeNull();
  });
});
