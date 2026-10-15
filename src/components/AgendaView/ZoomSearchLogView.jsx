// Bulk Add > Zoom Search Log. Paste a ZoomInfo Excel export, say what the
// search was (a Company Zoom ID pull, or a title pull for one tag with the
// titles typed in), and log it. The log then answers, per company, whether
// the company pull has been run and which title pulls have, for which tags.
//
// The paste also hands over each company's Zoom Company ID, so a Table View
// company that matches by name but has no ID yet can take it in one click.
//
// Parsing and the roll-up are in utils/zoomSearchLog.js. The log is a
// mirrored work key, so it follows the user between machines.
import { useEffect, useMemo, useState } from 'react';
import {
  ZOOM_SEARCH_LOG_KEY, SEARCH_TYPES, parseZoomPaste, splitTitles, readLog, makeSearch, companyLog, companyKey, buildProspectMatcher,
} from '../../utils/zoomSearchLog';
import { readWorkKey, writeWorkKey, ZOOM_SEARCH_LOG_EVENT } from '../../utils/mirroredWorkKeys';
import { resolveTitleSearches } from '../../data/contactTitleSearches';
import { tagMatrixColumns } from '../../utils/decisionMakerTagMatrix';
import { TAG_OPTIONS, tagKey } from '../../utils/contactTagReview';
import { getHubspotCache } from '../../utils/hubspotContactsCache';

