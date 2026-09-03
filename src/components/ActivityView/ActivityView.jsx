import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { DataTable } from '../common/DataTable';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { userLsGet, userLsSet, userLsRemove } from '../../utils/userLs';
import { loadCallRecords, saveCallRecordResult } from '../../utils/callRecordingsStore';
import {
  importGranolaMeetings, recordPatchFor, diagnoseEmptySync, DEFAULT_MEETING_WINDOW_DAYS,
  fetchGranolaCalendar, describeGranolaCalendar, probeGranola, describeGranolaConnection,
} from '../../utils/granolaCalls';
import {
  granolaMeetingsFromRecords, mergeMeetings, meetingsInRange, rangeForDays, rangeForUpcoming,
  groupMeetingsByDay, undatedGranolaRecords, describeGranolaMeetings,
} from '../../utils/granolaMeetings';
import {
  outlookMeetingsFromEvents, granolaCalendarMeetings, describeOutlookCalendar,
} from '../../utils/outlookCalendar';
import { secureGet, secureSet, secureClear } from '../../utils/secureStorage';
import {
  recordWeeklyActivity, loadWeeklyActivityLog, weeklyActivityEntry,
} from '../../utils/weeklyActivityLog';
import { useOppsRecords } from '../KeyContactsView/KeyContactsView';
import styles from './ActivityView.module.css';

const CACHE_KEY = 'hubspot-activity-cache';
// Compact email/phone → {tsMs, ts, type} index derived from the full feed.
// The raw activity feed (up to 5k emails + 5k calls) routinely blows the
// ~5MB localStorage quota, in which case saveCache below silently drops it
// and the All Contacts "Last Outreach" column has nothing to read. This
// index is a few KB — keyed by the handful of distinct addresses/numbers
// rather than every record — so it always persists and reliably drives
// that column.
const OUTREACH_INDEX_KEY = 'hubspot-outreach-index';

// When the Granola calendar import last ran. Only a timestamp — the
// meetings themselves are in Firestore, so this is purely what keeps
// the page from re-importing on every visit.
const GRANOLA_IMPORTED_AT_KEY = 'granola-meetings-imported-at';
const GRANOLA_STALE_MS = 15 * 60 * 1000;

// What the meetings panel covers. The look-back is capped at the Granola
// import window: offering more would show whatever the Call Recordings
// back-fill happened to leave behind, which looks like a gappy calendar
// rather than a longer one.
//
// "Upcoming" is the only forward window, and it only has anything in it
// once Outlook is connected — a notetaker can't know about a meeting
// that hasn't happened, so every other source is a look-back by nature.
const MEETING_RANGE_KEY = 'activity-meeting-range-days';
const UPCOMING_DAYS = 7;
const MEETING_RANGES = [
  { key: 'today', days: 1, forward: false, label: 'Today', title: 'Everything on today’s calendar' },
  { key: 'upcoming', days: UPCOMING_DAYS, forward: true, label: 'Upcoming', title: `Today and the next ${UPCOMING_DAYS} days` },
  { key: 'last7', days: 7, forward: false, label: 'Last 7', title: 'Meetings from the last 7 days' },
  { key: 'last30', days: 30, forward: false, label: 'Last 30', title: 'Meetings from the last 30 days' },
];

// The window fetched from Outlook, once, wide enough for every button
// above — so changing range re-filters what is already here instead of
// going back to Graph.
const GRAPH_START_DAYS = -30;
const GRAPH_END_DAYS = UPCOMING_DAYS;

// Graph access tokens last about an hour. Re-read a little early so a
// fetch doesn't go out with a token that expires mid-flight.
const GRAPH_EXPIRY_SKEW_MS = 60 * 1000;

function normalizeOutreachPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function buildOutreachIndex(data) {
  const emails = {};
  const phones = {};
  const consider = (bucket, key, ts, type) => {
    if (!key || !ts) return;
    const tsMs = new Date(ts).getTime();
    if (!Number.isFinite(tsMs)) return;
    const prev = bucket[key];
    if (!prev || tsMs > prev.tsMs) bucket[key] = { tsMs, ts, type };
  };
  for (const e of (data?.emails || [])) {
    const subj = String(e.hs_email_subject || '').toLowerCase();
    if (subj.includes('(sample email)')) continue;
    for (const field of ['hs_email_to_email', 'hs_email_from_email']) {
      const raw = e[field];
      if (!raw) continue;
      for (const part of String(raw).split(/[;,]/)) {
        const em = part.trim().toLowerCase();
        if (em) consider(emails, em, e.hs_timestamp, 'email');
      }
    }
  }
  for (const c of (data?.calls || [])) {
    for (const field of ['hs_call_to_number', 'hs_call_from_number']) {
      const ph = normalizeOutreachPhone(c[field]);
      if (ph) consider(phones, ph, c.hs_timestamp, 'call');
    }
  }
  return { emails, phones, fetchedAt: data?.fetchedAt };
}

