import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ExportMenu } from '../../components/shell/ExportMenu';
import { ExportProvider, useRegisterExportHandler } from '../../lib/context/ExportContext';
import type { ExportFormat } from '../../lib/context/ExportContext';

function Wrapper({ handler }: { handler?: ((fmt: ExportFormat) => void) | null }) {
  useRegisterExportHandler(handler ?? null);
  return <ExportMenu />;
}

function renderWithProvider(handler?: ((fmt: ExportFormat) => void) | null) {
  return render(
    <ExportProvider>
      <Wrapper handler={handler} />
    </ExportProvider>,
  );
}

describe('ExportMenu', () => {
  it('renders disabled when no handler is registered', () => {
    renderWithProvider(null);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('opens dropdown when handler is registered', () => {
    renderWithProvider(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('calls handler with pdf format', async () => {
    const handler = vi.fn();
    renderWithProvider(handler);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /pdf/i }));
    expect(handler).toHaveBeenCalledWith('pdf');
  });

  it('calls handler with csv format', async () => {
    const handler = vi.fn();
    renderWithProvider(handler);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /csv/i }));
    expect(handler).toHaveBeenCalledWith('csv');
  });

  it('does not open dropdown when disabled', () => {
    renderWithProvider(null);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows non-blocking error alert with traceId on handler failure', async () => {
    const handler = vi.fn().mockRejectedValue({
      error: { traceId: 'trace_abc123' },
    });
    renderWithProvider(handler);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /pdf/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByRole('alert').textContent).toContain('trace_abc123');
    });
  });

  it('shows generic error when no traceId available', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Network error'));
    renderWithProvider(handler);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /pdf/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Export failed');
    });
  });
});
