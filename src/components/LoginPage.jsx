import { useState } from 'react';
import styles from './LoginPage.module.css';

export function LoginPage({ onSignInWithEmail, onCreateAccount, onResetPassword, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cdmName, setCdmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

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
    if (isCreateMode && !cdmName.trim()) return;
    setSubmitting(true);
    if (isCreateMode) {
      await onCreateAccount(email.trim(), password, cdmName.trim());
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
          {isCreateMode && (
            <>
              <input
                type="text"
                placeholder="Your CDM name (e.g. Jane Smith)"
                value={cdmName}
                onChange={e => setCdmName(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit' }}
              />
              <p style={{ fontSize: '0.7rem', color: '#6B7280', margin: '-0.15rem 0 0.1rem 0.1rem' }}>
                The name your prospects&apos; CDM field will be matched against. You can change this later in Settings.
              </p>
            </>
          )}
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 3.2rem 0.5rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                top: '50%',
                right: '8px',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#6B7280',
                fontSize: '0.72rem',
                cursor: 'pointer',
                padding: '2px 6px',
                fontFamily: 'inherit',
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password || (isCreateMode && !cdmName.trim())}
            style={{
              padding: '0.55rem 1rem', border: 'none', borderRadius: '6px',
              background: isCreateMode ? '#10B981' : '#1A2332', color: '#fff', fontSize: '0.85rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer',
              opacity: (!email.trim() || !password || (isCreateMode && !cdmName.trim())) ? 0.5 : 1,
            }}
          >
            {submitting ? (isCreateMode ? 'Creating...' : 'Signing in...') : (isCreateMode ? 'Create Account' : 'Sign In')}
          </button>
          {error && <p className={styles.error}>{error}</p>}
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

      </div>
    </div>
  );
}
