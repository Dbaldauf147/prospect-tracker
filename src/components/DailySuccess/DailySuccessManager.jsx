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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState([]); // string[] from Claude, awaiting keep/drop
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

  // Allow the Daily Success Log modal (or anything else) to force the
  // morning prompt open by dispatching `daily-success:open-morning`.
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = async () => {
      const dk = todayKey();
      const e = await getEntry(dk);
      if (e?.bullets?.length) setMorningText(e.bullets.map(b => b.text).join('\n'));
      setEntry(e || { date: dk, bullets: [], shownMid: false, shownEnd: false });
      setPhase('morning');
    };
    window.addEventListener('daily-success:open-morning', handler);
    return () => window.removeEventListener('daily-success:open-morning', handler);
  }, [enabled]);

  if (!enabled || !phase) return null;

  function close() {
    setPhase(null);
    setMorningText('');
    setSuggestions([]);
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
      // Drop suggestions that are already in the textarea so we don't
      // repeat what the user just typed.
      const existing = morningText
        .split('\n')
        .map(l => l.trim().replace(/^[-•*]\s*/, '').toLowerCase())
        .filter(Boolean);
      const fresh = data.bullets.filter(b => !existing.includes(b.toLowerCase()));
      setSuggestions(fresh);
    } catch (err) {
      alert(err?.message || 'Suggestion request failed.');
    } finally {
      setSuggesting(false);
    }
  }

  function keepSuggestion(idx) {
    const text = suggestions[idx];
    if (!text) return;
    setMorningText(prev => {
      const lines = prev.split('\n').map(l => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
      if (lines.some(l => l.toLowerCase() === text.toLowerCase())) return prev;
      const next = prev.endsWith('\n') || prev === '' ? `${prev}${text}` : `${prev}\n${text}`;
      return next;
    });
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  }

  function dropSuggestion(idx) {
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  }

  function keepAllSuggestions() {
    setMorningText(prev => {
      const lines = prev.split('\n').map(l => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
      const lower = new Set(lines.map(l => l.toLowerCase()));
      const additions = suggestions.filter(s => !lower.has(s.toLowerCase()));
      if (additions.length === 0) return prev;
      const sep = prev === '' || prev.endsWith('\n') ? '' : '\n';
      return `${prev}${sep}${additions.join('\n')}`;
    });
    setSuggestions([]);
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
            {suggestions.length > 0 && (
              <div className={styles.suggestionBox}>
                <div className={styles.suggestionHead}>
                  <strong>Claude's suggestions</strong>
                  <button type="button" className={styles.btnGhost} onClick={keepAllSuggestions}>Keep all</button>
                  <button type="button" className={styles.btnGhost} onClick={() => setSuggestions([])}>Drop all</button>
                </div>
                <ul className={styles.suggestionList}>
                  {suggestions.map((s, i) => (
                    <li key={i} className={styles.suggestionItem}>
                      <span className={styles.suggestionText}>{s}</span>
                      <button
                        type="button"
                        className={styles.suggestionKeep}
                        onClick={() => keepSuggestion(i)}
                        title="Add this bullet to your plan"
                      >Keep</button>
                      <button
                        type="button"
                        className={styles.suggestionDrop}
                        onClick={() => dropSuggestion(i)}
                        title="Discard this suggestion"
                      >×</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
