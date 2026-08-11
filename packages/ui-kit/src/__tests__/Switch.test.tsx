import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import { Switch } from '../components/Switch/Switch.js';

describe('Switch', () => {
  it('renders as unchecked by default', () => {
    render(<Switch aria-label="Dark mode" />);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Dark mode" />);
    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('calls onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Dark mode" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is disabled when disabled prop passed', () => {
    render(<Switch aria-label="Dark mode" disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Switch aria-label="Dark mode" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
