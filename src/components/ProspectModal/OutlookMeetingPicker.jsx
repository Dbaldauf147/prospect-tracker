import { useEffect, useMemo, useState } from 'react';
import { secureGet, secureSet } from '../../utils/secureStorage';

// Pulls last 7d + today + next 7d. Tweak here if the user later wants
// a different window — kept narrow on purpose so the list stays scannable.
const START_DAYS = -7;
const END_DAYS = 7;

function formatRange(start, end) {
  if (!start) return '';
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return '';
  const dayLabel = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!end) return `${dayLabel} · ${time}`;
  const e = new Date(end);
  const endTime = Number.isNaN(e.getTime()) ? '' : e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} · ${time}${endTime ? `–${endTime}` : ''}`;
}

function durationMinutes(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

// Convert a Microsoft Graph event into the same shape the .ics parser
// produces, so all downstream code (attendee bucketing, agenda etc.)
// works unchanged.
function eventToMeeting(event) {
  return {
    subject: event.subject || '',
    start: event.start || null,
    end: event.end || null,
    durationMinutes: durationMinutes(event.start, event.end),
    location: event.location || '',
    organizer: event.organizer
      ? { name: event.organizer.name || '', email: event.organizer.email || '' }
      : null,
    attendees: (event.attendees || []).map(a => ({
      name: a.name || '',
      email: a.email || '',
      // Graph 'type' maps directly to the ICS notion of required/optional
      required: a.type !== 'optional',
      role: a.type || '',
      rawParams: { source: 'graph', response: a.response || '' },
    })),
    manualAttendees: [],
    sourceTimeZone: null,
  };
}

// Best-effort domain extraction from "https://acme.com/path" or "acme.com".
function domainOf(url) {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

export function OutlookMeetingPicker({ open, onClose, onPick, companyName, companyDomain }) {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'auth' | 'loading' | 'ready' | 'error'
  const [events, setEvents] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setErrorMsg('');
    let cancelled = false;

    async function load() {
      const token = await secureGet('outlook-access-token');
      const expiry = await secureGet('outlook-token-expiry');
      const live = !!token && (!expiry || Date.now() < Number(expiry));
      if (!live) { setPhase('auth'); return; }

      setPhase('loading');
      try {
        const r = await fetch(`/api/outlook-calendar?startDays=${START_DAYS}&endDays=${END_DAYS}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 401) { setPhase('auth'); return; }
        if (!r.ok) {
          const body = await r.text();
          if (!cancelled) { setErrorMsg(body || `HTTP ${r.status}`); setPhase('error'); }
          return;
        }
        const data = await r.json();
        if (!cancelled) {
          setEvents(data.events || []);
          setPhase('ready');
        }
      } catch (err) {
        if (!cancelled) { setErrorMsg(err.message || String(err)); setPhase('error'); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open]);

  // Listen for the auth popup's success message (same protocol DraftEmailView uses).
  useEffect(() => {
    if (!open) return;
    function onMessage(e) {
      if (e.data?.type === 'outlook-auth-success') {
        (async () => {
          await secureSet('outlook-access-token', e.data.accessToken);
          if (e.data.refreshToken) await secureSet('outlook-refresh-token', e.data.refreshToken);
          await secureSet('outlook-token-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
          // Trigger a reload by re-running the effect.
          setPhase('idle');
          setTimeout(() => setPhase((p) => p === 'idle' ? 'idle' : p), 0);
          // Cheap way to retrigger: bump a state that forces the load() to run.
          // Easier: just call the load logic inline.
          const token = e.data.accessToken;
          setPhase('loading');
          try {
            const r = await fetch(`/api/outlook-calendar?startDays=${START_DAYS}&endDays=${END_DAYS}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) { setErrorMsg(await r.text()); setPhase('error'); return; }
            const data = await r.json();
            setEvents(data.events || []);
            setPhase('ready');
          } catch (err) {
            setErrorMsg(err.message || String(err));
            setPhase('error');
          }
        })();
      } else if (e.data?.type === 'outlook-auth-error') {
        setErrorMsg(e.data.error || 'Sign-in failed');
        setPhase('error');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  function startAuth() {
    window.open('/api/outlook-auth', 'outlook-auth', 'width=500,height=700,left=200,top=100');
  }

  // Sort: company-matching meetings first, then by start time (newest first
  // so a meeting that just ended is at top — that's the most common
  // "write notes for X" case).
  const targetDomain = useMemo(() => domainOf(companyDomain || ''), [companyDomain]);
  const targetCompanyLower = (companyName || '').toLowerCase().trim();

  function eventMatchesCompany(ev) {
    if (!ev) return false;
    if (targetDomain) {
      for (const a of ev.attendees || []) {
        const em = (a.email || '').toLowerCase();
        if (em && em.endsWith('@' + targetDomain)) return true;
      }
    }
    if (targetCompanyLower) {
      const subj = (ev.subject || '').toLowerCase();
      if (subj.includes(targetCompanyLower)) return true;
    }
    return false;
  }

  const sortedEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? events.filter(ev => (ev.subject || '').toLowerCase().includes(q)
          || (ev.attendees || []).some(a => (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q)))
      : events;
    return [...filtered].sort((a, b) => {
      const am = eventMatchesCompany(a) ? 1 : 0;
      const bm = eventMatchesCompany(b) ? 1 : 0;
      if (am !== bm) return bm - am;
      // Newer first within each group
      return new Date(b.start || 0).getTime() - new Date(a.start || 0).getTime();
    });
  }, [events, search, targetDomain, targetCompanyLower]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 11000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: 'min(640px, 92vw)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Pick a meeting from Outlook</h3>
          <span style={{ fontSize: '0.7rem', color: '#64748B' }}>last 7 days · next 7 days</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
          >Close</button>
        </div>

        {phase === 'auth' && (
          <div style={{ padding: '1.5rem 1.25rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: 0 }}>
              Sign in to your Outlook account to pull your calendar. Same connection the email-draft feature uses; no data leaves your tracker.
            </p>
            <button
              onClick={startAuth}
              style={{ padding: '0.5rem 1rem', border: 'none', background: '#0078D4', color: '#fff', borderRadius: 6, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >Connect Outlook</button>
          </div>
        )}

        {phase === 'loading' && (
          <div style={{ padding: '1.5rem 1.25rem', textAlign: 'center', color: '#64748B' }}>Loading meetings…</div>
        )}

        {phase === 'error' && (
          <div style={{ padding: '1.25rem' }}>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '0.6rem 0.8rem', borderRadius: 6, fontSize: '0.78rem' }}>
              Couldn&apos;t load meetings: {errorMsg || 'unknown error'}
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                onClick={startAuth}
                style={{ padding: '0.4rem 0.85rem', border: '1px solid #CBD5E1', background: '#fff', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Reconnect</button>
            </div>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div style={{ padding: '0.6rem 1.1rem', borderBottom: '1px solid #F1F5F9' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by subject or attendee…"
                autoFocus
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ overflow: 'auto', padding: '0.25rem 0' }}>
              {sortedEvents.length === 0 ? (
                <div style={{ padding: '1.25rem', color: '#64748B', textAlign: 'center', fontSize: '0.8rem' }}>
                  No meetings in this window.
                </div>
              ) : sortedEvents.map(ev => {
                const matches = eventMatchesCompany(ev);
                return (
                  <button
                    key={ev.id}
                    onClick={() => { onPick(eventToMeeting(ev)); onClose(); }}
                    style={{
                      width: '100%', textAlign: 'left', display: 'block',
                      padding: '0.6rem 1.1rem', border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      fontFamily: 'inherit', borderBottom: '1px solid #F1F5F9',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1E293B' }}>{ev.subject || '(No subject)'}</span>
                      {matches && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#DCFCE7', color: '#166534' }}>
                          this company
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
                      {formatRange(ev.start, ev.end)}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </div>
                    {(ev.attendees || []).length > 0 && (
                      <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(ev.attendees || []).map(a => a.name || a.email).filter(Boolean).slice(0, 5).join(', ')}
                        {(ev.attendees || []).length > 5 ? `, +${ev.attendees.length - 5} more` : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
