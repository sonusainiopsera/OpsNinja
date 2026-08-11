import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { Avatar } from '../components/Avatar/Avatar.js';

describe('Avatar', () => {
  it('renders initials when no src', () => {
    render(<Avatar name="Alice Johnson" />);
    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('renders single initial for single name', () => {
    render(<Avatar name="Bob" />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders fallback glyph when name is empty', () => {
    const { container } = render(<Avatar />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders image when src provided', () => {
    render(<Avatar src="https://example.com/avatar.jpg" name="Alice" alt="Alice avatar" />);
    expect(screen.getByRole('img', { name: 'Alice avatar' })).toBeInTheDocument();
  });

  it('falls back to initials when image errors', () => {
    render(<Avatar src="bad-url.jpg" name="Alice Johnson" />);
    const img = screen.getByAltText('Alice Johnson');
    fireEvent.error(img);
    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('renders all sizes', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    for (const size of sizes) {
      const { unmount } = render(<Avatar name="Test User" size={size} />);
      expect(screen.getByRole('img')).toBeInTheDocument();
      unmount();
    }
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Avatar name="Alice Johnson" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
