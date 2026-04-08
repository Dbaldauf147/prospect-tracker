import { useState } from 'react';
import styles from './LoginPage.module.css';

export function LoginPage({ onSignIn, onSignInWithEmail, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleEmailSignIn(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    await onSignInWithEmail(email.trim(), password);
    setSubmitting(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Prospect Tracker</h1>
        <p className={styles.subtitle}>Sign in to manage your sales pipeline</p>

        <form onSubmit={handleEmailSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit' }}
          />
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            style={{
              padding: '0.55rem 1rem', border: 'none', borderRadius: '6px',
              background: '#1A2332', color: '#fff', fontSize: '0.85rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer',
              opacity: (!email.trim() || !password) ? 0.5 : 1,
            }}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1, height: '1px', background: '#D1D5DB' }} />
          <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#D1D5DB' }} />
        </div>

        <button className={styles.googleBtn} onClick={onSignIn}>
          <span className={styles.googleIcon}>G</span>
          Sign in with Google
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
