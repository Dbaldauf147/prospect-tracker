import { useEffect, useRef, useState } from 'react';
import styles from './DailySuccess.module.css';
import {
  todayKey,
  isWeekday,
  getEntry,
  getAllEntries,
  upsertEntry,
  newBullet,
  pickPhase,
  completionStats,
} from './dailySuccessStore';

const TARGET_EMAIL = 'baldaufdan@gmail.com';

export function DailySuccessManager({ user }) {
  const [phase, setPhase] = useState(null); // 'morning' | 'mid' | 'end' | null
  const [entry, setEntry] = useState(null);
  const [morningText, setMorningText] = useState('');
  const tickerRef = useRef(null);

  const enabled = (user?.email || '').toLowerCase() === TARGET_EMAIL;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    async function check() {
      if (!isWeekday()) return;
      const dk = todayKey();
      const e = await getEntry(dk);
      if (cancelled) return;
      const p = pickPhase(e);
      if (p && phase !== p) {
        setEntry(e || { date: dk, bullets: [], shownMid: false, shownEnd: false });
        if (p === 'morning' && e?.bullets?.length) {
          setMorningText(e.bullets.map(b => b.text).join('\n'));
        }
        setPhase(p);
      }
    }
    check();
    tickerRef.current = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      if (tickerRef.current) window.clearInterval(tickerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !phase) return null;

  function close() {
    setPhase(null);
    setMorningText('');
  }

  async function submitMorning() {
    const lines = morningText
      .split('\n')
      .map(l => l.trim().replace(/^[-•*]\s*/, ''))
      .filter(Boolean);
    if (lines.length === 0) return;
    const dk = todayKey();
    const existing = await getEntry(dk);
    const prevById = new Map((existing?.bullets || []).map(b => [b.text.trim().toLowerCase(), b]));
    const bullets = lines.map(text => {
      const prev = prevById.get(text.toLowerCase());
      return prev ? { ...prev, text } : newBullet(text);
    });
    await upsertEntry(dk, {
      bullets,
      morningCreatedAt: existing?.morningCreatedAt || Date.now(),
      snoozeUntil: 0,
    });
    close();
  }

  async function snoozeMorning() {
    const dk = todayKey();
    await upsertEntry(dk, { snoozeUntil: Date.now() + 60 * 60 * 1000 });
    close();
  }

  async function skipForToday() {
    // Suppress until midnight local time so the modal doesn't keep
    // re-popping for the rest of the day.
    const eod = new Date();
    eod.setHours(23, 59, 59, 999);
    await upsertEntry(todayKey(), { snoozeUntil: eod.getTime() });
    close();
  }

  const [suggesting, setSuggesting] = useState(false);
  async function suggestWithClaude() {
    setSuggesting(true);
    try {
      const all = await getAllEntries();
      const recent = all
        .filter(e => e.date < todayKey())
        .slice(0, 7);
      const resp = await fetch('/api/daily-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recent,
          notes: morningText,
          userName: 'Dan',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !Array.isArray(data?.bullets)) {
        alert(data?.error || 'Could not get suggestions.');
        return;
      }
      const existingLines = morningText
        .split('\n')
        .map(l => l.trim().replace(/^[-•*]\s*/, ''))
        .filter(Boolean);
      const merged = [...existingLines];
      for (const b of data.bullets) {
        if (!merged.some(l => l.toLowerCase() === b.toLowerCase())) merged.push(b);
      }
      setMorningText(merged.join('\n'));
    } catch (err) {
      alert(err?.message || 'Suggestion request failed.');
    } finally {
      setSuggesting(false);
    }
  }

  async function toggleBullet(id, field) {
    const next = {
      ...entry,
      bullets: entry.bullets.map(b => (b.id === id ? { ...b, [field]: !b[field] } : b)),
    };
    setEntry(next);
    await upsertEntry(entry.date, { bullets: next.bullets });
  }

  async function addCheckinBullet(text) {
    const cleaned = (text || '').trim();
    if (!cleaned) return;
    const next = { ...entry, bullets: [...entry.bullets, newBullet(cleaned)] };
    setEntry(next);
    await upsertEntry(entry.date, { bullets: next.bullets });
  }

  async function submitCheckin() {
    const flag = phase === 'mid' ? 'shownMid' : 'shownEnd';
    await upsertEntry(entry.date, { [flag]: true, bullets: entry.bullets });
    close();
  }

  if (phase === 'morning') {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true">
        <div className={styles.modal}>
          <div className={styles.head}>
            <div className={styles.title}>What does success look like today?</div>
            <div className={styles.sub}>One bullet per line. We'll check in at 1 PM and 5 PM.</div>
          </div>
          <div className={styles.body}>
            <textarea
              autoFocus
              className={styles.morningArea}
              value={morningText}
              onChange={(e) => setMorningText(e.target.value)}
              placeholder={'• Land 3 outreach replies\n• Finish Option 2 pricing\n• Prep client deck'}
            />
            <p className={styles.smallNote}>Lines starting with -, •, or * are auto-cleaned.</p>
          </div>
          <div className={styles.foot}>
            <button
              type="button"
              className={styles.btn}
              onClick={suggestWithClaude}
              disabled={suggesting}
              title="Use Claude to suggest 3-5 focus bullets based on your recent log entries and any notes you've typed above."
            >{suggesting ? 'Asking Claude…' : '✨ Suggest with Claude'}</button>
            <div style={{ flex: 1 }} />
            <button type="button" className={styles.btnGhost} onClick={snoozeMorning}>Snooze 1h</button>
            <button type="button" className={styles.btnGhost} onClick={skipForToday}>Skip today</button>
            <button type="button" className={styles.btnPrimary} onClick={submitMorning}>Save</button>
          </div>
        </div>
      </div>
    );
  }

  // 1 PM / 5 PM check-in
  const checkField = phase === 'mid' ? 'doneMid' : 'doneEnd';
  const stats = completionStats(entry);
  const doneNow = phase === 'mid' ? stats.doneMid : stats.doneEnd;
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.head}>
          <div className={styles.title}>{phase === 'mid' ? '1 PM check-in' : '5 PM check-in'}</div>
          <div className={styles.sub}>{doneNow} of {stats.total} checked off so far.</div>
        </div>
        <div className={styles.body}>
          {(entry?.bullets || []).map(b => (
            <div key={b.id} className={styles.bullet}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={!!b[checkField]}
                onChange={() => toggleBullet(b.id, checkField)}
              />
              <span className={b[checkField] ? styles.bulletTextDone : styles.bulletText}>{b.text}</span>
            </div>
          ))}
          <AddBulletRow onAdd={addCheckinBullet} />
        </div>
        <div className={styles.foot}>
          <button type="button" className={styles.btnPrimary} onClick={submitCheckin}>Done</button>
        </div>
      </div>
    </div>
  );
}

function AddBulletRow({ onAdd }) {
  const [v, setV] = useState('');
  return (
    <div className={styles.addRow}>
      <input
        className={styles.addInput}
        placeholder="Add a bullet…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onAdd(v); setV(''); }
        }}
      />
      <button type="button" className={styles.btn} onClick={() => { onAdd(v); setV(''); }}>Add</button>
    </div>
  );
}
