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
import { RELATIONSHIP_CONFIG, touchPoints, isTwoWay, localDay, touchLabel, touchDetail } from '../../utils/relationshipStrength';

const COMPONENTS = [
  { key: 'engagement', label: 'Engagement', weight: RELATIONSHIP_CONFIG.weights.engagement, tip: 'Points per activity, halved every 45 days, over the last 12 months' },
  { key: 'reciprocity', label: 'Reciprocity', weight: RELATIONSHIP_CONFIG.weights.reciprocity, tip: 'Share of two-way activity, plus a bonus for each one they started' },
  { key: 'consistency', label: 'Consistency', weight: RELATIONSHIP_CONFIG.weights.consistency, tip: 'Months with a two-way touch, of the last 6' },
  { key: 'opportunity', label: 'Opportunities', weight: RELATIONSHIP_CONFIG.weights.opportunity, tip: 'Open, won and past opps this contact is named on' },
];

const RECENT_SHOWN = 8;

const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function RelationshipPanel({ contact }) {
  const { touches, result, hasFeed } = useContactRelationship(contact);
  const [form, setForm] = useState(null); // { entry } | { touch } | {}
  if (!contact || (!contact.id && !contact.vid && !contact.email)) return null;
  const recent = [...touches].reverse().slice(0, RECENT_SHOWN);

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
        {recent.length === 0 ? (
          <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
            No activity found with this contact.{hasFeed ? '' : ' HubSpot activity is read from the Activity tab once it has loaded.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <tbody>
              {recent.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid #EEF2F7' }}>
                  <td style={{ padding: '3px 4px', color: '#64748B', whiteSpace: 'nowrap' }}>{fmtDay(t.ms)}</td>
                  <td style={{ padding: '3px 4px', fontWeight: 600, color: '#1E293B' }}>{touchLabel(t)}</td>
                  <td style={{ padding: '3px 4px', color: '#475569' }}>
                    {touchDetail(t)}
                    {isTwoWay(t) && <span style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 700, color: '#166534' }}>two-way</span>}
                    {t.edited && <span style={{ marginLeft: 6, fontSize: '0.6rem', color: '#7C3AED' }} title="Direction or outcome edited here">edited</span>}
                  </td>
                  <td style={{ padding: '3px 4px', color: '#94A3B8', fontSize: '0.64rem' }}>{t.source === 'manual' ? 'Logged' : 'HubSpot'}</td>
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
