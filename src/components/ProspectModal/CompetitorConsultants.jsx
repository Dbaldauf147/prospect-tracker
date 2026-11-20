// A competitor consultant on a company card: somebody at another firm who
// works with this company (utils/competitorConsultants). Tracker only, on
// the company's own record; never HubSpot.
//   CompetitorConsultantForm  the fields, shown inside the New Contact popup
//                             when "Competitor consultant" is ticked
//   CompetitorContactCards    the saved ones, as a strip of cards above the
//                             Contacts tab's roster
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { blankConsultant, consultantIsEmpty, normalizeConsultants, saveConsultant, removeConsultant } from '../../utils/competitorConsultants';

const inputStyle = { width: '100%', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: '#fff' };
const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 2 };
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'First and last name' },
  { key: 'firm', label: 'Firm', placeholder: 'The consultancy they work for' },
  { key: 'title', label: 'Job title' },
  { key: 'email', label: 'Email', placeholder: 'Optional' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin', label: 'LinkedIn URL', placeholder: 'https://www.linkedin.com/in/...' },
  { key: 'service', label: 'What they do here', placeholder: 'e.g. Energy procurement, ESG reporting', span: 2 },
];
export function CompetitorConsultantForm({ initial, company = '', firmOptions = [], onSave, onCancel, saveLabel = 'Save competitor consultant' }) {
  const [c, setC] = useState(() => ({ ...blankConsultant(), ...(initial || {}) }));
  const empty = consultantIsEmpty(c);
  const listId = `cc-firms-${c.id}`;
  const save = () => { if (!empty) onSave(c); };
  return (
    <div data-competitor-consultant-form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
        Somebody at another firm who works with {company ? <strong>{company}</strong> : 'this company'}. Saved on the company in the tracker only:
        not created in HubSpot, and left out of campaigns and contact lists.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
        {FIELDS.map(fd => (
          <label key={fd.key} style={{ gridColumn: fd.span ? `span ${fd.span}` : undefined, minWidth: 0 }}>
            <span style={labelStyle}>{fd.label}</span>
            <input
              type="text"
              value={c[fd.key]}
              placeholder={fd.placeholder || ''}
              aria-label={fd.label}
              list={fd.key === 'firm' ? listId : undefined}
              autoFocus={fd.key === 'name'}
              onChange={e => setC({ ...c, [fd.key]: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              style={inputStyle}
            />
          </label>
        ))}
        <datalist id={listId}>{firmOptions.map(f => <option key={f} value={f} />)}</datalist>
        <label style={{ gridColumn: '1 / -1' }}>
          <span style={labelStyle}>Notes</span>
          <textarea value={c.notes} aria-label="Notes" rows={3} onChange={e => setC({ ...c, notes: e.target.value })} style={{ ...inputStyle, resize: 'vertical' }} />
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: '#64748B' }}>Cancel</button>
        <button
          type="button"
          data-save-competitor-consultant
          onClick={save}
          disabled={empty}
          title={empty ? 'Enter a name or a firm first' : ''}
          style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: 6, background: empty ? '#94A3B8' : '#C2410C', color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', fontWeight: 600, cursor: empty ? 'not-allowed' : 'pointer', opacity: empty ? 0.6 : 1 }}
        >{empty ? 'Name or firm required' : saveLabel}</button>
      </div>
    </div>
  );
}

const href = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try { return new URL(full).href; } catch { return ''; }
};
const cardLink = { color: '#C2410C', fontWeight: 600, textDecoration: 'none' };

// The competitor contacts saved on this company, one card each, above the
// roster. Cards and not rows on purpose: these are people at another firm,
// and in the roster's own format they read as contacts to work. Orange is
// the colour the roster's Competitor badge already uses. Nothing renders
// when there are none, so a company without any loses no room to this.
// Click a card to edit it; the x removes it.
export function CompetitorContactCards({ company = '', consultants, onChange, firmOptions = [] }) {
  const rows = useMemo(() => normalizeConsultants(consultants), [consultants]);
  const [editing, setEditing] = useState(null);
  if (rows.length === 0) return null;
  return (
    <div data-competitor-contact-cards style={{ marginBottom: '0.6rem' }}>
      <div style={{ ...labelStyle, fontSize: '0.7rem', color: '#C2410C', marginBottom: '0.3rem' }}>
        Competitor contacts ({rows.length})
        <span style={{ marginLeft: '0.5rem', fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>
          People at another firm who work with {company || 'this company'}. Tracker only, never in campaigns.
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0.5rem' }}>
        {rows.map(r => {
          const link = href(r.linkedin);
          return (
            <div
              key={r.id}
              data-competitor-contact-card
              role="button"
              tabIndex={0}
              title="Click to edit this competitor contact"
              onClick={() => setEditing(r)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(r); } }}
              style={{ position: 'relative', flex: '0 1 280px', minWidth: 220, maxWidth: 360, boxSizing: 'border-box', padding: '0.5rem 1.6rem 0.5rem 0.7rem', background: '#FFF7ED', border: '1px solid #FED7AA', borderLeft: '4px solid #EA580C', borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', lineHeight: 1.45, color: '#475569' }}
            >
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (window.confirm(`Remove ${r.name || r.firm} from ${company || 'this company'}'s competitor contacts?${r.contactId ? ' They stay on the contact list, without the Competitor badge.' : ''}`)) onChange(removeConsultant(rows, r.id));
                }}
                title="Remove this competitor contact"
                aria-label={`Remove ${r.name || r.firm}`}
                style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', color: '#C2410C', opacity: 0.6, fontSize: '0.95rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >{'\u00D7'}</button>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#1E293B', fontSize: '0.84rem' }}>{r.name || r.firm}</span>
                {r.name && r.firm && <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#C2410C', background: '#fff', border: '1px solid #FDBA74', borderRadius: 999, padding: '0 6px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>{r.firm}</span>}
              </div>
              {r.title && <div>{r.title}</div>}
              {r.service && <div><span style={{ color: '#94A3B8' }}>Does here:</span> {r.service}</div>}
              {(r.email || r.phone || link) && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.74rem' }}>
                  {r.email && <a href={`mailto:${r.email}`} onClick={e => e.stopPropagation()} style={cardLink}>{r.email}</a>}
                  {r.phone && <span>{r.phone}</span>}
                  {link && <a href={link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={cardLink}>LinkedIn {'\u2197'}</a>}
                </div>
              )}
              {r.notes && <div title={r.notes} style={{ marginTop: 2, fontStyle: 'italic', color: '#64748B', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.notes}</div>}
            </div>
          );
        })}
      </div>
      {editing && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div role="dialog" aria-label="Competitor contact" style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 760, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Edit Competitor Contact</h3>
            <CompetitorConsultantForm
              key={editing.id}
              initial={editing}
              company={company}
              firmOptions={firmOptions}
              saveLabel="Save changes"
              onCancel={() => setEditing(null)}
              onSave={(c) => { onChange(saveConsultant(rows, c)); setEditing(null); }}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
