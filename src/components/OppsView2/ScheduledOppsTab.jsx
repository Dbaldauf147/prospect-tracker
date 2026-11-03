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
      dueDate: e.dueDate,
      dueTime: e.dueTime,
      when: formatScheduledOppWhen(e),
      scope: e.scope || '',
      notes: e.notes || '',
      source: e.source || '',
      type: e.type || '',
      peOwner: e.peOwner || '',
      pullThrough: e.pullThrough ? 'Yes' : 'No',
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : '',
    }));
}

export function ScheduledOppsTab({ entries = [], onChangeEntry, onCreateNow, onCancelEntry, settings, updateSettings }) {
  const rows = useMemo(() => scheduledOppTableRows(entries), [entries]);

  const columns = useMemo(() => [
    { key: 'company', label: 'Company', render: (r) => <strong>{r.company || '(no company)'}</strong> },
    {
      key: 'dueDate',
      label: 'Start Date',
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
    { key: 'when', label: 'Creates' },
    { key: 'scope', label: 'Services' },
    { key: 'notes', label: 'Notes', render: (r) => <span style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</span> },
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
            title="Create this opp right now instead of waiting for its start date"
          >Create now</button>
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              if (window.confirm(`Cancel the scheduled opp for ${r.company || 'this company'}? No row will be created.`)) onCancelEntry(r.id);
            }}
            style={actionBtn('#dc2626')}
            title="Drop this scheduled opp: no row is ever created"
          >Cancel</button>
        </span>
      ),
    },
  ], [onChangeEntry, onCreateNow, onCancelEntry]);

  return (
    <>
      <div style={{ padding: '0.5rem 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {rows.length} scheduled opp{rows.length === 1 ? '' : 's'} not created yet. Each one is added to the Opps table the first time this page is open at or after its start date and time (Eastern). Change the date here to move it.
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
