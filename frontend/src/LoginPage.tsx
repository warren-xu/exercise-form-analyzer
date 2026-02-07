import { useAuth0 } from '@auth0/auth0-react';
import './index.css';

export function LoginPage() {
  const { loginWithRedirect, isLoading } = useAuth0();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#0f0f0f',
      color: '#e0e0e0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '500px',
        padding: '40px',
      }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '20px' }}>
          Exercise Form Analyzer
        </h1>
        <p style={{ fontSize: '1.1rem', marginBottom: '30px', color: '#b0b0b0' }}>
          Live webcam squat feedback with AI coaching
        </p>
        <button
          onClick={() => loginWithRedirect()}
          disabled={isLoading}
          style={{
            padding: '12px 32px',
            fontSize: '1rem',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
            transition: 'all 0.3s ease',
          }}
          onMouseOver={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#45a049')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#4CAF50')}
        >
          {isLoading ? 'Loading...' : 'Login with Auth0'}
        </button>
      </div>
    </div>
  );
}
