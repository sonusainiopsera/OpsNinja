import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import { Pagination } from '../components/Pagination/Pagination.js';
import { PAGINATION_CURSORS } from '../fixtures/component-fixtures.js';

describe('Pagination', () => {
  it('disables prev button on first page', () => {
    render(<Pagination {...PAGINATION_CURSORS.firstPage} limit={25} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<Pagination {...PAGINATION_CURSORS.lastPage} limit={25} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('enables both buttons on middle page', () => {
    render(<Pagination {...PAGINATION_CURSORS.middlePage} limit={25} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).not.toBeDisabled();
  });

  it('calls onNext with cursor when next clicked', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <Pagination
        {...PAGINATION_CURSORS.middlePage}
        limit={25}
        onNext={onNext}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onNext).toHaveBeenCalledWith(PAGINATION_CURSORS.middlePage.nextCursor);
  });

  it('calls onPrev with cursor when prev clicked', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    render(
      <Pagination
        {...PAGINATION_CURSORS.middlePage}
        limit={25}
        onPrev={onPrev}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPrev).toHaveBeenCalledWith(PAGINATION_CURSORS.middlePage.prevCursor);
  });

  it('clamps limit to 100 in display', () => {
    render(<Pagination limit={200} />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('100');
  });

  it('calls onLimitChange with clamped value', async () => {
    const user = userEvent.setup();
    const onLimitChange = vi.fn();
    render(<Pagination limit={25} onLimitChange={onLimitChange} />);
    await user.selectOptions(screen.getByRole('combobox'), '50');
    expect(onLimitChange).toHaveBeenCalledWith(50);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Pagination {...PAGINATION_CURSORS.middlePage} limit={25} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
