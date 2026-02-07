/**
 * Five check status cards: Depth, Knee Tracking, Torso Angle, Heel Lift, Asymmetry.
 */

import type { RepCheckResult, CheckStatus } from './types';

const CARD_LABELS: Record<string, string> = {
  depth: 'Depth',
  knee_tracking: 'Knee Tracking',
  torso_angle: 'Torso Angle',
  heel_lift: 'Heel Lift',
  asymmetry: 'Asymmetry',
};

const STATUS_COLORS: Record<CheckStatus, string> = {
  ok: 'var(--ok)',
  watch: 'var(--watch)',
  flag: 'var(--flag)',
};

export type ChecksMap = {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
};

export interface StatusCardsProps {
  checks: ChecksMap | null;
  /** Live rolling status (optional); overrides rep-based when in Live phase */
  liveChecks?: ChecksMap | null;
}

export function StatusCards({ checks, liveChecks }: StatusCardsProps) {
  const source = liveChecks ?? checks;
  if (!source) {
    return (
      <div style={gridStyle}>
        {Object.entries(CARD_LABELS).map(([key, label]) => (
          <div key={key} style={cardStyle}>
            <span style={labelStyle}>{label}</span>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>—</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {Object.entries(CARD_LABELS).map(([key]) => {
        const check = source[key as keyof typeof source] as RepCheckResult;
        const color = STATUS_COLORS[check.status];
        const evidenceStr =
          check.evidence && Object.keys(check.evidence).length > 0
            ? Object.entries(check.evidence)
                .slice(0, 2)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')
            : '';
        return (
          <div key={key} style={cardStyle}>
            <span style={labelStyle}>{CARD_LABELS[key]}</span>
            <span style={{ ...statusStyle, color }}>{check.status.toUpperCase()}</span>
            <span style={severityStyle}>{check.severity}</span>
            {evidenceStr && (
              <span style={evidenceStyle}>{evidenceStr}</span>
            )}
            {check.cue && (
              <span style={cueStyle}>{check.cue}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
};

const statusStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
};

const severityStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
};

const evidenceStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
  fontFamily: 'monospace',
};

const cueStyle: React.CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  lineHeight: 1.3,
};
