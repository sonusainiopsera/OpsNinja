import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { OrgChip } from './OrgChip';

describe('OrgChip', () => {
  it('renders full name when under maxLength', () => {
    const { container } = render(<OrgChip name="Acme Corp" />);
    expect(container.textContent).toContain('Acme');
    expect(container.querySelector('[data-org-chip]')).not.toBeNull();
  });

  it('truncates long names and adds title', () => {
    const longName = 'A Very Long Organization Name That Exceeds Default';
    const { container } = render(<OrgChip name={longName} />);
    const chip = container.querySelector('[data-org-chip]')!;
    expect(chip.getAttribute('title')).toBe(longName);
    const displayText = chip.querySelector('span:last-child')?.textContent ?? '';
    expect(displayText).toContain('…');
    expect(displayText.length).toBeLessThanOrEqual(20 + 1); // maxLength=20 + ellipsis
  });

  it('respects custom maxLength', () => {
    const name = 'Short Name Here';
    const { container } = render(<OrgChip name={name} maxLength={5} />);
    const chip = container.querySelector('[data-org-chip]')!;
    expect(chip.getAttribute('title')).toBe(name);
  });

  it('does not add title when name fits', () => {
    const { container } = render(<OrgChip name="Acme" maxLength={20} />);
    const chip = container.querySelector('[data-org-chip]')!;
    expect(chip.getAttribute('title')).toBeNull();
  });

  it('includes (deactivated) in aria-label when deactivated', () => {
    const { container } = render(<OrgChip name="Globex" deactivated />);
    const chip = container.querySelector('[data-org-chip]')!;
    expect(chip.getAttribute('aria-label')).toContain('deactivated');
    expect(chip.getAttribute('data-deactivated')).toBe('true');
  });

  it('renders initials when no avatarUrl', () => {
    const { container } = render(<OrgChip name="Acme Corp" />);
    // Initials: "AC"
    expect(container.textContent).toContain('AC');
  });

  it('renders img when avatarUrl provided', () => {
    const { container } = render(<OrgChip name="Acme" avatarUrl="https://example.com/logo.png" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/logo.png');
  });
});
