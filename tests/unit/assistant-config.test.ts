import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_SUGGESTIONS,
  assistantSettingsSchema,
  greetingText,
  officeHoursText,
  officeStatus,
  replyExpectation,
  resolveAssistantSettings,
} from '@/lib/assistant-config';
import { estimateCostUsd, formatUsd, modelLabel } from '@/lib/assistant-pricing';

const LONDON = 'Europe/London';
// Times in October 2026 are British Summer Time (UTC+1): 27 October 2026 is a Tuesday in GMT.
const at = (iso: string) => new Date(iso);

describe('assistant set-up', () => {
  it('fills in defaults for anything a show leaves out', () => {
    const c = resolveAssistantSettings({});
    expect(c).toMatchObject({ name: DEFAULT_ASSISTANT_NAME, customName: false, greeting: null, suggestions: DEFAULT_SUGGESTIONS, instructions: '', dailyLimit: null, replyTime: 'same_day', askPhone: true });
    expect(c.officeHours).toEqual({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' });
    const own = resolveAssistantSettings({ name: ' BuildExpo helper ', greeting: 'Hi {first_name}', suggestions: ['  ', 'Where do I park?'], dailyLimit: 0, officeHours: { days: [6, 1, 1], start: '10:00', end: '16:00' }, askPhone: false });
    expect(own).toMatchObject({ name: 'BuildExpo helper', customName: true, greeting: 'Hi {first_name}', suggestions: ['Where do I park?'], dailyLimit: 0, askPhone: false });
    expect(own.officeHours.days).toEqual([1, 6]);
    // A broken time falls back to the default hours.
    expect(resolveAssistantSettings({ officeHours: { days: [1], start: '9am', end: '17:00' } }).officeHours.start).toBe('09:00');
  });

  it('checks what the settings form sends', () => {
    const ok = { enabled: true, name: 'Helper', greeting: '', suggestions: ['A?'], instructions: '', dailyLimit: null, officeHours: { days: [1], start: '09:00', end: '17:00' }, replyTime: 'hours4' as const, askPhone: true };
    expect(assistantSettingsSchema.parse(ok)).toMatchObject({ name: 'Helper' });
    expect(() => assistantSettingsSchema.parse({ ...ok, officeHours: { days: [1], start: '17:00', end: '09:00' } })).toThrow(/Closing time/);
    expect(() => assistantSettingsSchema.parse({ ...ok, suggestions: ['a', 'b', 'c', 'd', 'e'] })).toThrow(/Up to four/);
    expect(() => assistantSettingsSchema.parse({ ...ok, name: 'x'.repeat(41) })).toThrow(/under 40/);
    expect(() => assistantSettingsSchema.parse({ ...ok, officeHours: { days: [8], start: '09:00', end: '17:00' } })).toThrow();
  });

  it('puts the exhibitor’s first name in the greeting', () => {
    expect(greetingText('Hi {first_name}, welcome.', 'Amira')).toBe('Hi Amira, welcome.');
    expect(greetingText('Hi {First Name}!', '')).toBe('Hi there!');
  });

  it('knows when the team is in, and when it is next in', () => {
    const hours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' };
    // Tuesday 27 October 2026, 11:00 GMT.
    expect(officeStatus(hours, at('2026-10-27T11:00:00Z'), LONDON)).toEqual({ open: true, until: '17:30', back: null });
    // Tuesday 07:30: opens later today.
    expect(officeStatus(hours, at('2026-10-27T07:30:00Z'), LONDON)).toMatchObject({ open: false, back: 'today at 09:00' });
    // Tuesday 18:00: tomorrow.
    expect(officeStatus(hours, at('2026-10-27T18:00:00Z'), LONDON)).toMatchObject({ open: false, back: 'tomorrow at 09:00' });
    // Friday 30 October 18:00: Monday.
    expect(officeStatus(hours, at('2026-10-30T18:00:00Z'), LONDON)).toMatchObject({ open: false, back: 'Monday at 09:00' });
    // In summer time, 08:30 UTC is 09:30 in London.
    expect(officeStatus(hours, at('2026-07-07T08:30:00Z'), LONDON).open).toBe(true);
    expect(officeStatus({ ...hours, days: [] }, at('2026-10-27T11:00:00Z'), LONDON)).toEqual({ open: false, until: null, back: null });
  });

  it('tells the exhibitor when to expect a reply', () => {
    const c = resolveAssistantSettings({ replyTime: 'hours4' });
    expect(replyExpectation(c, at('2026-10-27T11:00:00Z'), LONDON)).toBe('The show team is in until 17:30 today and usually replies within four hours.');
    expect(replyExpectation(c, at('2026-10-30T18:00:00Z'), LONDON)).toBe('The show team is out of the office now. They are back Monday at 09:00 and usually reply within four hours of opening.');
    expect(replyExpectation(resolveAssistantSettings({ replyTime: 'next_day', officeHours: { days: [], start: '09:00', end: '17:00' } }), at('2026-10-27T11:00:00Z'), LONDON)).toBe(
      'The show team will reply as soon as they can.',
    );
    expect(officeHoursText({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' })).toBe('Monday to Friday, 09:00 to 17:30');
    expect(officeHoursText({ days: [1, 3], start: '10:00', end: '12:00' })).toBe('Monday, Wednesday, 10:00 to 12:00');
    expect(officeHoursText({ days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '20:00' })).toBe('Every day, 08:00 to 20:00');
  });
});

describe('assistant costs', () => {
  it('estimates spend from the tokens Claude reports, at list prices', () => {
    // Sonnet 5.5: $2 in, $2.50 cache write, $0.10 cache read, $10 out per million.
    expect(estimateCostUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(2);
    expect(estimateCostUsd('claude-sonnet-5-5', { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10_000, cacheWriteTokens: 2000 })).toBeCloseTo(0.002 + 0.005 + 0.001 + 0.005);
    expect(estimateCostUsd('claude-haiku-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(estimateCostUsd('claude-opus-5-5-20260601', { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(20);
    expect(estimateCostUsd('offline', { inputTokens: 1000, outputTokens: 1000 })).toBe(0);
    expect(modelLabel('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.004)).toBe('less than $0.01');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });
});
