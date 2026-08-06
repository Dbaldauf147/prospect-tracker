import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { fmtDate } from '../../utils/dealsFormat';
import { setIssueSnoozed } from '../../utils/issueSnoozeStore';
import { loadClientManagerMap, CLIENT_MANAGER_EVENT } from '../../utils/clientManagerStore';
import { normClientName } from '../../utils/clientIssues';
import { useIssues } from '../../hooks/useIssues';
import { useAuth } from '../../contexts/AuthContext';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { lookupCloseNotSold, reasonOptionsForCompetition } from '../../data/closeNotSoldRules';
import { setOppField } from '../../utils/opps2Store';

// Issues tab — a running list of outstanding items that need to be
// addressed across the app. Each row is one problem surfaced by a
// detector in utils/clientIssues.js. The first mapped issue is a client
// whose soonest active contract has already expired (negative Days Until
// on the Clients tab).
//
// Each row can be snoozed: a snoozed issue stays on this tab (greyed out,
// so it can be un-snoozed) but drops out of the open-issue count on the
// sidebar badge.
// Editor for a "Close Not Sold missing data" row: the Reason Not Sold +
// Competition pair on the opp itself, which is what the Agents page maps
// to the BFO Status / Reason used to close the opp out. Same two fields
// (and the same dependent-option behaviour) as the Not Sold close-out
// popup on Opps, so a fix applied here matches one applied there.
//
// The live preview shows the BFO Status / Reason the chosen pair maps to
// — or says the pair is still unmapped — so the user can tell whether
// their pick actually clears the issue before saving.
function CloseNotSoldReasonModal({ row, reasonOptions, competitionOptions, saving, error, onSave, onClose }) {
  const fix = row.closeNotSold || {};
  const [competition, setCompetition] = useState(String(fix.competition || ''));
  const [reason, setReason] = useState(String(fix.reasonNotSold || ''));

  // Only the Reason Not Sold values that have a close-out rule for the
  // chosen Competition. Competitions without rules (blank, N/A) keep the
  // full list; the row's existing reason stays selectable so a prefilled
  // value never silently disappears.
  const filteredReasonOptions = useMemo(() => {
    const opts = reasonOptionsForCompetition(competition, reasonOptions);
    return (reason && !opts.includes(reason)) ? [reason, ...opts] : opts;
  }, [competition, reasonOptions, reason]);

  function handleCompetitionChange(next) {
    setCompetition(next);
    // Drop a reason that isn't valid under the newly-chosen Competition
    // so an unmapped combination can't be saved by accident.
    if (reason && !reasonOptionsForCompetition(next, reasonOptions).includes(reason)) {
      setReason('');
    }
  }

  const mapped = lookupCloseNotSold(competition, reason);
  const unchanged = competition === String(fix.competition || '') && reason === String(fix.reasonNotSold || '');

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid #CBD5E1', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: '#1E293B',
  };
  const btnStyle = {
    padding: '0.4rem 0.9rem', borderRadius: 4, fontFamily: 'inherit',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  };

  // Only dismiss when the press *started* on the backdrop, so releasing a
  // drag-selection over the backdrop doesn't close the popup.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 480, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Update Reason Not Sold</div>
          <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 2 }}>
            <strong>{fix.account || row.company}</strong>
            {fix.name ? <> &middot; {fix.name}</> : null}
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Competition</label>
            <select
              autoFocus
              value={competition}
              onChange={(e) => handleCompetitionChange(e.target.value)}
              style={inputStyle}
            >
              <option value="">(Select)</option>
              {competitionOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Reason Not Sold</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
            >
              <option value="">(Select a reason)</option>
              {filteredReasonOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div style={{
            fontSize: '0.72rem', borderRadius: 4, padding: '0.5rem 0.6rem',
            background: mapped ? '#ECFDF5' : '#FEF3C7',
            color: mapped ? '#065F46' : '#92400E',
          }}>
            {mapped
              ? <>Closes out in BFO as Status <strong>{mapped.status}</strong> &middot; Reason <strong>{mapped.reason}</strong>.</>
              : <>This Reason Not Sold + Competition pair has no BFO mapping yet, so the opp stays on this list. Pick a mapped pair, or extend the mapping table.</>}
          </div>
          {error && (
            <div style={{ fontSize: '0.72rem', color: '#B91C1C' }}>{error}</div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '0.5rem',
          padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{ ...btnStyle, border: '1px solid #CBD5E1', background: '#fff', color: '#475569' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || unchanged}
            onClick={() => onSave({ competition: competition.trim(), reason })}
            style={{
              ...btnStyle, border: '1px solid #0A66C2',
              background: (saving || unchanged) ? '#93C5FD' : '#0A66C2',
              color: '#fff',
              cursor: (saving || unchanged) ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save to Opps'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function IssuesView({ prospects = [], cdmName, settings, updateSettings, onSelectProspect }) {
  // useIssues handles loading the source data + listening for cross-tab
  // refreshes, and tags each row with a `snoozed` flag.
  const { issues, openCount } = useIssues({ prospects, cdmName, marketingLeads: settings?.marketingLeads, serviceOverrides: settings?.serviceOverrides, settings });

  // Client Manager is owned by the Clients tab; mirror it here (read-only)
  // and re-read when it changes there so the column stays in sync.
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  useEffect(() => {
    function onStorage(e) { if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap()); }
    function onManager() { setManagerMap(loadClientManagerMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManager);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManager);
    };
  }, []);

  const prospectById = useMemo(() => {
    const m = new Map();
    for (const p of prospects) m.set(p.id, p);
    return m;
  }, [prospects]);

  // ---- Inline Reason Not Sold editing ----
  // "Close Not Sold missing data" rows carry the opp id + its current
  // Reason Not Sold / Competition, so the pair that drives the BFO
  // close-out mapping can be fixed here instead of on Opps. Options come
  // from the Dropdowns page, same as the close-out popup on Opps 2.
  const { user } = useAuth();
  const [editingRow, setEditingRow] = useState(null);
  const [savingFix, setSavingFix] = useState(false);
  const [fixError, setFixError] = useState('');
  const dropdownLists = useMemo(() => getEffectiveDropdownLists(settings), [settings]);
  const reasonOptions = useMemo(
    () => dropdownLists.find(l => l.key === 'reasonNotSold')?.options || [],
    [dropdownLists],
  );
  const competitionOptions = useMemo(
    () => dropdownLists.find(l => l.key === 'competition')?.options || [],
    [dropdownLists],
  );

  // Write the edited pair back to the opp. Each field is saved on its own
  // (setOppField re-reads the newest data per call, so the second write
  // keeps the first), and saving refreshes the Opps cache — which fires
  // opps2-cache-updated, so useIssues re-runs and the row drops off this
  // list on its own once the combination maps.
  async function saveCloseNotSoldFix({ competition, reason }) {
    const fix = editingRow?.closeNotSold;
    if (!fix?.oppId) { setFixError('This issue has no linked Opps row to update.'); return; }
    setSavingFix(true);
    setFixError('');
    try {
      if (competition !== String(fix.competition || '')) {
        await setOppField(user?.uid, fix.oppId, 'Competition', competition);
      }
      if (reason !== String(fix.reasonNotSold || '')) {
        await setOppField(user?.uid, fix.oppId, 'Reason Not Sold', reason);
      }
      setEditingRow(null);
    } catch (err) {
      setFixError(`Could not save: ${err?.message || err}`);
    } finally {
      setSavingFix(false);
    }
  }

  const columns = useMemo(() => [
    {
      key: 'source', label: 'Area', defaultWidth: 120,
      getFilterValue: (row) => row.source || '',
      render: (row) => (
        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#EEF2FF', color: '#3730A3' }}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'type', label: 'Issue', defaultWidth: 180,
      getFilterValue: (row) => row.type || '',
      render: (row) => <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.type}</span>,
    },
    {
      key: 'company', label: 'Client', defaultWidth: 240,
      getFilterValue: (row) => row.company || '',
      render: (row) => {
        if (!row.prospectId || !onSelectProspect) {
          return <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company}</span>;
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const p = prospectById.get(row.prospectId);
              if (p) onSelectProspect(p);
            }}
            title="Open this account"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600, color: '#0A66C2', textAlign: 'left' }}
          >
            {row.company}
          </button>
        );
      },
    },
    {
      key: 'clientManager', label: 'Client Manager', defaultWidth: 180,
      getFilterValue: (row) => managerMap[normClientName(row.company)] || '',
      getSortValue: (row) => (managerMap[normClientName(row.company)] || '').toLowerCase(),
      render: (row) => {
        const name = managerMap[normClientName(row.company)] || '';
        return name
          ? <span style={{ color: '#334155' }}>{name}</span>
          : <span style={{ color: '#94A3B8' }}>-</span>;
      },
    },
    {
      key: 'daysUntil', label: 'Days Until', defaultWidth: 110,
      getSortValue: (row) => row.daysUntil == null ? null : row.daysUntil,
      render: (row) => {
        if (row.daysUntil == null) return <span style={{ color: '#94A3B8' }}>-</span>;
        return (
          <span style={{ color: '#B91C1C', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {row.daysUntil}
          </span>
        );
      },
    },
    {
      key: 'expirationDate', label: 'Expiration', defaultWidth: 130,
      getSortValue: (row) => row.expirationDate ? row.expirationDate.getTime() : null,
      render: (row) => (
        <span style={{ color: row.expirationDate ? '#334155' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {row.expirationDate ? fmtDate(row.expirationDate) : '-'}
        </span>
      ),
    },
    {
      key: 'detail', label: 'Details', defaultWidth: 420,
      getFilterValue: (row) => row.detail || '',
      render: (row) => <span style={{ color: '#475569' }}>{row.detail}</span>,
    },
    {
      // Only "Close Not Sold missing data" rows carry an editable pair;
      // every other issue type shows a dash. Sorts / filters on the
      // current value so the unset ones can be pulled to the top.
      key: 'reasonNotSold', label: 'Reason Not Sold', defaultWidth: 175,
      getFilterValue: (row) => row.closeNotSold?.reasonNotSold || '',
      getSortValue: (row) => (row.closeNotSold?.reasonNotSold || '').toLowerCase(),
      render: (row) => {
        const fix = row.closeNotSold;
        if (!fix) return <span style={{ color: '#94A3B8' }}>-</span>;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFixError(''); setEditingRow(row); }}
            title="Update Reason Not Sold / Competition on the Opps row"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
              padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, textAlign: 'left',
              border: '1px solid #CBD5E1', background: '#fff',
              color: fix.reasonNotSold ? '#334155' : '#B91C1C',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fix.reasonNotSold || 'Not set'}
            </span>
            <span aria-hidden="true" style={{ color: '#0A66C2' }}>✎</span>
          </button>
        );
      },
    },
    {
      key: 'snooze', label: 'Snooze', defaultWidth: 110,
      getFilterValue: (row) => (row.snoozed ? 'Snoozed' : 'Active'),
      getSortValue: (row) => (row.snoozed ? 1 : 0),
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIssueSnoozed(row.id, !row.snoozed);
          }}
          title={row.snoozed ? 'Snoozed: not counted on the menu. Click to un-snooze.' : 'Snooze this issue so it stops counting on the menu'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 10px', borderRadius: 999, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
            border: row.snoozed ? '1px solid #CBD5E1' : '1px solid #FCA5A5',
            background: row.snoozed ? '#F1F5F9' : '#FEF2F2',
            color: row.snoozed ? '#475569' : '#B91C1C',
          }}
        >
          {row.snoozed ? '🔕 Snoozed' : '🔔 Snooze'}
        </button>
      ),
    },
  ], [onSelectProspect, prospectById, managerMap]);


  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Issues</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          Outstanding items that need to be addressed
          {cdmName ? ` for ${cdmName}` : ''}. {openCount} open issue{openCount === 1 ? '' : 's'}
          {issues.length - openCount > 0 ? `, ${issues.length - openCount} snoozed` : ''}.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 0.25rem' }}>
        {issues.length === 0 ? (
          <div style={{ margin: '0.5rem 1.25rem', padding: '1.5rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.35rem' }}>No outstanding issues 🎉</div>
            <div style={{ fontSize: '0.78rem' }}>
              Issues appear here automatically. The first one tracked is a client on the Clients tab whose soonest contract End Date has already passed (a negative <strong>Days Until</strong>).
            </div>
          </div>
        ) : (
          <DataTable
            tableId="issues"
            columns={columns}
            rows={issues}
            defaultSort={{ key: 'daysUntil', direction: 'asc' }}
            emptyMessage="No issues to display"
            enableColumnFilters
            rowStyle={(row) => (row.snoozed ? { opacity: 0.5 } : undefined)}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {editingRow && (
        <CloseNotSoldReasonModal
          // Remount when a different issue is opened so the selects
          // re-seed from that row's values.
          key={editingRow.id}
          row={editingRow}
          reasonOptions={reasonOptions}
          competitionOptions={competitionOptions}
          saving={savingFix}
          error={fixError}
          onSave={saveCloseNotSoldFix}
          onClose={() => { if (!savingFix) { setEditingRow(null); setFixError(''); } }}
        />
      )}
    </div>
  );
}
