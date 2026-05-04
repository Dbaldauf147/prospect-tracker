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
import { dbGet } from '../../utils/db';
import { CoachingRulesPanel } from './CoachingRulesPanel';
import { subscribeToCoachingRules, DEFAULT_COACHING_RULES } from './coachingRulesStore';

const STAGE_LABEL = {
  6: /^\s*6\s*-\s*negotiate\s*to\s*win\b/i,
  5: /^\s*5\s*-\s*prepare\s*&?\s*bid\b/i,
  4: /^\s*4\s*-\s*influence\s*and\s*develop\b/i,
  3: /^\s*3\s*-\s*qualify\s*opportunity\b/i,
};

function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function matchStage(stageVal) {
  const s = String(stageVal ?? '');
  for (const n of [3, 4, 5, 6]) if (STAGE_LABEL[n].test(s)) return n;
  const m = s.match(/^\s*([3-6])\b/);
  return m ? Number(m[1]) : null;
}

const fmt$ = (n) => typeof n === 'number'
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '';

// Pull current pipeline + BFO state out of IndexedDB and produce a
// compact text summary suitable for handing to Claude. Returns ''
// when no pipeline data exists.
async function buildPipelineSummary() {
  try {
    const pipeline = await dbGet('pipeline-dashboard', 'current');
    const bfo = await dbGet('bfo-activity', 'current');
    if (!pipeline && !bfo) return '';

    const lines = [];
    // Goals + quota.
    if (pipeline) {
      if (pipeline.target || pipeline.closedYTD !== undefined) {
        const pct = pipeline.target ? (pipeline.closedYTD / pipeline.target * 100) : 0;
        lines.push(`Quota: ${fmt$(pipeline.closedYTD)} closed YTD vs ${fmt$(pipeline.target)} target (${pct.toFixed(1)}% of quota).`);
      }
      if (pipeline.newOppsGoal !== undefined) {
        lines.push(`New opps: ${pipeline.newOppsThisMonth ?? 0} this month vs goal of ${pipeline.newOppsGoal} (last month: ${pipeline.newOppsLastMonth ?? 0}).`);
      }
      if (pipeline.activitiesGoal !== undefined) {
        lines.push(`Activities: ${pipeline.activitiesThisWeek ?? 0} this week vs goal of ${pipeline.activitiesGoal} (last week: ${pipeline.activitiesLastWeek ?? 0}).`);
      }
    }

    // Per-stage live aggregates from BFO.
    if (bfo && bfo.headers && bfo.rows && bfo.rows.length > 0) {
      const stageCol = bfo.headers.find(h => /sales\s*stage|^stage$/i.test(h));
      const amtCol = bfo.headers.find(h => /^amount$/i.test(h));
      const ageCol = bfo.headers.find(h => /^age$/i.test(h));
      const acctCol = bfo.headers.find(h => /^account/i.test(h));
      const oppCol = bfo.headers.find(h => /opportunity\s*name/i.test(h));
      const nextStepCol = bfo.headers.find(h => /next\s*step/i.test(h));
      if (stageCol) {
        const buckets = {};
        for (const r of bfo.rows) {
          const n = matchStage(r[stageCol]);
          if (!n || n < 3 || n > 6) continue;
          const amt = amtCol ? parseMoney(r[amtCol]) : null;
          const age = ageCol ? Number(String(r[ageCol]).replace(/[^0-9.\-]/g, '')) : null;
          if (!buckets[n]) buckets[n] = { count: 0, total: 0, ageSum: 0, ageCount: 0 };
          buckets[n].count += 1;
          if (typeof amt === 'number') buckets[n].total += amt;
          if (Number.isFinite(age)) { buckets[n].ageSum += age; buckets[n].ageCount += 1; }
        }
        for (const n of [6, 5, 4, 3]) {
          const b = buckets[n];
          if (!b) continue;
          const avgAge = b.ageCount ? Math.round(b.ageSum / b.ageCount) : null;
          lines.push(`Stage ${n}: ${b.count} opps · ${fmt$(b.total)} pipeline${avgAge !== null ? ` · avg age ${avgAge} days` : ''}.`);
        }
      }

      // Top 5 oldest opps overall — likely candidates for follow-up.
      if (acctCol && ageCol) {
        const oldest = bfo.rows
          .map(r => ({
            account: r[acctCol],
            opp: oppCol ? r[oppCol] : '',
            stage: r[stageCol] || '',
            age: Number(String(r[ageCol]).replace(/[^0-9.\-]/g, '')),
            amount: amtCol ? parseMoney(r[amtCol]) : null,
            nextStep: nextStepCol ? r[nextStepCol] : '',
          }))
          .filter(o => Number.isFinite(o.age) && matchStage(o.stage) >= 3)
          .sort((a, b) => b.age - a.age)
          .slice(0, 5);
        if (oldest.length) {
          lines.push('Oldest active opportunities (potential follow-up targets):');
          for (const o of oldest) {
            const next = o.nextStep ? ` · next: "${String(o.nextStep).slice(0, 60)}"` : '';
            lines.push(`  • ${o.account} — ${o.stage} — ${o.age}d${typeof o.amount === 'number' ? ` · ${fmt$(o.amount)}` : ''}${next}`);
          }
        }

        // Stage 5/6 opps with no Next Step set — at risk.
        if (nextStepCol) {
          const stuck = bfo.rows
            .filter(r => {
              const s = matchStage(r[stageCol]);
              return (s === 5 || s === 6) && !String(r[nextStepCol] || '').trim();
            })
            .slice(0, 5);
          if (stuck.length) {
            lines.push(`Late-stage opps with no Next Step (action needed):`);
            for (const r of stuck) {
              lines.push(`  • ${r[acctCol]} — ${r[stageCol]}${amtCol ? ` · ${fmt$(parseMoney(r[amtCol]))}` : ''}`);
            }
          }
        }
      }
    } else {
      lines.push('No BFO Activity data loaded — pipeline metrics are placeholder targets only.');
    }

    // Opps tab — granular per-deal data with Stage / Scope / Quoted
    // Amount / Last Client Heard / Follow Up / Notes.
    const opps = await dbGet('opps-cache', 'data');
    if (opps && Array.isArray(opps.records) && opps.records.length > 0) {
      const ACTIVE_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal']);
      const QUOTING_STAGES = new Set(['Quoting', 'Quoted', 'Verbal']);
      const records = opps.records;
      const active = records.filter(r => ACTIVE_STAGES.has((r.Stage || '').trim()));
      const closed = records.filter(r => ['Sold', 'Not Sold'].includes((r.Stage || '').trim()));
      const wins = closed.filter(r => (r.Stage || '').trim() === 'Sold');
      const losses = closed.filter(r => (r.Stage || '').trim() === 'Not Sold');
      const totalQuoted = active.reduce((s, r) => s + (parseMoney(r['Quoted Amount']) || 0), 0);
      lines.push('');
      lines.push(`Opps tab: ${active.length} active opps · ${fmt$(totalQuoted)} total quoted · ${wins.length} wins / ${losses.length} losses recorded.`);

      // Top 5 stuck quotes (Quoting/Quoted/Verbal, sorted by oldest
      // "Last Client Heard From Us" or no contact recorded).
      const parseDate = (v) => {
        if (!v) return null;
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : t;
      };
      const today = Date.now();
      const stuck = active
        .filter(r => QUOTING_STAGES.has((r.Stage || '').trim()))
        .map(r => ({
          account: r.Account,
          scope: r.Scope || '',
          stage: r.Stage,
          amount: parseMoney(r['Quoted Amount']),
          lastHeard: parseDate(r['Last Client Heard From Us']),
          followUp: parseDate(r['Follow Up']),
          notes: r.Notes,
        }))
        .sort((a, b) => {
          const aL = a.lastHeard ?? 0;
          const bL = b.lastHeard ?? 0;
          return aL - bL;
        })
        .slice(0, 5);
      if (stuck.length) {
        lines.push('Stuck quotes (oldest client contact first):');
        for (const s of stuck) {
          const days = s.lastHeard ? Math.round((today - s.lastHeard) / 86400000) : null;
          const heard = days !== null ? `${days}d since contact` : 'no contact recorded';
          lines.push(`  • ${s.account} — ${s.stage} — ${s.scope || '(no scope)'}${typeof s.amount === 'number' ? ` · ${fmt$(s.amount)}` : ''} · ${heard}`);
        }
      }

      // Overdue follow-ups (Follow Up date < today, still active).
      const overdue = active
        .map(r => ({
          account: r.Account,
          stage: r.Stage,
          scope: r.Scope || '',
          amount: parseMoney(r['Quoted Amount']),
          followUp: parseDate(r['Follow Up']),
        }))
        .filter(r => r.followUp && r.followUp < today)
        .sort((a, b) => a.followUp - b.followUp)
        .slice(0, 5);
      if (overdue.length) {
        lines.push('Overdue follow-ups (oldest first):');
        for (const o of overdue) {
          const dueDays = Math.round((today - o.followUp) / 86400000);
          lines.push(`  • ${o.account} — ${o.stage} — ${o.scope || '(no scope)'}${typeof o.amount === 'number' ? ` · ${fmt$(o.amount)}` : ''} · ${dueDays}d overdue`);
        }
      }

      // Top 5 active opps by Quoted Amount.
      const topByAmount = [...active]
        .map(r => ({ account: r.Account, stage: r.Stage, scope: r.Scope, amount: parseMoney(r['Quoted Amount']) || 0 }))
        .filter(r => r.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
      if (topByAmount.length) {
        lines.push('Top 5 active opps by Quoted Amount:');
        for (const o of topByAmount) {
          lines.push(`  • ${o.account} — ${o.stage} — ${o.scope || '(no scope)'} · ${fmt$(o.amount)}`);
        }
      }
    } else {
      lines.push('Opps tab: no opportunities loaded.');
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('buildPipelineSummary failed', err);
    return '';
  }
}

const TARGET_EMAIL = 'baldaufdan@gmail.com';

export function DailySuccessManager({ user }) {
  const [phase, setPhase] = useState(null); // 'morning' | 'mid' | 'end' | null
  const [entry, setEntry] = useState(null);
  const [morningText, setMorningText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState([]); // string[] from Claude, awaiting keep/drop
  const [barriers, setBarriers] = useState([]); // string[] of biggest barriers (read-only)
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState(DEFAULT_COACHING_RULES);
  const tickerRef = useRef(null);

  const enabled = (user?.email || '').toLowerCase() === TARGET_EMAIL;

  useEffect(() => {
    if (!enabled || !user?.uid) return undefined;
    const unsub = subscribeToCoachingRules(user.uid, setRules);
    return () => unsub();
  }, [enabled, user?.uid]);

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
    setBarriers([]);
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
      const pipelineSummary = await buildPipelineSummary();
      const resp = await fetch('/api/daily-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recent,
          notes: morningText,
          userName: 'Dan',
          pipelineSummary,
          coachingRules: rules,
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
      setBarriers(Array.isArray(data?.barriers) ? data.barriers : []);
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
            {showRules && (
              <CoachingRulesPanel user={user} onClose={() => setShowRules(false)} />
            )}
            {barriers.length > 0 && (
              <div className={styles.barrierBox}>
                <div className={styles.barrierHead}>
                  <strong>Biggest barriers to success</strong>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => setBarriers([])}
                    title="Hide barriers list"
                  >×</button>
                </div>
                <ul className={styles.barrierList}>
                  {barriers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
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
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setShowRules(s => !s)}
              title="Edit the thresholds and notes that shape Claude's suggestions every morning."
            >{showRules ? 'Hide rules' : '⚙ Rules'}</button>
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
