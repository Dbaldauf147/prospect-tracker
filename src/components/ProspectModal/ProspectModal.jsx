import { useState, useMemo, useEffect, useRef } from 'react';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, ASSET_TYPES, FRAMEWORKS } from '../../data/enums';
import styles from './ProspectModal.module.css';

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  return false;
}

// ── Org Chart — 5-Bucket View ──

function getOrgKey(company) {
  return `orgchart-${(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

const BUCKETS = [
  { key: 'esg',             label: 'ESG Reporting',   tag: 'esg',             accent: '#059669', bg: '#ECFDF5', border: '#6EE7B7', headerBg: '#D1FAE5', headerColor: '#065F46' },
  { key: 'utilities',      label: 'Utilities',        tag: 'utilities',       accent: '#2563EB', bg: '#EFF6FF', border: '#93C5FD', headerBg: '#DBEAFE', headerColor: '#1E3A8A' },
  { key: 'procurement',    label: 'Procurement',      tag: 'procurement',     accent: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD', headerBg: '#EDE9FE', headerColor: '#4C1D95' },
  { key: 'capitalplanning',label: 'Capital Planning', tag: 'capital planning',accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A', headerBg: '#FEF3C7', headerColor: '#78350F' },
  { key: 'compliance',     label: 'Compliance',       tag: 'climate risk',    accent: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', headerBg: '#FEE2E2', headerColor: '#7F1D1D' },
];

const ROLE_COLORS = {
  'Decision Maker': { bg: '#DCFCE7', color: '#166534' },
  'Influencer':     { bg: '#DBEAFE', color: '#1E40AF' },
  'Left':           { bg: '#FEF9C3', color: '#92400E' },
  'Other':          { bg: '#F3E8FF', color: '#7C3AED' },
  'Unknown':        { bg: '#F3F4F6', color: '#6B7280' },
};

function getContactRole(c) {
  const r = c.decision_maker || 'Unknown';
  return (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : (r || 'Unknown');
}

function getContactTags(c) {
  const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
  return raw.split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
}

function OrgChart({ contacts, onDeleteContact, deletingContact, onEditContact }) {
  if (contacts.length === 0) {
    return <div style={{ fontSize: '0.78rem', color: '#9CA3AF', fontStyle: 'italic', padding: '1rem 0' }}>No contacts to display</div>;
  }

  // Assign each contact to buckets based on tags
  const bucketContacts = {};
  const untagged = [];
  for (const bucket of BUCKETS) bucketContacts[bucket.key] = [];

  for (const c of contacts) {
    const tags = getContactTags(c);
    let matched = false;
    for (const bucket of BUCKETS) {
      if (tags.some(t => t === bucket.tag)) {
        bucketContacts[bucket.key].push(c);
        matched = true;
      }
    }
    if (!matched) untagged.push(c);
  }

  function ContactCard({ contact, bucketAccent }) {
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || '—';
    const role = getContactRole(contact);
    const roleStyle = ROLE_COLORS[role] || ROLE_COLORS['Unknown'];
    const isDeleting = deletingContact === (contact.id || contact.vid);

    return (
      <div
        onClick={() => onEditContact && onEditContact(contact)}
        style={{
          background: '#fff',
          border: `1px solid #E2E8F0`,
          borderLeft: `3px solid ${bucketAccent}`,
          borderRadius: '6px',
          padding: '0.45rem 0.55rem',
          position: 'relative',
          cursor: 'pointer',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
      >
        {onDeleteContact && (
          <button
            onClick={e => { e.stopPropagation(); onDeleteContact(contact); }}
            disabled={isDeleting}
            title="Delete contact"
            style={{ position: 'absolute', top: '3px', right: '3px', background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.78rem', cursor: 'pointer', lineHeight: 1, padding: '1px 3px', zIndex: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
            onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
          >{isDeleting ? '…' : '×'}</button>
        )}
        <div style={{ fontWeight: 700, fontSize: '0.74rem', color: '#1E293B', paddingRight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        {contact.jobtitle && (
          <div style={{ fontSize: '0.62rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{contact.jobtitle}</div>
        )}
        <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center' }}>
          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: '999px', fontSize: '0.55rem', fontWeight: 700, background: roleStyle.bg, color: roleStyle.color, letterSpacing: '0.02em' }}>{role}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingBottom: '0.25rem', alignItems: 'flex-start' }}>
      {BUCKETS.map(bucket => {
        const items = bucketContacts[bucket.key];
        return (
          <div key={bucket.key} style={{ flex: '0 0 160px', minWidth: '160px', border: `1px solid ${bucket.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {/* Bucket header */}
            <div style={{ background: bucket.headerBg, padding: '0.35rem 0.55rem', borderBottom: `1px solid ${bucket.border}` }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: bucket.headerColor, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {bucket.label}
              </div>
              <div style={{ fontSize: '0.6rem', color: bucket.accent, fontWeight: 600, marginTop: '1px' }}>
                {items.length} contact{items.length !== 1 ? 's' : ''}
              </div>
            </div>
            {/* Cards */}
            <div style={{ padding: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', minHeight: '60px' }}>
              {items.length === 0
                ? <div style={{ fontSize: '0.62rem', color: '#CBD5E1', fontStyle: 'italic', textAlign: 'center', paddingTop: '0.5rem' }}>None</div>
                : items.map(c => <ContactCard key={c.id || c.email} contact={c} bucketAccent={bucket.accent} />)
              }
            </div>
          </div>
        );
      })}

      {/* Untagged bucket — always shown so you can see what tags contacts have */}
      <div style={{ flex: '0 0 160px', minWidth: '160px', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ background: '#F8FAFC', padding: '0.35rem 0.55rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Untagged</div>
          <div style={{ fontSize: '0.6rem', color: '#94A3B8', fontWeight: 600, marginTop: '1px' }}>{untagged.length} contact{untagged.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ padding: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', minHeight: '60px' }}>
          {untagged.length === 0
            ? <div style={{ fontSize: '0.62rem', color: '#CBD5E1', fontStyle: 'italic', textAlign: 'center', paddingTop: '0.5rem' }}>None</div>
            : untagged.map(c => {
                const rawTag = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').trim();
                return (
                  <div key={c.id || c.email}>
                    <ContactCard contact={c} bucketAccent="#94A3B8" />
                    {rawTag && <div style={{ fontSize: '0.55rem', color: '#94A3B8', marginTop: '2px', paddingLeft: '4px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rawTag}>tag: {rawTag}</div>}
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

const EMPTY = {
  company: '', cdm: '', status: 'Inside Sales', type: '', geography: '', publicPrivate: '',
  assetTypes: [], peAum: null, reAum: null, numberOfSites: null, rank: '', tier: 'Tier 2',
  hqRegion: '', frameworks: [], notes: '', website: '', emailDomain: '',
};

// ── Inline HubSpot Contact Editor ──
const ROLE_OPTIONS = ['Decision Maker', 'Influencer', 'Other', 'Left', 'Unknown'];
const TAG_OPTIONS = ['ESG', 'Utilities', 'Procurement', 'Capital Planning', 'Climate Risk'];

function ContactEditModal({ contact, onSave, onClose, tagOptions = TAG_OPTIONS }) {
  const rawTags = contact.dans_tags || contact.dan_s_tags || contact.dans_tag || '';
  // Parse existing tags; track which known tags are checked separately from free-text extras
  const parsedTags = rawTags.split(';').map(t => t.trim()).filter(Boolean);
  const knownTagsLower = new Set(tagOptions.map(t => t.toLowerCase()));

  const [f, setF] = useState({
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    email: contact.email || '',
    phone: contact.phone || '',
    jobtitle: contact.jobtitle || '',
    company: contact.company || '',
    decision_maker: (() => {
      const r = contact.decision_maker || 'Unknown';
      return (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : (r || 'Unknown');
    })(),
    hs_linkedin_url: contact.hs_linkedin_url || contact.linkedin_url || '',
  });
  // Checked state for the 5 known tags
  const [checkedTags, setCheckedTags] = useState(() =>
    new Set(parsedTags.filter(t => knownTagsLower.has(t.toLowerCase())).map(t => {
      // Normalise to the canonical casing
      return tagOptions.find(o => o.toLowerCase() === t.toLowerCase()) || t;
    }))
  );
  // Any extra tags not in TAG_OPTIONS are kept verbatim
  const extraTags = parsedTags.filter(t => !knownTagsLower.has(t.toLowerCase()));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagsRef = useRef(null);

  useEffect(() => {
    if (!tagsOpen) return;
    const h = e => { if (tagsRef.current && !tagsRef.current.contains(e.target)) setTagsOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [tagsOpen]);

  function toggleTag(tag) {
    setCheckedTags(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  function buildTagsString() {
    return [...checkedTags, ...extraTags].join(';');
  }

  function set(key, val) { setF(prev => ({ ...prev, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { decision_maker, ...hubspotFields } = f;
      const props = { ...hubspotFields, dans_tags: buildTagsString() };
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contact.id || contact.vid, properties: props }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Update localStorage cache so changes show immediately
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        if (cache?.contacts) {
          const idx = cache.contacts.findIndex(c => String(c.id || c.vid) === String(contact.id || contact.vid));
          if (idx !== -1) cache.contacts[idx] = { ...cache.contacts[idx], ...props };
          localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
        }
      } catch {}
      onSave({ ...contact, ...props });
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '3px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Edit HubSpot Contact</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div><label style={labelStyle}>First Name</label><input style={inputStyle} value={f.firstname} onChange={e => set('firstname', e.target.value)} /></div>
          <div><label style={labelStyle}>Last Name</label><input style={inputStyle} value={f.lastname} onChange={e => set('lastname', e.target.value)} /></div>
          <div><label style={labelStyle}>Email</label><input style={inputStyle} type="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
          <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Job Title</label><input style={inputStyle} value={f.jobtitle} onChange={e => set('jobtitle', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Company</label><input style={inputStyle} value={f.company} onChange={e => set('company', e.target.value)} /></div>
          <div>
            <label style={labelStyle}>Role</label>
            <select style={inputStyle} value={f.decision_maker} onChange={e => set('decision_maker', e.target.value)}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>LinkedIn URL</label><input style={inputStyle} value={f.hs_linkedin_url} onChange={e => set('hs_linkedin_url', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }} ref={tagsRef}>
            <label style={labelStyle}>Tags</label>
            <button
              type="button"
              onClick={() => setTagsOpen(p => !p)}
              style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: checkedTags.size === 0 ? '#94A3B8' : '#1E293B' }}
            >
              <span>
                {checkedTags.size === 0
                  ? 'Select tags…'
                  : [...checkedTags].join(', ')}
              </span>
              <span style={{ fontSize: '0.6rem', color: '#94A3B8' }}>{tagsOpen ? '▲' : '▼'}</span>
            </button>
            {tagsOpen && (
              <div style={{ marginTop: '2px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                {tagOptions.map(tag => {
                  const bucket = BUCKETS.find(b => b.tag === tag.toLowerCase());
                  return (
                    <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.7rem', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', background: checkedTags.has(tag) ? (bucket?.headerBg || '#F0F9FF') : '#fff' }}
                      onMouseEnter={e => { if (!checkedTags.has(tag)) e.currentTarget.style.background = '#F8FAFC'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = checkedTags.has(tag) ? (bucket?.headerBg || '#F0F9FF') : '#fff'; }}
                    >
                      <input
                        type="checkbox"
                        checked={checkedTags.has(tag)}
                        onChange={() => toggleTag(tag)}
                        style={{ accentColor: bucket?.accent || '#0078D4', width: '14px', height: '14px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.78rem', fontWeight: checkedTags.has(tag) ? 600 : 400, color: checkedTags.has(tag) ? (bucket?.headerColor || '#1E293B') : '#374151' }}>{tag}</span>
                      {checkedTags.has(tag) && bucket && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 700, color: bucket.headerColor, background: bucket.headerBg, padding: '1px 6px', borderRadius: '999px' }}>{bucket.label}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {error && <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', borderRadius: '6px', fontSize: '0.75rem', color: '#DC2626' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button onClick={onClose} style={{ padding: '0.5rem 1rem', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: '#64748B' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: '#0078D4', color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: saving ? 'wait' : 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save to HubSpot'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProspectModal({ prospect, onSave, onClose, isNew, hubspotContacts = [], onDeleteContact, orgCharts = {}, onUpdateOrgChart = () => {} }) {
  const [fields, setFields] = useState(() => {
    if (prospect) return { ...EMPTY, ...prospect };
    return { ...EMPTY };
  });

  // Local contact state — updated optimistically after HubSpot saves
  const baseContacts = useMemo(() => {
    if (!fields.company || isNew) return [];
    const ROLE_ORDER = { 'Decision Maker': 0, 'Influencer': 1, 'Other': 2, 'Left': 3, 'Unknown': 4 };
    function roleRank(c) {
      const r = c.decision_maker || 'Unknown';
      const normalized = (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
      return ROLE_ORDER[normalized] ?? 5;
    }
    return hubspotContacts
      .filter(c => companiesMatch(c.company, fields.company))
      .sort((a, b) => roleRank(a) - roleRank(b));
  }, [fields.company, hubspotContacts, isNew]);

  const [localContacts, setLocalContacts] = useState(baseContacts);
  useEffect(() => { setLocalContacts(baseContacts); }, [baseContacts]);
  const companyContacts = localContacts;

  // Collect all unique tags across all HubSpot contacts for the dropdown
  const allTagOptions = useMemo(() => {
    const tagSet = new Set();
    for (const c of hubspotContacts) {
      const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
      raw.split(';').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
    // Always include the 5 bucket tags
    TAG_OPTIONS.forEach(t => tagSet.add(t));
    return [...tagSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [hubspotContacts]);

  const [contactView, setContactView] = useState('table'); // 'table' | 'orgchart'
  const [editingContact, setEditingContact] = useState(null);
  const [showSaved, setShowSaved] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);

  function handleContactSaved(updated) {
    setLocalContacts(prev => prev.map(c => (String(c.id || c.vid) === String(updated.id || updated.vid) ? { ...c, ...updated } : c)));
    setEditingContact(null);
  }

  async function handleDeleteContact(contact) {
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'this contact';
    if (!window.confirm(`Delete ${name} from HubSpot? This cannot be undone.`)) return;
    const cid = contact.id || contact.vid;
    if (!cid) return;
    setDeletingContact(cid);
    try {
      const res = await fetch(`/api/hubspot?action=delete-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: cid }),
      });
      if (!res.ok) throw new Error('Delete failed');
      // Remove from local HubSpot cache
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        if (cache?.contacts) {
          cache.contacts = cache.contacts.filter(c => String(c.id || c.vid) !== String(cid));
          localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
        }
      } catch {}
      if (onDeleteContact) onDeleteContact(cid);
    } catch (err) {
      alert('Failed to delete contact: ' + (err.message || 'Unknown error'));
    }
    setDeletingContact(null);
  }
  const initialRef = useRef(true);
  const saveTimerRef = useRef(null);

  function set(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function toggleArrayField(key, value) {
    setFields(prev => {
      const arr = prev[key] || [];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  // Auto-save on every change (debounced 600ms)
  useEffect(() => {
    if (isNew || initialRef.current) {
      initialRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!fields.company?.trim()) return;
      const data = { ...fields };
      data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
      data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
      data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
      delete data.id;
      delete data.createdAt;
      delete data.updatedAt;
      onSave(data);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    }, 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [fields]);

  function handleSave() {
    if (!fields.company.trim()) return;
    const data = { ...fields };
    data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
    data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
    data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    onSave(data);
  }

  function handlePrint() {
    const win = window.open('', '_blank');
    if (!win) { alert('Please allow popups to export PDF'); return; }
    const roleColors = { 'Decision Maker': '#166534', 'Influencer': '#1E40AF', 'Left': '#92400E', 'Other': '#7C3AED', 'Hide': '#991B1B', 'Unknown': '#6B7280' };
    const roleBgs = { 'Decision Maker': '#DCFCE7', 'Influencer': '#DBEAFE', 'Left': '#FEF9C3', 'Other': '#F3E8FF', 'Hide': '#FEE2E2', 'Unknown': '#F3F4F6' };

    let contactRows = '';
    for (const c of companyContacts) {
      const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || '—';
      const r = c.decision_maker || 'Unknown';
      const role = (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
      const linkedin = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid || '';
      contactRows += `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-weight:600">${name}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.jobtitle || '—'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.email || '—'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${c.phone || '—'}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0"><span style="padding:1px 6px;border-radius:999px;font-size:0.7rem;font-weight:700;background:${roleBgs[role] || '#F3F4F6'};color:${roleColors[role] || '#6B7280'}">${role}</span></td>
        <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0">${linkedin ? `<a href="${linkedin.startsWith('http') ? linkedin : 'https://linkedin.com/in/' + linkedin}">${linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}</a>` : '—'}</td>
      </tr>`;
    }

    const f = fields;
    win.document.write(`<!DOCTYPE html><html><head><title>${f.company} — Prospect Report</title>
      <style>body{font-family:Arial,sans-serif;max-width:1000px;margin:0 auto;padding:20px;color:#1E293B}
      h1{font-size:1.5rem;margin-bottom:4px}table{width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:8px}
      th{text-align:left;padding:6px 8px;background:#F8FAFC;border-bottom:2px solid #E2E8F0;font-size:0.72rem;text-transform:uppercase;color:#64748B;letter-spacing:0.03em}
      .info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0;font-size:0.85rem}
      .info-item{padding:6px 10px;background:#F8FAFC;border-radius:6px}.info-label{font-size:0.7rem;color:#64748B;text-transform:uppercase;letter-spacing:0.03em;font-weight:600}.info-val{font-weight:600;margin-top:2px}
      a{color:#0A66C2;text-decoration:none}@media print{body{padding:10px}}</style></head><body>
      <h1>${f.company}</h1>
      <div style="color:#64748B;font-size:0.85rem;margin-bottom:12px">Generated ${new Date().toLocaleDateString()}</div>
      <div class="info">
        <div class="info-item"><div class="info-label">Status</div><div class="info-val">${f.status || '—'}</div></div>
        <div class="info-item"><div class="info-label">Tier</div><div class="info-val">${f.tier || '—'}</div></div>
        <div class="info-item"><div class="info-label">Type</div><div class="info-val">${f.type || '—'}</div></div>
        <div class="info-item"><div class="info-label">Geography</div><div class="info-val">${f.geography || '—'}</div></div>
        <div class="info-item"><div class="info-label">Public/Private</div><div class="info-val">${f.publicPrivate || '—'}</div></div>
        <div class="info-item"><div class="info-label">CDM</div><div class="info-val">${f.cdm || '—'}</div></div>
        <div class="info-item"><div class="info-label">RE AUM</div><div class="info-val">${f.reAum != null ? '$' + f.reAum + 'B' : '—'}</div></div>
        <div class="info-item"><div class="info-label">PE AUM</div><div class="info-val">${f.peAum != null ? '$' + f.peAum + 'B' : '—'}</div></div>
        <div class="info-item"><div class="info-label">Sites</div><div class="info-val">${f.numberOfSites ?? '—'}</div></div>
        <div class="info-item"><div class="info-label">HQ Region</div><div class="info-val">${f.hqRegion || '—'}</div></div>
        <div class="info-item"><div class="info-label">Website</div><div class="info-val">${f.website ? `<a href="${f.website.startsWith('http') ? f.website : 'https://' + f.website}">${f.website}</a>` : '—'}</div></div>
        <div class="info-item"><div class="info-label">Email Domain</div><div class="info-val">${f.emailDomain || '—'}</div></div>
      </div>
      ${f.notes ? `<div style="margin:12px 0;padding:8px 12px;background:#F8FAFC;border-radius:6px;font-size:0.85rem"><strong style="font-size:0.72rem;color:#64748B;text-transform:uppercase">Notes</strong><div style="margin-top:4px">${f.notes}</div></div>` : ''}
      <h2 style="font-size:1.1rem;margin-top:20px;margin-bottom:4px">Contacts (${companyContacts.length})</h2>
      ${companyContacts.length > 0 ? `<table><thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th><th>Role</th><th>LinkedIn</th></tr></thead><tbody>${contactRows}</tbody></table>` : '<div style="color:#9CA3AF;font-style:italic;margin-top:8px">No HubSpot contacts found</div>'}
      <div style="margin-top:24px;font-size:0.7rem;color:#9CA3AF">Prospect Tracker — ${new Date().toLocaleString()}</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isNew ? 'Add Prospect' : fields.company}</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>
          <div className={styles.grid}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Company</label>
              <input className={styles.input} value={fields.company} onChange={e => set('company', e.target.value)} placeholder="Company name" />
            </div>

            <div>
              <label className={styles.label}>Status</label>
              <select className={styles.select} value={fields.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Tier</label>
              <select className={styles.select} value={fields.tier} onChange={e => set('tier', e.target.value)}>
                <option value="">—</option>
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Type</label>
              <select className={styles.select} value={fields.type} onChange={e => set('type', e.target.value)}>
                <option value="">—</option>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Geography</label>
              <select className={styles.select} value={fields.geography} onChange={e => set('geography', e.target.value)}>
                <option value="">—</option>
                {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Public / Private</label>
              <select className={styles.select} value={fields.publicPrivate} onChange={e => set('publicPrivate', e.target.value)}>
                <option value="">—</option>
                {PUBLIC_PRIVATE.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>CDM</label>
              <input className={styles.input} value={fields.cdm} onChange={e => set('cdm', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>RE AUM (billions)</label>
              <input className={styles.input} type="number" step="0.01" value={fields.reAum ?? ''} onChange={e => set('reAum', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>PE AUM (billions)</label>
              <input className={styles.input} type="number" step="0.01" value={fields.peAum ?? ''} onChange={e => set('peAum', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Number of Sites</label>
              <input className={styles.input} type="number" value={fields.numberOfSites ?? ''} onChange={e => set('numberOfSites', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Rank</label>
              <input className={styles.input} value={fields.rank} onChange={e => set('rank', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>HQ Region</label>
              <input className={styles.input} value={fields.hqRegion} onChange={e => set('hqRegion', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Website</label>
              <input className={styles.input} value={fields.website} onChange={e => set('website', e.target.value)} placeholder="www.example.com" />
            </div>

            <div>
              <label className={styles.label}>Email Domain</label>
              <input className={styles.input} value={fields.emailDomain} onChange={e => set('emailDomain', e.target.value)} placeholder="firstname.lastname@domain.com" />
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Asset Types</label>
              <div className={styles.checkGroup}>
                {ASSET_TYPES.map(at => (
                  <label key={at} className={styles.checkItem}>
                    <input className={styles.checkBox} type="checkbox" checked={(fields.assetTypes || []).includes(at)} onChange={() => toggleArrayField('assetTypes', at)} />
                    {at}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Frameworks</label>
              <div className={styles.checkGroup}>
                {FRAMEWORKS.map(fw => (
                  <label key={fw} className={styles.checkItem}>
                    <input className={styles.checkBox} type="checkbox" checked={(fields.frameworks || []).includes(fw)} onChange={() => toggleArrayField('frameworks', fw)} />
                    {fw}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Notes</label>
              <textarea className={styles.textarea} value={fields.notes} onChange={e => set('notes', e.target.value)} rows={3} />
            </div>
          </div>

          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <label className={styles.label} style={{ margin: 0 }}>
                  Contacts {companyContacts.length > 0 ? `(${companyContacts.length})` : ''}
                </label>
                <div style={{ display: 'flex', gap: '0.25rem', background: '#F1F5F9', borderRadius: '6px', padding: '2px' }}>
                  <button
                    onClick={() => setContactView('table')}
                    style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: contactView === 'table' ? '#fff' : 'transparent', color: contactView === 'table' ? '#1E293B' : '#94A3B8', boxShadow: contactView === 'table' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}
                  >Table</button>
                  <button
                    onClick={() => setContactView('orgchart')}
                    style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: contactView === 'orgchart' ? '#fff' : 'transparent', color: contactView === 'orgchart' ? '#1E293B' : '#94A3B8', boxShadow: contactView === 'orgchart' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none' }}
                  >By Category</button>
                </div>
              </div>

              {contactView === 'orgchart' ? (
                <OrgChart contacts={companyContacts} onDeleteContact={handleDeleteContact} deletingContact={deletingContact} onEditContact={setEditingContact} />
              ) : companyContacts.length > 0 ? (
                <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Name</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Title</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Tags</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Category</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Email</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Phone</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Role</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>LinkedIn</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyContacts.map((c, i) => {
                        const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
                        const r = c.decision_maker || 'Unknown';
                        const role = (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
                        const roleColors = { 'Decision Maker': { bg: '#DCFCE7', color: '#166534' }, 'Influencer': { bg: '#DBEAFE', color: '#1E40AF' }, 'Left': { bg: '#FEF9C3', color: '#92400E' }, 'Other': { bg: '#F3E8FF', color: '#7C3AED' }, 'Unknown': { bg: '#F3F4F6', color: '#6B7280' } };
                        const rs = roleColors[role] || roleColors['Unknown'];
                        const linkedinUrl = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid;
                        return (
                          <tr key={c.id || i} onClick={() => setEditingContact(c)} style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                            <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>{name || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.jobtitle || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem', color: '#475569' }}>
                              {(c.dans_tags || c.dan_s_tags || c.dans_tag || '—')}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', maxWidth: '180px' }}>
                              {(() => {
                                const matched = BUCKETS.filter(b => getContactTags(c).includes(b.tag));
                                if (matched.length === 0) return <span style={{ fontSize: '0.62rem', color: '#CBD5E1' }}>—</span>;
                                return <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                  {matched.map(b => <span key={b.key} style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: b.headerBg, color: b.headerColor, whiteSpace: 'nowrap' }}>{b.label}</span>)}
                                </span>;
                              })()}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}><span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700, background: rs.bg, color: rs.color }}>{role}</span></td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              {linkedinUrl ? <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://linkedin.com/in/${linkedinUrl}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#0A66C2', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' }}>View</a> : <span style={{ color: '#CBD5E1' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.3rem', textAlign: 'center' }}>
                              <button
                                onClick={e => { e.stopPropagation(); handleDeleteContact(c); }}
                                disabled={deletingContact === (c.id || c.vid)}
                                title="Delete contact"
                                style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}
                                onMouseEnter={e => e.target.style.color = '#EF4444'}
                                onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                              >{deletingContact === (c.id || c.vid) ? '...' : '×'}</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: '#9CA3AF', fontStyle: 'italic' }}>No HubSpot contacts found for this company</div>
              )}
            </div>
          )}
        </div>
        <div className={styles.footer}>
          {!isNew && (
            <button style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit', color: 'var(--color-text-secondary)', cursor: 'pointer' }} onClick={handlePrint}>
              Export PDF
            </button>
          )}
          {showSaved && (
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', background: '#DCFCE7', padding: '0.25rem 0.6rem', borderRadius: '4px', animation: 'savedFadeModal 1.5s ease-out forwards' }}>
              Saved!
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className={styles.cancelBtn} onClick={onClose}>Close</button>
          {isNew && (
            <button className={styles.saveBtn} onClick={handleSave} disabled={!fields.company.trim()}>
              Add Prospect
            </button>
          )}
        </div>
      </div>
      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          onSave={handleContactSaved}
          onClose={() => setEditingContact(null)}
          tagOptions={allTagOptions}
        />
      )}
    </div>
  );
}
