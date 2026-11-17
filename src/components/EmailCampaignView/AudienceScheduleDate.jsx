// The planned send date for one audience of a saved campaign (Clients, Key
// Contacts or Prospects; utils/campaignAudience scheduledFor). Shows
// "Schedule" with no date, or the date as a chip coloured by how close it
// is (red overdue, amber today, blue within a week). Clicking either opens
// the browser's date picker; the x clears it. Once the audience is ticked
// as sent the date has done its job, so the caller stops showing it.
import { useRef } from 'react';
import { scheduleState } from '../../utils/campaignAudience';

const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = (day) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (day) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const STATE_STYLE = {
  overdue: { background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5' },
  today: { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' },
  soon: { background: '#DBEAFE', color: '#1D4ED8', border: '1px solid #93C5FD' },
  later: { background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1' },
};
const STATE_TITLE = { overdue: 'Overdue', today: 'Due today', soon: 'Coming up this week', later: 'Scheduled' };

// `hideEmpty` shows nothing at all without a date (no Schedule button), for
// a table that only reports the dates set elsewhere. `compact` writes the
// date as "Nov 23" (the full date and "Overdue" stay in the hover) for a
// narrow column.
export function AudienceScheduleDate({ value, label, onChange, disabled = false, hideEmpty = false, compact = false }) {
  const inputRef = useRef(null);
  const open = () => {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  const state = scheduleState(value, localToday());
  if (!value && hideEmpty) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={e => onChange?.(e.target.value)}
        aria-label={`Scheduled date for ${label}`}
        tabIndex={-1}
        style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
      />
      {value ? (
        <>
          <button
            type="button"
            onClick={open}
            disabled={disabled}
            title={`${STATE_TITLE[state]}: send to ${label} on ${fmt(value)}. Click to change.`}
            style={{ ...STATE_STYLE[state], padding: '0 6px', borderRadius: 999, font: 'inherit', fontSize: '0.64rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >{compact ? fmtShort(value) : `${state === 'overdue' ? 'Overdue ' : ''}${fmt(value)}`}</button>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange?.('')}
              aria-label={`Clear the scheduled date for ${label}`}
              title="Clear the date"
              style={{ border: 'none', background: 'none', padding: '0 2px', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}
            >{'×'}</button>
          )}
        </>
      ) : !disabled && (
        <button
          type="button"
          onClick={open}
          title={`Pick the date you plan to send this to ${label}`}
          style={{ border: '1px dashed #CBD5E1', background: '#fff', color: '#64748B', padding: '0 6px', borderRadius: 999, font: 'inherit', fontSize: '0.62rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >Schedule</button>
      )}
    </span>
  );
}
