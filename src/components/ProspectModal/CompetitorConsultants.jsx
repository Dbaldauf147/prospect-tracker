// A competitor consultant on a company card: somebody at another firm who
// works with this company (utils/competitorConsultants). Tracker only, on
// the company's own record; never HubSpot.
//   CompetitorConsultantForm  the fields, shown inside the New Contact popup
//                             when "Competitor consultant" is ticked
import { useState } from 'react';
import { blankConsultant, consultantIsEmpty } from '../../utils/competitorConsultants';

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
