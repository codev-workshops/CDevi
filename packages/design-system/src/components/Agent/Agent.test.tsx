import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Button } from '../Button/Button';
import { Pill } from '../Pill/Pill';
import {
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
} from './Agent';

describe('Agent surfaces', () => {
  it('Message summary variant is labelled as not evidence (DR-03)', () => {
    renderThemed(
      <Message who="Summary from the agent" variant="summary">
        Moved sessions to Redis.
      </Message>,
    );
    expect(screen.getByText(/not evidence/)).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveClass('cd-msg', 'cd-summary');
  });

  it('GateCheck override is never rendered as verified/green (DR-04)', () => {
    renderThemed(
      <GateList>
        <GateCheck state="override" label="Spec analyzed" source="override:kasun" />
        <GateCheck state="ok" label="Tests passed" source="runner" />
      </GateList>,
    );
    const override = screen.getByRole('img', { name: 'overridden' });
    expect(override).toHaveClass('cd-override');
    expect(override).not.toHaveClass('cd-ok');
    expect(screen.getByRole('img', { name: 'passed' })).toHaveClass('cd-ok');
  });

  it('GateCheck with onToggle is a real checkbox operable with Space', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderThemed(<GateCheck state="pending" label="Legacy endpoint kept" onToggle={onToggle} />);
    const cb = screen.getByRole('checkbox', { name: 'Legacy endpoint kept' });
    cb.focus();
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('DecisionCard is a labelled region with its actions', () => {
    renderThemed(
      <DecisionCard
        title="Open a pull request against main?"
        badge={<Pill variant="wait">external</Pill>}
        description="main is protected, so this always asks."
        actions={
          <>
            <Button variant="saffron">Approve</Button>
            <Button variant="ghost">Not now</Button>
          </>
        }
      />,
    );
    expect(screen.getByRole('region', { name: /Open a pull request/ })).toHaveClass('cd-decision');
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveClass('cd-saffron');
  });

  it('Step marks the current step with aria-current=step', () => {
    renderThemed(
      <Stepper>
        <Step state="done" title="1 Specify" detail="spec.md written" />
        <Step state="current" title="2 Clarify" detail="3 questions" />
        <Step title="3 Plan" />
      </Stepper>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveClass('cd-done');
  });

  it('is accessible', async () => {
    await expectAccessible(
      <>
        <Message who="Claude Code" when="14:02">
          Plan: add rateLimit.ts
        </Message>
        <ToolLog>
          <ToolLine kind="read">read </ToolLine> src/lib/redis.ts{'\n'}
          <ToolLine kind="write">edit </ToolLine> src/middleware/rateLimit.ts
        </ToolLog>
        <Message who="You" when="14:16" variant="user">
          Add a test.
        </Message>
        <Diff>
          <DiffFile>src/middleware/auth.ts</DiffFile>
          <DiffLine>import x</DiffLine>
          <DiffLine kind="add">import y</DiffLine>
          <DiffLine kind="del">old</DiffLine>
        </Diff>
        <Terminal>
          <TermLine kind="prompt">$</TermLine> cdevi link{'\n'}
          <TermLine kind="good">✓</TermLine> linked
        </Terminal>
        <GateList>
          <GateCheck state="bad" label="CI passed" source="github" />
          <GateCheck state="wait" label="Human approval" source="you" />
        </GateList>
      </>,
    );
  });
});
