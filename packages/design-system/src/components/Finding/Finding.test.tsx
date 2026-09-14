import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { RISK_LEVELS, WORKFLOW_STATES, riskToVariant, stateToPill } from '../../tokens';
import { Button } from '../Button/Button';
import { StatePill } from '../Pill/StatePill';
import { RiskBadge } from '../RiskBadge/RiskBadge';
import { AuditRow, AuditTable, FindingRow } from './Finding';

describe('StatePill', () => {
  it('renders every workflow state with its word as the accessible content and the mapped class', () => {
    renderThemed(
      <>
        {WORKFLOW_STATES.map((s) => (
          <StatePill key={s} state={s} />
        ))}
      </>,
    );
    for (const s of WORKFLOW_STATES) {
      const el = document.querySelector(`[data-state="${s}"]`)!;
      expect(el).toHaveTextContent(stateToPill[s].word);
      expect(el).toHaveClass('cd-pill', `cd-${stateToPill[s].variant}`);
    }
  });

  it('blocked and failed have different class sets; needs-you differs from wait', () => {
    renderThemed(
      <>
        <StatePill state="BLOCKED" />
        <StatePill state="FAILED" />
        <StatePill state="WAITING_FOR_HUMAN" />
        <StatePill state="WAITING" />
      </>,
    );
    const cls = (s: string) =>
      [...document.querySelector(`[data-state="${s}"]`)!.classList].sort().join(' ');
    expect(cls('BLOCKED')).not.toBe(cls('FAILED'));
    expect(cls('BLOCKED')).toContain('cd-blocked');
    expect(cls('WAITING_FOR_HUMAN')).toContain('cd-needs-you');
    expect(cls('WAITING')).not.toContain('cd-needs-you');
  });

  it('cancelled is struck through via modifier; running pulses', () => {
    renderThemed(
      <>
        <StatePill state="CANCELLED" />
        <StatePill state="RUNNING" />
      </>,
    );
    expect(document.querySelector('[data-state="CANCELLED"]')).toHaveClass('cd-cancelled');
    expect(document.querySelector('[data-state="RUNNING"] .cd-dot')).not.toBeNull();
    expect(document.querySelector('[data-state="CANCELLED"] .cd-dot')).toBeNull();
  });

  it('is accessible in both themes', async () => {
    await expectAccessible(
      <p>
        {WORKFLOW_STATES.map((s) => (
          <StatePill key={s} state={s} />
        ))}
      </p>,
    );
  });
});

describe('RiskBadge', () => {
  it('renders all four levels; words end in "risk"; HIGH/CRITICAL prominent', () => {
    renderThemed(
      <>
        {RISK_LEVELS.map((l) => (
          <RiskBadge key={l} level={l} />
        ))}
      </>,
    );
    for (const l of RISK_LEVELS) {
      const el = document.querySelector(`[data-risk="${l}"]`)!;
      expect(el).toHaveTextContent(riskToVariant[l].word);
      expect(el).toHaveClass('cd-risk', `cd-risk-${l.toLowerCase()}`);
      expect(el.hasAttribute('data-prominent')).toBe(riskToVariant[l].prominent);
    }
  });

  it('CRITICAL never shares the failed or blocked classes', () => {
    renderThemed(<RiskBadge level="CRITICAL" />);
    const el = document.querySelector('[data-risk="CRITICAL"]')!;
    expect(el).not.toHaveClass('cd-fail');
    expect(el).not.toHaveClass('cd-blocked');
    expect(el).not.toHaveClass('cd-pill');
  });

  it('is accessible', async () => {
    await expectAccessible(
      <p>
        {RISK_LEVELS.map((l) => (
          <RiskBadge key={l} level={l} />
        ))}
      </p>,
    );
  });
});

describe('FindingRow and AuditTable', () => {
  it('FindingRow shows severity and blocking class as words with the contract regions', () => {
    renderThemed(
      <FindingRow
        severity="HIGH"
        blocking="BLOCKING"
        lane="Security"
        title="Refund endpoint does not verify payment ownership"
        impact="A user may refund another user's payment."
        evidence={[{ label: 'RefundController.java:84', href: '#l84' }]}
        fix="Validate payment ownership before processing."
        actions={
          <>
            <Button size="sm">Apply Fix</Button>
            <Button size="sm" variant="ghost">
              Dismiss
            </Button>
            <Button size="sm" variant="ghost">
              Create Issue
            </Button>
          </>
        }
      />,
    );
    const art = screen.getByRole('article', { name: /Refund endpoint/ });
    expect(within(art).getByText('high')).toHaveClass('cd-fail');
    expect(within(art).getByText('blocking')).toHaveClass('cd-needs-you');
    expect(art).toHaveClass('cd-finding-blocking');
    expect(within(art).getByText('Impact')).toBeInTheDocument();
    expect(within(art).getByRole('link', { name: 'RefundController.java:84' })).toBeInTheDocument();
    expect(within(art).getByText('Recommended fix')).toBeInTheDocument();
    expect(within(art).getAllByRole('button')).toHaveLength(3);
  });

  it('AuditTable renders all eight slots for each event with a risk badge', () => {
    renderThemed(
      <AuditTable
        events={[
          {
            id: 'e1',
            time: '10:42:12',
            actor: 'Implementation Agent',
            action: 'Modified file',
            target: 'RefundService.java',
            workflow: 'PAY-1391',
            policy: 'Implementation Policy v3',
            risk: 'MEDIUM',
            result: 'Success',
          },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Audit log' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Time', 'Actor', 'Action', 'Target', 'Workflow', 'Policy', 'Risk', 'Result']);
    expect(within(table).getByText('medium risk')).toHaveClass('cd-risk-medium');
  });

  it('AuditTable renders an em dash instead of a badge when the event has no risk level', () => {
    renderThemed(
      <AuditTable
        events={[
          {
            id: 'e2',
            time: 't',
            actor: 'Approver 1',
            action: 'clarification.answered',
            target: 'c',
            result: 'RUNNING',
          },
        ]}
      />,
    );
    const cells = within(screen.getByRole('table')).getAllByRole('cell');
    expect(cells[6]).toHaveTextContent('—');
    expect(screen.queryByText(/risk$/)).toBeNull();
  });

  it('AuditRow can be composed inside a custom table', () => {
    renderThemed(
      <table>
        <tbody>
          <AuditRow id="x" time="t" actor="a" action="b" target="c" risk="LOW" result="ok" />
        </tbody>
      </table>,
    );
    expect(document.querySelector('[data-audit-id="x"] td')).not.toBeNull();
  });

  it('is accessible', async () => {
    await expectAccessible(
      <>
        <FindingRow severity="INFO" blocking="SUGGESTION" title="Consider a constant" />
        <AuditTable
          events={[
            {
              id: '1',
              time: 't',
              actor: 'a',
              action: 'b',
              target: 'c',
              risk: 'CRITICAL',
              result: 'denied',
            },
          ]}
        />
      </>,
    );
  });
});
