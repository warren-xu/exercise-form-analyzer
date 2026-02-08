import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { getUserHistory, deleteSession, type SessionHistory } from './api';

export function HistoricalFeedback() {
  const { getAccessTokenSilently, getIdTokenClaims } = useAuth0();
  const [history, setHistory] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      const idClaims = await getIdTokenClaims().catch(() => undefined);
      const userId = idClaims?.sub;
      const data = await getUserHistory(token, 20, userId);
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleDelete = async (sessionId: string) => {
    if (!confirm('Delete this session?')) return;
    try {
      const token = await getAccessTokenSilently();
      const idClaims = await getIdTokenClaims().catch(() => undefined);
      const userId = idClaims?.sub;
      await deleteSession(sessionId, token, userId);
      setHistory(prev => prev.filter(s => s.session_id !== sessionId));
    } catch (err) {
      alert('Failed to delete session');
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={{
      backgroundColor: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      maxHeight: '600px',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Session History</h3>
        <button
          onClick={loadHistory}
          disabled={loading}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            backgroundColor: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, backgroundColor: '#3a1f1f', color: '#ff6b6b', borderRadius: 4, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 14 }}>
          No sessions yet. Complete a workout to see your history here!
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.map((session) => (
            <div
              key={session.id}
              style={{
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                    {session.rep_count} reps
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {formatDate(session.timestamp)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(session.session_id);
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    backgroundColor: 'transparent',
                    color: '#ff6b6b',
                    border: '1px solid #ff6b6b',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>

              {expandedId === session.id && session.assistant_feedback && (
                <div style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 500, marginBottom: 8, color: 'var(--accent)' }}>
                    Coach Feedback:
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
                    {session.assistant_feedback.summary || 'No summary available.'}
                    {Array.isArray(session.assistant_feedback.cues) && session.assistant_feedback.cues.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>Cues:</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {session.assistant_feedback.cues.map((cue, idx) => (
                            <li key={idx}>{cue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {session.assistant_feedback.safety_note && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>Safety:</div>
                        <div>{session.assistant_feedback.safety_note}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
