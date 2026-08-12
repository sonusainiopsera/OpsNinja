'use client';

/**
 * SignupDetailDrawer — slide-over panel for reviewing a pending portal signup (WO-091, AC10).
 *
 * Displays applicant details, suggested organization matches, and provides
 * approve / reject actions with confirmation dialogs.
 *
 * Features:
 *   - Organization picker with search for the approve flow
 *   - addVerifiedDomain checkbox (shown only when a suggested org is selected)
 *   - Inline conflict warning when duplicateDomainConflict=true
 *   - Reject dialog with reason selector, optional free-text note, and notify toggle
 *   - Keyboard accessible: Escape to close, focus trap while open
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import type { PendingSignupItem, RejectReason } from './PendingSignupsPage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignupDetailDrawerProps {
  item: PendingSignupItem;
  onClose: () => void;
  onApprove: (id: string, organizationId: string, addVerifiedDomain?: boolean) => Promise<void>;
  onReject: (id: string, reason: RejectReason, note?: string, notifyApplicant?: boolean) => Promise<void>;
  isApproving: boolean;
  isRejecting: boolean;
  approveError: (Error & { code?: string }) | null;
  rejectError: (Error & { code?: string }) | null;
}

const REJECT_REASONS: { value: RejectReason; label: string }[] = [
  { value: 'not_a_customer',     label: 'Not a customer' },
  { value: 'unrecognised_domain', label: 'Unrecognised domain' },
  { value: 'duplicate_request',  label: 'Duplicate request' },
  { value: 'security_concern',   label: 'Security concern' },
  { value: 'other',              label: 'Other' },
];

// ---------------------------------------------------------------------------
// ApprovePanel — org picker + addVerifiedDomain toggle
// ---------------------------------------------------------------------------

interface ApprovePanelProps {
  item: PendingSignupItem;
  isApproving: boolean;
  approveError: (Error & { code?: string }) | null;
  onApprove: (organizationId: string, addVerifiedDomain?: boolean) => void;
}

function ApprovePanel({ item, isApproving, approveError, onApprove }: ApprovePanelProps) {
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    item.suggestedOrganizations[0]?.id ?? '',
  );
  const [addVerifiedDomain, setAddVerifiedDomain] = useState(false);
  const [orgSearch, setOrgSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const filteredSuggestions = item.suggestedOrganizations.filter((o) =>
    o.name.toLowerCase().includes(orgSearch.toLowerCase()),
  );

  const selectedOrg = item.suggestedOrganizations.find((o) => o.id === selectedOrgId);

  return (
    <div data-testid="approve-panel">
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: '#111827' }}>
        Approve signup
      </h3>

      {/* Conflict warning */}
      {item.duplicateDomainConflict && (
        <div
          data-testid="conflict-warning-approve"
          role="alert"
          style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 14,
            fontSize: 13,
            color: '#92400e',
            display: 'flex',
            gap: 8,
          }}
        >
          <span>⚠</span>
          <span>
            Another organization in this tenant already claims the domain{' '}
            <strong>{item.domain}</strong>. Adding a verified domain here will conflict —
            only proceed if this is intentional.
          </span>
        </div>
      )}

      {/* Organization picker */}
      <label
        htmlFor="org-search"
        style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}
      >
        Select organization
      </label>
      <input
        id="org-search"
        type="text"
        aria-label="Search organization"
        placeholder="Search by name…"
        value={orgSearch}
        onChange={(e) => setOrgSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '7px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 13,
          marginBottom: 8,
          boxSizing: 'border-box',
        }}
      />

      {filteredSuggestions.length === 0 ? (
        <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>
          No matching organizations found.
        </p>
      ) : (
        <ul
          role="listbox"
          aria-label="Suggested organizations"
          style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}
        >
          {filteredSuggestions.map((org) => (
            <li
              key={org.id}
              role="option"
              aria-selected={selectedOrgId === org.id}
              onClick={() => setSelectedOrgId(org.id)}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: selectedOrgId === org.id ? '#eff6ff' : 'transparent',
                border: selectedOrgId === org.id
                  ? '1px solid #bfdbfe'
                  : '1px solid transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: selectedOrgId === org.id ? 600 : 400 }}>
                {org.name}
              </span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                score {org.score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Add verified domain toggle */}
      {selectedOrg && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            cursor: 'pointer',
            fontSize: 13,
            color: '#374151',
          }}
        >
          <input
            type="checkbox"
            data-testid="add-verified-domain-checkbox"
            checked={addVerifiedDomain}
            onChange={(e) => setAddVerifiedDomain(e.target.checked)}
          />
          Add <strong>{item.domain}</strong> as a verified domain on{' '}
          <em>{selectedOrg.name}</em> (future signups will auto-bind)
        </label>
      )}

      {/* Error from previous attempt */}
      {approveError && (
        <div
          role="alert"
          data-testid="approve-error"
          style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}
        >
          {approveError.code === 'SIGNUP_ALREADY_DECIDED'
            ? 'This request was already actioned by another administrator. Refresh to see the current state.'
            : approveError.code === 'VERIFIED_DOMAIN_CONFLICT'
              ? `Domain conflict: another organization already claims ${item.domain}.`
              : approveError.message ?? 'Approval failed. Please try again.'}
        </div>
      )}

      {/* Confirmation step */}
      {!confirmed ? (
        <button
          type="button"
          data-testid="approve-confirm-btn"
          disabled={!selectedOrgId}
          onClick={() => setConfirmed(true)}
          style={{
            width: '100%',
            padding: '9px 0',
            borderRadius: 6,
            border: 'none',
            background: selectedOrgId ? '#4f46e5' : '#e5e7eb',
            color: selectedOrgId ? '#fff' : '#9ca3af',
            fontWeight: 600,
            fontSize: 13,
            cursor: selectedOrgId ? 'pointer' : 'default',
          }}
        >
          Continue
        </button>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            Approve <strong>{item.maskedEmail}</strong> into{' '}
            <strong>{selectedOrg?.name}</strong>?
            {addVerifiedDomain && (
              <> Domain <strong>{item.domain}</strong> will be added as a verified domain.</>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              disabled={isApproving}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                color: '#374151',
              }}
            >
              Back
            </button>
            <button
              type="button"
              data-testid="approve-submit-btn"
              disabled={isApproving}
              onClick={() => onApprove(selectedOrgId, addVerifiedDomain || undefined)}
              style={{
                flex: 2,
                padding: '8px 0',
                borderRadius: 6,
                border: 'none',
                background: isApproving ? '#818cf8' : '#4f46e5',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: isApproving ? 'wait' : 'pointer',
              }}
            >
              {isApproving ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RejectPanel — reason selector + optional note + notify toggle
// ---------------------------------------------------------------------------

interface RejectPanelProps {
  item: PendingSignupItem;
  isRejecting: boolean;
  rejectError: (Error & { code?: string }) | null;
  onReject: (reason: RejectReason, note?: string, notifyApplicant?: boolean) => void;
}

function RejectPanel({ item, isRejecting, rejectError, onReject }: RejectPanelProps) {
  const [reason, setReason] = useState<RejectReason>('not_a_customer');
  const [note, setNote] = useState('');
  const [notifyApplicant, setNotifyApplicant] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const noteRemaining = 500 - note.length;

  return (
    <div data-testid="reject-panel">
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: '#111827' }}>
        Reject signup
      </h3>

      <label
        htmlFor="reject-reason"
        style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}
      >
        Reason
      </label>
      <select
        id="reject-reason"
        aria-label="Rejection reason"
        value={reason}
        onChange={(e) => setReason(e.target.value as RejectReason)}
        style={{
          width: '100%',
          padding: '7px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 13,
          marginBottom: 12,
          background: '#fff',
          boxSizing: 'border-box',
        }}
      >
        {REJECT_REASONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <label
        htmlFor="reject-note"
        style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}
      >
        Internal note <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional, max 500 chars)</span>
      </label>
      <textarea
        id="reject-note"
        aria-label="Internal rejection note"
        value={note}
        maxLength={500}
        rows={3}
        onChange={(e) => setNote(e.target.value)}
        placeholder="For internal use only — not sent to the applicant."
        style={{
          width: '100%',
          padding: '7px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 13,
          marginBottom: 4,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <p style={{ fontSize: 11, color: noteRemaining < 50 ? '#dc2626' : '#9ca3af', margin: '0 0 12px', textAlign: 'right' }}>
        {noteRemaining} characters remaining
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 14,
          cursor: 'pointer',
          fontSize: 13,
          color: '#374151',
        }}
      >
        <input
          type="checkbox"
          data-testid="notify-applicant-checkbox"
          checked={notifyApplicant}
          onChange={(e) => setNotifyApplicant(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          Send a neutral notification to the applicant (does not disclose the reason or
          any organization details)
        </span>
      </label>

      {/* Error from previous attempt */}
      {rejectError && (
        <div
          role="alert"
          data-testid="reject-error"
          style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}
        >
          {rejectError.code === 'SIGNUP_ALREADY_DECIDED'
            ? 'This request was already actioned by another administrator.'
            : rejectError.message ?? 'Rejection failed. Please try again.'}
        </div>
      )}

      {!confirmed ? (
        <button
          type="button"
          data-testid="reject-confirm-btn"
          onClick={() => setConfirmed(true)}
          style={{
            width: '100%',
            padding: '9px 0',
            borderRadius: 6,
            border: 'none',
            background: '#ef4444',
            color: '#fff',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            Reject <strong>{item.maskedEmail}</strong> with reason{' '}
            <strong>{REJECT_REASONS.find((r) => r.value === reason)?.label}</strong>?
            {notifyApplicant && ' A neutral notification will be sent.'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              disabled={isRejecting}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                color: '#374151',
              }}
            >
              Back
            </button>
            <button
              type="button"
              data-testid="reject-submit-btn"
              disabled={isRejecting}
              onClick={() => onReject(reason, note || undefined, notifyApplicant || undefined)}
              style={{
                flex: 2,
                padding: '8px 0',
                borderRadius: 6,
                border: 'none',
                background: isRejecting ? '#fca5a5' : '#ef4444',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: isRejecting ? 'wait' : 'pointer',
              }}
            >
              {isRejecting ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignupDetailDrawer
// ---------------------------------------------------------------------------

export function SignupDetailDrawer({
  item,
  onClose,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
  approveError,
  rejectError,
}: SignupDetailDrawerProps) {
  const [activeAction, setActiveAction] = useState<'approve' | 'reject' | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Escape closes drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Focus trap
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    drawer.addEventListener('keydown', handler);
    return () => drawer.removeEventListener('keydown', handler);
  }, []);

  const handleApprove = useCallback(
    (orgId: string, addVerifiedDomain?: boolean) =>
      onApprove(item.id, orgId, addVerifiedDomain),
    [item.id, onApprove],
  );

  const handleReject = useCallback(
    (reason: RejectReason, note?: string, notifyApplicant?: boolean) =>
      onReject(item.id, reason, note, notifyApplicant),
    [item.id, onReject],
  );

  const isPending = item.status === 'pending_admin_approval';

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 40,
        }}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Signup details: ${item.maskedEmail}`}
        data-testid="signup-detail-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: '100vw',
          background: '#fff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>
              Signup request
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>
              {item.maskedEmail}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close drawer"
            onClick={onClose}
            style={{
              padding: 8,
              background: 'none',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              color: '#6b7280',
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Applicant details */}
          <section aria-label="Applicant details" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Applicant
            </h3>
            <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', margin: 0 }}>
              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Name</dt>
              <dd style={{ fontSize: 13, color: '#111827', margin: 0 }}>{item.fullName ?? '—'}</dd>

              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Email</dt>
              <dd style={{ fontSize: 13, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{item.maskedEmail}</dd>

              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Domain</dt>
              <dd style={{ fontSize: 13, color: '#111827', margin: 0 }}>{item.domain}</dd>

              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Status</dt>
              <dd style={{ margin: 0 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 600,
                    background: item.status === 'pending_admin_approval' ? '#fef3c7' : '#f3f4f6',
                    color: item.status === 'pending_admin_approval' ? '#92400e' : '#374151',
                  }}
                >
                  {item.status.replace(/_/g, ' ')}
                </span>
              </dd>

              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Submitted</dt>
              <dd style={{ fontSize: 13, color: '#111827', margin: 0 }}>
                {new Date(item.createdAt).toLocaleString('en-GB', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </dd>

              <dt style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Verification</dt>
              <dd style={{ fontSize: 13, margin: 0 }}>
                <span
                  style={{
                    color: item.verificationEmailStatus === 'bounced'
                      ? '#dc2626'
                      : item.verificationEmailStatus === 'delivered'
                        ? '#059669'
                        : '#6b7280',
                    fontWeight: item.verificationEmailStatus === 'bounced' ? 600 : 400,
                  }}
                >
                  {item.verificationEmailStatus
                    ? item.verificationEmailStatus.charAt(0).toUpperCase() + item.verificationEmailStatus.slice(1)
                    : '—'}
                </span>
                {item.verificationEmailStatus === 'bounced' && (
                  <span style={{ fontSize: 11, color: '#dc2626', display: 'block' }}>
                    ⚠ Email hard-bounced — verify address before approving
                  </span>
                )}
              </dd>
            </dl>
          </section>

          {/* Suggested organizations */}
          {item.suggestedOrganizations.length > 0 && (
            <section aria-label="Suggested organizations" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Suggested organizations
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {item.suggestedOrganizations.map((org) => (
                  <li
                    key={org.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: '#f9fafb',
                      marginBottom: 6,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{org.name}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      similarity {(org.score * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Domain conflict banner */}
          {item.duplicateDomainConflict && (
            <div
              data-testid="drawer-conflict-banner"
              role="alert"
              style={{
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 20,
                fontSize: 13,
                color: '#92400e',
              }}
            >
              ⚠ Another organization already holds a verified domain matching{' '}
              <strong>{item.domain}</strong>. Approve with caution.
            </div>
          )}

          {/* Action panels — only shown for pending requests */}
          {isPending && (
            <section aria-label="Actions" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Decision
              </h3>

              {/* Action selector */}
              {activeAction === null && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    data-testid="open-approve-btn"
                    onClick={() => setActiveAction('approve')}
                    style={{
                      flex: 1,
                      padding: '9px 0',
                      borderRadius: 6,
                      border: 'none',
                      background: '#4f46e5',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    data-testid="open-reject-btn"
                    onClick={() => setActiveAction('reject')}
                    style={{
                      flex: 1,
                      padding: '9px 0',
                      borderRadius: 6,
                      border: '1px solid #ef4444',
                      background: 'transparent',
                      color: '#ef4444',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}

              {activeAction === 'approve' && (
                <>
                  <ApprovePanel
                    item={item}
                    isApproving={isApproving}
                    approveError={approveError}
                    onApprove={handleApprove}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    style={{
                      marginTop: 10,
                      background: 'none',
                      border: 'none',
                      fontSize: 12,
                      color: '#6b7280',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ← Back to options
                  </button>
                </>
              )}

              {activeAction === 'reject' && (
                <>
                  <RejectPanel
                    item={item}
                    isRejecting={isRejecting}
                    rejectError={rejectError}
                    onReject={handleReject}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    style={{
                      marginTop: 10,
                      background: 'none',
                      border: 'none',
                      fontSize: 12,
                      color: '#6b7280',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ← Back to options
                  </button>
                </>
              )}
            </section>
          )}

          {/* Non-pending: show final status */}
          {!isPending && (
            <div
              style={{
                padding: '16px',
                background: '#f9fafb',
                borderRadius: 6,
                fontSize: 13,
                color: '#6b7280',
                textAlign: 'center',
              }}
            >
              This request has already been{' '}
              <strong style={{ color: item.status === 'approved' ? '#059669' : '#dc2626' }}>
                {item.status}
              </strong>
              {' '}and cannot be actioned again.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
