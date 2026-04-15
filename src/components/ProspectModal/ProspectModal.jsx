import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { asBlob as htmlToDocxBlob } from 'html-docx-js-typescript';
import mammoth from 'mammoth/mammoth.browser';
import raClientsData from '../../data/raClients.json';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, ASSET_TYPES, FRAMEWORKS, SERVICE_CATEGORIES, SERVICE_STATUSES, COUNTRIES } from '../../data/enums';
import styles from './ProspectModal.module.css';

function loadOppsFromIndexedDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('prospect-tracker-db', 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('target-accounts')) d.createObjectStore('target-accounts');
        if (!d.objectStoreNames.contains('opps-cache')) d.createObjectStore('opps-cache');
        if (!d.objectStoreNames.contains('clients-cache')) d.createObjectStore('clients-cache');
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction('opps-cache', 'readonly');
        const store = tx.objectStore('opps-cache');
        const getReq = store.get('data');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function loadClientsFromIndexedDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('prospect-tracker-db', 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('target-accounts')) d.createObjectStore('target-accounts');
        if (!d.objectStoreNames.contains('opps-cache')) d.createObjectStore('opps-cache');
        if (!d.objectStoreNames.contains('clients-cache')) d.createObjectStore('clients-cache');
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction('clients-cache', 'readonly');
        const store = tx.objectStore('clients-cache');
        const getReq = store.get('data');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

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
  { key: 'esg',             label: 'ESG',              tag: 'esg',              accent: '#059669', bg: '#ECFDF5', border: '#6EE7B7', headerBg: '#D1FAE5', headerColor: '#065F46' },
  { key: 'procurement',    label: 'Procurement',      tag: 'procurement',     accent: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD', headerBg: '#EDE9FE', headerColor: '#4C1D95' },
  { key: 'utilities',      label: 'Utilities',        tag: 'utilities',       accent: '#2563EB', bg: '#EFF6FF', border: '#93C5FD', headerBg: '#DBEAFE', headerColor: '#1E3A8A' },
  { key: 'climaterisk',    label: 'Climate Risk',     tag: 'climate risk',    accent: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', headerBg: '#FEE2E2', headerColor: '#7F1D1D' },
  { key: 'capitalplanning',label: 'Capital Planning', tag: 'capital planning',accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A', headerBg: '#FEF3C7', headerColor: '#78350F' },
];

function contactHasTag(c, tag) {
  return getContactTags(c).includes(tag.toLowerCase());
}

function contactIsHidden(c) {
  return contactHasTag(c, 'hide');
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
    const isDM = contactHasTag(contact, 'decision maker');
    const isDeleting = deletingContact === (contact.id || contact.vid);

    return (
      <div
        onClick={() => onEditContact && onEditContact(contact)}
        style={{
          background: isDM ? '#FEFCE8' : '#fff',
          border: isDM ? '2px solid #F59E0B' : '1px solid #E2E8F0',
          borderLeft: `3px solid ${isDM ? '#F59E0B' : bucketAccent}`,
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
        <div style={{ fontWeight: 700, fontSize: '0.74rem', color: '#1E293B', paddingRight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {name}
          {isDM && <span style={{ fontSize: '0.5rem', fontWeight: 700, color: '#92400E', background: '#FDE68A', padding: '0px 4px', borderRadius: '3px', flexShrink: 0 }}>DM</span>}
        </div>
        {contact.jobtitle && (
          <div style={{ fontSize: '0.62rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{contact.jobtitle}</div>
        )}
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
  hqRegion: '', frameworks: [], notes: '', website: '', emailDomain: '', servicesExplored: {}, serviceNotes: {}, competitors: {}, portfolioCompanies: [],
};

// ── Inline HubSpot Contact Editor ──
const TAG_OPTIONS = ['ESG', 'Procurement', 'Private Equity', 'Real Estate', 'Capital Planning', 'Dan Key Target', 'Test', 'EU'];

const ContactEditModal = memo(function ContactEditModal({ contact, onSave, onClose, tagOptions = TAG_OPTIONS, contactNotes = {}, onSaveNote, contactOldEmails = {}, onSaveOldEmails, contactNicknames = {}, onSaveNickname, emailDomains = [] }) {
  const rawTags = contact.dans_tags || contact.dan_s_tags || contact.dans_tag || '';
  // Parse existing tags; track which known tags are checked separately from free-text extras
  const parsedTags = rawTags.split(';').map(t => t.trim()).filter(Boolean);
  const knownTagsLower = new Set(tagOptions.map(t => t.toLowerCase()));

  const cid = contact.id || contact.vid;
  const savedNote = (cid && contactNotes[cid]) || contact.notes || contact.hs_content_membership_notes || contact.message || '';
  const savedOldEmails = (cid && contactOldEmails[cid]) || '';
  const savedNickname = (cid && contactNicknames[cid]) || '';

  const [f, setF] = useState({
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    email: contact.email || '',
    phone: contact.phone || '',
    jobtitle: contact.jobtitle || '',
    company: contact.company || '',
    hs_linkedin_url: contact.hs_linkedin_url || contact.linkedin_url || '',
    city: contact.city || '',
    state: contact.state || '',
    country: contact.country || '',
    nickname: savedNickname,
    notes: savedNote,
    oldEmails: savedOldEmails,
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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagsRef = useRef(null);

  useEffect(() => {
    if (!tagsOpen) return;
    const h = e => { if (tagsRef.current && !tagsRef.current.contains(e.target)) setTagsOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [tagsOpen]);

  const [tagsSaveStatus, setTagsSaveStatus] = useState('');

  function buildTagsStringFrom(set) {
    return [...set, ...extraTags].join(';');
  }

  function buildTagsString() {
    return buildTagsStringFrom(checkedTags);
  }

  async function persistTags(nextSet) {
    const cid = contact.id || contact.vid;
    if (!cid) return; // new contact — save will include tags on create
    const tagsStr = buildTagsStringFrom(nextSet);
    setTagsSaveStatus('Saving tag…');
    try {
      const res = await fetch(`/api/hubspot?action=update-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: cid, properties: { dans_tags: tagsStr } }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
      // Update local cache so the main view reflects the change immediately
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        if (cache?.contacts) {
          const idx = cache.contacts.findIndex(c => String(c.id || c.vid) === String(cid));
          if (idx !== -1) cache.contacts[idx] = { ...cache.contacts[idx], dans_tags: tagsStr };
          try { localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache)); } catch {}
          window.dispatchEvent(new Event('hubspot-cache-updated'));
        }
      } catch {}
      onSave({ ...contact, dans_tags: tagsStr });
      setTagsSaveStatus('Saved ✓');
      setTimeout(() => setTagsSaveStatus(''), 1500);
    } catch (err) {
      console.error('[ContactEditModal] Tag autosave failed:', err);
      setTagsSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setTagsSaveStatus(''), 4000);
    }
  }

  function toggleTag(tag) {
    setCheckedTags(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      persistTags(next);
      return next;
    });
  }

  function set(key, val) { setF(prev => ({ ...prev, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const allProps = { ...f, dans_tags: buildTagsString() };
      // HubSpot doesn't have 'notes', 'oldEmails', or 'nickname' properties — save separately
      const { notes, oldEmails, nickname, ...hsProps } = allProps;
      const noteValue = notes || '';
      const oldEmailsValue = oldEmails || '';
      const nicknameValue = nickname || '';
      const existingId = contact.id || contact.vid;
      const isLocalOnly = typeof existingId === 'string' && existingId.startsWith('local-');
      let isNew = !existingId || isLocalOnly;
      let action = isNew ? 'create-contact' : 'update-contact';
      let body = isNew
        ? { properties: hsProps }
        : { contactId: contact.id || contact.vid, properties: hsProps };
      let res = await fetch(`/api/hubspot?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let json = await res.json();
      // If create failed because the contact already exists, retry as an update using the existing HubSpot id
      if (isNew && !res.ok) {
        const msg = json?.message || json?.error || '';
        const existingIdMatch = String(msg).match(/Existing ID[:\s]+(\d+)/i);
        if (existingIdMatch) {
          const dupId = existingIdMatch[1];
          action = 'update-contact';
          body = { contactId: dupId, properties: hsProps };
          res = await fetch(`/api/hubspot?action=${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          json = await res.json();
          if (res.ok) {
            isNew = false;
            contact.id = dupId; // so downstream savedContact carries it
          }
        }
      }
      if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
      // Include notes in the saved contact (stored locally)
      const savedContact = isNew ? { id: json.id, ...allProps } : { ...contact, ...allProps };
      // Update localStorage cache (exclude notes/oldEmails — those live in Firestore settings)
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        if (cache?.contacts) {
          const cacheProps = { ...hsProps };
          if (isNew) {
            // If this was promoted from a local-only contact, remove the old local entry so we don't duplicate
            if (isLocalOnly && existingId) {
              cache.contacts = cache.contacts.filter(c => String(c.id || c.vid) !== String(existingId));
            }
            cache.contacts.push({ id: savedContact.id, ...cacheProps });
          } else {
            const idx = cache.contacts.findIndex(c => String(c.id || c.vid) === String(contact.id || contact.vid));
            if (idx !== -1) cache.contacts[idx] = { ...cache.contacts[idx], ...cacheProps };
          }
          try {
            localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
          } catch (qerr) {
            console.warn('HubSpot cache write skipped (quota):', qerr.message);
          }
          window.dispatchEvent(new Event('hubspot-cache-updated'));
        }
      } catch {}
      // Save note & old emails to Firestore settings (cross-device)
      const savedCid = savedContact.id || savedContact.vid;
      if (savedCid && onSaveNote) {
        onSaveNote(savedCid, noteValue);
      }
      if (savedCid && onSaveOldEmails) {
        onSaveOldEmails(savedCid, oldEmailsValue);
      }
      if (savedCid && onSaveNickname) {
        onSaveNickname(savedCid, nicknameValue);
      }
      onSave(savedContact);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '3px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { e.stopPropagation(); onClose(); }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '880px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>{(!contact.id && !contact.vid) ? 'New HubSpot Contact' : 'Edit HubSpot Contact'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          <div><label style={labelStyle}>First Name</label><input style={inputStyle} value={f.firstname} onChange={e => set('firstname', e.target.value)} /></div>
          <div><label style={labelStyle}>Last Name</label><input style={inputStyle} value={f.lastname} onChange={e => set('lastname', e.target.value)} /></div>
          <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><label style={labelStyle}>Nickname <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(opt.)</span></label><input style={inputStyle} value={f.nickname} onChange={e => set('nickname', e.target.value)} placeholder="e.g. Bob" /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Email <span style={{ fontWeight: 400, textTransform: 'none', color: '#DC2626' }}>*</span></label>
            <input style={inputStyle} type="email" value={f.email} onChange={e => set('email', e.target.value)} />
            {(() => {
              const isNewContact = !contact.id && !contact.vid;
              if (!isNewContact) return null;
              const first = (f.firstname || '').toLowerCase().trim().replace(/[^a-z]/g, '');
              const last = (f.lastname || '').toLowerCase().trim().replace(/[^a-z]/g, '');
              if (!first && !last) return null;
              const domains = (emailDomains || []).filter(Boolean);
              if (domains.length === 0) return null;
              const suggestions = [];
              for (const d of domains) {
                let domain = d.replace(/^@/, '').trim();
                // If a full email was provided, extract only the domain part
                if (domain.includes('@')) domain = domain.split('@').pop();
                if (!domain || !domain.includes('.')) continue;
                if (first && last) {
                  suggestions.push(`${first}.${last}@${domain}`);
                  suggestions.push(`${first}${last}@${domain}`);
                  suggestions.push(`${first[0]}${last}@${domain}`);
                }
                if (first) suggestions.push(`${first}@${domain}`);
              }
              const unique = [...new Set(suggestions)];
              if (unique.length === 0) return null;
              return (
                <div style={{ marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.65rem', color: '#64748B', alignSelf: 'center' }}>Suggest:</span>
                  {unique.map(s => (
                    <button key={s} type="button" onClick={() => set('email', s)} style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', border: '1px solid #BFDBFE', borderRadius: '999px', background: '#EFF6FF', color: '#1E40AF', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                  ))}
                </div>
              );
            })()}
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Job Title</label><input style={inputStyle} value={f.jobtitle} onChange={e => set('jobtitle', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Company</label><input style={inputStyle} value={f.company} onChange={e => set('company', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>LinkedIn URL</label><input style={inputStyle} value={f.hs_linkedin_url} onChange={e => set('hs_linkedin_url', e.target.value)} /></div>
          <div><label style={labelStyle}>City</label><input style={inputStyle} value={f.city} onChange={e => set('city', e.target.value)} /></div>
          <div><label style={labelStyle}>State</label><input style={inputStyle} value={f.state} onChange={e => set('state', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Country</label>
            <input style={inputStyle} list="country-list" value={f.country} onChange={e => set('country', e.target.value)} placeholder="Start typing..." />
            <datalist id="country-list">
              {COUNTRIES.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Old Emails <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(comma-separated, inactive)</span></label><input style={inputStyle} value={f.oldEmails} onChange={e => set('oldEmails', e.target.value)} placeholder="old.email@company.com" /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Notes</label><textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px', lineHeight: 1.4 }} value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Add notes about this contact..." /></div>
          <div style={{ gridColumn: 'span 2' }} ref={tagsRef}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>Tags</span>
              {tagsSaveStatus && (
                <span style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: tagsSaveStatus.startsWith('Saved') ? '#10B981' : tagsSaveStatus.startsWith('Sav') ? '#64748B' : '#DC2626' }}>{tagsSaveStatus}</span>
              )}
            </label>
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
          <button
            onClick={handleSave}
            disabled={saving || saved || !f.email.trim()}
            title={!f.email.trim() ? 'Email is required' : ''}
            style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: saved ? '#059669' : (!f.email.trim() ? '#94A3B8' : '#0078D4'), color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: (!f.email.trim() || saving) ? 'not-allowed' : 'pointer', fontWeight: 600, transition: 'background 0.2s', opacity: (!f.email.trim() && !saved) ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved!' : !f.email.trim() ? 'Email required' : (!contact.id && !contact.vid) ? 'Create in HubSpot' : 'Save to HubSpot'}
          </button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  const prevId = prev.contact.id || prev.contact.vid;
  const nextId = next.contact.id || next.contact.vid;
  const domainsEqual = (prev.emailDomains || []).join('|') === (next.emailDomains || []).join('|');
  return prevId === nextId && prev.onSave === next.onSave && prev.onClose === next.onClose && prev.tagOptions === next.tagOptions && prev.onSaveNote === next.onSaveNote && prev.onSaveOldEmails === next.onSaveOldEmails && prev.onSaveNickname === next.onSaveNickname && domainsEqual;
});

function MultiSelectDropdown({ options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const ref = useRef(null);
  const dropRef = useRef(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setFilter('');
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < 240;
    setPos({
      top: up ? rect.top - 2 : rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      up,
    });
  }, [open, filter]);

  const filtered = filter.trim() ? options.filter(o => o.toLowerCase().includes(filter.toLowerCase())) : options;

  return (
    <div ref={ref}>
      <div
        onClick={() => { setOpen(o => !o); setFilter(''); }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.35rem 0.5rem',
          border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px',
          alignItems: 'center', cursor: 'pointer', background: 'var(--color-bg)',
        }}
      >
        {selected.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Select...</span>}
        {selected.map(v => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.1rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.7rem', color: '#1E40AF', fontWeight: 500 }}>
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(v); }}
              style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
            >&times;</button>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: pos.up ? undefined : pos.top,
          bottom: pos.up ? (window.innerHeight - pos.top) : undefined,
          left: pos.left,
          width: Math.max(pos.width, 280),
          zIndex: 10001,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', maxHeight: '240px', display: 'flex', flexDirection: 'column',
        }}>
          {options.length > 10 && (
            <input
              type="text"
              placeholder="Search..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{ margin: '0.3rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none' }}
            />
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(opt => (
              <label
                key={opt}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem',
                  fontSize: '0.72rem', cursor: 'pointer', color: '#1E293B',
                }}
                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: '#3B82F6' }} />
                {opt}
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.7rem', color: '#94A3B8' }}>No matches</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Build a flat set of all known service item names (lowercased) for scope matching
const ALL_SERVICE_ITEMS_LOWER = new Set(
  SERVICE_CATEGORIES.flatMap(cat => cat.items.map(i => i.toLowerCase()))
);

export function ProspectModal({ prospect, onSave, onClose, isNew, hubspotContacts = [], onDeleteContact, orgCharts = {}, onUpdateOrgChart = () => {}, settings = {}, updateSettings = () => {}, targetAccountsData = null }) {
  const [fields, setFields] = useState(() => {
    if (prospect) return { ...EMPTY, ...prospect };
    return { ...EMPTY };
  });

  // Local contact state — updated optimistically after HubSpot saves
  const baseContacts = useMemo(() => {
    if (!fields.company || isNew) return [];
    return hubspotContacts
      .filter(c => companiesMatch(c.company, fields.company))
      .filter(c => !contactIsHidden(c));
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
  const [addingContact, setAddingContact] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [servicesEditMode, setServicesEditMode] = useState(false);
  const [editingServiceName, setEditingServiceName] = useState(null);
  const [expandedServiceNote, setExpandedServiceNote] = useState(null);
  const [competitorsOpen, setCompetitorsOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [pastePortfolio, setPastePortfolio] = useState('');
  const [researchingPortfolio, setResearchingPortfolio] = useState(false);
  const [portfolioResearchError, setPortfolioResearchError] = useState(null);
  const [portfolioColWidths, setPortfolioColWidths] = useState({
    num: 30, company: 180, industry: 110, geography: 120, hqCity: 130, hqCountry: 90, energy: 110, siteCount: 100, raClient: 200, clientManager: 140, targetAccount: 200,
  });
  const [raClientPickerOpen, setRaClientPickerOpen] = useState(null); // row index
  const [targetAccountPickerOpen, setTargetAccountPickerOpen] = useState(null); // row index
  const [newCompetitor, setNewCompetitor] = useState('');
  const [oppsCache, setOppsCache] = useState(null);
  const [clientManager, setClientManager] = useState(null);

  // Load opps data from IndexedDB (primary) or localStorage (legacy fallback)
  // Also load clients data to find Client Manager
  useEffect(() => {
    if (isNew) return;
    (async () => {
      const idbData = await loadOppsFromIndexedDB();
      if (idbData?.records) {
        setOppsCache(idbData.records);
      } else {
        try {
          const cache = JSON.parse(localStorage.getItem('opps-cache'));
          if (cache?.records) setOppsCache(cache.records);
        } catch {}
      }
      // Load clients and find CM
      const clientsData = await loadClientsFromIndexedDB();
      if (clientsData?.records && fields.company) {
        const match = clientsData.records.find(r => companiesMatch(r.Client || r.client, fields.company));
        if (match) setClientManager(match.CM || match.cm || null);
      }
    })();
  }, [isNew]);

  // Load opps scope+stage pairs matching this company
  const oppsRecords = useMemo(() => {
    if (isNew || !fields.company || !oppsCache) return [];
    return oppsCache
      .filter(r => companiesMatch(r.Account, fields.company))
      .filter(r => (r.Scope || '').trim())
      .map(r => ({ scope: (r.Scope || '').trim(), stage: (r.Stage || '').trim() }));
  }, [fields.company, isNew, oppsCache]);

  // Map service items to their opp stage (priority: Sold > active stages > Not Sold)
  const scopeMatchedServices = useMemo(() => {
    const stagePriority = { 'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2, 'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0 };
    const matched = new Map(); // item -> stage
    for (const { scope, stage } of oppsRecords) {
      const parts = scope.split(/[;,/]+/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const lower = part.toLowerCase();
        for (const cat of SERVICE_CATEGORIES) {
          for (const item of cat.items) {
            if (item.toLowerCase() === lower || item.toLowerCase().includes(lower) || lower.includes(item.toLowerCase())) {
              const existing = matched.get(item);
              const existingPri = existing ? (stagePriority[existing] ?? 1) : -1;
              const newPri = stagePriority[stage] ?? 1;
              if (newPri > existingPri) {
                matched.set(item, stage);
              }
            }
          }
        }
      }
    }
    return matched;
  }, [oppsRecords]);

  const handleContactSaved = useCallback((updated) => {
    setLocalContacts(prev => {
      const existing = prev.find(c => String(c.id || c.vid) === String(updated.id || updated.vid));
      if (existing) {
        return prev.map(c => (String(c.id || c.vid) === String(updated.id || updated.vid) ? { ...c, ...updated } : c));
      }
      return [...prev, updated];
    });
    setAddingContact(false);
    setEditingContact(null);
  }, []);

  const handleSaveContactNote = useCallback((contactId, note) => {
    const current = settings.contactNotes || {};
    const next = { ...current };
    if (note && note.trim()) next[contactId] = note;
    else delete next[contactId];
    updateSettings({ contactNotes: next });
  }, [settings.contactNotes, updateSettings]);

  const handleSaveContactOldEmails = useCallback((contactId, oldEmails) => {
    const current = settings.contactOldEmails || {};
    const next = { ...current };
    if (oldEmails && oldEmails.trim()) next[contactId] = oldEmails;
    else delete next[contactId];
    updateSettings({ contactOldEmails: next });
  }, [settings.contactOldEmails, updateSettings]);

  const handleSaveContactNickname = useCallback((contactId, nickname) => {
    const current = settings.contactNicknames || {};
    const next = { ...current };
    if (nickname && nickname.trim()) next[contactId] = nickname;
    else delete next[contactId];
    updateSettings({ contactNicknames: next });
  }, [settings.contactNicknames, updateSettings]);

  const handleCloseContactEdit = useCallback(() => {
    setEditingContact(null);
    setAddingContact(false);
  }, []);

  // ── Company Notes (per-company, synced via userSettings) ──
  const companySlug = useMemo(
    () => (fields.company || '').toLowerCase().replace(/[^a-z0-9]/g, '-'),
    [fields.company]
  );
  const savedCompanyNote = (settings.companyNotes || {})[companySlug] || '';
  const [companyNoteDraft, setCompanyNoteDraft] = useState(savedCompanyNote);
  const [companyNotesOpen, setCompanyNotesOpen] = useState(false);
  const companyNoteSaveTimerRef = useRef(null);
  const companyNoteSlugRef = useRef(companySlug);

  // Rehydrate draft when the active company changes (switching modals / renaming).
  useEffect(() => {
    if (companyNoteSlugRef.current !== companySlug) {
      companyNoteSlugRef.current = companySlug;
      setCompanyNoteDraft(savedCompanyNote);
    }
  }, [companySlug, savedCompanyNote]);

  useEffect(() => () => {
    if (companyNoteSaveTimerRef.current) clearTimeout(companyNoteSaveTimerRef.current);
  }, []);

  const handleCompanyNoteChange = useCallback((html) => {
    setCompanyNoteDraft(html);
    if (companyNoteSaveTimerRef.current) clearTimeout(companyNoteSaveTimerRef.current);
    const slugAtEdit = companySlug;
    companyNoteSaveTimerRef.current = setTimeout(() => {
      if (!slugAtEdit) return;
      const current = settings.companyNotes || {};
      const next = { ...current };
      const isEmpty = !html || html === '<p><br></p>' || !html.replace(/<[^>]*>/g, '').trim();
      if (isEmpty) delete next[slugAtEdit];
      else next[slugAtEdit] = html;
      updateSettings({ companyNotes: next });
    }, 800);
  }, [companySlug, settings.companyNotes, updateSettings]);

  // ── Opportunities (per-company, synced via userSettings) ──
  // Shape: settings.companyOpportunities[slug] = { buckets: [{id,name}], opportunities: [{id,bucketId,title,notes,createdAt,updatedAt}] }
  const companyOppsData = (settings.companyOpportunities || {})[companySlug] || { buckets: [], opportunities: [] };
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(false);
  const [selectedOppId, setSelectedOppId] = useState(null);
  const [oppNoteDraft, setOppNoteDraft] = useState('');
  const oppSaveTimerRef = useRef(null);
  const oppSlugRef = useRef(companySlug);

  // Clear selection / draft when switching company
  useEffect(() => {
    if (oppSlugRef.current !== companySlug) {
      oppSlugRef.current = companySlug;
      setSelectedOppId(null);
      setOppNoteDraft('');
    }
  }, [companySlug]);

  useEffect(() => () => {
    if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
  }, []);

  const selectedOpp = useMemo(
    () => (companyOppsData.opportunities || []).find(o => o.id === selectedOppId) || null,
    [companyOppsData.opportunities, selectedOppId]
  );

  // When selection changes, load its notes into the draft (flush any pending save first)
  useEffect(() => {
    if (oppSaveTimerRef.current) { clearTimeout(oppSaveTimerRef.current); oppSaveTimerRef.current = null; }
    setOppNoteDraft(selectedOpp ? (selectedOpp.notes || '') : '');
  }, [selectedOppId]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeCompanyOpps = useCallback((nextData) => {
    if (!companySlug) return;
    const all = { ...(settings.companyOpportunities || {}) };
    const isEmpty = (!nextData.buckets || nextData.buckets.length === 0) && (!nextData.opportunities || nextData.opportunities.length === 0);
    if (isEmpty) delete all[companySlug];
    else all[companySlug] = nextData;
    updateSettings({ companyOpportunities: all });
  }, [companySlug, settings.companyOpportunities, updateSettings]);

  const addBucket = useCallback(() => {
    const name = window.prompt('Bucket name:');
    if (!name || !name.trim()) return;
    const bucket = { id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: name.trim() };
    writeCompanyOpps({
      buckets: [...(companyOppsData.buckets || []), bucket],
      opportunities: companyOppsData.opportunities || [],
    });
  }, [companyOppsData, writeCompanyOpps]);

  const renameBucket = useCallback((bucketId) => {
    const current = (companyOppsData.buckets || []).find(b => b.id === bucketId);
    if (!current) return;
    const name = window.prompt('Rename bucket:', current.name);
    if (!name || !name.trim() || name.trim() === current.name) return;
    writeCompanyOpps({
      buckets: (companyOppsData.buckets || []).map(b => b.id === bucketId ? { ...b, name: name.trim() } : b),
      opportunities: companyOppsData.opportunities || [],
    });
  }, [companyOppsData, writeCompanyOpps]);

  const deleteBucket = useCallback((bucketId) => {
    const bucket = (companyOppsData.buckets || []).find(b => b.id === bucketId);
    if (!bucket) return;
    const count = (companyOppsData.opportunities || []).filter(o => o.bucketId === bucketId).length;
    const msg = count > 0
      ? `Delete bucket "${bucket.name}" and its ${count} opportunit${count === 1 ? 'y' : 'ies'}?`
      : `Delete bucket "${bucket.name}"?`;
    if (!window.confirm(msg)) return;
    const nextOpps = (companyOppsData.opportunities || []).filter(o => o.bucketId !== bucketId);
    if (selectedOppId && !nextOpps.find(o => o.id === selectedOppId)) setSelectedOppId(null);
    writeCompanyOpps({
      buckets: (companyOppsData.buckets || []).filter(b => b.id !== bucketId),
      opportunities: nextOpps,
    });
  }, [companyOppsData, selectedOppId, writeCompanyOpps]);

  const addOpportunity = useCallback((bucketId) => {
    const title = window.prompt('Opportunity title:');
    if (!title || !title.trim()) return;
    const now = Date.now();
    const opp = { id: `o_${now}_${Math.random().toString(36).slice(2, 7)}`, bucketId, title: title.trim(), notes: '', createdAt: now, updatedAt: now };
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: [...(companyOppsData.opportunities || []), opp],
    });
    setSelectedOppId(opp.id);
  }, [companyOppsData, writeCompanyOpps]);

  const renameOpportunity = useCallback((oppId) => {
    const current = (companyOppsData.opportunities || []).find(o => o.id === oppId);
    if (!current) return;
    const title = window.prompt('Rename opportunity:', current.title);
    if (!title || !title.trim() || title.trim() === current.title) return;
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).map(o => o.id === oppId ? { ...o, title: title.trim(), updatedAt: Date.now() } : o),
    });
  }, [companyOppsData, writeCompanyOpps]);

  const deleteOpportunity = useCallback((oppId) => {
    const opp = (companyOppsData.opportunities || []).find(o => o.id === oppId);
    if (!opp) return;
    if (!window.confirm(`Delete opportunity "${opp.title}"? This cannot be undone.`)) return;
    if (selectedOppId === oppId) setSelectedOppId(null);
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).filter(o => o.id !== oppId),
    });
  }, [companyOppsData, selectedOppId, writeCompanyOpps]);

  const moveOpportunity = useCallback((oppId, newBucketId) => {
    writeCompanyOpps({
      buckets: companyOppsData.buckets || [],
      opportunities: (companyOppsData.opportunities || []).map(o => o.id === oppId ? { ...o, bucketId: newBucketId, updatedAt: Date.now() } : o),
    });
  }, [companyOppsData, writeCompanyOpps]);

  const handleOppNoteChange = useCallback((html) => {
    setOppNoteDraft(html);
    if (!selectedOppId) return;
    if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
    const idAtEdit = selectedOppId;
    oppSaveTimerRef.current = setTimeout(() => {
      const all = { ...(settings.companyOpportunities || {}) };
      const data = all[companySlug] || { buckets: [], opportunities: [] };
      const nextOpps = (data.opportunities || []).map(o => o.id === idAtEdit ? { ...o, notes: html, updatedAt: Date.now() } : o);
      all[companySlug] = { buckets: data.buckets || [], opportunities: nextOpps };
      updateSettings({ companyOpportunities: all });
    }, 800);
  }, [companySlug, selectedOppId, settings.companyOpportunities, updateSettings]);

  // ── Opportunity Word (.docx) import / export ──
  const oppDocxInputRef = useRef(null);

  const downloadOppAsDocx = useCallback(async () => {
    if (!selectedOpp) return;
    const safeTitle = (selectedOpp.title || 'opportunity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'opportunity';
    const safeCompany = (fields.company || 'company').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const bodyHtml = oppNoteDraft && oppNoteDraft.trim() ? oppNoteDraft : '<p></p>';
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeCompany} — ${safeTitle}</h1>${bodyHtml}</body></html>`;
    try {
      const result = await htmlToDocxBlob(fullHtml);
      const blob = result instanceof Blob ? result : new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeCompany} - ${safeTitle}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Failed to export Word document: ' + (err.message || err));
    }
  }, [selectedOpp, oppNoteDraft, fields.company]);

  const handleOppDocxUpload = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !selectedOppId) return;
    if (!/\.docx$/i.test(file.name)) {
      alert('Please choose a .docx file.');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = result.value || '';
      const replace = !oppNoteDraft || !oppNoteDraft.replace(/<[^>]*>/g, '').trim()
        ? true
        : window.confirm('Replace existing notes with the uploaded document? Click Cancel to append instead.');
      const nextHtml = replace ? html : `${oppNoteDraft}<hr>${html}`;
      setOppNoteDraft(nextHtml);
      if (oppSaveTimerRef.current) clearTimeout(oppSaveTimerRef.current);
      const idAtEdit = selectedOppId;
      const all = { ...(settings.companyOpportunities || {}) };
      const data = all[companySlug] || { buckets: [], opportunities: [] };
      const nextOpps = (data.opportunities || []).map(o => o.id === idAtEdit ? { ...o, notes: nextHtml, updatedAt: Date.now() } : o);
      all[companySlug] = { buckets: data.buckets || [], opportunities: nextOpps };
      updateSettings({ companyOpportunities: all });
    } catch (err) {
      alert('Failed to read Word document: ' + (err.message || err));
    }
  }, [selectedOppId, oppNoteDraft, companySlug, settings.companyOpportunities, updateSettings]);

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
      onSave(data, { close: false });
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
            <div style={{ gridColumn: 'span 2' }}>
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
              <label className={styles.label}>Client Manager</label>
              <div className={styles.input} style={{ background: clientManager ? '#F0FDF4' : 'var(--color-bg)', color: clientManager ? '#166534' : 'var(--color-text-muted)', fontWeight: clientManager ? 600 : 400, cursor: 'default' }}>
                {clientManager || '—'}
              </div>
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
              <select className={styles.input} value={fields.hqRegion} onChange={e => set('hqRegion', e.target.value)}>
                <option value="">—</option>
                <option value="North America">North America</option>
                <option value="Outside of North America">Outside of North America</option>
              </select>
            </div>

            <div>
              <label className={styles.label}>Website</label>
              <input className={styles.input} value={fields.website} onChange={e => set('website', e.target.value)} placeholder="www.example.com" />
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>Email Domains</label>
              {(() => {
                const domains = (fields.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: '6px', minHeight: '36px', alignItems: 'center' }}>
                    {domains.map((d, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.72rem', color: '#1E40AF' }}>
                        {d}
                        <button
                          type="button"
                          onClick={() => {
                            const next = domains.filter((_, j) => j !== i);
                            set('emailDomain', next.join('\n'));
                          }}
                          style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                        >&times;</button>
                      </span>
                    ))}
                    <input
                      type="text"
                      placeholder={domains.length === 0 ? 'firstname.lastname@domain.com' : '+ Add domain'}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          e.preventDefault();
                          const val = e.target.value.trim();
                          if (!domains.includes(val)) {
                            set('emailDomain', [...domains, val].join('\n'));
                          }
                          e.target.value = '';
                        }
                      }}
                      style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', minWidth: '140px', flex: '1 1 140px', background: 'none' }}
                    />
                  </div>
                );
              })()}
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>Asset Types</label>
              <MultiSelectDropdown options={ASSET_TYPES} selected={fields.assetTypes || []} onToggle={(val) => toggleArrayField('assetTypes', val)} />
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>Frameworks</label>
              <MultiSelectDropdown options={FRAMEWORKS} selected={fields.frameworks || []} onToggle={(val) => toggleArrayField('frameworks', val)} />
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Notes</label>
              <textarea className={styles.textarea} value={fields.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>
          </div>

          {/* Company Notes — rich, per-company, synced across devices */}
          {!isNew && fields.company?.trim() && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setCompanyNotesOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Company Notes
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: companyNotesOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {savedCompanyNote && (
                  <span style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                    has notes
                  </span>
                )}
              </div>
              {companyNotesOpen && (
                <div style={{ marginTop: '0.5rem' }}>
                  <ReactQuill
                    theme="snow"
                    value={companyNoteDraft}
                    onChange={handleCompanyNoteChange}
                    placeholder="Meeting notes, context, follow-ups…"
                    modules={{
                      toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                        [{ 'indent': '-1' }, { 'indent': '+1' }],
                        ['link', 'blockquote', 'code-block'],
                        ['clean'],
                      ],
                      clipboard: { matchVisual: false },
                    }}
                    formats={['header', 'bold', 'italic', 'underline', 'strike', 'list', 'indent', 'link', 'blockquote', 'code-block']}
                  />
                </div>
              )}
            </div>
          )}

          {/* Opportunities — bucketed notes pages, per-company, synced across devices */}
          {!isNew && fields.company?.trim() && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setOpportunitiesOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Opportunities
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: opportunitiesOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const n = (companyOppsData.opportunities || []).length;
                  return n > 0 ? <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{n} {n === 1 ? 'opportunity' : 'opportunities'}</span> : null;
                })()}
              </div>
              {opportunitiesOpen && (
                <div style={{ marginTop: '0.75rem' }}>
                  {selectedOpp ? (
                    // Detail view — editing a single opportunity
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedOppId(null)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          &larr; Back
                        </button>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>{selectedOpp.title}</span>
                        <select
                          value={selectedOpp.bucketId}
                          onChange={e => moveOpportunity(selectedOpp.id, e.target.value)}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4 }}
                        >
                          {(companyOppsData.buckets || []).map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => renameOpportunity(selectedOpp.id)}
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Rename
                        </button>
                        <input
                          ref={oppDocxInputRef}
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={handleOppDocxUpload}
                          style={{ display: 'none' }}
                        />
                        <button
                          type="button"
                          onClick={() => oppDocxInputRef.current?.click()}
                          title="Upload a Word document (.docx) into this opportunity's notes"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Upload .docx
                        </button>
                        <button
                          type="button"
                          onClick={downloadOppAsDocx}
                          title="Download this opportunity's notes as a Word document"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Download .docx
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOpportunity(selectedOpp.id)}
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                      <ReactQuill
                        theme="snow"
                        value={oppNoteDraft}
                        onChange={handleOppNoteChange}
                        placeholder="Notes for this opportunity…"
                        modules={{
                          toolbar: [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                            ['link', 'blockquote', 'code-block'],
                            ['clean'],
                          ],
                          clipboard: { matchVisual: false },
                        }}
                        formats={['header', 'bold', 'italic', 'underline', 'strike', 'list', 'indent', 'link', 'blockquote', 'code-block']}
                      />
                    </div>
                  ) : (
                    // Overview — buckets + opportunity cards
                    <div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <button
                          type="button"
                          onClick={addBucket}
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                        >
                          + Bucket
                        </button>
                      </div>
                      {(companyOppsData.buckets || []).length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic', padding: '0.5rem 0' }}>
                          No buckets yet. Add one to start grouping opportunities.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {(companyOppsData.buckets || []).map(bucket => {
                            const bucketOpps = (companyOppsData.opportunities || []).filter(o => o.bucketId === bucket.id);
                            return (
                              <div key={bucket.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 6, padding: '0.6rem 0.75rem', background: '#F8FAFC' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155' }}>{bucket.name}</span>
                                  <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{bucketOpps.length}</span>
                                  <div style={{ flex: 1 }} />
                                  <button
                                    type="button"
                                    onClick={() => addOpportunity(bucket.id)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    + Opportunity
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => renameBucket(bucket.id)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteBucket(bucket.id)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
                                  >
                                    Delete
                                  </button>
                                </div>
                                {bucketOpps.length === 0 ? (
                                  <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No opportunities in this bucket.</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    {bucketOpps.map(opp => {
                                      const preview = (opp.notes || '').replace(/<[^>]*>/g, '').trim().slice(0, 80);
                                      return (
                                        <div
                                          key={opp.id}
                                          onClick={() => setSelectedOppId(opp.id)}
                                          style={{ background: 'white', border: '1px solid var(--color-border-light)', borderRadius: 4, padding: '0.4rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        >
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#1E293B' }}>{opp.title}</div>
                                            {preview && (
                                              <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</div>
                                            )}
                                          </div>
                                          <span style={{ fontSize: '0.6rem', color: '#94A3B8' }}>&rsaquo;</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Services Explored */}
          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setServicesOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Services Explored
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: servicesOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const svc = fields.servicesExplored || {};
                  const hidden = new Set(settings.hiddenServices || []);
                  const totalItems = SERVICE_CATEGORIES.reduce((sum, cat) => sum + cat.items.filter(i => !hidden.has(i)).length, 0);
                  const exploredItems = new Set();
                  for (const [item, val] of Object.entries(svc)) {
                    if (val && val !== '-' && !hidden.has(item)) exploredItems.add(item);
                  }
                  for (const item of scopeMatchedServices.keys()) {
                    if (!hidden.has(item)) exploredItems.add(item);
                  }
                  const pct = totalItems > 0 ? Math.round((exploredItems.size / totalItems) * 100) : 0;
                  return (
                    <span style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                      {exploredItems.size}/{totalItems} ({pct}%)
                    </span>
                  );
                })()}
                <button
                  onClick={(e) => { e.stopPropagation(); setServicesEditMode(m => !m); }}
                  style={{ marginLeft: 'auto', padding: '0.15rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: servicesEditMode ? '#FEF3C7' : 'var(--color-surface)', fontSize: '0.62rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: servicesEditMode ? '#92400E' : 'var(--color-text-muted)' }}
                >{servicesEditMode ? 'Done Editing' : 'Edit Services'}</button>
              </div>
              {servicesOpen && (() => {
                const serviceRenames = settings.serviceRenames || {};
                const hiddenServices = new Set(settings.hiddenServices || []);
                const hiddenCount = hiddenServices.size;
                const getDisplayName = (item) => serviceRenames[item] || item;

                // Use custom categories if saved, otherwise default
                const categories = settings.customServiceCategories || SERVICE_CATEGORIES.map(c => ({ name: c.name, items: [...c.items] }));

                function saveCategories(next) {
                  updateSettings({ customServiceCategories: next });
                }
                function renameService(original, newName) {
                  const next = { ...(settings.serviceRenames || {}) };
                  if (newName === original || !newName.trim()) delete next[original];
                  else next[original] = newName.trim();
                  updateSettings({ serviceRenames: next });
                }
                function toggleHideService(item) {
                  const current = settings.hiddenServices || [];
                  const next = current.includes(item) ? current.filter(s => s !== item) : [...current, item];
                  updateSettings({ hiddenServices: next });
                }
                function renameCategoryBox(oldName, newName) {
                  if (!newName.trim() || newName === oldName) return;
                  const next = categories.map(c => c.name === oldName ? { ...c, name: newName.trim() } : c);
                  saveCategories(next);
                }
                function deleteCategoryBox(catName) {
                  if (!confirm(`Delete "${catName}" box? Its services will be hidden.`)) return;
                  const cat = categories.find(c => c.name === catName);
                  const next = categories.filter(c => c.name !== catName);
                  // Hide all items from the deleted category
                  if (cat) {
                    const hidden = [...(settings.hiddenServices || [])];
                    for (const item of cat.items) { if (!hidden.includes(item)) hidden.push(item); }
                    updateSettings({ hiddenServices: hidden, customServiceCategories: next });
                    return;
                  }
                  saveCategories(next);
                }
                function moveService(item, fromCat, toCat) {
                  if (fromCat === toCat) return;
                  const next = categories.map(c => {
                    if (c.name === fromCat) return { ...c, items: c.items.filter(i => i !== item) };
                    if (c.name === toCat) return { ...c, items: [...c.items, item] };
                    return c;
                  });
                  saveCategories(next);
                }

                return (
                <div>
                  {servicesEditMode && hiddenCount > 0 && (
                    <div style={{ marginTop: '0.5rem', marginBottom: '0.25rem', fontSize: '0.68rem', color: '#64748B' }}>
                      {hiddenCount} hidden service{hiddenCount !== 1 ? 's' : ''}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.4rem', maxHeight: '500px', overflowY: 'auto', padding: '0.15rem' }}>
                  {categories.map(cat => {
                    const svc = fields.servicesExplored || {};
                    const visibleItems = servicesEditMode ? cat.items : cat.items.filter(item => !hiddenServices.has(item));
                    if (visibleItems.length === 0 && !servicesEditMode) return null;
                    return (
                      <div key={cat.name} style={{ breakInside: 'avoid', border: '1px solid var(--color-border)', borderRadius: '5px', overflow: 'hidden', fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                        <div style={{ padding: '0.2rem 0.4rem', background: '#EFF6FF', borderBottom: '1px solid var(--color-border)', fontWeight: 700, fontSize: '0.65rem', color: '#1E40AF', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {servicesEditMode && editingServiceName?.catName === cat.name ? (
                            <input
                              autoFocus
                              defaultValue={cat.name}
                              onBlur={(e) => { renameCategoryBox(cat.name, e.target.value); setEditingServiceName(null); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingServiceName(null); }}
                              style={{ flex: 1, fontSize: '0.65rem', fontWeight: 700, padding: '0 2px', border: '1px solid var(--color-accent)', borderRadius: '3px', fontFamily: 'inherit', outline: 'none', background: '#fff' }}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span style={{ flex: 1, cursor: servicesEditMode ? 'pointer' : 'default' }} onClick={() => servicesEditMode && setEditingServiceName({ catName: cat.name })} title={servicesEditMode ? 'Click to rename' : ''}>
                              {cat.name}
                            </span>
                          )}
                          {servicesEditMode && (
                            <button
                              onClick={() => deleteCategoryBox(cat.name)}
                              style={{ background: 'none', border: 'none', color: '#FCA5A5', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                              onMouseEnter={e => e.target.style.color = '#EF4444'}
                              onMouseLeave={e => e.target.style.color = '#FCA5A5'}
                              title="Delete box"
                            >&times;</button>
                          )}
                        </div>
                        <div style={{ padding: '0.1rem 0' }}>
                          {visibleItems.map(item => {
                            const isHidden = hiddenServices.has(item);
                            const manualStatus = svc[item] || '-';
                            const oppStage = scopeMatchedServices.get(item);
                            let effectiveStatus = manualStatus;
                            if (manualStatus === '-' && oppStage) {
                              effectiveStatus = oppStage;
                            }
                            const statusColors = {
                              'Sold': { bg: '#DCFCE7', color: '#166534' },
                              'Renewal': { bg: '#F1F5F9', color: '#94A3B8' },
                              'Verbal': { bg: '#DCFCE7', color: '#166534' },
                              'In Progress': { bg: '#FEF9C3', color: '#854D0E' },
                              'Exploring': { bg: '#FEF9C3', color: '#854D0E' },
                              'Qualifying': { bg: '#FEF9C3', color: '#854D0E' },
                              'Quoting': { bg: '#FEF9C3', color: '#854D0E' },
                              'Quoted': { bg: '#DBEAFE', color: '#1E40AF' },
                              'Proposed': { bg: '#DBEAFE', color: '#1E40AF' },
                              'Lead': { bg: '#FEF9C3', color: '#854D0E' },
                              'Not Started': { bg: '#FEF9C3', color: '#854D0E' },
                              'Not Sold': { bg: '#FEE2E2', color: '#991B1B' },
                              'N/A': { bg: '#F1F5F9', color: '#94A3B8' },
                            };
                            const colors = statusColors[effectiveStatus] || {};

                            if (servicesEditMode) {
                              return (
                                <div key={item} style={{ display: 'flex', alignItems: 'center', padding: '0.1rem 0.35rem', gap: '0.25rem', opacity: isHidden ? 0.4 : 1 }}>
                                  {editingServiceName?.original === item ? (
                                    <input
                                      autoFocus
                                      defaultValue={getDisplayName(item)}
                                      onBlur={(e) => { renameService(item, e.target.value); setEditingServiceName(null); }}
                                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingServiceName(null); }}
                                      style={{ flex: 1, fontSize: '0.68rem', padding: '1px 4px', border: '1px solid var(--color-accent)', borderRadius: '3px', fontFamily: 'inherit', outline: 'none' }}
                                    />
                                  ) : (
                                    <span
                                      onClick={() => setEditingServiceName({ original: item })}
                                      style={{ flex: 1, fontSize: '0.68rem', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isHidden ? 'line-through' : 'none' }}
                                      title="Click to rename"
                                    >
                                      {getDisplayName(item)}
                                    </span>
                                  )}
                                  <select
                                    value={cat.name}
                                    onChange={e => moveService(item, cat.name, e.target.value)}
                                    title="Move to another box"
                                    style={{ fontSize: '0.55rem', padding: '0 1px', border: '1px solid var(--color-border)', borderRadius: '3px', background: 'var(--color-surface)', color: '#64748B', cursor: 'pointer', maxWidth: '55px', fontFamily: 'inherit' }}
                                  >
                                    {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                  </select>
                                  <button
                                    onClick={() => toggleHideService(item)}
                                    style={{ background: 'none', border: 'none', fontSize: '0.6rem', cursor: 'pointer', padding: '0 2px', color: isHidden ? '#22C55E' : '#94A3B8', fontFamily: 'inherit', fontWeight: 600 }}
                                    title={isHidden ? 'Show' : 'Hide'}
                                  >{isHidden ? '↩' : '✕'}</button>
                                </div>
                              );
                            }

                            const noteKey = item;
                            const noteVal = (fields.serviceNotes || {})[noteKey] || '';
                            const hasNote = !!noteVal;
                            const isNoteOpen = expandedServiceNote === noteKey;
                            return (
                              <div key={item}>
                                <div
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '0.1rem 0.35rem', gap: '0.25rem',
                                    background: colors.bg || 'transparent',
                                    opacity: effectiveStatus === 'N/A' ? 0.5 : 1,
                                  }}
                                >
                                  <span
                                    onClick={() => setExpandedServiceNote(isNoteOpen ? null : noteKey)}
                                    style={{ fontSize: '0.6rem', cursor: 'pointer', color: hasNote ? '#F59E0B' : '#CBD5E1', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
                                    title={hasNote ? noteVal : 'Add note'}
                                  >{hasNote ? '\u270E' : '\u270E'}</span>
                                  <span style={{ flex: 1, fontSize: '0.68rem', color: colors.color || 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item}>
                                    {getDisplayName(item)}
                                  </span>
                                  <select
                                    value={effectiveStatus}
                                    onChange={e => {
                                      const next = { ...(fields.servicesExplored || {}), [item]: e.target.value };
                                      if (e.target.value === '-') delete next[item];
                                      set('servicesExplored', next);
                                    }}
                                    style={{
                                      fontSize: '0.62rem', padding: '1px 2px', border: '1px solid var(--color-border)',
                                      borderRadius: '3px', background: colors.bg || 'var(--color-surface)', color: colors.color || 'var(--color-text)',
                                      cursor: 'pointer', minWidth: '65px', fontFamily: 'inherit', fontWeight: 600,
                                    }}
                                  >
                                    {SERVICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                {isNoteOpen && (
                                  <div style={{ padding: '0.15rem 0.35rem 0.25rem 1.2rem' }}>
                                    <textarea
                                      autoFocus
                                      value={noteVal}
                                      onChange={e => {
                                        const next = { ...(fields.serviceNotes || {}), [noteKey]: e.target.value };
                                        if (!e.target.value) delete next[noteKey];
                                        set('serviceNotes', next);
                                      }}
                                      placeholder="Add a note..."
                                      rows={2}
                                      style={{ width: '100%', fontSize: '0.65rem', padding: '0.2rem 0.3rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.3, color: 'var(--color-text)', background: 'var(--color-bg)' }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {servicesEditMode && (
                    <div
                      onClick={() => {
                        const name = prompt('New box name:');
                        if (!name?.trim()) return;
                        if (categories.some(c => c.name === name.trim())) { alert('A box with that name already exists.'); return; }
                        saveCategories([...categories, { name: name.trim(), items: [] }]);
                      }}
                      style={{ breakInside: 'avoid', border: '2px dashed var(--color-border)', borderRadius: '5px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.72rem', fontWeight: 600, marginBottom: '0.4rem' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >+ Add Box</div>
                  )}
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          {/* Competitors */}
          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setCompetitorsOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Competitors
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: competitorsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const comp = fields.competitors || {};
                  const count = Object.keys(comp).length;
                  return count > 0 ? <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{count} competitor{count !== 1 ? 's' : ''}</span> : null;
                })()}
              </div>
              {competitorsOpen && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      placeholder="Add competitor name..."
                      value={newCompetitor}
                      onChange={e => setNewCompetitor(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newCompetitor.trim()) {
                          e.preventDefault();
                          const name = newCompetitor.trim();
                          if (!(fields.competitors || {})[name]) {
                            set('competitors', { ...(fields.competitors || {}), [name]: [] });
                          }
                          setNewCompetitor('');
                        }
                      }}
                      style={{ flex: 1, padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'inherit', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                    />
                    <button
                      onClick={() => {
                        if (newCompetitor.trim()) {
                          const name = newCompetitor.trim();
                          if (!(fields.competitors || {})[name]) {
                            set('competitors', { ...(fields.competitors || {}), [name]: [] });
                          }
                          setNewCompetitor('');
                        }
                      }}
                      style={{ padding: '0.35rem 0.7rem', border: 'none', borderRadius: '6px', background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Add</button>
                  </div>
                  {Object.entries(fields.competitors || {}).map(([compName, services]) => (
                    <div key={compName} style={{ border: '1px solid var(--color-border)', borderRadius: '6px', marginBottom: '0.4rem', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.5rem', background: '#FEF2F2', borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: '#991B1B' }}>{compName}</span>
                        <button
                          onClick={() => {
                            const next = { ...(fields.competitors || {}) };
                            delete next[compName];
                            set('competitors', next);
                          }}
                          style={{ background: 'none', border: 'none', color: '#FCA5A5', fontSize: '0.85rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#FCA5A5'}
                        >&times;</button>
                      </div>
                      <div style={{ padding: '0.35rem 0.5rem' }}>
                        <MultiSelectDropdown
                          options={SERVICE_CATEGORIES.flatMap(cat => cat.items)}
                          selected={services}
                          onToggle={(svc) => {
                            const current = services || [];
                            const next = current.includes(svc) ? current.filter(s => s !== svc) : [...current, svc];
                            set('competitors', { ...(fields.competitors || {}), [compName]: next });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {Object.keys(fields.competitors || {}).length === 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic', padding: '0.25rem 0' }}>No competitors added yet</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Portfolio Companies */}
          {!isNew && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setPortfolioOpen(o => !o)}
              >
                <label className={styles.label} style={{ margin: 0, cursor: 'pointer' }}>
                  Portfolio Companies
                </label>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', transform: portfolioOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>&#9660;</span>
                {(() => {
                  const n = (fields.portfolioCompanies || []).length;
                  return n > 0 ? <span style={{ fontSize: '0.68rem', color: '#64748B' }}>{n} {n === 1 ? 'company' : 'companies'}</span> : null;
                })()}
              </div>
              {portfolioOpen && (() => {
                const rows = fields.portfolioCompanies || [];
                function updateRow(idx, patch) {
                  const next = rows.map((r, i) => i === idx ? { ...r, ...patch } : r);
                  set('portfolioCompanies', next);
                }
                function deleteRow(idx) {
                  set('portfolioCompanies', rows.filter((_, i) => i !== idx));
                }
                function addRow() {
                  set('portfolioCompanies', [...rows, { companyName: '', industry: '', geography: '', hqCity: '', hqCountry: '', energyGwh: '', siteCount: '' }]);
                }
                function parsePaste() {
                  const text = pastePortfolio.trim();
                  if (!text) return;
                  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                  const parsed = [];
                  for (const line of lines) {
                    const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(/\s{2,}|,/);
                    // Skip header row
                    if (parts[0] && /^(#|number|no\.?)$/i.test(parts[0].trim())) continue;
                    // If first col is a number, shift
                    const startIdx = /^\d+$/.test((parts[0] || '').trim()) ? 1 : 0;
                    const [companyName = '', industry = '', geography = '', hqCity = '', hqCountry = '', energyGwh = '', siteCount = ''] = parts.slice(startIdx).map(p => p.trim());
                    if (companyName) parsed.push({ companyName, industry, geography, hqCity, hqCountry, energyGwh, siteCount });
                  }
                  if (parsed.length > 0) {
                    set('portfolioCompanies', [...rows, ...parsed]);
                    setPastePortfolio('');
                  }
                }
                async function researchWithClaude() {
                  if (researchingPortfolio || !fields.company) return;
                  const replace = rows.length > 0
                    ? confirm(`This will research "${fields.company}" and ADD new companies to the existing ${rows.length}. Click OK to add, Cancel to abort. (To replace all, clear the table first.)`)
                    : true;
                  if (!replace) return;
                  setResearchingPortfolio(true);
                  setPortfolioResearchError(null);
                  try {
                    const res = await fetch('/api/research-portfolio', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ company: fields.company }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                    if (!json.companies || json.companies.length === 0) throw new Error('No companies returned');
                    set('portfolioCompanies', [...rows, ...json.companies]);
                  } catch (err) {
                    setPortfolioResearchError(err.message || 'Research failed');
                  }
                  setResearchingPortfolio(false);
                }
                function downloadTemplate() {
                  const templateRows = [
                    { 'Company Name': 'Example Company', 'Industry': 'Technology', 'Geography': 'North America', 'HQ City': 'Austin, TX', 'HQ Country': 'USA', 'Est. Energy (GWh/yr)': 25, 'Est. Site Count': 12 },
                  ];
                  const ws = XLSX.utils.json_to_sheet(templateRows, {
                    header: ['Company Name', 'Industry', 'Geography', 'HQ City', 'HQ Country', 'Est. Energy (GWh/yr)', 'Est. Site Count'],
                  });
                  ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 }];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Portfolio Companies');
                  const safeName = (fields.company || 'company').replace(/[^a-z0-9]+/gi, '_');
                  XLSX.writeFile(wb, `${safeName}_portfolio_template.xlsx`);
                }
                function downloadCurrent() {
                  if (rows.length === 0) {
                    alert('No portfolio companies to download.');
                    return;
                  }
                  const exportRows = rows.map(r => ({
                    'Company Name': r.companyName || '',
                    'Industry': r.industry || '',
                    'Geography': r.geography || '',
                    'HQ City': r.hqCity || '',
                    'HQ Country': r.hqCountry || '',
                    'Est. Energy (GWh/yr)': r.energyGwh === '' || r.energyGwh == null ? '' : Number(r.energyGwh) || r.energyGwh,
                    'Est. Site Count': r.siteCount === '' || r.siteCount == null ? '' : Number(r.siteCount) || r.siteCount,
                    'RA Client Match': r.raClientMatch || '',
                    'Client Manager': r.clientManager || '',
                    'Target Account': r.targetAccount || '',
                  }));
                  const ws = XLSX.utils.json_to_sheet(exportRows, {
                    header: ['Company Name', 'Industry', 'Geography', 'HQ City', 'HQ Country', 'Est. Energy (GWh/yr)', 'Est. Site Count', 'RA Client Match', 'Client Manager', 'Target Account'],
                  });
                  ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 24 }];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Portfolio Companies');
                  const safeName = (fields.company || 'company').replace(/[^a-z0-9]+/gi, '_');
                  XLSX.writeFile(wb, `${safeName}_portfolio_companies.xlsx`);
                }
                async function handleUpload(e) {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const buf = await file.arrayBuffer();
                    const wb = XLSX.read(buf);
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    const parsed = data
                      .map(r => {
                        const findKey = (keywords) => {
                          const keys = Object.keys(r);
                          for (const kw of keywords) {
                            const k = keys.find(key => key.toLowerCase().replace(/[^a-z0-9]/g, '').includes(kw));
                            if (k) return r[k];
                          }
                          return '';
                        };
                        return {
                          companyName: String(findKey(['companyname', 'company']) || '').trim(),
                          industry: String(findKey(['industry']) || '').trim(),
                          geography: String(findKey(['geography', 'region']) || '').trim(),
                          hqCity: String(findKey(['hqcity', 'city']) || '').trim(),
                          hqCountry: String(findKey(['hqcountry', 'country']) || '').trim(),
                          energyGwh: String(findKey(['energy', 'gwh']) || '').trim(),
                          siteCount: String(findKey(['sitecount', 'sites', 'numberofsites', 'estsitecount']) || '').trim(),
                          raClientMatch: String(findKey(['raclientmatch', 'raclient']) || '').trim(),
                          clientManager: String(findKey(['clientmanager', 'manager']) || '').trim(),
                          targetAccount: String(findKey(['targetaccount', 'target']) || '').trim(),
                        };
                      })
                      .filter(r => r.companyName);
                    if (parsed.length > 0) {
                      set('portfolioCompanies', [...rows, ...parsed]);
                    } else {
                      alert('No valid rows found in the uploaded file.');
                    }
                  } catch (err) {
                    alert('Failed to parse file: ' + (err.message || 'Unknown error'));
                  }
                  e.target.value = '';
                }
                const totalEnergy = rows.reduce((sum, r) => sum + (Number(r.energyGwh) || 0), 0);
                const totalSites = rows.reduce((sum, r) => sum + (Number(r.siteCount) || 0), 0);

                // Target Accounts — full list of names from the uploaded sheet (same source as MyAccountsView)
                const targetAccountNames = (() => {
                  const names = new Set();
                  const sheets = targetAccountsData?.sheets;
                  const sheetNames = targetAccountsData?.sheetNames;
                  if (!sheets || !sheetNames) return [];
                  const companyKeywords = ['account name', 'account', 'company name', 'company', 'client name', 'client'];
                  for (const sn of sheetNames) {
                    const sheet = sheets[sn];
                    if (!sheet?.records?.length) continue;
                    const headers = sheet.headers || Object.keys(sheet.records[0]).filter(k => k !== '_id');
                    let companyCol = null;
                    for (const kw of companyKeywords) {
                      for (const h of headers) {
                        if ((h || '').toLowerCase().trim() === kw) { companyCol = h; break; }
                      }
                      if (companyCol) break;
                    }
                    if (!companyCol) {
                      for (const kw of companyKeywords) {
                        for (const h of headers) {
                          if ((h || '').toLowerCase().includes(kw)) { companyCol = h; break; }
                        }
                        if (companyCol) break;
                      }
                    }
                    if (!companyCol) continue;
                    for (const rec of sheet.records) {
                      const v = (rec[companyCol] || '').toString().trim();
                      if (v) names.add(v);
                    }
                  }
                  return [...names].sort((a, b) => a.localeCompare(b));
                })();

                function findTargetSuggestions(companyName) {
                  const lower = (companyName || '').toLowerCase().trim();
                  if (!lower) return targetAccountNames.slice(0, 8);
                  const scored = [];
                  for (const name of targetAccountNames) {
                    const n = name.toLowerCase();
                    if (n === lower) { scored.push({ name, score: 100 }); continue; }
                    if (n.includes(lower) || lower.includes(n)) { scored.push({ name, score: 80 }); continue; }
                    const firstLower = lower.split(/[^a-z0-9]+/)[0];
                    const firstN = n.split(/[^a-z0-9]+/)[0];
                    if (firstLower && firstLower.length >= 4 && firstLower === firstN) {
                      scored.push({ name, score: 60 });
                    }
                  }
                  scored.sort((a, b) => b.score - a.score);
                  return scored.slice(0, 8).map(s => s.name);
                }

                // RA Client matching helpers
                function findRaSuggestions(companyName) {
                  const lower = (companyName || '').toLowerCase().trim();
                  if (!lower) return [];
                  const scored = [];
                  for (const ra of raClientsData) {
                    const name = (ra['MDM Name'] || '').toLowerCase();
                    if (!name) continue;
                    if (name === lower) { scored.push({ name: ra['MDM Name'], score: 100 }); continue; }
                    if (name.includes(lower) || lower.includes(name)) { scored.push({ name: ra['MDM Name'], score: 80 }); continue; }
                    // First word match
                    const firstLower = lower.split(/[^a-z0-9]+/)[0];
                    const firstName = name.split(/[^a-z0-9]+/)[0];
                    if (firstLower && firstLower.length >= 4 && firstLower === firstName) {
                      scored.push({ name: ra['MDM Name'], score: 60 });
                    }
                  }
                  scored.sort((a, b) => b.score - a.score);
                  return scored.slice(0, 6).map(s => s.name);
                }

                function startResize(colKey, e) {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startW = portfolioColWidths[colKey] || 100;
                  function onMove(ev) {
                    const delta = ev.clientX - startX;
                    setPortfolioColWidths(prev => ({ ...prev, [colKey]: Math.max(40, startW + delta) }));
                  }
                  function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  }
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }

                const resizeHandleStyle = { position: 'absolute', right: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', userSelect: 'none' };
                const thBase = { padding: '0.3rem 0.4rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.62rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)', position: 'relative', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                return (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                      <textarea
                        value={pastePortfolio}
                        onChange={e => setPastePortfolio(e.target.value)}
                        placeholder="Paste table here (tab or comma separated)..."
                        rows={2}
                        style={{ flex: 1, fontSize: '0.7rem', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '5px', fontFamily: 'inherit', resize: 'vertical', minHeight: '36px', lineHeight: 1.3 }}
                      />
                      <button
                        onClick={parsePaste}
                        disabled={!pastePortfolio.trim()}
                        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: '5px', background: pastePortfolio.trim() ? 'var(--color-accent)' : '#CBD5E1', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: pastePortfolio.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >Parse Paste</button>
                      <button
                        onClick={addRow}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)' }}
                      >+ Add Row</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <button
                        onClick={researchWithClaude}
                        disabled={researchingPortfolio}
                        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: '5px', background: researchingPortfolio ? '#94A3B8' : '#7C3AED', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: researchingPortfolio ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      >{researchingPortfolio ? 'Researching... (up to 60s)' : '✨ Research with Claude'}</button>
                      <button
                        onClick={downloadTemplate}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                      >↓ Download Excel Template</button>
                      <button
                        onClick={downloadCurrent}
                        disabled={rows.length === 0}
                        title={rows.length === 0 ? 'No data to download' : `Download ${rows.length} row${rows.length === 1 ? '' : 's'}`}
                        style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: rows.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: rows.length === 0 ? 'var(--color-text-muted)' : 'var(--color-accent)', opacity: rows.length === 0 ? 0.6 : 1 }}
                      >↓ Download Current Data</button>
                      <label style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}>
                        ↑ Upload Excel
                        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} style={{ display: 'none' }} />
                      </label>
                      {portfolioResearchError && (
                        <span style={{ fontSize: '0.68rem', color: '#DC2626', fontWeight: 600 }}>{portfolioResearchError}</span>
                      )}
                    </div>
                    {rows.length > 0 && (
                      <div style={{ border: '1px solid var(--color-border)', borderRadius: '6px', overflow: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', tableLayout: 'fixed', width: 'auto' }}>
                          <colgroup>
                            <col style={{ width: portfolioColWidths.num + 'px' }} />
                            <col style={{ width: portfolioColWidths.company + 'px' }} />
                            <col style={{ width: portfolioColWidths.industry + 'px' }} />
                            <col style={{ width: portfolioColWidths.geography + 'px' }} />
                            <col style={{ width: portfolioColWidths.hqCity + 'px' }} />
                            <col style={{ width: portfolioColWidths.hqCountry + 'px' }} />
                            <col style={{ width: portfolioColWidths.energy + 'px' }} />
                            <col style={{ width: portfolioColWidths.siteCount + 'px' }} />
                            <col style={{ width: portfolioColWidths.raClient + 'px' }} />
                            <col style={{ width: portfolioColWidths.clientManager + 'px' }} />
                            <col style={{ width: portfolioColWidths.targetAccount + 'px' }} />
                            <col style={{ width: '28px' }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: '#F8FAFC' }}>
                              <th style={thBase}>#<span style={resizeHandleStyle} onMouseDown={e => startResize('num', e)} /></th>
                              <th style={thBase}>Company<span style={resizeHandleStyle} onMouseDown={e => startResize('company', e)} /></th>
                              <th style={thBase}>Industry<span style={resizeHandleStyle} onMouseDown={e => startResize('industry', e)} /></th>
                              <th style={thBase}>Geography<span style={resizeHandleStyle} onMouseDown={e => startResize('geography', e)} /></th>
                              <th style={thBase}>HQ City<span style={resizeHandleStyle} onMouseDown={e => startResize('hqCity', e)} /></th>
                              <th style={thBase}>HQ Country<span style={resizeHandleStyle} onMouseDown={e => startResize('hqCountry', e)} /></th>
                              <th style={{ ...thBase, textAlign: 'right' }}>Est. Energy (GWh/yr)<span style={resizeHandleStyle} onMouseDown={e => startResize('energy', e)} /></th>
                              <th style={{ ...thBase, textAlign: 'right' }}>Est. Site Count<span style={resizeHandleStyle} onMouseDown={e => startResize('siteCount', e)} /></th>
                              <th style={thBase}>RA Client Match<span style={resizeHandleStyle} onMouseDown={e => startResize('raClient', e)} /></th>
                              <th style={thBase}>Client Manager<span style={resizeHandleStyle} onMouseDown={e => startResize('clientManager', e)} /></th>
                              <th style={thBase}>Target Account<span style={resizeHandleStyle} onMouseDown={e => startResize('targetAccount', e)} /></th>
                              <th style={{ padding: '0.3rem 0.3rem', borderBottom: '1px solid var(--color-border)' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => {
                              const suggestions = findRaSuggestions(r.companyName);
                              const isMatched = !!r.raClientMatch;
                              const pickerOpen = raClientPickerOpen === i;
                              return (
                              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '0.2rem 0.4rem', color: '#94A3B8', fontWeight: 600 }}>{i + 1}</td>
                                {['companyName', 'industry', 'geography', 'hqCity', 'hqCountry'].map(field => (
                                  <td key={field} style={{ padding: '0.15rem 0.25rem' }}>
                                    <input
                                      value={r[field] || ''}
                                      onChange={e => updateRow(i, { [field]: e.target.value })}
                                      style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                      onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                      onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                    />
                                  </td>
                                ))}
                                <td style={{ padding: '0.15rem 0.25rem', textAlign: 'right' }}>
                                  <input
                                    type="number"
                                    value={r.energyGwh || ''}
                                    onChange={e => updateRow(i, { energyGwh: e.target.value })}
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', textAlign: 'right' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem', textAlign: 'right' }}>
                                  <input
                                    type="number"
                                    value={r.siteCount || ''}
                                    onChange={e => updateRow(i, { siteCount: e.target.value })}
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)', textAlign: 'right' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem', position: 'relative' }}>
                                  <button
                                    onClick={() => setRaClientPickerOpen(pickerOpen ? null : i)}
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.68rem', fontFamily: 'inherit', background: isMatched ? '#DCFCE7' : 'transparent', color: isMatched ? '#166534' : (suggestions.length > 0 ? '#F59E0B' : '#CBD5E1'), cursor: 'pointer', textAlign: 'left', fontWeight: isMatched ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    onMouseEnter={e => e.currentTarget.style.border = '1px solid var(--color-accent)'}
                                    onMouseLeave={e => e.currentTarget.style.border = '1px solid transparent'}
                                  >
                                    {isMatched ? `✓ ${r.raClientMatch}` : (suggestions.length > 0 ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} ▾` : '— Click to map —')}
                                  </button>
                                  {pickerOpen && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '5px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: '220px', maxHeight: '240px', overflowY: 'auto', marginTop: '2px' }}>
                                      {r.raClientMatch && (
                                        <button
                                          onClick={() => { updateRow(i, { raClientMatch: '' }); setRaClientPickerOpen(null); }}
                                          style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', borderBottom: '1px solid #F1F5F9' }}
                                          onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                        >× Clear mapping</button>
                                      )}
                                      {suggestions.length === 0 && !r.raClientMatch && (
                                        <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>No matches found</div>
                                      )}
                                      {suggestions.map(s => (
                                        <button
                                          key={s}
                                          onClick={() => { updateRow(i, { raClientMatch: s }); setRaClientPickerOpen(null); }}
                                          style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.raClientMatch === s ? '#DCFCE7' : 'none', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                                          onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                                          onMouseLeave={e => e.currentTarget.style.background = r.raClientMatch === s ? '#DCFCE7' : 'none'}
                                        >{s}</button>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '0.15rem 0.25rem' }}>
                                  <input
                                    value={r.clientManager || ''}
                                    onChange={e => updateRow(i, { clientManager: e.target.value })}
                                    placeholder="—"
                                    style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.7rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--color-text)' }}
                                    onFocus={e => { e.target.style.border = '1px solid var(--color-accent)'; e.target.style.background = '#fff'; }}
                                    onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
                                  />
                                </td>
                                {(() => {
                                  const targetOpen = targetAccountPickerOpen === i;
                                  const targetSuggestions = findTargetSuggestions(r.companyName);
                                  const hasTarget = !!r.targetAccount;
                                  return (
                                    <td style={{ padding: '0.15rem 0.25rem', position: 'relative' }}>
                                      <button
                                        onClick={() => setTargetAccountPickerOpen(targetOpen ? null : i)}
                                        style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid transparent', borderRadius: '3px', fontSize: '0.68rem', fontFamily: 'inherit', background: hasTarget ? '#DBEAFE' : 'transparent', color: hasTarget ? '#1E40AF' : (targetSuggestions.length > 0 ? '#3B7DDD' : '#CBD5E1'), cursor: 'pointer', textAlign: 'left', fontWeight: hasTarget ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        onMouseEnter={e => e.currentTarget.style.border = '1px solid var(--color-accent)'}
                                        onMouseLeave={e => e.currentTarget.style.border = '1px solid transparent'}
                                      >
                                        {hasTarget ? `✓ ${r.targetAccount}` : (targetAccountNames.length === 0 ? '— No target list loaded —' : (targetSuggestions.length > 0 ? `${targetSuggestions.length} suggestion${targetSuggestions.length === 1 ? '' : 's'} ▾` : '— Click to map —'))}
                                      </button>
                                      {targetOpen && (
                                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: '#fff', border: '1px solid var(--color-border)', borderRadius: '5px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: '240px', maxHeight: '260px', overflowY: 'auto', marginTop: '2px' }}>
                                        {hasTarget && (
                                          <button
                                            onClick={() => { updateRow(i, { targetAccount: '' }); setTargetAccountPickerOpen(null); }}
                                            style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: 'none', textAlign: 'left', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', borderBottom: '1px solid #F1F5F9' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                          >× Clear mapping</button>
                                        )}
                                        {targetAccountNames.length === 0 && (
                                          <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>Upload a Target Accounts file on the My Accounts tab first.</div>
                                        )}
                                        {targetAccountNames.length > 0 && targetSuggestions.length === 0 && !hasTarget && (
                                          <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>No obvious matches — pick manually below.</div>
                                        )}
                                        {(targetSuggestions.length > 0 ? targetSuggestions : targetAccountNames.slice(0, 50)).map(s => (
                                          <button
                                            key={s}
                                            onClick={() => { updateRow(i, { targetAccount: s }); setTargetAccountPickerOpen(null); }}
                                            style={{ display: 'block', width: '100%', padding: '0.35rem 0.6rem', border: 'none', background: r.targetAccount === s ? '#DBEAFE' : 'none', textAlign: 'left', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                                            onMouseLeave={e => e.currentTarget.style.background = r.targetAccount === s ? '#DBEAFE' : 'none'}
                                          >{s}</button>
                                        ))}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })()}
                                <td style={{ padding: '0.15rem 0.25rem', textAlign: 'center' }}>
                                  <button
                                    onClick={() => deleteRow(i)}
                                    title="Remove"
                                    style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.8rem', cursor: 'pointer', padding: '0 3px', lineHeight: 1, fontFamily: 'inherit' }}
                                    onMouseEnter={e => e.target.style.color = '#EF4444'}
                                    onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                                  >&times;</button>
                                </td>
                              </tr>
                              );
                            })}
                            {(totalEnergy > 0 || totalSites > 0) && (
                              <tr style={{ background: '#F8FAFC', fontWeight: 700 }}>
                                <td colSpan={6} style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontSize: '0.65rem', color: '#64748B', textTransform: 'uppercase' }}>Totals</td>
                                <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>{totalEnergy > 0 ? totalEnergy.toLocaleString() : ''}</td>
                                <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>{totalSites > 0 ? totalSites.toLocaleString() : ''}</td>
                                <td colSpan={4}></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {rows.length === 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic', padding: '0.25rem 0' }}>No portfolio companies yet — paste a table above or add rows manually</div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

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
                <button
                  onClick={() => { setAddingContact(true); setEditingContact({ company: fields.company, firstname: '', lastname: '', email: '', phone: '', jobtitle: '', hs_linkedin_url: '', dans_tags: '' }); }}
                  style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--color-accent)', color: '#fff' }}
                >+ Add Contact</button>
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
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>City</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Country</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>LinkedIn</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Notes</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyContacts.map((c, i) => {
                        const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
                        const linkedinUrl = c.hs_linkedin_url || c.linkedin_url || c.hs_linkedinid;
                        const isDM = contactHasTag(c, 'decision maker');
                        return (
                          <tr key={c.id || i} onClick={() => setEditingContact(c)} style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', background: isDM ? '#FEFCE8' : '', borderLeft: isDM ? '3px solid #F59E0B' : '' }} onMouseEnter={e => e.currentTarget.style.background = isDM ? '#FEF9C3' : '#F8FAFC'} onMouseLeave={e => e.currentTarget.style.background = isDM ? '#FEFCE8' : ''}>
                            <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                              {name || '—'}
                              {isDM && <span style={{ marginLeft: '0.3rem', fontSize: '0.55rem', fontWeight: 700, color: '#92400E', background: '#FDE68A', padding: '0px 5px', borderRadius: '3px' }}>DM</span>}
                            </td>
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
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.country || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              {linkedinUrl ? <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://linkedin.com/in/${linkedinUrl}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#0A66C2', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' }}>View</a> : <span style={{ color: '#CBD5E1' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>{(settings.contactNotes || {})[c.id || c.vid] || c.notes || c.hs_content_membership_notes || c.message || '—'}</td>
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
          onClose={handleCloseContactEdit}
          tagOptions={allTagOptions}
          contactNotes={settings.contactNotes || {}}
          onSaveNote={handleSaveContactNote}
          contactOldEmails={settings.contactOldEmails || {}}
          onSaveOldEmails={handleSaveContactOldEmails}
          contactNicknames={settings.contactNicknames || {}}
          onSaveNickname={handleSaveContactNickname}
          emailDomains={(fields.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)}
        />
      )}
    </div>
  );
}
