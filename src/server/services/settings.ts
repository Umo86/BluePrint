import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { platformSettings } from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { audit } from '../audit';
import type { Actor } from '../auth/actor';

export const platformSettingsSchema = z.object({
  /** Who pays the card processing fee: added on top for the exhibitor, or taken from the supplier's share. */
  feeMode: z.enum(['exhibitor_pays', 'deduct_from_supplier']).default('exhibitor_pays'),
  /** Card fee used to calculate what is added at checkout (Stripe standard UK rate by default). */
  stripeFeePercentBps: z.number().int().min(0).max(1000).default(150),
  stripeFeeFixedPence: z.number().int().min(0).max(500).default(20),
  defaultCommissionType: z.enum(['percent', 'fixed']).default('percent'),
  /** Basis points for percent (1000 = 10%), pence for fixed. */
  defaultCommissionValue: z.number().int().min(0).max(1_000_000).default(1000),
  defaultVatRateBps: z.number().int().min(0).max(10_000).default(2000),
  /** Reminder steps in days before a deadline. */
  reminderOffsets: z.array(z.number().int().min(1).max(365)).max(6).default([14, 7, 1]),
  retention: z
    .object({
      ordersYears: z.number().int().min(1).max(20).default(6),
      spaceOnlyYearsAfterShow: z.number().int().min(1).max(20).default(6),
      incidentYears: z.number().int().min(1).max(20).default(3),
      inactiveContactYears: z.number().int().min(1).max(20).default(3),
      emailLogMonths: z.number().int().min(1).max(120).default(24),
      /** Assistant conversations nobody has touched for this long are deleted. */
      assistantMonths: z.number().int().min(1).max(60).default(12),
    })
    .default({ ordersYears: 6, spaceOnlyYearsAfterShow: 6, incidentYears: 3, inactiveContactYears: 3, emailLogMonths: 24, assistantMonths: 12 }),
  emailDefaults: z
    .object({
      senderName: z.string().max(80).default('BluePrint'),
      senderAddress: z.string().max(200).default(''),
      replyTo: z.string().max(200).default(''),
    })
    .default({ senderName: 'BluePrint', senderAddress: '', replyTo: '' }),
  /** The organiser's details printed on every invoice and credit note (the organiser is the seller of record). */
  invoicing: z
    .object({
      legalName: z.string().trim().max(200).default(''),
      address: z.string().trim().max(500).default(''),
      vatNumber: z.string().trim().max(40).default(''),
      companyNumber: z.string().trim().max(40).default(''),
      email: z.string().trim().max(200).default(''),
      phone: z.string().trim().max(40).default(''),
      /** How to pay an invoice by bank transfer: account name, sort code, account number, IBAN. */
      paymentInstructions: z.string().trim().max(600).default(''),
      dueDays: z.number().int().min(0).max(120).default(30),
      footer: z.string().trim().max(400).default(''),
    })
    .default({ legalName: '', address: '', vatNumber: '', companyNumber: '', email: '', phone: '', paymentInstructions: '', dueDays: 30, footer: '' }),
  /** Terms the exhibitor accepts at checkout (plain text). */
  orderTerms: z.string().trim().max(5000).default(''),
  assistantEnabled: z.boolean().default(true),
  /** The Claude model behind the exhibitor assistant. */
  assistantModel: z.enum(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']).default('claude-sonnet-5-5'),
  /** How much effort the model puts into each reply: lower is faster and cheaper. */
  assistantEffort: z.enum(['low', 'medium', 'high']).default('low'),
  /** Most questions the assistant answers per show per day (a cost ceiling). */
  assistantDailyLimit: z.number().int().min(0).max(100_000).default(3000),
  /** Most questions one person can ask in an hour, and in a day. */
  assistantPersonHourLimit: z.number().int().min(1).max(1000).default(30),
  assistantPersonDayLimit: z.number().int().min(1).max(5000).default(150),
  /** The organiser's instructions for the assistant at every show (each show can add its own). */
  assistantInstructions: z.string().trim().max(2000).default(''),
  maintenanceMessage: z.string().max(500).default(''),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

const KEY = 'platform';

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await getDb();
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY)).limit(1);
  const parsed = platformSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : platformSettingsSchema.parse({});
}

export async function updatePlatformSettings(actor: Actor, patch: Partial<PlatformSettings>) {
  assertSuperAdmin(actor);
  const current = await getPlatformSettings();
  const next = platformSettingsSchema.parse({ ...current, ...patch });
  const db = await getDb();
  await db
    .insert(platformSettings)
    .values({ key: KEY, value: next, updatedBy: actor.realUserId })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedBy: actor.realUserId, updatedAt: new Date() } });
  const changed = Object.keys(patch).filter((k) => JSON.stringify((current as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]));
  await audit(actor, 'settings.updated', { entityType: 'platform_settings', entityId: KEY, details: { changed } });
  return next;
}
