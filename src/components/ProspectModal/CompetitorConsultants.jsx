// Competitor consultants on a company card: people at another firm who
// work with this company (utils/competitorConsultants). Tracker only, on
// the company's own record; never HubSpot.
//   CompetitorConsultantForm      the fields, used here and inside the New
//                                 Contact popup when "Competitor consultant"
//                                 is ticked
//   CompetitorConsultantsSection  the list on the Contacts tab, with add,
//                                 edit and delete
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { blankConsultant, consultantIsEmpty, normalizeConsultants, saveConsultant, removeConsultant } from '../../utils/competitorConsultants';

const inputStyle = { width: '100%', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: '#fff' };
const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 2 };
const dash = <span style={{ color: '#CBD5E1' }}>-</span>;
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'First and last name' },
  { key: 'firm', label: 'Firm', placeholder: 'The consultancy they work for' },
  { key: 'title', label: 'Job title' },
  { key: 'email', label: 'Email', placeholder: 'Optional' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin', label: 'LinkedIn URL', placeholder: 'https://www.linkedin.com/in/...' },
  { key: 'service', label: 'What they do here', placeholder: 'e.g. Energy procurement, ESG reporting', span: 2 },
];
const href = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try { return new URL(full).href; } catch { return ''; }
};

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

export function CompetitorConsultantsSection({ company = '', consultants, onChange, firmOptions = [], settings, updateSettings }) {
  const rows = useMemo(() => normalizeConsultants(consultants), [consultants]);
  // null when closed, else the entry being added or edited.
  const [editing, setEditing] = useState(null);
  const textCol = (key, label, defaultWidth) => ({
    key, label, defaultWidth,
    getFilterValue: r => r[key],
    exportValue: r => r[key],
    render: r => r[key] || dash,
  });
  const columns = [
    {
      key: 'name', label: 'Name', defaultWidth: 180,
      getFilterValue: r => r.name,
      exportValue: r => r.name,
      render: r => (
        <button type="button" onClick={() => setEditing(r)} title="Edit this competitor consultant" style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}>
          {r.name || '(no name)'}
        </button>
      ),
    },
    textCol('firm', 'Firm', 160),
    textCol('title', 'Job Title', 180),
    {
      key: 'email', label: 'Email', defaultWidth: 200,
      getFilterValue: r => r.email,
      exportValue: r => r.email,
      render: r => (r.email ? <a href={`mailto:${r.email}`} style={{ color: '#1D4ED8' }}>{r.email}</a> : dash),
    },
    textCol('phone', 'Phone', 130),
    {
      key: 'linkedin', label: 'LinkedIn', defaultWidth: 100,
      getFilterValue: r => (r.linkedin ? 'Yes' : 'No'),
      exportValue: r => href(r.linkedin),
      render: r => (href(r.linkedin) ? <a href={href(r.linkedin)} target="_blank" rel="noopener noreferrer" style={{ color: '#1D4ED8' }}>Profile {'↗'}</a> : dash),
    },
    textCol('service', 'What They Do Here', 200),
    textCol('notes', 'Notes', 240),
    {
      key: '__delete__', label: '', defaultWidth: 44, sortable: false, filterable: false, exportable: false,
      render: r => (
        <button
          type="button"
          onClick={() => { if (window.confirm(`Remove ${r.name || r.firm} from ${company || 'this company'}'s competitor consultants?`)) onChange(removeConsultant(rows, r.id)); }}
          title="Remove this competitor consultant"
          aria-label={`Remove ${r.name || r.firm}`}
          style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
        >{'×'}</button>
      ),
    },
  ];
  return (
    <div data-competitor-consultants style={{ marginTop: '1.25rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, margin: 0, fontSize: '0.7rem' }}>Competitor consultants {rows.length > 0 ? `(${rows.length})` : ''}</span>
        <button
          type="button"
          data-add-competitor-consultant
          onClick={() => setEditing(blankConsultant())}
          title="Add somebody at another firm who works with this company. Tracker only, not HubSpot."
          style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#C2410C', color: '#fff' }}
        >+ Add Competitor Consultant</button>
        <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Tracker only. Not in HubSpot, campaigns or contact lists.</span>
      </div>
      {rows.length > 0 && (
        <div style={{ height: `min(45vh, ${150 + rows.length * 40}px)`, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="company-competitor-consultants"
            columns={columns}
            rows={rows}
            alwaysVisible={['name', '__delete__']}
            emptyMessage="No competitor consultants match the filters."
            exportFileName={`${company || 'Company'} competitor consultants`}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
      {editing && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div role="dialog" aria-label="Competitor consultant" style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 760, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>{rows.some(r => r.id === editing.id) ? 'Edit Competitor Consultant' : 'New Competitor Consultant'}</h3>
            <CompetitorConsultantForm
              key={editing.id}
              initial={editing}
              company={company}
              firmOptions={firmOptions}
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
