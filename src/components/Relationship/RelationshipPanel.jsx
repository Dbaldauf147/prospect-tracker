// A contact's Relationship Strength, for the Edit HubSpot Contact popup:
// the score with its tier, trend and days since a two-way touch, what each
// component contributed, the latest activity (each one editable), and the
// Log activity button.
//
// Self-contained on purpose: the popup is opened from a dozen pages, and
// this reads everything it needs (useContactRelationship) rather than
// asking each of them to pass it in.

import { useState } from 'react';
import { useContactRelationship } from '../../hooks/useRelationshipStrength';
import { RelationshipBadge } from './RelationshipBadge';
import { LogActivityModal } from './LogActivityModal';
import { RELATIONSHIP_CONFIG, touchPoints, isTwoWay, localDay, touchLabel, OPTION_LABELS, ageLabel, contactKey } from '../../utils/relationshipStrength';
import { saveContactDateAdded } from '../../utils/relationshipLog';

const ADDED_SOURCE = {
  set: 'set by you',
  hubspot: 'created in HubSpot',
  activity: 'first activity on record',
};

// When the relationship started. Defaults to the earlier of HubSpot's
// created date and the first activity; setting it here overrides both
// (an import date can be years after you met). It decides whether the
// relationship reads as New and how many months consistency is out of.
function DateAddedField({ contact, added, ageDays, isNew }) {
  const id = contactKey(contact);
  const [today] = useState(() => localDay(Date.now()));
  if (!id) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '0.45rem', fontSize: '0.7rem', color: '#475569' }}>
      <label htmlFor={`date-added-${id}`} style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date added</label>
      <input
        id={`date-added-${id}`}
        type="date"
        value={added?.day || ''}
        max={today}
        onChange={e => saveContactDateAdded(id, e.target.value)}
        style={{ padding: '0.15rem 0.35rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'inherit' }}
        title="When this relationship started. Defaults to the earlier of HubSpot's created date and the first activity; set it if you knew them before either."
      />
      {added && (
        <span>
          {ageLabel(ageDays)} ago, {ADDED_SOURCE[added.source]}
          {isNew && <span style={{ marginLeft: 6, padding: '0 6px', borderRadius: 999, background: '#F5F3FF', color: '#6D28D9', border: '1px solid #C4B5FD', fontWeight: 700, fontSize: '0.62rem' }}>New</span>}
        </span>
      )}
      {added?.source === 'set' && (
        <button type="button" onClick={() => saveContactDateAdded(id, '')} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, padding: 0 }}>Use default</button>
      )}
    </div>
  );
}

const COMPONENTS = [
  { key: 'engagement', label: 'Engagement', weight: RELATIONSHIP_CONFIG.weights.engagement, tip: 'Points per activity, halved every 45 days, over the last 12 months' },
  { key: 'reciprocity', label: 'Reciprocity', weight: RELATIONSHIP_CONFIG.weights.reciprocity, tip: 'Share of two-way activity, plus a bonus for each one they started' },
  { key: 'consistency', label: 'Consistency', weight: RELATIONSHIP_CONFIG.weights.consistency, tip: 'Months with a two-way touch, of the last 6' },
  { key: 'opportunity', label: 'Opportunities', weight: RELATIONSHIP_CONFIG.weights.opportunity, tip: 'Open, won and past opps this contact is named on' },
];

const RECENT_SHOWN = 8;

