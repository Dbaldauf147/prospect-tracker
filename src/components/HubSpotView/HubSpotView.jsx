import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import styles from './HubSpotView.module.css';

// NOTE: The HubSpot sync cache is intentionally stored as plain (unencrypted)
// localStorage.  The cache can be very large and encrypting/decrypting it on
// every access would cause noticeable UI lag.  It contains synced CRM data, not
// authentication secrets.  OAuth tokens are encrypted via secureStorage.js.
const CACHE_KEY = 'hubspot-sync-cache';

function HubSpotFilterDrop({ label, options, selected, onToggle, onBulkSet }) {
  const [open, setOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const count = selected.length;
  const shown = filterSearch.trim() ? options.filter(o => o.toLowerCase().includes(filterSearch.toLowerCase())) : options;
  const allShownSelected = shown.length > 0 && shown.every(o => selected.includes(o));
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.3rem 0.6rem', border: count > 0 ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: '6px', background: count > 0 ? 'var(--color-accent-light)' : 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 500, fontFamily: 'inherit', color: count > 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)', cursor: 'pointer' }}
        onClick={() => { setOpen(p => !p); setFilterSearch(''); }}
      >
        {label}{count > 0 && <span style={{ background: 'var(--color-accent)', color: '#fff', borderRadius: '999px', padding: '0 5px', fontSize: '0.6rem', fontWeight: 700, marginLeft: '2px' }}>{count}</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '0.3rem', minWidth: '160px', maxHeight: '280px', overflowY: 'auto', zIndex: 50 }}>
          {options.length > 3 && (
            <input style={{ width: '100%', padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', marginBottom: '0.2rem' }} type="text" placeholder="Search..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} autoFocus />
          )}
          {shown.length > 1 && (
            <div style={{ display: 'flex', gap: '0.3rem', padding: '0.15rem 0.4rem', marginBottom: '0.15rem', borderBottom: '1px solid #F1F5F9' }}>
              <button onClick={() => { if (onBulkSet) { const newSelected = [...new Set([...selected, ...shown])]; onBulkSet(newSelected); } else { shown.forEach(o => { if (!selected.includes(o)) onToggle(o); }); } }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.1rem 0' }}>
                Select All{filterSearch.trim() ? ' Matches' : ''}
              </button>
              <span style={{ color: '#E2E8F0' }}>|</span>
              <button onClick={() => { if (onBulkSet) { const newSelected = selected.filter(s => !shown.includes(s)); onBulkSet(newSelected); } else { shown.forEach(o => { if (selected.includes(o)) onToggle(o); }); } }} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.1rem 0' }}>
                Clear{filterSearch.trim() ? ' Matches' : ' All'}
              </button>
            </div>
          )}
          {shown.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.4rem', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '4px' }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: 'var(--color-accent)' }} />
              {opt}
            </label>
          ))}
          {shown.length === 0 && <div style={{ padding: '0.3rem', fontSize: '0.7rem', color: '#9CA3AF', textAlign: 'center' }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

// Inline editable cell for HubSpot contact fields
function HubSpotInlineCell({ contact, field, value, onSave, suggestions }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    setEditValue(value || '');
    setEditing(true);
    setShowSuggestions(true);
  }

  async function save(newVal) {
    setEditing(false);
    setShowSuggestions(false);
    const val = (newVal != null ? newVal : editValue).trim();
    if (val === (value || '').trim()) return;
    setSaving(true);
    await onSave(contact.id, { [field]: val });
    setSaving(false);
  }

  const filtered = (editing && showSuggestions && suggestions && editValue.trim().length >= 1)
    ? suggestions.filter(s => s.toLowerCase().includes(editValue.toLowerCase()) && s.toLowerCase() !== editValue.toLowerCase()).slice(0, 8)
    : [];

  if (editing) {
    return (
      <div style={{ position: 'relative' }} ref={wrapRef}>
        <input
          className={styles.inlineInput}
          value={editValue}
          onChange={e => { setEditValue(e.target.value); setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => { if (!wrapRef.current?.contains(document.activeElement)) save(); }, 150)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
        {filtered.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '180px', overflowY: 'auto' }}>
            {filtered.map(name => (
              <button key={name} onMouseDown={e => { e.preventDefault(); setEditValue(name); save(name); }} style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                onMouseEnter={e => e.target.style.background = '#F8FAFC'}
                onMouseLeave={e => e.target.style.background = 'none'}
              >{name}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <span className={saving ? styles.cellSaving : styles.cellEditable} onClick={startEdit}>
      {saving ? 'Saving...' : (value || '—')}
    </span>
  );
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function saveCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const TEMPLATE_HEADERS = ['First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Job Title', 'LinkedIn URL', 'City', 'State', 'Country', 'Notes'];

function downloadTemplate() {
  const csvContent = TEMPLATE_HEADERS.join(',') + '\nJohn,Smith,john@company.com,555-1234,Acme Corp,VP Sales,https://linkedin.com/in/johnsmith,New York,NY,United States,Met at conference\nJane,Doe,jane@other.com,555-5678,Other Inc,Director,,Chicago,IL,United States,Referred by John';
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hubspot-contact-upload-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Map of possible header names → our field name
const HEADER_ALIASES = {
  'first name': 'firstname', 'firstname': 'firstname', 'first': 'firstname', 'given name': 'firstname',
  'last name': 'lastname', 'lastname': 'lastname', 'last': 'lastname', 'surname': 'lastname', 'family name': 'lastname',
  'email': 'email', 'email address': 'email', 'e-mail': 'email', 'emailaddress': 'email',
  'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone', 'telephone': 'phone', 'cell': 'phone', 'mobile phone': 'phone',
  'company': 'company', 'company name': 'company', 'organization': 'company', 'organisation': 'company', 'account': 'company',
  'job title': 'jobtitle', 'jobtitle': 'jobtitle', 'title': 'jobtitle', 'role': 'jobtitle', 'position': 'jobtitle',
  'linkedin': 'hs_linkedin_url', 'linkedin url': 'hs_linkedin_url', 'linkedin profile': 'hs_linkedin_url', 'linkedin link': 'hs_linkedin_url',
  'city': 'city',
  'state': 'state', 'state/region': 'state', 'province': 'state', 'region': 'state',
  'country': 'country', 'country/region': 'country',
  'notes': 'notes', 'note': 'notes', 'comments': 'notes', 'comment': 'notes', 'description': 'notes',
};

function parseContactRows(lines, hasHeader) {
  const contacts = [];

  // Always try to detect header from first line — use proper CSV parsing
  function quickParseLine(line) {
    const result = [];
    let field = '';
    let inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQ) { if (ch === '"') { if (line[j+1] === '"') { field += '"'; j++; } else inQ = false; } else field += ch; }
      else { if (ch === '"') inQ = true; else if (ch === ',' || ch === '\t') { result.push(field.trim()); field = ''; } else field += ch; }
    }
    result.push(field.trim());
    return result;
  }
  const firstLineTrimmed = quickParseLine(lines[0] || '').map(p => p.toLowerCase());

  // Check how many first-line values match known headers
  const headerMatches = firstLineTrimmed.filter(h => HEADER_ALIASES[h]).length;
  const isHeader = hasHeader || headerMatches >= 2;

  let colMap = null;
  if (isHeader) {
    colMap = {};
    const used = new Set();
    firstLineTrimmed.forEach((h, i) => {
      const field = HEADER_ALIASES[h];
      if (field && !used.has(field)) {
        colMap[field] = i;
        used.add(field);
      }
    });
    console.log('Bulk upload header mapping:', colMap);
  }

  const mapping = {};
  const ALL_FIELDS = ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'hs_linkedin_url', 'city', 'state', 'country'];
  const FIELD_LABELS = { firstname: 'First Name', lastname: 'Last Name', email: 'Email', phone: 'Phone', company: 'Company', jobtitle: 'Job Title', hs_linkedin_url: 'LinkedIn URL', city: 'City', state: 'State', country: 'Country' };
  for (const field of ALL_FIELDS) {
    if (colMap && colMap[field] != null) {
      mapping[field] = { mapped: true, header: firstLineTrimmed[colMap[field]], col: colMap[field] };
    } else {
      mapping[field] = { mapped: false };
    }
  }

  // CSV parser that handles quoted fields with commas
  function parseCsvLine(line) {
    const result = [];
    let field = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQuotes) {
        if (ch === '"') {
          if (line[j + 1] === '"') { field += '"'; j++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',' || ch === '\t') { result.push(field.trim()); field = ''; }
        else field += ch;
      }
    }
    result.push(field.trim());
    return result;
  }

  const start = isHeader ? 1 : 0;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const trimmed = parseCsvLine(line);
    if (trimmed.length < 2) continue;

    if (colMap) {
      contacts.push({
        firstname: colMap.firstname != null ? (trimmed[colMap.firstname] || '') : '',
        lastname: colMap.lastname != null ? (trimmed[colMap.lastname] || '') : '',
        email: colMap.email != null ? (trimmed[colMap.email] || '') : '',
        phone: colMap.phone != null ? (trimmed[colMap.phone] || '') : '',
        company: colMap.company != null ? (trimmed[colMap.company] || '') : '',
        jobtitle: colMap.jobtitle != null ? (trimmed[colMap.jobtitle] || '') : '',
        hs_linkedin_url: colMap.hs_linkedin_url != null ? (trimmed[colMap.hs_linkedin_url] || '') : '',
        city: colMap.city != null ? (trimmed[colMap.city] || '') : '',
        state: colMap.state != null ? (trimmed[colMap.state] || '') : '',
        country: colMap.country != null ? (trimmed[colMap.country] || '') : '',
      });
    } else {
      // No header — try to detect email column by finding @ symbol
      const emailIdx = trimmed.findIndex(v => v.includes('@'));
      if (emailIdx >= 0) {
        contacts.push({
          firstname: trimmed[0] || '',
          lastname: trimmed[1] || '',
          email: trimmed[emailIdx] || '',
          phone: trimmed[emailIdx + 1] || '',
          company: trimmed[emailIdx + 2] || '',
          jobtitle: trimmed[emailIdx + 3] || '',
        });
      } else {
        contacts.push({
          firstname: trimmed[0] || '',
          lastname: trimmed[1] || '',
          email: trimmed[2] || '',
          phone: trimmed[3] || '',
          company: trimmed[4] || '',
          jobtitle: trimmed[5] || '',
        });
      }
    }
  }
  return { contacts, mapping, FIELD_LABELS };
}

function TagsMultiSelect({ contact, field, value, options, onSave }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newTag, setNewTag] = useState('');
  const ref = useRef(null);
  const selected = (value || '').split(';').map(s => s.trim()).filter(Boolean);

  // Normalize options — could be strings or { label, value } objects
  const normalizedOptions = (options || []).map(o => typeof o === 'string' ? o : (o.label || o.value || '')).filter(Boolean);

  // Combine provided options + current selected values (no heavy cache parsing)
  const allOptions = [...new Set([...normalizedOptions, ...selected])].filter(Boolean).sort();

  const dropRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target) && (!dropRef.current || !dropRef.current.contains(e.target))) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function toggle(opt) {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : [...selected, opt];
    const newVal = next.join(';');
    onSave(contact.id, { [field]: newVal });
  }

  function addNewTag() {
    const tag = newTag.trim();
    if (!tag || selected.includes(tag)) return;
    // Only allow tags that are already valid HubSpot options
    const knownLower = new Set(allOptions.map(o => o.toLowerCase()));
    if (!knownLower.has(tag.toLowerCase())) {
      alert('That tag is not a valid HubSpot option. Available tags: ' + allOptions.join(', '));
      setNewTag('');
      return;
    }
    const next = [...selected, tag];
    onSave(contact.id, { [field]: next.join(';') });
    setNewTag('');
  }

  const shown = search.trim() ? allOptions.filter(o => o.toLowerCase().includes(search.toLowerCase())) : allOptions;
  const summary = selected.length === 0 ? '—' : selected.length <= 2 ? selected.join(', ') : `${selected[0]} +${selected.length - 1}`;

  return (
    <div className={styles.tagsMultiWrap} ref={ref} onClick={e => e.stopPropagation()}>
      <div className={styles.tagsMultiSummary} onClick={() => setOpen(p => !p)} title={selected.join(', ')}>
        {summary}
      </div>
      {open && createPortal(
        <div ref={dropRef} className={styles.tagsMultiDropdown} style={{ position: 'fixed', top: ref.current ? ref.current.getBoundingClientRect().bottom + 2 : 0, left: ref.current ? ref.current.getBoundingClientRect().left : 0, zIndex: 9999 }}>
          <input
            type="text"
            placeholder="+ New tag (Enter to add)"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewTag(); } if (e.key === 'Escape') setOpen(false); }}
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', marginBottom: '0.25rem', boxSizing: 'border-box' }}
          />
          {allOptions.map(opt => (
            <label key={opt} className={styles.tagsMultiItem} onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                style={{ accentColor: 'var(--color-accent)' }}
              />
              {opt}
            </label>
          ))}
          {allOptions.length === 0 && !newTag.trim() && (
            <div className={styles.tagsMultiEmpty}>No tags yet — type above to create one</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function BulkUploadModal({ onUpload, onClose, uploading, progress }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState([]);
  const [colMapping, setColMapping] = useState(null);
  const [fieldLabels, setFieldLabels] = useState({});
  const [fileName, setFileName] = useState('');

  function doParse(lines) {
    const result = parseContactRows(lines, false);
    setParsed(result.contacts);
    setColMapping(result.mapping);
    setFieldLabels(result.FIELD_LABELS);
  }

  function parseText(val) {
    setText(val);
    if (!val.trim()) { setParsed([]); setColMapping(null); return; }
    doParse(val.trim().split('\n'));
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      const lines = content.split('\n');
      doParse(lines);
      setText(content);
    };
    reader.readAsText(file);
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.bulkModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Bulk Upload Contacts</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.bulkActions}>
            <button className={styles.templateBtn} onClick={downloadTemplate}>
              Download CSV Template
            </button>
            <label className={styles.fileUploadLabel}>
              Upload File
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className={styles.fileInput} />
            </label>
            {fileName && <span className={styles.fileName}>{fileName}</span>}
          </div>

          <p className={styles.bulkDesc}>
            Or paste rows below. Use the template format:<br />
            <strong>First Name, Last Name, Email, Phone, Company, Job Title</strong>
          </p>
          <textarea
            className={styles.bulkTextarea}
            rows={8}
            placeholder={"John,Smith,john@company.com,555-1234,Acme Corp,VP Sales\nJane,Doe,jane@other.com,555-5678,Other Inc,Director"}
            value={text}
            onChange={e => parseText(e.target.value)}
          />
          {colMapping && (
            <div className={styles.mappingChecklist}>
              <strong>Column Mapping:</strong>
              <div className={styles.mappingGrid}>
                {Object.entries(colMapping).map(([field, info]) => (
                  <div key={field} className={info.mapped ? styles.mappingItemMapped : styles.mappingItemMissing}>
                    <span className={styles.mappingIcon}>{info.mapped ? '✓' : '✗'}</span>
                    <span className={styles.mappingField}>{fieldLabels[field] || field}</span>
                    {info.mapped && <span className={styles.mappingHeader}>← "{info.header}" (col {info.col + 1})</span>}
                    {!info.mapped && <span className={styles.mappingHeader}>Not found</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {parsed.length > 0 && (
            <div className={styles.bulkPreview}>
              <strong>{parsed.length} contacts parsed:</strong>
              <div style={{ overflowX: 'auto' }}>
              <table className={styles.bulkPreviewTable}>
                <thead>
                  <tr>
                    <th>First</th><th>Last</th><th>Email</th><th>Phone</th><th>Company</th><th>Title</th><th>LinkedIn</th><th>City</th><th>State</th><th>Country</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((c, i) => (
                    <tr key={i}>
                      <td>{c.firstname || '—'}</td>
                      <td>{c.lastname || '—'}</td>
                      <td>{c.email || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.company || '—'}</td>
                      <td>{c.jobtitle || '—'}</td>
                      <td>{c.hs_linkedin_url || '—'}</td>
                      <td>{c.city || '—'}</td>
                      <td>{c.state || '—'}</td>
                      <td>{c.country || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {parsed.length > 50 && <div className={styles.bulkPreviewRow}>...and {parsed.length - 50} more</div>}
            </div>
          )}
        </div>
        {progress && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            <span className={styles.progressText}>
              {progress.done} of {progress.total} — {progress.created} created, {progress.errors} errors
            </span>
          </div>
        )}
        <div className={styles.modalFooter}>
          <button className={styles.modalCancelBtn} onClick={onClose} disabled={uploading}>Cancel</button>
          <button className={styles.modalSaveBtn} onClick={() => onUpload(parsed)} disabled={uploading || parsed.length === 0}>
            {uploading ? `Uploading ${progress?.done || 0}/${progress?.total || '...'}` : `Upload ${parsed.length} Contacts to HubSpot`}
          </button>
        </div>
      </div>
    </div>
  );
}


function ContactModal({ contact, onSave, onClose, saving, companyNames, tagOptions, ccMap, toAlsoMap, onSaveCcMap, onSaveToAlsoMap, contactOldEmails = {}, onSaveOldEmails }) {
  const isNew = !contact;
  const cid = contact?.id || contact?.vid;
  const savedOldEmails = (cid && contactOldEmails[cid]) || '';
  const [fields, setFields] = useState({
    firstname: contact?.firstname || '',
    lastname: contact?.lastname || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    company: contact?.company || '',
    jobtitle: contact?.jobtitle || '',
    hs_linkedin_url: contact?.hs_linkedin_url || contact?.linkedin_url || contact?.hs_linkedinid || '',
    city: contact?.city || '',
    state: contact?.state || '',
    country: contact?.country || '',
    dans_tags: contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '',
    notes: contact?.hs_note || contact?.notes || '',
    oldEmails: savedOldEmails,
  });
  // CC emails per contact email
  const [ccEmails, setCcEmails] = useState(() => {
    if (!contact?.email) return [];
    return (ccMap || {})[contact.email] || [];
  });
  const [ccInput, setCcInput] = useState('');
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const ccRef = useRef(null);
  // "To Also" emails per contact email
  const [toAlsoEmails, setToAlsoEmails] = useState(() => {
    if (!contact?.email) return [];
    return (toAlsoMap || {})[contact.email] || [];
  });
  const [toAlsoInput, setToAlsoInput] = useState('');
  const [showToAlsoSuggestions, setShowToAlsoSuggestions] = useState(false);
  const toAlsoRef = useRef(null);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
  const companyRef = useRef(null);
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const tagsDropdownRef = useRef(null);

  useEffect(() => {
    if (!tagsDropdownOpen) return;
    const h = e => { if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target)) setTagsDropdownOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [tagsDropdownOpen]);

  // All contact emails for CC suggestions
  const allEmails = useMemo(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      return (cache?.contacts || []).filter(c => c.email).map(c => ({
        email: c.email,
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
      }));
    } catch { return []; }
  }, []);

  useEffect(() => {
    if (!showCompanySuggestions) return;
    const h = (e) => { if (companyRef.current && !companyRef.current.contains(e.target)) setShowCompanySuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showCompanySuggestions]);

  useEffect(() => {
    if (!showCcSuggestions) return;
    const h = (e) => { if (ccRef.current && !ccRef.current.contains(e.target)) setShowCcSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showCcSuggestions]);

  useEffect(() => {
    if (!showToAlsoSuggestions) return;
    const h = (e) => { if (toAlsoRef.current && !toAlsoRef.current.contains(e.target)) setShowToAlsoSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showToAlsoSuggestions]);

  function set(key, value) { setFields(prev => ({ ...prev, [key]: value })); }

  function addCc(email) {
    if (!email.trim() || ccEmails.includes(email.trim())) return;
    setCcEmails(prev => [...prev, email.trim()]);
    setCcInput('');
    setShowCcSuggestions(false);
  }

  function removeCc(email) {
    setCcEmails(prev => prev.filter(e => e !== email));
  }

  function addToAlso(email) {
    if (!email.trim() || toAlsoEmails.includes(email.trim())) return;
    setToAlsoEmails(prev => [...prev, email.trim()]);
    setToAlsoInput('');
    setShowToAlsoSuggestions(false);
  }

  function removeToAlso(email) {
    setToAlsoEmails(prev => prev.filter(e => e !== email));
  }

  const ccSuggestions = ccInput.trim()
    ? allEmails.filter(c => !ccEmails.includes(c.email) && c.email !== fields.email && (c.email.toLowerCase().includes(ccInput.toLowerCase()) || c.name.toLowerCase().includes(ccInput.toLowerCase()))).slice(0, 6)
    : [];

  const toAlsoSuggestions = toAlsoInput.trim()
    ? allEmails.filter(c => !toAlsoEmails.includes(c.email) && c.email !== fields.email && (c.email.toLowerCase().includes(toAlsoInput.toLowerCase()) || c.name.toLowerCase().includes(toAlsoInput.toLowerCase()))).slice(0, 6)
    : [];

  const companySuggestions = fields.company.trim()
    ? (companyNames || []).filter(n => n.toLowerCase().includes(fields.company.toLowerCase()) && n.toLowerCase() !== fields.company.toLowerCase()).slice(0, 8)
    : [];

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{isNew ? 'New Contact' : `Edit: ${fields.firstname} ${fields.lastname}`}</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalGrid}>
            <div>
              <label className={styles.modalLabel}>First Name</label>
              <input className={styles.modalInput} value={fields.firstname} onChange={e => set('firstname', e.target.value)} />
            </div>
            <div>
              <label className={styles.modalLabel}>Last Name</label>
              <input className={styles.modalInput} value={fields.lastname} onChange={e => set('lastname', e.target.value)} />
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>Email *</label>
              <input className={styles.modalInput} type="email" value={fields.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className={styles.modalLabel}>Phone</label>
              <input className={styles.modalInput} value={fields.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div style={{ position: 'relative' }} ref={companyRef}>
              <label className={styles.modalLabel}>Company</label>
              <input className={styles.modalInput} value={fields.company} onChange={e => { set('company', e.target.value); setShowCompanySuggestions(true); }} onFocus={() => setShowCompanySuggestions(true)} />
              {showCompanySuggestions && companySuggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '180px', overflowY: 'auto' }}>
                  {companySuggestions.map(name => (
                    <button key={name} onClick={() => { set('company', name); setShowCompanySuggestions(false); }} style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                      onMouseEnter={e => e.target.style.background = '#F8FAFC'}
                      onMouseLeave={e => e.target.style.background = 'none'}
                    >{name}</button>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>Job Title</label>
              <input className={styles.modalInput} value={fields.jobtitle} onChange={e => set('jobtitle', e.target.value)} />
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>LinkedIn URL</label>
              <input className={styles.modalInput} value={fields.hs_linkedin_url} onChange={e => set('hs_linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
              <label className={styles.modalLabel}>City</label>
              <input className={styles.modalInput} value={fields.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className={styles.modalLabel}>State</label>
              <input className={styles.modalInput} value={fields.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>Country</label>
              <input className={styles.modalInput} value={fields.country} onChange={e => set('country', e.target.value)} />
            </div>
            <div className={styles.modalFull} ref={tagsDropdownRef}>
              <label className={styles.modalLabel}>Dan's Tags</label>
              {(() => {
                const currentTags = (fields.dans_tags || '').split(';').map(s => s.trim()).filter(Boolean);
                const allTagOpts = [...new Set([...(tagOptions || []), ...currentTags])].filter(Boolean).sort();
                const summary = currentTags.length === 0 ? 'Select tags...' : currentTags.join(', ');
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setTagsDropdownOpen(p => !p)}
                      style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: currentTags.length === 0 ? '#94A3B8' : 'var(--color-text)', boxSizing: 'border-box' }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
                      <span style={{ fontSize: '0.6rem', color: '#94A3B8', marginLeft: '0.5rem', flexShrink: 0 }}>{tagsDropdownOpen ? '\u25B2' : '\u25BC'}</span>
                    </button>
                    {tagsDropdownOpen && (
                      <div style={{ marginTop: '2px', border: '1px solid var(--color-border)', borderRadius: '6px', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '220px', overflowY: 'auto' }}>
                        <div style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #F1F5F9' }}>
                          <input
                            type="text"
                            placeholder="+ New tag (Enter to add)"
                            value={newTagInput}
                            onChange={e => setNewTagInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newTagInput.trim()) {
                                e.preventDefault();
                                const tag = newTagInput.trim();
                                // Only allow tags that are valid HubSpot options
                                const knownLower = new Set((tagOptions || []).map(o => (typeof o === 'string' ? o : o.label || o.value || '').toLowerCase()));
                                if (!knownLower.has(tag.toLowerCase())) {
                                  alert('That tag is not a valid HubSpot option. Available tags: ' + (tagOptions || []).join(', '));
                                  return;
                                }
                                if (!currentTags.includes(tag)) {
                                  set('dans_tags', [...currentTags, tag].join(';'));
                                }
                                setNewTagInput('');
                              }
                            }}
                            style={{ width: '100%', padding: '0.3rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
                          />
                        </div>
                        {allTagOpts.map(tag => {
                          const isActive = currentTags.includes(tag);
                          return (
                            <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.7rem', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', background: isActive ? '#EFF6FF' : '#fff' }}
                              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F8FAFC'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = isActive ? '#EFF6FF' : '#fff'; }}
                            >
                              <input
                                type="checkbox"
                                checked={isActive}
                                onChange={() => {
                                  const next = isActive ? currentTags.filter(t => t !== tag) : [...currentTags, tag];
                                  set('dans_tags', next.join(';'));
                                }}
                                style={{ accentColor: 'var(--color-accent)', width: '14px', height: '14px', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '0.78rem', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--color-accent)' : '#374151' }}>{tag}</span>
                            </label>
                          );
                        })}
                        {allTagOpts.length === 0 && !newTagInput.trim() && (
                          <div style={{ padding: '0.5rem 0.7rem', fontSize: '0.72rem', color: '#9CA3AF', fontStyle: 'italic' }}>No tags yet - type above to create one</div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>Old Emails <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(comma-separated, inactive)</span></label>
              <input className={styles.modalInput} value={fields.oldEmails} onChange={e => set('oldEmails', e.target.value)} placeholder="old.email@company.com, another@old.com" />
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>Notes</label>
              <textarea className={styles.modalInput} value={fields.notes} onChange={e => set('notes', e.target.value)} placeholder="Add notes about this contact..." rows={3} style={{ resize: 'vertical', minHeight: '60px', lineHeight: '1.5' }} />
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>CC Emails (auto-CC when drafting to this contact)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.35rem', border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px', alignItems: 'center' }}>
                {ccEmails.map(email => (
                  <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.7rem', color: '#1E40AF' }}>
                    {email}
                    <button onClick={() => removeCc(email)} style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
                  </span>
                ))}
                <div style={{ position: 'relative', flex: 1, minWidth: '120px' }} ref={ccRef}>
                  <input
                    value={ccInput}
                    onChange={e => { setCcInput(e.target.value); setShowCcSuggestions(true); }}
                    onFocus={() => setShowCcSuggestions(true)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && ccInput.includes('@')) { e.preventDefault(); addCc(ccInput); }
                      if (e.key === 'Backspace' && !ccInput && ccEmails.length > 0) removeCc(ccEmails[ccEmails.length - 1]);
                    }}
                    placeholder={ccEmails.length === 0 ? 'Search contacts or type email...' : 'Add more...'}
                    style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', width: '100%', background: 'none' }}
                  />
                  {showCcSuggestions && ccSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '160px', overflowY: 'auto' }}>
                      {ccSuggestions.map(c => (
                        <button key={c.email} onClick={() => addCc(c.email)} style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #F5F5F5' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)' }}>{c.name}</span>
                          <span style={{ fontSize: '0.65rem', color: '#9CA3AF' }}>{c.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className={styles.modalFull}>
              <label className={styles.modalLabel}>To Also (auto-add to To field when drafting)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.35rem', border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px', alignItems: 'center' }}>
                {toAlsoEmails.map(email => (
                  <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '999px', fontSize: '0.7rem', color: '#92400E' }}>
                    {email}
                    <button onClick={() => removeToAlso(email)} style={{ background: 'none', border: 'none', color: '#FCD34D', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
                  </span>
                ))}
                <div style={{ position: 'relative', flex: 1, minWidth: '120px' }} ref={toAlsoRef}>
                  <input
                    value={toAlsoInput}
                    onChange={e => { setToAlsoInput(e.target.value); setShowToAlsoSuggestions(true); }}
                    onFocus={() => setShowToAlsoSuggestions(true)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && toAlsoInput.includes('@')) { e.preventDefault(); addToAlso(toAlsoInput); }
                      if (e.key === 'Backspace' && !toAlsoInput && toAlsoEmails.length > 0) removeToAlso(toAlsoEmails[toAlsoEmails.length - 1]);
                    }}
                    placeholder={toAlsoEmails.length === 0 ? 'Search contacts or type email...' : 'Add more...'}
                    style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', width: '100%', background: 'none' }}
                  />
                  {showToAlsoSuggestions && toAlsoSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '160px', overflowY: 'auto' }}>
                      {toAlsoSuggestions.map(c => (
                        <button key={c.email} onClick={() => addToAlso(c.email)} style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid #F5F5F5' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)' }}>{c.name}</span>
                          <span style={{ fontSize: '0.65rem', color: '#9CA3AF' }}>{c.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.modalCancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.modalSaveBtn} onClick={() => {
            const email = fields.email.trim();
            if (email) {
              const nextCcMap = { ...(ccMap || {}) };
              if (ccEmails.length > 0) nextCcMap[email] = ccEmails;
              else delete nextCcMap[email];
              onSaveCcMap(nextCcMap);
              const nextToAlsoMap = { ...(toAlsoMap || {}) };
              if (toAlsoEmails.length > 0) nextToAlsoMap[email] = toAlsoEmails;
              else delete nextToAlsoMap[email];
              onSaveToAlsoMap(nextToAlsoMap);
            }
            // Save Old Emails to Firestore settings
            if (cid && onSaveOldEmails) {
              onSaveOldEmails(cid, fields.oldEmails || '');
            }
            // Strip local-only field before HubSpot save
            const { oldEmails, ...hsFields } = fields;
            onSave(hsFields, contact?.id);
          }} disabled={saving || !fields.email.trim()}>
            {saving ? 'Saving...' : isNew ? 'Create in HubSpot' : 'Update in HubSpot'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HubSpotView({ prospects, settings, updateSettings }) {
  const { user } = useAuth();
  const [data, setData] = useState(loadCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('contacts');
  const [search, setSearch] = useState('');
  const [editContact, setEditContact] = useState(undefined); // undefined=closed, null=new, object=edit
  const [saving, setSaving] = useState(false);
  const [pushStatus, setPushStatus] = useState(null);
  const [massMode, setMassMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [massField, setMassField] = useState('company');
  const [massValue, setMassValue] = useState('');
  const [massProcessing, setMassProcessing] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [cardFilter, setCardFilter] = useState(null);
  const [colFilters, setColFilters] = useState({});
  const [dansTagOptions, setDansTagOptions] = useState([]);
  const dismissedGuesses = settings?.dismissedGuesses || {};
  function dismissGuess(contactId, field) {
    updateSettings({ dismissedGuesses: { ...dismissedGuesses, [`${contactId}_${field}`]: true } });
  }

  // Build tier lookup from prospects (My Accounts data)
  const tierByCompany = useMemo(() => {
    const map = {};
    for (const p of (prospects || [])) {
      const key = (p.company || '').toLowerCase().trim();
      if (key && (p.tier === 'Tier 1' || p.tier === 'Tier 2')) {
        map[key] = p.tier;
      }
    }
    return map;
  }, [prospects]);

  function findTierForCompany(company) {
    if (!company) return null;
    const key = company.toLowerCase().trim();
    if (tierByCompany[key]) return tierByCompany[key];
    // Fuzzy: check if any key contains or is contained
    for (const [k, tier] of Object.entries(tierByCompany)) {
      const longer = key.length >= k.length ? key : k;
      const shorter = key.length >= k.length ? k : key;
      if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return tier;
    }
    return null;
  }

  // Inline cell save — updates HubSpot and local cache
  const FIELD_MAP = {};
  const LOCAL_ONLY_PROPS = new Set(['_zoomCompanyName', '_zoomCompanyId', '_linkedinProfile', '_zoomWebsite', '_emailDomain']);
  const contactLocalFields = settings?.contactLocalFields || {};

  const handleInlineUpdate = useCallback(async (contactId, properties) => {
    try {
      // Split into HubSpot props and local-only props
      const hubspotProps = {};
      const localProps = {};
      for (const [k, v] of Object.entries(properties)) {
        if (LOCAL_ONLY_PROPS.has(k)) localProps[k] = v;
        else hubspotProps[k] = v;
      }
      // Filter out invalid tag values — but only if we have the valid options loaded
      if (hubspotProps.dans_tags && dansTagOptions && dansTagOptions.length > 0) {
        const tags = hubspotProps.dans_tags.split(';').map(t => t.trim()).filter(Boolean);
        const knownLower = new Set(dansTagOptions.map(o => (typeof o === 'string' ? o : o.label || o.value || '').toLowerCase()));
        hubspotProps.dans_tags = tags.filter(t => knownLower.has(t.toLowerCase())).join(';');
      }
      // Only call HubSpot API if there are real HubSpot properties to update
      if (Object.keys(hubspotProps).length > 0) {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId, properties: hubspotProps }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
      }
      // Save local-only fields to Firestore settings
      if (Object.keys(localProps).length > 0) {
        const next = { ...contactLocalFields };
        next[contactId] = { ...(next[contactId] || {}), ...localProps };
        updateSettings({ contactLocalFields: next });
      }
      // Update local cache for all properties (including local-only)
      setData(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          contacts: prev.contacts.map(c =>
            c.id === contactId ? { ...c, ...properties } : c
          ),
        };
        saveCache(updated);
        return updated;
      });
      logAction(user, 'contact_updated', { contactId, properties });
    } catch (err) {
      console.error('Inline update failed:', err);
      setPushStatus({ type: 'error', message: `Update failed: ${err.message}` });
    }
  }, [user]);

  const handleDeleteContact = useCallback(async (contactId, name) => {
    if (!confirm(`Delete "${name}" from HubSpot? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/hubspot?action=delete-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Remove from local cache
      setData(prev => {
        if (!prev) return prev;
        const updated = { ...prev, contacts: prev.contacts.filter(c => c.id !== contactId) };
        saveCache(updated);
        return updated;
      });
      setPushStatus({ type: 'success', message: `Deleted "${name}" from HubSpot` });
    } catch (err) {
      setPushStatus({ type: 'error', message: `Delete failed: ${err.message}` });
    }
  }, []);

  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkErrors, setBulkErrors] = useState([]); // [{ email, name, reason }]

  function categorizeError(reason) {
    const r = (reason || '').toLowerCase();
    if (r.includes('already exists') || r.includes('conflict') || r.includes('duplicate') || r.includes('409')) return 'Contact Already Exists';
    if (r.includes('skipped') && r.includes('email')) return 'Skipped - No Email';
    if (r.includes('property values were not valid')) return 'Invalid Email';
    if (r.includes('invalid') && r.includes('email')) return 'Invalid Email';
    if (r.includes('invalid')) return 'Invalid Data';
    if (r.includes('not found')) return 'Not Found';
    if (r.includes('rate limit') || r.includes('429')) return 'Rate Limited';
    if (r.includes('permission') || r.includes('403') || r.includes('401')) return 'Permission Denied';
    if (r.includes('network') || r.includes('fetch')) return 'Network Error';
    if (r.includes('timeout')) return 'Timeout';
    if (r.includes('500') || r.includes('server')) return 'Server Error';
    if (!reason) return 'Unknown';
    return 'Other';
  }

  function downloadFailedExcel(errors) {
    const standardCols = { category: 'Error Category', firstname: 'First Name', lastname: 'Last Name', email: 'Email', phone: 'Phone', company: 'Company', jobtitle: 'Job Title', hs_linkedin_url: 'LinkedIn URL', city: 'City', state: 'State', country: 'Country', reason: 'Error Reason' };
    // Collect all unique keys from error objects
    const allKeys = new Set();
    for (const e of errors) for (const k of Object.keys(e)) if (k !== '_id') allKeys.add(k);
    // Build ordered column list: standard first, then extras
    const orderedKeys = Object.keys(standardCols);
    for (const k of allKeys) if (!orderedKeys.includes(k)) orderedKeys.push(k);

    const data = errors.map(e => {
      const row = {};
      for (const k of orderedKeys) {
        const label = standardCols[k] || k;
        row[label] = k === 'category' ? (e.category || categorizeError(e.reason)) : (e[k] || '');
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    // Auto-size columns
    const colWidths = Object.keys(data[0] || {}).map(key => ({
      wch: Math.max(key.length, ...data.map(r => (r[key] || '').length).slice(0, 50)) + 2,
    }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Contacts');
    XLSX.writeFile(wb, `failed-contacts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleBulkUpload(contacts) {
    setBulkUploading(true);
    setPushStatus(null);
    setBulkErrors([]);
    setBulkProgress({ done: 0, total: contacts.length, created: 0, updated: 0, errors: 0 });
    let totalCreated = 0, totalUpdated = 0, totalErrors = 0;
    const allErrors = [];
    const BATCH_SIZE = 10;
    try {
      for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const batch = contacts.slice(i, i + BATCH_SIZE);
        try {
          // Strip notes from contact properties before sending to HubSpot
          const notesMap = {};
          const cleanBatch = batch.map(c => {
            const { notes, ...props } = c;
            if (notes?.trim()) notesMap[c.email] = notes.trim();
            return props;
          });
          const res = await fetch('/api/hubspot?action=push-contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts: cleanBatch }),
          });
          const json = await res.json();
          if (json.error) {
            totalErrors += batch.length;
            batch.forEach(c => allErrors.push({ ...c, reason: json.error, category: categorizeError(json.error) }));
          } else {
            totalCreated += json.created || 0;
            totalUpdated += json.updated || 0;
            if (json.errors?.length) {
              totalErrors += json.errors.length;
              json.errors.forEach(errMsg => {
                const match = batch.find(c => errMsg.includes(c.email));
                const entry = match ? { ...match, reason: errMsg } : { email: '', reason: errMsg };
                entry.category = categorizeError(errMsg);
                allErrors.push(entry);
              });
            }
            // Create notes for successfully uploaded contacts
            if (json.results && Object.keys(notesMap).length > 0) {
              for (const r of json.results || []) {
                const contactEmail = r.email || '';
                const noteText = notesMap[contactEmail];
                if (noteText && r.id) {
                  fetch(`/api/hubspot?action=create-note`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactId: r.id, body: noteText }),
                  }).catch(() => {});
                }
              }
            }
          }
        } catch (err) {
          totalErrors += batch.length;
          const msg = err.message || 'Network error';
          batch.forEach(c => allErrors.push({ ...c, reason: msg, category: categorizeError(msg) }));
        }
        const done = Math.min(i + BATCH_SIZE, contacts.length);
        setBulkProgress({ done, total: contacts.length, created: totalCreated, updated: totalUpdated, errors: totalErrors });
      }
      setBulkErrors(allErrors);
      if (allErrors.length === 0) setShowBulkUpload(false);
      setPushStatus({ type: allErrors.length > 0 ? 'error' : 'success', message: `Bulk upload complete: ${totalCreated} created, ${totalUpdated} updated, ${totalErrors} errors out of ${contacts.length}` });

      // Auto-email the error report if there are failures
      if (allErrors.length > 0) {
        try {
          await fetch('/api/send-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: 'baldaufdan@gmail.com',
              subject: `Bulk Upload Report — ${totalErrors} Failed out of ${contacts.length}`,
              errors: allErrors,
              totalUploaded: contacts.length,
              totalCreated,
              totalUpdated,
              totalErrors,
            }),
          });
        } catch (emailErr) {
          console.error('Failed to send error report email:', emailErr);
        }
      }

      syncFromHubSpot();
    } catch (err) {
      setPushStatus({ type: 'error', message: `Bulk upload failed: ${err.message}` });
    } finally {
      setBulkUploading(false);
      setBulkProgress(null);
    }
  }

  async function handleSaveContact(fields, existingId) {
    setSaving(true);
    setPushStatus(null);
    try {
      // Separate notes from contact properties (HubSpot notes are a different object)
      const { notes, ...contactProps } = fields;
      // Filter out invalid tag values — but only if we have the valid options loaded
      if (contactProps.dans_tags && dansTagOptions && dansTagOptions.length > 0) {
        const tags = contactProps.dans_tags.split(';').map(t => t.trim()).filter(Boolean);
        const knownLower = new Set(dansTagOptions.map(o => (typeof o === 'string' ? o : o.label || o.value || '').toLowerCase()));
        contactProps.dans_tags = tags.filter(t => knownLower.has(t.toLowerCase())).join(';');
      }
      const action = existingId ? 'update-contact' : 'create-contact';
      const reqBody = existingId
        ? { contactId: existingId, properties: contactProps }
        : { properties: contactProps };
      const res = await fetch(`/api/hubspot?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // If there are notes, create a HubSpot note (engagement) attached to the contact
      const contactId = existingId || json.id;
      if (notes?.trim() && contactId) {
        try {
          await fetch(`/api/hubspot?action=create-note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId, body: notes.trim() }),
          });
        } catch {}
      }
      setEditContact(undefined);
      setPushStatus({ type: 'success', message: existingId ? 'Contact updated in HubSpot' : 'Contact created in HubSpot' });
      logAction(user, existingId ? 'contact_updated' : 'contact_created', { contactId, properties: contactProps });
      syncFromHubSpot();
    } catch (err) {
      setPushStatus({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function syncFromHubSpot(background = false) {
    if (!background) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hubspot?action=full-sync');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      saveCache(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load Dan's Tags options from contacts data + HubSpot properties
  useEffect(() => {
    const vals = new Set();
    // Collect from all contacts
    const contacts = data?.contacts || [];
    for (const c of contacts) {
      const v = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
      if (v) v.split(';').forEach(t => { if (t.trim()) vals.add(t.trim()); });
    }
    // Also try cache if data not loaded yet
    if (contacts.length === 0) {
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        for (const c of cache?.contacts || []) {
          const v = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
          if (v) v.split(';').forEach(t => { if (t.trim()) vals.add(t.trim()); });
        }
      } catch {}
    }
    if (vals.size > 0) setDansTagOptions([...vals].sort());
    // Also try HubSpot property options as supplement
    (async () => {
      try {
        const res = await fetch('/api/hubspot?action=properties');
        const json = await res.json();
        if (json.properties) {
          const prop = json.properties.find(p =>
            p.name === 'dans_tags' || p.name === 'dan_s_tags' || p.name === 'dans_tag' ||
            ((p.label || '').toLowerCase().includes('dan') && (p.label || '').toLowerCase().includes('tag'))
          );
          if (prop) {
            const detailRes = await fetch(`/api/hubspot?action=property-detail&name=${prop.name}`);
            const detail = await detailRes.json();
            if (detail.options?.length) {
              const propVals = detail.options.map(o => typeof o === 'string' ? o : (o.label || o.value || '')).filter(Boolean);
              propVals.forEach(v => vals.add(v));
              setDansTagOptions([...vals].sort());
            }
          }
        }
      } catch {}
    })();
  }, [data]);

  // Auto-sync on mount if cache is stale (older than 15 minutes) or missing
  useEffect(() => {
    const STALE_MS = 15 * 60 * 1000;
    const isStale = !data?.syncedAt || (Date.now() - new Date(data.syncedAt).getTime()) > STALE_MS;
    if (!data) {
      // No cache at all — show loading spinner
      syncFromHubSpot(false);
    } else if (isStale) {
      // Have cache but stale — sync in background, show cached data immediately
      syncFromHubSpot(true);
    }
  }, []);

  // Auto-sync every 15 minutes while the page is open
  useEffect(() => {
    const interval = setInterval(() => {
      syncFromHubSpot(true);
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const contacts = data?.contacts || [];
  const sequences = data?.sequences || [];
  const campaigns = data?.campaigns || [];

  // Build email domain → company name map from prospects
  const domainToCompany = useMemo(() => {
    const map = new Map();
    // From Table View prospects
    for (const p of prospects) {
      if (p.emailDomain) {
        const entries = p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
        for (const entry of entries) {
          const atIdx = entry.lastIndexOf('@');
          const domain = atIdx >= 0 ? entry.slice(atIdx + 1).toLowerCase() : entry.toLowerCase();
          if (domain && p.company && !map.has(domain)) map.set(domain, p.company);
        }
      }
      if (p.website) {
        const webDomain = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
        if (webDomain && p.company && !map.has(webDomain)) map.set(webDomain, p.company);
      }
    }
    // From existing HubSpot contacts — if a contact has both email and company,
    // use that to guess company for other contacts with the same email domain
    for (const c of contacts) {
      if (c.company && c.email) {
        const atIdx = c.email.lastIndexOf('@');
        if (atIdx >= 0) {
          const domain = c.email.slice(atIdx + 1).toLowerCase();
          if (domain && !map.has(domain)) map.set(domain, c.company);
        }
      }
    }
    return map;
  }, [prospects, contacts]);

  // Company name suggestions from Table View prospects
  const prospectCompanyNames = useMemo(() => {
    const names = new Set();
    (prospects || []).forEach(p => { if (p.company) names.add(p.company); });
    return [...names].sort();
  }, [prospects]);

  // Match contacts to prospects by company name, guess company from email, hide @se.com
  const enrichedContacts = useMemo(() => {
    const prospectMap = new Map();
    for (const p of prospects) {
      prospectMap.set((p.company || '').toLowerCase(), p);
    }

    return contacts
      .filter(c => {
        // Hide contacts with "Hide" tag
        const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
        if (tags.includes('hide')) return false;
        // Hide @se.com emails
        const email = (c.email || '').toLowerCase();
        return !email.endsWith('@se.com');
      })
      .map(c => {
        // Merge local-only fields from Firestore settings
        const localFields = contactLocalFields[c.id] || {};
        c = { ...c, ...localFields };
        const companyKey = (c.company || '').toLowerCase();
        const prospect = prospectMap.get(companyKey);

        // Guess company from email domain if company is blank
        let guessedCompany = '';
        if (!c.company && c.email) {
          const atIdx = c.email.lastIndexOf('@');
          if (atIdx >= 0) {
            const domain = c.email.slice(atIdx + 1).toLowerCase();
            guessedCompany = domainToCompany.get(domain) || '';
          }
        }

        // If we guessed a company, also try to match to prospect
        const effectiveCompany = c.company || guessedCompany;
        const matchedProspect = prospect || (guessedCompany ? prospectMap.get(guessedCompany.toLowerCase()) : null);

        const tier = findTierForCompany(c.company || guessedCompany) || 'Not Targeted';

        // Guess first/last name from email or LinkedIn URL if missing
        let guessedFirstName = '';
        let guessedLastName = '';
        if (!c.firstname || !c.lastname) {
          // Try email first: john.smith@company.com → John Smith
          if (c.email) {
            const local = c.email.split('@')[0] || '';
            // Common patterns: first.last, first_last, firstlast (if short)
            const parts = local.split(/[._-]/).filter(Boolean);
            if (parts.length >= 2) {
              if (!c.firstname) guessedFirstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
              if (!c.lastname) guessedLastName = parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1).toLowerCase();
            }
          }
          // Try LinkedIn URL: linkedin.com/in/john-smith → John Smith
          if ((!guessedFirstName || !guessedLastName)) {
            const linkedinUrl = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid || '';
            const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?]+)/i);
            if (match) {
              const slug = match[1].replace(/-\d+$/, ''); // remove trailing numbers like -123
              const parts = slug.split('-').filter(p => p && !/^\d+$/.test(p));
              if (parts.length >= 2) {
                if (!c.firstname && !guessedFirstName) guessedFirstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
                if (!c.lastname && !guessedLastName) guessedLastName = parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1).toLowerCase();
              }
            }
          }
        }
        const guessedName = (guessedFirstName || guessedLastName) ? `${guessedFirstName} ${guessedLastName}`.trim() : '';

        return {
          ...c,
          guessedCompany,
          guessedName,
          guessedFirstName,
          guessedLastName,
          effectiveCompany,
          matchedProspect: matchedProspect || null,
          isEnrolled: c.hs_sequences_is_enrolled === 'true',
          enrolledCount: parseInt(c.hs_sequences_actively_enrolled_count) || 0,
          tier,
        };
      });
  }, [contacts, prospects, domainToCompany, tierByCompany]);

  // Dynamic filter options for HubSpot columns
  const HUBSPOT_FILTER_SKIP = new Set(['id', '_select', '_delete', 'guessedCompany', 'guessedName', 'guessedFirstName', 'guessedLastName', 'effectiveCompany', 'matchedProspect', 'enrolledCount', 'isEnrolled', 'hs_sequences_is_enrolled', 'hs_sequences_actively_enrolled_count']);
  const HUBSPOT_FILTER_LABELS = { company: 'Company', tier: 'Tier', jobtitle: 'Title', city: 'City', state: 'State', country: 'Country', firstname: 'First Name', lastname: 'Last Name', email: 'Email', phone: 'Phone', sequenceStatus: 'Sequence', dans_tags: "Dan's Tags", dan_s_tags: "Dan's Tags" };
  const hsFilterOptions = useMemo(() => {
    const opts = {};
    const allKeys = ['company', 'tier', 'jobtitle', 'city', 'state', 'country'];
    // Also discover keys from data
    if (enrichedContacts.length > 0) {
      for (const key of Object.keys(enrichedContacts[0])) {
        if (!HUBSPOT_FILTER_SKIP.has(key) && !allKeys.includes(key)) allKeys.push(key);
      }
    }
    for (const key of allKeys) {
      if (HUBSPOT_FILTER_SKIP.has(key)) continue;
      const vals = new Set();
      let tooMany = false;
      for (const c of enrichedContacts) {
        let v = c[key];
        if (v == null || v === '' || v === '—' || typeof v === 'object') continue;
        v = String(v).trim();
        if (!v) continue;
        vals.add(v);
        if (vals.size > 50) { tooMany = true; break; }
      }
      if (!tooMany && vals.size >= 2) opts[key] = [...vals].sort();
    }
    return opts;
  }, [enrichedContacts]);

  function toggleColFilter(key, value) {
    setColFilters(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }

  const activeColFilterCount = Object.values(colFilters).reduce((s, a) => s + a.length, 0);

  const filteredContacts = useMemo(() => {
    let result = enrichedContacts;

    // Apply card filter
    if (cardFilter === 'notMatched') {
      result = result.filter(c => !c.matchedProspect || (!c.company && c.guessedCompany));
    } else if (cardFilter === 'enrolled') {
      result = result.filter(c => c.isEnrolled);
    } else if (cardFilter === 'notEnrolled') {
      result = result.filter(c => !c.isEnrolled);
    } else if (cardFilter === 'noEmail') {
      result = result.filter(c => !c.email);
    } else if (cardFilter === 'left') {
      result = result.filter(c => (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase().includes('left'));
    } else if (cardFilter === 'keyTarget') {
      result = result.filter(c => { const t = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase(); return t.includes('dan key target'); });
    } else if (cardFilter === 'missingName') {
      result = result.filter(c => !c.firstname || !c.lastname);
    } else if (cardFilter === 'guessedName') {
      result = result.filter(c => c.guessedName && (!c.firstname || !c.lastname));
    } else if (cardFilter === 'guessedCompany') {
      result = result.filter(c => !c.company && c.guessedCompany);
    }

    // Apply column filters
    for (const [key, values] of Object.entries(colFilters)) {
      if (values.length > 0) result = result.filter(c => values.includes(String(c[key] ?? '')));
    }

    // Apply text search
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(c =>
        [c.firstname, c.lastname, c.email, c.company, c.jobtitle, c.guessedCompany]
          .filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }

    return result;
  }, [enrichedContacts, search, cardFilter, colFilters]);

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredContacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredContacts.map(c => c.id)));
    }
  }

  async function handleMassUpdate() {
    if (selected.size === 0 || !massValue.trim()) return;
    setMassProcessing(true);
    setPushStatus(null);
    let updated = 0, errors = 0;
    for (const id of selected) {
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { [massField]: massValue.trim() } }),
        });
        const json = await res.json();
        if (json.error) { errors++; } else { updated++; }
      } catch { errors++; }
    }
    // Update local cache
    setData(prev => {
      if (!prev) return prev;
      const upd = { ...prev, contacts: prev.contacts.map(c => selected.has(c.id) ? { ...c, [massField]: massValue.trim() } : c) };
      saveCache(upd);
      return upd;
    });
    setPushStatus({ type: 'success', message: `Updated ${updated} contacts${errors > 0 ? `, ${errors} failed` : ''}` });
    setMassProcessing(false);
    setMassValue('');
  }

  async function handleCopyGuessedCompany() {
    // Find selected contacts that have a guessed company but no actual company
    const toCopy = filteredContacts.filter(c => selected.has(c.id) && !c.company && c.guessedCompany);
    if (toCopy.length === 0) {
      setPushStatus({ type: 'error', message: 'No selected contacts have a guessed company to copy' });
      return;
    }
    setMassProcessing(true);
    setPushStatus(null);
    let updated = 0, errors = 0;
    for (const c of toCopy) {
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: c.id, properties: { company: c.guessedCompany } }),
        });
        const json = await res.json();
        if (json.error) { errors++; } else { updated++; }
      } catch { errors++; }
    }
    setData(prev => {
      if (!prev) return prev;
      const guessMap = new Map(toCopy.map(c => [c.id, c.guessedCompany]));
      const upd = { ...prev, contacts: prev.contacts.map(c => guessMap.has(c.id) ? { ...c, company: guessMap.get(c.id) } : c) };
      saveCache(upd);
      return upd;
    });
    setPushStatus({ type: 'success', message: `Copied guessed company to ${updated} contacts${errors > 0 ? `, ${errors} failed` : ''}` });
    setMassProcessing(false);
  }

  async function handleCopyAllGuessedCompanies() {
    const toCopy = enrichedContacts.filter(c => !c.company && c.guessedCompany && !dismissedGuesses[`${c.id}_company`]);
    if (toCopy.length === 0) return;
    if (!confirm(`Copy ONLY the guessed company name to ${toCopy.length} contacts in HubSpot? (Names will NOT be changed)`)) return;
    setMassProcessing(true);
    setPushStatus(null);
    let updated = 0, errors = 0;
    for (const c of toCopy) {
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: c.id, properties: { company: c.guessedCompany } }),
        });
        const json = await res.json();
        if (json.error) { errors++; } else { updated++; }
      } catch { errors++; }
    }
    setData(prev => {
      if (!prev) return prev;
      const guessMap = new Map(toCopy.map(c => [c.id, c.guessedCompany]));
      const upd = { ...prev, contacts: prev.contacts.map(c => guessMap.has(c.id) ? { ...c, company: guessMap.get(c.id) } : c) };
      saveCache(upd);
      return upd;
    });
    setPushStatus({ type: 'success', message: `Copied guessed company to ${updated} contacts${errors > 0 ? `, ${errors} failed` : ''}` });
    logAction(user, 'bulk_guess_companies', { count: updated });
    setMassProcessing(false);
  }

  async function handleCopyAllGuessedNames() {
    const toCopy = enrichedContacts.filter(c => c.guessedName && (!c.firstname || !c.lastname) && !dismissedGuesses[`${c.id}_name`]);
    if (toCopy.length === 0) return;
    if (!confirm(`Copy ONLY the guessed first/last name to ${toCopy.length} contacts in HubSpot? (Companies will NOT be changed)`)) return;
    setMassProcessing(true);
    setPushStatus(null);
    let updated = 0, errors = 0;
    for (const c of toCopy) {
      try {
        const props = {};
        if (c.guessedFirstName && !c.firstname) props.firstname = c.guessedFirstName;
        if (c.guessedLastName && !c.lastname) props.lastname = c.guessedLastName;
        if (Object.keys(props).length === 0) continue;
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: c.id, properties: props }),
        });
        const json = await res.json();
        if (json.error) { errors++; } else { updated++; }
      } catch { errors++; }
    }
    setData(prev => {
      if (!prev) return prev;
      const guessMap = new Map(toCopy.map(c => [c.id, { firstname: c.guessedFirstName, lastname: c.guessedLastName }]));
      const upd = { ...prev, contacts: prev.contacts.map(c => {
        const g = guessMap.get(c.id);
        if (!g) return c;
        return { ...c, firstname: c.firstname || g.firstname, lastname: c.lastname || g.lastname };
      })};
      saveCache(upd);
      return upd;
    });
    setPushStatus({ type: 'success', message: `Copied guessed names to ${updated} contacts${errors > 0 ? `, ${errors} failed` : ''}` });
    logAction(user, 'bulk_guess_names', { count: updated });
    setMassProcessing(false);
  }

  async function handleMassDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} contacts from HubSpot? This cannot be undone.`)) return;
    setMassProcessing(true);
    setPushStatus(null);
    let deleted = 0, errors = 0;
    for (const id of selected) {
      try {
        const res = await fetch('/api/hubspot?action=delete-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id }),
        });
        const json = await res.json();
        if (json.error) { errors++; } else { deleted++; }
      } catch { errors++; }
    }
    setData(prev => {
      if (!prev) return prev;
      const upd = { ...prev, contacts: prev.contacts.filter(c => !selected.has(c.id)) };
      saveCache(upd);
      return upd;
    });
    const deletedIds = [...selected];
    setSelected(new Set());
    setPushStatus({ type: 'success', message: `Deleted ${deleted} contacts${errors > 0 ? `, ${errors} failed` : ''}` });
    logAction(user, 'contact_deleted', { contactIds: deletedIds, count: deleted });
    setMassProcessing(false);
  }

  // Stats
  const enrolledCount = enrichedContacts.filter(c => c.isEnrolled).length;
  const matchedCount = enrichedContacts.filter(c => c.matchedProspect).length;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>HubSpot</h2>
          {data?.syncedAt && <span className={styles.lastSync}>Last synced: {fmtDateTime(data.syncedAt)}</span>}
        </div>
        <button className={styles.syncBtn} onClick={() => syncFromHubSpot(false)} disabled={loading}>
          {loading ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        <button className={`${styles.summaryCard} ${cardFilter === null ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === null ? null : null)}>
          <div className={styles.summaryLabel}>All Contacts</div>
          <div className={styles.summaryValue}>{contacts.length}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'notMatched' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'notMatched' ? null : 'notMatched')}>
          <div className={styles.summaryLabel}>Not Matched to Prospects</div>
          <div className={styles.summaryValue}>{enrichedContacts.length - matchedCount}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'enrolled' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'enrolled' ? null : 'enrolled')}>
          <div className={styles.summaryLabel}>In Sequences</div>
          <div className={styles.summaryValue}>{enrolledCount}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'notEnrolled' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'notEnrolled' ? null : 'notEnrolled')}>
          <div className={styles.summaryLabel}>Not in Sequences</div>
          <div className={styles.summaryValue}>{contacts.length - enrolledCount}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'keyTarget' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'keyTarget' ? null : 'keyTarget')}>
          <div className={styles.summaryLabel}>Dan's Key Contacts</div>
          <div className={styles.summaryValue}>{enrichedContacts.filter(c => { const t = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase(); return t.includes('dan key target'); }).length}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'left' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'left' ? null : 'left')}>
          <div className={styles.summaryLabel}>Left Company</div>
          <div className={styles.summaryValue}>{enrichedContacts.filter(c => (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase().includes('left')).length}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'missingName' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'missingName' ? null : 'missingName')}>
          <div className={styles.summaryLabel}>Missing Name</div>
          <div className={styles.summaryValue}>{enrichedContacts.filter(c => !c.firstname || !c.lastname).length}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'guessedName' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'guessedName' ? null : 'guessedName')}>
          <div className={styles.summaryLabel}>Guessed Names</div>
          <div className={styles.summaryValue}>{enrichedContacts.filter(c => c.guessedName && (!c.firstname || !c.lastname)).length}</div>
        </button>
        <button className={`${styles.summaryCard} ${cardFilter === 'guessedCompany' ? styles.summaryCardActive : ''}`} onClick={() => setCardFilter(cardFilter === 'guessedCompany' ? null : 'guessedCompany')}>
          <div className={styles.summaryLabel}>Guessed Companies</div>
          <div className={styles.summaryValue}>{enrichedContacts.filter(c => !c.company && c.guessedCompany).length}</div>
        </button>
      </div>

      <div className={styles.tabs}>
        <button className={tab === 'contacts' ? styles.tabActive : styles.tab} onClick={() => setTab('contacts')}>
          Contacts <span className={styles.tabCount}>{contacts.length}</span>
        </button>
        <button className={tab === 'sequences' ? styles.tabActive : styles.tab} onClick={() => setTab('sequences')}>
          Sequences <span className={styles.tabCount}>{sequences.length}</span>
        </button>
        <button className={tab === 'campaigns' ? styles.tabActive : styles.tab} onClick={() => setTab('campaigns')}>
          Campaigns <span className={styles.tabCount}>{campaigns.length}</span>
        </button>
      </div>

      {loading && !data && <div className={styles.loading}>Loading from HubSpot...</div>}

      {tab === 'contacts' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search contacts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {Object.entries(hsFilterOptions).map(([key, options]) => (
              <HubSpotFilterDrop key={key} label={HUBSPOT_FILTER_LABELS[key] || key} options={options} selected={colFilters[key] || []} onToggle={v => toggleColFilter(key, v)} onBulkSet={arr => setColFilters(prev => ({ ...prev, [key]: arr }))} />
            ))}
            {activeColFilterCount > 0 && <button style={{ border: 'none', background: 'none', fontSize: '0.7rem', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }} onClick={() => setColFilters({})}>Clear filters</button>}
            <button className={massMode ? styles.massEditBtnActive : styles.massEditBtn} onClick={() => { setMassMode(p => !p); setSelected(new Set()); }}>
              {massMode ? 'Exit Mass Edit' : 'Mass Edit'}
            </button>
            <button className={styles.newContactBtn} onClick={() => setEditContact(null)}>+ New Contact</button>
            <button className={styles.bulkUploadBtn} onClick={() => setShowBulkUpload(true)}>Bulk Upload</button>
            {enrichedContacts.some(c => !c.company && c.guessedCompany && !dismissedGuesses[`${c.id}_company`]) && (
              <button className={styles.copyAllGuessBtn} onClick={handleCopyAllGuessedCompanies} disabled={massProcessing}>
                {massProcessing ? 'Copying...' : `Copy All Guessed Companies (${enrichedContacts.filter(c => !c.company && c.guessedCompany && !dismissedGuesses[`${c.id}_company`]).length})`}
              </button>
            )}
            {enrichedContacts.some(c => c.guessedName && (!c.firstname || !c.lastname) && !dismissedGuesses[`${c.id}_name`]) && (
              <button className={styles.copyAllGuessBtn} onClick={handleCopyAllGuessedNames} disabled={massProcessing}>
                {massProcessing ? 'Copying...' : `Copy All Guessed Names (${enrichedContacts.filter(c => c.guessedName && (!c.firstname || !c.lastname) && !dismissedGuesses[`${c.id}_name`]).length})`}
              </button>
            )}
          </div>
          {massMode && selected.size > 0 && (
            <div className={styles.massToolbar}>
              <span className={styles.massSelectedCount}>{selected.size} selected</span>
              <select className={styles.massFieldSelect} value={massField} onChange={e => setMassField(e.target.value)}>
                <option value="company">Company</option>
                <option value="jobtitle">Job Title</option>
                <option value="phone">Phone</option>
                <option value="firstname">First Name</option>
                <option value="lastname">Last Name</option>
              </select>
              <input className={styles.massValueInput} type="text" placeholder="New value..." value={massValue} onChange={e => setMassValue(e.target.value)} />
              <button className={styles.massApplyBtn} onClick={handleMassUpdate} disabled={massProcessing || !massValue.trim()}>
                {massProcessing ? 'Updating...' : 'Apply to Selected'}
              </button>
              <button className={styles.massCopyGuessBtn} onClick={handleCopyGuessedCompany} disabled={massProcessing}>
                {massProcessing ? 'Copying...' : 'Copy Guessed Company'}
              </button>
              <button className={styles.massDeleteBtn} onClick={handleMassDelete} disabled={massProcessing}>
                {massProcessing ? 'Deleting...' : 'Delete Selected'}
              </button>
            </div>
          )}
          {pushStatus && (
            <div className={pushStatus.type === 'success' ? styles.successMsg : styles.error}>
              {pushStatus.message}
            </div>
          )}
          {bulkErrors.length > 0 && (
            <div className={styles.bulkErrorsSection}>
              <div className={styles.bulkErrorsHeader}>
                <span className={styles.bulkErrorsTitle}>{bulkErrors.length} failed contacts</span>
                <button className={styles.bulkErrorsDownload} onClick={() => downloadFailedExcel(bulkErrors)}>Download Failed Excel</button>
                <button className={styles.bulkErrorsDismiss} onClick={() => setBulkErrors([])}>Dismiss</button>
              </div>
              <div className={styles.bulkErrorsList}>
                {bulkErrors.slice(0, 20).map((e, i) => (
                  <div key={i} className={styles.bulkErrorItem}>
                    <span className={styles.bulkErrorCategory}>{e.category || categorizeError(e.reason)}</span>
                    <span className={styles.bulkErrorName}>{[e.firstname, e.lastname].filter(Boolean).join(' ') || e.email || 'Unknown'}</span>
                    <span className={styles.bulkErrorReason}>{e.reason}</span>
                  </div>
                ))}
                {bulkErrors.length > 20 && <div className={styles.bulkErrorItem}><span className={styles.bulkErrorReason}>...and {bulkErrors.length - 20} more</span></div>}
              </div>
            </div>
          )}
          <DataTable
            tableId="hubspot-contacts"
            columns={[
              ...(massMode ? [{ key: '_select', label: '', defaultWidth: 36, render: (c) => <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} onClick={e => e.stopPropagation()} style={{ accentColor: 'var(--color-accent)' }} /> }] : []),
              { key: 'firstname', label: 'First Name', defaultWidth: 120, render: (c) => <HubSpotInlineCell contact={c} field="firstname" value={c.firstname} onSave={handleInlineUpdate} /> },
              { key: 'lastname', label: 'Last Name', defaultWidth: 120, render: (c) => <HubSpotInlineCell contact={c} field="lastname" value={c.lastname} onSave={handleInlineUpdate} /> },
              { key: 'email', label: 'Email', defaultWidth: 200, render: (c) => <HubSpotInlineCell contact={c} field="email" value={c.email} onSave={handleInlineUpdate} /> },
              { key: 'phone', label: 'Phone', defaultWidth: 130, render: (c) => <HubSpotInlineCell contact={c} field="phone" value={c.phone} onSave={handleInlineUpdate} /> },
              { key: 'company', label: 'Company', defaultWidth: 180, render: (c) => <HubSpotInlineCell contact={c} field="company" value={c.company} onSave={handleInlineUpdate} suggestions={prospectCompanyNames} /> },
              { key: 'tier', label: 'Tier', defaultWidth: 140, render: (c) => {
                if (c.tier === 'Not Targeted') return <span style={{ fontSize: '0.68rem', color: '#9CA3AF', fontStyle: 'italic' }}>Not Targeted</span>;
                const colors = { 'Tier 1': { bg: '#FEE2E2', color: '#991B1B' }, 'Tier 2': { bg: '#DBEAFE', color: '#1E40AF' } };
                const style = colors[c.tier] || { bg: '#F3F4F6', color: '#6B7280' };
                return <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: style.bg, color: style.color }}>{c.tier}</span>;
              }},
              { key: 'guessedCompany', label: 'Guessed Company', defaultWidth: 180, render: (c) => {
                if (dismissedGuesses[`${c.id}_company`]) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                const val = c.company || c.guessedCompany;
                if (!val) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                return <HubSpotInlineCell contact={c} field="company" value={val} onSave={async (id, updates) => {
                  const newVal = (updates.company || '').trim();
                  if (!newVal) { dismissGuess(c.id, 'company'); return; }
                  await handleInlineUpdate(id, updates);
                }} suggestions={prospectCompanyNames} />;
              }},
              { key: 'guessedName', label: 'Guessed Name', defaultWidth: 160, render: (c) => {
                if (dismissedGuesses[`${c.id}_name`]) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                const hasReal = c.firstname && c.lastname;
                const val = hasReal ? `${c.firstname} ${c.lastname}`.trim() : c.guessedName;
                if (!val) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                return <HubSpotInlineCell contact={c} field={!c.firstname ? 'firstname' : 'lastname'} value={val} onSave={async (id, updates) => {
                  const rawVal = (Object.values(updates)[0] || '').trim();
                  if (!rawVal) { dismissGuess(c.id, 'name'); return; }
                  const parts = rawVal.split(/\s+/);
                  const first = parts[0] || '';
                  const last = parts.slice(1).join(' ') || '';
                  await handleInlineUpdate(id, { firstname: first || c.guessedFirstName || c.firstname, lastname: last || c.guessedLastName || c.lastname });
                }} />;
              }},
              { key: 'jobtitle', label: 'Title', defaultWidth: 160, render: (c) => <HubSpotInlineCell contact={c} field="jobtitle" value={c.jobtitle} onSave={handleInlineUpdate} /> },
              { key: 'linkedin', label: 'LinkedIn', defaultWidth: 220, render: (c) => {
                const url = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid;
                if (!url) return <HubSpotInlineCell contact={c} field="hs_linkedin_url" value="" onSave={handleInlineUpdate} />;
                const href = url.startsWith('http') ? url : `https://linkedin.com/in/${url}`;
                const display = url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, '').replace(/\/$/, '');
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</a>
                  </span>
                );
              }},
              { key: 'city', label: 'City', defaultWidth: 110, render: (c) => <HubSpotInlineCell contact={c} field="city" value={c.city} onSave={handleInlineUpdate} /> },
              { key: 'state', label: 'State', defaultWidth: 80, render: (c) => <HubSpotInlineCell contact={c} field="state" value={c.state} onSave={handleInlineUpdate} /> },
              { key: 'country', label: 'Country', defaultWidth: 90, render: (c) => <HubSpotInlineCell contact={c} field="country" value={c.country} onSave={handleInlineUpdate} /> },
              { key: 'lastmodifieddate', label: 'Last Edited', defaultWidth: 130, render: (c) => {
                if (!c.lastmodifieddate) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                const d = new Date(c.lastmodifieddate);
                if (isNaN(d)) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                const now = Date.now();
                const diff = now - d.getTime();
                const mins = Math.floor(diff / 60000);
                const hrs = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                let relative;
                if (mins < 1) relative = 'Just now';
                else if (mins < 60) relative = `${mins}m ago`;
                else if (hrs < 24) relative = `${hrs}h ago`;
                else if (days < 7) relative = `${days}d ago`;
                else relative = fmtDate(c.lastmodifieddate);
                const isRecent = days < 1;
                return <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: isRecent ? 600 : 400, color: isRecent ? 'var(--color-accent)' : 'var(--color-text-secondary)' }} title={fmtDateTime(c.lastmodifieddate)}>{relative}</span>;
              }},
              { key: 'dans_tags', label: "Dan's Tags", defaultWidth: 160, render: (c) => <TagsMultiSelect contact={c} field="dans_tags" value={c.dans_tags || c.dan_s_tags || c.dans_tag} options={dansTagOptions} onSave={handleInlineUpdate} /> },
              { key: '_zoomCompanyName', label: 'Zoom Company', defaultWidth: 160, render: (c) => <HubSpotInlineCell contact={c} field="_zoomCompanyName" value={c._zoomCompanyName} onSave={handleInlineUpdate} /> },
              { key: '_zoomCompanyId', label: 'Zoom Company ID', defaultWidth: 120, render: (c) => <HubSpotInlineCell contact={c} field="_zoomCompanyId" value={c._zoomCompanyId} onSave={handleInlineUpdate} /> },
              { key: '_linkedinProfile', label: 'LinkedIn Profile', defaultWidth: 160, render: (c) => {
                const url = c._linkedinProfile || c.hs_linkedin_url || c.linkedin_url || '';
                if (!url) return <HubSpotInlineCell contact={c} field="_linkedinProfile" value="" onSave={handleInlineUpdate} />;
                const href = url.startsWith('http') ? url : `https://${url}`;
                return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', fontSize: 'var(--font-size-xs)', fontWeight: 600, textDecoration: 'none' }}>View</a>;
              }},
              { key: '_zoomWebsite', label: 'Zoom Website', defaultWidth: 150, render: (c) => <HubSpotInlineCell contact={c} field="_zoomWebsite" value={c._zoomWebsite} onSave={handleInlineUpdate} /> },
              { key: '_emailDomain', label: 'Email Domain', defaultWidth: 150, render: (c) => <HubSpotInlineCell contact={c} field="_emailDomain" value={c._emailDomain} onSave={handleInlineUpdate} /> },
              { key: 'sequenceStatus', label: 'Sequence Status', defaultWidth: 120, render: (c) => c.isEnrolled ? <span className={styles.enrolledBadge}>In Sequence</span> : <span className={styles.notEnrolledBadge}>Not Enrolled</span> },
              { key: 'lastSent', label: 'Last Email Sent', defaultWidth: 120, render: (c) => <span className={styles.dateText}>{fmtDate(c.hs_email_last_send_date)}</span> },
              { key: 'lastReply', label: 'Last Reply', defaultWidth: 120, render: (c) => <span className={styles.dateText}>{fmtDate(c.hs_sales_email_last_replied)}</span> },
              { key: 'lastOpen', label: 'Last Open', defaultWidth: 120, render: (c) => <span className={styles.dateText}>{fmtDate(c.hs_email_last_open_date)}</span> },
              { key: 'lastClick', label: 'Last Click', defaultWidth: 120, render: (c) => <span className={styles.dateText}>{fmtDate(c.hs_email_last_click_date)}</span> },
              { key: '_edit', label: '', defaultWidth: 36, render: (c) => <button onClick={(e) => { e.stopPropagation(); setEditContact(c); }} title="Edit contact" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '1px 6px', fontSize: '0.7rem', cursor: 'pointer', color: 'var(--color-accent)' }}>Edit</button> },
              { key: '_delete', label: '', defaultWidth: 40, render: (c) => <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); handleDeleteContact(c.id, [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email); }} title="Delete from HubSpot">&#x1F5D1;</button> },
            ]}
            rows={filteredContacts}
            alwaysVisible={[]}
            emptyMessage="No contacts found"
          />
        </>
      )}

      {editContact !== undefined && (
        <ContactModal
          contact={editContact}
          onSave={handleSaveContact}
          onClose={() => setEditContact(undefined)}
          saving={saving}
          companyNames={(() => {
            const names = new Set();
            (prospects || []).forEach(p => { if (p.company) names.add(p.company); });
            try {
              const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
              (cache?.contacts || []).forEach(c => { if (c.company) names.add(c.company); });
            } catch {}
            return [...names].sort();
          })()}
          tagOptions={dansTagOptions}
          ccMap={settings?.ccMap || {}}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveCcMap={m => updateSettings({ ccMap: m })}
          onSaveToAlsoMap={m => updateSettings({ toAlsoMap: m })}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={(contactId, oldEmails) => {
            const current = settings?.contactOldEmails || {};
            const next = { ...current };
            if (oldEmails && oldEmails.trim()) next[contactId] = oldEmails;
            else delete next[contactId];
            updateSettings({ contactOldEmails: next });
          }}
        />
      )}

      {showBulkUpload && (
        <BulkUploadModal
          onUpload={handleBulkUpload}
          onClose={() => setShowBulkUpload(false)}
          uploading={bulkUploading}
          progress={bulkProgress}
        />
      )}

      {tab === 'sequences' && (
        sequences.length === 0 ? (
          <div className={styles.empty}>No sequences found</div>
        ) : (
          sequences.map(seq => (
            <div key={seq.id} className={styles.seqCard}>
              <div className={styles.seqName}>{seq.name}</div>
              <div className={styles.seqMeta}>
                {seq.steps?.length || 0} steps
                {seq.updatedAt && <> &middot; Updated {fmtDate(seq.updatedAt)}</>}
              </div>
              {seq.enrollCount != null && (
                <div className={styles.seqMeta}>{seq.enrollCount} enrolled</div>
              )}
            </div>
          ))
        )
      )}

      {tab === 'campaigns' && (
        campaigns.length === 0 ? (
          <div className={styles.empty}>No campaigns found</div>
        ) : (
          campaigns.map(c => (
            <div key={c.id} className={styles.campaignCard}>
              <div className={styles.campaignName}>{c.name}</div>
              {c.subject && <div className={styles.campaignSubject}>Subject: {c.subject}</div>}
              <div className={styles.campaignStats}>
                {c.stats.sent != null && (
                  <div className={styles.campaignStat}>
                    <div className={styles.campaignStatValue}>{c.stats.sent?.toLocaleString()}</div>
                    <div className={styles.campaignStatLabel}>Sent</div>
                  </div>
                )}
                {c.stats.open != null && (
                  <div className={styles.campaignStat}>
                    <div className={styles.campaignStatValue}>{c.stats.open?.toLocaleString()}</div>
                    <div className={styles.campaignStatLabel}>Opened</div>
                  </div>
                )}
                {c.stats.click != null && (
                  <div className={styles.campaignStat}>
                    <div className={styles.campaignStatValue}>{c.stats.click?.toLocaleString()}</div>
                    <div className={styles.campaignStatLabel}>Clicked</div>
                  </div>
                )}
                {c.stats.replied != null && (
                  <div className={styles.campaignStat}>
                    <div className={styles.campaignStatValue}>{c.stats.replied?.toLocaleString()}</div>
                    <div className={styles.campaignStatLabel}>Replied</div>
                  </div>
                )}
              </div>
            </div>
          ))
        )
      )}
    </div>
  );
}
