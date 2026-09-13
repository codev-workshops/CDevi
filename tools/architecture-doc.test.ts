import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(join(resolve(import.meta.dirname, '..'), 'docs/architecture.md'), 'utf8');

describe('docs/architecture.md describes CDevi (US7, SC-009)', () => {
  it('contains no terms from the unrelated product', () => {
    const banned = /workbook|duckdb|query-worker|query worker|stripe|credit|checkout|obvious\//i;
    const hits = doc.split('\n').filter((l) => banned.test(l));
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('keeps the transferable patterns and names the design-system package', () => {
    for (const term of [
      'packages/design-system',
      'outbox',
      'row-level security',
      'checkPermission',
      'specs/001',
      'specs/002',
    ]) {
      expect(doc, term).toContain(term);
    }
    expect(doc).not.toContain('packages/ui');
  });
});
