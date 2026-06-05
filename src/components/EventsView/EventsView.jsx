// Events subtab — event-centric attendee lists. Each event holds a
// name / date / location / notes plus a saved list of attendees. The
// attendee picker searches the synced HubSpot contacts cache (the same
// roster the other Contacts subtabs read from) so you can build the
// list straight from your contacts; people who aren't in HubSpot can be
// added as free-text "manual" attendees.
//
// Events persist in Firestore settings under `settings.events`, so they
// sync across devices the same way the per-contact Events log, contact
// notes, and the other Contacts-page settings do.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { attendeeFromContact, contactDisplayName } from '../../utils/eventsStore';
import styles from './EventsView.module.css';

function newId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  // iso is a yyyy-mm-dd string from <input type="date">. Render it
  // without going through Date() so timezones don't shift the day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Search box that surfaces matching HubSpot contacts and lets the user
// add either a matched contact or a free-text manual attendee.
function AttendeePicker({ contacts, existingIds, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const c of contacts) {
      const id = String(c.id || c.vid || '');
      if (!id || existingIds.has(id)) continue;
      const hay = `${contactDisplayName(c)} ${c.email || ''} ${c.company || ''} ${c.jobtitle || ''}`.toLowerCase();
      if (hay.includes(q)) out.push(c);
      if (out.length >= 40) break;
    }
    return out;
  }, [query, contacts, existingIds]);

  function addContact(c) {
    onAdd(attendeeFromContact(c));
    setQuery('');
    setOpen(false);
  }

  function addManual() {
    const name = query.trim();
    if (!name) return;
    onAdd({ contactId: '', name, email: '', company: '', title: '' });
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={styles.picker} ref={wrapRef}>
      <input
        className={styles.input}
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={query}
        placeholder="Search contacts by name, email, or company to add…"
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) addContact(matches[0]);
            else addManual();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && query.trim() && (
        <div className={styles.dropdown}>
          {matches.map(c => (
            <button
              key={String(c.id || c.vid)}
              type="button"
              className={styles.option}
              onClick={() => addContact(c)}
            >
              <div className={styles.optionName}>{contactDisplayName(c)}</div>
              <div className={styles.optionMeta}>
                {[c.jobtitle, c.company, c.email].filter(Boolean).join(' · ') || '—'}
              </div>
            </button>
          ))}
          <button
            type="button"
            className={`${styles.option} ${styles.addManual}`}
            onClick={addManual}
          >
            + Add "{query.trim()}" as a manual attendee
          </button>
        </div>
      )}
    </div>
  );
}

