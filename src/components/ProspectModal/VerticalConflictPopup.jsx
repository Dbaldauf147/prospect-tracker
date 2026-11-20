// The choice between a company's Vertical on its card and the one the
// Targets list has for it, laid out side by side in one popup instead of
// a row of small buttons beside the field.
//
// It only collects the choice. The caller owns what each one does, since
// the card's fields, the keep-mine flag and the vertical mapping all live
// on the company popup.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { verticalConflictChoices } from '../../utils/verticalConflictChoices';

export function VerticalConflictPopup({ conflict, suggestion, suggesting = false, onSuggest, onChoose, onClose }) {
  const choices = verticalConflictChoices(conflict, suggestion);
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const pickedChoice = choices.find(c => c.id === picked) || null;
  const btn = { padding: '0.4rem 0.9rem', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' };
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { e.stopPropagation(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a Vertical"
        data-vertical-conflict
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: '1.25rem', width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Which Vertical should this company use?</h3>
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: '#64748B' }}>
              {conflict.company ? <><strong>{conflict.company}</strong>: </> : null}
              the card and the Targets list disagree.
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div role="radiogroup" style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {choices.map(c => {
            const on = picked === c.id;
            return (
              <label
                key={c.id}
                data-choice={c.id}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: 8, cursor: 'pointer', border: `2px solid ${on ? '#2563EB' : '#E2E8F0'}`, background: on ? '#EFF6FF' : '#fff' }}
              >
                <input type="radio" name="vertical-conflict" checked={on} onChange={() => setPicked(c.id)} style={{ marginTop: 3, cursor: 'pointer' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B' }}>{c.label}</span>
                  <span style={{ display: 'block', fontSize: '0.92rem', fontWeight: 700, color: '#0F172A' }}>{c.value}</span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: '0.74rem', lineHeight: 1.4, color: '#475569' }}>{c.detail}</span>
                </span>
              </label>
            );
          })}
        </div>
        {onSuggest && !String(suggestion?.vertical || '').trim() && (
          <div style={{ marginTop: 10, fontSize: '0.74rem', color: suggestion?.error ? '#B91C1C' : '#64748B', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={onSuggest} disabled={suggesting} style={{ ...btn, padding: '0.2rem 0.6rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#475569', cursor: suggesting ? 'wait' : 'pointer' }}>
              {suggesting ? 'Asking Claude...' : 'Ask Claude for a third opinion'}
            </button>
            {suggestion?.error
              ? <span>Couldn&apos;t suggest a vertical: {suggestion.error}</span>
              : suggestion && !suggesting
                ? <span>No vertical on your list fits{suggestion.reason ? `: ${suggestion.reason}` : '.'}</span>
                : null}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ ...btn, border: '1px solid #CBD5E1', background: '#fff', color: '#334155' }}>Cancel</button>
          <button
            type="button"
            disabled={!pickedChoice}
            onClick={() => onChoose(pickedChoice)}
            style={{ ...btn, border: '1px solid #2563EB', background: pickedChoice ? '#2563EB' : '#93C5FD', color: '#fff', cursor: pickedChoice ? 'pointer' : 'not-allowed' }}
          >{pickedChoice ? (pickedChoice.id === 'same' ? 'Map them' : `Use ${pickedChoice.value}`) : 'Choose one'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
