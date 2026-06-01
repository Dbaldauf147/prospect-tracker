import { useState, useEffect } from 'react';

const CHECK_INTERVAL = 30 * 1000; // poll the deployed index every 30 seconds
const BUNDLE_RE = /assets\/index-([a-zA-Z0-9_-]+)\.js/;

// Hash of the entry bundle this page actually loaded, read from its own
// <script> tag. Comparing the live deploy against *this* (rather than
// against the first poll's result) means a tab that loaded a stale build
// still gets nudged — even if it was opened several deploys ago.
function runningBundleHash() {
  try {
    for (const t of document.querySelectorAll('script[src]')) {
      const m = (t.getAttribute('src') || '').match(BUNDLE_RE);
      if (m) return m[1];
    }
  } catch {
    // no-op — fall back to first-poll baseline below
  }
  return null;
}

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // Seed the baseline from the running bundle; fall back to the first
    // successful poll if we can't read it (e.g. dev, where there's no hash).
    let baselineHash = runningBundleHash();
    let stopped = false;

    async function checkForUpdate() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch('/?_cb=' + Date.now(), { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(BUNDLE_RE);
        const hash = match ? match[1] : null;
        if (!hash) return;
        if (baselineHash === null) {
          baselineHash = hash;
        } else if (hash !== baselineHash) {
          setUpdateAvailable(true);
        }
      } catch {
        // ignore fetch errors (offline, transient network)
      }
    }

    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    // Re-check the moment the tab regains focus so a deploy that landed
    // while it was backgrounded is caught immediately instead of after
    // the next 30s tick.
    const onVisible = () => { if (!document.hidden) checkForUpdate(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      background: '#1A2332',
      color: '#fff',
      padding: '0.45rem 0.55rem 0.45rem 0.9rem',
      borderRadius: '999px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      zIndex: 9999,
      fontSize: '0.85rem',
      fontWeight: 600,
      fontFamily: 'inherit',
      animation: 'updatePillIn 0.3s ease',
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: '#34D399',
        flex: '0 0 auto',
        animation: 'updatePillPulse 1.6s ease-in-out infinite',
      }} />
      <span>New version available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#3B7DDD',
          color: '#fff',
          border: 'none',
          borderRadius: '999px',
          padding: '0.35rem 0.85rem',
          fontSize: '0.8rem',
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.55)',
          fontSize: '1.1rem',
          cursor: 'pointer',
          padding: '0 6px 0 0',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
      <style>{`
        @keyframes updatePillIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes updatePillPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
}
