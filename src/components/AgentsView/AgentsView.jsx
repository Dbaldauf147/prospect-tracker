import { useEffect, useMemo, useRef, useState } from 'react';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';
import { dbPut } from '../../utils/db';
import styles from './AgentsView.module.css';

// Manual BFO Opportunity tags the user picked for an email recipient
// (or meeting contact) that didn't auto-match an Opps-tab row. Keyed
// by lower-cased email (or meeting id when no contact email exists)
// so the next email to the same recipient re-uses the same tag.
const OVERRIDE_STORAGE_KEY = 'agents-bfo-overrides';
const IGNORED_EMAILS_STORAGE_KEY = 'agents-ignored-emails';
const IGNORED_MEETINGS_STORAGE_KEY = 'agents-ignored-meetings';
const AI_PROMPT_STORAGE_KEY = 'agents-ai-prompt';
const NEW_BFO_OPP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-new-bfo-opp';

const DEFAULT_AI_PROMPT = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Choose the New Tast (green button) under the Activity menu on the righthand side of the screen.
3.  In the Subject box type in email or call based on the second column of data (under Type) in this prompt.
4.  In the Due Date box enter todays date in the MM/DD/YYYY format.
5.  In the the Status box select completed.  IMPORTANT - THIS MUST NOT BE LISTED AS NOT STARTED.
6.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7.  Select the blue Save button without asking for my confirmation.
8.  Make sure this update does not save in the Up Comning & Overdue list.  If you see that Today this update shows there, go back in and update this to the Completed Status.
9.  Complete  these steps for the next BFO Address until all have been completed.
10.  Run through the whole list automatically and then report back the success of each one until they're all done.
11.  When that's completed, go further below to take the next steps. `;

