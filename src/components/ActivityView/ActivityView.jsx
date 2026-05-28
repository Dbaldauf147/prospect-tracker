import { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { DataTable } from '../common/DataTable';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { useOppsRecords } from '../KeyContactsView/KeyContactsView';
import styles from './ActivityView.module.css';

const CACHE_KEY = 'hubspot-activity-cache';

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
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    // Notify in-tab consumers (e.g. the Last Outreach column on
    // KeyContactsView) since the `storage` event only fires across tabs.
    window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
  } catch (err) { console.warn('ActivityView cache write skipped (quota):', err?.message || err); }
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

function fmtDuration(ms) {
  if (!ms) return '—';
  const sec = Math.round(parseInt(ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

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

  async function fetchAllPages(type) {
    const all = [];
    let after = '';
    while (true) {
      const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${after}` : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      all.push(...(json.results || []));
      setProgress(prev => ({ ...prev, [type]: all.length }));
      if (json.nextAfter) {
        after = json.nextAfter;
      } else {
        break;
      }
      // Safety limit
      if (all.length > 5000) break;
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
      const res = await fetch('/api/hubspot?action=create-contact', {
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

  const allActivities = useMemo(() => {
    if (!data) return [];
    // Filter out sample emails only — keep all real emails
    const filteredEmails = (data.emails || []).filter(e => {
      const subject = (e.hs_email_subject || '').toLowerCase();
      if (subject.includes('(sample email)')) return false;
      return true;
    });
    const combined = [
      ...filteredEmails.map(e => {
        // Determine direction: anything from @se.com (all SE users share
        // the domain) or the current user's configured work email is
        // outbound; everything else with a sender is inbound.
        const from = (e.hs_email_from_email || '').toLowerCase();
        const workEmail = (settings?.workEmail || '').toLowerCase();
        const direction = from.includes('@se.com') || (workEmail && from === workEmail)
          ? 'Outbound'
          : from ? 'Inbound' : e.hs_email_direction || '';
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
          _direction: direction,
          _status: e.hs_email_status || '',
          _duration: null,
          _company: guessCompanyFromEmails(e.hs_email_to_email, e.hs_email_from_email),
          _phone: emailPhone,
        };
      }),
      ...(data.calls || []).map(c => {
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
      ...(data.meetings || []).map(m => {
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
  }, [data, settings?.workEmail]);

  const emailCount = allActivities.filter(a => a._type === 'email').length;
  const callCount = allActivities.filter(a => a._type === 'call').length;
  const meetingCount = allActivities.filter(a => a._type === 'meeting').length;

  const hubspotTodaysMeetings = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    return allActivities
      .filter(a => a._type === 'meeting' && a._meetingStart)
      .filter(a => {
        const t = new Date(a._meetingStart).getTime();
        return Number.isFinite(t) && t >= todayStart && t < todayEnd;
      })
      .map(a => ({ ...a, _source: 'hubspot' }))
      .sort((a, b) => new Date(a._meetingStart) - new Date(b._meetingStart));
  }, [allActivities]);

  // ── Outlook Calendar via Power Automate webhook ──
  // Power Automate pushes meetings to /api/calendar-webhook?token=xxx,
  // which writes to Firestore calendarWebhook/{token}. We listen in real time.
  const [outlookEvents, setOutlookEvents] = useState([]);
  const [outlookError, setOutlookError] = useState(null);
  const [showWebhookSetup, setShowWebhookSetup] = useState(false);

  const webhookStorageKey = 'outlook-webhook-token';
  const savedWebhookToken = (() => { try { return localStorage.getItem(webhookStorageKey) || ''; } catch { return ''; } })();
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
      try { localStorage.setItem(webhookStorageKey, token); } catch {}
      setWebhookToken(token);
    }
    setShowWebhookSetup(true);
  }

  function removeWebhook() {
    if (!window.confirm('Disconnect Outlook calendar? Your Power Automate flow will keep running but meetings will stop showing here.')) return;
    try { localStorage.removeItem(webhookStorageKey); } catch {}
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
        // Filter to today only (Power Automate might send multi-day data)
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todayEnd = todayStart + 24 * 60 * 60 * 1000;
        const events = data.meetings
          .filter(m => {
            const t = new Date(m.start).getTime();
            return Number.isFinite(t) && t >= todayStart && t < todayEnd;
          })
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

  // Merge HubSpot + Outlook meetings for Today panel, sorted by start time
  const todaysMeetings = useMemo(() => {
    const combined = [...hubspotTodaysMeetings, ...outlookEvents];
    combined.sort((a, b) => new Date(a._meetingStart || 0) - new Date(b._meetingStart || 0));
    return combined;
  }, [hubspotTodaysMeetings, outlookEvents]);

  function fmtMeetingTime(startStr, endStr) {
    if (!startStr) return '—';
    const start = new Date(startStr);
    if (isNaN(start)) return '—';
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
        [a._subject, a._to, a._toName, a._from, a._fromName, a._status, a._company]
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
        if (externals.length === 0) continue;
        recipients = externals
          .map(em => recipientFor(em, a._toName))
          .filter(Boolean);
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
    { key: '_company', label: 'Company', defaultWidth: 160, render: (a) => a._company ? <span style={{ fontWeight: 600 }}>{a._company}</span> : <span className={styles.metaText}>—</span> },
    { key: '_subject', label: 'Subject / Title', defaultWidth: 260, render: (a) => <span className={styles.subject}>{a._subject || '—'}</span> },
    { key: '_externalTo', label: 'To (external)', defaultWidth: 280, render: (a) => {
      const recipients = a._recipients || [];
      if (recipients.length === 0) return <span className={styles.metaText}>—</span>;
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
      if (!opp) return <span className={styles.metaText}>—</span>;
      const stage = String(opp.Stage || '').trim();
      const tooltip = a._matchedEmail
        ? `Matched via Opp Contact = ${a._matchedEmail}`
        : `Matched by company / domain fallback`;
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, lineHeight: 1.25, maxWidth: '100%' }} title={tooltip}>
          <span style={{ fontWeight: 600 }}>{opp.Account || '—'}</span>
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
      if (!bfo) return <span className={styles.metaText}>—</span>;
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
      if (!opp) return <span className={styles.metaText}>—</span>;
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
      if (!addr) return <span className={styles.metaText}>—</span>;
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
    { key: '_direction', label: 'Direction', defaultWidth: 80, render: (a) => a._direction ? <span className={styles.directionBadge}>{a._direction}</span> : <span className={styles.metaText}>—</span> },
    { key: '_timestamp', label: 'Date', defaultWidth: 140, render: (a) => <span className={styles.dateText}>{fmtDateTime(a._timestamp)}</span> },
    { key: '_company', label: 'Company', defaultWidth: 160, render: (a) => a._company ? <span style={{ fontWeight: 600 }}>{a._company}</span> : <span className={styles.metaText}>—</span> },
    { key: '_subject', label: 'Subject / Title', defaultWidth: 250, render: (a) => <span className={styles.subject}>{a._subject || '—'}</span> },
    { key: '_to', label: 'To', defaultWidth: 200, render: (a) => a._toName ? <span><button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup(a._toName, a._to, a._company, a._phone); }}>{a._toName}</button> <span className={styles.metaText}>{a._to}</span></span> : a._to ? <button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup('', a._to, a._company, a._phone); }}>{a._to}</button> : <span className={styles.metaText}>—</span> },
    { key: '_from', label: 'From', defaultWidth: 200, render: (a) => a._fromName ? <span><button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup(a._fromName, a._from, a._company, ''); }}>{a._fromName}</button> <span className={styles.metaText}>{a._from}</span></span> : a._from ? <button className={styles.contactLink} onClick={e => { e.stopPropagation(); openContactPopup('', a._from, a._company, ''); }}>{a._from}</button> : <span className={styles.metaText}>—</span> },
    { key: '_attendees', label: 'Attendees', defaultWidth: 200, render: (a) => a._attendees ? <span className={styles.contactText}>{a._attendees}</span> : <span className={styles.metaText}>—</span> },
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

      {data && (
        <div style={{ marginBottom: '1rem', border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: '0.6rem 0.9rem', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-text)' }}>
              Today's Meetings
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{todaysMeetings.length} meeting{todaysMeetings.length === 1 ? '' : 's'}</span>
              {!hasWebhookToken ? (
                <button
                  onClick={setupWebhook}
                  style={{ padding: '0.25rem 0.6rem', border: '1px solid #0078D4', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >+ Outlook Calendar</button>
              ) : (
                <>
                  <button
                    onClick={setupWebhook}
                    title="View Power Automate setup instructions"
                    style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: 'var(--color-text)', fontSize: '0.68rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                  >⚙ Outlook Setup</button>
                  <button
                    onClick={removeWebhook}
                    title="Disconnect Outlook calendar"
                    style={{ padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >×</button>
                </>
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
          {outlookError && (
            <div style={{ padding: '0.4rem 0.9rem', background: '#FEF2F2', color: '#991B1B', fontSize: '0.75rem', borderBottom: '1px solid #FCA5A5' }}>
              {outlookError}
            </div>
          )}
          {todaysMeetings.length === 0 ? (
            <div style={{ padding: '0.8rem 0.9rem', fontSize: '0.8rem', color: '#94A3B8', fontStyle: 'italic' }}>
              No meetings scheduled for today.
            </div>
          ) : (
            <div>
              {todaysMeetings.map((m, i) => (
                <div key={m.id || `m${i}`} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 260px', gap: '0.75rem', padding: '0.55rem 0.9rem', borderBottom: i < todaysMeetings.length - 1 ? '1px solid #F1F5F9' : 'none', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMeetingTime(m._meetingStart, m._meetingEnd)}
                    </div>
                    <span style={{ display: 'inline-block', marginTop: 2, fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: 999, color: m._source === 'outlook' ? '#0078D4' : '#7C3AED', background: m._source === 'outlook' ? '#E8F4FD' : '#F3E8FF', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {m._source === 'outlook' ? 'Outlook' : 'HubSpot'}
                    </span>
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
                        {m._attendees || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No attendees</span>}
                      </div>
                    )}
                  </div>
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
          emptyMessage={oppsRecords?.length ? 'No outbound emails or calls to external contacts yet today.' : 'No outbound emails or calls to external contacts yet today. (Active opp lookup needs the Opps tab cache — visit it once if the column shows blank.)'}
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
                  const subject = encodeURIComponent(`Follow up — ${contactPopup.company || ''}`);
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
