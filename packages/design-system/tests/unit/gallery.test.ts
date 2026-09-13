import { describe, expect, it } from 'vitest';
import { entries } from '../../gallery/entries';
import { ENTRY_NAMES } from '../visual/entries';
import { CONTRACT_COMPONENTS } from './exports.test';

describe('gallery coverage', () => {
  it('visual test entry list matches gallery entries', () => {
    expect(entries.map((e) => e.name)).toEqual([...ENTRY_NAMES]);
  });

  it('every contracted component is demonstrated in at least one entry usage snippet', () => {
    const usage = entries.map((e) => e.usage + e.title + e.description).join('\n');
    const aliases: Record<string, string> = {
      Nav: 'Side',
      AuditRow: 'AuditTable',
      TermLine: 'Terminal',
      ToolLine: 'ToolLog',
    };
    const missing = CONTRACT_COMPONENTS.filter((c) => !usage.includes(aliases[c] ?? c));
    expect(missing, `no gallery usage for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every entry has usage and an accessibility note', () => {
    for (const e of entries) {
      expect(e.usage.length, e.name).toBeGreaterThan(10);
      expect(e.a11y.length, e.name).toBeGreaterThan(20);
    }
  });
});
