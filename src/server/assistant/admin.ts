import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editions, shows } from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { audit } from '../audit';
import { env } from '../env';
import { assertRateLimit } from '../security/rate-limit';
import { getPlatformSettings } from '../services/settings';
import { modelLabel } from '@/lib/assistant-pricing';
import { assistantConfigFor, assistantStatus, assistantUsage, effectiveDailyLimit, EMPTY_USAGE } from './index';
import { assistantModel } from './model';
import type { Actor } from '../auth/actor';

/** The super admin's view of the assistant: the key, the platform settings, and usage and cost per show. */
export async function platformAssistantOverview(actor: Actor) {
  assertSuperAdmin(actor);
  const settings = await getPlatformSettings();
  const model = assistantModel();
  const db = await getDb();
  const rows = await db
    .select({ edition: editions, showName: shows.name })
    .from(editions)
    .innerJoin(shows, eq(shows.id, editions.showId))
    .orderBy(asc(shows.name), asc(editions.name));
  const now = Date.now();
  const usage = await assistantUsage(new Date(now - 30 * 86_400_000));
  const list = await Promise.all(
    rows
      .filter((r) => r.edition.status !== 'archived')
      .map(async (r) => {
        const config = assistantConfigFor(r.edition);
        const status = await assistantStatus(r.edition);
        return {
          id: r.edition.id,
          name: r.edition.name,
          showName: r.showName,
          status: r.edition.status,
          on: r.edition.assistantEnabled,
          available: status.available,
          reason: status.reason,
          assistantName: config.name,
          dailyLimit: effectiveDailyLimit(settings, config),
          usage: usage.get(r.edition.id) ?? EMPTY_USAGE,
        };
      }),
  );
  const total = list.reduce(
    (a, e) => ({ questions: a.questions + e.usage.questions, testQuestions: a.testQuestions + e.usage.testQuestions, costUsd: a.costUsd + e.usage.costUsd }),
    { questions: 0, testQuestions: 0, costUsd: 0 },
  );
  return {
    connection: model ? (model.kind === 'claude' ? ('claude' as const) : ('practice' as const)) : ('none' as const),
    keySet: Boolean(env().ANTHROPIC_API_KEY),
    settings: {
      assistantEnabled: settings.assistantEnabled,
      assistantModel: settings.assistantModel,
      assistantEffort: settings.assistantEffort,
      assistantDailyLimit: settings.assistantDailyLimit,
      assistantPersonHourLimit: settings.assistantPersonHourLimit,
      assistantPersonDayLimit: settings.assistantPersonDayLimit,
      assistantInstructions: settings.assistantInstructions,
    },
    editions: list,
    total,
  };
}

export type ConnectionCheck = { ok: boolean; message: string; model?: string; ms?: number };

/** Plain words for what went wrong when calling Claude. */
function explain(err: unknown, model: string): string {
  const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status?: number }).status) : null;
  const text = err instanceof Error ? err.message : '';
  if (status === 401) return 'Claude refused the key (401). Check ANTHROPIC_API_KEY in Vercel, then redeploy.';
  if (status === 403) return 'The key is not allowed to use Claude (403). Check the key’s workspace in the Claude Console.';
  if (status === 404) return `${modelLabel(model)} was not found (404). Choose another model below.`;
  if (status === 429) return 'Claude is limiting requests from this key (429). Try again in a minute, or check the rate limits in the Claude Console.';
  if (status === 400 && /credit|billing|balance/i.test(text)) return 'Your Claude account is out of credit. Add credit in the Claude Console (Billing).';
  if (status === 400) return `Claude did not accept the request (400): ${text.slice(0, 200)}`;
  if (status === 529 || status === 503) return 'Claude is busy at the moment. Try again in a few minutes.';
  if (status && status >= 500) return `Claude had a problem (${status}). Try again in a few minutes.`;
  return `Could not reach Claude: ${text.slice(0, 200) || 'no answer'}.`;
}

/** Sends Claude a tiny request with the chosen model, to check the key, the model and the account work. */
export async function checkAssistantConnection(actor: Actor): Promise<ConnectionCheck> {
  assertSuperAdmin(actor);
  await assertRateLimit(`assistant:check:${actor.realUserId}`, 10, 600);
  const settings = await getPlatformSettings();
  const model = assistantModel();
  let result: ConnectionCheck;
  if (!model) {
    result = { ok: false, message: 'No Claude API key is set. Add ANTHROPIC_API_KEY in Vercel (Settings, Environment Variables), then redeploy.' };
  } else if (model.kind === 'offline') {
    result = { ok: true, message: 'Practice mode: there is no key here, so the assistant searches the manual without Claude.' };
  } else {
    const started = Date.now();
    try {
      const reply = await model.reply(
        { system: { stable: 'This is a connection check. Reply with the single word OK.', dynamic: '' }, messages: [{ role: 'user', content: 'Connection check' }], tools: [], maxTokens: 16 },
        { model: settings.assistantModel, effort: 'low' },
      );
      const ms = Date.now() - started;
      result = { ok: true, model: reply.model, ms, message: `Connected. ${modelLabel(reply.model)} answered in ${(ms / 1000).toFixed(1)} seconds.` };
    } catch (err) {
      console.error('Assistant connection check failed', err);
      result = { ok: false, model: settings.assistantModel, message: explain(err, settings.assistantModel) };
    }
  }
  await audit(actor, 'assistant.connection_checked', { entityType: 'platform_settings', entityId: 'platform', details: { ok: result.ok } });
  return result;
}
