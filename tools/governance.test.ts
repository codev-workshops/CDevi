import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RISK_LEVELS,
  WORKFLOW_STATES,
  riskToVariant,
  stateToPill,
} from '../packages/design-system/src/tokens';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('governance surfaces point at the design system (US6)', () => {
  const constitution = read('.specify/memory/constitution.md');
  const design = read('packages/design-system/DESIGN.md');
  const agents = read('AGENTS.md');
  const skill = read('.devin/skills/cdevi-design-system/SKILL.md');
  const planTemplate = read('.specify/templates/plan-template.md');
  const tasksTemplate = read('.specify/templates/tasks-template.md');

  it('constitution is 1.1.0, keeps its ratification date, and Principle III mandates the design system', () => {
    expect(constitution).toContain('**Version**: 1.1.0');
    expect(constitution).toContain('**Ratified**: 2026-09-11');
    const p3 = constitution.split('### III.')[1]!.split('### IV.')[0]!;
    expect(p3).toMatch(/MUST (be built from|use) .*@cdevi\/design-system/);
    expect(p3).toMatch(/new visual pattern MUST be added to the design-system package/i);
    expect(p3).toContain('packages/design-system/DESIGN.md');
  });

  it('plan template has a Design System Compliance section; tasks template requires tests and has the component task pattern', () => {
    expect(planTemplate).toContain('## Design System Compliance');
    expect(tasksTemplate).toContain('Design-system component task');
    expect(tasksTemplate).not.toContain('Tests are OPTIONAL');
    expect(tasksTemplate).toMatch(/Tests are REQUIRED/);
  });

  it('AGENTS.md and the skill link to DESIGN.md and the check command', () => {
    for (const doc of [agents, skill]) {
      expect(doc).toContain('packages/design-system/DESIGN.md');
      expect(doc).toContain('pnpm check');
    }
    expect(skill).toMatch(/^---\nname: cdevi-design-system\n/m);
    expect(skill).toMatch(/^description: .+/m);
  });

  it('DESIGN.md contains DR-01…DR-10 and every state and risk word from the mapping', () => {
    for (let i = 1; i <= 10; i++) expect(design).toContain(`DR-${String(i).padStart(2, '0')}`);
    for (const s of WORKFLOW_STATES) {
      expect(design, s).toContain(`\`${s}\``);
      expect(design, s).toContain(stateToPill[s].word);
    }
    for (const l of RISK_LEVELS) {
      expect(design, l).toContain(`\`${l}\``);
      expect(design, l).toContain(riskToVariant[l].word);
    }
  });

  it('the skill quotes the same state and risk words as the mapping', () => {
    for (const s of WORKFLOW_STATES) expect(skill, s).toContain(stateToPill[s].word);
    for (const l of RISK_LEVELS) expect(skill, l).toContain(riskToVariant[l].word);
  });
});
