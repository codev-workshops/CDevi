import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Tab, TabPanel, Tabs } from './Tabs';

function Demo({ initial = 'a' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <Tabs id="run" value={v} onChange={setV} label="Run">
        <Tab value="a">Transcript</Tab>
        <Tab value="b" count={3}>
          Changes
        </Tab>
        <Tab value="c" disabled>
          Tests
        </Tab>
        <Tab value="d">Evidence</Tab>
      </Tabs>
      <TabPanel value="a" current={v} tabsId="run">
        A
      </TabPanel>
      <TabPanel value="b" current={v} tabsId="run">
        B
      </TabPanel>
      <TabPanel value="d" current={v} tabsId="run">
        D
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('uses tablist/tab/tabpanel roles and aria-selected', () => {
    renderThemed(<Demo />);
    expect(screen.getByRole('tablist', { name: 'Run' })).toBeInTheDocument();
    const a = screen.getByRole('tab', { name: 'Transcript' });
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(a).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('arrow keys move selection and focus, skipping disabled; Home/End jump', async () => {
    const user = userEvent.setup();
    renderThemed(<Demo />);
    screen.getByRole('tab', { name: 'Transcript' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveFocus();
  });

  it('only the selected tab is in the tab sequence (roving tabindex)', () => {
    renderThemed(<Demo initial="b" />);
    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('tabindex', '-1');
  });

  it('is accessible', async () => {
    await expectAccessible(<Demo />);
  });
});
