// The popup behind a service's status on the company card's Services board:
// where that status came from. An opp-fed status lists the opps whose Scope
// names the service, with the one(s) setting it marked; a status set by hand
// shows the service's note (the pencil note on the row), and still lists any
// opps naming the service, since those are what "- (auto)" would go back to.
//
// The status itself is changed here too, so the row's status is one button
// rather than a dropdown that has no room to explain itself.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { EDIT_SERVICE_STATUSES } from '../../utils/serviceStatusList';
import { serviceStatusSourceKind } from '../../utils/serviceStatusSource';

// Note text carries the editor's @-tokens: @[Service] and @![Competitor].
function plainNote(text) {
  return String(text || '').replace(/@!?\[([^\]]+)\]/g, '@$1').trim();
}

const sectionHead = { fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: '#475569', marginBottom: '0.35rem' };
const th = { padding: '0.2rem 0.35rem', fontWeight: 600, fontSize: '0.66rem', color: '#64748B', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '0.3rem 0.35rem', verticalAlign: 'top' };
const muted = { color: '#CBD5E1' };

export default function ServiceStatusSourcePopup({
  label,
  manualStatus,
  oppStage,
  autoNaText = '',
  categoryNaText = '',
  opps,
  oppsLoaded = true,
  note,
  statuses,
  colorOf,
  oppColorOf,
  onSetStatus,
  onEditStatuses,
  onEditNote,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const kind = serviceStatusSourceKind({ manual: manualStatus, oppStage, autoNa: autoNaText, categoryNa: categoryNaText });
  const effective = kind === 'manual' ? manualStatus : kind === 'opp' ? oppStage : kind === 'none' ? '' : 'N/A';
  const colors = colorOf(effective) || {};
  const feeding = opps.filter(o => o.feeds).length;
  const noteText = plainNote(note);

  const source = {
    manual: 'Set by hand.',
    opp: `From ${feeding === 1 ? 'the opp' : `${feeding} opps`} below whose Scope names this service.`,
    'auto-na': autoNaText,
    'category-na': categoryNaText,
    none: 'No status set by hand and no opp names this service.',
  }[kind];

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-label={`${label} status`}
        style={{ background: 'var(--color-surface, #fff)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', width: 'min(640px, 100%)', maxHeight: '85vh', overflowY: 'auto', fontSize: '0.8rem', color: 'var(--color-text, #1E293B)' }}
      >
        <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--color-border, #E2E8F0)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1E40AF' }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: 4, flexWrap: 'wrap' }}>
              <span data-status-source={kind} style={{ fontSize: '0.72rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: colors.bg || '#F1F5F9', color: colors.color || '#475569' }}>
                {effective || 'No status'}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{source}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#94A3B8', lineHeight: 1 }}>&times;</button>
        </div>

        {kind === 'manual' && (
          <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
            <div style={sectionHead}>Note</div>
            {noteText ? (
              <div data-service-note style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, padding: '0.4rem 0.55rem', color: '#78350F' }}>{noteText}</div>
            ) : (
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>No note on this service.</div>
            )}
            <button
              type="button"
              onClick={onEditNote}
              style={{ marginTop: '0.4rem', fontSize: '0.7rem', fontFamily: 'inherit', padding: '0.2rem 0.55rem', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer' }}
            >{noteText ? 'Edit note' : 'Add a note'}</button>
          </div>
        )}

        <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
          <div style={sectionHead}>
            {kind === 'opp' ? 'Opps behind this status' : 'Opps naming this service'}
          </div>
          {!oppsLoaded ? (
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>Opps aren&rsquo;t loaded in this browser yet - open the Opps tab once and they&rsquo;ll show here.</div>
          ) : opps.length === 0 ? (
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>No opp at this company has this service in its Scope.</div>
          ) : (
            <>
              {kind === 'manual' && (
                <div style={{ fontSize: '0.7rem', color: '#64748B', marginBottom: '0.35rem' }}>
                  The status set by hand overrides these. Without it the status would be {oppStage}.
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr>
                      <th style={th}>Opportunity</th>
                      <th style={th}>Stage</th>
                      <th style={th}>Scope</th>
                      <th style={{ ...th, textAlign: 'right' }}>Deal Size</th>
                      <th style={th}>Started</th>
                      <th style={th}>Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opps.map(o => {
                      const c = oppColorOf(o.stage) || {};
                      const sets = o.feeds && kind === 'opp';
                      return (
                        <tr key={o.id} data-feeds={o.feeds ? 'yes' : 'no'} style={{ borderTop: '1px solid var(--color-border-light, #F1F5F9)', background: sets ? '#F0F9FF' : 'transparent' }}>
                          <td style={{ ...td, fontWeight: 600 }}>
                            {o.name || o.scope || <span style={{ color: '#94A3B8', fontWeight: 400 }}>Unnamed opp</span>}
                            {sets && <span title="This opp's stage is the status shown" style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 700, color: '#0369A1', whiteSpace: 'nowrap' }}>SETS STATUS</span>}
                          </td>
                          <td style={td}>
                            {o.stage
                              ? <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap', background: c.bg, color: c.color }}>{o.stage}</span>
                              : <span style={muted}>-</span>}
                          </td>
                          <td style={{ ...td, color: '#475569' }}>{o.scope || <span style={muted}>-</span>}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#475569', whiteSpace: 'nowrap' }}>{o.amount || <span style={muted}>-</span>}</td>
                          <td style={{ ...td, color: '#64748B', whiteSpace: 'nowrap' }}>{o.startDate || <span style={muted}>-</span>}</td>
                          <td style={{ ...td, color: '#64748B', whiteSpace: 'nowrap' }}>{o.closeDate || <span style={muted}>-</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem' }}>Status</span>
          <select
            value={kind === 'manual' ? manualStatus : '-'}
            onChange={(e) => {
              if (e.target.value === EDIT_SERVICE_STATUSES) { onEditStatuses(); return; }
              onSetStatus(e.target.value);
            }}
            aria-label={`Status for ${label}`}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.3rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
          >
            {kind === 'manual' && !statuses.includes(manualStatus) && <option value={manualStatus}>{manualStatus}</option>}
            {statuses.map(s => <option key={s} value={s}>{s === '-' ? `- (auto${kind !== 'manual' && effective ? `: ${effective}` : ''})` : s}</option>)}
            <option value={EDIT_SERVICE_STATUSES}>Edit statuses...</option>
          </select>
          {kind === 'manual' && (
            <button
              type="button"
              onClick={() => onSetStatus('-')}
              style={{ fontSize: '0.7rem', fontFamily: 'inherit', padding: '0.2rem 0.55rem', borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer' }}
            >↺ Back to automatic</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
