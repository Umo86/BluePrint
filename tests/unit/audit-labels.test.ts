import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditDetailLines, hasAuditLabel } from '@/lib/audit-labels';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('audit log wording', () => {
  it('reads in plain English', () => {
    expect(auditActionLabel('auth.2fa_passed')).toBe('Passed two-factor');
    expect(auditActionLabel('shop.order_refunded')).toBe('Refunded an order');
    expect(auditActionLabel('space_only.approved_with_conditions')).toBe('Approved a space-only pack with conditions');
  });

  it('still makes sense of an action it has no wording for', () => {
    expect(auditActionLabel('shop.something_new')).toBe('Shop: something new');
    expect(auditActionLabel('mystery')).toBe('mystery');
  });

  it('shows details as short lines rather than raw data', () => {
    expect(auditDetailLines({ method: 'totp' })).toEqual(['Method: authenticator app']);
    expect(auditDetailLines({ stand: 'N1-110', viewingAs: true, empty: '' })).toEqual(['Stand: N1-110', 'Viewing as: true']);
    expect(auditDetailLines(null)).toEqual([]);
  });

  it('has wording for every action BluePrint records', () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/audit\(\s*[^,]+,\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)) {
        if (!hasAuditLabel(m[1])) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
