import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import { RadioGroup, Radio } from '../components/RadioGroup/RadioGroup.js';
import { RADIO_OPTIONS } from '../fixtures/component-fixtures.js';

function TestRadioGroup({ defaultValue }: { defaultValue?: string }) {
  return (
    <RadioGroup aria-label="Frequency" defaultValue={defaultValue}>
      {RADIO_OPTIONS.map((opt) => (
        <Radio key={opt.value} value={opt.value} id={opt.value} label={opt.label} />
      ))}
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('renders all radio options', () => {
    render(<TestRadioGroup />);
    RADIO_OPTIONS.forEach((opt) => {
      expect(screen.getByLabelText(opt.label)).toBeInTheDocument();
    });
  });

  it('selects default value', () => {
    render(<TestRadioGroup defaultValue="weekly" />);
    expect(screen.getByLabelText('Weekly')).toBeChecked();
  });

  it('changes selection on click', async () => {
    const user = userEvent.setup();
    render(<TestRadioGroup defaultValue="daily" />);
    await user.click(screen.getByLabelText('Monthly'));
    expect(screen.getByLabelText('Monthly')).toBeChecked();
  });

  it('supports arrow key navigation', async () => {
    const user = userEvent.setup();
    render(<TestRadioGroup defaultValue="daily" />);
    screen.getByLabelText('Daily').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Weekly')).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<TestRadioGroup defaultValue="daily" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