// Stages that mean an opportunity has been closed out (won OR lost) and
// shouldn't count as "active". Same set the contact-gap pages use.
const OPP_CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const OPP_INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// Fuzzy company-name match for the "active opp" lookup on the Today's
// Outbound sub-tab — matches on equality, then on substring + length
// rule, then on a stripped (suffix-removed, alphanumeric-only) form.
function companiesMatchFuzz(a, b) {
  const na = String(a || '').toLowerCase().trim();
  const nb = String(b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = (s) => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  return strip(na) === strip(nb);
}

function loadCache() {
  try { return JSON.parse(userLsGet(CACHE_KEY)); } catch { return null; }
}
function saveCache(data) {
  try {
    userLsSet(CACHE_KEY, JSON.stringify(data));
  } catch (err) { console.warn('ActivityView cache write skipped (quota):', err?.message || err); }
  // Always persist the compact outreach index, even when the full feed
  // above couldn't fit — it's what the All Contacts "Last Outreach" column
  // actually reads.
  try {
    userLsSet(OUTREACH_INDEX_KEY, JSON.stringify(buildOutreachIndex(data)));
  } catch (err) { console.warn('ActivityView outreach-index write skipped:', err?.message || err); }
  // Notify in-tab consumers (e.g. the Last Outreach column on
  // KeyContactsView) since the `storage` event only fires across tabs.
  window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
}

function fmtDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtDuration(ms) {
  if (!ms) return '-';
  const sec = Math.round(parseInt(ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

// Badge per calendar source on the Today panel. A merged row wears one
// of each, which is how the user can tell a meeting Granola actually sat
// in from one that is only on the calendar.
const SOURCE_BADGES = {
  outlook: { label: 'Outlook', color: '#0078D4', background: '#E8F4FD' },
  hubspot: { label: 'HubSpot', color: '#7C3AED', background: '#F3E8FF' },
  granola: { label: 'Granola', color: '#B45309', background: '#FEF3C7' },
};

export function ActivityView({ prospects = [], settings, updateSettings }) {
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState(loadCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [contactPopup, setContactPopup] = useState(null); // { name, email, company, phone }
  const [addingContact, setAddingContact] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [progress, setProgress] = useState(null); // { emails, calls, meetings }
  // Sub-tab on the Activity page. 'all' is the legacy full-history
  // grid; 'todayOutbound' is the new today-only outbound-to-external
  // view that also resolves an active opp per row.
  const [subtab, setSubtab] = useState('all');

  // Per-week totals of the user's sends to contacts outside @se.com,
  // written every time this tab has a feed in hand. The feed itself is
  // too big to keep (saveCache drops it on quota), so counting it here
  // is what leaves the Weekly Report a number to show for this week once
  // next week comes around.
  const [weeklyLog, setWeeklyLog] = useState(loadWeeklyActivityLog);
  useEffect(() => {
    if (!data) return;
    setWeeklyLog(recordWeeklyActivity(data, settings?.workEmail));
  }, [data, settings?.workEmail]);
  const recorded = useMemo(() => {
    const now = Date.now();
    return {
      thisWeek: weeklyActivityEntry(weeklyLog, now),
      lastWeek: weeklyActivityEntry(weeklyLog, now - 7 * 24 * 60 * 60 * 1000),
    };
  }, [weeklyLog]);

  async function fetchAllPages(type) {
    const all = [];
    const seenIds = new Set();
    let after = '';
    while (true) {
      const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Dedup by id: the server rolls into a new hs_timestamp window when it
      // hits HubSpot search's 10k paging ceiling, and the window boundary
      // (LTE) can re-return a few records we've already collected.
      for (const r of (json.results || [])) {
        if (r.id) {
          if (seenIds.has(r.id)) continue;
          seenIds.add(r.id);
        }
        all.push(r);
      }
      setProgress(prev => ({ ...prev, [type]: all.length }));
      if (json.nextAfter) {
        after = json.nextAfter;
      } else {
        break;
      }
      // Runaway guard only — the full activity history is expected to sit
      // well under this. Records come newest-first, so if this ever trips
      // it drops the oldest tail, never recent activity.
      if (all.length > 100000) { console.warn(`Activity ${type} fetch hit 100k safety cap`); break; }
    }
    return all;
  }

  async function fetchActivity() {
    setLoading(true);
    setError(null);
    setProgress({ email: 0, call: 0, meeting: 0 });
    try {
      const emails = await fetchAllPages('email');
      const calls = await fetchAllPages('call');
      const meetings = await fetchAllPages('meeting');
      const result = { emails, calls, meetings, fetchedAt: new Date().toISOString() };
      setData(result);
      saveCache(result);
    } catch (err) {
      console.error('Activity fetch error:', err);
      setError(err.message || 'Failed to fetch activity');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    const STALE_MS = 30 * 60 * 1000; // 30 min stale for full history
    const isStale = !data?.fetchedAt || (Date.now() - new Date(data.fetchedAt).getTime()) > STALE_MS;
    if (isStale) fetchActivity();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const interval = setInterval(fetchActivity, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // Combine and sort all activities by timestamp
  // Build email domain → company map from prospects
  const domainToCompany = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      if (p.emailDomain) {
        const entries = p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
        for (const entry of entries) {
          const atIdx = entry.lastIndexOf('@');
          const domain = atIdx >= 0 ? entry.slice(atIdx + 1).toLowerCase() : entry.toLowerCase();
          if (domain && p.company) map.set(domain, p.company);
        }
      }
      if (p.website) {
        const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
        if (d && p.company) map.set(d, p.company);
      }
    }
    return map;
  }, [prospects]);

  // HubSpot contact cache (IDB-backed). Refreshed on mount and on cache events.
  const [hubspotCache, setHubspotCacheState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCacheState(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const hubspotContacts = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  function guessCompanyFromEmail(email) {
    if (!email) return '';
    const lower = email.toLowerCase();
    if (lower.endsWith('@se.com')) return '';
    // Direct match from HubSpot contacts
    if (hubspotContacts.has(lower)) return hubspotContacts.get(lower);
    // Domain match from prospects
    const atIdx = lower.lastIndexOf('@');
    if (atIdx >= 0) {
      const domain = lower.slice(atIdx + 1);
      if (domainToCompany.has(domain)) return domainToCompany.get(domain);
      // Fallback: clean domain name as company guess
      return domain.replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '').replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return '';
  }

  function guessCompanyFromEmails(...emails) {
    for (const email of emails) {
      if (!email) continue;
      // Handle multiple emails separated by ; or ,
      const parts = email.split(/[;,]/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.toLowerCase().endsWith('@se.com')) continue;
        const company = guessCompanyFromEmail(part);
        if (company) return company;
      }
    }
    return '';
  }

  // Check if an email already exists in HubSpot contacts
  function isInHubSpot(email) {
    if (!email) return false;
    return (hubspotCache?.contacts || []).some(c => c.email && c.email.toLowerCase() === email.toLowerCase());
  }

  function openContactPopup(name, email, company, phone) {
    if (!name && !email) return;
    const parts = (name || '').trim().split(/\s+/);
    setContactPopup({
      firstname: parts[0] || '',
      lastname: parts.slice(1).join(' ') || '',
      email: email || '',
      company: company || '',
      phone: phone || '',
      existsInHubSpot: isInHubSpot(email),
    });
    setAddResult(null);
  }

  async function handleAddToHubSpot() {
    if (!contactPopup?.email) return;
    setAddingContact(true);
    setAddResult(null);
    try {
      const res = await apiFetch('/api/hubspot?action=create-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: {
            email: contactPopup.email,
            firstname: contactPopup.firstname,
            lastname: contactPopup.lastname,
            company: contactPopup.company,
            phone: contactPopup.phone,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAddResult('success');
        logAction(user, 'contact_created', {
          contactId: data.contact?.id,
          properties: { email: contactPopup.email, firstname: contactPopup.firstname, lastname: contactPopup.lastname, company: contactPopup.company },
          source: 'activity_view',
        });
        // Update local cache
        try {
          await updateHubspotCache(draft => { draft.contacts.push({ ...data.contact, _source: 'manual' }); });
        } catch {}
      } else {
        setAddResult(data.error || 'Failed to add contact');
      }
    } catch (err) {
      setAddResult(err.message || 'Failed to add contact');
    }
    setAddingContact(false);
  }

  // Build contact ID → contact map from HubSpot cache
  const contactIdMap = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.id) map.set(c.id, c);
    }
    return map;
  }, [hubspotCache]);

  // ── Meetings from Granola ────────────────────────────────────────────
  // Granola sits in the meetings on the user's calendar and writes a note
  // for each one, which makes the notes it has synced a usable mirror of
  // that calendar. They already live in this app: the Call Recordings
  // page stores every synced note as a `callRecordings` document. This
  // page reads those, and can top them up itself, so the calendar is
  // current without a trip to that tab.
  const uid = user?.uid || '';
  const [granolaRecords, setGranolaRecords] = useState({});
  const [granolaLoaded, setGranolaLoaded] = useState(false);
  const [granolaImporting, setGranolaImporting] = useState(false);
  const [granolaError, setGranolaError] = useState('');
  // Set when Granola has no API key in this deployment. That isn't a
  // failure to report as one — it means the integration was never set
  // up, and the fix lives on the Call Recordings page.
  const [granolaUnconfigured, setGranolaUnconfigured] = useState(false);
  const [granolaSyncedAt, setGranolaSyncedAt] = useState('');
  // What an import that ran THIS SESSION saw. Null on a fresh load, which
  // is the state the panel could not previously describe: no import has
  // reported anything, so silence was all it had.
  const [granolaImportResult, setGranolaImportResult] = useState(null);
  // What Granola answered when asked for the calendar behind its own
  // "Coming up" list: { events, supported, attempts, error }. Null until
  // an import has asked.
  const [granolaCalendar, setGranolaCalendar] = useState(null);
  // Whether Granola is configured at all, asked directly rather than
  // inferred from an import that happened to fail.
  //
  // The panel used to learn this only as a side effect: an import ran,
  // came back "not configured", and set the flag. So on any visit where
  // the import did not run - the usual case, since it only re-runs when
  // the last one is stale - a deployment with no API key looked exactly
  // like a deployment with a key and no meetings. Both rendered "0
  // meetings", and the one thing that would explain it went unsaid.
  //
  // { configured, ok, error, hint, timedOut }, or null before the first
  // answer lands. The Call Recordings page asks the same question the
  // same way.
  const [granolaStatus, setGranolaStatus] = useState(null);
  const [granolaChecking, setGranolaChecking] = useState(false);
  const granolaRecordsRef = useRef({});
  const granolaImportingRef = useRef(false);
  const granolaAutoRan = useRef(false);
  // Discards the answer to a probe that a newer one has already replaced.
  const granolaProbeRun = useRef(0);

  useEffect(() => { granolaRecordsRef.current = granolaRecords; }, [granolaRecords]);

  // Ask whether the key is there and live. Also the handler behind
  // "Check again": a probe that timed out says nothing about Granola
  // either way, so re-running it is the first thing to try.
  const checkGranola = useCallback(async () => {
    const run = granolaProbeRun.current + 1;
    granolaProbeRun.current = run;
    setGranolaChecking(true);
    const status = await probeGranola();
    if (granolaProbeRun.current !== run) return status;
    setGranolaStatus(status);
    // A probe that reached Granola is a better answer than whatever an
    // import concluded earlier, so it owns the flag from here.
    if (!status.timedOut) setGranolaUnconfigured(!status.configured);
    setGranolaChecking(false);
    return status;
  }, []);

  useEffect(() => { checkGranola(); }, [checkGranola]);

  const granolaConnection = useMemo(
    () => describeGranolaConnection(granolaStatus, { checking: granolaChecking }),
    [granolaStatus, granolaChecking],
  );

  // Stored records first. The calendar paints from Firestore, so it
  // fills in on first paint, offline, and when Granola itself is down —
  // importing only ever adds to it.
  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    setGranolaLoaded(false);
    granolaAutoRan.current = false;
    setGranolaSyncedAt(userLsGet(GRANOLA_IMPORTED_AT_KEY) || '');
    loadCallRecords(uid).then((stored) => {
      if (cancelled) return;
      const granola = {};
      for (const [id, record] of Object.entries(stored || {})) {
        if (record?.source === 'granola') granola[id] = record;
      }
      setGranolaRecords(granola);
      setGranolaLoaded(true);
    });
    return () => { cancelled = true; };
  }, [uid]);

  /**
   * Pull the last few weeks of Granola meetings and upsert them onto the
   * records this page reads. Metadata only — no transcripts — so it stays
   * cheap enough to run whenever the page is opened.
   */
  const importMeetings = useCallback(async () => {
    if (!uid || granolaImportingRef.current) return;
    granolaImportingRef.current = true;
    setGranolaImporting(true);
    setGranolaError('');
    const written = {};
    try {
      const result = await importGranolaMeetings({
        days: DEFAULT_MEETING_WINDOW_DAYS,
        onNote: async (note) => {
          const base = granolaRecordsRef.current[note.id] || null;
          // Nothing about this note has changed since it was stored, and
          // it already carries its calendar event. Re-writing it would
          // cost a Firestore write per meeting on every refresh and
          // change nothing.
          const unchanged = base
            && String(base.granolaUpdatedAt || '') === String(note.updatedAt || '')
            && (!note.calendarEvent || base.calendarEvent);
          if (unchanged) return false;
          // A failed save must NOT return false. False means "stored
          // nothing, deliberately", which is the common and correct case
          // just above — reusing it for a write that was refused hid the
          // failure inside a legitimate skip. Throwing puts it in
          // result.errors, which is already reported below.
          const saved = await saveCallRecordResult(uid, note.id, recordPatchFor(note), base);
          if (!saved.ok) throw new Error(saved.error || 'could not be saved');
          written[note.id] = saved.record;
          return true;
        },
      });
      setGranolaUnconfigured(false);
      setGranolaImportResult({ seen: result.seen, stored: result.stored });
      // And the calendar itself. Granola syncs Outlook — that sync is
      // what fills its own "Coming up" list — so if its API will serve
      // the schedule, this is the meeting panel's source and no calendar
      // connection of our own is needed. The answer is stored either
      // way: when it can't, the panel says so instead of leaving an
      // empty list to be read as a clear diary.
      setGranolaCalendar(await fetchGranolaCalendar({
        from: new Date(Date.now() + GRAPH_START_DAYS * 24 * 3600 * 1000).toISOString(),
        to: new Date(Date.now() + GRAPH_END_DAYS * 24 * 3600 * 1000).toISOString(),
      }));
      if (Object.keys(written).length > 0) setGranolaRecords(prev => ({ ...prev, ...written }));
      const stamp = new Date().toISOString();
      setGranolaSyncedAt(stamp);
      try { userLsSet(GRANOLA_IMPORTED_AT_KEY, stamp); } catch { /* quota */ }
      if (result.errors.length > 0) {
        setGranolaError(`Some meetings didn't import: ${result.errors.slice(0, 2).join(' · ')}`);
      } else {
        // An import that read nothing at all is either a quiet month or
        // a reply this build couldn't parse. Only the second is worth
        // reporting, and only `shape` can tell them apart.
        setGranolaError(result.seen === 0 ? diagnoseEmptySync(result.shape) : '');
      }
    } catch (err) {
      // "Not configured" is a setup state, not an error: the key was
      // never added to this deployment, so there is nothing to retry.
      if (err?.configured === false) {
        setGranolaUnconfigured(true);
        setGranolaError('');
      } else {
        setGranolaError(err?.message || String(err));
      }
    } finally {
      granolaImportingRef.current = false;
      setGranolaImporting(false);
    }
  }, [uid]);

  // One import per visit, and only when what's stored has gone stale.
  // Waits for the stored records so the unchanged-note check above has
  // something to compare against — without it the first import would
  // rewrite every meeting it has ever seen.
  useEffect(() => {
    if (!uid || !granolaLoaded || granolaAutoRan.current) return;
    const age = granolaSyncedAt ? Date.now() - new Date(granolaSyncedAt).getTime() : Infinity;
    if (Number.isFinite(age) && age < GRANOLA_STALE_MS) return;
    granolaAutoRan.current = true;
    importMeetings();
  }, [uid, granolaLoaded, granolaSyncedAt, importMeetings]);

  const granolaMeetings = useMemo(() => (
    granolaMeetingsFromRecords(granolaRecords).map(m => (
      m._company ? m : { ...m, _company: guessCompanyFromEmails(...(m._externalEmails || [])) }
    ))
  ), [granolaRecords, hubspotContacts, domainToCompany]);

  // Notes that stored fine and still produced no row, because nothing on
  // them parses as a start time. diagnoseEmptySync explains a sync that
  // brought back nothing; this is the case after it, and without a line
  // of its own it reads as an empty calendar — the one reading that
  // points nowhere.
  const granolaUndated = useMemo(
    () => undatedGranolaRecords(granolaRecords).length,
    [granolaRecords],
  );

  const allActivities = useMemo(() => {
    if (!data && granolaMeetings.length === 0) return [];
    // Filter out sample emails only — keep all real emails
    const filteredEmails = (data?.emails || []).filter(e => {
      const subject = (e.hs_email_subject || '').toLowerCase();
      if (subject.includes('(sample email)')) return false;
      return true;
    });
    const combined = [
      ...granolaMeetings,
      ...filteredEmails.map(e => {
        // Determine direction: anything from @se.com (all SE users share
        // the domain) or the current user's configured work email is
        // outbound; everything else with a sender is inbound.
        const from = (e.hs_email_from_email || '').toLowerCase();
        const workEmail = (settings?.workEmail || '').toLowerCase();
        // When the sender is known, it decides direction. When the email
        // object has a blank sender (common for one-to-many / sequence
        // sends that HubSpot logs as a contact association), fall back to
        // HubSpot's own hs_email_direction: INCOMING_EMAIL = received,
        // everything else (EMAIL / FORWARDED_EMAIL) = a user-sent outbound.
        const rawDir = String(e.hs_email_direction || '').toUpperCase();
        const direction = from.includes('@se.com') || (workEmail && from === workEmail)
          ? 'Outbound'
          : from
            ? 'Inbound'
            : rawDir === 'INCOMING_EMAIL'
              ? 'Inbound'
              : rawDir
                ? 'Outbound'
                : '';
        // Look up phone from associated contacts or email match
        let emailPhone = '';
        const emailContactIds = e._contactIds || [];
        for (const id of emailContactIds) {
          const ct = contactIdMap.get(id);
          if (ct?.phone) { emailPhone = ct.phone; break; }
        }
        if (!emailPhone) {
          // Try matching to/from email to HubSpot contacts
          const toEmail = (e.hs_email_to_email || '').toLowerCase().split(/[;,]/)[0]?.trim();
          const fromEmail = (e.hs_email_from_email || '').toLowerCase().split(/[;,]/)[0]?.trim();
          for (const [, ct] of contactIdMap) {
            if (ct.phone && ct.email && (ct.email.toLowerCase() === toEmail || ct.email.toLowerCase() === fromEmail)) {
              emailPhone = ct.phone; break;
            }
          }
        }
        return {
          ...e,
          _type: 'email',
          _timestamp: e.hs_timestamp,
          _subject: e.hs_email_subject || '',
          _to: e.hs_email_to_email || '',
          _toName: [e.hs_email_to_firstname, e.hs_email_to_lastname].filter(Boolean).join(' '),
          _from: e.hs_email_from_email || '',
          _fromName: [e.hs_email_from_firstname, e.hs_email_from_lastname].filter(Boolean).join(' '),
          _cc: e.hs_email_cc_email || '',
          _ccName: [e.hs_email_cc_firstname, e.hs_email_cc_lastname].filter(Boolean).join(' '),
          _direction: direction,
          _status: e.hs_email_status || '',
          _duration: null,
          _company: guessCompanyFromEmails(e.hs_email_to_email, e.hs_email_from_email),
          _phone: emailPhone,
        };
      }),
      ...(data?.calls || []).map(c => {
        // Resolve contact name and phone from associated contact IDs
        const callContactIds = c._contactIds || [];
        let callContactName = '';
        let callContactPhone = '';
        for (const id of callContactIds) {
          const contact = contactIdMap.get(id);
          if (contact) {
            const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ');
            if (name) callContactName = name;
            if (contact.phone) callContactPhone = contact.phone;
            break;
          }
        }
        return {
          ...c,
          _type: 'call',
          _timestamp: c.hs_timestamp,
          _subject: c.hs_call_title || 'Call',
          _to: c.hs_call_to_number || callContactPhone || '',
          _toName: callContactName,
          _from: c.hs_call_from_number || '',
          _fromName: '',
          _direction: c.hs_call_direction || '',
          _status: c.hs_call_disposition || c.hs_call_status || '',
          _duration: c.hs_call_duration,
          _company: guessCompanyFromEmails(c.hs_call_to_number, c.hs_call_from_number) || (callContactName ? (() => { for (const id of callContactIds) { const ct = contactIdMap.get(id); if (ct?.company) return ct.company; } return ''; })() : ''),
          _phone: callContactPhone || c.hs_call_to_number || '',
        };
      }),
      ...(data?.meetings || []).map(m => {
        // Resolve attendees from associated contact IDs
        const contactIds = m._contactIds || [];
        const attendeeNames = contactIds.map(id => {
          const c = contactIdMap.get(id);
          if (c) {
            const name = [c.firstname, c.lastname].filter(Boolean).join(' ');
            return name || c.email || `Contact ${id}`;
          }
          return `Contact ${id}`;
        }).filter(n => !n.toLowerCase().includes('@se.com'));
        const attendeeEmails = contactIds.map(id => contactIdMap.get(id)?.email).filter(Boolean);
        const externalEmails = attendeeEmails.filter(e => !e.toLowerCase().endsWith('@se.com'));

        return {
          ...m,
          _type: 'meeting',
          _source: 'hubspot',
          _timestamp: m.hs_timestamp || m.hs_meeting_start_time,
          _subject: m.hs_meeting_title || 'Meeting',
          _to: attendeeNames.join(', '),
          _toName: '',
          _from: '',
          _fromName: '',
          _direction: '',
          _status: m.hs_meeting_outcome || '',
          _duration: null,
          _meetingStart: m.hs_meeting_start_time,
          _meetingEnd: m.hs_meeting_end_time,
          _attendees: attendeeNames.join(', '),
          _attendeeCount: contactIds.length,
          _company: guessCompanyFromEmails(...externalEmails),
        };
      }),
    ];
    combined.sort((a, b) => new Date(b._timestamp || 0) - new Date(a._timestamp || 0));
    return combined;
  }, [data, granolaMeetings, settings?.workEmail]);

  const emailCount = allActivities.filter(a => a._type === 'email').length;
  const callCount = allActivities.filter(a => a._type === 'call').length;
  const meetingCount = allActivities.filter(a => a._type === 'meeting').length;

  // How far back the meetings panel looks. Today is the default — it is
  // what the panel was, and it is what most visits want — but the same
  // meetings are worth reading back over after the fact, which is what
  // the wider windows are for. The choice is kept per browser rather
  // than in synced settings: it is how you're reading the page right
  // now, not a preference worth pushing to your other devices.
  const [meetingRangeKey, setMeetingRangeKey] = useState(() => {
    const saved = String(userLsGet(MEETING_RANGE_KEY) || '');
    if (MEETING_RANGES.some(r => r.key === saved)) return saved;
    // Before there was a forward window this was stored as a bare number
    // of days. Read those rather than resetting a returning user to Today.
    const legacy = { 1: 'today', 7: 'last7', 30: 'last30' }[Number(saved)];
    return legacy || 'today';
  });

  const meetingRange = useMemo(
    () => MEETING_RANGES.find(r => r.key === meetingRangeKey) || MEETING_RANGES[0],
    [meetingRangeKey],
  );
  const meetingRangeDays = meetingRange.days;

  function chooseMeetingRange(key) {
    setMeetingRangeKey(key);
    try { userLsSet(MEETING_RANGE_KEY, key); } catch { /* quota */ }
  }

  const meetingWindow = useMemo(
    () => (meetingRange.forward ? rangeForUpcoming(meetingRange.days) : rangeForDays(meetingRange.days)),
    [meetingRange],
  );

  const hubspotRangeMeetings = useMemo(() => (
    meetingsInRange(allActivities.filter(a => a._type === 'meeting' && a._source === 'hubspot'), meetingWindow)
  ), [allActivities, meetingWindow]);

  const granolaRangeMeetings = useMemo(() => (
    meetingsInRange(granolaMeetings, meetingWindow)
  ), [granolaMeetings, meetingWindow]);

  // ── Outlook Calendar over Microsoft Graph ──
  // The calendar itself, read through the Outlook sign-in the Draft
  // Emails page and the opportunity meeting picker already use — its
  // scope has included Calendars.Read all along. This is what puts a
  // meeting on the page BEFORE it happens: Granola only knows the ones
  // it has already sat in and written up.
  const [graphEvents, setGraphEvents] = useState([]);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [graphTruncated, setGraphTruncated] = useState(false);
  const [graphFetchedAt, setGraphFetchedAt] = useState('');
  // 'unknown' until the stored token has been read: the panel must not
  // say "not connected" on first paint to somebody who is.
  const [outlookAuth, setOutlookAuth] = useState('unknown'); // unknown | none | expired | live
  const graphLoadingRef = useRef(false);

  /** The stored Graph token, or '' when there isn't a usable one. */
  const readOutlookToken = useCallback(async () => {
    try {
      const token = await secureGet('outlook-access-token');
      if (!token) { setOutlookAuth('none'); return ''; }
      const expiry = Number(await secureGet('outlook-token-expiry'));
      if (Number.isFinite(expiry) && expiry > 0 && Date.now() > expiry - GRAPH_EXPIRY_SKEW_MS) {
        setOutlookAuth('expired');
        return '';
      }
      setOutlookAuth('live');
      return token;
    } catch {
      setOutlookAuth('none');
      return '';
    }
  }, []);

  /**
   * Pull the calendar window every range button can draw from. One fetch
   * covers all of them, so switching range re-filters rather than
   * re-fetches.
   */
  const loadOutlookCalendar = useCallback(async (tokenOverride = '') => {
    if (graphLoadingRef.current) return;
    const token = tokenOverride || await readOutlookToken();
    if (!token) return;

    graphLoadingRef.current = true;
    setGraphLoading(true);
    setGraphError('');
    try {
      const r = await apiFetch(
        `/api/outlook-calendar?startDays=${GRAPH_START_DAYS}&endDays=${GRAPH_END_DAYS}`,
        { headers: { 'X-MS-Token': token } },
      );
      if (r.status === 401) {
        // The token outlived its expiry stamp, or was revoked. Not an
        // error worth a red banner — signing in again is the whole fix.
        setOutlookAuth('expired');
        return;
      }
      if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.error || ''; } catch { detail = await r.text().catch(() => ''); }
        setGraphError(detail || `Outlook calendar fetch failed (HTTP ${r.status})`);
        return;
      }
      const body = await r.json();
      setGraphEvents(outlookMeetingsFromEvents(body.events || []));
      setGraphTruncated(!!body.truncated);
      setGraphLoaded(true);
      setGraphFetchedAt(new Date().toISOString());
      setOutlookAuth('live');
    } catch (err) {
      setGraphError(err?.message || String(err));
    } finally {
      graphLoadingRef.current = false;
      setGraphLoading(false);
    }
  }, [readOutlookToken]);

  // Read the calendar on arrival when the sign-in is still good. Nothing
  // pops up and nothing is asked of the user: either the token is live
  // and their day is on the page, or the panel says how to connect.
  useEffect(() => { loadOutlookCalendar(); }, [loadOutlookCalendar]);

  // The sign-in popup reports back the same way it does on the Draft
  // Emails page and in the opportunity meeting picker, so one Outlook
  // connection serves all three.
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'outlook-auth-success') {
        (async () => {
          try {
            await secureSet('outlook-access-token', e.data.accessToken);
            if (e.data.refreshToken) await secureSet('outlook-refresh-token', e.data.refreshToken);
            await secureSet('outlook-token-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
          } catch { /* storage refused: the fetch below still works this session */ }
          setOutlookAuth('live');
          loadOutlookCalendar(e.data.accessToken);
        })();
      } else if (e.data?.type === 'outlook-auth-error') {
        setGraphError(e.data.error || 'Outlook sign-in failed');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadOutlookCalendar]);

  // The history behind the Outlook sign-in not being offered. Closed by
  // default: it is a footnote until somebody asks why the calendar is
  // not here.
  const [showOutlookNote, setShowOutlookNote] = useState(false);

  function connectOutlook() {
    setGraphError('');
    window.open('/api/outlook-auth', 'outlook-auth', 'width=500,height=700,left=200,top=100');
  }

  function disconnectOutlook() {
    if (!window.confirm('Disconnect Outlook? Your calendar will stop showing here, and the Draft Emails page will ask you to sign in again.')) return;
    try {
      secureClear('outlook-access-token');
      secureClear('outlook-refresh-token');
      secureClear('outlook-token-expiry');
    } catch { /* nothing stored */ }
    setGraphEvents([]);
    setGraphLoaded(false);
    setGraphFetchedAt('');
    setOutlookAuth('none');
  }

  // Company names, from the same domain → company index the Granola rows
  // go through, so a calendar meeting shows who it's with rather than
  // just who's on it.
  const outlookMeetings = useMemo(() => (
    graphEvents.map(m => (
      m._company ? m : { ...m, _company: guessCompanyFromEmails(...(m._externalEmails || [])) }
    ))
  ), [graphEvents, hubspotContacts, domainToCompany]);

  // ── Outlook Calendar via Power Automate webhook ──
  // Power Automate pushes meetings to /api/calendar-webhook?token=xxx,
  // which writes to Firestore calendarWebhook/{token}. We listen in real time.
  const [outlookEvents, setOutlookEvents] = useState([]);
  const [outlookError, setOutlookError] = useState(null);
  const [showWebhookSetup, setShowWebhookSetup] = useState(false);

  const webhookStorageKey = 'outlook-webhook-token';
  const savedWebhookToken = (() => { try { return userLsGet(webhookStorageKey) || ''; } catch { return ''; } })();
  const hasWebhookToken = !!savedWebhookToken;
  const [webhookToken, setWebhookToken] = useState(savedWebhookToken);
  const outlookLoading = false;

  // Generate a random token for new users
  function generateToken() {
    return 'wh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function setupWebhook() {
    const token = savedWebhookToken || generateToken();
    if (!savedWebhookToken) {
      try { userLsSet(webhookStorageKey, token); } catch {}
      setWebhookToken(token);
    }
    setShowWebhookSetup(true);
  }

  function removeWebhook() {
    if (!window.confirm('Disconnect Outlook calendar? Your Power Automate flow will keep running but meetings will stop showing here.')) return;
    try { userLsRemove(webhookStorageKey); } catch {}
    setWebhookToken('');
    setOutlookEvents([]);
    setShowWebhookSetup(false);
  }

  // Subscribe to Firestore for real-time meeting updates from the webhook
  useEffect(() => {
    if (!webhookToken) return;
    const unsub = onSnapshot(
      doc(db, 'calendarWebhook', webhookToken),
      (snap) => {
        const data = snap.data();
        if (!data?.meetings) { setOutlookEvents([]); return; }
        // Everything the flow pushed is kept — the panel's own window
        // decides what to show. Narrowing to today here instead would
        // mean re-subscribing every time that window changes, and would
        // throw away the past meetings the wider windows are for.
        const events = data.meetings
          .map((m, i) => ({
            id: `outlook-wh-${i}`,
            _type: 'meeting',
            _source: 'outlook',
            _subject: m.subject || '(No subject)',
            _meetingStart: m.start,
            _meetingEnd: m.end,
            _location: m.location || '',
            _attendees: (m.attendees || [])
              .filter(a => !a.email?.toLowerCase().endsWith('@se.com'))
              .map(a => a.name || a.email)
              .join(', '),
            _attendeeDetails: m.attendees || [],
            _company: '',
          }))
          .sort((a, b) => new Date(a._meetingStart) - new Date(b._meetingStart));
        setOutlookEvents(events);
      },
      (err) => {
        console.error('Webhook snapshot error:', err);
        setOutlookError('Failed to read calendar webhook data');
      }
    );
    return unsub;
  }, [webhookToken]);

  // The calendar as Granola relays it, when Granola will relay it.
  const granolaCalendarRows = useMemo(() => (
    granolaCalendarMeetings(granolaCalendar?.events || []).map(m => (
      m._company ? m : { ...m, _company: guessCompanyFromEmails(...(m._externalEmails || [])) }
    ))
  ), [granolaCalendar, hubspotContacts, domainToCompany]);

  // The calendar, from whichever path is live — in the order the user
  // would choose them: through Granola (no connection of our own), then
  // the direct sign-in, then the Power Automate flow.
  //
  // Exactly one of them, never a blend. They all describe the same
  // events, and mergeMeetings only ever collapses copies from DIFFERENT
  // sources — so feeding it two calendar feeds would double every
  // meeting rather than reconcile them.
  const calendarMeetings = granolaCalendarRows.length > 0
    ? granolaCalendarRows
    : (outlookMeetings.length > 0 ? outlookMeetings : outlookEvents);

  // HubSpot + Outlook + Granola over the chosen window. The same meeting
  // reaches this page from more than one of them — the calendar invite
  // from Outlook, Granola's note on the meeting it sat in — so the copies
  // are collapsed into one row that carries both.
  const rangeMeetings = useMemo(() => (
    mergeMeetings([
      ...hubspotRangeMeetings,
      ...meetingsInRange(calendarMeetings, meetingWindow),
      ...granolaRangeMeetings,
    ])
  ), [hubspotRangeMeetings, calendarMeetings, granolaRangeMeetings, meetingWindow]);

  // Broken into days for rendering, each day read forwards. A look-back
  // opens on the most recent day; a look-ahead opens on today and runs
  // into next week.
  const meetingDayGroups = useMemo(
    () => groupMeetingsByDay(rangeMeetings, { order: meetingRange.forward ? 'asc' : 'desc' }),
    [rangeMeetings, meetingRange],
  );

  // The window this panel is showing, named so a sentence can end with
  // it: "none today", "none in the next 7 days".
  const rangeName = meetingRange.forward
    ? `in the next ${meetingRange.days} days`
    : (meetingRangeDays === 1 ? 'today' : `in the last ${meetingRangeDays} days`);

  // Why the Granola count is what it is. Suppressed when the panel is
  // already showing an error or the setup notice — those say more.
  const granolaNote = useMemo(() => (
    (granolaUnconfigured || granolaError) ? '' : describeGranolaMeetings({
      total: granolaMeetings.length,
      inRange: granolaRangeMeetings.length,
      undated: granolaUndated,
      imported: granolaImportResult,
      rangeDays: meetingRangeDays,
      windowDays: DEFAULT_MEETING_WINDOW_DAYS,
      syncedAt: granolaSyncedAt,
      rangeName,
    })
  ), [
    granolaMeetings, granolaRangeMeetings, granolaUndated, granolaImportResult,
    meetingRangeDays, granolaSyncedAt, granolaUnconfigured, granolaError, rangeName,
  ]);

  // Why the calendar is showing what it is: not connected, signed out,
  // or connected with nothing in this window. All three render as an
  // empty list, and only the first two are something the user can act on.
  // What Granola said when asked for the calendar. This is the sentence
  // that matters when the panel is empty: Granola sits in these meetings
  // and syncs this calendar, so "why isn't it here" has a real answer,
  // and it isn't one more sync will fix.
  const granolaCalendarNote = useMemo(() => (
    (!granolaCalendar || calendarMeetings.length > 0) ? '' : describeGranolaCalendar({
      supported: granolaCalendar.supported,
      attempts: granolaCalendar.attempts,
      error: granolaCalendar.error,
      events: granolaCalendarRows.length,
    })
  ), [granolaCalendar, granolaCalendarRows, calendarMeetings]);

  const outlookNote = useMemo(() => (
    // Nothing to say while the stored token is still being read, and
    // nothing at all to somebody whose calendar is already on the page
    // by some other route — "Outlook isn't connected" would be answering
    // a question they haven't asked.
    (graphError || outlookAuth === 'unknown' || calendarMeetings.length > 0) ? '' : describeOutlookCalendar({
      connected: outlookAuth === 'live' || outlookAuth === 'expired',
      expired: outlookAuth === 'expired',
      loaded: graphLoaded,
      events: graphEvents.length,
      inRange: meetingsInRange(calendarMeetings, meetingWindow).length,
      rangeLabel: rangeName,
    })
  ), [graphError, outlookAuth, graphLoaded, graphEvents, calendarMeetings, meetingWindow, rangeName]);

  // The heading over a day's meetings. The days either side of today are
  // named rather than dated — "Yesterday" and "Tomorrow" are what you
  // actually call them when scanning a week.
  function fmtDayHeading(dayStart) {
    const day = new Date(dayStart);
    const today = new Date();
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const daysBack = Math.round((midnight - dayStart) / (24 * 60 * 60 * 1000));
    const dated = day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (daysBack === 0) return `Today · ${dated}`;
    if (daysBack === 1) return `Yesterday · ${dated}`;
    if (daysBack === -1) return `Tomorrow · ${dated}`;
    return dated;
  }

  function fmtMeetingTime(startStr, endStr, allDay = false) {
    if (allDay) return 'All day';
    if (!startStr) return '-';
    const start = new Date(startStr);
    if (isNaN(start)) return '-';
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (!endStr) return fmt(start);
    const end = new Date(endStr);
    if (isNaN(end)) return fmt(start);
    return `${fmt(start)} – ${fmt(end)}`;
  }

  const filtered = useMemo(() => {
    let result = allActivities;
    if (typeFilter) result = result.filter(a => a._type === typeFilter);
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(a =>
        [a._subject, a._to, a._toName, a._from, a._fromName, a._cc, a._ccName, a._status, a._company, a._attendees]
          .filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }
    return result;
  }, [allActivities, typeFilter, search]);

  // Today's Outbound feed: emails + calls only, sent today, where at
  // least one external (non-@se.com) recipient is on the to-line. The
  // row is annotated with the first matching active opp (if any) so
  // the table can show "this email maps to opp X on Account Y".
  const oppsRecords = useOppsRecords(user?.uid);
  const activeOpps = useMemo(() => (
    (oppsRecords || []).filter(r => {
      const stage = String(r.Stage || '').trim();
      return stage && !OPP_INVALID_STAGES.has(stage) && !OPP_CLOSED_STAGES.has(stage);
    })
  ), [oppsRecords]);

  const findActiveOppForEmail = useCallback((email) => {
    if (!email) return null;
    const lower = String(email).toLowerCase().trim();
    if (!lower || lower.endsWith('@se.com')) return null;
    // Primary lookup: the opp's Contact field on the Opps tab is the
    // canonical link. The user manages it row-by-row (e.g.
    // "ashish.patel@..." on the Toronto Airport opp), so a direct
    // email match is far more reliable than a fuzzy company match.
    // Contact field can be a single email, a name + email, or a
    // comma/semicolon list of either, so we walk every token and
    // treat any embedded e-mail address as a candidate.
    for (const opp of activeOpps) {
      const raw = String(opp.Contact || '').toLowerCase();
      if (!raw) continue;
      // Pull out anything that looks like an e-mail; avoids needing
      // to know which delimiter / format the Contact cell uses.
      const matches = raw.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || [];
      if (matches.includes(lower)) return opp;
    }
    // Fallback: domain → prospect-company → opp.Account fuzzy match,
    // for opps that haven't had a Contact email filled in yet. Keeps
    // the matcher useful while the Contact column is still being
    // populated, but the precise per-row link above wins when it
    // hits.
    let company = '';
    if (hubspotContacts.has(lower)) company = hubspotContacts.get(lower);
    if (!company) {
      const at = lower.lastIndexOf('@');
      if (at >= 0) {
        const domain = lower.slice(at + 1);
        if (domainToCompany.has(domain)) company = domainToCompany.get(domain);
      }
    }
    if (!company) return null;
    for (const opp of activeOpps) {
      const acct = String(opp.Account || '').trim();
      if (!acct) continue;
      if (companiesMatchFuzz(acct, company)) return opp;
    }
    return null;
  }, [hubspotContacts, domainToCompany, activeOpps]);

  // Email → HubSpot contact lookup so we can decorate the external
  // recipients with names. Built once from the cache and reused
  // by the Today's Outbound row builder + the rendered cell.
  const contactByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email) map.set(c.email.toLowerCase().trim(), c);
    }
    return map;
  }, [hubspotCache]);

  const todayOutbound = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    // Helper: turn a non-@se.com email + (optional) HubSpot contact
    // into a { name, email } record. Falls back to the email-derived
    // name / blank name when HubSpot has no contact on file.
    const recipientFor = (email, fallbackName) => {
      const lower = String(email || '').toLowerCase().trim();
      if (!lower) return null;
      const ct = contactByEmail.get(lower);
      const name = ct
        ? [ct.firstname, ct.lastname].filter(Boolean).join(' ').trim()
        : '';
      return { name: name || (fallbackName || ''), email: lower };
    };

    const out = [];
    for (const a of allActivities) {
      if (a._type !== 'email' && a._type !== 'call') continue;
      const t = new Date(a._timestamp || 0).getTime();
      if (!Number.isFinite(t) || t < todayStart || t >= todayEnd) continue;
      const dir = String(a._direction || '').toLowerCase();
      if (!dir.includes('outbound') && !dir.includes('out')) continue;
      // Build the recipient list. Emails: parse hs_email_to_email
      // (already on a._to) on , / ; , drop @se.com addresses,
      // decorate each with the name on the HubSpot contact (or the
      // raw to-name on the email if no contact match). Calls: walk
      // the associated HubSpot contact IDs since the to-field is a
      // phone number rather than an email.
      let recipients = [];
      if (a._type === 'email') {
        const tos = String(a._to || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
        const externals = tos.filter(t => !t.toLowerCase().endsWith('@se.com'));
        // Mixed to-line (se.com + non-se.com) stays in; fully
        // internal blasts drop.
        if (externals.length > 0) {
          recipients = externals
            .map(em => recipientFor(em, a._toName))
            .filter(Boolean);
        } else {
          // No usable To-line on the email object. HubSpot often logs a
          // send (one-to-many / sequence) with a blank hs_email_to_email
          // and only a contact association, so recover the recipients from
          // the associated contacts instead — mirroring the call branch.
          // Fully internal (@se.com-only) sends still drop.
          for (const id of (a._contactIds || [])) {
            const ct = contactIdMap.get(id);
            const em = String(ct?.email || '').toLowerCase().trim();
            if (!em || em.endsWith('@se.com')) continue;
            const name = [ct?.firstname, ct?.lastname].filter(Boolean).join(' ').trim();
            recipients.push({ name, email: em });
          }
          if (recipients.length === 0) continue;
        }
      } else {
        const cids = a._contactIds || [];
        for (const id of cids) {
          const ct = contactIdMap.get(id);
          const em = String(ct?.email || '').toLowerCase().trim();
          if (!em || em.endsWith('@se.com')) continue;
          const name = [ct?.firstname, ct?.lastname].filter(Boolean).join(' ').trim();
          recipients.push({ name, email: em });
        }
      }
      // Dedup by email so the same person doesn't show up twice
      // when the to-line repeats them.
      const seen = new Set();
      recipients = recipients.filter(r => {
        if (!r?.email || seen.has(r.email)) return false;
        seen.add(r.email);
        return true;
      });
      let activeOpp = null;
      let matchedEmail = null;
      for (const r of recipients) {
        const opp = findActiveOppForEmail(r.email);
        if (opp) { activeOpp = opp; matchedEmail = r.email; break; }
      }
      out.push({
        ...a,
        _recipients: recipients,
        _externalTo: recipients.map(r => r.email).join(', '),
        _externalToNames: recipients.map(r => r.name).filter(Boolean).join(', '),
        _matchedEmail: matchedEmail,
        _activeOpp: activeOpp,
      });
    }
    out.sort((a, b) => new Date(b._timestamp || 0) - new Date(a._timestamp || 0));
    return out;
  }, [allActivities, contactIdMap, contactByEmail, findActiveOppForEmail]);

  const filteredTodayOutbound = useMemo(() => {
    if (!search.trim()) return todayOutbound;
    const term = search.toLowerCase();
    return todayOutbound.filter(a =>
      [a._subject, a._to, a._externalTo, a._externalToNames, a._toName, a._company, a._activeOpp?.Account, a._activeOpp?.Stage, a._activeOpp?.['BFO Link']]
        .filter(Boolean).join(' ').toLowerCase().includes(term)
    );
  }, [todayOutbound, search]);

  const todayOutboundColumns = [
    { key: '_type', label: 'Type', defaultWidth: 80, render: (a) => (
      <span className={a._type === 'email' ? styles.typeEmail : styles.typeCall}>
        {a._type === 'email' ? 'Email' : 'Call'}
      </span>
    )},
    { key: '_timestamp', label: 'Time', defaultWidth: 120, render: (a) => <span className={styles.dateText}>{fmtDateTime(a._timestamp)}</span> },
    { key: '_company', label: 'Company', defaultWidth: 160, render: (a) => a._company ? <span style={{ fontWeight: 600 }}>{a._company}</span> : <span className={styles.metaText}>-</span> },
    { key: '_subject', label: 'Subject / Title', defaultWidth: 260, render: (a) => <span className={styles.subject}>{a._subject || '-'}</span> },
    { key: '_externalTo', label: 'To (external)', defaultWidth: 280, render: (a) => {
      const recipients = a._recipients || [];
      if (recipients.length === 0) return <span className={styles.metaText}>-</span>;
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, lineHeight: 1.25 }}>
          {recipients.map((r, i) => (
            <span key={r.email + i} title={r.name ? `${r.name} <${r.email}>` : r.email}>
              {r.name && <span style={{ fontWeight: 600, marginRight: 4 }}>{r.name}</span>}
              <span style={{ color: r.name ? '#94A3B8' : 'var(--color-text)' }}>{r.email}</span>
            </span>
          ))}
        </span>
      );
    }},

    { key: '_activeOpp', label: 'Active Opp', defaultWidth: 220, render: (a) => {
      const opp = a._activeOpp;
      if (!opp) return <span className={styles.metaText}>-</span>;
      const stage = String(opp.Stage || '').trim();
      const tooltip = a._matchedEmail
        ? `Matched via Opp Contact = ${a._matchedEmail}`
        : `Matched by company / domain fallback`;
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, lineHeight: 1.25, maxWidth: '100%' }} title={tooltip}>
          <span style={{ fontWeight: 600 }}>{opp.Account || '-'}</span>
          {stage && <span style={{ fontSize: '0.68rem', color: '#7C3AED', fontWeight: 600 }}>{stage}</span>}
        </span>
      );
    }},
    // BFO Link — opp's BFO Link cell as text. In the user's data
    // this field holds the BFO Opportunity Name ("SB - SUSUP -
    // Upsell - …"); when a row coincidentally carries a URL there
    // we render it as a clickable launcher instead.
    { key: '_bfoLink', label: 'BFO Link', defaultWidth: 220, render: (a) => {
      const bfo = String(a._activeOpp?.['BFO Link'] || '').trim();
      if (!bfo) return <span className={styles.metaText}>-</span>;
      if (/^https?:\/\//i.test(bfo)) {
        return (
          <a
            href={bfo}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title={bfo}
            style={{ color: 'var(--color-accent)', fontSize: '0.78rem', fontWeight: 600 }}
          >Open BFO ↗</a>
        );
      }
      return (
        <span
          title={bfo}
          style={{ fontSize: '0.78rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'inline-block' }}
        >{bfo}</span>
      );
    }},
    // BFO Address — the live Salesforce URL for the matched opp.
    // Tries a chain of plausible column names first, then falls back
    // to scanning every other column on the opp record for the first
    // value that looks like an http(s) URL. Renders as a clickable
    // anchor with the full address visible (and selectable for copy).
    { key: '_bfoAddress', label: 'BFO Address', defaultWidth: 320, render: (a) => {
      const opp = a._activeOpp;
      if (!opp) return <span className={styles.metaText}>-</span>;
      const isUrl = (s) => /^https?:\/\//i.test(s);
      const candidates = [
        opp['BFO Address'],
        opp['BFO URL'],
        opp['BFO Web Address'],
        opp['Opportunity URL'],
        opp['Opportunity Address'],
        opp['Salesforce URL'],
        opp['Salesforce Link'],
        opp['SF URL'],
        opp['SF Link'],
        opp['URL'],
        opp['Link'],
        opp['Web Address'],
      ];
      let addr = '';
      for (const c of candidates) {
        const v = String(c || '').trim();
        if (isUrl(v)) { addr = v; break; }
      }
      // Last resort: walk every key on the opp and pick the first
      // value that looks like a URL (skip the BFO Link column since
      // that holds the name, not the address).
      if (!addr) {
        for (const k of Object.keys(opp)) {
          if (k === 'BFO Link') continue;
          const v = String(opp[k] || '').trim();
          if (isUrl(v)) { addr = v; break; }
        }
      }
      if (!addr) return <span className={styles.metaText}>-</span>;
      return (
        <a
          href={addr}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          title={addr}
          style={{ fontSize: '0.72rem', color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'inline-block', userSelect: 'all' }}
        >{addr}</a>
      );
    }},
    { key: '_status', label: 'Status', defaultWidth: 110 },
    { key: '_duration', label: 'Duration', defaultWidth: 80, render: (a) => <span className={styles.duration}>{fmtDuration(a._duration)}</span> },
  ];

  const columns = [
    { key: '_type', label: 'Type', defaultWidth: 80, render: (a) => (
      <span className={a._type === 'email' ? styles.typeEmail : a._type === 'call' ? styles.typeCall : styles.typeMeeting}>
        {a._type === 'email' ? 'Email' : a._type === 'call' ? 'Call' : 'Meeting'}
      </span>
    )},
    { key: '_direction', label: 'Direction', defaultWidth: 80, render: (a) => a._direction ? <span className={styles.directionBadge}>{a._direction}</span> : <span className={styles.metaText}>-</span> },
    { key: '_timestamp', label: 'Date', defaultWidth: 140, render: (a) => <span className={styles.dateText}>{fmtDateTime(a._timestamp)}</span> },
    { key: '_company', label: 'Company', defaultWidth: 160, render: (a) => a._company ? <span style={{ fontWeight: 600 }}>{a._company}</span> : <span className={styles.metaText}>-</span> },
    // Granola meetings link straight to their note: the row says a
    // meeting happened, the note says what was said in it.
    { key: '_subject', label: 'Subject / Title', defaultWidth: 250, render: (a) => (
      a._granolaUrl
        ? (
          <a
            href={a._granolaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title={a._granolaSummary ? a._granolaSummary.slice(0, 400) : a._subject}
            className={styles.subject}
            style={{ color: '#B45309', fontWeight: 600 }}
          >{a._subject || 'Granola call'} ↗</a>
        )
        : <span className={styles.subject}>{a._subject || '-'}</span>
    ) },
    { key: '_to', label: 'To', defaultWidth: 200, render: (a) => a._toName ? <span><button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup(a._toName, a._to, a._company, a._phone); }}>{a._toName}</button> <span className={styles.metaText}>{a._to}</span></span> : a._to ? <button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup('', a._to, a._company, a._phone); }}>{a._to}</button> : <span className={styles.metaText}>-</span> },
    { key: '_from', label: 'From', defaultWidth: 200, render: (a) => a._fromName ? <span><button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup(a._fromName, a._from, a._company, ''); }}>{a._fromName}</button> <span className={styles.metaText}>{a._from}</span></span> : a._from ? <button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup('', a._from, a._company, ''); }}>{a._from}</button> : <span className={styles.metaText}>-</span> },
    { key: '_cc', label: 'CC', defaultWidth: 220, render: (a) => {
      // Contacts CC'd on the email. Parse the cc address list, resolve each
      // to a HubSpot contact name where we have one (falling back to the
      // email's cc-name for a single recipient, else just the address).
      const emails = String(a._cc || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
      if (emails.length === 0) return <span className={styles.metaText}>-</span>;
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, lineHeight: 1.25 }}>
          {emails.map((em, i) => {
            const ct = contactByEmail.get(em.toLowerCase());
            const name = ct
              ? [ct.firstname, ct.lastname].filter(Boolean).join(' ').trim()
              : (emails.length === 1 ? (a._ccName || '') : '');
            return (
              <span key={em + i} title={name ? `${name} <${em}>` : em}>
                {name && <span style={{ fontWeight: 600, marginRight: 4 }}>{name}</span>}
                <span style={{ color: name ? '#94A3B8' : 'var(--color-text)' }}>{em}</span>
              </span>
            );
          })}
        </span>
      );
    } },
    { key: '_attendees', label: 'Attendees', defaultWidth: 200, render: (a) => a._attendees ? <span className={styles.contactText}>{a._attendees}</span> : <span className={styles.metaText}>-</span> },
    { key: '_status', label: 'Status', defaultWidth: 110 },
    { key: '_duration', label: 'Duration', defaultWidth: 80, render: (a) => <span className={styles.duration}>{fmtDuration(a._duration)}</span> },
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Activity</h2>
          {data?.fetchedAt && <span className={styles.lastSync}>Last fetched: {fmtDateTime(data.fetchedAt)}</span>}
        </div>
        <button className={styles.syncBtn} onClick={fetchActivity} disabled={loading}>
          {loading ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Today's calendar. Rendered as soon as ANY source has something
          to say — the Outlook calendar and the Granola meetings each
          stand on their own, so the panel never waits on the HubSpot
          fetch, and somebody with only Outlook connected still gets a
          panel. */}
      {(data || granolaLoaded || graphLoaded || outlookAuth !== 'unknown') && (
        <div style={{ marginBottom: '1rem', border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: '0.6rem 0.9rem', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-text)' }}>
                {meetingRange.key === 'today' ? "Today's Meetings" : (meetingRange.forward ? 'Coming Up' : 'Meetings')}
                <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                  {meetingRange.key === 'today'
                    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                    : (meetingRange.forward
                      ? `today – ${new Date(meetingWindow.end - 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : `${new Date(meetingWindow.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – today`)}
                </span>
              </div>
              {/* How far back to look. Segmented rather than a dropdown:
                  three options, and the current one is worth seeing
                  without opening anything. */}
              <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
                {MEETING_RANGES.map((range, rangeIdx) => {
                  const isActive = meetingRange.key === range.key;
                  return (
                    <button
                      key={range.key}
                      type="button"
                      onClick={() => chooseMeetingRange(range.key)}
                      title={range.title}
                      style={{
                        padding: '0.2rem 0.5rem',
                        border: 'none',
                        borderLeft: rangeIdx === 0 ? 'none' : '1px solid var(--color-border)',
                        background: isActive ? 'var(--color-accent)' : '#fff',
                        color: isActive ? '#fff' : 'var(--color-text-secondary)',
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >{range.label}</button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{rangeMeetings.length} meeting{rangeMeetings.length === 1 ? '' : 's'}</span>
              <button
                onClick={importMeetings}
                disabled={granolaImporting || !uid}
                title={granolaSyncedAt
                  ? `Import the last ${DEFAULT_MEETING_WINDOW_DAYS} days of meetings from Granola. Last imported ${fmtDateTime(granolaSyncedAt)}.`
                  : `Import the last ${DEFAULT_MEETING_WINDOW_DAYS} days of meetings from Granola`}
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #7C3AED', borderRadius: 4, background: '#fff', color: '#7C3AED', fontSize: '0.68rem', fontWeight: 600, cursor: granolaImporting ? 'default' : 'pointer', fontFamily: 'inherit', opacity: granolaImporting ? 0.6 : 1 }}
              >{granolaImporting ? 'Importing…' : '↻ Granola'}</button>
              {/* The calendar itself. One sign-in, shared with Draft
                  Emails and the opportunity meeting picker — so for most
                  visits this is already connected and there is nothing
                  here but a refresh. */}
              {outlookAuth === 'live' ? (
                <>
                  <button
                    onClick={() => loadOutlookCalendar()}
                    disabled={graphLoading}
                    title={graphFetchedAt
                      ? `Re-read your Outlook calendar. Last read ${fmtDateTime(graphFetchedAt)}.`
                      : 'Re-read your Outlook calendar'}
                    style={{ padding: '0.25rem 0.6rem', border: '1px solid #0078D4', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: graphLoading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: graphLoading ? 0.6 : 1 }}
                  >{graphLoading ? 'Reading…' : '↻ Outlook'}</button>
                  <button
                    onClick={disconnectOutlook}
                    title="Disconnect Outlook"
                    style={{ padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >×</button>
                </>
              ) : outlookAuth === 'expired' ? (
                <button
                  onClick={connectOutlook}
                  title="Your Outlook sign-in expired. Signing in again is the whole fix."
                  style={{ padding: '0.25rem 0.6rem', border: '1px solid #0078D4', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >↻ Reconnect Outlook</button>
              ) : outlookAuth !== 'unknown' && (
                // Not a "+ Connect Outlook" button any more. Signing in
                // needs an Azure app registration this tenant will not
                // grant, so the button could only ever spend a click to
                // reach a Microsoft error page. It opens the history of
                // that decision instead, which is the useful thing left
                // to hand somebody looking at an Outlook-shaped gap.
                <button
                  onClick={() => setShowOutlookNote(v => !v)}
                  title="Why the Outlook sign-in is not offered here"
                  style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.68rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >Outlook: not available</button>
              )}
              {/* The Power Automate route the panel used to depend on.
                  Kept for anyone already running that flow, but folded
                  away — the sign-in above needs no flow at all. */}
              {hasWebhookToken ? (
                <>
                  <button
                    onClick={setupWebhook}
                    title="View Power Automate setup instructions"
                    style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: 'var(--color-text)', fontSize: '0.68rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                  >⚙ Power Automate</button>
                  <button
                    onClick={removeWebhook}
                    title="Disconnect the Power Automate calendar feed"
                    style={{ padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >×</button>
                </>
              ) : outlookAuth === 'none' && (
                <button
                  onClick={setupWebhook}
                  title="The older route: a Power Automate flow that POSTs your calendar here. Connecting Outlook above does the same thing with no flow to build."
                  style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.66rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >Power Automate…</button>
              )}
            </div>
          </div>
          {showWebhookSetup && webhookToken && (
            <div style={{ padding: '0.75rem 0.9rem', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: '0.75rem', color: 'var(--color-text)' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Power Automate Setup</div>
              <div style={{ marginBottom: '0.3rem' }}>Create a scheduled flow in Power Automate that runs daily and sends today's meetings to this webhook URL:</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                <code style={{ flex: 1, padding: '0.35rem 0.5rem', background: '#fff', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', wordBreak: 'break-all', userSelect: 'all' }}>
                  {`${window.location.origin}/api/calendar-webhook`}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/api/calendar-webhook`)}
                  style={{ padding: '0.3rem 0.5rem', border: '1px solid #93C5FD', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >Copy URL</button>
              </div>
              <div style={{ marginBottom: '0.3rem' }}>Your webhook token (include this in the JSON body as <code>"token"</code>):</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                <code style={{ flex: 1, padding: '0.35rem 0.5rem', background: '#fff', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', wordBreak: 'break-all', userSelect: 'all' }}>
                  {webhookToken}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(webhookToken)}
                  style={{ padding: '0.3rem 0.5rem', border: '1px solid #93C5FD', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >Copy Token</button>
              </div>
              <details style={{ marginTop: '0.4rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0078D4' }}>Step-by-step Power Automate instructions</summary>
                <ol style={{ margin: '0.4rem 0 0 1.2rem', lineHeight: 1.6 }}>
                  <li>Go to <a href="https://make.powerautomate.com" target="_blank" rel="noopener noreferrer">make.powerautomate.com</a></li>
                  <li>Click <strong>+ Create</strong> → <strong>Scheduled cloud flow</strong></li>
                  <li>Name it "Calendar Sync" and set it to run <strong>every 1 hour</strong> (or daily)</li>
                  <li>Add action: <strong>Office 365 Outlook → Get events (V4)</strong></li>
                  <li>Set Calendar to your default, Start Time = <code>utcNow()</code>, End Time = <code>addDays(utcNow(), 1)</code></li>
                  <li>Add action: <strong>HTTP</strong> with:
                    <ul style={{ marginTop: '0.2rem' }}>
                      <li>Method: <strong>POST</strong></li>
                      <li>URI: <strong>{window.location.origin}/api/calendar-webhook</strong></li>
                      <li>Headers: <code>Content-Type: application/json</code></li>
                      <li>Body: <code>{`{"token":"${webhookToken}","meetings":@{body('Get_events_(V4)')?['value']}}`}</code></li>
                    </ul>
                  </li>
                  <li>Save and run the flow once to test</li>
                </ol>
              </details>
              <button
                onClick={() => setShowWebhookSetup(false)}
                style={{ marginTop: '0.5rem', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#64748B', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Close</button>
            </div>
          )}
          {/* Why the calendar is not read straight from Outlook.
              Written down on the page rather than in a commit message
              because the question comes back every time this panel looks
              thin, and the answer is the kind that costs a week to
              rediscover. */}
          {showOutlookNote && (
            <div style={{ padding: '0.75rem 0.9rem', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', color: 'var(--color-text)', lineHeight: 1.55 }}>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
                Reading Outlook directly: closed, August 2026
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                Microsoft Graph is the only route that shows meetings <em>before</em> they happen, so it
                was worth trying. It cannot work on this tenant.
              </div>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>What happened</div>
              <div style={{ marginBottom: '0.5rem' }}>
                Connecting returned <code>AADSTS700016: Application with identifier 'undefined' was not
                found in the directory</code>. One message, two separate causes:
                <ol style={{ margin: '0.3rem 0 0 1.2rem' }}>
                  <li>
                    <code>OUTLOOK_CLIENT_ID</code> was never set in the deployment, so the sign-in URL
                    asked Azure for an app literally named "undefined". Fixed in August 2026: the popup
                    now names the missing variable instead of blaming the tenant.
                  </li>
                  <li>
                    Setting that variable needs an Azure app registration in the Schneider Electric
                    tenant. <strong>IT will not grant one.</strong> This is the decisive one, and no
                    amount of code changes it.
                  </li>
                </ol>
              </div>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>So don't try this again</div>
              <div style={{ marginBottom: '0.5rem' }}>
                <code>/api/outlook-auth</code> and <code>/api/outlook-calendar</code> are kept because
                they are correct and would work in a tenant that allows the registration. Nothing is
                wrong with them. There is simply no point spending time here again unless that
                decision changes.
              </div>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>What to use instead</div>
              <ul style={{ margin: '0 0 0.5rem 1.2rem' }}>
                <li>
                  <strong>Power Automate</strong> pushes your calendar to this page from your own
                  account, with no app registration. It is the working route for meetings that have
                  not happened yet.
                </li>
                <li>
                  <strong>Granola</strong> (↻ above) covers meetings it sat in, after the fact only.
                </li>
                <li>
                  <strong>Outlook "Publish calendar"</strong> hands out an ICS URL and is sometimes
                  left enabled where app registration is locked down.{' '}
                  <code>/api/outlook-calendar-ics</code> is written but has no button yet.
                </li>
              </ul>
              <div style={{ marginBottom: '0.6rem', color: '#64748B' }}>
                Not viable: reading Granola's local cache file. Granola encrypted it in April 2026 and
                the projects that relied on it were archived.
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <button
                  onClick={() => setShowOutlookNote(false)}
                  style={{ padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#64748B', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >Close</button>
                {/* The escape hatch, deliberately dull. If the tenant
                    ever allows the registration this is how you find out,
                    and until then it is not something to click twice. */}
                <button
                  onClick={connectOutlook}
                  title="Only useful if an Azure app registration has since been granted and the variables set"
                  style={{ padding: '0.3rem 0.6rem', border: '1px dashed var(--color-border)', borderRadius: 4, background: 'transparent', color: '#94A3B8', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >Try the sign-in anyway</button>
              </div>
            </div>
          )}
          {outlookError && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#FEF2F2', color: '#991B1B', fontSize: '0.75rem', borderBottom: '1px solid #FCA5A5' }}>
              {outlookError}
            </div>
          )}
          {graphError && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#FEF2F2', color: '#991B1B', fontSize: '0.75rem', borderBottom: '1px solid #FCA5A5' }}>
              Outlook calendar: {graphError}
            </div>
          )}
          {graphTruncated && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#FFFBEB', color: '#92400E', fontSize: '0.72rem', borderBottom: '1px solid #FDE68A' }}>
              Your calendar has more events in this window than one read can return, so the far end of it is missing here.
            </div>
          )}
          {/* Granola first: it is the connection the user already has,
              and its answer is the one that explains an empty panel. The
              Outlook line is a footnote to it, not the headline it used
              to be. */}
          {granolaCalendarNote && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#F5F3FF', color: '#5B21B6', fontSize: '0.72rem', borderBottom: '1px solid #DDD6FE' }}>
              {granolaCalendarNote}
              {outlookNote && (
                <span style={{ color: '#7C6BAF' }}>{' '}{outlookNote} A calendar has to come from somewhere: connect it, or push it here from a Power Automate flow.</span>
              )}
            </div>
          )}
          {!granolaCalendarNote && outlookNote && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#F0F9FF', color: '#075985', fontSize: '0.72rem', borderBottom: '1px solid #E0F2FE' }}>
              {outlookNote}
            </div>
          )}
          {/* Whether Granola can be reached at all, said outright. Every
              other line in this panel describes meetings; this one
              describes the connection they would have to arrive over,
              and it is the answer to "why is this empty" that no count
              can give. */}
          {granolaConnection && (
            <div style={{ padding: '0.4rem 0.9rem', background: granolaConnection.background, color: granolaConnection.color, fontSize: '0.75rem', borderBottom: `1px solid ${granolaConnection.border}`, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ flex: 1 }}>
                <strong>{granolaConnection.headline}</strong>
                {granolaConnection.detail && <>{' '}{granolaConnection.detail}</>}
              </span>
              {granolaConnection.retry && (
                <button
                  onClick={checkGranola}
                  disabled={granolaChecking}
                  style={{ padding: '0.15rem 0.5rem', border: `1px solid ${granolaConnection.border}`, borderRadius: 4, background: '#fff', color: granolaConnection.color, fontSize: '0.68rem', fontWeight: 600, cursor: granolaChecking ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: granolaChecking ? 0.6 : 1 }}
                >{granolaChecking ? 'Checking…' : 'Check again'}</button>
              )}
            </div>
          )}
          {granolaError && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#FEF2F2', color: '#991B1B', fontSize: '0.75rem', borderBottom: '1px solid #FCA5A5' }}>
              Granola: {granolaError}
            </div>
          )}
          {/* Why the count is what it is: nothing imported yet, meetings
              outside the chosen range, or notes that couldn't be dated.
              All three used to render as a bare "0 meetings". */}
          {granolaNote && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.72rem', borderBottom: '1px solid #F1F5F9' }}>
              {granolaNote}
            </div>
          )}
          {rangeMeetings.length === 0 ? (
            <div style={{ padding: '0.8rem 0.9rem', fontSize: '0.8rem', color: '#94A3B8', fontStyle: 'italic' }}>
              {meetingRange.key === 'today'
                ? 'No meetings scheduled for today.'
                : `No meetings ${rangeName}.`}
            </div>
          ) : (
            <div>
              {meetingDayGroups.map(group => (
              <div key={group.dayStart}>
              {/* A day heading only earns its row once the panel covers
                  more than one day. */}
              {meetingRange.key !== 'today' && (
                <div style={{ padding: '0.35rem 0.9rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #F1F5F9', fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span>{fmtDayHeading(group.dayStart)}</span>
                  <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>
                    {group.meetings.length} meeting{group.meetings.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {group.meetings.map((m, i) => (
                <div key={m.id || `${group.dayStart}-${i}`} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 260px', gap: '0.75rem', padding: '0.55rem 0.9rem', borderBottom: i < group.meetings.length - 1 ? '1px solid #F1F5F9' : 'none', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMeetingTime(m._meetingStart, m._meetingEnd, m._allDay)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                      {(m._sources?.length ? m._sources : [m._source]).map((src) => {
                        const badge = SOURCE_BADGES[src] || SOURCE_BADGES.hubspot;
                        return (
                          <span key={src} style={{ display: 'inline-block', fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 999, color: badge.color, background: badge.background, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {badge.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m._subject}>
                      {m._subject || 'Meeting'}
                    </div>
                    {m._location && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m._location}>{m._location}</div>
                    )}
                    {m._company && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{m._company}</div>
                    )}
                    {m._granolaUrl && (
                      <a
                        href={m._granolaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={m._granolaSummary ? m._granolaSummary.slice(0, 400) : 'Open this meeting’s notes in Granola'}
                        style={{ display: 'inline-block', marginTop: 2, fontSize: '0.68rem', fontWeight: 600, color: '#B45309' }}
                      >Granola notes ↗</a>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#334155' }}>
                    {m._attendeeDetails && m._attendeeDetails.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {m._attendeeDetails.filter(a => !a.email?.toLowerCase().endsWith('@se.com')).map((a, j) => (
                          <div key={j} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${a.name} <${a.email}> · ${a.response || 'no response'}`}>
                            <span style={{ fontWeight: 600 }}>{a.name || a.email}</span>
                            {a.name && a.email && <span style={{ color: '#94A3B8', marginLeft: 4 }}>{a.email}</span>}
                          </div>
                        ))}
                        {m._attendeeDetails.filter(a => !a.email?.toLowerCase().endsWith('@se.com')).length === 0 && (
                          <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Internal only</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m._attendees}>
                        {m._attendees || (
                          <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>
                            {m._internalOnly ? 'Internal only' : 'No attendees'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-tab bar — same look as the contacts page subtabs. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', margin: '0.25rem 0 0.6rem' }}>
        {[
          { key: 'all', label: 'All Activity', count: allActivities.length },
          { key: 'todayOutbound', label: "Today's Outbound", count: todayOutbound.length },
        ].map(t => {
          const isActive = subtab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubtab(t.key)}
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

      {/* What this tab has banked for the Weekly Report. The tile there
          reads these totals when the raw feed is gone, so showing them
          here is how you can tell the week was actually recorded. */}
      <div className={styles.weekRecord}>
        <strong>This week:</strong>{' '}
        {recorded.thisWeek
          ? `${recorded.thisWeek.emails} email${recorded.thisWeek.emails === 1 ? '' : 's'} to contacts outside @se.com`
          : 'not recorded yet — waiting on the HubSpot feed'}
        {recorded.lastWeek ? ` · last week: ${recorded.lastWeek.emails}` : ''}
        <span className={styles.weekRecordNote}>
          {' '}Recorded for the Weekly Report&rsquo;s &ldquo;Emails sent&rdquo; tile.
          {!String(settings?.workEmail || '').trim() && ' Set your work email in Settings \u2192 CDM Name so this counts only your own sends.'}
        </span>
      </div>

      {subtab === 'all' && (
        <div className={styles.summary}>
          <button className={`${styles.summaryCard} ${typeFilter === null ? styles.summaryCardActive : ''}`} onClick={() => setTypeFilter(null)}>
            <div className={styles.summaryLabel}>All Activity</div>
            <div className={styles.summaryValue}>{allActivities.length}</div>
          </button>
          <button className={`${styles.summaryCard} ${typeFilter === 'email' ? styles.summaryCardActive : ''}`} onClick={() => setTypeFilter(typeFilter === 'email' ? null : 'email')} style={{ borderLeftColor: '#3B7DDD' }}>
            <div className={styles.summaryLabel}>Emails</div>
            <div className={styles.summaryValue}>{emailCount}</div>
          </button>
          <button className={`${styles.summaryCard} ${typeFilter === 'call' ? styles.summaryCardActive : ''}`} onClick={() => setTypeFilter(typeFilter === 'call' ? null : 'call')} style={{ borderLeftColor: '#059669' }}>
            <div className={styles.summaryLabel}>Calls</div>
            <div className={styles.summaryValue}>{callCount}</div>
          </button>
          <button className={`${styles.summaryCard} ${typeFilter === 'meeting' ? styles.summaryCardActive : ''}`} onClick={() => setTypeFilter(typeFilter === 'meeting' ? null : 'meeting')} style={{ borderLeftColor: '#7C3AED' }}>
            <div className={styles.summaryLabel}>Meetings</div>
            <div className={styles.summaryValue}>{meetingCount}</div>
          </button>
        </div>
      )}

      <div className={styles.filterRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={subtab === 'todayOutbound' ? "Search today's outbound..." : 'Search activity...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>
          {subtab === 'todayOutbound'
            ? `${filteredTodayOutbound.length} of ${todayOutbound.length}`
            : `${filtered.length} of ${allActivities.length}`}
        </span>
      </div>

      {loading && progress && (
        <div className={styles.progressBar}>
          Loading all history: {progress.email} emails, {progress.call} calls, {progress.meeting} meetings...
        </div>
      )}
      {loading && !data ? (
        <div className={styles.loading}>Loading activity from HubSpot...</div>
      ) : subtab === 'todayOutbound' ? (
        <DataTable
          tableId="activity-today-outbound"
          columns={todayOutboundColumns}
          rows={filteredTodayOutbound}
          alwaysVisible={[]}
          emptyMessage={oppsRecords?.length ? 'No outbound emails or calls to external contacts yet today.' : 'No outbound emails or calls to external contacts yet today. (Active opp lookup needs the Opps tab cache: visit it once if the column shows blank.)'}
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : (
        <DataTable
          tableId="activity"
          columns={columns}
          rows={filtered}
          alwaysVisible={[]}
          emptyMessage="No activity found"
          settings={settings}
          updateSettings={updateSettings}
        />
      )}

      {/* Contact popup */}
      {contactPopup && (
        <div className={styles.popupOverlay} onClick={() => setContactPopup(null)}>
          <div className={styles.popupCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Contact Details</h3>
              <button onClick={() => setContactPopup(null)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>&times;</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>First Name
                <input value={contactPopup.firstname} onChange={e => setContactPopup(p => ({ ...p, firstname: e.target.value }))} style={{ display: 'block', width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '0.15rem' }} />
              </label>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Last Name
                <input value={contactPopup.lastname} onChange={e => setContactPopup(p => ({ ...p, lastname: e.target.value }))} style={{ display: 'block', width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '0.15rem' }} />
              </label>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Email
                <input value={contactPopup.email} onChange={e => setContactPopup(p => ({ ...p, email: e.target.value }))} style={{ display: 'block', width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '0.15rem' }} />
              </label>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Company
                <input value={contactPopup.company} onChange={e => setContactPopup(p => ({ ...p, company: e.target.value }))} style={{ display: 'block', width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '0.15rem' }} />
              </label>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Phone
                <input value={contactPopup.phone} onChange={e => setContactPopup(p => ({ ...p, phone: e.target.value }))} style={{ display: 'block', width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: '0.15rem' }} />
              </label>
            </div>

            {contactPopup.existsInHubSpot ? (
              <div style={{ padding: '0.5rem 0.75rem', background: '#DCFCE7', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600, color: '#166534', marginBottom: '0.5rem' }}>
                ✓ Already in HubSpot
              </div>
            ) : addResult === 'success' ? (
              <div style={{ padding: '0.5rem 0.75rem', background: '#DCFCE7', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600, color: '#166534', marginBottom: '0.5rem' }}>
                ✓ Added to HubSpot!
              </div>
            ) : (
              <>
                {addResult && addResult !== 'success' && (
                  <div style={{ padding: '0.4rem 0.75rem', background: '#FEE2E2', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: '#991B1B', marginBottom: '0.5rem' }}>
                    {addResult}
                  </div>
                )}
                <button
                  onClick={handleAddToHubSpot}
                  disabled={addingContact || !contactPopup.email}
                  style={{ width: '100%', padding: '0.55rem', border: 'none', borderRadius: 'var(--radius-md)', background: contactPopup.email ? '#FF7A59' : '#E2E8F0', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: contactPopup.email ? 'pointer' : 'default', fontFamily: 'inherit' }}
                >
                  {addingContact ? 'Adding...' : '+ Add to HubSpot'}
                </button>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              {contactPopup.email && (
                <button onClick={() => {
                  const subject = encodeURIComponent(`Follow up: ${contactPopup.company || ''}`);
                  const body = encodeURIComponent(`Hi ${contactPopup.firstname},\n\n`);
                  window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(contactPopup.email)}&subject=${subject}&body=${body}`, '_blank');
                }} style={{ flex: 1, padding: '0.4rem', border: '1px solid #0078D4', borderRadius: 'var(--radius-sm)', background: '#EFF6FF', color: '#0078D4', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✉ Draft Email
                </button>
              )}
              <button onClick={() => setContactPopup(null)} style={{ flex: 1, padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
