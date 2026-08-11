import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { Accordion } from '../components/Accordion/Accordion.js';
import { ACCORDION_SECTIONS } from '../fixtures/component-fixtures.js';

function TestAccordion({ type = 'single' }: { type?: 'single' | 'multiple' }) {
  if (type === 'multiple') {
    return (
      <Accordion type="multiple">
        {ACCORDION_SECTIONS.map((section) => (
          <Accordion.Item key={section.value} value={section.value}>
            <Accordion.Trigger>{section.title}</Accordion.Trigger>
            <Accordion.Content>{section.content}</Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion>
    );
  }
  return (
    <Accordion type="single" collapsible>
      {ACCORDION_SECTIONS.map((section) => (
        <Accordion.Item key={section.value} value={section.value}>
          <Accordion.Trigger>{section.title}</Accordion.Trigger>
          <Accordion.Content>{section.content}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

describe('Accordion', () => {
  it('renders all section triggers', () => {
    render(<TestAccordion />);
    ACCORDION_SECTIONS.forEach((s) => {
      expect(screen.getByText(s.title)).toBeInTheDocument();
    });
  });

  it('expands section on click', async () => {
    const user = userEvent.setup();
    render(<TestAccordion />);
    const firstSection = ACCORDION_SECTIONS[0]!;
    await user.click(screen.getByText(firstSection.title));
    expect(screen.getByText(firstSection.content)).toBeVisible();
  });

  it('collapses expanded section in single mode', async () => {
    const user = userEvent.setup();
    render(<TestAccordion />);
    const firstSection = ACCORDION_SECTIONS[0]!;
    const trigger = screen.getByText(firstSection.title);
    await user.click(trigger);
    await user.click(trigger);
    // Content should be hidden after collapsing
    expect(screen.getByRole('button', { name: firstSection.title })).toHaveAttribute(
      'data-state',
      'closed',
    );
  });

  it('allows multiple sections open in multiple mode', async () => {
    const user = userEvent.setup();
    render(<TestAccordion type="multiple" />);
    const [s1, s2] = ACCORDION_SECTIONS;
    await user.click(screen.getByText(s1!.title));
    await user.click(screen.getByText(s2!.title));
    expect(screen.getByRole('button', { name: s1!.title })).toHaveAttribute('data-state', 'open');
    expect(screen.getByRole('button', { name: s2!.title })).toHaveAttribute('data-state', 'open');
  });

  it('supports Enter key to expand', async () => {
    const user = userEvent.setup();
    render(<TestAccordion />);
    const trigger = screen.getByText(ACCORDION_SECTIONS[0]!.title);
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.closest('button')).toHaveAttribute('data-state', 'open');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<TestAccordion />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
