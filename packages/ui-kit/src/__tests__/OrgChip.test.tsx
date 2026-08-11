import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrgChip } from '../domain/OrgChip/OrgChip';

describe('OrgChip', () => {
  it('renders org name', () => {
    render(<OrgChip name="Acme Corp" />);
    expect(screen.getByTestId('org-chip')).toHaveTextContent('Acme Corp');
  });

  it('shows two-letter initials avatar when no logoUrl', () => {
    render(<OrgChip name="Acme Corp" />);
    // Avatar span has aria-hidden and contains the initials
    const chip = screen.getByTestId('org-chip');
    expect(chip.textContent).toContain('AC');
  });

  it('shows logo img when logoUrl provided', () => {
    render(<OrgChip name="Acme Corp" logoUrl="https://example.com/logo.png" />);
    expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument();
  });

  it('falls back to initials when image fails to load', async () => {
    render(<OrgChip name="Beta Systems" logoUrl="https://example.com/bad.png" />);
    const img = screen.getByRole('img', { hidden: true });
    // Simulate error
    img.dispatchEvent(new Event('error'));
    // After error, initials should show
    await screen.findByText('BS');
  });

  it('handles single-word org name', () => {
    render(<OrgChip name="Google" />);
    expect(screen.getByTestId('org-chip').textContent).toContain('G');
  });

  it('title attribute provides full name for accessibility', () => {
    render(<OrgChip name="A Very Long Organization Name" />);
    const chip = screen.getByTestId('org-chip');
    const label = chip.querySelector('[title]');
    expect(label?.getAttribute('title')).toBe('A Very Long Organization Name');
  });
});
