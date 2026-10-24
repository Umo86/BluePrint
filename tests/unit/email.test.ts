import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStandardWebhook } from '@/server/security/webhook-signature';
import { signToken, verifyToken } from '@/server/security/signed-token';
import { reminderStep } from '@/server/services/reminders';
import { fillVars, renderEmail, safeLink } from '@/server/email/render';

const SECRET = `whsec_${Buffer.from('a-test-signing-secret-of-decent-length').toString('base64')}`;
function sign(id: string, ts: string, body: string, secret = SECRET) {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

describe('webhook signatures (Resend / Standard Webhooks)', () => {
  const now = Date.UTC(2027, 0, 10, 12, 0, 0);
  const ts = String(Math.floor(now / 1000));
  const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';

  it('accepts a correctly signed, recent request', () => {
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body), body, now })).toBe(true);
    // Several signatures (secret rotation): any valid one is enough.
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: `v1,bm90IHZhbGlk ${sign('msg_1', ts, body)}`, body, now })).toBe(true);
  });

  it('refuses tampering, other secrets, replays and missing parts', () => {
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body), body: body.replace('abc', 'xyz'), now })).toBe(false);
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_2', timestamp: ts, signature: sign('msg_1', ts, body), body, now })).toBe(false);
    const other = `whsec_${Buffer.from('another-secret').toString('base64')}`;
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body, other), body, now })).toBe(false);
    const old = String(Math.floor(now / 1000) - 600);
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: old, signature: sign('msg_1', old, body), body, now })).toBe(false);
    expect(verifyStandardWebhook({ secret: SECRET, id: null, timestamp: ts, signature: sign('msg_1', ts, body), body, now })).toBe(false);
    expect(verifyStandardWebhook({ secret: SECRET, id: 'msg_1', timestamp: 'soon', signature: sign('msg_1', ts, body), body, now })).toBe(false);
    expect(verifyStandardWebhook({ secret: '', id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body), body, now })).toBe(false);
  });
});

describe('signed links', () => {
  it('round-trips, and refuses edits or use for another purpose', () => {
    const t = signToken('unsubscribe', { e: 'amira@example.com', d: 'edition-1' });
    expect(verifyToken('unsubscribe', t)).toEqual({ e: 'amira@example.com', d: 'edition-1' });
    expect(verifyToken('something-else', t)).toBeNull();
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'victim@example.com', d: 'edition-1' })).toString('base64url');
    expect(verifyToken('unsubscribe', `${forged}.${sig}`)).toBeNull();
    expect(verifyToken('unsubscribe', `${payload}.`)).toBeNull();
    expect(verifyToken('unsubscribe', 'nonsense')).toBeNull();
  });
});

describe('reminder steps', () => {
  const DAY = 86_400_000;
  const deadline = new Date('2027-04-20T17:00:00Z');
  const at = (daysBefore: number) => new Date(deadline.getTime() - daysBefore * DAY);
  it('uses the closest step that has passed, then overdue', () => {
    expect(reminderStep(deadline, [14, 7, 1], at(20))).toBeNull();
    expect(reminderStep(deadline, [14, 7, 1], at(14))).toBe('d14');
    expect(reminderStep(deadline, [14, 7, 1], at(10))).toBe('d14');
    expect(reminderStep(deadline, [14, 7, 1], at(5))).toBe('d7');
    expect(reminderStep(deadline, [14, 7, 1], at(0.5))).toBe('d1');
    expect(reminderStep(deadline, [14, 7, 1], at(-1))).toBe('overdue');
    expect(reminderStep(deadline, [], at(3))).toBeNull();
  });
});

describe('email rendering', () => {
  const branding = { showName: 'UKCW London 2027', logoUrl: null, color: '#123456', footer: null };

  it('fills variables and only allows safe links', () => {
    expect(fillVars('Hi {{first_name}}, stand {{ stand }}{{unknown}}', { first_name: 'Amira', stand: 'N1-110' })).toBe('Hi Amira, stand N1-110');
    expect(safeLink('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLink('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('http://evil.example')).toBeNull();
  });

  it('escapes what people type and cleans the HTML block', async () => {
    const r = await renderEmail({
      subject: 'Hello {{company}}',
      blocks: [
        { type: 'heading', text: 'Welcome {{company}}' },
        { type: 'paragraph', text: 'Line one\nLine <b>two</b>' },
        { type: 'button', label: 'Open', url: '{{portal_link}}' },
        { type: 'button', label: 'Bad', url: 'javascript:alert(1)' },
        { type: 'html', html: '<p onclick="x()">Hi {{company}}<script>alert(1)</script></p><img src="https://track.example/p.gif">' },
      ],
      vars: { company: '<img src=x onerror=alert(1)>', portal_link: 'https://blueprint.example/portal/x' },
      branding,
      unsubscribeUrl: 'https://blueprint.example/unsubscribe/abc',
      baseUrl: 'https://blueprint.example',
    });
    expect(r.subject).toBe('Hello <img src=x onerror=alert(1)>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(r.html).toContain('Line one<br />Line &lt;b&gt;two&lt;/b&gt;');
    expect(r.html).toContain('href="https://blueprint.example/portal/x"');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).not.toContain('<script');
    expect(r.html).not.toContain('onclick');
    expect(r.html).toContain('#123456');
    expect(r.html).toContain('Unsubscribe from show updates');
    expect(r.text).toContain('Open: https://blueprint.example/portal/x');
    expect(r.text).toContain('Unsubscribe from show updates: https://blueprint.example/unsubscribe/abc');
  });

  it('lists the stand’s tasks in reminders', async () => {
    const r = await renderEmail({
      subject: 'Reminder',
      blocks: [{ type: 'tasks_due' }],
      vars: {},
      branding,
      due: [
        { title: 'Stand team <details>', due: '12 April', url: 'https://blueprint.example/t/1', overdue: false },
        { title: 'Insurance', due: '1 April', url: 'https://blueprint.example/t/2', overdue: true },
      ],
      baseUrl: 'https://blueprint.example',
    });
    expect(r.html).toContain('Stand team &lt;details&gt;');
    expect(r.html).toContain('Overdue: was due 1 April');
    expect(r.text).toContain('- Insurance (overdue, was due 1 April): https://blueprint.example/t/2');
  });
});
