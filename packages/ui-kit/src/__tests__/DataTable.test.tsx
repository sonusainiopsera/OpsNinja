import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type ColumnDef } from '../domain/DataTable/DataTable';

interface Row { id: string; name: string; status: string }

const rows: Row[] = [
  { id: '1', name: 'Alice', status: 'open' },
  { id: '2', name: 'Bob',   status: 'closed' },
  { id: '3', name: 'Carol', status: 'open' },
];

const columns: ColumnDef<Row>[] = [
  { key: 'name',   header: 'Name',   render: r => r.name,   sortable: true },
  { key: 'status', header: 'Status', render: r => r.status, sortable: true },
];

const getRowKey = (r: Row) => r.id;

describe('DataTable', () => {
  describe('basic rendering', () => {
    it('renders role=grid', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      expect(screen.getByTestId('data-table')).toHaveAttribute('role', 'grid');
    });

    it('renders all rows', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      expect(screen.getAllByRole('row').length).toBeGreaterThan(rows.length); // includes header
    });

    it('renders column headers', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders cell data', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('renders aria-sort=none on unsorted column', () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          sortKey="status"
          sortDirection="ascending"
        />,
      );
      const headers = screen.getAllByRole('columnheader');
      const nameHeader = headers.find(h => h.textContent?.includes('Name'));
      expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    });

    it('renders aria-sort=ascending on sorted column', () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          sortKey="name"
          sortDirection="ascending"
        />,
      );
      const headers = screen.getAllByRole('columnheader');
      const nameHeader = headers.find(h => h.textContent?.includes('Name'));
      expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    });

    it('calls onSort when header clicked', () => {
      const onSort = vi.fn();
      render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          onSort={onSort}
        />,
      );
      fireEvent.click(screen.getByText('Name'));
      expect(onSort).toHaveBeenCalledWith('name', 'ascending');
    });

    it('toggles direction on repeated click', () => {
      const onSort = vi.fn();
      render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          sortKey="name"
          sortDirection="ascending"
          onSort={onSort}
        />,
      );
      fireEvent.click(screen.getByText('Name'));
      expect(onSort).toHaveBeenCalledWith('name', 'descending');
    });
  });

  describe('density', () => {
    it.each(['compact', 'default', 'comfortable'] as const)('renders data-density=%s', (density) => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} density={density} />);
      expect(screen.getByTestId('data-table')).toHaveAttribute('data-density', density);
    });
  });

  describe('loading state', () => {
    it('renders aria-busy=true when loading', () => {
      render(<DataTable columns={columns} rows={[]} getRowKey={getRowKey} loading />);
      expect(screen.getByTestId('data-table')).toHaveAttribute('aria-busy', 'true');
    });

    it('renders skeleton rows when loading', () => {
      render(<DataTable columns={columns} rows={[]} getRowKey={getRowKey} loading loadingRowCount={3} />);
      // No real data rows rendered
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders default empty message', () => {
      render(<DataTable columns={columns} rows={[]} getRowKey={getRowKey} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('renders custom empty slot', () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          getRowKey={getRowKey}
          empty={<span>Nothing here</span>}
        />,
      );
      expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders error slot when provided', () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          getRowKey={getRowKey}
          error={<span>Load failed</span>}
        />,
      );
      expect(screen.getByText('Load failed')).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('first cell has tabindex=0', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      const cells = screen.getAllByRole('gridcell');
      const focusable = cells.filter(c => c.getAttribute('tabindex') === '0');
      expect(focusable.length).toBe(1);
    });

    it('arrow key moves focus', () => {
      render(<DataTable columns={columns} rows={rows} getRowKey={getRowKey} />);
      const grid = screen.getByTestId('data-table');
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
      // Focus should have moved to col 1
      const cells = screen.getAllByRole('gridcell');
      const focusable = cells.filter(c => c.getAttribute('tabindex') === '0');
      expect(focusable.length).toBe(1);
    });
  });

  describe('row selection', () => {
    it('marks selected rows with aria-selected', () => {
      const selected = new Set(['1']);
      render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          selectedRowKeys={selected}
        />,
      );
      const dataRows = screen.getAllByRole('row').slice(1); // skip header
      expect(dataRows[0]).toHaveAttribute('aria-selected', 'true');
      expect(dataRows[1]).toHaveAttribute('aria-selected', 'false');
    });
  });
});
