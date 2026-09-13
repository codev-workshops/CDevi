import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoViolations } from '../../test/a11y';
import { Button } from '../Button/Button';
import { KeyValue } from '../Data/Data';
import {
  ActionBar,
  AppShell,
  Brand,
  Crumbs,
  Main,
  NavGroup,
  NavItem,
  PageMeta,
  Panel,
  PanelBlock,
  Side,
  Topbar,
} from './AppShell';

function Shell({ variant }: { variant?: 'full' | 'framed' }) {
  return (
    <AppShell
      variant={variant}
      side={
        <Side
          brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}
          footer={<span className="cd-label">acme · Nadeesha</span>}
        >
          <NavItem href="/inbox" active count={2}>
            Inbox
          </NavItem>
          <NavItem href="/workflows">Workflows</NavItem>
          <NavGroup>Administration</NavGroup>
          <NavItem href="/audit">Audit</NavItem>
        </Side>
      }
      panel={
        <Panel>
          <PanelBlock title="Session">
            <KeyValue items={[{ term: 'Branch', detail: 'main' }]} />
          </PanelBlock>
        </Panel>
      }
    >
      <Main>
        <Crumbs items={[{ label: 'Tasks', href: '/tasks' }, { label: 'T002' }]} />
        <Topbar title="Implement the limiter" actions={<Button variant="ghost">Pause</Button>} />
        <PageMeta>
          <span>Claude Code 2.1</span>
          <span>claude-sonnet-4.5</span>
        </PageMeta>
        <ActionBar help="Tick the remaining criterion to enable approval.">
          <Button variant="ghost">Request changes</Button>
          <Button variant="saffron" disabled>
            Approve and merge
          </Button>
        </ActionBar>
      </Main>
    </AppShell>
  );
}

describe('AppShell', () => {
  it('renders landmarks, full-viewport variant by default and framed on request', () => {
    const { container, unmount } = render(<Shell />);
    expect(container.firstElementChild).toHaveClass('cd-app', 'cd-full', 'cd-with-panel');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Implement the limiter');
    unmount();
    const framed = render(<Shell variant="framed" />);
    expect(framed.container.firstElementChild).not.toHaveClass('cd-full');
  });

  it('marks the active nav item with aria-current=page and announces counts', () => {
    render(<Shell />);
    const inbox = screen.getByRole('link', { name: /Inbox/ });
    expect(inbox).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('2 pending')).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'Workflows' })).not.toHaveAttribute('aria-current');
  });

  it('breadcrumb last item is aria-current=page and not a link', () => {
    render(<Shell />);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs.querySelector('[aria-current="page"]')).toHaveTextContent('T002');
    expect(crumbs.querySelectorAll('a')).toHaveLength(1);
  });

  it('menu toggle controls the nav and reports expanded state', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', nav.id);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveClass('cd-open');
  });

  it('PageMeta renders one list item per child', () => {
    render(<Shell />);
    const meta = document.querySelector('.cd-page-meta')!;
    expect(meta.querySelectorAll('li')).toHaveLength(2);
  });

  it('is accessible in both themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.dataset['theme'] = theme;
      const { container, unmount } = render(<Shell />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
