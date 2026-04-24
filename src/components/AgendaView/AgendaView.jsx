import { useMemo, useState, useCallback, useRef, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import styles from './AgendaView.module.css';

const STORAGE_KEY = 'bulk-contacts-cache';

// Columns we'll try to pull out of an uploaded Excel alongside the
// standard contact fields. When present, we offer to backfill the
// matched Table View prospect with any of these four values it's
// missing (website, Zoom Company ID/Name, email domain).
const PROSPECT_BACKFILL_FIELDS = [
  { key: 'website',         label: 'Website',           aliases: ['website', 'url', 'web', 'homepage'] },
  { key: 'zoomCompanyId',   label: 'Zoom Company ID',   aliases: ['zoomcompanyid', 'zoomid'] },
  { key: 'zoomCompanyName', label: 'Zoom Company Name', aliases: ['zoomcompanyname', 'zoomname'] },
  { key: 'emailDomain',     label: 'Email Domain',      aliases: ['emaildomain', 'domain'] },
];

// Parse an uploaded Excel sheet into an array of AgendaView-compatible
// rows. Maps email + name + company + phone + jobtitle columns using
// the same norm rules as the per-company contact importer. Also picks
// up the four Table View backfill fields so we can later offer to
// populate missing values on the matched prospect.
function parseContactsXlsx(rows) {
  if (!rows || !rows.length) return [];
  const headers = Object.keys(rows[0]);
  const norm = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping = {};
  for (const h of headers) {
    const n = norm(h);
    if (n === 'email' || n === 'emailaddress') mapping[h] = 'email';
    else if (n === 'firstname' || n === 'first') mapping[h] = 'firstname';
    else if (n === 'lastname' || n === 'last') mapping[h] = 'lastname';
    else if (n === 'company' || n === 'companyname' || n === 'accountname' || n === 'account') mapping[h] = 'company';
    else if (n === 'phone') mapping[h] = 'phone';
    else if (n === 'jobtitle' || n === 'title') mapping[h] = 'jobtitle';
    else if (n === 'tags' || n === 'danstags') mapping[h] = 'dans_tags';
    else {
      for (const f of PROSPECT_BACKFILL_FIELDS) {
        if (f.aliases.includes(n)) { mapping[h] = `_upload_${f.key}`; break; }
      }
    }
  }
  const out = [];
  for (const r of rows) {
    const out1 = {
      email: '', firstname: '', lastname: '', company: '', phone: '', jobtitle: '', dans_tags: '',
    };
    for (const f of PROSPECT_BACKFILL_FIELDS) out1[`_upload_${f.key}`] = '';
    for (const [src, dst] of Object.entries(mapping)) {
      if (!dst) continue;
      out1[dst] = String(r[src] ?? '').trim();
    }
    if (!out1.email) continue;
    out1.email = out1.email.toLowerCase();
    if (out1.email.endsWith('@se.com')) continue;
    out.push(out1);
  }
  return out;
}

// "Name <email@x.com>" or just "email@x.com" or "First Last (email)" — extract pairs.
const PAIR_RE = /(?:"?([^"<\n,;]+?)"?\s*[<(]\s*)?([\w.+-]+@[\w-]+\.[\w.-]+)\s*[>)]?/g;

