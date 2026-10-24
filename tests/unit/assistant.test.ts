import { describe, expect, it } from 'vitest';
import { ClaudeModel } from '@/server/assistant/model';
import { STABLE_PROMPT } from '@/server/assistant';
import { TOOL_DEFS } from '@/server/assistant/tools';

describe('Claude requests', () => {
  it('sends the cached rules, this exhibitor’s details, the tools and the effort, and reads the reply', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [
            { type: 'text', text: 'Let me check the manual.' },
            { type: 'tool_use', id: 'toolu_1', name: 'search_manual', input: { query: 'deliveries' } },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } },
      );
    }) as typeof fetch;
    const model = new ClaudeModel('sk-ant-test', fakeFetch);
    const reply = await model.reply(
      { system: { stable: STABLE_PROMPT, dynamic: 'Today is …' }, messages: [{ role: 'user', content: 'Where do deliveries go?' }], tools: TOOL_DEFS, maxTokens: 4096 },
      { model: 'claude-sonnet-5-5', effort: 'low' },
    );
    expect(reply.stopReason).toBe('tool_use');
    expect(reply.content[1]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'search_manual', input: { query: 'deliveries' } });
    expect(reply.usage).toEqual({ inputTokens: 1200, outputTokens: 40 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(4096);
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system).toEqual([
      { type: 'text', text: STABLE_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Today is …' },
    ]);
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_DEFS.map((t) => t.name));
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'Where do deliveries go?' }]);
    // No sampling parameters: the current API version rejects them.
    expect(body).not.toHaveProperty('temperature');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization') ?? headers.get('x-api-key')).toContain('sk-ant-test');
  });

  it('describes every tool with a closed input schema', () => {
    for (const t of TOOL_DEFS) {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
});
