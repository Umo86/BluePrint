/**
 * Estimated cost of the assistant's calls to Claude, from the token counts the API reports.
 * Anthropic's list prices in US dollars per million tokens (platform.claude.com/docs/en/about-claude/pricing,
 * checked 27 October 2026). The Claude Console shows the exact bill; these are for keeping an eye on spend.
 */

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Prompt read from the cache (much cheaper than fresh input). */
  cacheReadTokens?: number;
  /** Prompt written to the cache (a little dearer than fresh input). */
  cacheWriteTokens?: number;
};

type Price = { input: number; cacheWrite: number; cacheRead: number; output: number };

export const ASSISTANT_PRICES: { prefix: string; label: string; price: Price }[] = [
  { prefix: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 } },
  // Prompts under 100,000 tokens, which the assistant's always are.
  { prefix: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 } },
  { prefix: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 } },
];

export function modelLabel(model: string) {
  return ASSISTANT_PRICES.find((p) => model.startsWith(p.prefix))?.label ?? model;
}

/** Estimated cost in US dollars; 0 for the offline stand-in and unknown models. */
export function estimateCostUsd(model: string, usage: TokenUsage) {
  const p = ASSISTANT_PRICES.find((x) => model.startsWith(x.prefix))?.price;
  if (!p) return 0;
  return (
    (usage.inputTokens * p.input + (usage.cacheWriteTokens ?? 0) * p.cacheWrite + (usage.cacheReadTokens ?? 0) * p.cacheRead + usage.outputTokens * p.output) / 1_000_000
  );
}

/** "$0.42", "$12.30", or "less than $0.01". */
export function formatUsd(amount: number) {
  if (amount > 0 && amount < 0.01) return 'less than $0.01';
  return `$${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
