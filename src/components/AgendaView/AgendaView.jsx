import { useMemo, useState, useEffect } from 'react';
import { parseOutlookAgenda, durationMinutes } from '../../utils/parseOutlookAgenda';
import styles from './AgendaView.module.css';

const STORAGE_KEY = 'agenda-paste-cache';

function todayLabel() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function saveCache(entry) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entry)); } catch { /* ignore quota errors */ }
}

function buildDomainMap(prospects) {
  const map = new Map();
  for (const p of prospects || []) {
    const domains = [];
    if (p.emailDomain) {
      p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean).forEach(entry => {
        const at = entry.lastIndexOf('@');
        domains.push((at >= 0 ? entry.slice(at + 1) : entry).toLowerCase());
      });
    }
    if (p.website) {
      const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
      if (d) domains.push(d);
    }
    for (const d of domains) { if (d && p.company) map.set(d, p); }
  }
  return map;
}

function matchProspect(meeting, domainMap, hubspotByEmail, prospectsByName) {
  for (const att of meeting.attendees) {
    const emailMatch = att.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      if (email.endsWith('@se.com')) continue;
      const hs = hubspotByEmail.get(email);
      if (hs?.company) {
        const p = prospectsByName.get(hs.company.toLowerCase());
        if (p) return p;
      }
      const domain = email.split('@')[1];
      if (domain && domainMap.has(domain)) return domainMap.get(domain);
    }
  }
  // Try subject/location fuzzy match against company names
  const hay = [meeting.subject, meeting.location].filter(Boolean).join(' ').toLowerCase();
  for (const [name, p] of prospectsByName) {
    if (name.length >= 4 && hay.includes(name)) return p;
  }
  return null;
}

export function AgendaView({ prospects = [], onSelectProspect }) {
  const cached = useMemo(() => loadCache(), []);
  const [input, setInput] = useState(cached?.text || '');
  const [pastedAt, setPastedAt] = useState(cached?.pastedAt || null);
  const [copied, setCopied] = useState(null);
  const [allCopied, setAllCopied] = useState(false);

  const meetings = useMemo(() => parseOutlookAgenda(input), [input]);

  useEffect(() => {
    if (!input.trim()) return;
    saveCache({ text: input, pastedAt: pastedAt || new Date().toISOString() });
  }, [input, pastedAt]);

  const domainMap = useMemo(() => buildDomainMap(prospects), [prospects]);
  const prospectsByName = useMemo(() => {
    const m = new Map();
    for (const p of prospects) { if (p.company) m.set(p.company.toLowerCase(), p); }
    return m;
  }, [prospects]);
  const hubspotByEmail = useMemo(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      const m = new Map();
      for (const c of (cache?.contacts || [])) {
        if (c.email) m.set(c.email.toLowerCase(), c);
      }
      return m;
    } catch { return new Map(); }
  }, []);

  const enriched = useMemo(() =>
    meetings.map(m => ({ ...m, matchedProspect: matchProspect(m, domainMap, hubspotByEmail, prospectsByName) })),
    [meetings, domainMap, hubspotByEmail, prospectsByName]);

  function handlePaste(text) {
    setInput(text);
    setPastedAt(new Date().toISOString());
  }

  function handleClear() {
    if (!input && !pastedAt) return;
    if (!confirm('Clear the pasted agenda?')) return;
    setInput('');
    setPastedAt(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  function copyAttendee(text, key) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const totalMinutes = enriched.reduce((s, m) => s + (durationMinutes(m) || 0), 0);
  const matchedCount = enriched.filter(m => m.matchedProspect).length;

  const externalEmails = useMemo(() => {
    const set = new Set();
    const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    for (const m of enriched) {
      for (const att of m.attendees) {
        const matches = att.match(EMAIL_RE) || [];
        for (const e of matches) {
          const lower = e.toLowerCase();
          if (!lower.endsWith('@se.com')) set.add(lower);
        }
      }
    }
    return Array.from(set);
  }, [enriched]);

  function copyAllEmails() {
    if (externalEmails.length === 0) return;
    navigator.clipboard?.writeText(externalEmails.join('; ')).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1800);
    });
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Daily Agenda</h2>
          <div className={styles.subtitle}>
            {pastedAt
              ? `Pasted ${new Date(pastedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : todayLabel()}
          </div>
        </div>
        <div className={styles.headerActions}>
          {input && <button className={styles.secondaryBtn} onClick={handleClear}>Clear</button>}
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.pasteSection}>
          <label className={styles.label} htmlFor="agenda-paste">
            Paste your Outlook day view or daily agenda email here
          </label>
          <textarea
            id="agenda-paste"
            className={styles.textarea}
            value={input}
            onChange={e => handlePaste(e.target.value)}
            placeholder={'Ctrl+A, Ctrl+C your Outlook day view, then paste here.\n\nExample:\n9:00 AM – 9:30 AM\nWeekly sales sync\nMicrosoft Teams Meeting\njane@acme.com; john@acme.com'}
            spellCheck={false}
          />
          <div className={styles.hint}>
            Open Outlook in day view → <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd> → paste here.
          </div>
        </section>

        <section className={styles.resultSection}>
          <div className={styles.summary}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Meetings</div>
              <div className={styles.summaryValue}>{enriched.length}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Total time</div>
              <div className={styles.summaryValue}>{formatTotal(totalMinutes)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Matched prospects</div>
              <div className={styles.summaryValue}>{matchedCount}</div>
            </div>
            <button
              type="button"
              className={styles.summaryCardAction}
              onClick={copyAllEmails}
              disabled={externalEmails.length === 0}
              title={externalEmails.length ? 'Copy all external attendee emails (semicolon-separated)' : 'No external attendees to copy'}
            >
              <div className={styles.summaryLabel}>
                {allCopied ? 'Copied!' : 'Copy external emails'}
              </div>
              <div className={styles.summaryValue}>{externalEmails.length}</div>
            </button>
          </div>

          {enriched.length === 0 ? (
            <div className={styles.empty}>
              {input.trim()
                ? 'No meetings detected. The parser looks for time ranges like "9:00 AM – 10:00 AM".'
                : 'Paste your Outlook agenda above to see your meetings parsed and matched to prospects.'}
            </div>
          ) : (
            <ul className={styles.list}>
              {enriched.map((m, i) => (
                <li key={i} className={styles.card}>
                  <div className={styles.cardTime}>
                    <div className={styles.timeRange}>{m.start}{m.end ? ` – ${m.end}` : ''}</div>
                    <div className={styles.duration}>{formatDuration(durationMinutes(m))}</div>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.subjectRow}>
                      <span className={styles.subject}>{m.subject}</span>
                      {m.matchedProspect && (
                        <button
                          className={styles.prospectChip}
                          onClick={() => onSelectProspect?.(m.matchedProspect)}
                          title="Open prospect"
                        >
                          {m.matchedProspect.company}
                        </button>
                      )}
                    </div>
                    {m.location && <div className={styles.location}>{m.location}</div>}
                    {m.attendees.length > 0 && (
                      <div className={styles.attendees}>
                        {m.attendees.map((a, j) => {
                          const key = `${i}-${j}`;
                          return (
                            <button
                              key={key}
                              className={styles.attendee}
                              onClick={() => copyAttendee(a, key)}
                              title="Click to copy"
                            >
                              {copied === key ? 'Copied' : a}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {m.body && <div className={styles.notes}>{m.body}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDuration(min) {
  if (min == null) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatTotal(min) {
  if (!min) return '0h';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
