// End-of-week (or end-of-day) work summary. Reads what already lives in
// the tool — the HubSpot activity cache, the Opps 2 field-change
// timestamps, and the Daily Success goals — scopes it to the selected
// week or day, shows the hard numbers, and (on demand) asks Claude to
// write a short narrative recap over them.
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeeklyReportView.module.css';
import { useAuth } from '../../contexts/AuthContext';
import { userLsGet } from '../../utils/userLs';
import { dbGet } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadGoals } from '../DailySuccess/goalsStore';
import { subscribeToCoachingRules } from '../DailySuccess/coachingRulesStore';
import { apiFetch } from '../../utils/apiFetch';
import {
  weekBounds, dayBounds, periodLabel,
  computeActivity, computeOppChanges, computeGoalsProgress,
  serializeReport, pipelineSnapshotLines,
} from '../../utils/weeklyReport';

const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';
const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readActivityCache() {
  try {
    const raw = userLsGet(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Minimal, safe Markdown renderer for the LLM narrative — handles ##/#
// headings, - / • bullet lists, blank-line paragraphs, and **bold**.
// Renders React elements (no raw HTML injection).
function inlineBold(text, keyBase) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1
    ? <strong key={`${keyBase}-b${i}`}>{p}</strong>
    : <span key={`${keyBase}-s${i}`}>{p}</span>));
}

function renderNarrative(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  const flushList = () => {
    if (list) { out.push(<ul key={`ul${out.length}`} className={styles.narList}>{list}</ul>); list = null; }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flushList(); return; }
    const h2 = line.match(/^##\s+(.*)$/);
    const h1 = line.match(/^#\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (h2) { flushList(); out.push(<h4 key={`h${idx}`} className={styles.narHead}>{inlineBold(h2[1], `h${idx}`)}</h4>); return; }
    if (h1) { flushList(); out.push(<h3 key={`h${idx}`} className={styles.narHead}>{inlineBold(h1[1], `h${idx}`)}</h3>); return; }
    if (bullet) { list = list || []; list.push(<li key={`li${idx}`}>{inlineBold(bullet[1], `li${idx}`)}</li>); return; }
    flushList();
    out.push(<p key={`p${idx}`} className={styles.narP}>{inlineBold(line, `p${idx}`)}</p>);
  });
  flushList();
  return out;
}

function StatTile({ value, label, accent, sub }) {
  return (
    <div className={styles.tile} data-accent={accent || undefined}>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileLabel}>{label}</div>
      {sub ? <div className={styles.tileSub}>{sub}</div> : null}
    </div>
  );
}

const fmtMoney = (n) => (Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '');

// A named change list with the account/scope + a per-row suffix.
function ChangeList({ title, items, suffix }) {
  if (!items || !items.length) return null;
  const who = (x) => [x.account, x.scope].filter(Boolean).join(' — ') || `Opp ${x.id}`;
  return (
    <div className={styles.changeGroup}>
      <div className={styles.changeTitle}>{title} <span className={styles.changeCount}>{items.length}</span></div>
      <ul className={styles.changeItems}>
        {items.slice(0, 30).map((x, i) => (
          <li key={x.id || i}>
            <span className={styles.changeWho}>{who(x)}</span>
            {suffix ? <span className={styles.changeSuffix}>{suffix(x)}</span> : null}
          </li>
        ))}
        {items.length > 30 && <li className={styles.changeMore}>…and {items.length - 30} more</li>}
      </ul>
    </div>
  );
}

