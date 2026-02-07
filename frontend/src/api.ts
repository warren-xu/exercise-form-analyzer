/**
 * Backend API client.
 */

import type { RepSummary, AssistantOutput } from './types';

const API_BASE = '/api';

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

/** Convert frontend RepSummary to backend rep payload (no frame indices). */
function toRepPayload(rep: RepSummary, sessionId: string) {
  return {
    session_id: sessionId,
    rep_index: rep.rep_index,
    confidence: rep.confidence,
    checks: {
      depth: { severity: rep.checks.depth.severity, evidence: rep.checks.depth.evidence },
      knee_tracking: { severity: rep.checks.knee_tracking.severity, evidence: rep.checks.knee_tracking.evidence },
      torso_angle: { severity: rep.checks.torso_angle.severity, evidence: rep.checks.torso_angle.evidence },
      heel_lift: { severity: rep.checks.heel_lift.severity, evidence: rep.checks.heel_lift.evidence },
      asymmetry: { severity: rep.checks.asymmetry.severity, evidence: rep.checks.asymmetry.evidence },
    },
  };
}

export async function getSetCoach(
  sessionId: string,
  reps: RepSummary[],
  setLevelSummary?: { worst_issues?: string[]; trends?: string[]; consistency_note?: string }
): Promise<AssistantOutput> {
  const res = await fetch(`${API_BASE}/coach/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      rep_count: reps.length,
      reps: reps.map((r) => toRepPayload(r, sessionId)),
      set_level_summary: setLevelSummary,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `Set coach failed: ${res.status}`);
  }
  return res.json();
}
