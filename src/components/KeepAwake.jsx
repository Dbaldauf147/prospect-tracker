import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './Sidebar.module.css';
import {
  KEEP_AWAKE_PRESETS, parseDurationMinutes, endFor, isRunning, formatRemaining,
  readSession, writeSession,
} from '../utils/keepAwake';

// "Keep awake": holds a Screen Wake Lock so the display stays on and the
// laptop doesn't idle into sleep, for as long as the timer the user picks.
//
// What the browser allows, and so what this can promise:
// - The lock only holds while this tab is visible. Switching to another tab
//   or minimising the window releases it; coming back re-takes it, which is
//   what the visibilitychange handler below is for.
// - It stops idle sleep, not a sleep the user asks for: closing the lid or
//   choosing Sleep still sleeps the machine.
// - Browsers without the API (older Safari, Firefox before 126) get a note
//   saying so instead of a button that silently does nothing.
const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const storage = typeof window !== 'undefined' ? window.localStorage : null;

export function KeepAwake() {
  const [session, setSession] = useState(() => readSession(storage));
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState('');
  // 'held' | 'paused' (tab hidden) | 'error'
  const [lockState, setLockState] = useState('');
  const lockRef = useRef(null);
  // Set while a request is in flight, so two callers can't each take a lock.
  const pendingRef = useRef(false);
  const wrapRef = useRef(null);

  const running = isRunning(session, now);
  // The same fact for callbacks that outlive a render (an in-flight lock
  // request, the visibility handler), kept in step by the effect below.
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);

  const release = useCallback(async () => {
    const lock = lockRef.current;
    lockRef.current = null;
    if (lock && !lock.released) {
      try { await lock.release(); } catch { /* already gone */ }
    }
  }, []);

  const acquire = useCallback(async () => {
    if (!supported || document.visibilityState !== 'visible') {
      setLockState(supported ? 'paused' : 'error');
      return;
    }
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
        // Released by the browser (tab hidden, battery saver) rather than by
        // us: say it's paused, and the visibility handler takes it back.
        setLockState(document.visibilityState === 'visible' ? 'error' : 'paused');
      });
    } catch {
      pendingRef.current = false;
      setLockState('error');
    }
  }, []);

  function stop() {
    setSession(null);
    writeSession(storage, null);
    release();
    setLockState('');
  }

  function start(minutes) {
    const next = { until: endFor(minutes) };
    setSession(next);
    writeSession(storage, next);
    setNow(Date.now());
    setMenuOpen(false);
    setCustom('');
    setCustomError('');
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
  // tab is shown again, as long as the timer is still running.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && runningRef.current) acquire();
      else if (document.visibilityState !== 'visible' && session) setLockState('paused');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session, acquire]);

  // Let the lock go if the sidebar unmounts (sign-out).
  useEffect(() => () => { release(); }, [release]);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function submitCustom(e) {
    e.preventDefault();
    const minutes = parseDurationMinutes(custom);
    if (minutes == null) {
      setCustomError('Enter minutes (90) or hours (1.5h), up to 24 hours.');
      return;
    }
    start(minutes);
  }

  const status = !running ? ''
    : session.until == null ? 'On until you stop it'
      : `${formatRemaining(session.until - now)} left`;
  const note = lockState === 'paused'
    ? 'Paused while this tab is hidden. Come back to this tab to resume.'
    : lockState === 'error'
      ? 'The browser refused to keep the screen on (battery saver may be on).'
      : '';

  return (
    <div className={styles.keepAwakeWrap} ref={wrapRef}>
      {running ? (
        <div className={styles.keepAwakeActive} title="The screen will stay on and the laptop won't go to sleep while this tab is open and visible.">
          <span className={styles.keepAwakeDot} aria-hidden="true" />
          <span className={styles.keepAwakeText}>
            <span className={styles.keepAwakeLabel}>Keeping awake</span>
            <span className={styles.keepAwakeTime}>{status}</span>
          </span>
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
      {running && note ? <div className={styles.keepAwakeNote}>{note}</div> : null}

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
                Works while this tab stays open and visible. Closing the lid still sleeps the laptop.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
