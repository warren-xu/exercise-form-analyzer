/**
 * Backend API client.
 */

import type { RepSummary, AssistantOutput } from './types';

const API_BASE = '/api';

// Helper to get auth header
function getAuthHeaders(accessToken?: string, userId?: string): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (userId) {
    headers['X-User-Id'] = userId;
  }
  return headers;
}

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

/** Convert frontend RepSummary to backend rep payload (no frame indices). */
function toRepPayload(rep: RepSummary, sessionId: string) {
  const confidence: Record<string, unknown> = { ...rep.confidence };
  if (rep.depth_score !== undefined) confidence.depth_score = rep.depth_score;
  if (rep.stability_score !== undefined) confidence.stability_score = rep.stability_score;
  if (rep.asymmetry_score !== undefined) confidence.asymmetry_score = rep.asymmetry_score;
  if (rep.min_knee_angle !== undefined) confidence.min_knee_angle = rep.min_knee_angle;
  return {
    session_id: sessionId,
    rep_index: rep.rep_index,
    confidence,
    checks: {
      depth: { severity: rep.checks.depth.severity, evidence: rep.checks.depth.evidence },
      knee_tracking: { severity: rep.checks.knee_tracking.severity, evidence: rep.checks.knee_tracking.evidence },
      torso_angle: { severity: rep.checks.torso_angle.severity, evidence: rep.checks.torso_angle.evidence },
      heel_lift: { severity: rep.checks.heel_lift.severity, evidence: rep.checks.heel_lift.evidence },
      asymmetry: { severity: rep.checks.asymmetry.severity, evidence: rep.checks.asymmetry.evidence },
    },
  };
}

export type CoachMode = 'check_in' | 'set_summary';

export async function getSetCoach(
  sessionId: string,
  reps: RepSummary[],
  setLevelSummary?: { worst_issues?: string[]; trends?: string[]; consistency_note?: string },
  coachMode: CoachMode = 'set_summary',
  accessToken?: string,
  userId?: string
): Promise<AssistantOutput> {
  const headers = getAuthHeaders(accessToken, userId);
  console.log('🌐 Sending request to /api/coach/set');
  console.log('🌐 Headers:', JSON.stringify(headers, null, 2));
  console.log('🌐 Access token present:', !!accessToken);
  
  const res = await fetch(`${API_BASE}/coach/set`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      rep_count: reps.length,
      reps: reps.map((r) => toRepPayload(r, sessionId)),
      set_level_summary: setLevelSummary,
      coach_mode: coachMode,
    }),
  });
  
  console.log('🌐 Response status:', res.status);
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `Set coach failed: ${res.status}`);
  }
  return res.json();
}

export interface SessionHistory {
  id: string;
  user_id: string;
  user_email?: string;
  session_id: string;
  timestamp: string;
  rep_count: number;
  assistant_feedback?: AssistantOutput;
}

export async function getUserHistory(
  accessToken: string,
  limit: number = 10,
  userId?: string
): Promise<SessionHistory[]> {
  const res = await fetch(`${API_BASE}/history?limit=${limit}`, {
    headers: getAuthHeaders(accessToken, userId),
  });
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

export async function deleteSession(
  sessionId: string,
  accessToken: string,
  userId?: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/history/${sessionId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(accessToken, userId),
  });
  if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`);
}
