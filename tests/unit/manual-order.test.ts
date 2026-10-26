import { describe, expect, it } from 'vitest';
import { neighbours, readingOrder } from '@/lib/manual-order';

// As pagesForType returns them: sorted by position, sections and pages mixed together.
const pages = [
  { id: 'welcome', parentId: null },
  { id: 'rules', parentId: null },
  { id: 'deliveries', parentId: null },
  { id: 'heights', parentId: 'rules' },
  { id: 'fire', parentId: 'rules' },
  { id: 'timings', parentId: 'deliveries' },
];

describe('manual reading order', () => {
  it('reads each section, then the pages inside it', () => {
    expect(readingOrder(pages).map((p) => p.id)).toEqual(['welcome', 'rules', 'heights', 'fire', 'deliveries', 'timings']);
  });

  it('finds the previous and next page', () => {
    expect(neighbours(pages, 'welcome')).toEqual({ previous: null, next: pages[1] });
    expect(neighbours(pages, 'fire')).toEqual({ previous: pages[3], next: pages[2] });
    expect(neighbours(pages, 'timings')).toEqual({ previous: pages[2], next: null });
    expect(neighbours(pages, 'missing')).toEqual({ previous: null, next: null });
    expect(neighbours([pages[0]], 'welcome')).toEqual({ previous: null, next: null });
  });
});
