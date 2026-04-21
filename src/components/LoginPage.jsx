import { useState } from 'react';
import styles from './LoginPage.module.css';

export function LoginPage({ onSignIn, onSignInWithEmail, onCreateAccount, onResetPassword, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);

  async function handleGoogleClick() {
    if (googleSigningIn) return;
    setGoogleSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setGoogleSigningIn(false);
    }
  }

  async function handleResetPassword() {
    setResetMessage(null);
    let target = email.trim();
    if (!target) {
      target = (window.prompt('Enter the email address to send a reset link to:') || '').trim();
      if (!target) return;
    }
    setResetting(true);
    try {
      await onResetPassword(target);
      setResetMessage({ type: 'success', text: `Reset link sent to ${target}. Check your inbox (and spam folder).` });
    } catch (err) {
      const msg = err?.code === 'auth/user-not-found'
        ? `No account found for ${target}.`
        : err?.code === 'auth/invalid-email'
        ? `"${target}" doesn't look like a valid email address.`
        : err?.message || 'Failed to send reset email.';
      setResetMessage({ type: 'error', text: msg });
    } finally {
      setResetting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    if (isCreateMode) {
      await onCreateAccount(email.trim(), password);
    } else {
      await onSignInWithEmail(email.trim(), password);
    }
    setSubmitting(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Prospect Tracker</h1>
        <p className={styles.subtitle}>{isCreateMode ? 'Create your account' : 'Sign in to manage your sales pipeline'}</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
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
              background: isCreateMode ? '#10B981' : '#1A2332', color: '#fff', fontSize: '0.85rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer',
              opacity: (!email.trim() || !password) ? 0.5 : 1,
            }}
          >
            {submitting ? (isCreateMode ? 'Creating...' : 'Signing in...') : (isCreateMode ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            onClick={() => setIsCreateMode(m => !m)}
            style={{ background: 'none', border: 'none', color: '#3B7DDD', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
          >
            {isCreateMode ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
          </button>
          {!isCreateMode && (
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={resetting}
              style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: '0.78rem', cursor: resetting ? 'wait' : 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
            >
              {resetting ? 'Sending…' : 'Forgot password?'}
            </button>
          )}
        </div>
        {resetMessage && (
          <p style={{
            fontSize: '0.78rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            background: resetMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: resetMessage.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${resetMessage.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
          }}>
            {resetMessage.text}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1, height: '1px', background: '#D1D5DB' }} />
          <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#D1D5DB' }} />
        </div>

        <button
          className={styles.googleBtn}
          onClick={handleGoogleClick}
          disabled={googleSigningIn || submitting}
          style={googleSigningIn || submitting ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          <span className={styles.googleIcon}>G</span>
          {googleSigningIn ? 'Opening Google…' : 'Sign in with Google'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
