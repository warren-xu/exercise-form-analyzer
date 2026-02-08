/**
 * Coach panel: assistant summary, cues, safety note.
 */

import type { AssistantOutput } from './types';

export interface CoachPanelProps {
  output: AssistantOutput | null;
  loading?: boolean;
  error?: string | null;
}

export function CoachPanel({ output, loading, error }: CoachPanelProps) {
  if (error) {
    return (
      <div style={panelStyle}>
        <h3 style={headingStyle}>Coach</h3>
        <p style={{ color: 'var(--flag)' }}>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={panelStyle}>
        <h3 style={headingStyle}>Coach</h3>
        <p style={{ color: 'var(--muted)' }}>Getting feedback…</p>
      </div>
    );
  }

  if (!output) {
    return (
      <div style={panelStyle}>
        <h3 style={headingStyle}>Coach</h3>
        <p style={{ color: 'var(--muted)' }}>
          Complete a set and tap “Get coach feedback” to see personalized cues.
        </p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <h3 style={headingStyle}>Coach</h3>
      <p style={summaryStyle}>{output.summary}</p>
      {output.cues.length > 0 && (
        <ul style={listStyle}>
          {output.cues.map((cue, i) => (
            <li key={i} style={listItemStyle}>{cue}</li>
          ))}
        </ul>
      )}
      <p style={safetyStyle}>{output.safety_note}</p>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 18,
  fontWeight: 600,
};

const summaryStyle: React.CSSProperties = {
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 20,
  lineHeight: 1.6,
};

const listItemStyle: React.CSSProperties = {
  marginBottom: 6,
};

const safetyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: 'var(--watch)',
};
