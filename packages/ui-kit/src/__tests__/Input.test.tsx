import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import { Input } from '../components/Input/Input.js';

describe('Input', () => {
  it('renders a text input', () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('accepts typed text', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Name" />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    expect(screen.getByRole('textbox')).toHaveValue('Hello');
  });

  it('is disabled when disabled', () => {
    render(<Input aria-label="Name" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows invalid state via invalid prop', () => {
    render(<Input aria-label="Name" invalid />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('calls onChange handler', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="Name" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Name" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <label>
        Name
        <Input />
      </label>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
