import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './Sidebar.module.css';
import {
  KEEP_AWAKE_PRESETS, parseDurationMinutes, endFor, isRunning, formatRemaining,
  readSession, writeSession,
} from '../utils/keepAwake';

// "Keep awake": holds a Screen Wake Lock so the display stays on and the
// laptop doesn't idle into sleep, for as long as the timer the user picks.
//
// What the browser allows, and so what this can promise:
// - The lock only holds while this tab is visible. Switching to another tab,
//   minimising the window, or (on Windows) covering it completely with other
//   windows releases it; coming back re-takes it, which is what the
//   visibilitychange handler below is for.
// - It stops idle sleep, not a sleep the user asks for: closing the lid or
//   choosing Sleep still sleeps the machine. Battery saver can refuse it.
// - Browsers without the API (older Safari, Firefox before 126) get a note
//   saying so instead of a button that silently does nothing.
//
// The first version showed a green "Keeping awake" pill whenever a timer was
// running, whether or not the browser was actually holding the lock - so a
// laptop could go to sleep under a pill that said it wouldn't. Everything
// shown now comes off `lockState`, which only reads 'held' while a lock the
// browser granted is still in hand, and the popup keeps a log of every time
// the lock was lost and why.
const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const storage = typeof window !== 'undefined' ? window.localStorage : null;

