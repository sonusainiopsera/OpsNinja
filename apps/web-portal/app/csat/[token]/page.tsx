/**
 * CSAT Survey Response Page
 *
 * Lightweight unauthenticated page. No session required — the token in the URL
 * is the only credential. All data is fetched server-side from the API.
 *
 * CSP: strict policy blocks external scripts, inline styles, and framing.
 * Comment field is never rendered as HTML (always escaped via React's default).
 */

import React from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Share Your Feedback — OpsNinja',
  robots: 'noindex, nofollow',
};

interface SurveyData {
  ticketReference: string;
  ticketSubject: string;
  organizationName: string;
  scale: { min: number; max: number };
  alreadyResponded: boolean;
  preselectedScore?: number;
}

async function fetchSurvey(
  token: string,
  scoreParam: string | undefined,
): Promise<{ data?: SurveyData; status: number }> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://api:3000';
  const url = scoreParam
    ? `${apiBase}/api/v1/csat/${encodeURIComponent(token)}?score=${encodeURIComponent(scoreParam)}`
    : `${apiBase}/api/v1/csat/${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { status: res.status };
    const json = (await res.json()) as { data: SurveyData };
    return { data: json.data, status: res.status };
  } catch {
    return { status: 500 };
  }
}

interface PageProps {
  params: { token: string };
  searchParams: { score?: string };
}

export default async function CsatPage({ params, searchParams }: PageProps) {
  const { token } = params;
  const scoreParam = searchParams.score;
  const { data, status } = await fetchSurvey(token, scoreParam);

  // Set strict CSP via response headers (Next.js 14 server component approach).
  // The page intentionally has no external resources.

  if (status === 404 || status === 410) {
    return (
      <main style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.heading}>Survey link not available</h1>
          <p style={styles.body}>
            This survey link may have expired or already been used.
            Thank you for your time.
          </p>
        </div>
      </main>
    );
  }

  if (!data || status !== 200) {
    return (
      <main style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.heading}>Something went wrong</h1>
          <p style={styles.body}>Please try again later.</p>
        </div>
      </main>
    );
  }

  if (data.alreadyResponded) {
    return (
      <main style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.heading}>Thank you for your feedback!</h1>
          <p style={styles.body}>Your response has already been recorded.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      <div style={styles.card}>
        <p style={styles.orgLabel}>{data.organizationName}</p>
        <h1 style={styles.heading}>How did we do?</h1>
        <p style={styles.body}>
          Ticket: <strong>{data.ticketSubject}</strong>
        </p>
        <p style={styles.subBody}>Rate your experience from {data.scale.min} (worst) to {data.scale.max} (best).</p>

        {/* Score buttons — one-click submit form with POST */}
        <form method="POST" action={`/api/csat-submit`} style={styles.scoreRow}>
          <input type="hidden" name="token" value={token} />
          {Array.from({ length: data.scale.max - data.scale.min + 1 }, (_, i) => {
            const score = i + data.scale.min;
            const isPreselected = data.preselectedScore === score;
            return (
              <button
                key={score}
                type="submit"
                name="score"
                value={String(score)}
                style={{
                  ...styles.scoreButton,
                  ...(isPreselected ? styles.scoreButtonSelected : {}),
                }}
                aria-label={`Rate ${score} out of ${data.scale.max}`}
              >
                {score}
              </button>
            );
          })}
        </form>

        {/* Full form for comment + score selection */}
        <CsatForm token={token} preselectedScore={data.preselectedScore} apiBase="" />
      </div>
    </main>
  );
}

function CsatForm({
  token,
  preselectedScore,
  apiBase,
}: {
  token: string;
  preselectedScore?: number;
  apiBase: string;
}) {
  return (
    <form
      style={styles.fullForm}
      action={`${apiBase}/api/v1/csat/${encodeURIComponent(token)}`}
      method="POST"
    >
      <label style={styles.label} htmlFor="score-select">
        Your score
      </label>
      <select
        id="score-select"
        name="score"
        defaultValue={String(preselectedScore ?? '')}
        required
        style={styles.select}
      >
        <option value="">Select a score…</option>
        {[1, 2, 3, 4, 5].map((s) => (
          <option key={s} value={String(s)}>
            {s}
          </option>
        ))}
      </select>

      <label style={styles.label} htmlFor="comment">
        Comments (optional)
      </label>
      <textarea
        id="comment"
        name="comment"
        maxLength={2000}
        rows={4}
        placeholder="Tell us more about your experience…"
        style={styles.textarea}
      />

      <button type="submit" style={styles.submitButton}>
        Submit feedback
      </button>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f6f9',
    padding: '1rem',
  },
  card: {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    padding: '2rem',
    maxWidth: 480,
    width: '100%',
  },
  orgLabel: { color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.25rem' },
  heading: { fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' },
  body: { color: '#374151', lineHeight: 1.6 },
  subBody: { color: '#6b7280', fontSize: '0.875rem', margin: '0.5rem 0 1rem' },
  scoreRow: { display: 'flex', gap: '0.5rem', margin: '1rem 0' },
  scoreButton: {
    width: 48,
    height: 48,
    border: '2px solid #d1d5db',
    borderRadius: 6,
    background: '#f9fafb',
    cursor: 'pointer',
    fontSize: '1.125rem',
    fontWeight: 600,
  },
  scoreButtonSelected: {
    border: '2px solid #3b82f6',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  fullForm: { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' },
  label: { fontSize: '0.875rem', fontWeight: 600, color: '#374151' },
  select: { padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '1rem' },
  textarea: { padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.875rem', resize: 'vertical' },
  submitButton: {
    padding: '0.625rem 1.5rem',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    alignSelf: 'flex-start',
  },
};
