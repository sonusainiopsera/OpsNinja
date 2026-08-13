/**
 * AttachmentLink — fetches a pre-signed download URL on click — WO-090 AC8.
 *
 * Security invariants:
 *   - Never stores or renders raw bucket URLs — only pre-signed GET URLs with
 *     5-minute expiry issued by the server after ownership check.
 *   - 404 from the server indicates ownership check failure or reaped object;
 *     rendered as "unavailable" rather than an error message.
 */

'use client';

import React, { useState } from 'react';
import { useAttachmentDownload } from '../../lib/api/tickets/hooks';
import { ApiError } from '@opsninja/api-client';

export interface AttachmentLinkProps {
  attachmentId: string;
  displayName: string;
}

export function AttachmentLink({ attachmentId, displayName }: AttachmentLinkProps) {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, isError, error, refetch } = useAttachmentDownload(attachmentId, enabled);

  const is404 = error instanceof ApiError && error.status === 404;

  // Once URL arrives, auto-open it
  React.useEffect(() => {
    if (data?.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  }, [data?.url]);

  if (is404) {
    return (
      <span
        data-testid={`attachment-unavailable-${attachmentId}`}
        style={{ fontSize: 12, color: 'var(--portal-fg-muted, #9ca3af)', cursor: 'not-allowed' }}
        title="Attachment unavailable"
      >
        📎 {displayName} (unavailable)
      </span>
    );
  }

  if (isError) {
    return (
      <button
        onClick={() => { setEnabled(true); void refetch(); }}
        data-testid={`attachment-retry-${attachmentId}`}
        style={{ fontSize: 12, color: 'var(--portal-danger, #dc2626)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        📎 {displayName} (failed — retry)
      </button>
    );
  }

  return (
    <button
      onClick={() => {
        if (!enabled) {
          setEnabled(true);
        } else {
          void refetch();
        }
      }}
      disabled={isFetching}
      data-testid={`attachment-link-${attachmentId}`}
      style={{
        fontSize: 12,
        color: 'var(--portal-primary, #2563eb)',
        background: 'none',
        border: 'none',
        cursor: isFetching ? 'wait' : 'pointer',
        padding: 0,
        textDecoration: 'underline',
      }}
    >
      📎 {displayName}{isFetching ? ' (loading…)' : ''}
    </button>
  );
}