const loadLog = () => readLog(readWorkKey(ZOOM_SEARCH_LOG_KEY));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.85rem 1rem', marginBottom: '0.9rem' };
const h3 = { margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' };
const label = { fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 };
const input = { padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box' };
const th = { textAlign: 'left', padding: '0.35rem 0.5rem', fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', position: 'sticky', top: 0 };
const td = { padding: '0.35rem 0.5rem', fontSize: '0.76rem', color: '#1E293B', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' };
const btn = (on = true) => ({
  padding: '0.35rem 0.8rem', borderRadius: 6, border: 'none', fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 700,
  background: on ? '#2563EB' : '#CBD5E1', color: '#fff', cursor: on ? 'pointer' : 'default',
});
const ghostBtn = { padding: '0.3rem 0.65rem', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' };
const pill = (on, color = '#2563EB') => ({
  padding: '0.25rem 0.7rem', borderRadius: 999, border: `1px solid ${on ? color : '#E2E8F0'}`, background: on ? `${color}14` : '#fff',
  color: on ? color : '#64748B', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
});

export function ZoomSearchLogView({ prospects = [], onUpdateProspect, settings }) {
  const [log, setLog] = useState(loadLog);
  useEffect(() => {
    const reload = () => setLog(loadLog());
    window.addEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
    return () => window.removeEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
  }, []);
  const saveLog = (next) => {
    setLog(next);
    try { writeWorkKey(ZOOM_SEARCH_LOG_KEY, JSON.stringify(next)); } catch { /* storage blocked: kept for this session */ }
  };

  // Tag choices: the vocabulary plus any tag a HubSpot contact carries, the
  // same list the DM Tags columns are built from.
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let live = true;
    getHubspotCache().then(c => { if (live) setContacts(c?.contacts || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const tags = useMemo(() => tagMatrixColumns(contacts, TAG_OPTIONS), [contacts]);
  const titleSearches = useMemo(() => resolveTitleSearches(settings), [settings]);

  // A bucket's include terms, and the tag it most likely stands for: the
  // tag whose name the bucket's name starts with ("ESG reporting" is ESG),
  // longest first so "Climate Risk" beats a shorter tag that also fits.
  const includeTerms = (b) => (b.groups || []).filter(g => g.kind !== 'exclude').flatMap(g => g.terms || []);
  const excludeTerms = (b) => (b.groups || []).filter(g => g.kind === 'exclude').flatMap(g => g.terms || []);
  const tagForBucket = (b) => {
    const name = tagKey(b.name);
    return [...tags].sort((a, c) => tagKey(c).length - tagKey(a).length)
      .find(t => tagKey(t) && name.startsWith(tagKey(t))) || '';
  };
  function pullBucket(b) {
    setType('title');
    setBucketKey(b.key);
    setTitlesText([...new Set(includeTerms(b))].join('\n'));
    const guess = tagForBucket(b);
    if (guess) setTag(guess);
  }

  const [pasteText, setPasteText] = useState('');
  const parsed = useMemo(() => (pasteText.trim() ? parseZoomPaste(pasteText) : null), [pasteText]);
  const companies = useMemo(() => parsed?.companies || [], [parsed]);

  const matchProspect = useMemo(() => buildProspectMatcher(prospects), [prospects]);
  const logged = useMemo(() => new Map(companyLog(log.searches).map(r => [r.key, r])), [log]);
  const preview = useMemo(() => companies.map(c => {
    const p = matchProspect(c);
    return { ...c, prospect: p, needsId: !!(p && c.zoomId && !String(p.zoomCompanyId || '').trim()), prior: logged.get(companyKey(c)) || null };
  }), [companies, matchProspect, logged]);
  const idsToSave = preview.filter(c => c.needsId);
  const [idNote, setIdNote] = useState('');

  const [type, setType] = useState('company');
  const [tag, setTag] = useState('');
  const [titlesText, setTitlesText] = useState('');
  // The search bucket (a saved title search on Contacts > Titles) the titles
  // were last pulled from, so its button reads as picked and its Not terms
  // can be shown under the box.
  const [bucketKey, setBucketKey] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');
  const titles = splitTitles(titlesText);
  const canLog = companies.length > 0 && !!date && (type === 'company' || (tag && titles.length > 0));
  const whyNot = companies.length === 0 ? 'Paste a ZoomInfo export first'
    : !date ? 'Pick the date of the search'
    : type === 'title' && !tag ? 'Pick the tag the titles were searched for'
    : type === 'title' && titles.length === 0 ? 'List the titles that were searched'
    : '';

  function saveZoomIds() {
    if (!onUpdateProspect) return;
    for (const c of idsToSave) {
      const fields = { zoomCompanyId: c.zoomId };
      if (!String(c.prospect.zoomCompanyName || '').trim() && c.name) fields.zoomCompanyName = c.name;
      onUpdateProspect(c.prospect.id, fields);
    }
    setIdNote(`Saved ${idsToSave.length} Zoom Company ID${idsToSave.length === 1 ? '' : 's'} to the Table View.`);
  }

  function logSearch() {
    if (!canLog) return;
    const entry = makeSearch({ id: newId(), type, date, tag, titles, companies, contactCount: parsed.contactCount, note });
    saveLog({ searches: [entry, ...log.searches] });
    setFlash(`Logged a ${type === 'title' ? `title search for ${tag}` : 'Company Zoom ID search'} across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}.`);
    setPasteText('');
    setNote('');
    setIdNote('');
  }

  function removeSearch(id) {
    const s = log.searches.find(x => x.id === id);
    if (!s) return;
    if (!window.confirm(`Delete the ${fmtDate(s.date)} ${s.type === 'title' ? `title search for ${s.tag}` : 'Company Zoom ID search'} from the log?`)) return;
    saveLog({ searches: log.searches.filter(x => x.id !== id) });
  }

  const [view, setView] = useState('company');
  const [filter, setFilter] = useState('');
  const byCompany = useMemo(() => companyLog(log.searches), [log]);
  const term = filter.trim().toLowerCase();
  const companyRows = term
    ? byCompany.filter(r => [r.name, r.zoomId, ...r.titleSearches.flatMap(t => [t.tag, ...t.titles])].join(' ').toLowerCase().includes(term))
    : byCompany;
  const searchRows = term
    ? log.searches.filter(s => [s.tag, s.note, ...(s.titles || []), ...(s.companies || []).flatMap(c => [c.name, c.zoomId])].join(' ').toLowerCase().includes(term))
    : log.searches;

  return (
    <div style={{ padding: '1rem 1.25rem', maxWidth: 1200 }}>
      <div style={{ marginBottom: '0.9rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1E293B' }}>Zoom Search Log</h2>
        <div style={{ fontSize: '0.76rem', color: '#64748B', marginTop: 2 }}>
          Paste a ZoomInfo Excel export, say what was searched, and log it. The log shows for every company whether the Company Zoom ID search has run, and which titles were searched for which tag.
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>1. Paste the ZoomInfo export</h3>
        <textarea
          value={pasteText}
          onChange={e => { setPasteText(e.target.value); setFlash(''); setIdNote(''); }}
          placeholder="Copy the rows in Excel, header row included, and paste here (Ctrl+V / Cmd+V)"
          aria-label="Pasted ZoomInfo export"
          style={{ ...input, width: '100%', minHeight: 90, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.72rem', whiteSpace: 'pre' }}
        />
        {parsed?.error && <div style={{ fontSize: '0.74rem', color: '#B91C1C', marginTop: 6 }}>{parsed.error}</div>}
        {companies.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', margin: '0.6rem 0 0.4rem', fontSize: '0.76rem', color: '#334155' }}>
              <strong>{companies.length} compan{companies.length === 1 ? 'y' : 'ies'}</strong>
              <span>{parsed.contactCount} row{parsed.contactCount === 1 ? '' : 's'}</span>
              {parsed.columns.zoomId === -1 && <span style={{ color: '#B45309' }}>No Zoom Company ID column: companies are logged by name.</span>}
              <div style={{ flex: 1 }} />
              {idsToSave.length > 0 && onUpdateProspect && (
                <button type="button" style={ghostBtn} onClick={saveZoomIds} title="Fill in the Zoom Company ID (and Zoom Company Name when blank) on the Table View companies that match by name but have no ID yet">
                  Save {idsToSave.length} Zoom ID{idsToSave.length === 1 ? '' : 's'} to Table View
                </button>
              )}
              {idNote && <span style={{ color: '#166534' }}>{idNote}</span>}
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Company</th>
                    <th style={th}>Zoom Company ID</th>
                    <th style={th}>Rows</th>
                    <th style={th}>Table View</th>
                    <th style={th}>Already logged</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map(c => (
                    <tr key={companyKey(c)}>
                      <td style={td}>{c.name || '-'}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{c.zoomId || '-'}</td>
                      <td style={td}>{c.contacts}</td>
                      <td style={td}>
                        {!c.prospect ? <span style={{ color: '#94A3B8' }}>Not on Table View</span>
                          : c.needsId ? <span style={{ color: '#B45309' }}>{c.prospect.company}: no Zoom ID yet</span>
                          : <span>{c.prospect.company}</span>}
                      </td>
                      <td style={{ ...td, color: c.prior ? '#334155' : '#94A3B8' }}>
                        {c.prior
                          ? [
                            c.prior.companySearches.length ? `Company search ${fmtDate(c.prior.companySearches[0])}` : '',
                            ...[...new Set(c.prior.titleSearches.map(t => t.tag))].map(t => `Titles: ${t}`),
                          ].filter(Boolean).join(' · ')
                          : 'Nothing yet'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div style={card}>
        <h3 style={h3}>2. What was searched</h3>
        {titleSearches.length > 0 && (
          <div style={{ marginBottom: '0.7rem' }}>
            <span style={label}>Pull titles from a search bucket</span>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }} role="group" aria-label="Search buckets">
              {titleSearches.map(b => {
                const on = type === 'title' && bucketKey === b.key;
                const n = new Set(includeTerms(b)).size;
                return (
                  <button
                    key={b.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pullBucket(b)}
                    title={`Fill the titles with the ${n} title${n === 1 ? '' : 's'} in ${b.name} (Contacts > Titles)${tagForBucket(b) ? ` and tag it ${tagForBucket(b)}` : ''}`}
                    style={pill(on, '#7C3AED')}
                  >{b.name} <span style={{ opacity: 0.6 }}>({n})</span></button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.7rem' }} role="group" aria-label="Search type">
          {SEARCH_TYPES.map(t => (
            <button key={t.key} type="button" aria-pressed={type === t.key} style={pill(type === t.key)} onClick={() => setType(t.key)}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {type === 'title' && (
            <>
              <div>
                <span style={label}>Tag</span>
                <select value={tag} onChange={e => setTag(e.target.value)} style={{ ...input, minWidth: 200, background: '#fff', color: tag ? '#1E293B' : '#94A3B8' }} aria-label="Tag the titles were searched for">
                  <option value="">Pick a tag...</option>
                  {tags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 320px' }}>
                <span style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Titles searched</span>
                </span>
                <textarea
                  value={titlesText}
                  onChange={e => setTitlesText(e.target.value)}
                  placeholder="One title per line, or comma separated"
                  style={{ ...input, width: '100%', minHeight: 70, resize: 'vertical' }}
                />
                <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginTop: 2 }}>{titles.length} title{titles.length === 1 ? '' : 's'}</div>
                {(() => {
                  const b = titleSearches.find(x => x.key === bucketKey);
                  const not = b ? [...new Set(excludeTerms(b))] : [];
                  if (!not.length) return null;
                  return (
                    <div style={{ fontSize: '0.66rem', color: '#64748B', marginTop: 4 }}>
                      <strong>{b.name} leaves out:</strong> {not.join(', ')}
                    </div>
                  );
                })()}
              </div>
            </>
          )}
          <div>
            <span style={label}>Date searched</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <span style={label}>Note (optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)} style={{ ...input, width: '100%' }} placeholder="Filters used, list it went to..." />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" style={btn(canLog)} disabled={!canLog} onClick={logSearch} title={whyNot}>Log search</button>
          {!canLog && whyNot && !flash && <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{whyNot}</span>}
          {flash && <span role="status" style={{ fontSize: '0.74rem', color: '#166534' }}>{flash}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h3 style={{ ...h3, margin: 0 }}>Search log</h3>
          <button type="button" style={pill(view === 'company')} aria-pressed={view === 'company'} onClick={() => setView('company')}>By company ({byCompany.length})</button>
          <button type="button" style={pill(view === 'search')} aria-pressed={view === 'search'} onClick={() => setView('search')}>By search ({log.searches.length})</button>
          <div style={{ flex: 1 }} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by company, Zoom ID, tag or title" style={{ ...input, width: 280, maxWidth: '100%' }} aria-label="Filter the log" />
        </div>
        {log.searches.length === 0 ? (
          <div style={{ fontSize: '0.76rem', color: '#94A3B8', padding: '0.5rem 0' }}>No searches logged yet.</div>
        ) : view === 'company' ? (
          <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Company</th>
                  <th style={th}>Zoom Company ID</th>
                  <th style={th}>Company Zoom ID search</th>
                  <th style={th}>Title searches (tag: titles)</th>
                </tr>
              </thead>
              <tbody>
                {companyRows.map(r => (
                  <tr key={r.key}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.name || '-'}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.zoomId || '-'}</td>
                    <td style={td}>
                      {r.companySearches.length
                        ? <span style={{ color: '#166534', fontWeight: 600 }}>Yes, {fmtDate(r.companySearches[0])}{r.companySearches.length > 1 ? ` (${r.companySearches.length}x)` : ''}</span>
                        : <span style={{ color: '#94A3B8' }}>Not yet</span>}
                    </td>
                    <td style={td}>
                      {r.titleSearches.length === 0 ? <span style={{ color: '#94A3B8' }}>None</span> : r.titleSearches.map((t, i) => (
                        <div key={i} style={{ marginBottom: 2 }}>
                          <strong>{t.tag}</strong>: {t.titles.join(', ')} <span style={{ color: '#94A3B8' }}>({fmtDate(t.date)})</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Search</th>
                  <th style={th}>Tag</th>
                  <th style={th}>Titles</th>
                  <th style={th}>Companies</th>
                  <th style={th}>Note</th>
                  <th style={th} aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {searchRows.map(s => (
                  <tr key={s.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(s.date)}</td>
                    <td style={td}>{s.type === 'title' ? 'Title search' : 'Company Zoom ID search'}</td>
                    <td style={td}>{s.tag || '-'}</td>
                    <td style={td}>{s.titles?.length ? s.titles.join(', ') : '-'}</td>
                    <td style={td} title={(s.companies || []).map(c => c.name || c.zoomId).join('\n')}>
                      {(s.companies || []).length}
                      <span style={{ color: '#94A3B8' }}>: {(s.companies || []).slice(0, 3).map(c => c.name || c.zoomId).join(', ')}{(s.companies || []).length > 3 ? ', ...' : ''}</span>
                    </td>
                    <td style={td}>{s.note || '-'}</td>
                    <td style={td}>
                      <button type="button" onClick={() => removeSearch(s.id)} title="Delete this search from the log" style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
