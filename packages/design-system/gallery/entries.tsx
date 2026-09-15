import { useState, type ReactNode } from 'react';
import {
  ActionBar,
  AppShell,
  AuditTable,
  Bars,
  Brand,
  Button,
  Card,
  Chip,
  Chips,
  Crumbs,
  DecisionCard,
  Diff,
  DiffFile,
  DiffLine,
  Field,
  FindingRow,
  FocusLayout,
  GateCheck,
  GateList,
  Help,
  Input,
  KeyFingerprint,
  KeyValue,
  List,
  ListRow,
  Main,
  Message,
  Meter,
  Mono,
  NavGroup,
  NavItem,
  Notice,
  OptionGroup,
  OptionRow,
  PageMeta,
  Panel,
  PanelBlock,
  Pill,
  REQUIREMENT_STATES,
  RISK_LEVELS,
  RequirementStatePill,
  RiskBadge,
  RuntimeGlyph,
  Segmented,
  Select,
  Side,
  Stat,
  StatGrid,
  StatePill,
  Step,
  Stepper,
  Tab,
  TabPanel,
  Table,
  Tabs,
  Terminal,
  TermLine,
  TextArea,
  ToolLine,
  ToolLog,
  Topbar,
  WORKFLOW_STATES,
} from '../src/index';

export interface GalleryEntry {
  name: string;
  title: string;
  description: string;
  usage: string;
  a11y: string;
  render: () => ReactNode;
  row?: boolean;
  shell?: boolean;
}

const swatch = (names: string[]) => (
  <div className="g-swatches">
    {names.map((n) => (
      <div key={n}>
        <i style={{ background: `var(--${n})` } as React.CSSProperties} />
        <b>{n}</b>
      </div>
    ))}
  </div>
);

function TabsDemo() {
  const [v, setV] = useState('transcript');
  return (
    <>
      <Tabs id="run" label="Run" value={v} onChange={setV}>
        <Tab value="transcript">Transcript</Tab>
        <Tab value="changes" count={3}>
          Changes
        </Tab>
        <Tab value="tests" count="18 ✓">
          Tests
        </Tab>
        <Tab value="evidence" count="2/5">
          Evidence
        </Tab>
        <Tab value="disabled" disabled>
          Disabled
        </Tab>
      </Tabs>
      <TabPanel value="transcript" current={v} tabsId="run">
        Transcript panel
      </TabPanel>
      <TabPanel value="changes" current={v} tabsId="run">
        Changes panel
      </TabPanel>
      <TabPanel value="tests" current={v} tabsId="run">
        Tests panel
      </TabPanel>
      <TabPanel value="evidence" current={v} tabsId="run">
        Evidence panel
      </TabPanel>
    </>
  );
}

function FormDemo() {
  const [rt, setRt] = useState<'cloud' | 'laptop'>('cloud');
  const [gates, setGates] = useState<Record<string, boolean>>({
    tests: true,
    secret: true,
    ci: true,
    human: true,
    merged: false,
  });
  const [opt, setOpt] = useState('b');
  return (
    <Card>
      <Field label="Repository">
        <Select defaultValue="payments-api">
          <option value="payments-api">payments-api</option>
          <option value="web-app">web-app</option>
        </Select>
      </Field>
      <Field
        label="Brief"
        hint="@ to mention a path"
        help="Every default comes from the repository settings."
      >
        <TextArea defaultValue="Implement FR-042-01 to FR-042-04 from specs/042-rate-limiting/spec.md." />
      </Field>
      <Field label="Budget" error="Must be at most $50">
        <Input defaultValue="$ 500" />
      </Field>
      <Field label="Runtime" hint="your decision, per task">
        <Segmented<'cloud' | 'laptop'>
          label="Runtime"
          value={rt}
          onChange={setRt}
          options={[
            { value: 'cloud', label: 'Cloud sandbox' },
            { value: 'laptop', label: 'My laptop (nadeesha-mbp)' },
          ]}
        />
        <Help>
          Cloud: fresh sandbox, key injected from the vault. Laptop: your checkout and your key.
        </Help>
      </Field>
      <Field label="Gates">
        <Chips label="Required gates">
          {Object.entries(gates).map(([k, v]) => (
            <Chip key={k} selected={v} onToggle={(s) => setGates({ ...gates, [k]: s })}>
              {k}
            </Chip>
          ))}
        </Chips>
      </Field>
      <OptionGroup legend="Clarification: how should rate limiting apply?">
        <OptionRow name="limiter" value="a" checked={opt === 'a'} onChange={setOpt}>
          Per IP only
        </OptionRow>
        <OptionRow name="limiter" value="b" checked={opt === 'b'} onChange={setOpt} recommended>
          Per IP and per authenticated account
        </OptionRow>
        <OptionRow name="limiter" value="c" checked={opt === 'c'} onChange={setOpt} disabled>
          Per account only (unavailable)
        </OptionRow>
      </OptionGroup>
      <ActionBar help="Saving validates the key with one models-list call.">
        <Button variant="ghost">Save draft</Button>
        <Button variant="saffron">Delegate</Button>
      </ActionBar>
    </Card>
  );
}