function parseDroppedText(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  let m;
  PAIR_RE.lastIndex = 0;
  while ((m = PAIR_RE.exec(text)) !== null) {
    const email = m[2].toLowerCase();
    if (seen.has(email)) continue;
    if (email.endsWith('@se.com')) continue;
    seen.add(email);
    let name = (m[1] || '').trim().replace(/^['"]|['"]$/g, '');
    let firstname = '';
    let lastname = '';
    if (name) {
      if (name.includes(',')) {
        // "Last, First" — common for Outlook contact cards.
        const [lastPart, firstPart = ''] = name.split(',').map(s => s.trim());
        lastname = lastPart;
        firstname = firstPart;
      } else {
        const parts = name.split(/\s+/);
        firstname = parts[0] || '';
        lastname = parts.slice(1).join(' ') || '';
      }
    }
    out.push({
      email,
      firstname,
      lastname,
      company: '',
      phone: '',
      jobtitle: '',
      suggestedCompany: '',
      companyDomains: [],
    });
  }
  return out;
}

// Try to find headers in dropped text (for forwarded emails or pasted message blocks).
// e.g. "From: Name <a@b.com>" / "To: ..." / "Cc: ..."
function parseEmailHeaders(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (const line of lines) {
    const m = /^\s*(From|To|Cc|Bcc|Sent\s+On\s+Behalf\s+Of)\s*:\s*(.+)$/i.exec(line);
    if (m) blocks.push(m[2]);
  }
  return blocks.length ? parseDroppedText(blocks.join('; ')) : parseDroppedText(text);
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveCache(rows) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
}

function loadHubSpotByEmail() {
  try {
    const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
    const m = new Map();
    for (const c of (cache?.contacts || [])) {
      if (c.email) m.set(c.email.toLowerCase(), c);
    }
    return m;
  } catch { return new Map(); }
}

// Convert an ALL-CAPS name to Title Case. "JOHN SMITH" -> "John Smith",
// "MARY-ANNE O'BRIEN" -> "Mary-Anne O'Brien". Mixed-case names pass through unchanged.
function fixAllCapsName(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  if (!trimmed) return trimmed;
  // Only touch it if it contains at least one letter AND the whole string is uppercase.
  if (!/[A-Z]/.test(trimmed)) return trimmed;
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  // Title-case each run of letters; preserve hyphens, apostrophes, spaces, dots.
  return trimmed.toLowerCase().replace(/([a-z])([a-z]*)/g, (_, first, rest) => first.toUpperCase() + rest);
}

// Extract the "brand" label from a domain — the second-level label minus TLD.
// "urw.com" -> "urw", "ext.urw.com" -> "urw", "acme.co.uk" -> "acme".
function extractBrandToken(domain) {
  if (!domain) return '';
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return domain;
  const twoPartTlds = new Set(['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'com.mx', 'co.in']);
  const last2 = parts.slice(-2).join('.');
  if (twoPartTlds.has(last2) && parts.length >= 3) return parts[parts.length - 3];
  return parts[parts.length - 2];
}

function guessDomainCompany(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  const domain = email.slice(at + 1).toLowerCase();
  if (['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com'].includes(domain)) return '';
  return domain.replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '').replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Mirrors the name-from-email guess used on the HubSpot Contacts page:
// split the local part on '.' / '_' / '-' and title-case the first + last token.
// Returns { firstname, lastname } with either/both possibly empty.
function guessNameFromEmail(email) {
  if (!email) return { firstname: '', lastname: '' };
  const at = email.lastIndexOf('@');
  if (at < 0) return { firstname: '', lastname: '' };
  const local = email.slice(0, at).toLowerCase();
  const parts = local.split(/[._-]/).filter(Boolean).filter(p => !/^\d+$/.test(p));
  if (parts.length < 2) return { firstname: '', lastname: '' };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return { firstname: cap(parts[0]), lastname: cap(parts[parts.length - 1]) };
}

// Patterns we check a contact email's local-part against to detect the
// company's naming convention. The winner (most common across the
// rows matched to a given prospect) becomes the "<pattern>@<domain>"
// Email Domain suggestion.
const EMAIL_PATTERN_RULES = [
  { key: 'firstname.lastname',    build: (f, l) => (f && l ? `${f}.${l}` : null) },
  { key: 'firstname_lastname',    build: (f, l) => (f && l ? `${f}_${l}` : null) },
  { key: 'firstname-lastname',    build: (f, l) => (f && l ? `${f}-${l}` : null) },
  { key: 'firstnamelastname',     build: (f, l) => (f && l ? `${f}${l}` : null) },
  { key: 'lastname.firstname',    build: (f, l) => (f && l ? `${l}.${f}` : null) },
  { key: 'lastnamefirstname',     build: (f, l) => (f && l ? `${l}${f}` : null) },
  { key: 'firstinitial.lastname', build: (f, l) => (f && l ? `${f[0]}.${l}` : null) },
  { key: 'firstinitiallastname',  build: (f, l) => (f && l ? `${f[0]}${l}` : null) },
  { key: 'firstname.lastinitial', build: (f, l) => (f && l ? `${f}.${l[0]}` : null) },
  { key: 'firstnamelastinitial',  build: (f, l) => (f && l ? `${f}${l[0]}` : null) },
  { key: 'firstname',             build: (f)    => (f ? f : null) },
  { key: 'lastname',              build: (_, l) => (l ? l : null) },
];

function detectLocalPattern(email, firstname, lastname) {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at).toLowerCase().replace(/\+.*/, '');
  const f = String(firstname || '').toLowerCase().replace(/[^a-z]/g, '');
  const l = String(lastname || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const rule of EMAIL_PATTERN_RULES) {
    const expected = rule.build(f, l);
    if (expected && local === expected) return rule.key;
  }
  return null;
}

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

function pickDominantKey(map) {
  let bestKey = null;
  let bestCount = 0;
  for (const [k, c] of map) if (c > bestCount) { bestKey = k; bestCount = c; }
  return bestKey;
}

export function AgendaView({ prospects = [], onUpdateProspect }) {
  const { user } = useAuth();
  const [rows, setRows] = useState(() => loadCache());
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [results, setResults] = useState({}); // email -> 'added' | 'exists' | 'error: msg'
  const [tvMissingOnly, setTvMissingOnly] = useState(false);
  const [activeTab, setActiveTab] = useState('contacts'); // 'contacts' | 'tableview'

  // Reload HubSpot cache whenever results change (so newly-added contacts move to the "exists" state).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hubspotByEmail = useMemo(() => loadHubSpotByEmail(), [results]);

  // Build domain → prospect (and prospect → all known domains) maps so we can both
  // suggest a company and surface the full domain list tied to that prospect.
  // Also build a token → prospect map from company-name words (e.g. "URW" from
  // "Unibail-Rodamco-Westfield (URW)") so we can fuzzy-match when the domain
  // itself isn't registered on the prospect.
  const { domainToProspect, prospectDomains, tokenToProspect } = useMemo(() => {
    const dToP = new Map();
    const pDoms = new Map();
    const tToP = new Map();
    function recordDomain(p, domain) {
      if (!domain || !p.company) return;
      dToP.set(domain, p);
      const key = p.company.toLowerCase();
      if (!pDoms.has(key)) pDoms.set(key, new Set());
      pDoms.get(key).add(domain);
    }
    for (const p of prospects) {
      if (p.emailDomain) {
        p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean).forEach(entry => {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase();
          recordDomain(p, d);
        });
      }
      if (p.website) {
        const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
        recordDomain(p, d);
      }
      // Tokens from company name — 3+ chars, lowercased, deduped. Skip generic suffixes.
      const GENERIC = new Set(['inc', 'llc', 'ltd', 'corp', 'group', 'holdings', 'plc', 'the', 'and', 'company', 'co']);
      if (p.company) {
        const tokens = new Set(
          p.company.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC.has(t))
        );
        for (const t of tokens) {
          if (!tToP.has(t)) tToP.set(t, p); // first-wins; prospects loaded earlier take priority
        }
      }
    }
    return { domainToProspect: dToP, prospectDomains: pDoms, tokenToProspect: tToP };
  }, [prospects]);

  // Look up match details for a single row based on the current prospects snapshot.
  // Used both during initial enrichment AND at render time so the columns refresh
  // after the prospect's emailDomain is auto-patched.
  const lookupMatch = useCallback((email) => {
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : '';
    let matched = domain ? domainToProspect.get(domain) : null;
    const wasExactMatch = !!matched;
    if (!matched && domain) {
      const token = extractBrandToken(domain);
      if (token && token.length >= 3) matched = tokenToProspect.get(token) || null;
    }
    const suggestedCompany = matched?.company || (domain ? guessDomainCompany(email) : '');
    const domainSet = matched ? prospectDomains.get(matched.company.toLowerCase()) : null;
    const companyDomains = domainSet ? Array.from(domainSet).sort() : (domain ? [domain] : []);
    return { domain, matched, wasExactMatch, suggestedCompany, companyDomains };
  }, [domainToProspect, prospectDomains, tokenToProspect]);

  const enrichRow = useCallback((r) => {
    const { domain, matched, wasExactMatch } = lookupMatch(r.email);
    // Only guess name parts if the parsed row didn't already carry them from "Name <email>" drops.
    const nameGuess = (!r.firstname && !r.lastname) ? guessNameFromEmail(r.email) : { firstname: '', lastname: '' };
    // Initial Company value: match HubSpot's current value when the contact already exists
    // (even if blank — so user sees the real state). For brand-new contacts, leave blank so the
    // Suggested Company chip is an explicit opt-in rather than an auto-fill.
    const hubspotCache = loadHubSpotByEmail();
    const existing = hubspotCache.get(r.email);
    const initialCompany = r.company !== undefined && r.company !== null && r.company !== ''
      ? r.company
      : (existing ? (existing.company || '') : '');
    return {
      ...r,
      firstname: fixAllCapsName(r.firstname || nameGuess.firstname),
      lastname: fixAllCapsName(r.lastname || nameGuess.lastname),
      company: initialCompany,
      _matchedProspectId: matched?.id || null,
      _matchedDomain: domain,
      _domainAlreadyKnown: wasExactMatch,
      // Preserve the Table View backfill fields parsed off an Excel
      // upload so the "Fill missing Table View data" panel can offer
      // them below.
      _upload_website: r._upload_website || '',
      _upload_zoomCompanyId: r._upload_zoomCompanyId || '',
      _upload_zoomCompanyName: r._upload_zoomCompanyName || '',
      _upload_emailDomain: r._upload_emailDomain || '',
    };
  }, [lookupMatch]);

  // Track which (prospectId, domain) pairs we've already patched this session so we don't flood Firestore.
  const patchedPairsRef = useRef(new Set());

  const patchProspectDomains = useCallback((enrichedRows) => {
    if (!onUpdateProspect) return;
    // One update per prospect — collect all domains to add in a single set.
    const byProspect = new Map(); // id -> { prospect, domainsToAdd: Set<string> }
    for (const r of enrichedRows) {
      if (!r._matchedProspectId || !r._matchedDomain) continue;
      if (r._domainAlreadyKnown) continue; // already in emailDomain/website — nothing to do
      const p = prospects.find(pp => pp.id === r._matchedProspectId);
      if (!p) continue;
      const existing = prospectDomains.get((p.company || '').toLowerCase()) || new Set();
      if (existing.has(r._matchedDomain)) continue;
      const pairKey = `${p.id}|${r._matchedDomain}`;
      if (patchedPairsRef.current.has(pairKey)) continue;
      patchedPairsRef.current.add(pairKey);
      if (!byProspect.has(p.id)) byProspect.set(p.id, { prospect: p, domainsToAdd: new Set() });
      byProspect.get(p.id).domainsToAdd.add(r._matchedDomain);
    }
    for (const { prospect, domainsToAdd } of byProspect.values()) {
      const currentEntries = (prospect.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
      const nextEntries = [...currentEntries, ...Array.from(domainsToAdd)];
      onUpdateProspect(prospect.id, { emailDomain: nextEntries.join('\n') });
    }
  }, [onUpdateProspect, prospects, prospectDomains]);

  const mergeNewRows = useCallback((parsed) => {
    if (parsed.length === 0) return;
    const newlyEnriched = [];
    setRows(prev => {
      const byEmail = new Map(prev.map(r => [r.email, r]));
      for (const p of parsed) {
        if (!byEmail.has(p.email)) {
          const er = enrichRow(p);
          byEmail.set(p.email, er);
          newlyEnriched.push(er);
        }
      }
      const next = Array.from(byEmail.values());
      saveCache(next);
      return next;
    });
    if (newlyEnriched.length > 0) patchProspectDomains(newlyEnriched);
  }, [enrichRow, patchProspectDomains]);

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const dt = e.dataTransfer;
    const collected = [];

    // 1. Try plain text first — covers Outlook web drag, address-book drag, and most pastes.
    const text = dt.getData('text/plain') || dt.getData('text/html') || '';
    if (text) collected.push(...parseEmailHeaders(text));

    // 2. If files were dropped, branch on type: .xlsx / .xls gets parsed
    //    via SheetJS (pulling in Table View backfill fields); anything
    //    else we read as text and regex-extract email addresses.
    const files = Array.from(dt.files || []);
    if (files.length === 0 && collected.length > 0) {
      mergeNewRows(collected);
      return;
    }

    if (files.length === 0) return;

    const xlsxFiles = files.filter(f => /\.xlsx?$/i.test(f.name));
    const otherFiles = files.filter(f => !/\.xlsx?$/i.test(f.name));
    let pending = xlsxFiles.length + otherFiles.length;
    if (pending === 0) {
      if (collected.length > 0) mergeNewRows(collected);
      return;
    }
    xlsxFiles.forEach(async (file) => {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const parsed = parseContactsXlsx(raw);
        collected.push(...parsed);
      } catch (err) {
        console.warn('Failed to parse xlsx', err);
      } finally {
        pending -= 1;
        if (pending === 0) mergeNewRows(collected);
      }
    });
    otherFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const matches = parseDroppedText(raw);
        collected.push(...matches);
        pending -= 1;
        if (pending === 0) mergeNewRows(collected);
      };
      reader.onerror = () => {
        pending -= 1;
        if (pending === 0) mergeNewRows(collected);
      };
      reader.readAsText(file);
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragActive(true);
  }
  function handleDragLeave() { setDragActive(false); }

  function handlePaste(e) {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) {
      e.preventDefault();
      mergeNewRows(parseEmailHeaders(text));
    }
  }

  function updateRow(email, patch) {
    setRows(prev => {
      const next = prev.map(r => r.email === email ? { ...r, ...patch } : r);
      saveCache(next);
      return next;
    });
  }
  function removeRow(email) {
    setRows(prev => {
      const next = prev.filter(r => r.email !== email);
      saveCache(next);
      return next;
    });
    setResults(prev => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
  }
  function clearAll() {
    if (!confirm('Clear all rows?')) return;
    setRows([]);
    setResults({});
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // Build a properties object of fields the user has supplied that are currently blank
  // on the existing HubSpot contact. Used to "fill in missing values" without overwriting
  // data that HubSpot already has.
  function missingFieldUpdates(row, existing) {
    if (!existing) return null;
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    const patch = {};
    if (row.company && !existing.company) patch.company = row.company;
    if (firstname && !existing.firstname) patch.firstname = firstname;
    if (lastname && !existing.lastname) patch.lastname = lastname;
    if (row.phone && !existing.phone) patch.phone = row.phone;
    if (row.jobtitle && !existing.jobtitle) patch.jobtitle = row.jobtitle;
    if (row.dans_tags && row.dans_tags.trim() && !existing.dans_tags && !existing.dan_s_tags) patch.dans_tags = row.dans_tags.trim();
    return Object.keys(patch).length ? patch : null;
  }

  async function addOne(row) {
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    try {
      const properties = {
        email: row.email,
        firstname,
        lastname,
        company: row.company,
        phone: row.phone,
        jobtitle: row.jobtitle,
      };
      if (row.dans_tags && row.dans_tags.trim()) properties.dans_tags = row.dans_tags.trim();
      const res = await fetch('/api/hubspot?action=create-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties }),
      });
      const data = await res.json();
      if (data.success) {
        logAction(user, 'contact_created', {
          contactId: data.contact?.id,
          properties: { email: row.email, firstname, lastname, company: row.company },
          source: 'bulk_contacts',
        });
        try {
          const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
          if (cache?.contacts) {
            cache.contacts.push(data.contact);
            localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
            window.dispatchEvent(new Event('hubspot-cache-updated'));
          }
        } catch { /* ignore */ }
        return 'added';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function updateOne(row, existing, patch) {
    try {
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: existing.id, properties: patch }),
      });
      const data = await res.json();
      if (data.success || data.contact) {
        logAction(user, 'contact_updated', {
          contactId: existing.id,
          properties: patch,
          source: 'bulk_contacts',
        });
        try {
          const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
          if (cache?.contacts) {
            cache.contacts = cache.contacts.map(c => c.id === existing.id ? { ...c, ...patch } : c);
            localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
            window.dispatchEvent(new Event('hubspot-cache-updated'));
          }
        } catch { /* ignore */ }
        return 'updated';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function addAll() {
    // Two parallel queues: create new contacts, and fill in missing fields on existing ones.
    const toCreate = rows.filter(r => !hubspotByEmail.has(r.email) && results[r.email] !== 'added');
    const toUpdate = [];
    for (const r of rows) {
      if (results[r.email] === 'added' || results[r.email] === 'updated') continue;
      const existing = hubspotByEmail.get(r.email);
      if (!existing) continue;
      const patch = missingFieldUpdates(r, existing);
      if (patch) toUpdate.push({ row: r, existing, patch });
    }
    const total = toCreate.length + toUpdate.length;
    if (total === 0) return;
    setBusy(true);
    setProgress({ done: 0, total });
    let done = 0;
    for (const row of toCreate) {
      const outcome = await addOne(row);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    for (const { row, existing, patch } of toUpdate) {
      const outcome = await updateOne(row, existing, patch);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    setBusy(false);
    setProgress(null);
  }

  const newCount = rows.filter(r => !hubspotByEmail.has(r.email)).length;
  const updateCount = rows.filter(r => {
    const existing = hubspotByEmail.get(r.email);
    return !!existing && !!missingFieldUpdates(r, existing);
  }).length;
  const dupCount = rows.length - newCount;
  const addedCount = Object.values(results).filter(v => v === 'added').length;
  const updatedCount = Object.values(results).filter(v => v === 'updated').length;
  const errorCount = Object.values(results).filter(v => typeof v === 'string' && v.startsWith('error')).length;

  // Per-prospect inferences derived from the contact rows matched to
  // that prospect. Looks at each email's domain (ignoring free webmail)
  // to pick the dominant company domain, and compares each email's
  // local-part to the contact's firstname/lastname to pick the dominant
  // naming pattern (firstname.lastname, flastname, etc.). The winners
  // become the Website + Email Domain suggestions for that prospect.
  const inferredSuggestions = useMemo(() => {
    const byProspect = new Map();
    for (const r of rows) {
      if (!r._matchedProspectId) continue;
      if (!byProspect.has(r._matchedProspectId)) {
        byProspect.set(r._matchedProspectId, { domains: new Map(), patterns: new Map() });
      }
      const bucket = byProspect.get(r._matchedProspectId);
      const email = String(r.email || '').toLowerCase();
      const at = email.lastIndexOf('@');
      if (at <= 0) continue;
      const domain = email.slice(at + 1);
      if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
        bucket.domains.set(domain, (bucket.domains.get(domain) || 0) + 1);
      }
      const pattern = detectLocalPattern(email, r.firstname, r.lastname);
      if (pattern) bucket.patterns.set(pattern, (bucket.patterns.get(pattern) || 0) + 1);
    }
    const out = new Map();
    for (const [pid, { domains, patterns }] of byProspect) {
      const dominantDomain = pickDominantKey(domains);
      const dominantPattern = pickDominantKey(patterns);
      out.set(pid, {
        website: dominantDomain || null,
        emailDomain: dominantDomain && dominantPattern
          ? `${dominantPattern}@${dominantDomain}`
          : (dominantDomain || null),
        // zoomCompanyId / zoomCompanyName cannot be inferred from emails — upload only.
      });
    }
    return out;
  }, [rows]);

  // Resolve a suggestion for (prospectId, fieldKey). Upload values (from
  // an .xlsx drop) win over inferred ones. Fields with a single slot
  // (website / zoomCompanyId / zoomCompanyName) skip the suggestion if
  // the prospect already has a value. emailDomain is multi-value, so
  // we only skip when the exact value is already present.
  const suggestionFor = useCallback((prospectId, fieldKey) => {
    if (!prospectId) return null;
    const prospect = prospects.find(p => p.id === prospectId);
    if (!prospect) return null;
    const currentValue = String(prospect[fieldKey] || '').trim();
    if (currentValue && fieldKey !== 'emailDomain') return null;
    const existingDomains = fieldKey === 'emailDomain'
      ? new Set(currentValue.split(/[\n;,]+/).map(s => s.trim().toLowerCase()).filter(Boolean))
      : null;
    const uploadKey = {
      website: '_upload_website',
      zoomCompanyId: '_upload_zoomCompanyId',
      zoomCompanyName: '_upload_zoomCompanyName',
      emailDomain: '_upload_emailDomain',
    }[fieldKey];
    if (uploadKey) {
      for (const r of rows) {
        if (r._matchedProspectId !== prospectId) continue;
        const v = String(r[uploadKey] || '').trim();
        if (!v) continue;
        if (existingDomains && existingDomains.has(v.toLowerCase())) continue;
        return { value: v, origin: 'upload' };
      }
    }
    const inferred = inferredSuggestions.get(prospectId);
    if (inferred && inferred[fieldKey]) {
      const v = inferred[fieldKey];
      if (existingDomains && existingDomains.has(v.toLowerCase())) return null;
      return { value: v, origin: 'inferred' };
    }
    return null;
  }, [rows, prospects, inferredSuggestions]);

  // Set of "prospectId::field" suggestions the user has dismissed —
  // both from the per-row pill × and the summary panel checkboxes.
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set());
  const toggleDismissed = useCallback((key) => {
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Build a row per prospect with a cell per Table View field. Each cell
  // records the existing prospect value, any suggestion we have (upload
  // or inferred), and whether the user dismissed it. The green panel
  // renders this as a grid so all four columns stay visible even when
  // the user dismisses individual suggestions; the bulk-apply patch is
  // derived from the non-dismissed cells.
  const prospectSuggestionRows = useMemo(() => {
    if (!onUpdateProspect) return [];
    const prospectIds = new Set();
    for (const r of rows) if (r._matchedProspectId) prospectIds.add(r._matchedProspectId);
    const fields = ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain'];
    const out = [];
    for (const pid of prospectIds) {
      const prospect = prospects.find(p => p.id === pid);
      if (!prospect) continue;
      const cells = {};
      let hasAnySuggestion = false;
      for (const field of fields) {
        const dismissKey = `${pid}::${field}`;
        const dismissed = dismissedSuggestions.has(dismissKey);
        const sugg = suggestionFor(pid, field);
        const existing = String(prospect[field] || '').trim();
        if (sugg) hasAnySuggestion = true;
        cells[field] = { sugg, existing, dismissed, dismissKey };
      }
      if (hasAnySuggestion) out.push({ prospect, cells });
    }
    out.sort((a, b) => (a.prospect.company || '').localeCompare(b.prospect.company || ''));
    return out;
  }, [rows, prospects, onUpdateProspect, dismissedSuggestions, suggestionFor]);

  // Derive the apply-to-HubSpot patch from the grid, excluding dismissed
  // cells. emailDomain is multi-value, so we append to the existing
  // value rather than overwriting.
  const prospectBackfillUpdates = useMemo(() => {
    const out = [];
    for (const { prospect, cells } of prospectSuggestionRows) {
      const patch = {};
      const sources = {};
      for (const field of ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain']) {
        const cell = cells[field];
        if (!cell || !cell.sugg || cell.dismissed) continue;
        if (field === 'emailDomain') {
          const existing = String(prospect.emailDomain || '')
            .split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
          const existingLower = new Set(existing.map(s => s.toLowerCase()));
          if (existingLower.has(cell.sugg.value.toLowerCase())) continue;
          patch.emailDomain = [...existing, cell.sugg.value].join('\n');
        } else {
          patch[field] = cell.sugg.value;
        }
        sources[field] = cell.sugg;
      }
      if (Object.keys(patch).length > 0) out.push({ prospect, patch, sources });
    }
    return out;
  }, [prospectSuggestionRows]);

  // Cheap per-row lookup of the four Table View fields we surface in
  // the contacts grid. Returns the matched prospect's current value
  // for each field (so we can show "has it" vs "missing"), plus a
  // boolean for the row filter.
  const rowTableViewState = useCallback((r) => {
    if (!r._matchedProspectId) return null;
    const prospect = prospects.find(p => p.id === r._matchedProspectId);
    if (!prospect) return null;
    const has = {
      website: String(prospect.website || '').trim(),
      zoomCompanyId: String(prospect.zoomCompanyId || '').trim(),
      zoomCompanyName: String(prospect.zoomCompanyName || '').trim(),
      emailDomain: String(prospect.emailDomain || '').trim(),
    };
    const missing = {
      website: !has.website,
      zoomCompanyId: !has.zoomCompanyId,
      zoomCompanyName: !has.zoomCompanyName,
      emailDomain: !has.emailDomain,
    };
    const anyMissing = missing.website || missing.zoomCompanyId || missing.zoomCompanyName || missing.emailDomain;
    return { prospect, has, missing, anyMissing };
  }, [prospects]);

  const visibleRows = useMemo(() => {
    if (!tvMissingOnly) return rows;
    return rows.filter(r => {
      const s = rowTableViewState(r);
      return s && s.anyMissing;
    });
  }, [rows, tvMissingOnly, rowTableViewState]);

  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState(null);
  async function applyProspectBackfill() {
    if (!onUpdateProspect || prospectBackfillUpdates.length === 0) return;
    setBackfillBusy(true);
    let done = 0;
    let failed = 0;
    for (const { prospect, patch } of prospectBackfillUpdates) {
      if (Object.keys(patch).length === 0) continue;
      try {
        await onUpdateProspect(prospect.id, patch);
        done++;
      } catch {
        failed++;
      }
    }
    setBackfillBusy(false);
    setBackfillStatus({
      type: failed > 0 ? 'partial' : 'success',
      message: `Updated ${done} prospect${done === 1 ? '' : 's'}${failed > 0 ? ` · ${failed} failed` : ''}.`,
    });
    setTimeout(() => setBackfillStatus(null), 4000);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Bulk Add Contacts</h2>
          <div className={styles.subtitle}>Drop emails from Outlook here — extract addresses, edit details, push to HubSpot in one go.</div>
        </div>
        <div className={styles.headerActions}>
          {rows.length > 0 && <button className={styles.secondaryBtn} onClick={clearAll}>Clear</button>}
        </div>
      </div>

      <div className={styles.body}>
        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
          tabIndex={0}
        >
          <div className={styles.dropIcon}>&#8681;</div>
          <div className={styles.dropTitle}>Drag emails or an Excel file here</div>
          <div className={styles.dropHint}>
            Multi-select messages in Outlook and drag them on — sender + recipient addresses are
            extracted automatically. You can also paste comma- or semicolon-separated lists like{' '}
            <code>Jane Doe &lt;jane@acme.com&gt;; john@acme.com</code>. Drop an <code>.xlsx</code>/<code>.xls</code>{' '}
            file with <code>Email</code>, <code>Company</code>, plus optional <code>Website</code>,{' '}
            <code>Zoom Company ID</code>, <code>Zoom Company Name</code>, and <code>Email Domain</code>{' '}
            columns — we'll offer to backfill any missing values onto the matched Table View rows.
            Even without an Excel file, we'll infer the company domain and naming pattern (e.g.{' '}
            <code>firstname.lastname@acme.com</code>) from the emails themselves and suggest them as
            yellow pills you can dismiss before bulk-applying.
          </div>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Parsed</div>
            <div className={styles.summaryValue}>{rows.length}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>New</div>
            <div className={styles.summaryValue}>{newCount}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Already in HubSpot</div>
            <div className={styles.summaryValue}>{dupCount}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Sent this session</div>
            <div className={styles.summaryValue}>
              {addedCount + updatedCount}
              {updatedCount > 0 && <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748B', marginLeft: '0.35rem' }}>({addedCount} new · {updatedCount} upd)</span>}
              {errorCount > 0 ? <span className={styles.errInline}> · {errorCount} err</span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', margin: '0.75rem 0 0' }}>
          {[
            { key: 'contacts',  label: 'Add Contacts',       count: newCount + updateCount },
            { key: 'tableview', label: 'Update Table View',  count: prospectBackfillUpdates.length },
          ].map(t => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t.label}
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: isActive ? 'var(--color-accent)' : '#E2E8F0',
                  color: isActive ? '#fff' : '#475569',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'tableview' && prospectSuggestionRows.length === 0 && (
          <div className={styles.empty} style={{ marginTop: '0.75rem' }}>
            No Table View backfills available. Drop contacts whose matched prospects are missing a Website / Zoom / Email Domain value.
          </div>
        )}

        {activeTab === 'tableview' && prospectSuggestionRows.length > 0 && (
          <div style={{ margin: '0.75rem 0', border: '1px solid #86EFAC', background: '#F0FDF4', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '0.4rem' }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534' }}>
                  Fill missing Table View data on {prospectSuggestionRows.length} prospect{prospectSuggestionRows.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#14532D' }}>
                  Website / Zoom / Email Domain suggestions from your upload or inferred from the contact emails. Click × on a cell to skip it, or undo to restore. Then click Update Table View to push {prospectBackfillUpdates.length} prospect{prospectBackfillUpdates.length === 1 ? '' : 's'}.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {backfillStatus && (
                  <span style={{ fontSize: '0.7rem', color: backfillStatus.type === 'success' ? '#166534' : '#92400E', fontWeight: 600 }}>
                    {backfillStatus.message}
                  </span>
                )}
                <button
                  type="button"
                  onClick={applyProspectBackfill}
                  disabled={backfillBusy || prospectBackfillUpdates.length === 0}
                  style={{ padding: '0.35rem 0.8rem', border: 'none', borderRadius: 6, background: prospectBackfillUpdates.length === 0 ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: backfillBusy || prospectBackfillUpdates.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {backfillBusy ? 'Updating…' : 'Update Table View'}
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.2fr) repeat(4, minmax(140px, 1fr))', gap: '0.2rem 0.4rem', fontSize: '0.7rem', background: '#fff', border: '1px solid #BBF7D0', borderRadius: 6, padding: '0.4rem 0.5rem' }}>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Company</div>
              {PROSPECT_BACKFILL_FIELDS.map(f => (
                <div key={f.key} style={{ fontWeight: 700, color: '#166534', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{f.label}</div>
              ))}
              {prospectSuggestionRows.map(({ prospect, cells }) => (
                <Fragment key={prospect.id}>
                  <div style={{ color: '#166534', fontWeight: 600, alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prospect.company || ''}>
                    {prospect.company || '—'}
                  </div>
                  {PROSPECT_BACKFILL_FIELDS.map(f => {
                    const cell = cells[f.key];
                    if (!cell || !cell.sugg) {
                      if (cell?.existing && f.key !== 'emailDomain') {
                        return (
                          <div key={f.key} style={{ color: '#64748B', fontSize: '0.68rem', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Already has: ${cell.existing}`}>
                            {cell.existing}
                          </div>
                        );
                      }
                      return <div key={f.key} style={{ color: '#CBD5E1', alignSelf: 'center' }}>—</div>;
                    }
                    const { sugg, dismissed, dismissKey } = cell;
                    const origin = sugg.origin;
                    if (dismissed) {
                      return (
                        <div key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'center', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 999, padding: '1px 8px', color: '#64748B', fontSize: '0.66rem' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }} title={sugg.value}>{String(sugg.value).replace(/\n/g, ' · ')}</span>
                          <button
                            type="button"
                            onClick={() => toggleDismissed(dismissKey)}
                            style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '0.62rem', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                          >undo</button>
                        </div>
                      );
                    }
                    return (
                      <div key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'center', background: '#FEF9C3', border: '1px solid #FACC15', borderRadius: 999, padding: '1px 6px 1px 8px', color: '#854D0E', fontSize: '0.68rem', fontWeight: 600 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={sugg.value}>
                          {String(sugg.value).replace(/\n/g, ' · ')}
                        </span>
                        {origin === 'inferred' && (
                          <span style={{ fontSize: '0.58rem', color: '#A16207', fontWeight: 500, fontStyle: 'italic' }}>auto</span>
                        )}
                        <button
                          type="button"
                          title="Remove this suggestion"
                          onClick={() => toggleDismissed(dismissKey)}
                          style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                        >×</button>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'contacts' && rows.length === 0 ? (
          <div className={styles.empty}>No contacts yet. Drag or paste above to get started.</div>
        ) : activeTab === 'contacts' && (
          <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', margin: '0.75rem 0 0.25rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || (newCount === 0 && updateCount === 0)}
                onClick={addAll}
                title={
                  newCount === 0 && updateCount === 0
                    ? 'Nothing to send'
                    : `Create ${newCount} new and fill missing fields on ${updateCount} existing contact${updateCount === 1 ? '' : 's'}`
                }
              >
                {busy
                  ? `Sending ${progress?.done}/${progress?.total}…`
                  : updateCount > 0 && newCount > 0
                    ? `Send to HubSpot (${newCount} new · ${updateCount} update${updateCount === 1 ? '' : 's'})`
                    : updateCount > 0
                      ? `Update ${updateCount} in HubSpot`
                      : `+ Add ${newCount} to HubSpot`}
              </button>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Showing <strong>{visibleRows.length}</strong> of {rows.length} row{rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTvMissingOnly(v => !v)}
              title="Show only rows whose matched Table View account is missing one or more of Website / Zoom ID / Zoom Name / Email Domain"
              style={{
                padding: '0.3rem 0.7rem',
                border: `1px solid ${tvMissingOnly ? '#F59E0B' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: tvMissingOnly ? '#FEF3C7' : '#fff',
                color: tvMissingOnly ? '#92400E' : 'var(--color-text-secondary)',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              ⚠ {tvMissingOnly ? 'Showing missing Table View data' : 'Missing Table View data only'}
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col style={{ width: '230px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '240px' }} />
                <col style={{ width: '36px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>HubSpot Status</th>
                  <th>First</th>
                  <th>Last</th>
                  <th>Company</th>
                  <th>Suggested Company</th>
                  <th title="Table View — Website">TV Website</th>
                  <th title="Table View — Zoom Company ID">TV Zoom ID</th>
                  <th title="Table View — Zoom Company Name">TV Zoom Name</th>
                  <th title="Table View — Email Domain">TV Email Domain</th>
                  <th>Company Email Domains</th>
                  <th>Dan's Tags</th>
                  <th>Job title</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => {
                  const hubspotContact = hubspotByEmail.get(r.email);
                  const exists = !!hubspotContact;
                  const outcome = results[r.email];
                  let statusLabel = 'New';
                  let statusClass = styles.statusNew;
                  if (exists) { statusLabel = 'In HubSpot'; statusClass = styles.statusDup; }
                  if (outcome === 'added') { statusLabel = 'Added ✓'; statusClass = styles.statusAdded; }
                  else if (outcome === 'updated') { statusLabel = 'Updated ✓'; statusClass = styles.statusAdded; }
                  else if (typeof outcome === 'string' && outcome.startsWith('error')) { statusLabel = outcome.replace(/^error: /, ''); statusClass = styles.statusErr; }
                  // If this existing contact has pending field fill-ins, flag as updatable.
                  if (exists && outcome !== 'updated' && missingFieldUpdates(r, hubspotContact)) {
                    statusLabel = 'Update pending';
                    statusClass = styles.statusUpdatePending;
                  }
                  const live = lookupMatch(r.email);
                  const currentHsCompany = hubspotContact?.company?.trim() || '';
                  const tvState = rowTableViewState(r);
                  const renderTv = (fieldKey) => {
                    if (!tvState) return <span className={styles.metaText}>—</span>;
                    const existing = tvState.has[fieldKey];
                    const pid = r._matchedProspectId;
                    const dismissKey = `${pid}::${fieldKey}`;
                    const isDismissed = pid && dismissedSuggestions.has(dismissKey);
                    const sugg = pid && !isDismissed ? suggestionFor(pid, fieldKey) : null;
                    // emailDomain is multi-value — when the prospect has
                    // entries AND we can suggest a new one, show both.
                    if (existing && fieldKey === 'emailDomain' && sugg) {
                      const display = existing.replace(/\n/g, ', ');
                      return (
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                          <span
                            title={existing}
                            style={{ fontSize: '0.7rem', color: '#334155', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {display}
                          </span>
                          <span
                            title={`${sugg.origin === 'inferred' ? 'Inferred' : 'From upload'}. Click × to remove this suggestion.`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 8px', background: '#FEF9C3', border: '1px solid #FACC15', borderRadius: 999, fontSize: '0.66rem', fontWeight: 600, color: '#854D0E', maxWidth: '100%' }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>+ {sugg.value}</span>
                            {sugg.origin === 'inferred' && (
                              <span style={{ fontSize: '0.58rem', color: '#A16207', fontWeight: 500, fontStyle: 'italic' }}>auto</span>
                            )}
                            <button
                              type="button"
                              title="Remove this suggestion"
                              onClick={() => toggleDismissed(dismissKey)}
                              style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                            >×</button>
                          </span>
                        </span>
                      );
                    }
                    if (existing) {
                      const display = existing.replace(/\n/g, ', ');
                      return (
                        <span
                          title={existing}
                          style={{
                            fontSize: '0.72rem',
                            color: '#334155',
                            display: 'inline-block',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {display}
                        </span>
                      );
                    }
                    if (isDismissed) {
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: '0.66rem', color: '#94A3B8', fontStyle: 'italic' }}>dismissed</span>
                          <button
                            type="button"
                            onClick={() => toggleDismissed(dismissKey)}
                            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.62rem', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                          >undo</button>
                        </span>
                      );
                    }
                    if (sugg) {
                      const tip = sugg.origin === 'inferred'
                        ? `Inferred from contact emails. Click × to remove this suggestion.`
                        : `From the uploaded file. Click × to remove this suggestion.`;
                      return (
                        <span
                          title={`${tip}\nValue: ${sugg.value}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '1px 6px 1px 8px',
                            background: '#FEF9C3',
                            border: '1px solid #FACC15',
                            borderRadius: 999,
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            color: '#854D0E',
                            maxWidth: '100%',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {sugg.value}
                          </span>
                          {sugg.origin === 'inferred' && (
                            <span style={{ fontSize: '0.58rem', color: '#A16207', fontWeight: 500, fontStyle: 'italic' }}>auto</span>
                          )}
                          <button
                            type="button"
                            title="Remove this suggestion"
                            onClick={() => toggleDismissed(dismissKey)}
                            style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                          >×</button>
                        </span>
                      );
                    }
                    return (
                      <span
                        title="Prospect is missing this field and no upload/inferred value"
                        style={{ fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}
                      >
                        missing
                      </span>
                    );
                  };
                  return (
                    <tr key={r.email}>
                      <td className={styles.emailCell}>{r.email}</td>
                      <td><span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span></td>
                      <td><input className={styles.cellInput} value={r.firstname} onChange={e => updateRow(r.email, { firstname: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.lastname} onChange={e => updateRow(r.email, { lastname: e.target.value })} /></td>
                      <td>
                        <input className={styles.cellInput} value={r.company} onChange={e => updateRow(r.email, { company: e.target.value })} />
                        {exists && (
                          currentHsCompany ? (
                            <div className={styles.hsCompanyHint} title="Currently stored in HubSpot">
                              HubSpot: {currentHsCompany}
                            </div>
                          ) : (
                            <div className={styles.hsCompanyMissing} title="HubSpot has no company value for this contact">
                              HubSpot: no company listed
                            </div>
                          )
                        )}
                      </td>
                      <td className={styles.suggestCell}>
                        {live.suggestedCompany ? (
                          <button
                            className={styles.suggestPill}
                            title={r.company === live.suggestedCompany ? 'Already applied' : 'Click to use this as Company'}
                            onClick={() => updateRow(r.email, { company: live.suggestedCompany })}
                          >{live.suggestedCompany}</button>
                        ) : <span className={styles.metaText}>—</span>}
                      </td>
                      <td>{renderTv('website')}</td>
                      <td>{renderTv('zoomCompanyId')}</td>
                      <td>{renderTv('zoomCompanyName')}</td>
                      <td>{renderTv('emailDomain')}</td>
                      <td className={styles.domainsCell} title={live.companyDomains?.join('\n')}>
                        {live.companyDomains && live.companyDomains.length > 0
                          ? live.companyDomains.join(', ')
                          : <span className={styles.metaText}>—</span>}
                      </td>
                      <td><input className={styles.cellInput} value={r.dans_tags || ''} onChange={e => updateRow(r.email, { dans_tags: e.target.value })} placeholder="Tag1, Tag2" /></td>
                      <td><input className={styles.cellInput} value={r.jobtitle} onChange={e => updateRow(r.email, { jobtitle: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.phone} onChange={e => updateRow(r.email, { phone: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.notes || ''} onChange={e => updateRow(r.email, { notes: e.target.value })} placeholder="Free-form note" /></td>
                      <td><button className={styles.rowRemove} onClick={() => removeRow(r.email)} title="Remove row">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
