import { useState, useEffect } from 'react';

const CHECK_INTERVAL = 30 * 1000; // check every 30 seconds

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let initialHash = null;

    async function checkForUpdate() {
      try {
        const res = await fetch('/?_cb=' + Date.now(), { cache: 'no-store' });
        const html = await res.text();
        // Extract the main JS bundle hash from the HTML
        const match = html.match(/assets\/index-([a-zA-Z0-9_-]+)\.js/);
        const hash = match ? match[1] : null;
        if (!hash) return;

        if (initialHash === null) {
          initialHash = hash;
        } else if (hash !== initialHash) {
          setUpdateAvailable(true);
        }
      } catch {
        // ignore fetch errors
      }
    }

    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      background: '#1A2332',
      color: '#fff',
      padding: '0.75rem 1rem',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      zIndex: 9999,
      fontSize: '0.875rem',
      fontFamily: 'inherit',
      animation: 'slideUp 0.3s ease',
    }}>
      <span>New update available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#3B7DDD',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          padding: '0.4rem 0.75rem',
          fontSize: '0.8125rem',
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.5)',
          fontSize: '1.1rem',
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
      <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