const DEFAULT_AI_PROMPT_NEW_BFO_OPP = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Search the top BFO Account Name.  Click on that account name to open up the account page.
3. Click the New Guided Opportunity button.
4. Enter in the Project Name into the Project Name field.  DO NOT include the Project Line name into this field or the Local Project Name field.
5.  Then paste in the Local Project Name into the Local Project Name box and then click Next.  DO NOT include the Product Line in this box.
6. Select Sustainability on the menu list.
7. Click the + sign next to the relevant Product Line assocaited with this BFO Opportuntiy and enter in 80000 and then click Next.
8 . Answer this question as no "*1. Does the opportunity scope ONLY include Carbon Credit?
9. Next make the close date 150 days from today and then click Next.
10.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
11. On the next page click Create.  When you get to this step, dont ask me for permission to Create.  Just click create and continue until this process is done.
12. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(next) {
  try { localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredEmails() {
  try {
    const raw = localStorage.getItem(IGNORED_EMAILS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredEmails(next) {
  try { localStorage.setItem(IGNORED_EMAILS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredMeetings() {
  try {
    const raw = localStorage.getItem(IGNORED_MEETINGS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredMeetings(next) {
  try { localStorage.setItem(IGNORED_MEETINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readAiPrompt() {
  try {
    const raw = localStorage.getItem(AI_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT : raw;
  } catch {
    return DEFAULT_AI_PROMPT;
  }
}

function writeAiPrompt(next) {
  try { localStorage.setItem(AI_PROMPT_STORAGE_KEY, next); } catch {}
}

function readNewBfoOppPrompt() {
  try {
    const raw = localStorage.getItem(NEW_BFO_OPP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_NEW_BFO_OPP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_NEW_BFO_OPP;
  }
}

function writeNewBfoOppPrompt(next) {
  try { localStorage.setItem(NEW_BFO_OPP_PROMPT_STORAGE_KEY, next); } catch {}
}

// Same client-keyword test PipelineView + YOY's Annual Sales use on the
// Opps Lead Source — keeps "is this a current customer?" consistent
// across views.
const CURRENT_CUSTOMER_LEAD_SOURCE_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

// Same Google Sheet + IndexedDB store the Opps tab pulls from. Mirrored
// here so the Refresh button on this view can re-pull Opps without
// requiring a trip to the Opps tab.
const OPPS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/export?format=csv&gid=0';
const OPPS_DB_STORE = 'opps-cache';

// Same CSV parser OppsView uses — handles quoted fields, escaped quotes,
// and CRLF / LF line endings.
function parseOppsCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// "Did I send this?" is keyed off the work email on HubSpot, not the
// Google auth address — the user signs in as baldaufdan@gmail.com but
// HubSpot threads always carry the @se.com from-address.
const SENDER_EMAIL = 'daniel.baldauf@se.com';

// Extract every email-shaped token from an Opps "Contact" cell, which
// can hold a single email, a name + email pair, or a comma/semicolon
// list of either.
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g;

function readActivityCache() {
  try {
    const raw = localStorage.getItem(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The Opps sheet keeps the Salesforce / Lightning URL in the
// "BFO Address" column. Fall back to scanning every field if that one
// happens to be empty so older rows still surface a link when possible.
function detectBfoUrl(rawOpp) {
  if (!rawOpp) return '';
  const direct = String(rawOpp['BFO Address'] || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const v of Object.values(rawOpp)) {
    if (typeof v !== 'string' || !v) continue;
    const m = v.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return '';
}

// Phone-touch detection for the Next Steps column — matches "call",
// "called", "calls", "calling", any "voicemail", and "left a vm" / "left
// vm". Shared by detectNextStepsType (email-table Type cell) and the
// Called-today section so both use identical wording rules.
const CALLED_NEXT_STEPS_RE = /\b(call(ed|s|ing)?|voicemail|left\s+(?:a\s+)?vm)\b/i;

// "called" if the Next Steps text mentions a phone touch, otherwise
// the row reflects the email cadence and we tag it as "email".
function detectNextStepsType(rawOpp) {
  const text = String(rawOpp?.['Next Steps'] || '');
  if (CALLED_NEXT_STEPS_RE.test(text)) return 'called';
  return 'email';
}

// Normalize an arbitrary date string into YYYY-MM-DD. Mirrors the
// helper OppsView2 uses so a date parsed there parses the same way
// here. Returns '' if the value isn't a date.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Business days between the Opps "Last Client Heard From Us" date and
// today — same formula OppsView2 uses for its computed "Last Spoke"
// column. Returns null when the field is empty or unparseable.
function lastSpokeBusinessDays(rawOpp) {
  const iso = toISODate(rawOpp?.['Last Client Heard From Us']);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Calendar days from today to the Opps "Follow Up" date — same formula
// OppsView2 uses for its computed "Call In" column. Returns null when
// the field is empty or doesn't carry a full year+month+day date. We
// validate the shape ourselves (rather than relying on Date.parse) so
// loose values like a bare "2026", "May 2026", "TBD", or an Excel
// serial number don't masquerade as valid Follow Up dates.
function callInDays(rawOpp) {
  const raw = String(rawOpp?.['Follow Up'] ?? '').trim();
  if (!raw) return null;
  const looksLikeFullDate =
    /^\d{4}-\d{1,2}-\d{1,2}\b/.test(raw)              // 2026-05-20
    || /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(raw)        // 5/20/2026
    || /^\d{1,2}-\d{1,2}-\d{2,4}\b/.test(raw)          // 5-20-2026
    || /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}\b/.test(raw) // May 20, 2026
    || /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\b/.test(raw);  // 20 May 2026
  if (!looksLikeFullDate) return null;
  const iso = toISODate(raw);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  // Sanity range so a misparsed value (e.g. Date.parse treating "45000"
  // as year 45000) can't produce a "valid" Call In far in the future.
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function todayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

function externalRecipientList(toRaw) {
  return splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
}

// Normalize a company name for fuzzy matching against BFO Account
// Name. Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes,
// strip punctuation, collapse whitespace. Same shape ActivityView and
// MyAccountsView use so a name that matches there matches here too.
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Best-effort company guess from a recipient's email domain — used
// only when neither an Opps-tab row nor a HubSpot contact carries a
// company so the Company column doesn't render empty.
function domainCompanyGuess(addr) {
  if (!addr) return '';
  const at = String(addr).lastIndexOf('@');
  if (at < 0) return '';
  return String(addr).slice(at + 1)
    .replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

function OppPicker({ oppsCache, onSelect }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrapRef = useRef(null);

  // Close on outside click. The picker mounts only when the cell is
  // empty so there's typically one per row at most.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const matches = useMemo(() => {
    if (!oppsCache?.records?.length) return [];
    return searchOpps(oppsCache, term).slice(0, 12);
  }, [oppsCache, term]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pickerTrigger}
        onClick={() => setOpen(true)}
        disabled={!oppsCache?.records?.length}
        title={oppsCache?.records?.length ? 'Search Opps tab for a matching opportunity' : 'Load the Opps tab to search'}
      >
        + Pick opportunity
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={styles.pickerWrap}>
      <input
        autoFocus
        className={styles.pickerInput}
        placeholder="Search opps by account, BFO link, or contact…"
        value={term}
        onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTerm(''); } }}
      />
      <div className={styles.pickerMenu}>
        {matches.length === 0 ? (
          <div className={styles.pickerEmpty}>No matching opps. Try a different search term.</div>
        ) : matches.map((opp, i) => {
          const bfoOpp = opp['BFO Link'] || '(no opportunity name)';
          const account = opp['Account'] || '';
          return (
            <button
              key={i}
              type="button"
              className={styles.pickerOption}
              onClick={() => { onSelect(opp); setOpen(false); setTerm(''); }}
            >
              {bfoOpp}
              {account && <span className={styles.pickerOptionAccount}>{account}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgentsView() {
  const [cache, setCache] = useState(() => readActivityCache());
  const [hubspotCache, setHubspotCache] = useState(null);
  const [oppsCache, setOppsCache] = useState(null);
  const [overrides, setOverrides] = useState(readOverrides);
  const [ignoredEmails, setIgnoredEmails] = useState(readIgnoredEmails);
  const [ignoredMeetings, setIgnoredMeetings] = useState(readIgnoredMeetings);
  const [aiPrompt, setAiPrompt] = useState(readAiPrompt);
  const [newBfoOppPrompt, setNewBfoOppPrompt] = useState(readNewBfoOppPrompt);
  const [copyFlash, setCopyFlash] = useState('');
  const [newBfoOppCopyFlash, setNewBfoOppCopyFlash] = useState('');
  // HubSpot Activity refresh — kicked off by the header button. Mirrors
  // the fetchActivity flow on ActivityView so both tabs share the same
  // hubspot-activity-cache localStorage entry.
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [activityRefreshError, setActivityRefreshError] = useState(null);
  const [activityRefreshProgress, setActivityRefreshProgress] = useState(null);

  const ignoredEmailIds = useMemo(() => new Set(ignoredEmails), [ignoredEmails]);
  const ignoredMeetingIds = useMemo(() => new Set(ignoredMeetings), [ignoredMeetings]);

  const updateAiPrompt = (next) => {
    setAiPrompt(next);
    writeAiPrompt(next);
  };
  const resetAiPrompt = () => updateAiPrompt(DEFAULT_AI_PROMPT);

  const updateNewBfoOppPrompt = (next) => {
    setNewBfoOppPrompt(next);
    writeNewBfoOppPrompt(next);
  };
  const resetNewBfoOppPrompt = () => updateNewBfoOppPrompt(DEFAULT_AI_PROMPT_NEW_BFO_OPP);

  const ignoreEmail = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredEmails(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredEmails(next);
      return next;
    });
  };

  const ignoreMeeting = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredMeetings(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredMeetings(next);
      return next;
    });
  };

  const setOverride = (key, opp) => {
    if (!key || !opp) return;
    setOverrides(prev => {
      const next = {
        ...prev,
        [key]: {
          bfoOpp: String(opp['BFO Link'] || '').trim(),
          account: String(opp['Account'] || '').trim(),
        },
      };
      writeOverrides(next);
      return next;
    });
  };

  const clearOverride = (key) => {
    if (!key) return;
    setOverrides(prev => {
      const next = { ...prev };
      delete next[key];
      writeOverrides(next);
      return next;
    });
  };

  // Pick up new HubSpot activity pulls from the Activity tab.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Pull the latest HubSpot activity (emails, calls, meetings) AND
  // re-fetch the Opps Google Sheet so the BFO tagging and the Called
  // section both reflect the latest data. The HubSpot pull writes to
  // the shared localStorage cache that ActivityView reads from; the
  // Opps pull writes to the same IndexedDB key OppsView uses. Each
  // half runs independently so a failure on one doesn't block the
  // other.
  async function refreshActivityCache() {
    if (activityRefreshing) return;
    setActivityRefreshing(true);
    setActivityRefreshError(null);
    setActivityRefreshProgress({ email: 0, call: 0, meeting: 0, opps: 0 });
    async function fetchAllPages(type) {
      const all = [];
      let after = '';
      while (true) {
        const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${after}` : ''}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        all.push(...(json.results || []));
        setActivityRefreshProgress(prev => ({ ...prev, [type]: all.length }));
        if (json.nextAfter) after = json.nextAfter;
        else break;
        if (all.length > 5000) break;
      }
      return all;
    }
    async function fetchOpps() {
      const res = await fetch(OPPS_SHEET_URL);
      if (!res.ok) throw new Error(`Opps HTTP ${res.status}`);
      const csvText = await res.text();
      const rows = parseOppsCsv(csvText);
      if (rows.length < 2) throw new Error('Opps sheet returned no data');
      const headers = rows[0].map(h => h.trim());
      const records = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const record = { _id: i };
        let hasData = false;
        for (let j = 0; j < headers.length; j++) {
          const h = headers[j];
          if (!h) continue;
          const val = (row[j] || '').trim();
          if (record[h] !== undefined && record[h] !== '' && record[h] !== '-' && record[h] !== '#N/A') continue;
          record[h] = val;
          if (val && val !== '-' && val !== '#N/A') hasData = true;
        }
        if (hasData && record['Account']) records.push(record);
      }
      const result = { headers, records, fetchedAt: new Date().toISOString() };
      setActivityRefreshProgress(prev => ({ ...prev, opps: records.length }));
      await dbPut(OPPS_DB_STORE, result, 'data');
      setOppsCache(result);
      return result;
    }

    const activityPromise = (async () => {
      const emails = await fetchAllPages('email');
      const calls = await fetchAllPages('call');
      const meetings = await fetchAllPages('meeting');
      const result = { emails, calls, meetings, fetchedAt: new Date().toISOString() };
      try {
        localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
      } catch (err) {
        console.warn('Agents activity cache write skipped (quota):', err?.message || err);
      }
      setCache(result);
    })();
    const oppsPromise = fetchOpps();

    const [activityRes, oppsRes] = await Promise.allSettled([activityPromise, oppsPromise]);
    const errors = [];
    if (activityRes.status === 'rejected') {
      console.error('Agents activity refresh error:', activityRes.reason);
      errors.push(`Activity: ${activityRes.reason?.message || 'fetch failed'}`);
    }
    if (oppsRes.status === 'rejected') {
      console.error('Agents opps refresh error:', oppsRes.reason);
      errors.push(`Opps: ${oppsRes.reason?.message || 'fetch failed'}`);
    }
    if (errors.length > 0) setActivityRefreshError(errors.join(' · '));
    setActivityRefreshing(false);
    setActivityRefreshProgress(null);
  }

  // HubSpot contacts cache — email → company lookup for tagging.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Opps cache (IndexedDB) — drives the BFO Opportunity Name tagging.
  // Each opp record carries Contact (recipient email[s]), Account
  // (company), and BFO Link (= BFO Opportunity Name). Refresh on
  // window focus so a fresh paste over on the Opps tab shows up here
  // without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache()
        .then(o => { if (!cancelled) setOppsCache(o); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // email → company map from the HubSpot contacts cache.
  const companyByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  // Pre-index the Opps cache for two lookup modes:
  //   1. email → opp  (Contact field carries email tokens)
  //   2. company → opp (Account field, fuzzy-matched)
  // The same opp can answer for either path. BFO Link is the BFO
  // Opportunity Name (the column was renamed visibly elsewhere but the
  // data key stayed "BFO Link").
  const oppIndex = useMemo(() => {
    const records = oppsCache?.records || [];
    const byEmail = new Map(); // lower-case email → opp
    const byBfoOpp = new Map(); // lower-case opp name → opp
    const allOpps = [];
    for (const r of records) {
      const bfoOpp = String(r['BFO Link'] || '').trim();
      const account = String(r['Account'] || '').trim();
      // Skip opps that don't carry the data we need to surface.
      if (!bfoOpp && !account) continue;
      const entry = { raw: r, account, bfoOpp };
      allOpps.push(entry);
      if (bfoOpp) {
        const key = bfoOpp.toLowerCase();
        if (!byBfoOpp.has(key)) byBfoOpp.set(key, entry);
      }
      const contactRaw = String(r['Contact'] || '').toLowerCase();
      if (!contactRaw) continue;
      const emails = contactRaw.match(EMAIL_RE) || [];
      for (const e of emails) {
        if (!byEmail.has(e)) byEmail.set(e, entry);
      }
    }
    return { byEmail, byBfoOpp, allOpps };
  }, [oppsCache]);

  // Primary path: which Opps-tab row covers this email recipient?
  // Falls back to a fuzzy Account match on the HubSpot company so an
  // unknown-contact email still finds its opp when the company has
  // any open opportunity on the Opps tab.
  const findOppForRecipient = (recipientEmail, hubspotCompany) => {
    if (recipientEmail) {
      const direct = oppIndex.byEmail.get(recipientEmail);
      if (direct) return direct;
    }
    if (hubspotCompany) {
      for (const opp of oppIndex.allOpps) {
        if (companiesMatch(opp.account, hubspotCompany)) return opp;
      }
    }
    return null;
  };

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = todayBounds();
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    const sentByMe = (e) => {
      const from = String(e.hs_email_from_email || '').toLowerCase().trim();
      return from === SENDER_EMAIL;
    };
    const outbound = (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inToday(e.hs_timestamp))
      .filter(sentByMe)
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .filter(e => !ignoredEmailIds.has(String(e.id || e.hs_object_id)))
      .map(e => {
        const recipients = externalRecipientList(e.hs_email_to_email);
        // Pick the HubSpot-company off the first recipient we have a
        // contact record for. Used both as a fallback Company when no
        // Opp matches and as the secondary-match key for the Opps-tab
        // lookup.
        let hubspotCompany = '';
        for (const addr of recipients) {
          const c = companyByEmail.get(addr);
          if (c) { hubspotCompany = c; break; }
        }
        // Walk the external recipients and take the first one that
        // resolves to an Opp on the Opps tab (by Contact email or by
        // Account-name fuzzy match against the HubSpot company).
        let matchedOpp = null;
        for (const addr of recipients) {
          matchedOpp = findOppForRecipient(addr, companyByEmail.get(addr) || hubspotCompany);
          if (matchedOpp) break;
        }
        // Override key — keyed by the first external recipient so a
        // future email to the same person reuses the manual tag.
        const overrideKey = recipients[0] || '';
        const override = overrideKey ? overrides[overrideKey] : null;
        // Manual override wins over the auto-match. Auto-match wins
        // when there's no override.
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || hubspotCompany || domainCompanyGuess(recipients[0]);
        // Look up the full opp record by name so manual overrides
        // pick up the same URL / Next Steps fields the auto-match has.
        const oppForRow = bfoOpp ? oppIndex.byBfoOpp.get(bfoOpp.toLowerCase()) : matchedOpp;
        const bfoUrl = detectBfoUrl(oppForRow?.raw);
        const nextStepsType = detectNextStepsType(oppForRow?.raw);
        return {
          id: e.id || e.hs_object_id,
          ts: e.hs_timestamp,
          subject: e.hs_email_subject || '(no subject)',
          to: recipients.join(', '),
          rawTo: e.hs_email_to_email || '',
          status: e.hs_email_status || '',
          company,
          bfoOpp,
          bfoUrl,
          nextStepsType,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .filter(m => !ignoredMeetingIds.has(String(m.id || m.hs_object_id)))
      .map(m => {
        // Resolve associated HubSpot contacts up front. We walk each
        // one looking for an Opps-tab match (by email → Contact, then
        // by company → Account) instead of taking the first contact
        // and stopping — meetings frequently include internal SE
        // attendees first, which would block a match if we short-
        // circuited on the first email / company we saw.
        const ids = m._contactIds || [];
        const contacts = ids
          .map(id => (hubspotCache?.contacts || []).find(c => c.id === id))
          .filter(Boolean);

        // Strongest match keys: an external recipient email and the
        // first non-empty company. Used as the override key + as the
        // last-chance fuzzy match.
        let primaryEmail = '';
        let primaryCompany = '';
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && !e.endsWith('@se.com') && !primaryEmail) primaryEmail = e;
          if (ct.company && !primaryCompany) primaryCompany = ct.company;
        }

        // Walk every external contact + their company against the
        // Opps tab. First opp that resolves wins.
        let matchedOpp = null;
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && e.endsWith('@se.com')) continue;
          matchedOpp = findOppForRecipient(e, ct.company || '');
          if (matchedOpp) break;
        }
        // Final fuzzy fallback: the meeting title or location often
        // carries the customer's company name. Match that against
        // every opp's Account field.
        if (!matchedOpp) {
          const haystack = `${m.hs_meeting_title || ''} ${m.hs_meeting_location || ''}`.trim();
          if (haystack) matchedOpp = findOppForRecipient('', haystack);
        }

        // Meetings rarely have a stable contact email — fall back to
        // the meeting id so the override survives. Same shape as the
        // email rows so the picker code stays one path.
        const meetingId = m.id || m.hs_object_id || '';
        const overrideKey = primaryEmail || (meetingId ? `meeting:${meetingId}` : '');
        const override = overrideKey ? overrides[overrideKey] : null;
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || primaryCompany;
        return {
          id: meetingId,
          ts: m.hs_meeting_start_time || m.hs_timestamp,
          endTs: m.hs_meeting_end_time,
          title: m.hs_meeting_title || 'Meeting',
          outcome: m.hs_meeting_outcome || '',
          location: m.hs_meeting_location || '',
          company,
          bfoOpp,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
    // findOppForRecipient / companyByEmail are derived from the same
    // dependency set as cache + hubspotCache + oppIndex + overrides,
    // so they don't need their own entries here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, hubspotCache, oppIndex, overrides, ignoredEmailIds, ignoredMeetingIds]);

  // Opps where the user logged a phone touch in Next Steps and the
  // Last Spoke column (business days since Last Client Heard From Us)
  // computes to 0 — i.e. the client touched the conversation today.
  const calledOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const rows = [];
    for (const r of records) {
      const nextSteps = String(r['Next Steps'] || '');
      if (!CALLED_NEXT_STEPS_RE.test(nextSteps)) continue;
      if (lastSpokeBusinessDays(r) !== 0) continue;
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '—',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        nextSteps,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache]);

  // Opps that don't yet exist in BFO and need a fresh Guided Opportunity
  // created. Filter mirrors the user's spec:
  //   • Status NOT in {Not Started, Not Sold}
  //   • BFO Link is literally "-" (the Opps tab's placeholder for "no
  //     link yet")
  //   • Call In (days-to-Follow-Up) is not null — i.e. the row has a
  //     parseable Follow Up date set
  // Output carries Company (Account), Lead Source + a current-customer
  // boolean, and Scope so the appended block reads as the table the
  // user described.
  const newBfoOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const EXCLUDED_STATUSES = new Set(['Not Started', 'Not Sold']);
    const rows = [];
    for (const r of records) {
      const status = String(r.Status || '').trim();
      if (!status || EXCLUDED_STATUSES.has(status)) continue;
      const bfoLink = String(r['BFO Link'] ?? '').trim();
      if (bfoLink !== '-') continue;
      if (callInDays(r) == null) continue;
      const account = String(r.Account || '').trim();
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      const scope = String(r.Scope || '').trim();
      const callIn = callInDays(r);
      const followUp = String(r['Follow Up'] ?? '').trim();
      rows.push({
        id: r._id ?? `${account}|${scope}`,
        company: account || '—',
        leadSource: leadSource || '—',
        currentCustomer: CURRENT_CUSTOMER_LEAD_SOURCE_RE.test(leadSource),
        scope: scope || '—',
        status,
        followUp,
        callIn,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache]);

  const dateLabel = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), []);

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const oppsLoaded = (oppsCache?.records?.length || 0) > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <span className={styles.dateline}>{dateLabel}</span>
        <button
          type="button"
          className={styles.refreshActivityBtn}
          onClick={refreshActivityCache}
          disabled={activityRefreshing}
          title="Re-pull every HubSpot email, call, and meeting AND re-fetch the Opps Google Sheet. Updates the shared activity cache (same as the Activity tab's Refresh) and the Opps cache (same as the Opps tab's Refresh)."
        >
          {activityRefreshing
            ? (activityRefreshProgress
                ? `Refreshing… ${activityRefreshProgress.email || 0} email · ${activityRefreshProgress.call || 0} call · ${activityRefreshProgress.meeting || 0} meeting · ${activityRefreshProgress.opps || 0} opps`
                : 'Refreshing…')
            : 'Refresh Activity & Opps'}
        </button>
      </div>
      {activityRefreshError && (
        <div className={styles.staleBanner}>
          Refresh failed: {activityRefreshError}
        </div>
      )}
      <p className={styles.subnote}>
        Today&rsquo;s outbound emails from <strong>{SENDER_EMAIL}</strong> to non-SE recipients, plus any meetings on today&rsquo;s calendar. BFO Opportunity tagging walks each recipient&rsquo;s email against the Opps tab&rsquo;s Contact field first, then falls back to fuzzy-matching the HubSpot company against the Opps tab&rsquo;s Account field. When neither matches, use the inline picker to search the Opps tab — your selection is remembered for that recipient on future emails. The Company column falls back to HubSpot&rsquo;s contact record when no Opp is matched.
      </p>

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>sent emails today</div>
        {todaysMeetings.length > 0 && (
          <div className={styles.tally}><strong>{todaysMeetings.length}</strong>meeting{todaysMeetings.length === 1 ? '' : 's'} today</div>
        )}
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
        </div>
      )}
      {cache && !oppsLoaded && (
        <div className={styles.staleBanner}>
          No Opps cache loaded yet. Visit the Opps tab to populate the BFO Opportunity column.
        </div>
      )}
      {cache && fetchedLabel && (
        <div className={styles.subnote}>Cache last refreshed {fetchedLabel}.</div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Called <span className={styles.sectionCount}>{calledOpps.length}</span>
        </h2>
        {calledOpps.length === 0 ? (
          <div className={styles.empty}>No Opps with a phone touch logged in Next Steps and Last Spoke = 0.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Company</th>
                <th>BFO Opportunity</th>
                <th style={{ width: 70 }}>BFO Link</th>
                <th style={{ width: 70 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {calledOpps.map(o => (
                <tr key={o.id}>
                  <td className={o.company && o.company !== '—' ? '' : styles.muted}>{o.company || '—'}</td>
                  <td className={o.bfoOpp ? '' : styles.muted} title={o.nextSteps}>
                    {o.bfoOpp || '—'}
                  </td>
                  <td>
                    {o.bfoUrl ? (
                      <a
                        href={o.bfoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.bfoLink}
                      >Open</a>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td>called</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Sent emails <span className={styles.sectionCount}>{todaysOutbound.length}</span>
        </h2>
        {todaysOutbound.length === 0 ? (
          <div className={styles.empty}>No outbound emails to external recipients today.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Time</th>
                <th>Subject</th>
                <th>To (external)</th>
                <th>Company</th>
                <th>BFO Opportunity</th>
                <th style={{ width: 70 }}>BFO Link</th>
                <th style={{ width: 70 }}>Type</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 40 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {todaysOutbound.map(e => (
                <tr key={e.id}>
                  <td>{fmtTime(e.ts)}</td>
                  <td>{e.subject}</td>
                  <td title={e.rawTo}>{e.to || <span className={styles.muted}>—</span>}</td>
                  <td className={e.company ? '' : styles.muted}>{e.company || '—'}</td>
                  <td>
                    {e.bfoOpp ? (
                      <span className={styles.overrideValue}>
                        {e.bfoOpp}
                        {e.isManual && (
                          <button
                            type="button"
                            className={styles.overrideClear}
                            onClick={() => clearOverride(e.overrideKey)}
                            title="Clear this manual tag"
                          >✕</button>
                        )}
                      </span>
                    ) : (
                      <OppPicker
                        oppsCache={oppsCache}
                        onSelect={(opp) => setOverride(e.overrideKey, opp)}
                      />
                    )}
                  </td>
                  <td>
                    {e.bfoUrl ? (
                      <a
                        href={e.bfoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.bfoLink}
                      >Open</a>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td>{e.nextStepsType}</td>
                  <td className={e.status ? '' : styles.muted}>{e.status || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.ignoreBtn}
                      onClick={() => ignoreEmail(e.id)}
                      title="Hide this email from the Sent emails table"
                      aria-label="Ignore email"
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {todaysMeetings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeader}>
            Meetings <span className={styles.sectionCount}>{todaysMeetings.length}</span>
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Time</th>
                <th>Title</th>
                <th>Company</th>
                <th>BFO Opportunity</th>
                <th style={{ width: 160 }}>Outcome</th>
                <th>Location</th>
                <th style={{ width: 40 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {todaysMeetings.map(m => (
                <tr key={m.id}>
                  <td>{fmtTime(m.ts)}{m.endTs ? ` – ${fmtTime(m.endTs)}` : ''}</td>
                  <td>{m.title}</td>
                  <td className={m.company ? '' : styles.muted}>{m.company || '—'}</td>
                  <td>
                    {m.bfoOpp ? (
                      <span className={styles.overrideValue}>
                        {m.bfoOpp}
                        {m.isManual && (
                          <button
                            type="button"
                            className={styles.overrideClear}
                            onClick={() => clearOverride(m.overrideKey)}
                            title="Clear this manual tag"
                          >✕</button>
                        )}
                      </span>
                    ) : (
                      <OppPicker
                        oppsCache={oppsCache}
                        onSelect={(opp) => setOverride(m.overrideKey, opp)}
                      />
                    )}
                  </td>
                  <td className={m.outcome ? '' : styles.muted}>{m.outcome || '—'}</td>
                  <td className={m.location ? '' : styles.muted}>{m.location || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.ignoreBtn}
                      onClick={() => ignoreMeeting(m.id)}
                      title="Hide this meeting from the Meetings table"
                      aria-label="Ignore meeting"
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(() => {
        // Build the BFO Address block from today's outbound emails AND
        // the Called section so the AI prompt covers both touch types
        // in one pass. Dedupe by URL so an opp that appears in both
        // lists only gets one line (the email entry wins, matching the
        // tab's read order).
        const lines = ['BFO Address'];
        const seen = new Set();
        for (const e of todaysOutbound) {
          if (!e.bfoUrl || seen.has(e.bfoUrl)) continue;
          lines.push(`${e.bfoUrl}: Type ${e.nextStepsType}`);
          seen.add(e.bfoUrl);
        }
        for (const o of calledOpps) {
          if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
          lines.push(`${o.bfoUrl}: Type called`);
          seen.add(o.bfoUrl);
        }
        const addressBlock = lines.join('\n');
        const fullPrompt = `${aiPrompt}\n\n${addressBlock}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(fullPrompt);
            setCopyFlash('Copied!');
          } catch {
            setCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Activity)</h2>
            <p className={styles.subnote}>
              Edit the prompt below — today&rsquo;s BFO addresses are appended automatically. Click Copy to grab the full prompt for your AI assistant.
            </p>
            <textarea
              className={styles.aiPromptInput}
              value={aiPrompt}
              onChange={(e) => updateAiPrompt(e.target.value)}
              rows={12}
              spellCheck={false}
            />
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAiPrompt}>Reset to default</button>
              {copyFlash && <span className={styles.copyFlash}>{copyFlash}</span>}
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // New BFO Opp prompt — table of qualifying opps the AI assistant
        // should create in BFO. Rendered as a pipe-delimited block so a
        // plain-text paste keeps column alignment in most editors.
        const header = 'Company | Lead Source | Current Customer | Scope';
        const lines = ['BFO Opportunities to Create', header];
        for (const o of newBfoOpps) {
          lines.push(`${o.company} | ${o.leadSource} | ${o.currentCustomer ? 'Yes' : 'No'} | ${o.scope}`);
        }
        const block = lines.join('\n');
        const fullPrompt = `${newBfoOppPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(fullPrompt);
            setNewBfoOppCopyFlash('Copied!');
          } catch {
            setNewBfoOppCopyFlash('Copy failed');
          }
          window.setTimeout(() => setNewBfoOppCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (New BFO Opp)
              <span className={styles.sectionCount}>{newBfoOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Lists Opps with Status outside Not Started / Not Sold, BFO Link of &ldquo;-&rdquo;, and a Follow Up date set (Call In not blank). Company, Lead Source, Current Customer flag, and Scope are appended automatically.
            </p>
            <textarea
              className={styles.aiPromptInput}
              value={newBfoOppPrompt}
              onChange={(e) => updateNewBfoOppPrompt(e.target.value)}
              rows={12}
              spellCheck={false}
            />
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={resetNewBfoOppPrompt}>Reset to default</button>
              {newBfoOppCopyFlash && <span className={styles.copyFlash}>{newBfoOppCopyFlash}</span>}
            </div>
            {newBfoOpps.length === 0 ? (
              <div className={styles.empty} style={{ marginTop: '0.5rem' }}>
                No Opps currently match (Status ≠ Not Started/Not Sold, BFO Link = &ldquo;-&rdquo;, Call In set).
              </div>
            ) : (
              <table className={styles.table} style={{ marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Lead Source</th>
                    <th style={{ width: 140 }}>Current Customer</th>
                    <th>Scope</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 110 }}>Follow Up</th>
                    <th style={{ width: 80 }} title="Calendar days from today to Follow Up">Call In</th>
                  </tr>
                </thead>
                <tbody>
                  {newBfoOpps.map(o => (
                    <tr key={o.id}>
                      <td className={o.company && o.company !== '—' ? '' : styles.muted}>{o.company || '—'}</td>
                      <td className={o.leadSource && o.leadSource !== '—' ? '' : styles.muted}>{o.leadSource || '—'}</td>
                      <td>
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: o.currentCustomer ? '#DCFCE7' : '#F1F5F9',
                          color: o.currentCustomer ? '#166534' : '#64748B',
                          border: `1px solid ${o.currentCustomer ? '#86EFAC' : '#CBD5E1'}`,
                        }}>{o.currentCustomer ? 'Yes' : 'No'}</span>
                      </td>
                      <td className={o.scope && o.scope !== '—' ? '' : styles.muted}>{o.scope || '—'}</td>
                      <td>{o.status}</td>
                      <td className={o.followUp ? '' : styles.muted}>{o.followUp || '—'}</td>
                      <td className={o.callIn == null ? styles.muted : ''}>{o.callIn == null ? '—' : o.callIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
    </div>
  );
}