const fmtShort = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Who a touch came from, as a pill: inbound is the contact reaching out
// (an email they sent you, a call they placed), outbound is you.
function FromPill({ inbound, name }) {
  return inbound ? (
    <span style={{ display: 'inline-block', padding: '0 6px', borderRadius: 999, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap' }}>← From {name}</span>
  ) : (
    <span style={{ display: 'inline-block', padding: '0 6px', borderRadius: 999, background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', fontSize: '0.62rem', fontWeight: 600, whiteSpace: 'nowrap' }}>You →</span>
  );
}

// What hovering a row says: an email's subject and who sent it, so a row
// can be checked against the mailbox without opening HubSpot.
function touchHover(t) {
  if (t.type !== 'email') return t.note || undefined;
  const lines = [];
  lines.push(t.subject ? `Subject: ${t.subject}` : 'Subject: not on record');
  if (t.from) lines.push(`From: ${t.from}`);
  if (t.note) lines.push(t.note);
  if (!t.subject && !t.from && t.source === 'hubspot') lines.push('Open the Activity tab to load the subject and sender.');
  return lines.join('\n');
}

const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function RelationshipPanel({ contact }) {
  const { touches, result, hasFeed } = useContactRelationship(contact);
  const [form, setForm] = useState(null); // { entry } | { touch } | {}
  // The activity list is collapsed each time the popup opens: the score
  // and its components are what the panel is for, the list is the detail
  // behind them, there to check or correct an entry.
  const [showActivity, setShowActivity] = useState(false);
  // Narrow the list to what the contact sent you.
  const [onlyFromThem, setOnlyFromThem] = useState(false);
  if (!contact || (!contact.id && !contact.vid && !contact.email)) return null;
  const name = String(contact.firstname || '').trim() || 'them';
  const fromThemCount = touches.filter(t => t.direction === 'inbound').length;
  const recent = [...touches].reverse()
    .filter(t => !onlyFromThem || t.direction === 'inbound')
    .slice(0, RECENT_SHOWN);

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '1rem', background: '#F8FAFC' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Relationship Strength</span>
        <RelationshipBadge result={result} />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setForm({})}
          style={{ padding: '0.25rem 0.7rem', borderRadius: 6, border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600 }}
        >+ Log activity</button>
      </div>
      <DateAddedField contact={contact} added={result?.added} ageDays={result?.ageDays} isNew={result?.isNew} />
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.35rem 0.9rem', marginTop: '0.5rem' }}>
          {COMPONENTS.map(c => (
            <div key={c.key} title={`${c.tip}. Weight ${Math.round(c.weight * 100)}%.`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: '#475569' }}>
                <span>{c.label}</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{result.components[c.key]}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#E2E8F0', overflow: 'hidden' }}>
                <div style={{ width: `${result.components[c.key]}%`, height: '100%', background: result.tier.fill }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        {touches.length === 0 ? (
          <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
            No activity found with this contact.{hasFeed ? '' : ' HubSpot, Granola and Outlook activity is read from the Activity tab once it has loaded.'}
          </div>
        ) : !showActivity ? (
          <button
            type="button"
            onClick={() => setShowActivity(true)}
            aria-expanded={false}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600 }}
          >▸ Show activity ({touches.length})</button>
        ) : (
          <>
          <button
            type="button"
            onClick={() => setShowActivity(false)}
            aria-expanded
            style={{ background: 'none', border: 'none', padding: 0, marginBottom: 2, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600 }}
          >▾ Hide activity{touches.length > RECENT_SHOWN && !onlyFromThem ? ` (latest ${RECENT_SHOWN} of ${touches.length})` : ''}</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 12, fontSize: '0.66rem', color: '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyFromThem} onChange={e => setOnlyFromThem(e.target.checked)} style={{ margin: 0 }} />
            Only from {name} ({fromThemCount})
          </label>
          {recent.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: '#64748B', padding: '3px 4px' }}>Nothing from {name} on record yet.</div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <tbody>
              {recent.map(t => (
                <tr key={t.id} title={touchHover(t)} style={{ borderTop: '1px solid #EEF2F7', background: t.direction === 'inbound' ? '#F0FDF4' : undefined }}>
                  <td style={{ padding: '3px 4px', color: '#64748B', whiteSpace: 'nowrap' }}>{fmtDay(t.ms)}</td>
                  <td style={{ padding: '3px 4px', fontWeight: 600, color: '#1E293B' }}>{touchLabel(t)}</td>
                  <td style={{ padding: '3px 4px', color: '#475569' }}>
                    <FromPill inbound={t.direction === 'inbound'} name={name} />
                    {t.outcome && t.outcome !== 'held' && <span style={{ marginLeft: 6 }}>{OPTION_LABELS[t.outcome]}</span>}
                    {t.outcome === 'replied' && t.replyMs && <span style={{ marginLeft: 4, color: '#64748B' }}>{fmtShort(t.replyMs)}</span>}
                    {isTwoWay(t) && <span style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 700, color: '#166534' }}>two-way</span>}
                    {t.edited && <span style={{ marginLeft: 6, fontSize: '0.6rem', color: '#7C3AED' }} title="Direction or outcome edited here">edited</span>}
                  </td>
                  <td style={{ padding: '3px 4px', color: '#94A3B8', fontSize: '0.64rem' }}>{({ manual: 'Logged', granola: 'Granola', outlook: 'Outlook' })[t.source] || 'HubSpot'}</td>
                  <td style={{ padding: '3px 4px', textAlign: 'right', color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{touchPoints(t)} pt</td>
                  <td style={{ padding: '3px 4px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setForm(t.source === 'manual' ? { entry: { ...t, ...logEntryFor(t) } } : { touch: t })}
                      style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, padding: 0 }}
                    >Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
      {form && (
        <LogActivityModal
          contact={contact}
          entry={form.entry || null}
          touch={form.touch || null}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}

// A logged touch back into the shape the form edits.
function logEntryFor(t) {
  return { id: t.id, date: localDay(t.ms), note: t.note || '' };
}
