import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { isContactInEvent, groupEventSeries, eventYear } from '../../utils/eventsStore';

// The contact popup's Events field: which of the Events page's events this
// person went to. An event that recurs (one record per year, "Greenbuild
// 2024", "Greenbuild 2025") is one chip: the ones they went to come first
// (green, ticked, with the years they went), then the rest by their newest
// year. Clicking a chip opens that event's popup: every year of it, whether
// this person went, and a button to mark or unmark each year, plus a way
// to add a year that isn't on the Events page yet. The box above filters
// the chips, and a name that isn't an event yet can be added on the spot,
// with its date, already tagged with this contact.
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};
const inputStyle = { padding: '0.25rem 0.45rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.74rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' };
const btn = (bg, border, color) => ({ padding: '0.25rem 0.6rem', borderRadius: 4, border: `1px solid ${border}`, background: bg, color, fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const YEAR_IN_NAME = /\b(19|20)\d{2}\b/;

// One event's years for this contact.
function EventSeriesPopup({ series, contact, cid, personName, onToggle, onAdd, onClose }) {
  const [date, setDate] = useState('');
  const went = series.events.filter(ev => isContactInEvent(ev, cid));
  // A year that isn't on the Events page yet: named the way this series'
  // records are (with the year when they carry one), dated, and tagged with
  // this contact from the start.
  const newYear = /^(\d{4})-/.exec(date)?.[1] || '';
  const yearTaken = !!newYear && series.events.some(ev => eventYear(ev) === newYear);
  const namesCarryYear = series.events.some(ev => YEAR_IN_NAME.test(String(ev.name || '')));
  const addYear = () => {
    if (!onAdd || !newYear || yearTaken) return;
    onAdd({ name: namesCarryYear ? `${series.label} ${newYear}` : series.label, date }, contact);
    setDate('');
  };
  return createPortal(
    <div
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-label={series.label}
        style={{ width: 'min(520px, 94vw)', maxHeight: '80vh', background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>{series.label}</div>
          <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 2 }}>
            {personName} went {went.length === 0 ? 'to none' : `${went.length} of ${series.events.length}`} {series.events.length === 1 ? 'year' : 'years'}.
          </div>
        </div>
        <div style={{ overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', color: '#64748B', textAlign: 'left' }}>
                {['Year', 'Date', 'Location', 'Attendees', 'Went?'].map(h => (
                  <th key={h} style={{ padding: '0.4rem 0.75rem', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.events.map(ev => {
                const inEvent = isContactInEvent(ev, cid);
                const count = Array.isArray(ev.attendees) ? ev.attendees.length : 0;
                return (
                  <tr key={ev.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.45rem 0.75rem', fontWeight: 700, color: '#0F172A' }} title={ev.name || ''}>{eventYear(ev) || 'No year'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: '#475569', whiteSpace: 'nowrap' }}>{fmtDate(ev.date) || '-'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: '#475569' }}>{ev.location || '-'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: '#475569' }}>{count}</td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => onToggle && onToggle(ev.id, contact)}
                        aria-pressed={inEvent}
                        title={inEvent ? `${personName} went. Click to take them off this year.` : `Click if ${personName} went this year.`}
                        style={inEvent ? btn('#DCFCE7', '#86EFAC', '#166534') : btn('#fff', '#CBD5E1', '#64748B')}
                      >{inEvent ? '✓ Went' : 'Did not go'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          {onAdd && (
            <>
              <span style={{ fontSize: '0.74rem', color: '#475569' }}>Went to another year?</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date of the year to add" style={inputStyle} />
              <button
                type="button"
                onClick={addYear}
                disabled={!newYear || yearTaken}
                title={yearTaken ? `${newYear} is already listed above. Mark it there.` : 'Add this year to the Events page with this contact as an attendee'}
                style={{ ...btn('#16A34A', '#16A34A', '#fff'), opacity: !newYear || yearTaken ? 0.5 : 1, cursor: !newYear || yearTaken ? 'default' : 'pointer' }}
              >{newYear ? `+ Add ${newYear}` : '+ Add year'}</button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" autoFocus onClick={onClose} style={btn('#2563EB', '#2563EB', '#fff')}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ContactEventsField({ events = [], contact, cid, onToggle, onAdd }) {
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const sorted = useMemo(() => {
    const all = groupEventSeries(events);
    const wentTo = (s) => s.events.some(ev => isContactInEvent(ev, cid));
    return [...all.filter(wentTo), ...all.filter(s => !wentTo(s))];
  }, [events, cid]);
  const typed = q.trim();
  const needle = typed.toLowerCase();
  const shown = needle
    ? sorted.filter(s => s.label.toLowerCase().includes(needle) || s.events.some(ev => String(ev.name || '').toLowerCase().includes(needle)))
    : sorted;
  const exact = events.some(ev => String(ev.name || '').trim().toLowerCase() === needle);
  const canAdd = !!onAdd && !!typed && !exact;
  const add = () => {
    if (!canAdd) return;
    onAdd({ name: typed, date }, contact);
    setQ('');
    setDate('');
  };
  const openSeries = openKey ? sorted.find(s => s.key === openKey) : null;
  const personName = [contact?.firstname, contact?.lastname].filter(Boolean).join(' ').trim() || 'This person';

  if (!cid) return <div style={{ fontSize: '0.72rem', color: '#94A3B8', padding: '0.3rem 0' }}>Save the contact first to add them to events.</div>;
  const taggedCount = sorted.filter(s => s.events.some(ev => isContactInEvent(ev, cid))).length;
  return (
    <div style={{ border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', padding: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={events.length ? 'Find an event, or type a new one...' : 'Type an event they went to...'}
          aria-label="Find or add an event"
          style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }}
        />
        {canAdd && (
          <>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Event date" title="When it was (optional)" style={inputStyle} />
            <button
              type="button"
              onClick={add}
              title="Create this event on the Events page with this contact as an attendee"
              style={btn('#16A34A', '#16A34A', '#fff')}
            >+ Add &ldquo;{typed}&rdquo;</button>
          </>
        )}
      </div>
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem', maxHeight: 120, overflowY: 'auto' }}>
          {shown.map(s => {
            const wentYears = s.events.filter(ev => isContactInEvent(ev, cid)).map(ev => eventYear(ev) || 'no year');
            const inEvent = wentYears.length > 0;
            const years = s.events.map(ev => eventYear(ev)).filter(Boolean);
            const span = years.length ? (years.length === 1 ? years[0] : `${years[years.length - 1]}-${years[0]}`) : '';
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setOpenKey(s.key)}
                title={`${inEvent ? `Went: ${wentYears.join(', ')}.` : 'Not tagged on any year.'} Click to see every year of this event and mark which ones they went to.`}
                aria-pressed={inEvent}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.2rem 0.55rem', borderRadius: 999,
                  fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  background: inEvent ? '#DCFCE7' : '#F8FAFC',
                  border: `1px solid ${inEvent ? '#86EFAC' : '#CBD5E1'}`,
                  color: inEvent ? '#166534' : '#475569',
                }}
              >
                <span style={{ fontWeight: 800 }}>{inEvent ? '✓' : '+'}</span>
                {s.label}
                {(inEvent ? wentYears.join(', ') : span) && (
                  <span style={{ fontWeight: 400, color: inEvent ? '#15803D' : '#94A3B8' }}>{inEvent ? wentYears.join(', ') : span}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {needle && shown.length === 0 && !canAdd && (
        <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.3rem' }}>No matching events.</div>
      )}
      {!needle && taggedCount === 0 && events.length > 0 && (
        <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.3rem' }}>Not tagged on any event yet.</div>
      )}
      {openSeries && (
        <EventSeriesPopup
          series={openSeries}
          contact={contact}
          cid={cid}
          personName={personName}
          onToggle={onToggle}
          onAdd={onAdd}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}