export function EventsView({ settings = {}, updateSettings = () => {} }) {
  const events = useMemo(
    () => (Array.isArray(settings?.events) ? settings.events : []),
    [settings?.events],
  );
  const [selectedId, setSelectedId] = useState(null);

  // Mirror of the synced HubSpot contacts cache, refreshed when the
  // cache-updated event fires (e.g. after the Refresh contacts button).
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Keep a valid selection: default to the first event, and recover if
  // the selected event is deleted.
  useEffect(() => {
    if (events.length === 0) { if (selectedId !== null) setSelectedId(null); return; }
    if (!events.some(e => e.id === selectedId)) setSelectedId(events[0].id);
  }, [events, selectedId]);

  const selected = events.find(e => e.id === selectedId) || null;

  function saveEvents(next) {
    updateSettings({ events: next });
  }

  function createEvent() {
    const ev = { id: newId(), name: 'New Event', date: '', location: '', notes: '', attendees: [] };
    saveEvents([ev, ...events]);
    setSelectedId(ev.id);
  }

  function updateEvent(id, patch) {
    saveEvents(events.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }

  function deleteEvent(id) {
    const ev = events.find(e => e.id === id);
    if (ev && !window.confirm(`Delete event "${ev.name || 'Untitled'}" and its attendee list?`)) return;
    saveEvents(events.filter(e => e.id !== id));
  }

  function addAttendee(attendee) {
    if (!selected) return;
    // De-dupe HubSpot contacts by id; manual attendees by lowercased name.
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const dup = attendee.contactId
      ? list.some(a => a.contactId && a.contactId === attendee.contactId)
      : list.some(a => !a.contactId && a.name.toLowerCase() === attendee.name.toLowerCase());
    if (dup) return;
    updateEvent(selected.id, { attendees: [...list, attendee] });
  }

  function removeAttendee(index) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    updateEvent(selected.id, { attendees: list.filter((_, i) => i !== index) });
  }

  function exportAttendeesCsv() {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = ['Name', 'Title', 'Company', 'Email'];
    const rows = list.map(a => [a.name, a.title, a.company, a.email].map(escape).join(','));
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (selected.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    a.download = `${slug}-attendees.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const existingIds = useMemo(() => {
    const set = new Set();
    for (const a of (selected?.attendees || [])) if (a.contactId) set.add(a.contactId);
    return set;
  }, [selected]);

  const attendees = selected && Array.isArray(selected.attendees) ? selected.attendees : [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Events</span>
          <button type="button" className={styles.newBtn} onClick={createEvent}>+ New</button>
        </div>
        <div className={styles.eventList}>
          {events.length === 0 && (
            <div style={{ padding: '0.75rem 0.6rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              No events yet. Click <strong>+ New</strong> to create one.
            </div>
          )}
          {events.map(ev => {
            const count = Array.isArray(ev.attendees) ? ev.attendees.length : 0;
            return (
              <button
                key={ev.id}
                type="button"
                className={ev.id === selectedId ? styles.eventItemActive : styles.eventItem}
                onClick={() => setSelectedId(ev.id)}
              >
                <div className={styles.eventItemName}>{ev.name || 'Untitled event'}</div>
                <div className={styles.eventItemMeta}>
                  {[formatDate(ev.date), `${count} attendee${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!selected ? (
        <div className={styles.empty}>
          Select an event on the left, or create a new one to start saving its attendee list.
        </div>
      ) : (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <input
              className={`${styles.input} ${styles.nameInput}`}
              style={{ flex: 1, border: 'none', background: 'none', padding: '0.2rem 0' }}
              value={selected.name}
              placeholder="Event name"
              onChange={e => updateEvent(selected.id, { name: e.target.value })}
            />
            <button type="button" className={styles.deleteBtn} onClick={() => deleteEvent(selected.id)}>
              Delete event
            </button>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Date</span>
              <input
                type="date"
                className={styles.input}
                value={selected.date || ''}
                onChange={e => updateEvent(selected.id, { date: e.target.value })}
              />
            </label>
            <label className={styles.field} style={{ flex: 1, minWidth: 180 }}>
              <span className={styles.fieldLabel}>Location</span>
              <input
                className={styles.input}
                value={selected.location || ''}
                placeholder="City, venue, virtual…"
                onChange={e => updateEvent(selected.id, { location: e.target.value })}
              />
            </label>
          </div>

          <label className={styles.field} style={{ display: 'block', marginBottom: '0.5rem' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <textarea
              className={styles.textarea}
              style={{ width: '100%', boxSizing: 'border-box', marginTop: '0.2rem' }}
              value={selected.notes || ''}
              placeholder="Agenda, takeaways, follow-ups…"
              onChange={e => updateEvent(selected.id, { notes: e.target.value })}
            />
          </label>

          <div className={styles.sectionTitle}>
            Attendees
            <span className={styles.countPill}>{attendees.length}</span>
            {attendees.length > 0 && (
              <button type="button" className={styles.exportBtn} onClick={exportAttendeesCsv}>
                Export CSV
              </button>
            )}
          </div>

          <AttendeePicker contacts={contacts} existingIds={existingIds} onAdd={addAttendee} />

          {attendees.length === 0 ? (
            <div className={styles.emptyAttendees}>
              No attendees saved yet. Use the search box above to add contacts.
            </div>
          ) : (
            <table className={styles.attendeeTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {attendees.map((a, i) => (
                  <tr key={`${a.contactId || 'manual'}-${i}`}>
                    <td>
                      {a.name}
                      {!a.contactId && (
                        <span style={{ marginLeft: 6, fontSize: '0.64rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          (manual)
                        </span>
                      )}
                    </td>
                    <td>{a.title || '—'}</td>
                    <td>{a.company || '—'}</td>
                    <td>{a.email || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={styles.removeBtn} onClick={() => removeAttendee(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
