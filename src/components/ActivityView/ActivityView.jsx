import { useState, useEffect, useMemo, useCallback } from 'react';
import { DataTable } from '../common/DataTable';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import styles from './ActivityView.module.css';

const CACHE_KEY = 'hubspot-activity-cache';

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function saveCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (err) { console.warn('ActivityView cache write skipped (quota):', err?.message || err); } }

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

export function ActivityView({ prospects = [] }) {
  const { user } = useAuth();
  const [data, setData] = useState(loadCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [contactPopup, setContactPopup] = useState(null); // { name, email, company, phone }
  const [addingContact, setAddingContact] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [progress, setProgress] = useState(null); // { emails, calls, meetings }

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
    const STALE_MS = 30 * 60 * 1000; // 30 min stale for full history
    const isStale = !data?.fetchedAt || (Date.now() - new Date(data.fetchedAt).getTime()) > STALE_MS;
    if (isStale) fetchActivity();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchActivity, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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

  // Also load HubSpot contacts cache for email→company matching
  const hubspotContacts = useMemo(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      const map = new Map();
      for (const c of (cache?.contacts || [])) {
        if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
      }
      return map;
    } catch { return new Map(); }
  }, []);

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
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      return (cache?.contacts || []).some(c => c.email && c.email.toLowerCase() === email.toLowerCase());
    } catch { return false; }
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
          const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
          if (cache?.contacts) {
            cache.contacts.push(data.contact);
            localStorage.setItem('hubspot-sync-cache', JSON.stringify(cache));
          }
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
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      for (const c of (cache?.contacts || [])) {
        if (c.id) map.set(c.id, c);
      }
    } catch {}
    return map;
  }, []);

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
        // Determine direction: if from is @se.com, it's outbound
        const from = (e.hs_email_from_email || '').toLowerCase();
        const direction = from.includes('@se.com') || from.includes('daniel.baldauf') ? 'Outbound' : from ? 'Inbound' : e.hs_email_direction || '';
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
  }, [data]);

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

  // ── Outlook Calendar via ICS feed (no OAuth — user pastes their private ICS URL) ──
  const [outlookEvents, setOutlookEvents] = useState([]);
  const [outlookLoading, setOutlookLoading] = useState(false);
  const [outlookError, setOutlookError] = useState(null);
  const [showIcsInput, setShowIcsInput] = useState(false);
  const [icsUrlDraft, setIcsUrlDraft] = useState('');

  // Load saved ICS URL from localStorage (per-user key)
  const icsStorageKey = 'outlook-ics-url';
  const savedIcsUrl = (() => { try { return localStorage.getItem(icsStorageKey) || ''; } catch { return ''; } })();
  const hasIcsUrl = !!savedIcsUrl;

  const fetchIcsCalendar = useCallback(async (urlOverride) => {
    const url = urlOverride || savedIcsUrl;
    if (!url) return;
    setOutlookLoading(true);
    setOutlookError(null);
    try {
      const resp = await fetch('/api/outlook-calendar-ics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icsUrl: url }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const normalized = (data.events || []).map(e => ({
        id: e.id,
        _type: 'meeting',
        _source: 'outlook',
        _subject: e.subject,
        _meetingStart: e.start,
        _meetingEnd: e.end,
        _attendees: (e.attendees || [])
          .filter(a => !a.email?.toLowerCase().endsWith('@se.com'))
          .map(a => a.name || a.email)
          .join(', '),
        _attendeeDetails: e.attendees || [],
        _location: e.location,
        _company: '',
      }));
      setOutlookEvents(normalized);
    } catch (err) {
      setOutlookError(err.message || 'Failed to fetch Outlook calendar');
    } finally {
      setOutlookLoading(false);
    }
  }, [savedIcsUrl]);

  function saveIcsUrl() {
    const url = icsUrlDraft.trim();
    if (!url.startsWith('https://')) {
      alert('Please paste a valid https:// ICS URL from Outlook.');
      return;
    }
    try { localStorage.setItem(icsStorageKey, url); } catch {}
    setShowIcsInput(false);
    fetchIcsCalendar(url);
  }

  function removeIcsUrl() {
    if (!window.confirm('Remove saved calendar link? Outlook meetings will stop showing until you paste a new one.')) return;
    try { localStorage.removeItem(icsStorageKey); } catch {}
    setOutlookEvents([]);
    setOutlookError(null);
  }

  // Auto-fetch on mount if ICS URL is saved
  useEffect(() => {
    if (savedIcsUrl) fetchIcsCalendar(savedIcsUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
              {!hasIcsUrl ? (
                <button
                  onClick={() => { setShowIcsInput(true); setIcsUrlDraft(''); }}
                  style={{ padding: '0.25rem 0.6rem', border: '1px solid #0078D4', borderRadius: 4, background: '#fff', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >+ Outlook Calendar</button>
              ) : (
                <>
                  <button
                    onClick={() => fetchIcsCalendar()}
                    disabled={outlookLoading}
                    style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: 'var(--color-text)', fontSize: '0.68rem', fontWeight: 500, cursor: outlookLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                  >{outlookLoading ? 'Loading…' : '↻ Outlook'}</button>
                  <button
                    onClick={removeIcsUrl}
                    title="Remove saved Outlook calendar link"
                    style={{ padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#94A3B8', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >×</button>
                </>
              )}
            </div>
          </div>
          {showIcsInput && (
            <div style={{ padding: '0.5rem 0.9rem', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                autoFocus
                value={icsUrlDraft}
                onChange={e => setIcsUrlDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveIcsUrl(); if (e.key === 'Escape') setShowIcsInput(false); }}
                placeholder="Paste your Outlook ICS calendar link (https://outlook.office365.com/owa/calendar/...)"
                style={{ flex: 1, padding: '0.35rem 0.5rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
              />
              <button
                onClick={saveIcsUrl}
                style={{ padding: '0.35rem 0.7rem', border: 'none', borderRadius: 4, background: '#0078D4', color: '#fff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >Save</button>
              <button
                onClick={() => setShowIcsInput(false)}
                style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#64748B', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Cancel</button>
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

      <div className={styles.filterRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search activity..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>{filtered.length} of {allActivities.length}</span>
      </div>

      {loading && progress && (
        <div className={styles.progressBar}>
          Loading all history: {progress.email} emails, {progress.call} calls, {progress.meeting} meetings...
        </div>
      )}
      {loading && !data ? (
        <div className={styles.loading}>Loading activity from HubSpot...</div>
      ) : (
        <DataTable
          tableId="activity"
          columns={columns}
          rows={filtered}
          alwaysVisible={[]}
          emptyMessage="No activity found"
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
