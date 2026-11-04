import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import styles from './PipelineEvents.module.css';
import { newEventId as newId, fmtEventDate as fmtDate, todayIso } from '../../utils/pipelineEvents';

// Events table near the bottom of the Pipeline page: the events the user is
// going to (or prospecting around), each with its date. Rows live on the
// Pipeline state (state.events) so they save and sync with the rest of the
// page. Each row: { id, name, date } with date as 'YYYY-MM-DD' or ''.

// Typed into a draft and committed on blur / Enter.
function NameInput({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };
  return (
    <input
      className={styles.cellInput}
      value={draft}
      aria-label="Event"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

export function PipelineEvents({ events = [], setEvents, settings, updateSettings }) {
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');

  const patchRow = (id, patch) => setEvents(list => list.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const addEvent = () => {
    const name = newName.trim();
    if (!name) return;
    setEvents(list => [...list, { id: newId(), name, date: newDate }]);
    setNewName('');
    setNewDate('');
  };

  const removeRow = (row) => {
    if (!window.confirm(`Remove "${row.name}" from Events?`)) return;
    setEvents(list => list.filter(r => r.id !== row.id));
  };

  const today = todayIso();
  const upcoming = events.filter(r => r.date && r.date >= today).length;

  const columns = useMemo(() => [
    {
      key: 'name',
      label: 'Event',
      defaultWidth: 340,
      getSortValue: (row) => row.name.toLowerCase(),
      getFilterValue: (row) => row.name,
      exportValue: (row) => row.name,
      render: (row) => <NameInput value={row.name} onSave={(name) => patchRow(row.id, { name })} />,
    },
    {
      key: 'date',
      label: 'Date',
      defaultWidth: 160,
      // As a number (20261203): DataTable compares numerically when it can,
      // and '2026-12-03' would read as just 2026. Undated rows return null,
      // which DataTable keeps last in either direction.
      getSortValue: (row) => (row.date ? Number(row.date.replace(/-/g, '')) : null),
      getFilterValue: (row) => fmtDate(row.date),
      exportValue: (row) => row.date,
      render: (row) => (
        <input
          type="date"
          className={`${styles.cellInput} ${row.date && row.date < today ? styles.past : ''}`}
          value={row.date}
          aria-label="Event date"
          title={row.date && row.date < today ? 'This event has passed' : undefined}
          onChange={e => patchRow(row.id, { date: e.target.value })}
        />
      ),
    },
    {
      key: '__remove__',
      label: 'Remove',
      defaultWidth: 96,
      render: (row) => (
        <button type="button" className={styles.removeBtn} onClick={() => removeRow(row)} title="Remove this event">
          Remove
        </button>
      ),
    },
  // patchRow / removeRow go through setEvents; `today` only changes daily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [today]);

  return (
    <div className={styles.body}>
      <form className={styles.addRow} onSubmit={e => { e.preventDefault(); addEvent(); }}>
        <input
          className={styles.addInput}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New event"
          aria-label="New event"
        />
        <input
          type="date"
          className={styles.addDate}
          value={newDate}
          onChange={e => setNewDate(e.target.value)}
          aria-label="New event date"
        />
        <button type="submit" className={styles.addBtn} disabled={!newName.trim()}>Add</button>
        <span className={styles.count}>
          {events.length} event{events.length === 1 ? '' : 's'}, {upcoming} upcoming
        </span>
      </form>

      {/* DataTable's scroll body is flex: 1 1 0, so it needs a parent with
          a height. Sized to the rows (capped). */}
      <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(560, 160 + Math.max(1, events.length) * 40) }}>
        <DataTable
          tableId="pipeline-events"
          columns={columns}
          rows={events}
          alwaysVisible={['name']}
          defaultSort={{ key: 'date', direction: 'asc' }}
          emptyMessage="No events yet. Add one above."
          exportFileName="Pipeline events"
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
