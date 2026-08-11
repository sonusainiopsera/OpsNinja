import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from '../components/Modal/Modal.js';
import { Button } from '../components/Button/Button.js';

function TestModal({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Modal defaultOpen={defaultOpen}>
      <Modal.Trigger asChild>
        <Button>Open</Button>
      </Modal.Trigger>
      <Modal.Content aria-describedby={undefined}>
        <Modal.Header>
          <Modal.Title>Test Modal</Modal.Title>
          <Modal.Description>A test description</Modal.Description>
        </Modal.Header>
        <p>Modal body content</p>
        <Modal.Footer>
          <Modal.Close asChild>
            <Button variant="secondary">Cancel</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders trigger button', () => {
    render(<TestModal />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('opens on trigger click', async () => {
    const user = userEvent.setup();
    render(<TestModal />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(<TestModal />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on close button click', async () => {
    const user = userEvent.setup();
    render(<TestModal />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renders title and description', async () => {
    const user = userEvent.setup();
    render(<TestModal />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.getByText('Test Modal')).toBeInTheDocument();
      expect(screen.getByText('A test description')).toBeInTheDocument();
    });
  });

  it('has no accessibility violations when open', async () => {
    const { container } = render(<TestModal defaultOpen />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
