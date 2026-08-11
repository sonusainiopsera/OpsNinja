import type { BreadcrumbItem } from '../components/Breadcrumbs/Breadcrumbs.js';

export const SELECT_OPTIONS = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
] as const;

export const MENU_ITEMS = [
  { id: 'edit', label: 'Edit' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'archive', label: 'Archive' },
  { id: 'delete', label: 'Delete', destructive: true },
] as const;

export const ACCORDION_SECTIONS = [
  {
    value: 'section-1',
    title: 'What is OpsNinja?',
    content: 'OpsNinja is an AI-powered operations platform.',
  },
  {
    value: 'section-2',
    title: 'How does it work?',
    content: 'It connects to your infrastructure and uses AI agents to monitor and respond.',
  },
  {
    value: 'section-3',
    title: 'What integrations are supported?',
    content: 'AWS, GCP, Azure, Kubernetes, Datadog, PagerDuty, and more.',
  },
] as const;

export const BREADCRUMB_TRAIL: BreadcrumbItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Settings', href: '/settings' },
  { label: 'Team', href: '/settings/team' },
  { label: 'Members' },
];

export const AVATAR_SAMPLES = [
  { name: 'Alice Johnson', initials: 'AJ' },
  { name: 'Bob', initials: 'B' },
  { name: 'Charlie Brown Smith', initials: 'CS' },
  { name: '', initials: '' },
] as const;

export const PAGINATION_CURSORS = {
  firstPage: { prevCursor: null, nextCursor: 'cursor_page2_abc123' },
  middlePage: { prevCursor: 'cursor_page1_xyz789', nextCursor: 'cursor_page3_def456' },
  lastPage: { prevCursor: 'cursor_page2_abc123', nextCursor: null },
  onlyPage: { prevCursor: null, nextCursor: null },
} as const;

export const RADIO_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;
