import 'server-only';
import { env } from '../env';
import { isLocalAddress } from '../payments/provider';

/**
 * The language model behind the exhibitor assistant. In production it is Claude (Anthropic's API);
 * in development and tests, a small offline stand-in that follows the same tool-use protocol, so the
 * whole assistant can be used and tested without an API key.
 */

export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
};

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
/** Thinking blocks are passed back unchanged within one turn, as the API requires. */
export type OtherBlock = { type: 'thinking' | 'redacted_thinking'; [key: string]: unknown };
export type ReplyBlock = TextBlock | ToolUseBlock | OtherBlock;
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type TurnMessage = { role: 'user'; content: string | (ToolResultBlock | TextBlock)[] } | { role: 'assistant'; content: string | ReplyBlock[] };

export type ModelRequest = {
  /** Rules that are the same for every exhibitor (cached), then details about this exhibitor. */
  system: { stable: string; dynamic: string };
  messages: TurnMessage[];
  tools: ToolDef[];
  maxTokens: number;
};

export type ModelReply = {
  content: ReplyBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'pause_turn' | string | null;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export interface AssistantModel {
  kind: 'claude' | 'offline';
  reply(req: ModelRequest, settings: { model: string; effort: 'low' | 'medium' | 'high' }): Promise<ModelReply>;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

class ClaudeModel implements AssistantModel {
  kind = 'claude' as const;
  /** `fetchImpl` lets tests check the exact request without calling Anthropic. */
  constructor(
    private apiKey: string,
    private fetchImpl?: typeof fetch,
  ) {}

  async reply(req: ModelRequest, settings: { model: string; effort: 'low' | 'medium' | 'high' }): Promise<ModelReply> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey, maxRetries: 2, timeout: 60_000, ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });
    const tools = req.tools.map((t, i) => (i === req.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
    const response = await client.messages.create({
      model: settings.model,
      max_tokens: req.maxTokens,
      system: [
        { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: req.system.dynamic },
      ],
      // The message shapes match the API's; the SDK's own types are stricter than needed here.
      messages: req.messages as never,
      tools: tools as never,
      output_config: { effort: settings.effort },
    });
    return {
      content: response.content as unknown as ReplyBlock[],
      stopReason: response.stop_reason,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      model: response.model,
    };
  }
}

// ---------------------------------------------------------------------------
// Offline stand-in (development and tests)
// ---------------------------------------------------------------------------

let toolCounter = 0;

/**
 * Picks a tool from simple keywords, then words a short answer from what the tool returned. It is
 * deliberately simple: it exists so the assistant's plumbing, permissions and screens can be used
 * and tested without calling Claude.
 */
class OfflineModel implements AssistantModel {
  kind = 'offline' as const;

  async reply(req: ModelRequest): Promise<ModelReply> {
    const last = req.messages[req.messages.length - 1];
    const callTool = (name: string, input: Record<string, unknown>): ModelReply => ({
      content: [{ type: 'tool_use', id: `toolu_offline_${++toolCounter}`, name, input }],
      stopReason: 'tool_use',
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'offline',
    });
    const say = (text: string): ModelReply => ({ content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, model: 'offline' });

    if (last.role === 'user' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
      const result = last.content.find((b): b is ToolResultBlock => b.type === 'tool_result')!;
      const prev = req.messages[req.messages.length - 2];
      const call = prev && prev.role === 'assistant' && Array.isArray(prev.content) ? prev.content.find((b): b is ToolUseBlock => b.type === 'tool_use') : undefined;
      if (result.is_error) return say(`Sorry, I could not do that: ${result.content}`);
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(result.content) as Record<string, unknown>;
      } catch {
        /* plain text */
      }
      switch (call?.name) {
        case 'search_manual': {
          const hits = (data.results as { title: string; link: string | null; text: string; source?: string }[] | undefined) ?? [];
          if (!hits.length) {
            const question = String((call.input as { query?: string }).query ?? '');
            return callTool('log_unanswered', { question });
          }
          const top = hits[0] as { title: string; link: string | null; text: string; source?: string };
          const from = top.source === 'Answer from the show team' ? 'Here is what the show team says' : `Here is what the exhibitor manual says (${top.title})`;
          return say(`${from}:\n\n${top.text.slice(0, 600)}${top.link ? `\n\n[Read “${top.title}”](${top.link})` : ''}`);
        }
        case 'log_unanswered':
          return say('I could not find that in the exhibitor manual, so I have passed the question on to the show team to add. Would you like me to send it to them now? Just say “contact the team”.');
        case 'my_checklist': {
          const items = (data.items as { title: string; state: string; due: string | null; link: string }[] | undefined) ?? [];
          const open = items.filter((i) => !['Done', 'Approved', 'Not needed'].includes(i.state));
          if (!open.length) return say('You are all up to date. Nothing on your checklist is waiting.');
          return say(`Here is what is still to do:\n\n${open.map((i) => `- [${i.title}](${i.link})${i.due ? `, due ${i.due}` : ''} (${i.state})`).join('\n')}`);
        }
        case 'shop_overview': {
          const cats = (data.categories as { name: string; orderBy: string | null; ordered: boolean; link: string }[] | undefined) ?? [];
          if (!cats.length) return say('The shop has nothing to order for your stand yet.');
          return say(`Here is what you can order:\n\n${cats.map((c) => `- [${c.name}](${c.link})${c.ordered ? ' (already ordered)' : c.orderBy ? `, order by ${c.orderBy}` : ''}`).join('\n')}`);
        }
        case 'propose_contact_team':
          return say('I have written that up for the show team. Check it below and press “Send to the show team” if it looks right.');
        default:
          return say('Done.');
      }
    }

    const text = typeof last.content === 'string' ? last.content : last.content.map((b) => ('text' in b ? b.text : '')).join(' ');
    if (/\b(contact|human|person|someone|call me|speak to|talk to)\b/i.test(text) && /\b(team|person|someone|human|organiser|organizer)\b/i.test(text)) {
      return callTool('propose_contact_team', { subject: 'Question from the assistant', message: text.slice(0, 1000) });
    }
    if (/\b(due|deadline|to do|todo|checklist|outstanding|next)\b/i.test(text)) return callTool('my_checklist', {});
    if (/\b(order|power|electric|electrics|furniture|shop|buy|socket|hire)\b/i.test(text)) return callTool('shop_overview', {});
    return callTool('search_manual', { query: text.slice(0, 300) });
  }
}

// ---------------------------------------------------------------------------

let override: AssistantModel | null | undefined;

/** The model to use, or null when the assistant cannot run here (production without an API key). */
export function assistantModel(): AssistantModel | null {
  if (override !== undefined) return override;
  const e = env();
  if (e.ANTHROPIC_API_KEY) return new ClaudeModel(e.ANTHROPIC_API_KEY);
  const local = process.env.NODE_ENV !== 'production' || (process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION === 'true' && isLocalAddress(e.APP_URL));
  return local ? new OfflineModel() : null;
}

export function setAssistantModelForTests(model: AssistantModel | null) {
  override = model;
}

export function resetAssistantModelForTests() {
  override = undefined;
}

export { ClaudeModel, OfflineModel };
