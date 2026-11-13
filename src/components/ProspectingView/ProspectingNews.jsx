// Prospecting > News: the ESG News Roundups, and the list of things to leave
// out of future ones. The roundups are written by the "ESG News daily
// roundup" scheduled task, which posts each one here through api/esg-news
// and reads this filter list back before writing the next. See
// utils/esgNews.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ESG_NEWS_COLLECTION, ESG_NEWS_SETTINGS_DOC, ESG_NEWS_ROUNDUPS, normalizeFilters, parseInline, parseRoundupMarkdown, MAX_FILTER_LENGTH } from '../../utils/esgNews';
import { formatDateDisplay } from '../../utils/isoDate';

const card = { border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.85rem 1rem' };
const btn = (primary) => ({ padding: '0.3rem 0.75rem', borderRadius: 6, border: `1px solid ${primary ? '#2563EB' : '#E2E8F0'}`, background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#475569', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' });
const chip = (active) => ({ padding: '0.2rem 0.65rem', borderRadius: 999, border: `1px solid ${active ? '#0A66C2' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#0A66C2' : '#475569', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });

function Inline({ text }) {
  return parseInline(text).map((p, i) => (p.href
    ? <a key={i} href={p.href} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}>{p.text}</a>
    : p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>));
}

function RoundupBody({ markdown }) {
  const blocks = useMemo(() => parseRoundupMarkdown(markdown), [markdown]);
  return (
    <div style={{ fontSize: '0.85rem', color: '#1E293B', lineHeight: 1.55 }}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const size = b.level <= 1 ? '1.05rem' : b.level === 2 ? '0.95rem' : '0.88rem';
          return <div key={i} style={{ fontSize: size, fontWeight: 700, margin: '0.9rem 0 0.3rem', color: '#0F172A' }}><Inline text={b.text} /></div>;
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return <Tag key={i} style={{ margin: '0.3rem 0', paddingLeft: '1.3rem' }}>{b.items.map((t, j) => <li key={j} style={{ margin: '0.15rem 0' }}><Inline text={t} /></li>)}</Tag>;
        }
        return <p key={i} style={{ margin: '0.35rem 0' }}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}

export function ProspectingNews() {
  const settingsRef = useMemo(() => doc(db, ESG_NEWS_COLLECTION, ESG_NEWS_SETTINGS_DOC), []);
  const [filters, setFilters] = useState(null); // null = loading
  const [roundups, setRoundups] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [openDate, setOpenDate] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        getDoc(settingsRef),
        getDocs(query(collection(settingsRef, ESG_NEWS_ROUNDUPS), orderBy('date', 'desc'), limit(60))),
      ]);
      setFilters(normalizeFilters(s.exists() ? s.data().filters : []));
      setRoundups(r.docs.map(d => d.data()));
      setError('');
    } catch (e) {
      setFilters(f => f || []);
      setRoundups(r => r || []);
      setError(e?.code === 'permission-denied'
        ? 'News is only available on the account that receives the ESG News Roundup.'
        : `Couldn't load the news: ${e?.message || 'unknown error'}`);
    }
  }, [settingsRef]);
  useEffect(() => { load(); }, [load]);

  // Read fresh before writing, so a change made in another tab isn't lost.
  const saveFilters = async (change, message) => {
    setSaving(true);
    try {
      const snap = await getDoc(settingsRef);
      const next = normalizeFilters(change(normalizeFilters(snap.exists() ? snap.data().filters : [])));
      await setDoc(settingsRef, { filters: next, updatedAt: new Date().toISOString() }, { merge: true });
      setFilters(next);
      setNote(message);
      window.setTimeout(() => setNote(''), 4000);
    } catch (e) {
      setNote(`Couldn't save: ${e?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };
  const add = () => {
    const f = draft.trim();
    if (!f) return;
    setDraft('');
    saveFilters(list => [...list, f], `Added. The next roundup leaves out stories about "${f}".`);
  };
  const remove = (f) => saveFilters(list => list.filter(x => x !== f), `Removed "${f}".`);

  const shown = roundups?.find(r => r.date === openDate) || roundups?.[0] || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0 1.25rem 1.25rem', maxWidth: 1000 }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        The ESG News Roundups from the daily scheduled task (6:45am Eastern), newest first.
        Anything on the filter list is left out of every roundup written after you add it.
      </div>
      {error && <div style={{ fontSize: '0.8rem', color: '#B45309' }}>{error}</div>}

      <div style={card}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.25rem' }}>Leave out of future roundups</div>
        <div style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '0.5rem' }}>
          A topic, company, publication or kind of item, in plain words, for example &quot;Sponsored items&quot;, &quot;Webinars and events&quot; or &quot;Sustainable aviation fuel deals&quot;.
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            maxLength={MAX_FILTER_LENGTH}
            placeholder="What to filter out"
            aria-label="What to filter out of future roundups"
            disabled={filters === null || saving}
            style={{ flex: '1 1 260px', padding: '0.35rem 0.55rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
          />
          <button type="button" onClick={add} disabled={!draft.trim() || saving || filters === null} style={btn(true)}>Add</button>
          {note && <span style={{ fontSize: '0.75rem', color: note.startsWith("Couldn't") ? '#B91C1C' : '#15803D', fontWeight: 600 }}>{note}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.6rem' }}>
          {filters === null ? <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>Loading...</span>
            : filters.length === 0 ? <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>Nothing filtered out yet.</span>
              : filters.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', padding: '0.25rem 0.5rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  <span style={{ flex: 1 }}>{f}</span>
                  <button type="button" onClick={() => remove(f)} disabled={saving} title={`Stop filtering out "${f}"`} style={{ ...btn(false), padding: '0.1rem 0.5rem', color: '#B91C1C' }}>Remove</button>
                </div>
              ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>Roundups</div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={load} style={btn(false)}>Refresh</button>
        </div>
        {roundups === null ? <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>Loading...</div>
          : roundups.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No roundups yet. The next one arrives after the scheduled task&apos;s morning run.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {roundups.map(r => (
                  <button key={r.date} type="button" onClick={() => setOpenDate(r.date)} style={chip(shown?.date === r.date)}>{formatDateDisplay(r.date)}</button>
                ))}
              </div>
              {shown && (
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '0.4rem' }}>
                  {shown.docUrl && (
                    <a href={shown.docUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: '#2563EB', fontWeight: 600 }}>Open as a Google Doc</a>
                  )}
                  <RoundupBody markdown={shown.markdown} />
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
