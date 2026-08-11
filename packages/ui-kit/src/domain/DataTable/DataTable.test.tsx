import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DataTable } from './DataTable';
import type { ColumnDef } from './DataTable';
import { TICKET_ROWS } from '../../../test/fixtures/ticket.fixtures';
import type { TicketRow } from '../../../test/fixtures/ticket.fixtures';

const COLUMNS: ColumnDef<TicketRow>[] = [
  { id: 'id', header: 'ID', accessor: (r) => r.id },
  { id: 'subject', header: 'Subject', accessor: (r) => r.subject, sortable: true },
  { id: 'priority', header: 'Priority', accessor: (r) => r.priority, sortable: true },
];

function renderTable(overrides?: Partial<React.ComponentProps<typeof DataTable<TicketRow>>>) {
  return render(
    <DataTable
      columns={COLUMNS}
      data={TICKET_ROWS}
      getRowId={(r) => r.id}
      aria-label="Tickets"
      {...overrides}
    />,
  );
}

describe('DataTable', () => {
  it('renders with role=grid', () => {
    renderTable();
    expect(screen.getByRole('grid')).toBeDefined();
  });

  it('renders correct number of rows', () => {
    renderTable();
    const rows = screen.getAllByRole('row');
    // 1 header + 5 data rows
    expect(rows).toHaveLength(6);
  });

  it('renders column headers with role=columnheader', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('shows aria-sort on sortable columns (default none)', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader');
    const subjectHeader = headers.find((h) => h.textContent?.includes('Subject'));
    expect(subjectHeader?.getAttribute('aria-sort')).toBe('none');
    const idHeader = headers.find((h) => h.textContent?.includes('ID'));
    expect(idHeader?.getAttribute('aria-sort')).toBeNull();
  });

  it('shows loading state', () => {
    renderTable({ data: [], loading: true });
    expect(screen.getByLabelText('Loading')).toBeDefined();
  });

  it('shows empty content when no data', () => {
    renderTable({ data: [], emptyContent: <span>Nothing here</span> });
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  it('shows error message', () => {
    renderTable({ data: [], error: 'Failed to load tickets' });
    expect(screen.getByText('Failed to load tickets')).toBeDefined();
  });

  it('renders gridcells with row data', () => {
    renderTable();
    expect(screen.getByText('T-001')).toBeDefined();
    expect(screen.getByText('Login failure')).toBeDefined();
  });

  it('calls onSortChange when sortable header is clicked', () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    const headers = screen.getAllByRole('columnheader');
    const subjectHeader = headers.find((h) => h.textContent?.includes('Subject'))!;
    fireEvent.click(subjectHeader);
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'subject', direction: 'asc' });
  });

  it('toggles sort direction on second click', () => {
    const onSortChange = vi.fn();
    renderTable({
      onSortChange,
      sortState: { columnId: 'subject', direction: 'asc' },
    });
    const headers = screen.getAllByRole('columnheader');
    const subjectHeader = headers.find((h) => h.textContent?.includes('Subject'))!;
    fireEvent.click(subjectHeader);
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'subject', direction: 'desc' });
  });

  it('does not call onSortChange for non-sortable columns', () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    const headers = screen.getAllByRole('columnheader');
    const idHeader = headers.find((h) => h.textContent?.includes('ID'))!;
    fireEvent.click(idHeader);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('renders row selection checkboxes when onRowSelect provided', () => {
    renderTable({ onRowSelect: vi.fn(), selectedRowIds: new Set() });
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(TICKET_ROWS.length);
  });

  it('calls onRowSelect when checkbox is clicked', () => {
    const onRowSelect = vi.fn();
    renderTable({ onRowSelect, selectedRowIds: new Set() });
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    expect(onRowSelect).toHaveBeenCalledWith('T-001', true);
  });

  it('renders aria-selected on rows when selection enabled', () => {
    renderTable({
      onRowSelect: vi.fn(),
      selectedRowIds: new Set(['T-001']),
    });
    const rows = screen.getAllByRole('row').slice(1); // skip header
    const firstRow = rows[0]!;
    expect(firstRow.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('false');
  });

  it('uses custom cell renderer when provided', () => {
    const cols: ColumnDef<TicketRow>[] = [
      { id: 'id', header: 'ID', accessor: (r) => r.id, cell: (r) => <b data-testid="custom">{r.id}</b> },
    ];
    render(
      <DataTable columns={cols} data={TICKET_ROWS.slice(0, 1)} getRowId={(r) => r.id} />,
    );
    expect(screen.getByTestId('custom')).toBeDefined();
  });

  it('passes aria-label to grid element', () => {
    renderTable({ 'aria-label': 'My custom table' });
    expect(screen.getByRole('grid', { name: 'My custom table' })).toBeDefined();
  });
});
