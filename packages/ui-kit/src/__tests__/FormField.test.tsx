import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { FormField } from '../components/FormField/FormField.js';
import { Input } from '../components/Input/Input.js';

describe('FormField', () => {
  it('renders label', () => {
    render(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('associates label with input via id', () => {
    render(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    const label = screen.getByText('Email');
    const input = screen.getByRole('textbox');
    expect(label).toHaveAttribute('for', input.id);
  });

  it('shows hint text', () => {
    render(
      <FormField hint="Enter your work email">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('Enter your work email')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(
      <FormField error="This field is required">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('marks input as aria-invalid when error present', () => {
    render(
      <FormField error="Required">
        <Input />
      </FormField>,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('wires aria-describedby to error id', () => {
    render(
      <FormField error="Required">
        <Input />
      </FormField>,
    );
    const input = screen.getByRole('textbox');
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const errorEl = document.getElementById(errorId!);
    expect(errorEl).toHaveTextContent('Required');
  });

  it('shows required indicator', () => {
    render(
      <FormField label="Name" required>
        <Input />
      </FormField>,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <FormField label="Name" hint="Full name">
        <Input />
      </FormField>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with error', async () => {
    const { container } = render(
      <FormField label="Email" error="Invalid email">
        <Input />
      </FormField>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
