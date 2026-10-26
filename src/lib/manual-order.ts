type ManualEntry = { id: string; parentId: string | null };

/** The manual in reading order: each top-level page, then the pages inside it, then the next one. */
export function readingOrder<T extends ManualEntry>(pages: T[]): T[] {
  const out: T[] = [];
  for (const top of pages.filter((p) => !p.parentId)) {
    out.push(top, ...pages.filter((p) => p.parentId === top.id));
  }
  return out;
}

/** The pages before and after one page, in reading order, for "previous" and "next" links. */
export function neighbours<T extends ManualEntry>(pages: T[], id: string): { previous: T | null; next: T | null } {
  const order = readingOrder(pages);
  const i = order.findIndex((p) => p.id === id);
  if (i < 0) return { previous: null, next: null };
  return { previous: order[i - 1] ?? null, next: order[i + 1] ?? null };
}