function GateDemo() {
  const [ok, setOk] = useState(false);
  return (
    <Card>
      <GateList label="Gates">
        <GateCheck state="ok" label="Tests passed · 42 of 42" source="runner:local · low trust" />
        <GateCheck state="ok" label="CI passed · 4 checks" source="github_checks · high" />
        <GateCheck state="bad" label="No secret in diff" source="runner · high" />
        <GateCheck
          state="override"
          label='Spec analyzed · overridden by Kasun: "agreed in standup"'
          source="override:kasun"
        />
        <GateCheck state="wait" label="Human approval" source="you" />
        <GateCheck state="pending" label="PR merged" source="github" />
      </GateList>
      <p className="cd-section-label">Acceptance criteria — tick each to approve</p>
      <GateList label="Acceptance criteria">
        <GateCheck state="ok" label="Sessions survive an app restart" onToggle={() => {}} />
        <GateCheck
          state={ok ? 'ok' : 'pending'}
          label="Legacy /session/v1 kept behind a flag"
          onToggle={setOk}
        />
      </GateList>
    </Card>
  );
}

const shell = (variant: 'framed' | 'full') => (
  <AppShell
    variant={variant}
    side={
      <Side
        brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}
        footer={
          <>
            <span className="cd-av" aria-hidden="true">
              AC
            </span>{' '}
            <span className="cd-label">acme · Nadeesha</span>
          </>
        }
      >
        <NavItem href="#dashboard">Dashboard</NavItem>
        <NavItem href="#approvals" active count={4}>
          Approvals
        </NavItem>
        <NavItem href="#workflows">Workflows</NavItem>
        <NavItem href="#requirements">Requirements</NavItem>
        <NavGroup>Administration</NavGroup>
        <NavItem href="#policies">Policies</NavItem>
        <NavItem href="#audit">Audit log</NavItem>
      </Side>
    }
    panel={
      <Panel>
        <PanelBlock title="Today">
          <KeyValue
            items={[
              { term: 'Runs started', detail: '9' },
              { term: 'Verified', detail: '5' },
            ]}
          />
        </PanelBlock>
        <PanelBlock title="Budget">
          <Meter label="Model cost" value={1.12} max={5} />
          <Help>$1.12 of $5.00</Help>
        </PanelBlock>
      </Panel>
    }
  >
    <Main>
      <Crumbs
        items={[
          { label: 'Workflows', href: '#w' },
          { label: 'PAY-1391', href: '#p' },
          { label: 'Implementation' },
        ]}
      />
      <Topbar
        title="Implement refund processing"
        actions={
          <>
            <StatePill state="WAITING_FOR_HUMAN" />
            <Button variant="ghost" size="sm">
              Pause
            </Button>
            <Button variant="danger" size="sm">
              Cancel run
            </Button>
          </>
        }
      />
      <PageMeta>
        <span>Implementation Agent</span>
        <span>claude-sonnet-4.5</span>
        <RuntimeGlyph kind="cloud" label="cloud · sbx-7c1e" />
        <KeyFingerprint>8f2a</KeyFingerprint>
        <span>14 min of 120</span>
        <span>
          branch <Mono>agent/PAY-1391-refund</Mono>
        </span>
      </PageMeta>
      <List>
        <ListRow
          title="Open a pull request against main"
          trailing={<StatePill state="WAITING_FOR_HUMAN" />}
          ask="Approve: push 3 files (+112 −1) and open a draft PR"
          meta="payments-api · asked 4 min ago · times out in 3 h 56 m"
        />
        <ListRow
          title="Running integration tests"
          trailing={<StatePill state="RUNNING" />}
          meta="12 min · 3 files"
        />
      </List>
    </Main>
  </AppShell>
);

