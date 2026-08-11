import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { Alert } from '../components/Alert/Alert.js';

describe('Alert', () => {
  it('renders info variant with role=status', () => {
    render(<Alert variant="info" title="Info">Body</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders error variant with role=alert', () => {
    render(<Alert variant="error" title="Error">Something went wrong</Alert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders success variant with role=status', () => {
    render(<Alert variant="success" title="Success">Done</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders warning variant with role=status', () => {
    render(<Alert variant="warning" title="Warning">Be careful</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders title', () => {
    render(<Alert title="My title" />);
    expect(screen.getByText('My title')).toBeInTheDocument();
  });

  it('renders children as body text', () => {
    render(<Alert>Body content</Alert>);
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('has no accessibility violations for info', async () => {
    const { container } = render(<Alert variant="info" title="Info alert">Details</Alert>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations for error', async () => {
    const { container } = render(<Alert variant="error" title="Error">Details</Alert>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('accepts custom role override', () => {
    render(<Alert role="log">Log entry</Alert>);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});
