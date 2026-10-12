import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

// The red bar across the top of the site when the cloud backups are broken:
// billing off on the backup project, storage failing, or the nightly backup
// not having run (api/backup-health.js says which). Billing went off once
// and nobody knew until a restore needed a backup, which is why this
// exists; it links straight to the page that fixes it.
//
// Checked on load and every few hours while the site is open. A healthy
// answer is remembered for a short while so reloads don't re-ask; a broken
// one never is, so the bar goes away the moment it is fixed. Dismissing
// hides it until the next load, not for good.

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const HEALTHY_CACHE_MS = 30 * 60 * 1000;
const CACHE_KEY = 'backup-health-ok-at';

function recentlyHealthy() {
  try {
    const at = Number(localStorage.getItem(CACHE_KEY) || 0);
    return at > 0 && Date.now() - at < HEALTHY_CACHE_MS;
  } catch { return false; }
}
function rememberHealthy(ok) {
  try {
    if (ok) localStorage.setItem(CACHE_KEY, String(Date.now()));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage blocked: just check again next time */ }
}

export function BackupHealthBanner({ user }) {
  const [health, setHealth] = useState(null); // the endpoint's answer when broken
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async ({ force = false } = {}) => {
    if (!force && recentlyHealthy()) { setHealth(null); return; }
    setChecking(true);
    try {
      const r = await apiFetch('/api/backup-health');
      if (!r.ok) return; // signed out, or the check itself is down: not a backup problem
      const out = await r.json();
      rememberHealthy(!!out?.ok);
      setHealth(out?.ok ? null : out);
      if (!out?.ok) setDismissed(false);
    } catch {
      /* offline: say nothing rather than warn on a guess */
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    check();
    const t = setInterval(() => check(), CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [user, check]);

  if (!user || !health || dismissed) return null;

  const isBilling = health.problem === 'billing';
  const fixHref = isBilling ? health.links?.billing : health.links?.storage;
  const linkStyle = { color: '#fff', fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' };
  const btnStyle = {
    background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.5)',
    borderRadius: 4, padding: '0.15rem 0.55rem', fontSize: '0.75rem', fontWeight: 600,
    cursor: checking ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };

  return (
    <div role="alert" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#B91C1C', color: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
      flexWrap: 'wrap', fontSize: '0.82rem', lineHeight: 1.4, fontFamily: 'inherit',
    }}>
      <span style={{ flex: '1 1 320px', minWidth: 0 }}>
        <strong>Cloud backups are not working. Fix this right away.</strong>{' '}
        {health.detail}
        {isBilling && ' Turn billing back on for the backup project (Tracker) in Google Cloud.'}
      </span>
      {fixHref && (
        <a href={fixHref} target="_blank" rel="noreferrer" style={linkStyle}>
          {isBilling ? 'Open Google Cloud billing' : 'Open backup storage'}
        </a>
      )}
      <button type="button" onClick={() => check({ force: true })} disabled={checking} style={btnStyle}>
        {checking ? 'Checking...' : 'Check again'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide until the next reload"
        title="Hide until the next reload"
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.15rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
      >&times;</button>
    </div>
  );
}
