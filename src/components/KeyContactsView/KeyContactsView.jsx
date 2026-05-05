import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { formatAum } from '../../utils/formatters';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { buildCompanyGuessIndex, guessCompanyForContact } from '../../utils/companyGuess';

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

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
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function loadFromIndexedDB() {
      try { const data = await dbGet('opps-cache', 'data'); return data?.records || null; } catch { return null; }
    }
    function loadFromLocalStorage() {
      try { const cache = JSON.parse(localStorage.getItem('opps-cache')); return cache?.records || null; } catch { return null; }
    }
    async function loadFromFirestore() {
      if (!userId) return null;
      try {
        const ref = doc(db, 'oppsData', userId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const raw = snap.data();
        if (!raw?.json) return null;
        const parsed = JSON.parse(raw.json);
        return parsed?.records || null;
      } catch { return null; }
    }
    (async () => {
      let recs = await loadFromIndexedDB();
      if (!recs || recs.length === 0) recs = loadFromLocalStorage();
      if (!recs || recs.length === 0) recs = await loadFromFirestore();
      if (!cancelled && recs && recs.length > 0) setRecords(recs);
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return records;
}

// Defaults for the original "Dan Key Target" page. Other tabs (e.g. the
// Active Contacts tab) override these to reuse the same UI.
const KEY_TARGET_SELECTOR = (c) => {
  const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
  if (tags.includes('hide')) return false;
  return tags.includes('dan key target');
};

export function KeyContactsView({
  prospects = [],
  onSelectProspect,
  settings = {},
  updateSettings = () => {},
  storagePrefix = 'key-contacts',
  pageTitle = 'Key Contacts',
  pageSubtitle = (
    <>Every HubSpot contact tagged <code>Dan Key Target</code>. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats.</>
  ),
  emptyTitle = 'No "Dan Key Target" contacts found',
  emptyDetail = (
    <>Tag a HubSpot contact with <code>Dan Key Target</code> in the HubSpot Contacts tab and they'll show up here.</>
  ),
  contactSelector = KEY_TARGET_SELECTOR,
  metInPersonSelector = (c) => (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase().includes('met in person'),
  requireActiveOpp = false,
  // When true, only keep contacts whose company doesn't match any
  // prospect on the Table View (matched via companiesMatch + email
  // domain). Useful for surfacing "we're emailing them but haven't
  // tracked their company yet" gaps.
  unmappedOnly = false,
  // Adds a "Suggested Company" column that guesses a Table View
  // company for each contact based on their email domain / current
  // Company text. Most useful when paired with `unmappedOnly`.
  showSuggestedCompany = false,
  // When provided, fires with the count of contacts that would pass
  // the "active in past 30 days AND not in Table View" filter — used
  // by ActiveContactsView to label the toggle checkbox. The count is
  // emitted regardless of whether `unmappedOnly` is currently on so
  // the user can see how many rows the filter would expose before
  // flipping it.
  onUnmappedPast30CountChange,
}) {
  const lsKey = (suffix) => `${storagePrefix}:${suffix}`;
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  // Mass-edit state. When `massMode` is on the All Contacts table grows
  // a checkbox column and a toolbar surfaces at the top to apply a
  // single field value across every checked contact via the HubSpot
  // update endpoint.
  const [massMode, setMassMode] = useState(false);
  const [massSelected, setMassSelected] = useState(() => new Set());
  const [massField, setMassField] = useState('company');
  const [massValue, setMassValue] = useState('');
  const [massStatus, setMassStatus] = useState(null); // { type, message }
  const [massProcessing, setMassProcessing] = useState(false);
  const [massCompanyOpen, setMassCompanyOpen] = useState(false);
  const [massCompanyHover, setMassCompanyHover] = useState(0);
  const massCompanyBoxRef = useRef(null);
  useEffect(() => {
    if (!massCompanyOpen) return;
    const onDown = (e) => { if (!massCompanyBoxRef.current?.contains(e.target)) setMassCompanyOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [massCompanyOpen]);
  function toggleMassSelect(id) {
    setMassSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Append the "hide" tag to a contact's existing Dan's Tags. The
  // contactSelector for both Key Contacts and Active Contacts skips
  // anything tagged "hide", so the row vanishes after the cache event
  // fires. Existing tags are preserved.
  async function applyHideTag(contactIds) {
    if (!contactIds || contactIds.length === 0) return { updated: 0, errors: 0 };
    const idSet = new Set(contactIds.map(String));
    const cache = hubspotCache?.contacts || [];
    let updated = 0;
    let errors = 0;
    for (const id of idSet) {
      const c = cache.find(x => String(x.id) === id) || cache.find(x => String(x.vid) === id);
      const raw = (c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '');
      const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
      const lower = new Set(parts.map(p => p.toLowerCase()));
      if (lower.has('hide')) { updated += 1; continue; } // already hidden
      parts.push('Hide');
      const nextTags = parts.join('; ');
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { dans_tags: nextTags } }),
        });
        const json = await res.json();
        if (json.error) { errors += 1; continue; }
        updated += 1;
      } catch { errors += 1; }
    }
    try {
      await updateHubspotCache(draft => {
        for (const c of draft.contacts) {
          if (!idSet.has(String(c.id || c.vid))) continue;
          const existing = (c.dans_tags || c.dan_s_tags || c.dans_tag || '');
          const parts = existing.split(';').map(s => s.trim()).filter(Boolean);
          if (parts.some(p => p.toLowerCase() === 'hide')) continue;
          parts.push('Hide');
          c.dans_tags = parts.join('; ');
        }
      });
    } catch (err) { console.warn('Hide cache update failed', err); }
    return { updated, errors };
  }

  // Push a suggested-company value onto the contact in HubSpot and
  // update the local cache so the row reflects the new mapping (and
  // the unmapped-only filter, if active, drops it).
  async function applySuggestedCompany(contact, suggested) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id || !suggested) return;
    setMassProcessing(true);
    setMassStatus(null);
    let ok = false;
    try {
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id, properties: { company: suggested } }),
      });
      const json = await res.json();
      ok = !json.error;
    } catch { ok = false; }
    if (ok) {
      try {
        await updateHubspotCache(draft => {
          const target = draft.contacts.find(x => String(x.id || x.vid) === id);
          if (target) target.company = suggested;
        });
      } catch (err) { console.warn('Suggested-company cache update failed', err); }
      setMassStatus(null);
    } else {
      setMassStatus({ type: 'partial', message: 'Apply failed' });
    }
    setMassProcessing(false);
  }

  async function handleHideRow(contact) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id) return;
    setMassProcessing(true);
    setMassStatus(null);
    const { updated, errors } = await applyHideTag([id]);
    setMassProcessing(false);
    if (errors > 0) {
      setMassStatus({ type: 'partial', message: `Hide failed (${errors})` });
    } else {
      setMassStatus(null);
      void updated;
    }
  }

  async function handleMassHide() {
    if (massSelected.size === 0) return;
    if (!window.confirm(`Hide ${massSelected.size} selected contact${massSelected.size === 1 ? '' : 's'}? This adds the "Hide" tag in HubSpot so they stop appearing here.`)) return;
    setMassProcessing(true);
    setMassStatus(null);
    const { updated, errors } = await applyHideTag([...massSelected]);
    setMassStatus({
      type: errors === 0 ? 'success' : 'partial',
      message: `Hid ${updated} contact${updated === 1 ? '' : 's'}${errors > 0 ? `, ${errors} failed` : ''}`,
    });
    setMassProcessing(false);
    setMassSelected(new Set());
  }

  async function handleMassApply() {
    if (massSelected.size === 0 || !massValue.trim()) return;
    setMassProcessing(true);
    setMassStatus(null);
    let updated = 0, errors = 0;
    const value = massValue.trim();
    for (const id of massSelected) {
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { [massField]: value } }),
        });
        const json = await res.json();
        if (json.error) errors++; else updated++;
      } catch { errors++; }
    }
    try {
      await updateHubspotCache(draft => {
        for (const c of draft.contacts) {
          if (massSelected.has(c.id)) c[massField] = value;
        }
      });
    } catch (err) { console.warn('Mass cache update failed', err); }
    setMassStatus({
      type: errors === 0 ? 'success' : 'partial',
      message: `Updated ${updated} contact${updated === 1 ? '' : 's'}${errors > 0 ? `, ${errors} failed` : ''}`,
    });
    setMassProcessing(false);
    setMassValue('');
    setMassSelected(new Set());
  }

  // The contact currently being edited in the in-place modal. We open
  // the same `ContactEditModal` the prospect modal uses so edits made
  // here propagate through the shared HubSpot cache + Firestore
  // settings — the prospect modal's contact list listens to the same
  // `hubspot-cache-updated` event we do, so a save here lights up
  // there automatically (and vice-versa).
  const [editingContact, setEditingContact] = useState(null);
  const handleContactSaved = useCallback((updated) => {
    setEditingContact(null);
    // updateHubspotCache (called inside the modal) already dispatches
    // a `hubspot-cache-updated` event that our existing listener picks
    // up to refresh the table — nothing to do here.
    void updated;
  }, []);
  const handleSaveContactNote = useCallback((cid, note) => {
    const cur = settings?.contactNotes || {};
    const next = { ...cur };
    if (note && note.trim()) next[cid] = note; else delete next[cid];
    updateSettings({ contactNotes: next });
  }, [settings?.contactNotes, updateSettings]);
  const handleSaveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const handleSaveContactNickname = useCallback((cid, val) => {
    const cur = settings?.contactNicknames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactNicknames: next });
  }, [settings?.contactNicknames, updateSettings]);
  const handleSaveContactTeamName = useCallback((cid, val) => {
    const cur = settings?.contactTeamNames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val.trim(); else delete next[cid];
    updateSettings({ contactTeamNames: next });
  }, [settings?.contactTeamNames, updateSettings]);
  const handleSaveContactReportsTo = useCallback((cid, managerIds) => {
    const cur = settings?.contactReportsTo || {};
    const next = { ...cur };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[cid] = arr; else delete next[cid];
    updateSettings({ contactReportsTo: next });
  }, [settings?.contactReportsTo, updateSettings]);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(lsKey('view-mode')) || 'contacts');
  useEffect(() => { try { localStorage.setItem(lsKey('view-mode'), viewMode); } catch {} }, [viewMode]);
  const [contactSortKey, setContactSortKey] = useState(() => localStorage.getItem(lsKey('contact-sort-key')) || 'name');
  const [contactSortDir, setContactSortDir] = useState(() => localStorage.getItem(lsKey('contact-sort-dir')) || 'asc');
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-key'), contactSortKey); } catch {} }, [contactSortKey]);
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-dir'), contactSortDir); } catch {} }, [contactSortDir]);
  function toggleContactSort(key) {
    setContactSortDir(prev => (contactSortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setContactSortKey(key);
  }

  const DEFAULT_CONTACT_COL_WIDTHS = {
    name: 180, title: 200, company: 200, suggestedCompany: 220, email: 240, phone: 140, location: 140, country: 120, linkedin: 90, met: 80,
  };
  const [contactColWidths, setContactColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('contact-col-widths'))) || {};
      return { ...DEFAULT_CONTACT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_CONTACT_COL_WIDTHS; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey('contact-col-widths'), JSON.stringify(contactColWidths)); } catch {} }, [contactColWidths]);
  const [contactColFilters, setContactColFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey('contact-col-filters'))) || {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey('contact-col-filters'), JSON.stringify(contactColFilters)); } catch {} }, [contactColFilters]);
  const contactResizingRef = useRef(null);
  function startContactResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    contactResizingRef.current = { key: colKey, startX: e.clientX, startWidth: contactColWidths[colKey] || 100 };
    const onMove = (ev) => {
      if (!contactResizingRef.current) return;
      const delta = ev.clientX - contactResizingRef.current.startX;
      const next = Math.max(60, contactResizingRef.current.startWidth + delta);
      setContactColWidths(prev => ({ ...prev, [contactResizingRef.current.key]: next }));
    };
    const onUp = () => {
      contactResizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  const [hubspotCache, setHubspotCacheState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { getHubspotCache().then(c => { if (!cancelled) setHubspotCacheState(c); }).catch(() => {}); };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const DEFAULT_COL_WIDTHS = { company: 260, aum: 100, type: 120, status: 130, keyContacts: 130, dm: 150, met: 130, ratio: 110 };
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('col-widths'))) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => localStorage.getItem(lsKey('sort-key')) || 'keyContacts');
  const [sortDir, setSortDir] = useState(() => localStorage.getItem(lsKey('sort-dir')) || 'desc');
  useEffect(() => { try { localStorage.setItem(lsKey('col-widths'), JSON.stringify(colWidths)); } catch {} }, [colWidths]);
  useEffect(() => { try { localStorage.setItem(lsKey('sort-key'), sortKey); } catch {} }, [sortKey]);
  useEffect(() => { try { localStorage.setItem(lsKey('sort-dir'), sortDir); } catch {} }, [sortDir]);

  const resizingRef = useRef(null);
  function startResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key: colKey, startX: e.clientX, startWidth: colWidths[colKey] || 100 };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const next = Math.max(60, resizingRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current.key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function toggleSort(key) {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key);
  }

  const oppsRecords = useOppsRecords(user?.uid);

  const FREE_MAIL = useMemo(() => new Set([
    'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
    'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  ]), []);

  // Pull domain off a prospect — manual emailDomain entries plus website hostname.
  const collectProspectDomains = (p, into) => {
    if (!p) return;
    if (p.emailDomain) {
      for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
        const at = entry.lastIndexOf('@');
        const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
        if (d) into.add(d);
      }
    }
    if (p.website) {
      const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) into.add(d);
    }
  };

  // Every contact tagged "Dan Key Target" (excluding hidden). One entry per contact;
  // we'll bucket them by company below.
  // Companies (lowercased) that have at least one open / active opp.
  // Only computed when `requireActiveOpp` is on; used to gate which
  // contacts even enter the keyContacts list. Active = stage outside
  // CLOSED_STAGES and INVALID_STAGES.
  const activeOppCompanies = useMemo(() => {
    if (!requireActiveOpp) return null;
    const out = [];
    const seen = new Set();
    for (const r of oppsRecords) {
      const stage = (r['Stage'] || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const acct = String(r['Account'] || '').trim();
      const k = acct.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(acct);
    }
    return out;
  }, [requireActiveOpp, oppsRecords]);

  // Index of prospect domains / canonical names — fed into
  // guessCompanyForContact to fill the Suggested Company column.
  const companyGuessIndex = useMemo(
    () => showSuggestedCompany ? buildCompanyGuessIndex(prospects, hubspotCache?.contacts || []) : null,
    [showSuggestedCompany, prospects, hubspotCache]
  );

  const keyContacts = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!contactSelector(c)) continue;
      if (activeOppCompanies) {
        const cName = String(c.company || '').trim();
        if (!cName) continue;
        const lc = cName.toLowerCase();
        // Fast exact-match path first; fall back to fuzzy match so
        // "Acme Corp" vs "Acme Corporation" still pairs correctly.
        let hit = activeOppCompanies.some(a => a.toLowerCase() === lc);
        if (!hit) hit = activeOppCompanies.some(a => companiesMatch(a, cName));
        if (!hit) continue;
      }
      if (unmappedOnly) {
        // Treat the contact as "mapped" when any prospect's company
        // matches by name OR a domain is shared. Anything else (no
        // company, unknown company, novel domain) counts as unmapped.
        const cName = String(c.company || '').trim();
        const email = (c.email || '').toLowerCase().trim();
        const at = email.lastIndexOf('@');
        const cDomain = at >= 0 ? email.slice(at + 1).trim() : '';
        const cDomainOk = cDomain && !FREE_MAIL.has(cDomain);
        const mapped = (cName && prospects.some(p => companiesMatch(p.company, cName)))
          || (cDomainOk && prospects.some(p => {
            const ds = new Set();
            collectProspectDomains(p, ds);
            return ds.has(cDomain);
          }));
        if (mapped) continue;
      }
      const company = (c.company || '').trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        id: c.id || `${c.email || ''}|${c.firstname || ''}|${c.lastname || ''}`,
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        email: c.email || '',
        phone: c.phone || '',
        jobtitle: c.jobtitle || '',
        linkedin: c.hs_linkedin_url || '',
        city: String(c.city || '').trim(),
        state: String(c.state || '').trim(),
        country: String(c.country || '').trim(),
        metInPerson: metInPersonSelector(c),
        company,
        domain,
        suggestedCompany: companyGuessIndex ? guessCompanyForContact(c, companyGuessIndex) : '',
        raw: c,
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL, contactSelector, metInPersonSelector, activeOppCompanies, unmappedOnly, prospects, companyGuessIndex]);

  // Count of contacts the "unmapped past 30 days" filter WOULD yield,
  // computed independently from the active filters above so we can
  // show the badge whether the toggle is on or off. Mirrors the same
  // 30-day activity check + Table-View-not-mapped logic used when
  // `unmappedOnly` is on.
  const unmappedPast30Count = useMemo(() => {
    if (!onUnmappedPast30CountChange) return 0;
    const cutoff = Date.now() - 30 * 86400000;
    const fields = ['hs_email_last_send_date', 'hs_sales_email_last_replied', 'hs_email_last_open_date', 'hs_email_last_click_date', 'notes_last_contacted'];
    let n = 0;
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      let recent = false;
      for (const f of fields) {
        const v = c[f];
        if (!v) continue;
        const ts = Date.parse(v);
        if (Number.isNaN(ts)) continue;
        if (ts >= cutoff) { recent = true; break; }
      }
      if (!recent) continue;
      const cName = String(c.company || '').trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const cDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const cDomainOk = cDomain && !FREE_MAIL.has(cDomain);
      const mapped = (cName && prospects.some(p => companiesMatch(p.company, cName)))
        || (cDomainOk && prospects.some(p => {
          const ds = new Set();
          collectProspectDomains(p, ds);
          return ds.has(cDomain);
        }));
      if (!mapped) n += 1;
    }
    return n;
  }, [onUnmappedPast30CountChange, hubspotCache, FREE_MAIL, prospects]);
  useEffect(() => {
    if (onUnmappedPast30CountChange) onUnmappedPast30CountChange(unmappedPast30Count);
  }, [unmappedPast30Count, onUnmappedPast30CountChange]);

  // Decision-maker contacts — used for the per-company DM column. Mirrors
  // the equivalent flat-list pattern from the PE Portfolio view.
  const decisionMakers = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('decision maker')) continue;
      const company = (c.company || '').toLowerCase().trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        domain,
        metInPerson: tags.includes('met in person'),
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

  // Build one row per distinct company that has ≥1 Dan Key Target contact.
  // Each row is anchored to a prospect when one matches by name OR domain;
  // otherwise we surface the raw HubSpot company name so contacts on
  // companies that aren't yet prospect records still show up.
  const rows = useMemo(() => {
    if (keyContacts.length === 0) return [];

    // Each row keyed by either prospect.id or `raw:<lowercased company>`.
    const byKey = new Map();

    for (const kc of keyContacts) {
      // Try to find a matching prospect: company-name match first,
      // then domain match.
      let match = null;
      if (kc.company) {
        match = prospects.find(p => companiesMatch(p.company, kc.company));
      }
      if (!match && kc.domain) {
        match = prospects.find(p => {
          const ds = new Set();
          collectProspectDomains(p, ds);
          return ds.has(kc.domain);
        });
      }

      const key = match ? `pid:${match.id}` : `raw:${(kc.company || '(no company)').toLowerCase()}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          prospect: match || null,
          rawCompany: match ? null : (kc.company || '(no company)'),
          contacts: [],
        });
      }
      byKey.get(key).contacts.push(kc);
    }

    // Compute per-row stats: opps, decision makers, etc.
    const out = [];
    for (const row of byKey.values()) {
      const p = row.prospect;
      const companyName = p?.company || row.rawCompany || '';
      const lowerName = companyName.toLowerCase();

      const domains = new Set();
      if (p) collectProspectDomains(p, domains);
      // Also add the contacts' own domains to widen the DM/opps match —
      // contacts on the same company often share the corporate domain even
      // if no prospect record carries it yet.
      for (const c of row.contacts) {
        if (c.domain) domains.add(c.domain);
      }

      // Decision makers on this company (by name or domain).
      const dmSeen = new Set();
      const dmEntries = [];
      for (const dm of decisionMakers) {
        const matches =
          (dm.company && lowerName && companiesMatch(lowerName, dm.company)) ||
          (dm.domain && domains.has(dm.domain));
        if (!matches) continue;
        if (dmSeen.has(dm.name)) continue;
        dmSeen.add(dm.name);
        dmEntries.push(dm);
      }

      // Opps on this company (any stage; closed filtered later).
      const opps = [];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct || !lowerName) continue;
        if (!companiesMatch(lowerName, acct)) continue;
        opps.push(r);
      }
      const activeOpps = opps.filter(r => !CLOSED_STAGES.has((r['Stage'] || '').trim())).length;
      const totalOpps = opps.length;

      // Choose an AUM to display: peAum if set, else reAum.
      const aum = p ? (p.peAum || p.reAum || 0) : 0;

      out.push({
        ...row,
        companyName,
        aum,
        type: p?.type || '',
        status: p?.status || '',
        decisionMakerEntries: dmEntries,
        metInPersonCount: dmEntries.filter(e => e.metInPerson).length,
        nycCount: dmEntries.filter(e => /(new york|nyc)/i.test(e.city || '')).length,
        opps,
        activeOpps,
        totalOpps,
      });
    }
    return out;
  }, [keyContacts, prospects, decisionMakers, oppsRecords]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'company':
          cmp = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'aum':
          cmp = (a.aum || 0) - (b.aum || 0);
          break;
        case 'type':
          cmp = (a.type || '').localeCompare(b.type || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'keyContacts':
          cmp = a.contacts.length - b.contacts.length;
          break;
        case 'dm':
          cmp = a.decisionMakerEntries.length - b.decisionMakerEntries.length;
          break;
        case 'met':
          cmp = (a.metInPersonCount || 0) - (b.metInPersonCount || 0);
          if (cmp === 0) cmp = (a.nycCount || 0) - (b.nycCount || 0);
          break;
        case 'ratio':
          cmp = (a.activeOpps || 0) - (b.activeOpps || 0);
          if (cmp === 0) cmp = (a.totalOpps || 0) - (b.totalOpps || 0);
          break;
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.companyName || '').localeCompare(b.companyName || '');
      return cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? sortedRows.filter(r => (r.companyName || '').toLowerCase().includes(q))
    : sortedRows;

  // Flat list of every Dan Key Target contact, paired with the matched
  // prospect (when one) so we can route the open-prospect arrow.
  const flatContacts = useMemo(() => {
    const prospectByKey = new Map();
    for (const row of rows) {
      if (row.prospect) prospectByKey.set(row.key, row.prospect);
    }
    const out = [];
    for (const row of rows) {
      for (const c of row.contacts) {
        out.push({
          ...c,
          companyName: row.companyName,
          prospect: row.prospect || null,
          rowKey: row.key,
        });
      }
    }
    return out;
  }, [rows]);

  const sortedContacts = useMemo(() => {
    const arr = [...flatContacts];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (contactSortKey) {
        case 'name':
          cmp = (a.lastname || a.name || '').localeCompare(b.lastname || b.name || '')
            || (a.firstname || '').localeCompare(b.firstname || '');
          break;
        case 'title':   cmp = (a.jobtitle || '').localeCompare(b.jobtitle || ''); break;
        case 'company': cmp = (a.companyName || '').localeCompare(b.companyName || ''); break;
        case 'suggestedCompany': cmp = (a.suggestedCompany || '').localeCompare(b.suggestedCompany || ''); break;
        case 'email':   cmp = (a.email || '').localeCompare(b.email || ''); break;
        case 'location':
          cmp = ((a.state || '') + (a.city || '')).localeCompare((b.state || '') + (b.city || ''));
          break;
        case 'country': cmp = (a.country || '').localeCompare(b.country || ''); break;
        case 'met':     cmp = Number(!!a.metInPerson) - Number(!!b.metInPerson); break;
        default: cmp = 0;
      }
      if (contactSortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.name || '').localeCompare(b.name || '');
      return cmp;
    });
    return arr;
  }, [flatContacts, contactSortKey, contactSortDir]);

  const contactFieldGetters = {
    name:     c => c.name || '',
    title:    c => c.jobtitle || '',
    company:  c => c.companyName || '',
    suggestedCompany: c => c.suggestedCompany || '',
    email:    c => c.email || '',
    phone:    c => c.phone || '',
    location: c => [c.city, c.state].filter(Boolean).join(', '),
    country:  c => c.country || '',
    linkedin: c => c.linkedin ? 'open' : '',
    met:      c => c.metInPerson ? 'yes' : 'no',
  };
  const activeContactFilters = Object.entries(contactColFilters)
    .map(([k, v]) => [k, String(v || '').trim().toLowerCase()])
    .filter(([, v]) => v.length > 0);
  const filteredContacts = sortedContacts.filter(c => {
    if (q) {
      const blob = (c.name || '') + ' ' + (c.companyName || '') + ' '
        + (c.email || '') + ' ' + (c.jobtitle || '');
      if (!blob.toLowerCase().includes(q)) return false;
    }
    for (const [key, needle] of activeContactFilters) {
      const getter = contactFieldGetters[key];
      if (!getter) continue;
      if (!String(getter(c)).toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>{pageTitle}</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 720 }}>
            {pageSubtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
            {[
              { key: 'contacts', label: 'All Contacts' },
              { key: 'companies', label: 'By Company' },
            ].map((opt, i) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setViewMode(opt.key)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid #CBD5E1',
                  background: viewMode === opt.key ? '#1E293B' : '#fff',
                  color: viewMode === opt.key ? '#fff' : '#475569',
                }}
              >{opt.label}</button>
            ))}
          </div>
          {viewMode === 'companies' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
              <span>Include closed (Sold / Not Sold / Lost)</span>
            </label>
          )}
          {viewMode === 'contacts' && (
            <button
              type="button"
              onClick={() => {
                setMassMode(p => !p);
                setMassSelected(new Set());
                setMassValue('');
                setMassStatus(null);
              }}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: '1px solid ' + (massMode ? '#1E293B' : '#CBD5E1'),
                borderRadius: 6,
                background: massMode ? '#1E293B' : '#fff',
                color: massMode ? '#fff' : '#475569',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >{massMode ? 'Exit Mass Edit' : 'Mass Edit'}</button>
          )}
        </div>
      </div>

      {viewMode === 'contacts' && massMode && (
        <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B' }}>{massSelected.size} selected</span>
            <button
              type="button"
              onClick={() => setMassSelected(new Set(filteredContacts.map(c => c.id)))}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
            >Select all visible</button>
            <button
              type="button"
              onClick={() => setMassSelected(new Set())}
              disabled={massSelected.size === 0}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: massSelected.size === 0 ? '#CBD5E1' : '#475569', cursor: massSelected.size === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
            <select
              value={massField}
              onChange={e => setMassField(e.target.value)}
              style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit', background: '#fff' }}
            >
              <option value="company">Company</option>
              <option value="jobtitle">Job Title</option>
              <option value="phone">Phone</option>
              <option value="city">City</option>
              <option value="state">State</option>
              <option value="country">Country</option>
              <option value="firstname">First Name</option>
              <option value="lastname">Last Name</option>
            </select>
            {massField === 'company' ? (() => {
              const q = (massValue || '').trim().toLowerCase();
              const allNames = (() => {
                const seen = new Set();
                const out = [];
                for (const p of prospects) {
                  const s = String(p.company || '').trim();
                  if (!s) continue;
                  const k = s.toLowerCase();
                  if (seen.has(k)) continue;
                  seen.add(k);
                  out.push(s);
                }
                return out;
              })();
              const matches = q
                ? allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 12)
                : allNames.slice(0, 12);
              const showList = massCompanyOpen && matches.length > 0;
              return (
                <div ref={massCompanyBoxRef} style={{ position: 'relative', flex: '1 1 220px', minWidth: 160 }}>
                  <input
                    type="text"
                    value={massValue}
                    onFocus={() => { setMassCompanyOpen(true); setMassCompanyHover(0); }}
                    onChange={e => { setMassValue(e.target.value); setMassCompanyOpen(true); setMassCompanyHover(0); }}
                    onKeyDown={e => {
                      if (!showList) return;
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMassCompanyHover(h => Math.min(h + 1, matches.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setMassCompanyHover(h => Math.max(h - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); setMassValue(matches[massCompanyHover]); setMassCompanyOpen(false); }
                      else if (e.key === 'Escape') { setMassCompanyOpen(false); }
                    }}
                    placeholder="Type to search Table View companies…"
                    autoComplete="off"
                    style={{ width: '100%', padding: '0.25rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
                  />
                  {showList && (
                    <div style={{
                      position: 'absolute',
                      top: '100%', left: 0, right: 0,
                      marginTop: 2,
                      zIndex: 30,
                      maxHeight: 240,
                      overflowY: 'auto',
                      background: '#fff',
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                    }}>
                      {matches.map((n, i) => (
                        <div
                          key={n}
                          onMouseDown={e => { e.preventDefault(); setMassValue(n); setMassCompanyOpen(false); }}
                          onMouseEnter={() => setMassCompanyHover(i)}
                          style={{
                            padding: '0.4rem 0.6rem',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            background: i === massCompanyHover ? '#EFF6FF' : '#fff',
                            color: '#1E293B',
                            borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={n}
                        >{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })() : (
              <input
                type="text"
                value={massValue}
                onChange={e => setMassValue(e.target.value)}
                placeholder="New value…"
                style={{ flex: '1 1 220px', minWidth: 160, padding: '0.25rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
              />
            )}
            <button
              type="button"
              onClick={handleMassApply}
              disabled={massProcessing || massSelected.size === 0 || !massValue.trim()}
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: 'none',
                borderRadius: 4,
                background: (massProcessing || massSelected.size === 0 || !massValue.trim()) ? '#94A3B8' : '#1D4ED8',
                color: '#fff',
                cursor: (massProcessing || massSelected.size === 0 || !massValue.trim()) ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >{massProcessing ? 'Updating…' : 'Apply to Selected'}</button>
            <button
              type="button"
              onClick={handleMassHide}
              disabled={massProcessing || massSelected.size === 0}
              title="Add the Hide tag in HubSpot so these contacts stop appearing on this page"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #B91C1C',
                borderRadius: 4,
                background: (massProcessing || massSelected.size === 0) ? '#FEE2E2' : '#FEF2F2',
                color: '#B91C1C',
                cursor: (massProcessing || massSelected.size === 0) ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >Hide Selected</button>
            {massStatus && (
              <span style={{ fontSize: '0.7rem', color: massStatus.type === 'success' ? '#166534' : '#92400E' }}>{massStatus.message}</span>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={viewMode === 'contacts'
            ? `Search ${flatContacts.length} contact${flatContacts.length === 1 ? '' : 's'}…`
            : `Search ${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ width: '100%', maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {!hubspotCache && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            Loading HubSpot contacts… open the <strong>HubSpot Contacts</strong> tab once if this doesn't populate.
          </div>
        )}
        {viewMode === 'contacts' ? (
          filteredContacts.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                {flatContacts.length === 0 ? emptyTitle : `No contacts match "${query}"`}
              </div>
              <div style={{ fontSize: '0.78rem' }}>
                {flatContacts.length === 0
                  ? emptyDetail
                  : `${flatContacts.length} total contacts — adjust your search.`}
              </div>
            </div>
          ) : (() => {
            const CONTACT_COLS = [
              { key: 'name',     label: 'Name' },
              { key: 'title',    label: 'Title' },
              { key: 'company',  label: 'Company' },
              ...(showSuggestedCompany ? [{ key: 'suggestedCompany', label: 'Suggested Company' }] : []),
              { key: 'email',    label: 'Email' },
              { key: 'phone',    label: 'Phone' },
              { key: 'location', label: 'Location' },
              { key: 'country',  label: 'Country' },
              { key: 'linkedin', label: 'LinkedIn', sortable: false },
              { key: 'met',      label: 'Met' },
            ];
            const CONTACT_GRID = (massMode ? '32px ' : '')
              + CONTACT_COLS.map(c => `${contactColWidths[c.key] || 120}px`).join(' ')
              + ' 60px';
            const allVisibleSelected = massMode
              && filteredContacts.length > 0
              && filteredContacts.every(c => massSelected.has(c.id));
            const CONTACT_GLYPH = (key) => contactSortKey === key ? (contactSortDir === 'desc' ? ' ▼' : ' ▲') : '';
            const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
            return (
              <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', position: 'sticky', top: 0, zIndex: 1 }}>
                  {massMode && (
                    <div style={{ padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #E2E8F0' }}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={() => {
                          if (allVisibleSelected) {
                            const rest = new Set(massSelected);
                            for (const c of filteredContacts) rest.delete(c.id);
                            setMassSelected(rest);
                          } else {
                            const next = new Set(massSelected);
                            for (const c of filteredContacts) next.add(c.id);
                            setMassSelected(next);
                          }
                        }}
                        title={allVisibleSelected ? 'Clear visible' : 'Select visible'}
                      />
                    </div>
                  )}
                  {CONTACT_COLS.map(c => (
                    <div
                      key={c.key}
                      onClick={c.sortable === false ? undefined : () => toggleContactSort(c.key)}
                      title={c.sortable === false ? c.label : `Sort by ${c.label.toLowerCase()}`}
                      style={{
                        position: 'relative',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: contactSortKey === c.key ? '#1E293B' : '#475569',
                        background: contactSortKey === c.key ? '#E2E8F0' : 'transparent',
                        cursor: c.sortable === false ? 'default' : 'pointer',
                        userSelect: 'none',
                        borderRight: '1px solid #E2E8F0',
                      }}
                    >
                      {c.label}{c.sortable === false ? '' : CONTACT_GLYPH(c.key)}
                      <span
                        onMouseDown={e => startContactResize(c.key, e)}
                        onClick={e => e.stopPropagation()}
                        style={RESIZE_HANDLE}
                        title="Drag to resize"
                      />
                    </div>
                  ))}
                  <div />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', position: 'sticky', top: 28, zIndex: 1 }}>
                  {massMode && <div style={{ borderRight: '1px solid #E2E8F0' }} />}
                  {CONTACT_COLS.map(c => (
                    <div key={c.key} style={{ padding: '0.25rem 0.4rem', borderRight: '1px solid #E2E8F0' }}>
                      <input
                        type="text"
                        value={contactColFilters[c.key] || ''}
                        onChange={e => setContactColFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                        placeholder="Filter…"
                        style={{ width: '100%', padding: '0.2rem 0.35rem', fontSize: '0.7rem', border: '1px solid #E2E8F0', borderRadius: 3, fontFamily: 'inherit', background: '#fff' }}
                      />
                    </div>
                  ))}
                  <div />
                </div>
                {filteredContacts.map((c, i) => (
                  <div
                    key={`${c.rowKey}|${c.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: CONTACT_GRID,
                      alignItems: 'center',
                      borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                      background: massMode && massSelected.has(c.id) ? '#EFF6FF' : (i % 2 === 0 ? '#fff' : '#FCFCFD'),
                    }}
                  >
                    {massMode && (
                      <div style={{ padding: '0.45rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={massSelected.has(c.id)}
                          onChange={() => toggleMassSelect(c.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Click to edit ${c.name}`}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingContact(c.raw || c)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingContact(c.raw || c); } }}
                        style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline' }}
                      >{c.name}</span>
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.72rem', color: c.jobtitle ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.jobtitle}>{c.jobtitle || '—'}</div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.prospect ? `Click to open ${c.companyName}` : c.companyName}>
                      {c.companyName ? (
                        c.prospect ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectProspect?.(c.prospect)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProspect?.(c.prospect); } }}
                            style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                          >{c.companyName}</span>
                        ) : (
                          <span style={{ color: '#1E293B' }}>{c.companyName}</span>
                        )
                      ) : (
                        <span style={{ color: '#CBD5E1' }}>—</span>
                      )}
                    </div>
                    {showSuggestedCompany && (
                      <div style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }} title={c.suggestedCompany || ''}>
                        {c.suggestedCompany ? (
                          <>
                            <span style={{ color: '#0F766E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.suggestedCompany}</span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); applySuggestedCompany(c.raw || c, c.suggestedCompany); }}
                              disabled={massProcessing}
                              title={`Set ${c.name}'s Company to ${c.suggestedCompany}`}
                              style={{
                                background: '#ECFDF5',
                                border: '1px solid #6EE7B7',
                                color: '#065F46',
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 4,
                                cursor: massProcessing ? 'default' : 'pointer',
                                fontFamily: 'inherit',
                                flexShrink: 0,
                              }}
                            >Apply</button>
                          </>
                        ) : (
                          <span style={{ color: '#CBD5E1' }}>—</span>
                        )}
                      </div>
                    )}
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.email}>
                      {c.email
                        ? <a href={`mailto:${c.email}`} style={{ color: '#3B82F6', textDecoration: 'none' }}>{c.email}</a>
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.72rem', color: c.phone ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.phone}>{c.phone || '—'}</div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: (c.city || c.state) ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: c.country ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.country}>
                      {c.country || '—'}
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem' }}>
                      {c.linkedin
                        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>Open ↗</a>
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem' }}>
                      {c.metInPerson
                        ? <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 999 }}>✓ Yes</span>
                        : <span style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>—</span>}
                    </div>
                    <div style={{ padding: '0.2rem 0.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleHideRow(c.raw || c)}
                        disabled={massProcessing}
                        title="Add the Hide tag so this contact stops appearing here"
                        style={{
                          background: 'transparent',
                          border: '1px solid #FCA5A5',
                          color: '#B91C1C',
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          cursor: massProcessing ? 'default' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >Hide</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {rows.length === 0 ? emptyTitle : `No companies match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {rows.length === 0
                ? emptyDetail
                : `${rows.length} total companies — adjust your search.`}
            </div>
          </div>
        ) : (() => {
          const GRID = `${colWidths.company}px ${colWidths.aum}px ${colWidths.type}px ${colWidths.status}px ${colWidths.keyContacts}px ${colWidths.dm}px ${colWidths.met}px ${colWidths.ratio}px 28px`;
          const HEADER_COLUMNS = [
            { key: 'company',     label: 'Company',         align: 'left',   tip: 'Sort by company name' },
            { key: 'aum',         label: 'AUM',             align: 'right',  tip: 'PE AUM, falling back to RE AUM, from the prospect\'s Table View record' },
            { key: 'type',        label: 'Type',            align: 'left',   tip: 'Prospect type — Private Equity, Real Estate, etc.' },
            { key: 'status',      label: 'Status',          align: 'left',   tip: 'Prospect status — Client, Inside Sales, Qualifying, etc.' },
            { key: 'keyContacts', label: 'Key Contacts',    align: 'center', tip: 'Number of HubSpot contacts at this company tagged "Dan Key Target"' },
            { key: 'dm',          label: 'Decision Makers', align: 'center', tip: 'Number of HubSpot contacts at this company tagged "decision maker"' },
            { key: 'met',         label: 'Met in Person',   align: 'left',   tip: 'Met-in-person count / total decision makers, plus how many of them list New York / NYC' },
            { key: 'ratio',       label: 'Opps 2/4',        align: 'center', tip: 'Active / total opportunities for this company in the Opps tab' },
          ];
          const SORT_GLYPH = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
          return (
            <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', position: 'sticky', top: 0, zIndex: 1 }}>
                {HEADER_COLUMNS.map(c => (
                  <div
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    title={c.tip}
                    style={{
                      position: 'relative',
                      padding: '0.35rem 0.6rem',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: sortKey === c.key ? '#1E293B' : '#475569',
                      textAlign: c.align,
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: sortKey === c.key ? '#E2E8F0' : 'transparent',
                      borderRight: '1px solid #E2E8F0',
                    }}
                  >
                    {c.label}{SORT_GLYPH(c.key)}
                    <span
                      onMouseDown={e => startResize(c.key, e)}
                      onClick={e => e.stopPropagation()}
                      style={RESIZE_HANDLE}
                      title="Drag to resize"
                    />
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.6rem' }}></div>
              </div>

              {filteredRows.map((row, rowIdx) => {
                const isExpanded = expanded.has(row.key);
                const dmTotal = row.decisionMakerEntries.length;
                const met = row.metInPersonCount || 0;
                const nyc = row.nycCount || 0;
                const visibleOpps = (row.opps || []).filter(r => {
                  const stage = (r['Stage'] || '').trim();
                  if (!showClosed && CLOSED_STAGES.has(stage)) return false;
                  return true;
                });
                const oppsByStage = new Map();
                for (const r of visibleOpps) {
                  const k = (r['Stage'] || 'Unspecified').trim() || 'Unspecified';
                  if (!oppsByStage.has(k)) oppsByStage.set(k, []);
                  oppsByStage.get(k).push(r);
                }
                const stageOrder = Array.from(oppsByStage.keys()).sort((a, b) => a.localeCompare(b));

                return (
                  <div key={row.key} style={{ borderTop: rowIdx === 0 ? 'none' : '1px solid #E2E8F0' }}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      style={{ width: '100%', padding: 0, background: isExpanded ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center' }}
                    >
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {row.prospect ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); onSelectProspect?.(row.prospect); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSelectProspect?.(row.prospect); } }}
                            title={`Click to open ${row.companyName}`}
                            style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >{row.companyName}</span>
                        ) : (
                          <span style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.companyName}</span>
                        )}
                        {!row.prospect && (
                          <span style={{ padding: '1px 6px', fontSize: '0.55rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999, flexShrink: 0 }}>NO PROSPECT</span>
                        )}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: row.aum ? '#1E293B' : '#CBD5E1' }}
                        title={row.aum ? `AUM: $${row.aum}B` : 'No AUM set on this prospect record'}
                      >
                        {formatAum(row.aum)}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.type ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.type || '—'}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.status ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.status || '—'}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}
                        title={row.contacts.map(c => c.name + (c.jobtitle ? ` (${c.jobtitle})` : '')).join('\n')}
                      >
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: '#CFFAFE', color: '#0E7490', border: '1px solid #67E8F9',
                        }}>{row.contacts.length}</span>
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                        {dmTotal > 0 ? (
                          <span
                            title={row.decisionMakerEntries.map(e => e.name).join(', ')}
                            style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}
                          >✓ {dmTotal}</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>✗ 0</span>
                        )}
                      </div>

                      {(() => {
                        if (dmTotal === 0) return <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>—</div>;
                        const nycList = row.decisionMakerEntries
                          .filter(e => /(new york|nyc)/i.test(e.city || ''))
                          .map(e => `${e.name}${e.city ? ` (${e.city})` : ''}`)
                          .join(', ');
                        const metList = row.decisionMakerEntries.filter(e => e.metInPerson).map(e => e.name).join(', ');
                        const tipParts = [];
                        if (met > 0) tipParts.push(`Met in person: ${metList}`);
                        else tipParts.push('No decision makers tagged "met in person" yet');
                        if (nyc > 0) tipParts.push(`In NY: ${nycList}`);
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }} title={tipParts.join('\n')}>
                            <span style={{
                              padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                              background: met > 0 ? '#DCFCE7' : '#F1F5F9',
                              color:      met > 0 ? '#166534' : '#94A3B8',
                              border: `1px solid ${met > 0 ? '#86EFAC' : '#E2E8F0'}`,
                            }}>{met}/{dmTotal}</span>
                            {nyc > 0 && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#5B21B6' }}>({nyc} in NY)</span>
                            )}
                          </div>
                        );
                      })()}

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (row.activeOpps || 0) > 0 ? '#7C3AED' : (row.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }}
                        title="active / total opportunities for this company"
                      >
                        {(row.activeOpps || 0)}/{(row.totalOpps || 0)}
                      </div>

                      <div style={{ padding: '0.55rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
                        {isExpanded ? '▾' : '▸'}
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                            Key Target contacts <span style={{ color: '#94A3B8', fontWeight: 500 }}>({row.contacts.length})</span>
                          </div>
                          {(() => {
                            const CONTACT_GRID = '1.4fr 1.6fr 2fr 1.2fr 1.4fr 0.7fr 0.9fr';
                            return (
                              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, gap: '0.5rem', padding: '0.3rem 0.6rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B' }}>
                                  <div>Name</div>
                                  <div>Title</div>
                                  <div>Email</div>
                                  <div>Phone</div>
                                  <div>Location</div>
                                  <div>LinkedIn</div>
                                  <div>Met</div>
                                </div>
                                {row.contacts.map((c, i) => (
                                  <div
                                    key={c.id}
                                    style={{
                                      display: 'grid', gridTemplateColumns: CONTACT_GRID, gap: '0.5rem',
                                      padding: '0.4rem 0.6rem',
                                      borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                                      alignItems: 'center',
                                      background: i % 2 === 0 ? '#fff' : '#FCFCFD',
                                    }}
                                  >
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Click to edit ${c.name}`}>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={e => { e.stopPropagation(); setEditingContact(c.raw || c); }}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setEditingContact(c.raw || c); } }}
                                        style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline' }}
                                      >{c.name}</span>
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: c.jobtitle ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.jobtitle}>{c.jobtitle || '—'}</div>
                                    <div style={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.email}>
                                      {c.email
                                        ? <a href={`mailto:${c.email}`} style={{ color: '#3B82F6', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{c.email}</a>
                                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: c.phone ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.phone}>{c.phone || '—'}</div>
                                    <div style={{ fontSize: '0.68rem', color: (c.city || c.state) ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                                    </div>
                                    <div style={{ fontSize: '0.68rem' }}>
                                      {c.linkedin
                                        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }} onClick={e => e.stopPropagation()}>Open ↗</a>
                                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                                    </div>
                                    <div>
                                      {c.metInPerson
                                        ? <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 999 }}>✓ Yes</span>
                                        : <span style={{ color: '#CBD5E1', fontSize: '0.68rem' }}>—</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>

                        {stageOrder.length > 0 && (
                          <>
                            {stageOrder.map(stage => {
                              const list = oppsByStage.get(stage) || [];
                              return (
                                <div key={stage} style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                                  <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                                    {stage} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({list.length})</span>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.4rem' }}>
                                    {list.map((r, idx) => {
                                      const title = r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
                                      const value = r['Amount'] || r['Value'] || r['$'] || '';
                                      const closeDate = r['Close Date'] || r['Est. Close'] || r['Target Close'] || '';
                                      return (
                                        <div
                                          key={`${row.key}-${idx}`}
                                          onClick={() => row.prospect && onSelectProspect?.(row.prospect)}
                                          style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: row.prospect ? 'pointer' : 'default' }}
                                          onMouseEnter={e => { if (row.prospect) e.currentTarget.style.borderColor = '#3B82F6'; }}
                                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                                        >
                                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                          <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600 }}>{r['Account'] || ''}</div>
                                          {value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>{String(value).startsWith('$') ? value : `$${value}`}</div>}
                                          {closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {closeDate}</div>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}

                        {visibleOpps.length === 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>
                            No {showClosed ? '' : 'active '}opportunities for this company in the Opps tab.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      {editingContact && (() => {
        // Resolve sibling contacts at the same company so the Reports
        // To picker can offer managers; merge HubSpot domain hits with
        // any matching prospect's emailDomain field so corporate
        // emails group correctly.
        const editCompany = String(editingContact.company || '').trim().toLowerCase();
        const allHs = hubspotCache?.contacts || [];
        const sameCompanyContacts = editCompany
          ? allHs.filter(c => (c.company || '').trim().toLowerCase() === editCompany)
          : [];
        const matched = editCompany
          ? prospects.find(p => companiesMatch(p.company, editingContact.company))
          : null;
        const emailDomains = matched?.emailDomain
          ? String(matched.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
          : [];
        return (
          <ContactEditModal
            contact={editingContact}
            onSave={handleContactSaved}
            onClose={() => setEditingContact(null)}
            contactNotes={settings?.contactNotes || {}}
            onSaveNote={handleSaveContactNote}
            contactOldEmails={settings?.contactOldEmails || {}}
            onSaveOldEmails={handleSaveContactOldEmails}
            contactNicknames={settings?.contactNicknames || {}}
            onSaveNickname={handleSaveContactNickname}
            contactTeamNames={settings?.contactTeamNames || {}}
            onSaveTeamName={handleSaveContactTeamName}
            contactReportsTo={settings?.contactReportsTo || {}}
            onSaveReportsTo={handleSaveContactReportsTo}
            companyContacts={sameCompanyContacts}
            emailDomains={emailDomains}
            companyNames={prospects.map(p => p.company).filter(Boolean)}
          />
        );
      })()}
    </div>
  );
}
