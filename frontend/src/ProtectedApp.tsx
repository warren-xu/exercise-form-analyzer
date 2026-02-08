import { useAuth0 } from '@auth0/auth0-react';
import { useEffect } from 'react';
import App from './App';
import { LoginPage } from './LoginPage';

export function ProtectedApp() {
  const { isLoading, isAuthenticated, error, user } = useAuth0();

  useEffect(() => {
    console.log('Auth state:', { isLoading, isAuthenticated, error: error?.message, user });
  }, [isLoading, isAuthenticated, error, user]);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0f0f0f',
        color: '#e0e0e0',
        fontSize: '1.2rem',
      }}>
        Loading authentication...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0f0f0f',
        color: '#ff6b6b',
        fontSize: '1rem',
        padding: '20px',
        textAlign: 'center',
        maxWidth: '600px',
        margin: '0 auto',
      }}>
        <h2 style={{ marginBottom: '20px' }}>Authentication Error</h2>
        <p style={{ marginBottom: '10px', wordBreak: 'break-word' }}>{error.message}</p>
        <details style={{ marginTop: '20px', textAlign: 'left', width: '100%' }}>
          <summary style={{ cursor: 'pointer', color: '#b0b0b0' }}>Debug Info</summary>
          <pre style={{ 
            backgroundColor: '#1a1a1a', 
            padding: '10px', 
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '12px',
            marginTop: '10px'
          }}>
            {JSON.stringify({ 
              error: error.message, 
              name: error.name,
              domain: 'dev-tnm5vyf4qjytxom6.us.auth0.com',
              redirectUri: window.location.origin,
              currentUrl: window.location.href
            }, null, 2)}
          </pre>
        </details>
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => {
              localStorage.clear();
              sessionStorage.clear();
              window.location.href = '/';
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Clear Cache & Retry
          </button>
          <button
            onClick={() => window.open('https://dev-tnm5vyf4qjytxom6.us.auth0.com/v2/logout', '_blank')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Logout from Auth0
          </button>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <App /> : <LoginPage />;
}
