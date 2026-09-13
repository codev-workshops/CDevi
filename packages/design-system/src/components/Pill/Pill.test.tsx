import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { KeyFingerprint, Mono, RuntimeGlyph } from '../Inline/Inline';
import { Pill } from './Pill';

describe('Pill and inline primitives', () => {
  it('renders the word as content with the variant class; dot is hidden from AT', () => {
    renderThemed(
      <Pill variant="run" pulse>
        running
      </Pill>,
    );
    const pill = screen.getByText('running');
    expect(pill).toHaveClass('cd-pill', 'cd-run');
    expect(pill.querySelector('.cd-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('RuntimeGlyph shows a visible label and hides the svg', () => {
    renderThemed(<RuntimeGlyph kind="cloud" label="cloud · sbx-7c1e" />);
    expect(screen.getByText('cloud · sbx-7c1e')).toBeInTheDocument();
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('KeyFingerprint never shows more than the tail and labels itself', () => {
    renderThemed(<KeyFingerprint>8f2a</KeyFingerprint>);
    const el = screen.getByLabelText('key ending in 8f2a');
    expect(el).toHaveTextContent('…8f2a');
    expect(el.tagName).toBe('CODE');
  });

  it('is accessible', async () => {
    await expectAccessible(
      <p>
        <Pill variant="wait">needs you</Pill> <RuntimeGlyph kind="laptop" label="laptop" />{' '}
        <KeyFingerprint>c91d</KeyFingerprint> <Mono>src/a.ts</Mono>
      </p>,
    );
  });
});
