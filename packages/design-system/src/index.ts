// Shell
export {
  ActionBar,
  AppShell,
  Brand,
  Crumbs,
  FocusLayout,
  Main,
  Nav,
  NavGroup,
  NavItem,
  PageMeta,
  Panel,
  PanelBlock,
  Side,
  Topbar,
} from './components/AppShell/AppShell';
export type {
  ActionBarProps,
  AppShellProps,
  BrandProps,
  CrumbItem,
  CrumbsProps,
  FocusLayoutProps,
  NavGroupProps,
  NavItemProps,
  PageMetaProps,
  PanelBlockProps,
  SideProps,
  TopbarProps,
} from './components/AppShell/AppShell';
export { ThemeProvider, useTheme } from './components/ThemeProvider/ThemeProvider';
export type { ThemeProviderProps, ThemeSetting } from './components/ThemeProvider/ThemeProvider';

// Primitives
export { Button } from './components/Button/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button/Button';
export { Pill } from './components/Pill/Pill';
export { Notice } from './components/Notice/Notice';
export type { NoticeProps, NoticeTone } from './components/Notice/Notice';
export type { PillProps, PillVariant } from './components/Pill/Pill';
export { KeyFingerprint, Mono, RuntimeGlyph } from './components/Inline/Inline';
export type {
  KeyFingerprintProps,
  RuntimeGlyphProps,
  RuntimeKind,
} from './components/Inline/Inline';

// Containers and lists
export { Card, List, ListRow } from './components/Card/Card';
export type { CardProps, ListProps, ListRowProps } from './components/Card/Card';
export { Tab, TabPanel, Tabs } from './components/Tabs/Tabs';
export type { TabPanelProps, TabProps, TabsProps } from './components/Tabs/Tabs';
export { Bars, KeyValue, Meter, Stat, StatGrid, Table } from './components/Data/Data';
export type {
  Bar,
  BarsProps,
  KeyValueItem,
  KeyValueProps,
  MeterProps,
  StatGridProps,
  StatProps,
  TableColumn,
  TableProps,
} from './components/Data/Data';

// Forms
export {
  Chip,
  Chips,
  Field,
  Help,
  Input,
  OptionGroup,
  OptionRow,
  Segmented,
  Select,
  TextArea,
} from './components/Form/Form';
export type {
  ChipProps,
  ChipsProps,
  FieldProps,
  InputProps,
  OptionGroupProps,
  OptionRowProps,
  SegmentedOption,
  SegmentedProps,
  SelectProps,
  TextAreaProps,
} from './components/Form/Form';

// Agent surfaces
export {
  DecisionCard,
  Diff,
  DiffFile,
  DiffLine,
  GateCheck,
  GateList,
  Message,
  Step,
  Stepper,
  Terminal,
  TermLine,
  ToolLine,
  ToolLog,
} from './components/Agent/Agent';
export type {
  DecisionCardProps,
  DiffLineKind,
  DiffLineProps,
  DiffProps,
  GateCheckProps,
  GateListProps,
  GateState,
  MessageProps,
  MessageVariant,
  StepperProps,
  StepProps,
  StepState,
  TerminalProps,
  TermLineKind,
  TermLineProps,
  ToolLineKind,
  ToolLineProps,
  ToolLogProps,
} from './components/Agent/Agent';

// Control-plane vocabulary
export { StatePill } from './components/Pill/StatePill';
export type { StatePillProps } from './components/Pill/StatePill';
export { RequirementStatePill } from './components/Pill/RequirementStatePill';
export type { RequirementStatePillProps } from './components/Pill/RequirementStatePill';
export { RiskBadge } from './components/RiskBadge/RiskBadge';
export type { RiskBadgeProps } from './components/RiskBadge/RiskBadge';
export { AuditRow, AuditTable, FindingRow } from './components/Finding/Finding';
export type {
  AuditEvent,
  AuditRowProps,
  AuditTableProps,
  FindingEvidence,
  FindingRowProps,
} from './components/Finding/Finding';
export {
  REQUIREMENT_STATES,
  RISK_LEVELS,
  WORKFLOW_STATES,
  blockingToPill,
  cssVar,
  policyOutcomeToPill,
  requirementStateToPill,
  riskToVariant,
  semanticColor,
  severityToPill,
  stateToPill,
  tokenVersion,
} from './tokens';
export type {
  FindingBlocking,
  FindingSeverity,
  PolicyOutcome,
  RequirementState,
  RiskLevel,
  RiskPresentation,
  RiskVariant,
  StatePresentation,
  TokenName,
  WorkflowState,
} from './tokens';
