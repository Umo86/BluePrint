import { describe, expect, it } from 'vitest';
import { safeHref, visibleHost } from '@/components/chat-text';

describe('links in the assistant’s replies', () => {
  it('makes only BluePrint pages, files and https websites clickable', () => {
    expect(safeHref('/portal/ukcw/tasks/1')).toBe('/portal/ukcw/tasks/1');
    expect(safeHref('/files/abc')).toBe('/files/abc');
    expect(safeHref('https://www.ukconstructionweek.com/visit')).toBe('https://www.ukconstructionweek.com/visit');
    for (const bad of ['javascript:alert(1)', 'http://example.com', '//evil.example', '/admin', 'data:text/html,hi', 'https://user:pw@evil.example', '/portal\\..\\admin']) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it('shows where an outside link really goes when the label says something else', () => {
    expect(visibleHost('ukconstructionweek.com', 'https://evil.example/login')).toBe('evil.example');
    expect(visibleHost('the venue’s parking page', 'https://www.excel.london/parking')).toBe('excel.london');
    expect(visibleHost('excel.london', 'https://www.excel.london/parking')).toBeNull();
    expect(visibleHost('https://www.excel.london/parking', 'https://www.excel.london/parking')).toBeNull();
  });
});
