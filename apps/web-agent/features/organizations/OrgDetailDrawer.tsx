'use client';

/**
 * OrgDetailDrawer — slide-over panel with tabbed organization details.
 *
 * Tabs:
 *   1. Profile     — editable core fields (ProfilePanel)
 *   2. DevOps Metadata — dynamic custom fields (MetadataPanel)
 *   3. Contacts    — contacts with portal toggle (ContactsPanel)
 *   4. Agent Scoping — read-only scope list (ScopingPanel)
 *   5. Audit       — placeholder until AuditPanel WO lands
 *
 * Accessibility:
 *   - Focus trapped while open (Tab cycles within drawer)
 *   - Escape closes
 *   - Tab panel role with aria-labelledby per tab
 *   - Keyboard-navigable tab list (arrow keys)
 *
 * Lazy loading: each panel's data is only fetched on first tab activation.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import type { Organization } from '../../lib/api/organizations/types';
import { useOrganization, useReactivateOrganization } from '../../lib/api/organizations/hooks';
import { ProfilePanel } from './ProfilePanel';
import { ContactsPanel } from './ContactsPanel';
import { ScopingPanel } from './ScopingPanel';
import { AddCustomFieldModal } from './AddCustomFieldModal';

// MetadataPanel lives in app/(app)/organizations/components per existing scaffold
import { MetadataPanel } from '../../app/(app)/organizations/components/MetadataPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TabId = 'profile' | 'metadata' | 'contacts' | 'scoping' | 'audit';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profile',   label: 'Profile' },
  { id: 'metadata',  label: 'DevOps Metadata' },
  { id: 'contacts',  label: 'Contacts' },
  { id: 'scoping',   label: 'Agent Scoping' },
  { id: 'audit',     label: 'Audit' },
];

function StatusBadge({ status }: { status: Organization['status'] }) {
  const MAP: Record<Organization['status'], { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    inactive:  { bg: '#f3f4f6', color: '#6b7280' },
    suspended: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = MAP[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 99,
        fontSize: 12,
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
// TabPanel
// ---------------------------------------------------------------------------

interface TabPanelProps {
  id: TabId;
  activeId: TabId;
  activated: Set<TabId>;
  children: React.ReactNode;
}

function TabPanel({ id, activeId, activated, children }: TabPanelProps) {
  const isActive = id === activeId;
  if (!activated.has(id)) return null;

  return (
    <div
      role="tabpanel"
      id={`drawer-panel-${id}`}
      aria-labelledby={`drawer-tab-${id}`}
      hidden={!isActive}
      style={{ padding: '16px 0' }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrgDetailDrawer
// ---------------------------------------------------------------------------

interface OrgDetailDrawerProps {
  orgId: string | null;
  canWrite: boolean;
  onClose: () => void;
  onDeactivate: (org: Organization) => void;
}

export function OrgDetailDrawer({
  orgId,
  canWrite,
  onClose,
  onDeactivate,
}: OrgDetailDrawerProps) {
  const { data: org, isLoading, isError } = useOrganization(orgId);
  const reactivateMutation = useReactivateOrganization(orgId ?? '');

  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [activatedTabs, setActivatedTabs] = useState<Set<TabId>>(new Set(['profile']));
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reset tab on org change
  useEffect(() => {
    if (orgId) {
      setActiveTab('profile');
      setActivatedTabs(new Set(['profile']));
    }
  }, [orgId]);

  // Focus close button when opened
  useEffect(() => {
    if (orgId) {
      setTimeout(() => closeButtonRef.current?.focus(), 100);
    }
  }, [orgId]);

  // Escape closes
  useEffect(() => {
    if (!orgId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [orgId, onClose]);

  // Focus trap
  useEffect(() => {
    if (!orgId || !drawerRef.current) return;
    const drawer = drawerRef.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [orgId]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setActivatedTabs((prev) => new Set([...prev, tab]));
  }, []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = TABS[(idx + 1) % TABS.length]!;
        handleTabChange(next.id);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = TABS[(idx - 1 + TABS.length) % TABS.length]!;
        handleTabChange(prev.id);
      }
    },
    [handleTabChange],
  );

  if (!orgId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 100,
        }}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={org ? `${org.name} details` : 'Organization details'}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(640px, 100vw)',
          background: 'var(--color-bg-card, #fff)',
          boxShadow: '-4px 0 40px rgba(0,0,0,0.15)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              {isLoading ? (
                <div style={{ height: 24, width: 200, background: 'var(--color-bg-alt, #f3f4f6)', borderRadius: 4 }} />
              ) : isError ? (
                <p style={{ color: '#dc2626', fontSize: 14 }}>Organization not found</p>
              ) : org ? (
                <>
                  <h2
                    style={{
                      margin: '0 0 6px',
                      fontSize: 18,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {org.name}
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <StatusBadge status={org.status} />
                    <span style={{ fontSize: 12, color: 'var(--color-muted, #6b7280)' }}>
                      {org.tier} · {org.region ?? 'no region'}
                    </span>
                  </div>
                </>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {org && canWrite && org.status === 'active' && (
                <button
                  type="button"
                  onClick={() => onDeactivate(org)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid #f87171',
                    background: 'transparent',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  Deactivate
                </button>
              )}
              {org && canWrite && org.status !== 'active' && (
                <button
                  type="button"
                  disabled={reactivateMutation.isPending}
                  onClick={() => void reactivateMutation.mutateAsync()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--color-primary, #4f46e5)',
                    background: 'transparent',
                    color: 'var(--color-primary, #4f46e5)',
                    cursor: reactivateMutation.isPending ? 'wait' : 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {reactivateMutation.isPending ? 'Reactivating…' : 'Reactivate'}
                </button>
              )}

              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close drawer"
                onClick={onClose}
                style={{
                  padding: 8,
                  background: 'none',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  color: 'var(--color-muted, #6b7280)',
                }}
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Tab list */}
        <div
          role="tablist"
          aria-label="Organization detail sections"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            padding: '0 20px',
            gap: 0,
            flexShrink: 0,
            overflowX: 'auto',
          }}
        >
          {TABS.map((tab, idx) => (
            <button
              key={tab.id}
              id={`drawer-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`drawer-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              style={{
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id
                  ? 'var(--color-primary, #4f46e5)'
                  : 'var(--color-fg-secondary, #374151)',
                borderBottom: activeTab === tab.id
                  ? '2px solid var(--color-primary, #4f46e5)'
                  : '2px solid transparent',
                whiteSpace: 'nowrap',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-primary, #4f46e5)')}
              onBlur={(e) => (e.currentTarget.style.outline = 'none')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {isLoading ? (
            <div aria-label="Loading" style={{ padding: 24 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: 48, background: 'var(--color-bg-alt, #f3f4f6)', borderRadius: 4, marginBottom: 10 }} />
              ))}
            </div>
          ) : isError ? (
            <div role="alert" style={{ padding: 24, color: '#dc2626', fontSize: 14 }}>
              Failed to load organization details.
            </div>
          ) : org ? (
            <>
              <TabPanel id="profile" activeId={activeTab} activated={activatedTabs}>
                <ProfilePanel org={org} canWrite={canWrite} />
              </TabPanel>

              <TabPanel id="metadata" activeId={activeTab} activated={activatedTabs}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>DevOps metadata</h3>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setShowAddFieldModal(true)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--color-primary, #4f46e5)',
                        background: 'transparent',
                        color: 'var(--color-primary, #4f46e5)',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      + Add field
                    </button>
                  )}
                </div>
                <MetadataPanel orgId={org.id} orgVersion={org.version} canWrite={canWrite} />
              </TabPanel>

              <TabPanel id="contacts" activeId={activeTab} activated={activatedTabs}>
                <ContactsPanel orgId={org.id} canWrite={canWrite} />
              </TabPanel>

              <TabPanel id="scoping" activeId={activeTab} activated={activatedTabs}>
                <ScopingPanel orgId={org.id} />
              </TabPanel>

              <TabPanel id="audit" activeId={activeTab} activated={activatedTabs}>
                <div
                  style={{
                    padding: '32px 0',
                    textAlign: 'center',
                    color: 'var(--color-muted, #6b7280)',
                    fontSize: 13,
                  }}
                >
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Audit trail</p>
                  <p>Organization audit log entries will appear here.</p>
                </div>
              </TabPanel>
            </>
          ) : null}
        </div>
      </div>

      {/* Add field modal — rendered outside drawer so it overlays properly */}
      <AddCustomFieldModal
        open={showAddFieldModal}
        onClose={() => setShowAddFieldModal(false)}
      />
    </>
  );
}