export function WeeklyReportView({ settings }) {
  const { user } = useAuth();
  const senderEmail = String(settings?.workEmail || '').toLowerCase().trim();

  const [mode, setMode] = useState('week'); // 'week' | 'day'
  const [refDate, setRefDate] = useState(todayIso);

  const [cache, setCache] = useState(() => readActivityCache());
  const [oppsRecords, setOppsRecords] = useState([]);
  const [goals, setGoals] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [coachingRules, setCoachingRules] = useState(null);

  const [narrative, setNarrative] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  // The period the current narrative was generated for — so switching
  // week/day or date makes the stale recap obvious.
  const genForRef = useRef('');

  // Load everything on mount and whenever the window regains focus (so a
  // fresh Opps paste or HubSpot refresh elsewhere shows up here).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setCache(readActivityCache());
      loadOppsFromCache().then(o => { if (!cancelled) setOppsRecords(o?.records || []); }).catch(() => {});
      loadGoals().then(g => { if (!cancelled) setGoals(Array.isArray(g) ? g : []); }).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => { if (!cancelled) setPipeline(p || null); }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // Coaching rules stream (optional context for the narrative).
  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = subscribeToCoachingRules(user.uid, (r) => setCoachingRules(r || null));
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, [user?.uid]);

  const bounds = useMemo(
    () => (mode === 'day' ? dayBounds(refDate) : weekBounds(refDate)),
    [mode, refDate],
  );
  const label = useMemo(() => periodLabel(refDate, mode), [refDate, mode]);

  const activity = useMemo(
    () => computeActivity(cache, senderEmail, bounds.start, bounds.end),
    [cache, senderEmail, bounds],
  );
  const oppChanges = useMemo(
    () => computeOppChanges(oppsRecords, bounds.start, bounds.end),
    [oppsRecords, bounds],
  );
  const goalsProg = useMemo(
    () => computeGoalsProgress(goals, bounds.start, bounds.end),
    [goals, bounds],
  );
  const pipelineSummary = useMemo(() => pipelineSnapshotLines(pipeline), [pipeline]);

  const statsText = useMemo(() => serializeReport({
    label, activity, oppChanges, goals: goalsProg, pipelineSummary,
  }), [label, activity, oppChanges, goalsProg, pipelineSummary]);

  const periodKey = `${mode}:${refDate}`;
  const narrativeStale = narrative && genForRef.current && genForRef.current !== periodKey;

  const anyData = activity.emails.length || activity.calls.length || activity.meetings.length
    || oppChanges.newOpps.length || oppChanges.closed.length || oppChanges.stageChanges.length
    || oppChanges.closeDateMoves.length || oppChanges.amountUpdates.length || oppChanges.bfoTags.length
    || goalsProg.created.length || goalsProg.archived.length;

  async function generate() {
    if (genLoading) return;
    setGenLoading(true);
    setGenError('');
    try {
      const resp = await apiFetch('/api/week-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stats: statsText,
          periodLabel: label,
          scope: mode,
          userName: user?.displayName || user?.email || '',
          pipelineSummary,
          coachingRules,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      if (!data?.narrative) throw new Error('No recap returned.');
      setNarrative(data.narrative);
      genForRef.current = periodKey;
    } catch (err) {
      setGenError(err?.message || String(err));
    } finally {
      setGenLoading(false);
    }
  }

  async function copyReport() {
    const parts = [];
    if (narrative && !narrativeStale) parts.push(narrative.trim(), '');
    parts.push(statsText);
    const text = parts.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlash('Copied report to clipboard.');
    } catch {
      setCopyFlash('Copy failed — select and copy manually.');
    }
    window.setTimeout(() => setCopyFlash(''), 2500);
  }

  const isCurrent = refDate === todayIso();

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Weekly Report</h1>
          <span className={styles.subtitle}>{label}</span>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.modeToggle} role="tablist" aria-label="Report period">
            <button
              type="button"
              className={mode === 'week' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('week')}
            >Week</button>
            <button
              type="button"
              className={mode === 'day' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('day')}
            >Day</button>
          </div>
          <label className={styles.dateField} title="Pick any date; the report covers that day or the Mon–Sun week containing it.">
            <input
              type="date"
              className={styles.dateInput}
              value={refDate}
              max={todayIso()}
              onChange={(e) => setRefDate(e.target.value || todayIso())}
            />
          </label>
          {!isCurrent && (
            <button type="button" className={styles.ghostBtn} onClick={() => setRefDate(todayIso())} title="Jump to the current period">
              {mode === 'day' ? 'Today' : 'This week'}
            </button>
          )}
          <button type="button" className={styles.primaryBtn} onClick={generate} disabled={genLoading || !anyData}>
            {genLoading ? 'Writing…' : (narrative && !narrativeStale ? 'Regenerate summary' : 'Generate AI summary')}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={copyReport}>Copy report</button>
          {copyFlash && <span className={styles.flash}>{copyFlash}</span>}
        </div>
      </div>

      {!senderEmail && (
        <div className={styles.note}>
          Set your work email in <strong>Settings → CDM Name</strong> so sent-email counts can match your outbound HubSpot mail. Calls, meetings, opp changes, and goals still work without it.
        </div>
      )}

      <div className={styles.tiles}>
        <StatTile value={activity.emails.length} label="Emails sent" accent="blue" />
        <StatTile value={activity.calls.length} label="Calls" accent="blue" />
        <StatTile value={activity.meetings.length} label="Meetings" accent="blue" />
        <StatTile value={oppChanges.closed.length} label="Deals closed" accent="green" sub={fmtMoney(oppChanges.closedAmount) ? `${fmtMoney(oppChanges.closedAmount)} quoted` : undefined} />
        <StatTile value={oppChanges.newOpps.length} label="New opps" accent="green" />
        <StatTile value={oppChanges.stageChanges.length} label="Stage changes" />
        <StatTile value={oppChanges.amountUpdates.length} label="Amount updates" />
        <StatTile value={oppChanges.bfoTags.length} label="BFO tags" />
        <StatTile value={goalsProg.archived.length} label="Goals closed" accent="green" />
        <StatTile value={goalsProg.active.length} label="Active goals" />
      </div>

      {(narrative || genError || genLoading) && (
        <div className={styles.narrative}>
          {genLoading && <div className={styles.note}>Writing your {mode === 'day' ? 'day' : 'week'} recap…</div>}
          {genError && <div className={styles.error}>Couldn’t write the recap: {genError}</div>}
          {narrative && !genLoading && (
            <>
              {narrativeStale && (
                <div className={styles.staleTag}>This recap was written for a different period — regenerate to refresh.</div>
              )}
              <div className={styles.narBody}>{renderNarrative(narrative)}</div>
            </>
          )}
        </div>
      )}

      {!anyData && (
        <div className={styles.empty}>
          No tracked work found for this {mode === 'day' ? 'day' : 'week'}. Activity comes from the HubSpot cache (refresh it on the Activity tab), opp changes from edits made on the Opps tab, and goals from your Daily Success goals. Older changes made before the tool started stamping timestamps won’t appear.
        </div>
      )}

      <div className={styles.sections}>
        <section className={styles.section}>
          <h2 className={styles.sectionHead}>Opportunity changes</h2>
          {(oppChanges.closed.length + oppChanges.newOpps.length + oppChanges.stageChanges.length
            + oppChanges.closeDateMoves.length + oppChanges.amountUpdates.length + oppChanges.bfoTags.length) === 0 ? (
            <div className={styles.mutedRow}>No opp changes recorded this {mode === 'day' ? 'day' : 'week'}.</div>
          ) : (
            <>
              <ChangeList title="Deals closed" items={oppChanges.closed} suffix={x => ` → ${x.stage}${x.amount ? ` (${x.amount})` : ''}`} />
              <ChangeList title="New opps" items={oppChanges.newOpps} suffix={x => (x.stage ? ` (${x.stage})` : '')} />
              <ChangeList title="Stage changes" items={oppChanges.stageChanges} suffix={x => ` → ${x.stage}`} />
              <ChangeList title="Close-date moves" items={oppChanges.closeDateMoves} suffix={x => (x.closeDate ? ` → ${x.closeDate}` : '')} />
              <ChangeList title="Amount updates" items={oppChanges.amountUpdates} suffix={x => (x.amount ? ` → ${x.amount}` : '')} />
              <ChangeList title="BFO Opportunity Names tagged" items={oppChanges.bfoTags} suffix={x => (x.bfo ? ` → ${x.bfo}` : '')} />
              <div className={styles.caveat}>
                “New opps” is a best-effort estimate — opps first edited in the tool this period may appear here even if created earlier, since the data carries no dedicated creation date.
              </div>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionHead}>Goals</h2>
          {goalsProg.created.length > 0 && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Set this {mode === 'day' ? 'day' : 'week'} <span className={styles.changeCount}>{goalsProg.created.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.created.map(g => <li key={g.id}><span className={styles.changeWho}>{String(g.text || '').trim()}</span></li>)}
              </ul>
            </div>
          )}
          {goalsProg.archived.length > 0 && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Completed / closed <span className={styles.changeCount}>{goalsProg.archived.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.archived.map(g => <li key={g.id}><span className={styles.changeWho}>{String(g.text || '').trim()}</span></li>)}
              </ul>
            </div>
          )}
          {goalsProg.active.length > 0 ? (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Active goals <span className={styles.changeCount}>{goalsProg.active.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.active.slice(0, 12).map(g => (
                  <li key={g.id}>
                    {g.priority != null && <span className={styles.pill}>#{g.priority}</span>}
                    <span className={styles.changeWho}>{String(g.text || '').trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className={styles.mutedRow}>No active goals. Add some in the Daily Success Log → Goals.</div>
          )}
          {pipelineSummary && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Pipeline snapshot</div>
              <pre className={styles.pipelinePre}>{pipelineSummary}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
