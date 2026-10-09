import { useEffect, useState } from 'react';
import { watchEarlierTabs } from '../utils/tabPresence';
import { getRosterLoadMode, ROSTER_LOAD_MODE_EVENT } from '../utils/firestoreSync';

// Shown in a tab opened while the app was already open in another one, when
// that tab had to read every company from the database (no usable copy of
// the roster on this device, or its weekly refresh). Most loads now read
// only what changed (utils/rosterSync.js), and a second tab doing that
// costs next to nothing, so there is nothing to warn about then. Nothing
// here blocks the tab.
export function OtherTabBanner() {
  const [others, setOthers] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [loadMode, setLoadMode] = useState(getRosterLoadMode);

  useEffect(() => {
    const onMode = (e) => setLoadMode(e.detail);
    window.addEventListener(ROSTER_LOAD_MODE_EVENT, onMode);
    return () => window.removeEventListener(ROSTER_LOAD_MODE_EVENT, onMode);
  }, []);

  useEffect(() => {
    const stop = watchEarlierTabs(setOthers);
    // A tab being closed never unmounts its components, so say goodbye on
    // pagehide too, or the other tab would keep warning about a ghost.
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, []);

  if (others === 0 || dismissed || loadMode !== 'full') return null;

  return (
    <div role="status" style={{
      position: 'fixed',
      bottom: '1.5rem',
      left: '1.5rem',
      maxWidth: 'min(460px, calc(100vw - 3rem))',
      background: '#FFFBEB',
      color: '#78350F',
      border: '1px solid #F59E0B',
      padding: '0.6rem 0.7rem 0.6rem 0.9rem',
      borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.6rem',
      zIndex: 9999,
      fontSize: '0.8rem',
      lineHeight: 1.4,
      fontFamily: 'inherit',
    }}>
      <span>
        <strong>Prospect Tracker is already open in another tab.</strong>{' '}
        This tab had to load every company from the database again, which counts
        against the daily read limit. Switch to the other tab and close this one.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: '#92400E',
          fontSize: '1.1rem',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
    </div>
  );
}
