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

// ── Org Chart Component ──

function getOrgKey(company) {
  return `orgchart-${(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function loadOrgData(company) {
  try {
    const raw = localStorage.getItem(getOrgKey(company));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveOrgData(company, data) {
  localStorage.setItem(getOrgKey(company), JSON.stringify(data));
}

function OrgChart({ contacts, company, onDeleteContact, deletingContact }) {
  const [orgData, setOrgData] = useState(() => loadOrgData(company));
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  function persist(next) { setOrgData(next); saveOrgData(company, next); }

  const contactMap = useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const id = c.id || c.email || `${c.firstname}-${c.lastname}`;
      m.set(id, { ...c, _id: id });
    }
    return m;
  }, [contacts]);

  function getChildren(parentId) {
    const children = [];
    for (const [id, c] of contactMap) {
      const node = orgData[id];
      if (parentId === null) {
        if (!node?.parentId || !contactMap.has(node.parentId)) children.push(c);
      } else {
        if (node?.parentId === parentId) children.push(c);
      }
    }
    const ROLE_RANK = { 'Decision Maker': 0, 'Influencer': 1, 'Other': 2, 'Left': 3, 'Unknown': 4 };
    function roleOf(c) {
      const r = c.decision_maker || 'Unknown';
      return (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
    }
    children.sort((a, b) => (ROLE_RANK[roleOf(a)] ?? 5) - (ROLE_RANK[roleOf(b)] ?? 5));
    return children;
  }

  function handleDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDropTarget(null); return; }
    let check = targetId;
    while (check) { if (check === dragId) { setDragId(null); setDropTarget(null); return; } check = orgData[check]?.parentId || null; }
    persist({ ...orgData, [dragId]: { ...orgData[dragId], parentId: targetId } });
    setDragId(null); setDropTarget(null);
  }

  function handleDropRoot(e) {
    e.preventDefault();
    if (!dragId) return;
    const next = { ...orgData };
    if (next[dragId]) delete next[dragId].parentId;
    persist(next); setDragId(null); setDropTarget(null);
  }

  function removeParent(id) {
    const next = { ...orgData };
    if (next[id]) delete next[id].parentId;
    persist(next);
  }

  const roleColors = {
    'Decision Maker': { bg: '#DCFCE7', color: '#166534', border: '#86EFAC', accent: '#22C55E' },
    'Influencer': { bg: '#DBEAFE', color: '#1E40AF', border: '#93C5FD', accent: '#3B82F6' },
    'Left': { bg: '#FEF9C3', color: '#92400E', border: '#FDE68A', accent: '#F59E0B' },
    'Other': { bg: '#F3E8FF', color: '#7C3AED', border: '#C4B5FD', accent: '#8B5CF6' },
    'Unknown': { bg: '#F3F4F6', color: '#6B7280', border: '#D1D5DB', accent: '#9CA3AF' },
  };

  function getRoleInfo(c) {
    const r = c.decision_maker || 'Unknown';
    const role = (r === 'true' || r === 'Yes') ? 'Decision Maker' : (r === 'No' || r === 'false') ? 'Unknown' : r;
    return { role, ...(roleColors[role] || roleColors['Unknown']) };
  }

  /* ── Tree Node (hierarchical box with connector lines) ── */
  function TreeNode({ contact, isRoot }) {
    const id = contact._id;
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || '—';
    const { role, bg, color, border, accent } = getRoleInfo(contact);
    const children = getChildren(id);
    const isDragOver = dropTarget === id;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Vertical line from parent */}
        {!isRoot && <div style={{ width: '2px', height: '20px', background: '#CBD5E1' }} />}

        {/* Contact card */}
        <div
          draggable
          onDragStart={e => { e.stopPropagation(); setDragId(id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropTarget(id); }}
          onDragLeave={() => { if (dropTarget === id) setDropTarget(null); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(id); }}
          style={{
            width: '150px', padding: '0.5rem 0.55rem',
            background: isDragOver ? '#EFF6FF' : '#fff',
            border: `2px solid ${isDragOver ? '#3B82F6' : border}`,
            borderRadius: '10px', cursor: 'grab', textAlign: 'center',
            boxShadow: dragId === id ? '0 6px 16px rgba(0,0,0,0.18)' : '0 2px 6px rgba(0,0,0,0.06)',
            opacity: dragId === id ? 0.4 : 1,
            transition: 'all 0.15s ease', position: 'relative',
            borderTop: `3px solid ${accent}`,
          }}
        >
          <div style={{ position: 'absolute', top: '1px', right: '3px', display: 'flex', gap: '2px' }}>
            {!isRoot && (
              <button onClick={e => { e.stopPropagation(); removeParent(id); }} title="Move to top level"
                style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.75rem', cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={e => e.target.style.color = '#3B82F6'}
                onMouseLeave={e => e.target.style.color = '#CBD5E1'}
              >↑</button>
            )}
            {onDeleteContact && (
              <button onClick={e => { e.stopPropagation(); onDeleteContact(contact); }} title="Delete contact"
                disabled={deletingContact === (contact.id || contact.vid)}
                style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.75rem', cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={e => e.target.style.color = '#EF4444'}
                onMouseLeave={e => e.target.style.color = '#CBD5E1'}
              >{deletingContact === (contact.id || contact.vid) ? '…' : '×'}</button>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: '0.76rem', color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          {contact.jobtitle && (
            <div style={{ fontSize: '0.64rem', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>{contact.jobtitle}</div>
          )}
          <div style={{ marginTop: '4px' }}>
            <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: '999px', fontSize: '0.56rem', fontWeight: 700, background: bg, color, letterSpacing: '0.02em' }}>{role}</span>
          </div>
        </div>

        {/* Children */}
        {children.length > 0 && (
          <>
            {/* Vertical line down to horizontal bar */}
            <div style={{ width: '2px', height: '20px', background: '#CBD5E1' }} />

            {/* Horizontal bar spanning all children */}
            {children.length > 1 && (
              <div style={{ height: '2px', background: '#CBD5E1', alignSelf: 'stretch', marginLeft: `calc(50% / ${children.length})`, marginRight: `calc(50% / ${children.length})` }} />
            )}

            {/* Children row */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
              {children.map(child => (
                <TreeNode key={child._id} contact={child} isRoot={false} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const roots = getChildren(null);

  if (contacts.length === 0) {
    return <div style={{ fontSize: '0.78rem', color: '#9CA3AF', fontStyle: 'italic', padding: '1rem 0' }}>No contacts to display</div>;
  }

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={handleDropRoot}
      style={{ minHeight: '120px', padding: '0.75rem 0', overflowX: 'auto' }}
    >
      <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginBottom: '0.75rem', textAlign: 'center' }}>
        Drag contacts onto each other to build the hierarchy. Drag to empty space to move to top level.
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', minWidth: 'min-content' }}>
        {roots.map(c => (
          <TreeNode key={c._id} contact={c} isRoot={true} />
        ))}
      </div>
    </div>
  );
}

const EMPTY = {
  company: '', cdm: '', status: 'Inside Sales', type: '', geography: '', publicPrivate: '',
  assetTypes: [], peAum: null, reAum: null, numberOfSites: null, rank: '', tier: 'Tier 2',
  hqRegion: '', frameworks: [], notes: '', website: '', emailDomain: '',
};

export function ProspectModal({ prospect, onSave, onClose, isNew, hubspotContacts = [], onDeleteContact }) {
  const [fields, setFields] = useState(() => {
    if (prospect) return { ...EMPTY, ...prospect };
    return { ...EMPTY };
  });

  const companyContacts = useMemo(() => {
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

  const [contactView, setContactView] = useState('table'); // 'table' | 'orgchart'
  const [showSaved, setShowSaved] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);

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
                  >Org Chart</button>
                </div>
              </div>

              {contactView === 'orgchart' ? (
                <OrgChart contacts={companyContacts} company={fields.company} onDeleteContact={handleDeleteContact} deletingContact={deletingContact} />
              ) : companyContacts.length > 0 ? (
                <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Name</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Title</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Email</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Phone</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Role</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>LinkedIn</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#64748B', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E2E8F0' }}>Email</th>
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
                          <tr key={c.id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>{name || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.jobtitle || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#475569', whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}><span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700, background: rs.bg, color: rs.color }}>{role}</span></td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              {linkedinUrl ? <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://linkedin.com/in/${linkedinUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', fontSize: '0.7rem', fontWeight: 600, textDecoration: 'none' }}>View</a> : <span style={{ color: '#CBD5E1' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center' }}>
                              {c.email ? (
                                <button
                                  onClick={() => {
                                    const firstName = c.firstname || '';
                                    const companyName = fields.company || '';
                                    const subject = encodeURIComponent(`Introduction — ${companyName}`);
                                    const body = encodeURIComponent(`Hi ${firstName},\n\nI hope this message finds you well.\n\n`);
                                    window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(c.email)}&subject=${subject}&body=${body}`, '_blank');
                                  }}
                                  style={{ padding: '2px 8px', border: '1px solid #0078D4', borderRadius: '4px', background: '#EFF6FF', color: '#0078D4', fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >
                                  Draft
                                </button>
                              ) : <span style={{ color: '#CBD5E1' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.3rem', textAlign: 'center' }}>
                              <button
                                onClick={() => handleDeleteContact(c)}
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
    </div>
  );
}
