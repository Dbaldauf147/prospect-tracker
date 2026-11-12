import { useMemo, useState } from 'react';
import { isContactInEvent, eventsNewestFirst } from '../../utils/eventsStore';

// The contact popup's Events field: which of the Events page's events this
// person went to. The ones they're on come first (green, ticked), then the
// rest newest first; click a chip to tag or untag. The box above filters
// the chips, and a name that isn't an event yet can be added on the spot,
// with its date, already tagged with this contact.
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], { month: 'short', year: 'numeric' });
};
const inputStyle = { padding: '0.25rem 0.45rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.74rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' };

export function ContactEventsField({ events = [], contact, cid, onToggle, onAdd }) {
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const sorted = useMemo(() => {
    const all = eventsNewestFirst(events);
    return [...all.filter(ev => isContactInEvent(ev, cid)), ...all.filter(ev => !isContactInEvent(ev, cid))];
  }, [events, cid]);
  const typed = q.trim();
  const needle = typed.toLowerCase();
  const shown = needle ? sorted.filter(ev => String(ev.name || '').toLowerCase().includes(needle)) : sorted;
  const exact = sorted.some(ev => String(ev.name || '').trim().toLowerCase() === needle);
  const canAdd = !!onAdd && !!typed && !exact;
  const add = () => {
    if (!canAdd) return;
    onAdd({ name: typed, date }, contact);
    setQ('');
    setDate('');
  };

  if (!cid) return <div style={{ fontSize: '0.72rem', color: '#94A3B8', padding: '0.3rem 0' }}>Save the contact first to add them to events.</div>;
  const taggedCount = sorted.filter(ev => isContactInEvent(ev, cid)).length;
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
              style={{ padding: '0.25rem 0.6rem', borderRadius: 4, border: '1px solid #16A34A', background: '#16A34A', color: '#fff', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >+ Add &ldquo;{typed}&rdquo;</button>
          </>
        )}
      </div>
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem', maxHeight: 120, overflowY: 'auto' }}>
          {shown.map(ev => {
            const inEvent = isContactInEvent(ev, cid);
            const when = fmtDate(ev.date);
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onToggle && onToggle(ev.id, contact)}
                title={`${inEvent ? 'Went to this event. Click to remove.' : 'Click if they went to this event.'}${ev.date ? ` (${ev.date})` : ''}`}
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
                {ev.name || 'Untitled event'}
                {when && <span style={{ fontWeight: 400, color: inEvent ? '#15803D' : '#94A3B8' }}>{when}</span>}
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
    </div>
  );
}
