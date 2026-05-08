import { useEffect, useState } from 'react';
import styles from './DailySuccess.module.css';
import {
  loadGoals,
  addGoal,
  updateGoal,
  deleteGoal,
  archiveGoal,
  unarchiveGoal,
  applyPrioritization,
  activeGoals as activeGoalsOf,
  sortedByPriority,
} from './goalsStore';
import { upsertEntry, getEntry, todayKey, newBullet } from './dailySuccessStore';
import { dbGet } from '../../utils/db';
import { subscribeToCoachingRules, DEFAULT_COACHING_RULES } from './coachingRulesStore';

// Goals panel — long-running ambitions the user wants Claude to help
// prioritize against the live pipeline + turn into concrete daily
// tasks. Lives as a second tab inside the Daily Success Log modal.

// Snapshot builder mirrors what DailySuccessManager hands to the
// /api/daily-goals endpoint, kept here as a separate copy so this
// panel doesn't depend on the manager's internals. Pulls pipeline +
// BFO + opps data straight off IndexedDB.
async function buildPipelineSummary() {
  try {
    const pipeline = await dbGet('pipeline-dashboard', 'current');
    const bfo = await dbGet('bfo-activity', 'current');
    const opps = await dbGet('opps-cache', 'data');
    const lines = [];
    if (pipeline) {
      const fmt = (v) => typeof v === 'number'
        ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : (v || '');
      if (pipeline.quotaProgressPct != null) lines.push(`Quota progress: ${Math.round(pipeline.quotaProgressPct)}%`);
      if (pipeline.quotaSold != null) lines.push(`Quota sold YTD: ${fmt(pipeline.quotaSold)}`);
      if (pipeline.newOppsActual != null && pipeline.newOppsGoal != null) {
        lines.push(`New opps: ${pipeline.newOppsActual} actual vs ${pipeline.newOppsGoal} goal`);
      }
      if (pipeline.activityActual != null && pipeline.activityGoal != null) {
        lines.push(`Activity: ${pipeline.activityActual} actual vs ${pipeline.activityGoal} goal`);
      }
      if (Array.isArray(pipeline.stageRows)) {
        for (const r of pipeline.stageRows) {
          const parts = [];
          if (r.count != null) parts.push(`${r.count} opps`);
          if (r.amountSum != null) parts.push(`${fmt(r.amountSum)} quoted`);
          if (r.closeRateActual != null && r.closeRateGoal != null) parts.push(`close ${Math.round(r.closeRateActual)}% vs ${Math.round(r.closeRateGoal)}% goal`);
          if (r.avgLifeDaysActual != null && r.avgLifeDaysGoal != null) parts.push(`avg life ${r.avgLifeDaysActual}d vs ${r.avgLifeDaysGoal}d goal`);
          lines.push(`Stage ${r.label || r.stage}: ${parts.join(', ')}`);
        }
      }
    }
    if (Array.isArray(opps?.records)) {
      const active = opps.records.filter(r => {
        const stage = String(r['Stage'] || '').trim();
        return stage && !/^(Sold|Not Sold|Closed|Lost)$/i.test(stage);
      });
      lines.push(`Active opps in Opps tab: ${active.length}`);
      // Top 10 active opps by quoted amount as illustrative evidence.
      const ranked = [...active].sort((a, b) => {
        const ma = Number(String(a['Quoted Amount'] || '').replace(/[^0-9.\-]/g, '')) || 0;
        const mb = Number(String(b['Quoted Amount'] || '').replace(/[^0-9.\-]/g, '')) || 0;
        return mb - ma;
      }).slice(0, 10);
      for (const r of ranked) {
        const acct = r['Account'] || '(unknown)';
        const stage = r['Stage'] || '';
        const amt = r['Quoted Amount'] || '';
        const next = r['Next Step'] || r['Notes'] || '';
        lines.push(`  • ${acct} — Stage ${stage}${amt ? `, ${amt}` : ''}${next ? `, next: ${String(next).slice(0, 80)}` : ''}`);
      }
    }
    if (bfo?.summary) lines.push(`BFO summary: ${bfo.summary}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}

export function GoalsPanel({ user }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [tasks, setTasks] = useState([]); // { goalId, text }
  const [keptTaskIdx, setKeptTaskIdx] = useState(new Set());
  const [coachingRules, setCoachingRules] = useState(DEFAULT_COACHING_RULES);

  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadGoals().then(list => {
      if (!cancelled) { setGoals(list); setLoading(false); }
    }).catch(err => {
      if (cancelled) return;
      // Most common cause: the IndexedDB version-bump that creates
      // the new daily-success-goals store is blocked by another tab
      // holding the prospect-tracker-db open at the previous version.
      // Surface the error so the user can act on it instead of
      // staring at "Loading goals…" forever.
      setLoadError(err?.message || String(err));
      setGoals([]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = subscribeToCoachingRules(user.uid, setCoachingRules);
    return () => unsub();
  }, [user?.uid]);

  async function refresh() {
    const list = await loadGoals();
    setGoals(list);
  }

  async function handleAdd() {
    const t = draft.trim();
    if (!t) return;
    await addGoal(t);
    setDraft('');
    refresh();
  }

  async function handleSaveEdit(id) {
    const t = editingText.trim();
    if (t) await updateGoal(id, { text: t });
    setEditingId(null);
    setEditingText('');
    refresh();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this goal?')) return;
    await deleteGoal(id);
    refresh();
  }

  async function handleArchive(id, archived) {
    if (archived) await unarchiveGoal(id);
    else await archiveGoal(id);
    refresh();
  }

  async function handlePrioritize() {
    const active = activeGoalsOf(goals);
    if (active.length === 0) {
      setStatus('Add at least one goal first.');
      return;
    }
    setWorking(true);
    setStatus('Asking Claude to prioritize and draft tasks…');
    try {
      const pipelineSummary = await buildPipelineSummary();
      const resp = await fetch('/api/prioritize-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: active.map(g => ({ id: g.id, text: g.text })),
          pipelineSummary,
          coachingRules,
          userName: user?.displayName || user?.email || '',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      if (Array.isArray(data.prioritized) && data.prioritized.length > 0) {
        await applyPrioritization(data.prioritized);
        await refresh();
      }
      setTasks(Array.isArray(data.dailyTasks) ? data.dailyTasks : []);
      setKeptTaskIdx(new Set());
      setStatus(data.dailyTasks?.length
        ? `Prioritized · ${data.dailyTasks.length} task${data.dailyTasks.length === 1 ? '' : 's'} suggested below`
        : 'Prioritized · no daily tasks suggested');
    } catch (err) {
      setStatus(`Error: ${err?.message || err}`);
    } finally {
      setWorking(false);
    }
  }

  async function addTaskToToday(taskIdx) {
    const t = tasks[taskIdx];
    if (!t || keptTaskIdx.has(taskIdx)) return;
    const date = todayKey();
    const existing = (await getEntry(date)) || { date, bullets: [], shownMid: false, shownEnd: false };
    const next = {
      ...existing,
      bullets: [...(existing.bullets || []), newBullet(t.text)],
      morningCreatedAt: existing.morningCreatedAt || Date.now(),
    };
    await upsertEntry(date, next);
    setKeptTaskIdx(prev => {
      const s = new Set(prev);
      s.add(taskIdx);
      return s;
    });
  }

  async function addAllTasksToToday() {
    const date = todayKey();
    const existing = (await getEntry(date)) || { date, bullets: [], shownMid: false, shownEnd: false };
    const remaining = tasks
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !keptTaskIdx.has(i));
    if (remaining.length === 0) return;
    const next = {
      ...existing,
      bullets: [
        ...(existing.bullets || []),
        ...remaining.map(({ t }) => newBullet(t.text)),
      ],
      morningCreatedAt: existing.morningCreatedAt || Date.now(),
    };
    await upsertEntry(date, next);
    const allIdx = new Set(keptTaskIdx);
    for (const { i } of remaining) allIdx.add(i);
    setKeptTaskIdx(allIdx);
  }

  async function reorderManually(fromIdx, toIdx) {
    // Manual reorder only acts on active goals — stamp explicit
    // priority numbers so Claude's next pass takes them as the
    // baseline, and clear any previously-set rationale on touched
    // rows so stale text doesn't mislead the user.
    const ordered = sortedByPriority(activeGoalsOf(goals));
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= ordered.length || toIdx >= ordered.length) return;
    const moved = ordered.splice(fromIdx, 1)[0];
    ordered.splice(toIdx, 0, moved);
    const prioritized = ordered.map((g, i) => ({ id: g.id, priority: i + 1, rationale: g.rationale }));
    const next = await applyPrioritization(prioritized);
    setGoals(next);
  }

  const visible = sortedByPriority(showArchived ? goals : activeGoalsOf(goals));
  const activeCount = activeGoalsOf(goals).length;
  const archivedCount = goals.length - activeCount;

  if (loading) return <div className={styles.smallNote}>Loading goals…</div>;
  if (loadError) {
    return (
      <div style={{ padding: '0.6rem 0.8rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.78rem' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Couldn't open the goals store</div>
        <div style={{ marginBottom: 6 }}>{loadError}</div>
        <div style={{ fontSize: '0.7rem', color: '#7F1D1D' }}>
          Most often this means another tab on the same browser is holding the database open at the old version. Close the other Prospect Tracker tabs, then reload this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <textarea
          className={styles.morningArea}
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAdd(); } }}
          placeholder="Add a goal — long-running ambition you want Claude to help break down (⌘/Ctrl + Enter to save)"
          style={{ flex: 1, minHeight: 60 }}
        />
        <button type="button" className={styles.btnPrimary} onClick={handleAdd} disabled={!draft.trim()}>Add Goal</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handlePrioritize}
          disabled={working || activeCount === 0}
          title="Run all active goals through Claude with your pipeline + coaching rules. Claude ranks them and drafts daily tasks for the top goals."
        >{working ? 'Asking Claude…' : '✨ Prioritize with Claude'}</button>
        {archivedCount > 0 && (
          <label style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
        {status && (
          <span style={{ fontSize: 12, color: status.startsWith('Error') ? '#B91C1C' : '#475569' }}>{status}</span>
        )}
      </div>

      {tasks.length > 0 && (
        <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6, padding: '0.6rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ fontSize: '0.78rem', color: '#075985' }}>Daily tasks Claude drafted</strong>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={addAllTasksToToday}
              disabled={tasks.every((_, i) => keptTaskIdx.has(i))}
              title="Append every task below to today's Daily Success Log entry"
            >Add all to today</button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tasks.map((t, i) => {
              const goal = goals.find(g => g.id === t.goalId);
              const kept = keptTaskIdx.has(i);
              return (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: '#0C4A6E' }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{t.text}</span>
                    {goal && <span style={{ color: '#0369A1', fontSize: '0.68rem', marginLeft: 6 }}>↳ {goal.text}</span>}
                  </span>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => addTaskToToday(i)}
                    disabled={kept}
                    title="Append this task to today's Daily Success Log entry"
                  >{kept ? 'Added ✓' : 'Add to today'}</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {visible.length === 0 && (
        <p className={styles.smallNote}>No goals yet — add one above to get started.</p>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((g, i) => {
            const isEditing = editingId === g.id;
            const archived = !!g.archivedAt;
            return (
              <div
                key={g.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '0.5rem 0.6rem',
                  background: archived ? '#F8FAFC' : '#fff',
                  border: '1px solid ' + (archived ? '#E2E8F0' : '#CBD5E1'),
                  borderRadius: 6,
                  opacity: archived ? 0.7 : 1,
                }}
              >
                <span
                  title={typeof g.priority === 'number' ? `Priority ${g.priority}` : 'Not yet prioritized'}
                  style={{
                    minWidth: 28, height: 28, borderRadius: 999,
                    background: typeof g.priority === 'number' ? '#1D4ED8' : '#E2E8F0',
                    color: typeof g.priority === 'number' ? '#fff' : '#94A3B8',
                    fontWeight: 700, fontSize: '0.78rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >{typeof g.priority === 'number' ? g.priority : '–'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <textarea
                      autoFocus
                      className={styles.morningArea}
                      rows={2}
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSaveEdit(g.id); }
                        else if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                      }}
                      onBlur={() => handleSaveEdit(g.id)}
                      style={{ width: '100%', minHeight: 50 }}
                    />
                  ) : (
                    <div
                      onClick={() => { if (!archived) { setEditingId(g.id); setEditingText(g.text); } }}
                      style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1E293B', cursor: archived ? 'default' : 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      title={archived ? '' : 'Click to edit'}
                    >{g.text}</div>
                  )}
                  {g.rationale && (
                    <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 4, fontStyle: 'italic' }}>
                      {g.rationale}
                    </div>
                  )}
                  {g.lastPrioritizedAt && (
                    <div style={{ fontSize: '0.62rem', color: '#94A3B8', marginTop: 2 }}>
                      Last prioritized {new Date(g.lastPrioritizedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  {!archived && i > 0 && (
                    <button type="button" className={styles.btnGhost} onClick={() => reorderManually(i, i - 1)} title="Move up">↑</button>
                  )}
                  {!archived && i < visible.length - 1 && (
                    <button type="button" className={styles.btnGhost} onClick={() => reorderManually(i, i + 1)} title="Move down">↓</button>
                  )}
                  <button type="button" className={styles.btnGhost} onClick={() => handleArchive(g.id, archived)} title={archived ? 'Unarchive' : 'Archive'}>
                    {archived ? '↻' : '📦'}
                  </button>
                  <button type="button" className={styles.delBtn} onClick={() => handleDelete(g.id)} title="Delete">×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
