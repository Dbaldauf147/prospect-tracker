// BFO Activity > All Team Activity. The team's open opportunities from the
// Salesforce report "SB NAM Sales - Open Opportunities", pasted here twice a
// month by the Agents tab's AI Prompt (All Team Activity), with the rows on
// Dan's own accounts flagged and what changed since the pull before called
// out. Parsing, matching and the diff live in utils/teamOpps.
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './BFOActivityView.module.css';
import { DataTable } from '../common/DataTable';
import { LastUpdatedLine } from './LastUpdatedLine';
import { matchesCdm } from '../../utils/cdmMatch';
import { myAccounts } from '../../utils/tieredAccountActivity';
import { bfoCompanyNamesOf } from '../../utils/bfoCompanyNames';
import {
  parseTeamOppsPaste, buildMyAccountIndex, accountMatch, diffTeamOpps, teamOppKey, teamOppsDue, TEAM_OPPS_HEADER,
} from '../../utils/teamOpps';
import { loadTeamOpps, saveTeamOpps, withNewTeamOppsPull, TEAM_OPPS_EVENT } from '../../utils/teamOppsStore';

const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

const KIND_STYLE = {
  new: { label: 'New', background: '#DBEAFE', color: '#1D4ED8', border: '1px solid #93C5FD' },
  changed: { label: 'Changed', background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' },
  gone: { label: 'Off report', background: '#F3F4F6', color: '#6B7280', border: '1px solid #E2E8F0' },
};

// Default widths for the report's own columns; anything else gets 140.
const WIDTHS = {
  'Opportunity Leader': 150, 'Stage Group': 110, 'Sales Stage': 170, 'Opportunity Name': 320,
  'Account Name': 260, 'Close Date': 100, 'Amount (converted)': 130, Amount: 120,
  'Partner Facing Amount (converted)': 150, 'Probability (%)': 100,
};

export function TeamOppsView({ prospects = [], cdmName = '', settings, updateSettings }) {
  const [record, setRecord] = useState(null);
  const [scope, setScope] = useState('mine'); // 'mine' | 'all'
  const [hideOwn, setHideOwn] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);

  // Opportunities ticked Ignore: teamOppKey (opportunity name + account,
  // stable from one pull to the next) -> when it was ticked. On synced
  // settings so the choice follows Dan to his other machine and survives
  // the next paste. Ignored rows are off the list and out of the counts
  // until "Show ignored" brings them back to untick.
  const ignored = useMemo(() => settings?.teamOppsIgnored || {}, [settings?.teamOppsIgnored]);
  const setIgnored = useCallback((key, on) => {
    const next = { ...ignored };
    if (on) next[key] = new Date().toISOString();
    else delete next[key];
    updateSettings?.({ teamOppsIgnored: next });
  }, [ignored, updateSettings]);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');

  const reload = useCallback(() => { loadTeamOpps().then(setRecord); }, []);
  useEffect(() => {
    reload();
    window.addEventListener(TEAM_OPPS_EVENT, reload);
    return () => window.removeEventListener(TEAM_OPPS_EVENT, reload);
  }, [reload]);

  const importPaste = async (text) => {
    const parsed = parseTeamOppsPaste(text);
    if (!parsed.rows.length) {
      setFlash('No opportunities found in that paste. Copy the report including its header row.');
      return;
    }
    const next = withNewTeamOppsPull(record, parsed);
    setRecord(next);
    setPasteText('');
    setFlash(`Saved ${parsed.rows.length} opportunities.`);
    window.setTimeout(() => setFlash(''), 4000);
    try { await saveTeamOpps(next); } catch (err) { setFlash(`Could not save: ${err?.message || err}`); }
    // The pull's date also rides on synced settings, so the Agents tab's
    // "due" line is right on every machine.
    updateSettings?.({ teamOppsLastPulledAt: new Date(next.updatedAt).toISOString() });
  };
  const onPaste = (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || (t.tagName === 'TEXTAREA' && t.dataset.teamPaste !== '1'))) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t')) return;
    e.preventDefault();
    importPaste(text);
  };
  const clearAll = async () => {
    if (!window.confirm('Clear the All Team Activity data (this pull and the one before)?')) return;
    const empty = { headers: [], rows: [], updatedAt: null, previous: null };
    setRecord(empty);
    try { await saveTeamOpps(empty); } catch { /* keep the cleared view */ }
  };

  const index = useMemo(() => buildMyAccountIndex(
    myAccounts(prospects, cdmName).map(p => ({ company: p.company, names: bfoCompanyNamesOf(p) })),
  ), [prospects, cdmName]);

  const headers = record?.headers?.length ? record.headers : TEAM_OPPS_HEADER;
  const prevRows = record?.previous?.rows || null;
  const allRows = useMemo(() => {
    const curr = record?.rows || [];
    const { byKey, gone } = diffTeamOpps(prevRows, curr);
    const seen = new Map();
    const make = (r, kind, changes) => {
      const base = teamOppKey(r);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return {
        ...r,
        id: n > 1 ? `${base}#${n}` : base,
        _kind: kind,
        _changes: changes,
        _mine: accountMatch(r['Account Name'], index),
        _own: matchesCdm(r['Opportunity Leader'], cdmName),
        _ignoreKey: base,
        _ignored: !!ignored[base],
      };
    };
    return [
      ...curr.map(r => { const d = byKey.get(teamOppKey(r)) || {}; return make(r, d.kind || '', d.changes || []); }),
      ...gone.map(r => make(r, 'gone', [])),
    ];
  }, [record, prevRows, index, cdmName, ignored]);

  const rows = allRows.filter(r => (scope === 'all' || r._mine) && !(hideOwn && r._own) && (showIgnored || !r._ignored));
  const mineRows = allRows.filter(r => r._mine && !(hideOwn && r._own) && !r._ignored);
  const ignoredCount = allRows.filter(r => r._ignored && (scope === 'all' || r._mine) && !(hideOwn && r._own)).length;
  const count = (k) => mineRows.filter(r => r._kind === k).length;

  const columns = useMemo(() => [
    {
      key: '_ignored', label: 'Ignore', defaultWidth: 70,
      getSortValue: r => (r._ignored ? 1 : 0),
      getFilterValue: r => (r._ignored ? 'Ignored' : 'Not ignored'),
      exportValue: r => (r._ignored ? 'Yes' : ''),
      render: r => (
        <input
          type="checkbox"
          data-team-opp-ignore
          checked={r._ignored}
          onChange={e => setIgnored(r._ignoreKey, e.target.checked)}
          onClick={e => e.stopPropagation()}
          title={r._ignored
            ? 'Ignored: off this page and out of the counts. Untick to bring it back.'
            : 'Ignore this opportunity on this page. It stays ignored on later pulls; tick Show ignored to find it again.'}
          style={{ cursor: 'pointer' }}
        />
      ),
    },
    {
      key: '_kind', label: 'Change', defaultWidth: 230,
      getSortValue: r => ({ new: 0, changed: 1, gone: 2 }[r._kind] ?? 3),
      getFilterValue: r => (KIND_STYLE[r._kind]?.label || 'No change'),
      exportValue: r => [KIND_STYLE[r._kind]?.label, ...r._changes].filter(Boolean).join('; '),
      render: r => {
        const k = KIND_STYLE[r._kind];
        if (!k) return <span style={{ color: '#94A3B8' }}>-</span>;
        return (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
            <span style={{ ...k, padding: '0 8px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700 }}>{k.label}</span>
            {r._changes.map(c => <span key={c} style={{ fontSize: '0.7rem', color: '#475569', whiteSpace: 'normal' }}>{c}</span>)}
          </span>
        );
      },
    },
    {
      key: '_mine', label: 'My Account', defaultWidth: 170,
      getSortValue: r => (r._mine || '').toLowerCase(),
      getFilterValue: r => r._mine || 'Not mine',
      exportValue: r => r._mine,
      render: r => (r._mine
        ? <span style={{ fontWeight: 700, color: '#166534' }}>{r._mine}</span>
        : <span style={{ color: '#94A3B8' }}>-</span>),
    },
    ...headers.map(h => ({
      key: `col:${h}`, label: h, defaultWidth: WIDTHS[h] || 140,
      getSortValue: r => {
        const v = String(r[h] ?? '');
        if (/date/i.test(h)) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
        if (/amount|probability/i.test(h)) { const n = Number(v.replace(/[^0-9.-]/g, '')); return v && Number.isFinite(n) ? n : null; }
        return v.toLowerCase();
      },
      getFilterValue: r => String(r[h] ?? ''),
      exportValue: r => r[h] ?? '',
      render: r => <span style={{ whiteSpace: 'normal' }}>{r[h] || ''}</span>,
    })),
  ], [headers, setIgnored]);

  const lastPulledMs = record?.updatedAt || (settings?.teamOppsLastPulledAt ? Date.parse(settings.teamOppsLastPulledAt) : null);
  const { due, nextDueMs } = teamOppsDue(lastPulledMs);
  const hasRows = (record?.rows || []).length > 0;

  return (
    <div className={styles.pane} onPaste={onPaste} data-team-opps>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>All Team Activity</h1>
          <span className={styles.subtitle}>
            Open opportunities from the Salesforce report SB NAM Sales - Open Opportunities. Paste the report (Ctrl+V) anywhere on this page.
          </span>
          <LastUpdatedLine updatedAt={record?.updatedAt} hasRows={hasRows} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: due ? '#B91C1C' : '#475569' }}>
            {due
              ? 'Pull due now (the agent runs on the 1st and the 15th).'
              : `Next pull due ${fmtDay(nextDueMs)} (the 1st and the 15th).`}
          </span>
        </div>
        <div className={styles.toolbar}>
          {hasRows && <button type="button" className={styles.btn} onClick={clearAll}>Clear</button>}
        </div>
      </div>

      {flash && <div style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 600, margin: '0.25rem 0' }}>{flash}</div>}

      {!hasRows ? (
        <div className={styles.empty} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>No pull yet. Run the AI Prompt (All Team Activity) on the Agents tab, or copy the report yourself and paste it here.</span>
          <textarea
            data-team-paste="1"
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={`${TEAM_OPPS_HEADER.join('\t')}\n...`}
            rows={6}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
          />
          <div><button type="button" className={styles.btn} disabled={!pasteText.trim()} onClick={() => importPaste(pasteText)}>Save</button></div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#475569', margin: '0.4rem 0' }}>
            <span data-team-summary>
              <strong style={{ color: '#1E293B' }}>{mineRows.filter(r => r._kind !== 'gone').length}</strong> open on your accounts
              {prevRows
                ? <>: <strong style={{ color: '#1D4ED8' }}>{count('new')} new</strong>, <strong style={{ color: '#92400E' }}>{count('changed')} changed</strong>, {count('gone')} off the report since the pull on {fmtDay(record.previous.updatedAt) || 'the one before'}.</>
                : '. Changes are flagged from the next pull on.'}
            </span>
            <div role="group" aria-label="Which opportunities to list" style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
              {[['mine', 'My accounts'], ['all', 'All team']].map(([k, label], i) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={scope === k}
                  onClick={() => setScope(k)}
                  style={{
                    padding: '0.25rem 0.7rem', border: 'none', borderLeft: i ? '1px solid #CBD5E1' : 'none',
                    font: 'inherit', fontSize: '0.78rem', fontWeight: scope === k ? 700 : 500, cursor: 'pointer',
                    background: scope === k ? '#1D4ED8' : '#fff', color: scope === k ? '#fff' : '#334155',
                  }}
                >{label}</button>
              ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={hideOwn} onChange={e => setHideOwn(e.target.checked)} />
              Hide opportunities I lead
            </label>
            {(ignoredCount > 0 || showIgnored) && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="List the opportunities you ticked Ignore, so you can untick them">
                <input type="checkbox" data-team-show-ignored checked={showIgnored} onChange={e => setShowIgnored(e.target.checked)} />
                Show ignored ({ignoredCount})
              </label>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 300, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            <DataTable
              tableId="bfo-team-opps"
              columns={columns}
              rows={rows}
              alwaysVisible={['col:Opportunity Name']}
              defaultSort={{ key: '_kind', direction: 'asc' }}
              rowStyle={r => (r._ignored ? { opacity: 0.5, background: '#F8FAFC' } : r._kind === 'gone' ? { opacity: 0.7, background: '#F8FAFC' } : r._mine && scope === 'all' ? { background: '#F0FDF4' } : undefined)}
              variableRowHeight
              emptyMessage={scope === 'mine' ? 'No opportunities on your accounts in this pull.' : 'Nothing matches the filters.'}
              exportFileName="All Team Activity"
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        </>
      )}
    </div>
  );
}
