import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TenantSwitcher } from '../../components/shell/TenantSwitcher';
import { SINGLE_ORG_SCOPE, MULTI_ORG_SCOPE, EMPTY_ORG_SCOPE } from '../fixtures/orgScope.fixtures';

describe('TenantSwitcher', () => {
  it('renders static indicator for single-org scope', () => {
    const { getByTestId } = render(
      <TenantSwitcher current={SINGLE_ORG_SCOPE.current} available={SINGLE_ORG_SCOPE.available} />,
    );
    expect(getByTestId('tenant-switcher-static')).toBeDefined();
    expect(screen.queryByTestId('tenant-switcher-picker')).toBeNull();
  });

  it('does NOT render a picker button for single-org scope', () => {
    render(
      <TenantSwitcher current={SINGLE_ORG_SCOPE.current} available={SINGLE_ORG_SCOPE.available} />,
    );
    const btn = screen.queryByRole('button');
    expect(btn).toBeNull();
  });

  it('renders picker button for multi-org scope', () => {
    const { getByTestId } = render(
      <TenantSwitcher current={MULTI_ORG_SCOPE.current} available={MULTI_ORG_SCOPE.available} />,
    );
    expect(getByTestId('tenant-switcher-picker')).toBeDefined();
  });

  it('opens dropdown on button click and shows search input', () => {
    render(
      <TenantSwitcher current={MULTI_ORG_SCOPE.current} available={MULTI_ORG_SCOPE.available} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByPlaceholderText(/search organizations/i)).toBeDefined();
  });

  it('filters organizations by search query', () => {
    render(
      <TenantSwitcher current={MULTI_ORG_SCOPE.current} available={MULTI_ORG_SCOPE.available} />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search organizations/i), {
      target: { value: 'Globex' },
    });
    expect(screen.getByText(/Globex/)).toBeDefined();
    expect(screen.queryByText(/Springfield/)).toBeNull();
  });

  it('calls onSelect when an org is clicked', () => {
    const onSelect = vi.fn();
    render(
      <TenantSwitcher
        current={MULTI_ORG_SCOPE.current}
        available={MULTI_ORG_SCOPE.available}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Globex Industries/));
    expect(onSelect).toHaveBeenCalledWith(MULTI_ORG_SCOPE.available[1]);
  });

  it('renders empty/no-org state gracefully', () => {
    render(
      <TenantSwitcher current={EMPTY_ORG_SCOPE.current} available={EMPTY_ORG_SCOPE.available} />,
    );
    expect(screen.getByLabelText(/no organization/i)).toBeDefined();
  });
});
