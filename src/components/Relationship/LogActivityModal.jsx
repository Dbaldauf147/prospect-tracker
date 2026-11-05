// The Log activity form: record a meeting, call or email with a contact,
// with its direction and outcome, or correct those on one already there.
//
// Three ways in:
//   new        `contact` given (from a contact's popup) or picked here
//   edit       `entry` - an activity logged here before; every field editable
//   correct    `touch` - a HubSpot activity; only what HubSpot gets wrong
//              (direction, outcome, in person or video) is editable, since
//              the rest is HubSpot's record and comes back on the next pull
//
// Saving writes utils/relationshipLog, which fires the event every score
// listens to, so the score behind the popup moves as soon as this closes.

import { useMemo, useState } from 'react';
import { ContactSuggestInput } from '../common/ContactSuggestInput';
import {
  saveLoggedActivity, deleteLoggedActivity, saveTouchOverride, clearTouchOverride,
} from '../../utils/relationshipLog';
import {
  normalizeTouch, CALL_OUTCOMES, EMAIL_OUTCOMES, MEETING_MEDIUMS, MEETING_OUTCOMES, DIRECTIONS,
  OPTION_LABELS, contactKey, contactEmail, contactName, touchPoints, localDay, logDayMs,
} from '../../utils/relationshipStrength';

const KINDS = [
  { key: 'meeting:in-person', type: 'meeting', medium: 'in-person', label: 'In-person meeting' },
  { key: 'meeting:video', type: 'meeting', medium: 'video', label: 'Video meeting' },
  { key: 'call', type: 'call', label: 'Call' },
  { key: 'email', type: 'email', label: 'Email' },
];

