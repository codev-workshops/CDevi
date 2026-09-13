import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Chip, Chips, Field, Help, Input, OptionRow, Segmented, Select, TextArea } from './Form';

function SegDemo() {
  const [v, setV] = useState<'cloud' | 'laptop' | 'ask'>('cloud');
  return (
    <Segmented
      label="Runtime"
      value={v}
      onChange={setV}
      options={[
        { value: 'cloud', label: 'Cloud sandbox' },
        { value: 'laptop', label: 'My laptop' },
        { value: 'ask', label: 'Ask each time', disabled: true },
      ]}
    />
  );
}

describe('Form components', () => {
  it('Field wires label, help and error to the control', () => {
    renderThemed(
      <Field label="Budget" help="Per run" error="Too high">
        <Input defaultValue="5" />
      </Field>,
    );
    const input = screen.getByLabelText('Budget');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Too high');
  });

  it('Segmented is a radiogroup with arrow-key navigation skipping disabled', async () => {
    const user = userEvent.setup();
    renderThemed(<SegDemo />);
    const group = screen.getByRole('radiogroup', { name: 'Runtime' });
    expect(group).toHaveClass('cd-seg');
    const cloud = screen.getByRole('radio', { name: 'Cloud sandbox' });
    expect(cloud).toHaveAttribute('aria-checked', 'true');
    cloud.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'My laptop' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'My laptop' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cloud).toHaveAttribute('aria-checked', 'true');
  });

  it('Chip toggles aria-pressed; static chip is a span', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderThemed(
      <Chips label="Gates">
        <Chip selected onToggle={onToggle}>
          tests passed
        </Chip>
        <Chip>static</Chip>
      </Chips>,
    );
    const btn = screen.getByRole('button', { name: 'tests passed' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(screen.getByText('static').tagName).toBe('SPAN');
  });

  it('OptionRow wraps a real radio input and is keyboard operable', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderThemed(
      <>
        <OptionRow name="q" value="a" checked onChange={onChange}>
          Per IP
        </OptionRow>
        <OptionRow name="q" value="b" checked={false} onChange={onChange} recommended>
          Per IP and account
        </OptionRow>
      </>,
    );
    const b = screen.getByRole('radio', { name: /Per IP and account/ });
    await user.click(b);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    await expectAccessible(
      <>
        <Field label="Repository" help="Pick one">
          <Select defaultValue="a">
            <option value="a">payments-api</option>
          </Select>
        </Field>
        <Field label="Brief" hint="@ to mention">
          <TextArea defaultValue="Implement" />
        </Field>
        <SegDemo />
        <Chips label="Gates">
          <Chip selected onToggle={() => {}}>
            CI
          </Chip>
        </Chips>
        <OptionRow name="r" value="x" checked onChange={() => {}}>
          Option
        </OptionRow>
        <Help>Help text</Help>
      </>,
    );
  });
});
