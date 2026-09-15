import { describe, expect, it } from 'vitest';
import * as ds from '../../src/index';

/** Every component named in specs/002-adopt-design-system/contracts/components.md. */
export const CONTRACT_COMPONENTS = [
  // Shell
  'ThemeProvider',
  'AppShell',
  'Side',
  'Brand',
  'Nav',
  'NavGroup',
  'NavItem',
  'Main',
  'Panel',
  'PanelBlock',
  'Topbar',
  'Crumbs',
  'PageMeta',
  'ActionBar',
  'FocusLayout',
  // Primitives
  'Button',
  'Pill',
  'StatePill',
  'RequirementStatePill',
  'RiskBadge',
  'Notice',
  'RuntimeGlyph',
  'KeyFingerprint',
  'Mono',
  // Containers and lists
  'Card',
  'List',
  'ListRow',
  'Tabs',
  'Tab',
  'TabPanel',
  'KeyValue',
  'Table',
  'Stat',
  'StatGrid',
  'Meter',
  'Bars',
  // Forms
  'Field',
  'Input',
  'TextArea',
  'Select',
  'Segmented',
  'Chip',
  'Chips',
  'OptionRow',
  'Help',
  // Agent surfaces
  'Message',
  'ToolLog',
  'ToolLine',
  'DecisionCard',
  'GateCheck',
  'GateList',
  'Diff',
  'DiffFile',
  'DiffLine',
  'Stepper',
  'Step',
  'Terminal',
  'TermLine',
  'FindingRow',
  'AuditRow',
  'AuditTable',
] as const;

describe('public exports (contracts/components.md)', () => {
  it('exports every contracted component', () => {
    const isComponent = (v: unknown) =>
      typeof v === 'function' || (typeof v === 'object' && v !== null && '$$typeof' in v);
    const missing = CONTRACT_COMPONENTS.filter(
      (name) => !isComponent((ds as Record<string, unknown>)[name]),
    );
    expect(missing, `missing exports: ${missing.join(', ')}`).toEqual([]);
  });

  it('exports the state and risk mapping tables', () => {
    expect(ds.stateToPill).toBeTypeOf('object');
    expect(ds.requirementStateToPill).toBeTypeOf('object');
    expect(ds.riskToVariant).toBeTypeOf('object');
  });
});