export const entries: GalleryEntry[] = [
  {
    name: 'Tokens',
    title: 'Colour tokens',
    description:
      'Saffron for anything that needs a person and for the one primary action; indigo for running and links; green for verified and evidence; red for failed and blocked.',
    usage: `import '@cdevi/design-system/css';\n<div class="cd-root">…</div>\n/* colours: var(--saffron), var(--ink-2) … see tokens/tokens.json */`,
    a11y: 'Every text/background pair used by components meets WCAG 2.2 AA in both themes (tokens/pairs.json, checked in CI).',
    render: () =>
      swatch([
        'canvas',
        'surface',
        'surface-2',
        'ink',
        'ink-2',
        'ink-3',
        'line',
        'line-2',
        'line-strong',
        'saffron',
        'saffron-soft',
        'saffron-ink',
        'saffron-strong',
        'indigo',
        'indigo-soft',
        'green',
        'green-soft',
        'red',
        'red-soft',
        'code-bg',
      ]),
  },
  {
    name: 'Button',
    title: 'Buttons',
    description:
      'Primary (ink), saffron (the single "needs you" action on a screen), ghost, danger; sizes md/sm; disabled and loading.',
    usage: `<Button>Save</Button>\n<Button variant="saffron">Approve</Button>\n<Button variant="ghost" size="sm">Pause</Button>\n<Button variant="danger">Cancel run</Button>\n<Button href="/runs">Link</Button>\n<Button loading>Saving</Button>`,
    a11y: 'Renders <button type="button"> or <a>. Enter/Space activate. Disabled uses the attribute; disabled links get aria-disabled and lose href. Loading sets aria-busy. Hover, active and focus-visible states are styled.',
    row: true,
    render: () => (
      <>
        <Button>Primary</Button>
        <Button variant="saffron">Approve</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Cancel run</Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Saving</Button>
        <Button href="#link">Link</Button>
      </>
    ),
  },
  {
    name: 'Pill',
    title: 'Pills',
    description:
      'State is always a word in a pill (DR-01). Seven variants; run pulses (not under reduced motion).',
    usage: `<Pill variant="run" pulse>running</Pill>\n<Pill variant="wait">awaiting evidence</Pill>\n<Pill variant="needs-you">needs you</Pill>\n<Pill variant="blocked">blocked</Pill>\n<Pill variant="fail">failed</Pill>\n<Pill variant="done">verified</Pill>\n<Pill variant="neutral">paused offline</Pill>`,
    a11y: 'The text is the accessible name; the dot is aria-hidden. Colour is never the only signal.',
    row: true,
    render: () => (
      <>
        <Pill variant="run" pulse>
          running
        </Pill>
        <Pill variant="wait">awaiting evidence</Pill>
        <Pill variant="needs-you">needs you</Pill>
        <Pill variant="blocked">blocked</Pill>
        <Pill variant="fail">failed</Pill>
        <Pill variant="done">verified</Pill>
        <Pill variant="neutral">paused offline</Pill>
      </>
    ),
  },
  {
    name: 'StatePill',
    title: 'Workflow states',
    description:
      'All nine specs/001 workflow states through the normative mapping. BLOCKED and WAITING_FOR_HUMAN are the most prominent and must never be hidden.',
    usage: `<StatePill state="WAITING_FOR_HUMAN" />\n<StatePill state="BLOCKED" />\n// mapping: stateToPill[state] → { variant, word, pulse }`,
    a11y: 'Word from the mapping is the accessible name; data-state carries the enum for tests and analytics.',
    row: true,
    render: () => (
      <>
        {WORKFLOW_STATES.map((s) => (
          <StatePill key={s} state={s} />
        ))}
      </>
    ),
  },
  {
    name: 'RequirementStatePill',
    title: 'Requirement states',
    description:
      'All eight specs/001 requirement lifecycle states (FR-009) through the normative mapping. Requirement states are not workflow states: NEEDS_CLARIFICATION is the only "needs you" state, ANALYZING and IN_IMPLEMENTATION pulse.',
    usage: `<RequirementStatePill state="NEEDS_CLARIFICATION" />\n<RequirementStatePill state="READY" />\n// mapping: requirementStateToPill[state] → { variant, word, pulse }`,
    a11y: 'Word from the mapping is the accessible name; data-state carries the enum for tests and analytics.',
    row: true,
    render: () => (
      <>
        {REQUIREMENT_STATES.map((s) => (
          <RequirementStatePill key={s} state={s} />
        ))}
      </>
    ),
  },
  {
    name: 'RiskBadge',
    title: 'Risk levels',
    description:
      'LOW, MEDIUM, HIGH, CRITICAL as words. HIGH and CRITICAL are prominent; CRITICAL is saffron-strong with a red border — not the failed look.',
    usage: `<RiskBadge level="CRITICAL" />\n// mapping: riskToVariant[level] → { variant, word, prominent }`,
    a11y: 'Accessible name ends with "risk". Never the sole indicator of risk on a row; pair with the action text.',
    row: true,
    render: () => (
      <>
        {RISK_LEVELS.map((l) => (
          <RiskBadge key={l} level={l} />
        ))}
      </>
    ),
  },
  {
    name: 'Inline',
    title: 'Runtime glyph, key fingerprint, mono',
    description:
      'Runtime and the paying credential appear on every run surface. Only the fingerprint of a key is ever shown.',
    usage: `<RuntimeGlyph kind="cloud" label="cloud · sbx-7c1e" />\n<RuntimeGlyph kind="laptop" label="laptop · nadeesha-mbp" />\n<KeyFingerprint>8f2a</KeyFingerprint>\n<Mono>src/middleware/auth.ts</Mono>`,
    a11y: 'Glyph svg is aria-hidden; the label is required text. KeyFingerprint is <code aria-label="key ending in …">.',
    row: true,
    render: () => (
      <>
        <RuntimeGlyph kind="cloud" label="cloud · sbx-7c1e" />
        <RuntimeGlyph kind="laptop" label="laptop · nadeesha-mbp" />
        <KeyFingerprint>8f2a</KeyFingerprint>
        <Mono>src/middleware/auth.ts</Mono>
      </>
    ),
  },
  {
    name: 'List',
    title: 'List rows',
    description:
      'Gate rows carry the exact question so a decision can be made from the list. Empty state is explicit.',
    usage: `<List loading />\n<List empty="No runs yet.">\n  <ListRow title="…" href="/runs/1" trailing={<StatePill state="WAITING_FOR_HUMAN" />} ask="Approve: open a PR against main" meta="payments-api · asked 4 min ago" />\n</List>`,
    a11y: 'role=list / listitem; a gate row is aria-describedby its ask; the title is a link when href is given; `loading` sets aria-busy and shows skeleton rows (hidden from AT) so loading is never read as empty.',
    render: () => (
      <>
        <List>
          <ListRow
            title="Add rate limiting to /api/auth"
            href="#run-1"
            trailing={<StatePill state="WAITING_FOR_HUMAN" />}
            ask={
              <>
                Approve: open a pull request against <Mono>main</Mono>
              </>
            }
            meta={
              <>
                payments-api · Claude Code · <RuntimeGlyph kind="cloud" label="cloud" /> ·{' '}
                <KeyFingerprint>8f2a</KeyFingerprint> · asked 4 min ago
              </>
            }
          />
          <ListRow
            title="Fix flaky checkout test"
            trailing={<StatePill state="RUNNING" />}
            meta="storefront · 12 min · 3 files · $0.84 of $5"
          />
          <ListRow
            title="Migrate sessions to Redis"
            trailing={<StatePill state="BLOCKED" />}
            meta="web-app · GitHub App disconnected"
          />
          <ListRow
            title="Bump dependencies (weekly)"
            trailing={<StatePill state="COMPLETED" />}
            meta="PR #412 merged · CI passed"
          />
        </List>
        <List empty="Nothing needs you right now." />
        <List loading aria-label="Loading example" />
      </>
    ),
  },
  {
    name: 'Notice',
    title: 'Notice',
    description:
      'Inline message: `info` for polite status (session expired, demonstration data), `error` for failures with an action such as Retry. Never used for workflow state — that is a pill.',
    usage: `<Notice tone="error" action={<Button variant="ghost">Retry</Button>}>Couldn't load the Inbox.</Notice>\n<Notice tone="info">You are looking at demonstration data.</Notice>`,
    a11y: 'tone="info" renders role="status" (polite); tone="error" renders role="alert". The action is a real Button; text colour on the tinted background is contrast-checked in both themes.',
    render: () => (
      <>
        <Notice tone="info">You are looking at demonstration data.</Notice>
        <Notice tone="error" action={<Button variant="ghost">Retry</Button>}>
          Couldn&apos;t load the Inbox.
        </Notice>
      </>
    ),
  },
  {
    name: 'Tabs',
    title: 'Tabs',
    description: 'Controlled tab list with counts and a disabled tab.',
    usage: `<Tabs id="run" label="Run" value={v} onChange={setV}>\n  <Tab value="transcript">Transcript</Tab>\n  <Tab value="changes" count={3}>Changes</Tab>\n</Tabs>\n<TabPanel value="transcript" current={v} tabsId="run">…</TabPanel>`,
    a11y: 'role=tablist/tab/tabpanel; ←/→ Home/End move focus and select (roving tabindex); aria-selected and aria-controls are set; the panel is focusable.',
    render: () => <TabsDemo />,
  },
  {
    name: 'Form',
    title: 'Form fields',
    description:
      'Field rows with label, hint, help and error; inputs, select, textarea; segmented control; toggle chips; option rows; action bar.',
    usage: `<Field label="Budget" help="Per run" error="Too high"><Input /></Field>\n<Field label="Repository"><Select>…</Select></Field>\n<Field label="Brief"><TextArea /></Field>\n<Help>Cloud: fresh sandbox.</Help>\n<Segmented label="Runtime" value={v} onChange={setV} options={[…]} />\n<Chips label="Gates"><Chip selected onToggle={…}>tests passed</Chip></Chips>\n<OptionGroup legend="Clarification"><OptionRow name="q" value="b" checked onChange={…} recommended>…</OptionRow></OptionGroup>`,
    a11y: 'Label is associated via htmlFor; help/error are aria-describedby; error sets aria-invalid and role=alert. Segmented is a radiogroup of role=radio buttons with arrow keys. Chips are aria-pressed buttons. OptionRow wraps a real radio input; OptionGroup is a fieldset whose legend names the radiogroup.',
    render: () => <FormDemo />,
  },
  {
    name: 'Data',
    title: 'Key-value, stats, meter, bars, table',
    description:
      'Numbers with labels, budget meters, small charts and the data table (regression: the table class is cd-table).',
    usage: `<KeyValue items={[{ term: 'Base', detail: 'main' }]} />\n<StatGrid columns={4}><Stat value="18" label="Active workflows" /></StatGrid>\n<Meter label="Model cost" value={1.12} max={5} />\n<Bars label="Cost by day" values={[{ value: 5 }, { value: 8, local: true }]} />\n<Table caption="Runs" columns={cols} rows={rows} rowKey={(r) => r.id} />`,
    a11y: 'Meter uses role=meter with aria-valuenow/min/max; Bars is role=img with a summary label; Table has a caption and scope=col headers. Dynamic widths go through --cd-meter-value / --cd-bar-value (the only allow-listed dynamic style).',
    render: () => (
      <>
        <StatGrid columns={4}>
          <Stat value="18" label="Active workflows" />
          <Stat value="11" label="Running agents" />
          <Stat value="27" label="PRs generated" />
          <Stat value="2" label="Incidents" />
        </StatGrid>
        <Card>
          <KeyValue
            items={[
              { term: '#431', detail: 'Migrate sessions to Redis' },
              { term: 'Base', detail: <Mono>main</Mono> },
              { term: 'Diff', detail: '7 files · +214 −88' },
            ]}
          />
        </Card>
        <Card>
          <Meter label="Model cost" value={1.12} max={5} />
          <Help>$1.12 of $5.00</Help>
          <Meter label="Minutes" value={110} max={120} warn />
          <Help>110 of 120 minutes</Help>
          <Bars
            label="Model cost by day, cloud vs laptop"
            values={[
              { value: 30 },
              { value: 14, local: true },
              { value: 52 },
              { value: 20, local: true },
              { value: 71 },
              { value: 31, local: true },
              { value: 90 },
              { value: 40, local: true },
            ]}
          />
        </Card>
        <Table
          caption="Recent runs"
          columns={[
            {
              key: 'run',
              header: 'Run',
              cell: (r: {
                id: string;
                task: string;
                cost: string;
                state: (typeof WORKFLOW_STATES)[number];
              }) => <Mono>{r.id}</Mono>,
            },
            { key: 'task', header: 'Task', cell: (r) => r.task },
            { key: 'cost', header: 'Cost', cell: (r) => r.cost, align: 'end' },
            { key: 'state', header: 'Outcome', cell: (r) => <StatePill state={r.state} /> },
          ]}
          rows={[
            { id: '#41a0', task: 'Sliding-window limiter', cost: '$1.12', state: 'RUNNING' },
            {
              id: '#4198',
              task: 'Migrate sessions to Redis',
              cost: '$2.38',
              state: 'WAITING_FOR_HUMAN',
            },
            { id: '#4187', task: 'Bump dependencies', cost: '$0.31', state: 'COMPLETED' },
          ]}
          rowKey={(r) => r.id}
        />
      </>
    ),
  },
  {
    name: 'Decision',
    title: 'Decision card',
    description:
      'An approval or clarification raised by an agent, in the flow where it was raised. Saffron tone when a person must act; neutral for pre-filled or informational cards.',
    usage: `<DecisionCard title="Open a pull request against main?" badge={<Pill variant="wait">external</Pill>} description="…" actions={<><Button variant="saffron">Approve</Button><Button variant="ghost">Not now</Button></>} />`,
    a11y: 'A <section aria-labelledby> with an h3 title. Exactly one saffron button per screen (DR-02).',
    render: () => (
      <>
        <DecisionCard
          title="Open a pull request against main?"
          badge={<Pill variant="wait">external</Pill>}
          description={
            <>
              Pushes <Mono>cdevi/t002-sliding-window</Mono> (3 files, +112 −1) and opens a draft PR.
              main is protected, so this always asks. Times out in 3 h 52 m.
            </>
          }
          actions={
            <>
              <Button variant="saffron">Approve</Button>
              <Button variant="ghost">Not now</Button>
              <Button variant="ghost">Approve for this run</Button>
            </>
          }
        />
        <DecisionCard
          tone="neutral"
          title="What should the response be when the limit is exceeded?"
          badge={<Pill variant="neutral">text</Pill>}
          description="Pre-filled from the brief."
          actions={<Button>Answer</Button>}
        >
          <Input
            aria-label="Your answer"
            defaultValue='429 with a Retry-After header; JSON body { error: "rate_limited" }'
          />
        </DecisionCard>
      </>
    ),
  },
  {
    name: 'Gates',
    title: 'Gate checklist (evidence)',
    description:
      'Every required gate with its source and trust. Overrides are saffron, never green (DR-04). Toggleable rows are real checkboxes.',
    usage: `<GateList label="Gates">\n  <GateCheck state="ok" label="CI passed" source="github_checks · high" />\n  <GateCheck state="override" label="Spec analyzed" source="override:kasun" />\n  <GateCheck state="pending" label="Legacy endpoint kept" onToggle={setOk} />\n</GateList>`,
    a11y: 'Non-interactive boxes are role=img with the state as name (passed / waiting / failed / overridden / not yet checked). Toggleable rows wrap <input type="checkbox">.',
    render: () => <GateDemo />,
  },
  {
    name: 'Transcript',
    title: 'Transcript message and tool log',
    description:
      "The agent's words as prose, its tools as a compact log. The agent's summary is labelled as not evidence (DR-03).",
    usage: `<Message who="Claude Code" when="14:02">…</Message>\n<ToolLog>\n  <ToolLine kind="read">read </ToolLine> src/lib/redis.ts\n</ToolLog>\n<Message who="You · steer" when="14:16" variant="user">…</Message>\n<Message who="Summary from the agent" variant="summary">…</Message>`,
    a11y: 'Each message is an <article aria-label="who, when">. The tool log is a labelled <pre>.',
    render: () => (
      <>
        <Message who="Claude Code" when="14:02">
          I read the spec and AGENTS.md. Plan: add <Mono>rateLimit.ts</Mono> with a sliding window
          over the existing Redis client.
        </Message>
        <ToolLog>
          <ToolLine kind="read">read </ToolLine> src/lib/redis.ts{' '}
          <ToolLine kind="dim">· read</ToolLine>
          {'\n'}
          <ToolLine kind="write">edit </ToolLine> src/middleware/rateLimit.ts +64{' '}
          <ToolLine kind="dim">· write_local</ToolLine>
          {'\n'}
          <ToolLine kind="read">bash </ToolLine> pnpm test -- rateLimit{' '}
          <ToolLine kind="ok">✓ 18 passed</ToolLine>
          {'\n'}
          <ToolLine kind="read">bash </ToolLine> pnpm lint{' '}
          <ToolLine kind="error">✗ 2 errors</ToolLine>
        </ToolLog>
        <Message who="You · steer" when="14:16" variant="user">
          Before the PR, add a test for the Retry-After header value.
        </Message>
        <Message who="Summary from the agent" variant="summary">
          Moved session storage from memory to Redis using the existing client and kept the cookie
          unchanged.
        </Message>
      </>
    ),
  },
  {
    name: 'Diff',
    title: 'Diff',
    description: 'Unified diff with file headers.',
    usage: `<Diff>\n  <DiffFile>src/middleware/auth.ts</DiffFile>\n  <DiffLine>import { requireSession } from './session';</DiffLine>\n  <DiffLine kind="add">import { rateLimit } from './rateLimit';</DiffLine>\n  <DiffLine kind="del">router.post('/api/auth/login', login);</DiffLine>\n</Diff>`,
    a11y: 'A labelled <pre>; +/− prefixes are in the text so meaning does not depend on colour.',
    render: () => (
      <Diff>
        <DiffFile>src/middleware/auth.ts</DiffFile>
        <DiffLine>
          import {'{'} requireSession {'}'} from './session';
        </DiffLine>
        <DiffLine kind="add">
          import {'{'} rateLimit {'}'} from './rateLimit';
        </DiffLine>
        <DiffLine kind="del">router.post('/api/auth/login', login);</DiffLine>
        <DiffLine kind="add">router.post('/api/auth/login', limited, login);</DiffLine>
      </Diff>
    ),
  },
  {
    name: 'Stepper',
    title: 'Stepper',
    description: 'Stage progress: done, current, to do.',
    usage: `<Stepper label="Spec Kit stages">\n  <Step state="done" title="1 Specify" detail="spec.md written" />\n  <Step state="current" title="2 Clarify" detail="3 questions" />\n  <Step title="3 Plan" />\n</Stepper>`,
    a11y: 'An <ol>; the current step has aria-current="step"; done steps carry a visually hidden "(done)".',
    render: () => (
      <Stepper label="Spec Kit stages">
        <Step state="done" title="1 Specify" detail="spec.md written" />
        <Step state="current" title="2 Clarify" detail="3 questions · 1 answered" />
        <Step title="3 Plan" detail="plan.md, research.md" />
        <Step title="4 Tasks" />
        <Step title="5 Analyze" />
      </Stepper>
    ),
  },
  {
    name: 'Terminal',
    title: 'Terminal',
    description: 'CLI output block.',
    usage: `<Terminal>\n  <TermLine kind="prompt">$</TermLine> cdevi link\n  <TermLine kind="good">✓</TermLine> Linked\n</Terminal>`,
    a11y: 'A labelled <pre>. Glyphs (✓ ? !) are text.',
    render: () => (
      <Terminal>
        <TermLine kind="prompt">~/code/payments-api $</TermLine> cdevi link{'\n'}
        <TermLine kind="good">✓</TermLine> Linked to acme/payments-api{'\n'}
        <TermLine kind="warn">?</TermLine> Should the limiter apply per IP, per account, or both?
        {'\n'}
        <TermLine kind="dim">Answer here, or from the web inbox.</TermLine>
      </Terminal>
    ),
  },
  {
    name: 'Finding',
    title: 'Review finding',
    description:
      'An AI review finding with severity, blocking class, lane, description, impact, evidence, recommended fix and actions (specs/001 FR-020).',
    usage: `<FindingRow severity="HIGH" blocking="BLOCKING" lane="Security" title="…" description="…" impact="…" evidence={[{ label: 'RefundController.java:84', href }]} fix="…" actions={<>…</>} />`,
    a11y: 'An <article aria-labelledby> with words for severity and blocking class; evidence items are links.',
    render: () => (
      <>
        <FindingRow
          severity="HIGH"
          blocking="BLOCKING"
          lane="Security"
          title="Refund endpoint does not verify authorization against the original payment owner"
          description="POST /refunds issues the refund without checking that the caller owns the payment."
          impact="A user may potentially refund another user's payment."
          evidence={[{ label: 'RefundController.java:84', href: '#l84' }]}
          fix="Validate payment ownership before processing."
          actions={
            <>
              <Button size="sm">Apply Fix</Button>
              <Button size="sm" variant="ghost">
                Dismiss
              </Button>
              <Button size="sm" variant="ghost">
                Create Jira Issue
              </Button>
            </>
          }
        />
        <FindingRow
          severity="LOW"
          blocking="SUGGESTION"
          lane="General"
          title="Extract WINDOW_MS into config"
          fix="Read from RATE_LIMIT_WINDOW_MS with the current default."
        />
      </>
    ),
  },
  {
    name: 'Audit',
    title: 'Audit log',
    description:
      'Every autonomous action and human decision with actor, action, target, workflow, policy, risk and result (specs/001 FR-029).',
    usage: `<AuditTable events={[{ id, time, actor, action, target, workflow, policy, risk: 'MEDIUM', result }]} />`,
    a11y: 'A data table with caption and column headers; risk is a RiskBadge word.',
    render: () => (
      <AuditTable
        events={[
          {
            id: '1',
            time: '10:42:12',
            actor: 'Implementation Agent',
            action: 'Modified file',
            target: 'RefundService.java',
            workflow: 'PAY-1391',
            policy: 'Implementation Policy v3',
            risk: 'MEDIUM',
            result: <Pill variant="done">success</Pill>,
          },
          {
            id: '2',
            time: '10:44:03',
            actor: 'Implementation Agent',
            action: 'Open PR against main',
            target: 'PR #1821',
            workflow: 'PAY-1391',
            policy: 'Protected branches v1',
            risk: 'HIGH',
            result: <Pill variant="needs-you">approval required</Pill>,
          },
          {
            id: '3',
            time: '10:51:40',
            actor: 'Kasun',
            action: 'Approved PR merge',
            target: 'PR #1821',
            workflow: 'PAY-1391',
            policy: 'Protected branches v1',
            risk: 'HIGH',
            result: <Pill variant="done">approved</Pill>,
          },
          {
            id: '4',
            time: '11:02:19',
            actor: 'Release Agent',
            action: 'Deploy production',
            target: 'payments-api',
            workflow: 'PAY-1387',
            policy: 'Production deployment v2',
            risk: 'CRITICAL',
            result: <Pill variant="blocked">denied</Pill>,
          },
        ]}
      />
    ),
  },
  {
    name: 'Shell',
    title: 'App shell (framed)',
    description:
      'Sidebar, main and right panel. The framed variant is used by the reference screens; applications use variant="full" (default), which fills the viewport and collapses to an icon rail and then a top bar with a menu at narrow widths.',
    usage: `<ThemeProvider theme="system">\n  <AppShell side={<Side brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}>\n      <NavItem href="/approvals" active count={4}>Approvals</NavItem>\n      <NavGroup>Administration</NavGroup>\n    </Side>} panel={<Panel><PanelBlock title="Today">…</PanelBlock></Panel>}>\n    <Main>\n      <Crumbs items={…} />\n      <Topbar title="…" actions={…} />\n      <PageMeta>…</PageMeta>\n      …\n      <ActionBar help="…"><Button variant="saffron">Approve</Button></ActionBar>\n    </Main>\n  </AppShell>\n</ThemeProvider>`,
    a11y: 'Landmarks: aside[aria-label=Primary] with nav, main, aside[aria-label=Details]. Active nav item has aria-current=page; counts announce "n pending"; the menu toggle reports aria-expanded. No sticky headers (DR-05).',
    shell: true,
    render: () => shell('framed'),
  },
  {
    name: 'FocusLayout',
    title: 'Focus layout',
    description:
      'One centred card on the canvas for focused flows such as sign-in. Renders the main landmark.',
    usage: `<FocusLayout brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}>\n  <h1>Sign in to CDevi</h1>\n  <Field label="Email"><Input type="email" /></Field>\n  <Button variant="saffron">Sign in</Button>\n</FocusLayout>`,
    a11y: 'Renders <main class="cd-root cd-focus">; the page must not render a second main. Contains exactly one card; the single saffron button per screen rule (DR-02) applies to the form inside.',
    render: () => (
      <FocusLayout brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}>
        <h1>Sign in to CDevi</h1>
        <Field label="Email" htmlFor="g-focus-email">
          <Input id="g-focus-email" type="email" autoComplete="username" />
        </Field>
        <Field label="Password" htmlFor="g-focus-pw">
          <Input id="g-focus-pw" type="password" autoComplete="current-password" />
        </Field>
        <ActionBar>
          <Button variant="saffron">Sign in</Button>
        </ActionBar>
      </FocusLayout>
    ),
  },
  {
    name: 'ReferenceScreens',
    title: 'Reference screens',
    description:
      'Full-page pattern references shipped with the original system. They show how components compose; they do not define CDevi screens or navigation.',
    usage:
      '// static HTML under packages/design-system/reference-screens/ — copy patterns, not markup',
    a11y: 'Each page passes page-level axe and is part of the visual-regression baseline.',
    render: () => (
      <ul className="g-refs">
        {[
          'inbox',
          'spec-session',
          'new-task',
          'run-transcript',
          'run-changes',
          'review',
          'agents-keys',
          'repository-settings',
          'usage',
          'cli',
        ].map((p) => (
          <li key={p}>
            <a href={`/reference-screens/${p}.html`}>{p}</a>
          </li>
        ))}
      </ul>
    ),
  },
];