// While the lock is refused (battery saver, a transient error), ask again
// this often, as long as the tab is visible and the timer is running.
const RETRY_MS = 30_000;

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function KeepAwake() {
  const [session, setSession] = useState(() => readSession(storage));
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState('');
  // '' | 'held' | 'paused' (tab hidden) | 'error' (refused)
  const [lockState, setLockState] = useState('');
  const lockStateRef = useRef('');
  useEffect(() => { lockStateRef.current = lockState; }, [lockState]);
  // The popup in the middle of the screen. Opens whenever a timer starts or
  // is picked back up, and again when the lock is taken back after a pause,
  // so the user sees what happened; "Minimize" tucks it into the sidebar.
  const [popupOpen, setPopupOpen] = useState(() => !!readSession(storage));
  // The times the lock was lost this session, newest last: { at, reason }.
  const [drops, setDrops] = useState([]);
  const lockRef = useRef(null);
  // Set while a request is in flight, so two callers can't each take a lock.
  const pendingRef = useRef(false);
  const wrapRef = useRef(null);

  const running = isRunning(session, now);
  // The same fact for callbacks that outlive a render (an in-flight lock
  // request, the visibility handler), kept in step by the effect below.
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);

  const noteDrop = useCallback((reason) => {
    setDrops(d => [...d.slice(-4), { at: Date.now(), reason }]);
  }, []);

  const release = useCallback(async () => {
    const lock = lockRef.current;
    lockRef.current = null;
    if (lock && !lock.released) {
      try { await lock.release(); } catch { /* already gone */ }
    }
  }, []);

  const acquire = useCallback(async () => {
    if (!supported) { setLockState('error'); return; }
    if (document.visibilityState !== 'visible') { setLockState('paused'); return; }
    if ((lockRef.current && !lockRef.current.released) || pendingRef.current) return;
    pendingRef.current = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      pendingRef.current = false;
      // Stopped while the request was in flight: hand it straight back.
      if (!runningRef.current) {
        lock.release().catch(() => {});
        return;
      }
      lockRef.current = lock;
      setLockState('held');
      lock.addEventListener('release', () => {
        // Let go by stop() or unmount: nothing to report.
        if (lockRef.current !== lock) return;
        lockRef.current = null;
        // Released by the browser rather than by us.
        const hidden = document.visibilityState !== 'visible';
        setLockState(hidden ? 'paused' : 'error');
        noteDrop(hidden
          ? 'this tab was hidden (another tab, or the window minimized or covered)'
          : 'the browser let go of it (battery saver, or the system asked)');
      });
    } catch {
      pendingRef.current = false;
      setLockState('error');
    }
  }, [noteDrop]);

  function stop() {
    setSession(null);
    writeSession(storage, null);
    release();
    setLockState('');
    setPopupOpen(false);
    setDrops([]);
  }

  function start(minutes) {
    const next = { until: endFor(minutes) };
    setSession(next);
    writeSession(storage, next);
    setNow(Date.now());
    setMenuOpen(false);
    setCustom('');
    setCustomError('');
    setDrops([]);
    setPopupOpen(true);
  }

  // Take the lock whenever a session is running, including one picked back
  // up from storage after a reload, and let it go when it isn't.
  useEffect(() => {
    if (running) acquire();
    else if (session) stop();
    else release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // The countdown, and the end of the session when it runs out.
  useEffect(() => {
    if (!session) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // The browser drops the lock when the tab is hidden; take it back when the
  // tab is shown again, and open the popup so the pause is visible.
  useEffect(() => {
    const onVisible = () => {
      if (!runningRef.current) return;
      if (document.visibilityState === 'visible') {
        // Back from a pause: show the popup so the gap is visible. A plain
        // click back into the window while the lock held opens nothing.
        if (lockStateRef.current !== 'held') setPopupOpen(true);
        acquire();
      } else {
        setLockState('paused');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [acquire]);

  // A refused lock is asked for again every so often: battery saver ends,
  // a transient failure clears.
  useEffect(() => {
    if (!running || lockState !== 'error' || !supported) return undefined;
    const id = window.setInterval(() => acquire(), RETRY_MS);
    return () => window.clearInterval(id);
  }, [running, lockState, acquire]);

  // Let the lock go if the sidebar unmounts (sign-out).
  useEffect(() => () => { release(); }, [release]);

  // Close the menu on an outside click; Escape closes the menu or tucks the
  // popup away.
  useEffect(() => {
    if (!menuOpen && !popupOpen) return undefined;
    const onDown = (e) => { if (menuOpen && !wrapRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setPopupOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, popupOpen]);

  function submitCustom(e) {
    e.preventDefault();
    const minutes = parseDurationMinutes(custom);
    if (minutes == null) {
      setCustomError('Enter minutes (90) or hours (1.5h), up to 24 hours.');
      return;
    }
    start(minutes);
  }

  const timeText = !running ? ''
    : session.until == null ? 'Until you stop it'
      : `${formatRemaining(session.until - now)} left`;
  // What the lock is actually doing, in the words each surface uses.
  const tone = lockState === 'held' ? 'on' : lockState === 'paused' ? 'paused' : lockState === 'error' ? 'off' : 'pending';
  const headline = {
    on: 'Screen will stay on',
    paused: 'Paused: this tab is hidden',
    off: 'Not holding: the browser refused',
    pending: 'Starting...',
  }[tone];
  const detail = {
    on: 'The screen stays on and the laptop won\'t sleep while this tab stays open and on screen.',
    paused: 'The browser lets go while this tab is in the background. Come back to this tab and it picks up again.',
    off: `Battery saver or a system setting is blocking it. Plugging in or turning battery saver off usually fixes it. Trying again every ${RETRY_MS / 1000} seconds.`,
    pending: 'Asking the browser to keep the screen on.',
  }[tone];
  const pillLabel = { on: 'Keeping awake', paused: 'Awake: paused', off: 'Awake: not holding', pending: 'Keeping awake' }[tone];

  const popup = running && popupOpen && typeof document !== 'undefined' ? createPortal(
    <div className={styles.keepAwakeOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setPopupOpen(false); }}>
      <div className={styles.keepAwakeModal} role="dialog" aria-modal="true" aria-labelledby="keep-awake-title">
        <div className={styles.keepAwakeModalHead}>
          <span className={styles[`keepAwakeDot_${tone}`]} aria-hidden="true" />
          <span id="keep-awake-title" className={styles.keepAwakeModalTitle}>{headline}</span>
        </div>
        <div className={styles.keepAwakeModalTime}>{timeText}</div>
        {session?.until != null ? (
          <div className={styles.keepAwakeModalUntil}>Until {clock(session.until)}</div>
        ) : null}
        <p className={styles.keepAwakeModalDetail}>{detail}</p>
        {drops.length ? (
          <div className={styles.keepAwakeModalLog}>
            <div className={styles.keepAwakeModalLogTitle}>Times the screen was allowed to sleep</div>
            <ul>
              {drops.map((d, i) => <li key={i}>{clock(d.at)}: {d.reason}</li>)}
            </ul>
          </div>
        ) : null}
        <div className={styles.keepAwakeModalActions}>
          <button type="button" className={styles.keepAwakeModalMin} onClick={() => setPopupOpen(false)}>Minimize</button>
          <button type="button" className={styles.keepAwakeModalStop} onClick={stop}>Stop</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={styles.keepAwakeWrap} ref={wrapRef}>
      {running ? (
        <div className={styles[`keepAwakePill_${tone}`]}>
          <button
            type="button"
            className={styles.keepAwakeOpen}
            onClick={() => setPopupOpen(true)}
            title="Show the Keep awake window"
          >
            <span className={styles[`keepAwakeDot_${tone}`]} aria-hidden="true" />
            <span className={styles.keepAwakeText}>
              <span className={styles.keepAwakeLabel}>{pillLabel}</span>
              <span className={styles.keepAwakeTime}>{timeText}</span>
            </span>
          </button>
          <button type="button" className={styles.keepAwakeStop} onClick={stop}>Stop</button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.keepAwakeBtn}
          onClick={() => setMenuOpen(o => !o)}
          aria-expanded={menuOpen}
          title="Keep the screen on and stop the laptop from sleeping for a set time"
        >
          <span className={styles.navIcon}>☕</span>
          Keep awake
          <span className={styles.settingsCaret}>{menuOpen ? '▾' : '▸'}</span>
        </button>
      )}

      {menuOpen && !running && (
        <div className={styles.keepAwakeMenu} role="menu">
          {!supported ? (
            <div className={styles.keepAwakeNote}>
              This browser can't keep the screen on. Use Chrome, Edge, or a current Firefox or Safari.
            </div>
          ) : (
            <>
              <div className={styles.keepAwakeMenuTitle}>Keep the screen on for</div>
              {KEEP_AWAKE_PRESETS.map(p => (
                <button
                  key={p.minutes}
                  type="button"
                  role="menuitem"
                  className={styles.settingsItem}
                  onClick={() => start(p.minutes)}
                >
                  {p.label}
                </button>
              ))}
              <form className={styles.keepAwakeCustom} onSubmit={submitCustom}>
                <input
                  type="text"
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value); setCustomError(''); }}
                  placeholder="Custom: 90m, 1.5h"
                  aria-label="Custom duration"
                  className={styles.keepAwakeInput}
                />
                <button type="submit" className={styles.keepAwakeGo}>Start</button>
              </form>
              {customError ? <div className={styles.keepAwakeError}>{customError}</div> : null}
              <div className={styles.keepAwakeHint}>
                Works while this tab stays open and on screen. Closing the lid still sleeps the laptop.
              </div>
            </>
          )}
        </div>
      )}
      {popup}
    </div>
  );
}
