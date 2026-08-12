'use client';

/**
 * ContactsPanel — lists contacts for an organization.
 *
 * Features:
 *   - Infinite-paged contact list
 *   - Portal access toggle with optimistic update + rollback on failure
 *   - Add contact form (email, name, job title, phone, portal access)
 *   - Server 400 errors mapped to per-field messages
 *   - Permission gating: write controls disabled for non-admins with tooltip
 */

import React, { useState, useCallback } from 'react';
import type { OrgContact } from '../../lib/api/organizations/types';
import {
  useOrgContacts,
  useTogglePortalAccess,
  useCreateContact,
} from '../../lib/api/organizations/hooks';

// ---------------------------------------------------------------------------
// ContactStatusBadge
// ---------------------------------------------------------------------------

function ContactStatusBadge({ status }: { status: OrgContact['status'] }) {
  const MAP: Record<OrgContact['status'], { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    suspended: { bg: '#fee2e2', color: '#991b1b' },
    inactive:  { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = MAP[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 500,
        background: s.bg,
        color: s.color,
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PortalToggle
// ---------------------------------------------------------------------------

interface PortalToggleProps {
  contact: OrgContact;
  orgId: string;
  canWrite: boolean;
}

function PortalToggle({ contact, orgId, canWrite }: PortalToggleProps) {
  const toggle = useTogglePortalAccess(orgId);

  const handleChange = useCallback(() => {
    toggle.mutate({
      contactId: contact.id,
      enabled: !contact.portalAccessEnabled,
      version: contact.version,
    });
  }, [contact, toggle]);

  return (
    <label
      title={!canWrite ? 'Administrator permission required' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: canWrite ? 'pointer' : 'not-allowed',
        opacity: !canWrite ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        role="switch"
        checked={contact.portalAccessEnabled}
        onChange={handleChange}
        disabled={!canWrite || toggle.isPending}
        aria-label={`Portal access for ${contact.fullName}`}
      />
      <span style={{ fontSize: 12, color: 'var(--color-fg-secondary, #374151)' }}>
        {contact.portalAccessEnabled ? 'Enabled' : 'Disabled'}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// AddContactForm
// ---------------------------------------------------------------------------

interface AddContactFormProps {
  orgId: string;
  onClose: () => void;
}

function AddContactForm({ orgId, onClose }: AddContactFormProps) {
  const createMutation = useCreateContact(orgId);
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    jobTitle: '',
    phone: '',
    portalAccessEnabled: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    try {
      await createMutation.mutateAsync({
        email: form.email,
        fullName: form.fullName,
        jobTitle: form.jobTitle || undefined,
        phone: form.phone || undefined,
        portalAccessEnabled: form.portalAccessEnabled,
      });
      onClose();
    } catch (err: unknown) {
      const e = err as { status?: number; details?: Array<{ fieldKey?: string; message?: string }>; message?: string };
      if (e.status === 400 && Array.isArray(e.details)) {
        const errs: Record<string, string> = {};
        e.details.forEach((d) => {
          if (d.fieldKey) errs[d.fieldKey] = d.message ?? 'Invalid value';
        });
        setFieldErrors(errs);
      } else if (e.status === 409) {
        setFieldErrors({ email: e.message ?? 'Email already exists' });
      }
    }
  }, [form, createMutation, onClose]);

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${fieldErrors[field] ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
    fontSize: 13,
    background: 'var(--color-bg-card, #fff)',
    boxSizing: 'border-box',
  });

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Add contact"
      noValidate
      style={{
        margin: '16px 0 0',
        padding: 16,
        background: 'var(--color-bg-alt, #f9fafb)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
      }}
    >
      <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>Add contact</h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label htmlFor="contact-email" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
            Email *
          </label>
          <input
            id="contact-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
            aria-invalid={Boolean(fieldErrors['email'])}
            style={inputStyle('email')}
          />
          {fieldErrors['email'] && (
            <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{fieldErrors['email']}</p>
          )}
        </div>

        <div>
          <label htmlFor="contact-name" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
            Full name *
          </label>
          <input
            id="contact-name"
            type="text"
            value={form.fullName}
            onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
            required
            aria-invalid={Boolean(fieldErrors['fullName'])}
            style={inputStyle('fullName')}
          />
          {fieldErrors['fullName'] && (
            <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{fieldErrors['fullName']}</p>
          )}
        </div>

        <div>
          <label htmlFor="contact-title" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
            Job title
          </label>
          <input
            id="contact-title"
            type="text"
            value={form.jobTitle}
            onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))}
            style={inputStyle('jobTitle')}
          />
        </div>

        <div>
          <label htmlFor="contact-phone" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
            Phone
          </label>
          <input
            id="contact-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            style={inputStyle('phone')}
          />
          {fieldErrors['phone'] && (
            <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{fieldErrors['phone']}</p>
          )}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.portalAccessEnabled}
          onChange={(e) => setForm((p) => ({ ...p, portalAccessEnabled: e.target.checked }))}
        />
        Enable portal access
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={createMutation.isPending}
          style={{
            padding: '7px 16px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--color-primary, #4f46e5)',
            color: '#fff',
            cursor: createMutation.isPending ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {createMutation.isPending ? 'Adding…' : 'Add contact'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '7px 16px',
            borderRadius: 6,
            border: '1px solid var(--color-border, #d1d5db)',
            background: 'var(--color-bg-card, #fff)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// ContactsPanel
// ---------------------------------------------------------------------------

interface ContactsPanelProps {
  orgId: string;
  canWrite: boolean;
}

export function ContactsPanel({ orgId, canWrite }: ContactsPanelProps) {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useOrgContacts(orgId);
  const [showAddForm, setShowAddForm] = useState(false);

  const contacts = data?.pages.flatMap((p) => p.data) ?? [];

  if (isLoading) {
    return (
      <div aria-label="Loading contacts" style={{ padding: 24 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ height: 52, background: 'var(--color-bg-alt, #f3f4f6)', borderRadius: 4, marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>
        Failed to load contacts.
      </div>
    );
  }

  return (
    <div>
      {contacts.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            border: '1px dashed var(--color-border, #e5e7eb)',
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No contacts yet</p>
          <p style={{ fontSize: 13, color: 'var(--color-muted, #6b7280)' }}>
            Add contacts to give team members portal access.
          </p>
        </div>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          aria-label="Organization contacts"
        >
          <thead>
            <tr style={{ background: 'var(--color-bg-alt, #f9fafb)' }}>
              {['Name', 'Email', 'Job Title', 'Status', 'Portal Access'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--color-muted, #6b7280)',
                    borderBottom: '1px solid var(--color-border, #e5e7eb)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr
                key={contact.id}
                style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}
              >
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{contact.fullName}</td>
                <td style={{ padding: '10px 12px', color: 'var(--color-fg-secondary, #374151)' }}>
                  {contact.email}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--color-muted, #6b7280)' }}>
                  {contact.jobTitle ?? '—'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <ContactStatusBadge status={contact.status} />
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <PortalToggle contact={contact} orgId={orgId} canWrite={canWrite} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #e5e7eb)',
              background: 'var(--color-bg-card, #fff)',
              cursor: isFetchingNextPage ? 'wait' : 'pointer',
              fontSize: 13,
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {canWrite && (
        <div style={{ marginTop: 16 }}>
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: '1px dashed var(--color-primary, #4f46e5)',
                background: 'transparent',
                color: 'var(--color-primary, #4f46e5)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              + Add contact
            </button>
          ) : (
            <AddContactForm orgId={orgId} onClose={() => setShowAddForm(false)} />
          )}
        </div>
      )}
    </div>
  );
}
