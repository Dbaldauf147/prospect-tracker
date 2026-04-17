import { useMemo, useState, useCallback, useRef } from 'react';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import styles from './AgendaView.module.css';

const STORAGE_KEY = 'bulk-contacts-cache';

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

export function AgendaView({ prospects = [], onUpdateProspect }) {
  const { user } = useAuth();
  const [rows, setRows] = useState(() => loadCache());
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [results, setResults] = useState({}); // email -> 'added' | 'exists' | 'error: msg'

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

  const enrichRow = useCallback((r) => {
    const at = r.email.lastIndexOf('@');
    const domain = at >= 0 ? r.email.slice(at + 1).toLowerCase() : '';
    // 1. Exact domain match on a prospect's emailDomain/website.
    let matched = domain ? domainToProspect.get(domain) : null;
    const wasExactMatch = !!matched;
    // 2. Fallback: match the domain's brand token against any word in a prospect's company name.
    if (!matched && domain) {
      const token = extractBrandToken(domain);
      if (token && token.length >= 3) matched = tokenToProspect.get(token) || null;
    }
    const suggestedCompany = matched?.company || (domain ? guessDomainCompany(r.email) : '');
    const domainSet = matched ? prospectDomains.get(matched.company.toLowerCase()) : null;
    const companyDomains = domainSet ? Array.from(domainSet).sort() : (domain ? [domain] : []);
    // Only guess name parts if the parsed row didn't already carry them from "Name <email>" drops.
    const nameGuess = (!r.firstname && !r.lastname) ? guessNameFromEmail(r.email) : { firstname: '', lastname: '' };
    return {
      ...r,
      firstname: fixAllCapsName(r.firstname || nameGuess.firstname),
      lastname: fixAllCapsName(r.lastname || nameGuess.lastname),
      company: r.company || suggestedCompany,
      suggestedCompany,
      companyDomains,
      _matchedProspectId: matched?.id || null,
      _matchedDomain: domain,
      _domainAlreadyKnown: wasExactMatch,
    };
  }, [domainToProspect, prospectDomains, tokenToProspect]);

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

    // 2. If files were dropped (e.g. .msg from Outlook desktop), read each and try
    //    to extract any email-looking strings from the text we can decode.
    const files = Array.from(dt.files || []);
    if (files.length === 0 && collected.length > 0) {
      mergeNewRows(collected);
      return;
    }

    if (files.length === 0) return;

    let pending = files.length;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        // Best-effort: extract anything matching an email regex from the binary text.
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

  async function addOne(row) {
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    try {
      const res = await fetch('/api/hubspot?action=create-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: {
            email: row.email,
            firstname,
            lastname,
            company: row.company,
            phone: row.phone,
            jobtitle: row.jobtitle,
          },
        }),
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
          }
        } catch { /* ignore */ }
        return 'added';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function addAll() {
    const queue = rows.filter(r => !hubspotByEmail.has(r.email) && results[r.email] !== 'added');
    if (queue.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: queue.length });
    for (let i = 0; i < queue.length; i++) {
      const row = queue[i];
      const outcome = await addOne(row);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      setProgress({ done: i + 1, total: queue.length });
    }
    setBusy(false);
    setProgress(null);
  }

  const newCount = rows.filter(r => !hubspotByEmail.has(r.email)).length;
  const dupCount = rows.length - newCount;
  const addedCount = Object.values(results).filter(v => v === 'added').length;
  const errorCount = Object.values(results).filter(v => typeof v === 'string' && v.startsWith('error')).length;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Bulk Add Contacts</h2>
          <div className={styles.subtitle}>Drop emails from Outlook here — extract addresses, edit details, push to HubSpot in one go.</div>
        </div>
        <div className={styles.headerActions}>
          {rows.length > 0 && <button className={styles.secondaryBtn} onClick={clearAll}>Clear</button>}
          <button
            className={styles.primaryBtn}
            disabled={busy || newCount === 0}
            onClick={addAll}
            title={newCount === 0 ? 'No new contacts to add' : `Add ${newCount} new contact${newCount === 1 ? '' : 's'} to HubSpot`}
          >
            {busy ? `Adding ${progress?.done}/${progress?.total}…` : `+ Add ${newCount} to HubSpot`}
          </button>
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
          <div className={styles.dropTitle}>Drag emails here from Outlook</div>
          <div className={styles.dropHint}>
            Or paste a list of addresses. Multi-select messages in Outlook and drag them onto this box —
            sender + recipient addresses are extracted automatically. You can also paste comma- or
            semicolon-separated lists like <code>Jane Doe &lt;jane@acme.com&gt;; john@acme.com</code>.
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
            <div className={styles.summaryLabel}>Added this session</div>
            <div className={styles.summaryValue}>{addedCount}{errorCount > 0 ? <span className={styles.errInline}> · {errorCount} err</span> : null}</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className={styles.empty}>No contacts yet. Drag or paste above to get started.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col style={{ width: '230px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '36px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>First</th>
                  <th>Last</th>
                  <th>Company</th>
                  <th>Suggested Company</th>
                  <th>Company Email Domains</th>
                  <th>Job title</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const exists = hubspotByEmail.has(r.email);
                  const outcome = results[r.email];
                  let statusLabel = 'New';
                  let statusClass = styles.statusNew;
                  if (exists) { statusLabel = 'In HubSpot'; statusClass = styles.statusDup; }
                  if (outcome === 'added') { statusLabel = 'Added ✓'; statusClass = styles.statusAdded; }
                  else if (typeof outcome === 'string' && outcome.startsWith('error')) { statusLabel = outcome.replace(/^error: /, ''); statusClass = styles.statusErr; }
                  return (
                    <tr key={r.email}>
                      <td className={styles.emailCell}>{r.email}</td>
                      <td><input className={styles.cellInput} value={r.firstname} onChange={e => updateRow(r.email, { firstname: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.lastname} onChange={e => updateRow(r.email, { lastname: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.company} onChange={e => updateRow(r.email, { company: e.target.value })} /></td>
                      <td className={styles.suggestCell}>
                        {r.suggestedCompany ? (
                          <button
                            className={styles.suggestPill}
                            title={r.company === r.suggestedCompany ? 'Already applied' : 'Click to use this as Company'}
                            onClick={() => updateRow(r.email, { company: r.suggestedCompany })}
                          >{r.suggestedCompany}</button>
                        ) : <span className={styles.metaText}>—</span>}
                      </td>
                      <td className={styles.domainsCell} title={r.companyDomains?.join('\n')}>
                        {r.companyDomains && r.companyDomains.length > 0
                          ? r.companyDomains.join(', ')
                          : <span className={styles.metaText}>—</span>}
                      </td>
                      <td><input className={styles.cellInput} value={r.jobtitle} onChange={e => updateRow(r.email, { jobtitle: e.target.value })} /></td>
                      <td><input className={styles.cellInput} value={r.phone} onChange={e => updateRow(r.email, { phone: e.target.value })} /></td>
                      <td><span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span></td>
                      <td><button className={styles.rowRemove} onClick={() => removeRow(r.email)} title="Remove row">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