const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 };
const inputStyle = { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' };

function Segmented({ value, options, onChange, disabled = false, name }) {
  return (
    <div role="radiogroup" aria-label={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              padding: '0.28rem 0.7rem', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600,
              cursor: disabled ? 'default' : 'pointer', opacity: disabled && !on ? 0.5 : 1,
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: on ? 'var(--color-accent)' : 'var(--color-surface)',
              color: on ? '#fff' : 'var(--color-text-muted)',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

const opts = (values) => values.map(v => ({ value: v, label: OPTION_LABELS[v] || v }));
const today = () => localDay(Date.now());
const isoDay = (ms) => (Number.isFinite(ms) ? localDay(ms) : today());

export function LogActivityModal({ contact = null, contacts = [], entry = null, touch = null, onClose }) {
  const hubspot = !!touch && touch.source !== 'manual';
  const start = useMemo(() => normalizeTouch(entry ? { ...entry, ms: logDayMs(entry.date) } : touch || { type: 'meeting', medium: 'video' }), [entry, touch]);
  const [picked, setPicked] = useState(contact || (entry ? { id: entry.contactId, email: entry.contactEmail, firstname: entry.contactName, company: entry.company } : null));
  const [query, setQuery] = useState('');
  const [type, setType] = useState(start.type);
  const [medium, setMedium] = useState(start.medium || 'video');
  const [direction, setDirection] = useState(start.direction);
  const [callOutcome, setCallOutcome] = useState(start.type === 'call' ? start.outcome : 'connected');
  const [emailOutcome, setEmailOutcome] = useState(start.type === 'email' && start.outcome ? start.outcome : 'no-reply');
  const [meetingOutcome, setMeetingOutcome] = useState(start.type === 'meeting' ? start.outcome : 'held');
  const [date, setDate] = useState(entry?.date || isoDay(touch?.ms));
  const [note, setNote] = useState(entry?.note || '');

  const kindKey = type === 'meeting' ? `meeting:${medium}` : type;
  const outcome = type === 'call' ? callOutcome : type === 'email' ? (direction === 'inbound' ? '' : emailOutcome) : meetingOutcome;
  const preview = touchPoints(normalizeTouch({ type, direction, outcome, medium, ms: 0 }));
  const canSave = hubspot || !!(picked && (contactKey(picked) || contactEmail(picked)));

  function save() {
    if (!canSave) return;
    if (hubspot) {
      saveTouchOverride(touch.id, { direction, outcome, medium: type === 'meeting' ? medium : '' });
    } else {
      saveLoggedActivity({
        id: entry?.id,
        contactId: contactKey(picked),
        contactEmail: contactEmail(picked),
        contactName: contactName(picked) || picked?.firstname || '',
        company: String(picked?.company || ''),
        type, direction, outcome, medium: type === 'meeting' ? medium : '', date, note,
      });
    }
    onClose?.();
  }

  const title = hubspot ? 'Edit HubSpot activity' : entry ? 'Edit activity' : 'Log activity';
  const who = picked ? (contactName(picked) || picked.firstname || picked.email) : '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { e.stopPropagation(); onClose?.(); }}>
      <div role="dialog" aria-label={title} style={{ background: '#fff', borderRadius: 12, padding: '1.25rem', width: 460, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <span style={labelStyle}>Contact</span>
            {contact || hubspot || entry ? (
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1E293B' }}>
                {who || 'This HubSpot activity'}{picked?.company ? <span style={{ color: '#64748B', fontWeight: 500 }}>{`, ${picked.company}`}</span> : null}
              </div>
            ) : picked ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', fontWeight: 600 }}>
                <span>{who}{picked.company ? <span style={{ color: '#64748B', fontWeight: 500 }}>{`, ${picked.company}`}</span> : null}</span>
                <button type="button" onClick={() => setPicked(null)} style={{ ...inputStyle, width: 'auto', padding: '0.15rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem' }}>Change</button>
              </div>
            ) : (
              <ContactSuggestInput
                value={query}
                onChange={setQuery}
                onPick={(c) => { setPicked(c); setQuery(''); }}
                contacts={contacts}
                placeholder="Type a name, email or company"
                style={inputStyle}
                emptyHint="No contact matches. Activity is logged against a HubSpot contact."
              />
            )}
          </div>

          <div>
            <span style={labelStyle}>Activity</span>
            <Segmented
              name="Activity type"
              value={kindKey}
              disabled={hubspot && type !== 'meeting'}
              options={KINDS.filter(k => !hubspot || k.type === type).map(k => ({ value: k.key, label: k.label }))}
              onChange={(key) => {
                const k = KINDS.find(x => x.key === key);
                setType(k.type);
                if (k.medium) setMedium(k.medium);
              }}
            />
          </div>

          <div>
            <span style={labelStyle}>Direction</span>
            <Segmented
              name="Direction"
              value={direction}
              onChange={setDirection}
              options={DIRECTIONS.map(d => ({ value: d, label: d === 'inbound' ? 'Inbound (they reached out)' : 'Outbound (we reached out)' }))}
            />
          </div>

          {type === 'call' && (
            <div>
              <span style={labelStyle}>Outcome</span>
              <Segmented name="Call outcome" value={callOutcome} onChange={setCallOutcome} options={opts(CALL_OUTCOMES)} />
            </div>
          )}
          {type === 'email' && direction === 'outbound' && (
            <div>
              <span style={labelStyle}>Outcome</span>
              <Segmented name="Email outcome" value={emailOutcome} onChange={setEmailOutcome} options={opts(EMAIL_OUTCOMES)} />
            </div>
          )}
          {type === 'meeting' && (
            <div>
              <span style={labelStyle}>Outcome</span>
              <Segmented name="Meeting outcome" value={meetingOutcome} onChange={setMeetingOutcome} options={opts(MEETING_OUTCOMES)} />
            </div>
          )}

          {!hubspot && (
            <>
              <label>
                <span style={labelStyle}>Date</span>
                <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} style={inputStyle} />
              </label>
              <label>
                <span style={labelStyle}>Note</span>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional" />
              </label>
            </>
          )}

          <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
            Counts as {preview} point{preview === 1 ? '' : 's'} toward engagement, before decay.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', gap: 8 }}>
          <div>
            {entry && (
              <button type="button" onClick={() => { deleteLoggedActivity(entry.id); onClose?.(); }} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>Delete</button>
            )}
            {hubspot && touch.edited && (
              <button type="button" onClick={() => { clearTouchOverride(touch.id); onClose?.(); }} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} title="Go back to what HubSpot recorded">Undo edit</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600 }}>Cancel</button>
            <button type="button" onClick={save} disabled={!canSave} style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: 'none', background: canSave ? 'var(--color-accent)' : '#CBD5E1', color: '#fff', cursor: canSave ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600 }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
