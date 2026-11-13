// Scheduled subtab: the queue of New Opp payloads that haven't been
// created yet, as a table.
//
// Same entries the Scheduled Opps toolbar modal manages (settings.
// scheduledOpps), filtered to the still-pending ones. The start date and
// time are edited in place; a change goes through the same
// onChangeEntry the modal uses, so the minute tick on the Opps tab picks
// up the new due time without anything else knowing this table exists.
import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import {
  formatScheduledOppWhen,
  scheduledOppDueMs,
  scheduledOppPending,
  isCheckBackEntry,
} from '../../utils/scheduledOpps';

const inputStyle = {
  padding: '0.15rem 0.3rem', border: '1px solid var(--color-border)', borderRadius: 4,
  fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', color: 'var(--color-text)',
};

const actionBtn = (accent) => ({
  padding: '0.15rem 0.5rem', background: 'transparent',
  border: `1px solid ${accent}`, borderRadius: 4,
  fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
  color: accent, cursor: 'pointer', whiteSpace: 'nowrap',
});

function formatCreated(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// The pending entries as flat rows. Plain values on each key so sorting
// and the column filters work on what the cell shows; `__entry` carries
// the original for the editors and buttons.
function scheduledOppTableRows(entries = []) {
  return entries
    .filter(scheduledOppPending)
    .sort((a, b) => (scheduledOppDueMs(a) || 0) - (scheduledOppDueMs(b) || 0))
    .map(e => ({
      id: e.id,
      _id: e.id,
      __entry: e,
      company: e.company || '',
      // A New Opp waiting to be created, or a Not Sold opp waiting to come
      // back into the Call In (utils/scheduledOpps, check-back entries).
      kind: isCheckBackEntry(e) ? 'Check back' : 'New opp',
      dueDate: e.dueDate,
      dueTime: e.dueTime,
      when: formatScheduledOppWhen(e),
      scope: e.scope || '',
      notes: e.notes || '',
      source: e.source || '',
      type: e.type || '',
      peOwner: e.peOwner || '',
      pullThrough: isCheckBackEntry(e) ? '' : (e.pullThrough ? 'Yes' : 'No'),
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : '',
    }));
}

export function ScheduledOppsTab({ entries = [], onChangeEntry, onCreateNow, onCancelEntry, settings, updateSettings }) {
  const rows = useMemo(() => scheduledOppTableRows(entries), [entries]);

  const columns = useMemo(() => [
    { key: 'company', label: 'Company', render: (r) => <strong>{r.company || '(no company)'}</strong> },
    {
      key: 'kind',
      label: 'What',
      headerTitle: 'New opp: created on the date. Check back: a Not Sold opp that goes back in the Call In on the date, with its note on Loss Notes.',
      render: (r) => (r.kind === 'Check back'
        ? <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap' }}>Check back</span>
        : r.kind),
    },
    {
      key: 'dueDate',
      label: 'Date',
      render: (r) => (
        <input
          type="date"
          value={r.dueDate}
          onClick={(ev) => ev.stopPropagation()}
          // An empty value would leave the entry with no due date at all,
          // which normalizeScheduledOpps drops: ignore a cleared field.
          onChange={(ev) => ev.target.value && onChangeEntry(r.id, { dueDate: ev.target.value })}
          style={inputStyle}
          aria-label={`Start date for ${r.company || 'scheduled opp'}`}
        />
      ),
    },
    {
      key: 'dueTime',
      label: 'Time (ET)',
      render: (r) => (
        <input
          type="time"
          value={r.dueTime}
          onClick={(ev) => ev.stopPropagation()}
          onChange={(ev) => ev.target.value && onChangeEntry(r.id, { dueTime: ev.target.value })}
          style={inputStyle}
          aria-label={`Start time for ${r.company || 'scheduled opp'}`}
        />
      ),
    },
    { key: 'when', label: 'When' },
    { key: 'scope', label: 'Services' },
    { key: 'notes', label: 'Notes', headerTitle: 'For a check-back, the note that goes on the opp\'s Loss Notes when it comes back.', render: (r) => <span style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</span> },
    { key: 'source', label: 'Source' },
    { key: 'type', label: 'Type' },
    { key: 'peOwner', label: 'PE Owner' },
    { key: 'pullThrough', label: 'Pull-through' },
    { key: 'createdAt', label: 'Scheduled On', render: (r) => formatCreated(r.__entry.createdAt) },
    {
      key: '_actions',
      label: 'Actions',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onCreateNow(r.id); }}
            style={actionBtn('#2563EB')}
            title={r.kind === 'Check back' ? 'Put this opp back in the Call In today instead of waiting for its date' : 'Create this opp right now instead of waiting for its start date'}
          >{r.kind === 'Check back' ? 'Bring back now' : 'Create now'}</button>
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              const msg = r.kind === 'Check back'
                ? `Cancel the check-back for ${r.company || 'this opp'}? It stays closed and won't come back on its own.`
                : `Cancel the scheduled opp for ${r.company || 'this company'}? No row will be created.`;
              if (window.confirm(msg)) onCancelEntry(r.id);
            }}
            style={actionBtn('#dc2626')}
            title={r.kind === 'Check back' ? 'Drop this check-back: the opp stays closed' : 'Drop this scheduled opp: no row is ever created'}
          >Cancel</button>
        </span>
      ),
    },
  ], [onChangeEntry, onCreateNow, onCancelEntry]);

  return (
    <>
      <div style={{ padding: '0.5rem 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {rows.length} scheduled opp{rows.length === 1 ? '' : 's'} waiting. Each one happens the first time this page is open at or after its date and time (Eastern): a new opp is added to the Opps table, a check-back puts its Not Sold opp back in the Call In. Change the date here to move it.
      </div>
      <DataTable
        tableId="opps2-scheduled"
        columns={columns}
        rows={rows}
        alwaysVisible={['company', 'dueDate', '_actions']}
        enableColumnFilters
        variableRowHeight
        emptyMessage="Nothing scheduled. Use + New Opp and tick Schedule this opp for later to queue one."
        settings={settings}
        updateSettings={updateSettings}
      />
    </>
  );
}
