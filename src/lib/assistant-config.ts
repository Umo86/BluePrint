import { z } from 'zod';

/**
 * The exhibitor assistant's set-up for a show (name, greeting, suggested questions, the team's own
 * instructions, limits and office hours), with the defaults used when a show leaves something out.
 * Shared by the server and the settings form, so the preview matches what exhibitors see.
 */

export const ASSISTANT_REPLY_TIMES = ['hour', 'hours4', 'same_day', 'next_day'] as const;
export type AssistantReplyTime = (typeof ASSISTANT_REPLY_TIMES)[number];

/** Stored on the edition. Anything left out uses the default. */
export type EditionAssistantSettings = {
  /** What exhibitors see it called, for example "BuildExpo helper". */
  name?: string;
  /** The first message in the chat. {first_name} becomes the exhibitor's first name. Empty: automatic. */
  greeting?: string;
  /** Up to four questions offered as buttons under the greeting. */
  suggestions?: string[];
  /** The show team's own instructions (tone, what to always or never say). */
  instructions?: string;
  /** Most questions per day for this show, below the platform's ceiling. Empty: the platform's. */
  dailyLimit?: number | null;
  /** When the team answers questions passed on by the assistant (show's local time; 1 = Monday to 7 = Sunday). */
  officeHours?: { days: number[]; start: string; end: string };
  replyTime?: AssistantReplyTime;
  /** Ask for a phone number and a good time to call when passing a question on. */
  askPhone?: boolean;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_ASSISTANT_NAME = 'Exhibitor assistant';
export const DEFAULT_SUGGESTIONS = ['What do I still need to do?', 'What should I order for my stand?', 'When does build-up start?'];
export const DEFAULT_OFFICE_HOURS = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' };

export const REPLY_TIME_LABELS: Record<AssistantReplyTime, string> = {
  hour: 'Within an hour',
  hours4: 'Within four hours',
  same_day: 'The same working day',
  next_day: 'By the end of the next working day',
};

export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
] as const;

export type AssistantConfig = {
  name: string;
  /** False while the show uses the default name. */
  customName: boolean;
  greeting: string | null;
  suggestions: string[];
  instructions: string;
  dailyLimit: number | null;
  officeHours: { days: number[]; start: string; end: string };
  replyTime: AssistantReplyTime;
  askPhone: boolean;
};

/** A show's assistant set-up with the defaults filled in. */
export function resolveAssistantSettings(s: EditionAssistantSettings | null | undefined): AssistantConfig {
  const v = s ?? {};
  const name = (v.name ?? '').trim();
  const suggestions = (v.suggestions ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const hours = v.officeHours && TIME.test(v.officeHours.start) && TIME.test(v.officeHours.end) ? v.officeHours : DEFAULT_OFFICE_HOURS;
  return {
    name: name || DEFAULT_ASSISTANT_NAME,
    customName: Boolean(name),
    greeting: (v.greeting ?? '').trim() || null,
    suggestions: suggestions.length ? suggestions : DEFAULT_SUGGESTIONS,
    instructions: (v.instructions ?? '').trim(),
    dailyLimit: typeof v.dailyLimit === 'number' ? v.dailyLimit : null,
    officeHours: { days: [...new Set(hours.days.filter((d) => d >= 1 && d <= 7))].sort(), start: hours.start, end: hours.end },
    replyTime: v.replyTime && (ASSISTANT_REPLY_TIMES as readonly string[]).includes(v.replyTime) ? v.replyTime : 'same_day',
    askPhone: v.askPhone ?? true,
  };
}

/** What the show's AI assistant settings form sends. */
export const assistantSettingsSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().max(40, 'Keep the name under 40 characters.'),
  greeting: z.string().trim().max(500, 'Keep the greeting under 500 characters.'),
  suggestions: z.array(z.string().trim().max(80, 'Keep each suggested question under 80 characters.')).max(4, 'Up to four suggested questions.'),
  instructions: z.string().trim().max(2000, 'Keep the house rules under 2,000 characters.'),
  dailyLimit: z.number().int().min(0).max(100_000).nullable(),
  officeHours: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).max(7),
      start: z.string().regex(TIME, 'Use a time such as 09:00.'),
      end: z.string().regex(TIME, 'Use a time such as 17:30.'),
    })
    .refine((h) => h.start < h.end, { message: 'Closing time must be after opening time.', path: ['end'] }),
  replyTime: z.enum(ASSISTANT_REPLY_TIMES),
  askPhone: z.boolean(),
});
export type AssistantSettingsInput = z.infer<typeof assistantSettingsSchema>;

const DAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Day of the week (1 = Monday) and minutes past midnight in a time zone. */
export function localWeekdayMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: DAY_INDEX[get('weekday')] ?? 1, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Whether the team is in now, until when, or when it is next in ("tomorrow at 09:00", "Monday at 09:00"). */
export function officeStatus(hours: AssistantConfig['officeHours'], now: Date, timeZone: string): { open: boolean; until: string | null; back: string | null } {
  if (!hours.days.length) return { open: false, until: null, back: null };
  const { weekday, minutes } = localWeekdayMinutes(now, timeZone);
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (hours.days.includes(weekday) && minutes >= start && minutes < end) return { open: true, until: hours.end, back: null };
  if (hours.days.includes(weekday) && minutes < start) return { open: false, until: null, back: `today at ${hours.start}` };
  for (let i = 1; i <= 7; i++) {
    const day = ((weekday - 1 + i) % 7) + 1;
    if (hours.days.includes(day)) return { open: false, until: null, back: `${i === 1 ? 'tomorrow' : WEEKDAYS[day - 1].long} at ${hours.start}` };
  }
  return { open: false, until: null, back: null };
}

const OPEN_REPLY: Record<AssistantReplyTime, string> = {
  hour: 'within an hour',
  hours4: 'within four hours',
  same_day: 'the same day',
  next_day: 'by the end of the next working day',
};
const CLOSED_REPLY: Record<AssistantReplyTime, string> = {
  hour: 'within an hour of opening',
  hours4: 'within four hours of opening',
  same_day: 'that day',
  next_day: 'by the end of the following working day',
};

/** One sentence telling an exhibitor when to expect an answer from the show team. */
export function replyExpectation(config: Pick<AssistantConfig, 'officeHours' | 'replyTime'>, now: Date, timeZone: string) {
  const s = officeStatus(config.officeHours, now, timeZone);
  if (s.open) return `The show team is in until ${s.until} today and usually replies ${OPEN_REPLY[config.replyTime]}.`;
  if (s.back) return `The show team is out of the office now. They are back ${s.back} and usually reply ${CLOSED_REPLY[config.replyTime]}.`;
  return 'The show team will reply as soon as they can.';
}

/** The office hours in words, for the assistant and the settings page ("Monday to Friday, 09:00 to 17:30"). */
export function officeHoursText(hours: AssistantConfig['officeHours']) {
  if (!hours.days.length) return 'No set office hours';
  const days = [...hours.days].sort();
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText =
    days.length === 7
      ? 'Every day'
      : run && days.length > 2
        ? `${WEEKDAYS[days[0] - 1].long} to ${WEEKDAYS[days[days.length - 1] - 1].long}`
        : days.map((d) => WEEKDAYS[d - 1].long).join(', ');
  return `${dayText}, ${hours.start} to ${hours.end}`;
}

/** The greeting with the exhibitor's first name put in ("there" when it is not known). */
export function greetingText(template: string, firstName: string) {
  return template.replace(/\{\s*first[_ ]name\s*\}/gi, firstName.trim() || 'there');
}
