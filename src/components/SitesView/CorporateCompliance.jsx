import { useEffect, useMemo, useState, useCallback } from 'react';
import { loadList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { userLsGet } from '../../utils/userLs';
import { apiFetch } from '../../utils/apiFetch';

// Firestore path segment for a company's persisted revenue research —
// same slug shape the prospect modal uses for its research blobs.
const revenueSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

// Corporate Compliance — placeholder scaffold, now with framework-list
// mapping. Company-specific research (revenue, California site operations)
// still lands in the per-company cards; alongside it we fuzzy-match each
// company name against the uploaded Lists (CDP, GRESB, SBT, Ecovadis, …)
// and surface which frameworks it appears on.

const UNNAMED = '(Unnamed company)';

const isCalifornia = (state) => {
  const s = String(state || '').trim().toLowerCase();
  return s === 'ca' || s === 'california';
};

// Same fuzzy scorer the prospect-modal "Matches across Lists" panel uses,
// so a company reads the same way here as it does there.
function fuzzyScore(rowNorm, companyNorm) {
  if (!rowNorm || !companyNorm) return 0;
  if (rowNorm === companyNorm) return 1;
  if (rowNorm.length < 3 || companyNorm.length < 3) return 0;
  if (!rowNorm.includes(companyNorm) && !companyNorm.includes(rowNorm)) return 0;
  const shorter = Math.min(rowNorm.length, companyNorm.length);
  const longer = Math.max(rowNorm.length, companyNorm.length);
  return longer > 0 ? shorter / longer : 0;
}

function loadMapping(key) {
  if (!key) return {};
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

const CHIP_FALLBACK = { bg: '#F1F5F9', text: '#475569' };
const chipColor = (label) => LIST_FLAG_BY_LABEL[label]?.color || CHIP_FALLBACK;

// Load one list from IDB once and reduce it to unique { matchKey, rawName,
// norm } entries plus this user's mapping / dismissed state — so every
// company can be matched against it without re-reading storage.
async function loadListEntries(def, settings) {
  const rows = await loadList(def.storageKey);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const headers = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) {
    if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  const nameKey = pickNameKey(headers);

  const entries = [];
  const seenKeys = new Set();
  rows.forEach((r, i) => {
    const rawName = nameKey ? String(r[nameKey] || '') : '';
    const norm = normalizeCompany(rawName);
    const matchKey = norm ? `name::${norm}` : `row::${i}`;
    if (seenKeys.has(matchKey)) return;
    seenKeys.add(matchKey);
    if (!norm) return;
    entries.push({ matchKey, rawName, norm });
  });

  const remote = settings?.listMappings?.[def.storageKey] || {};
  const mapping = remote.mapping && typeof remote.mapping === 'object'
    ? remote.mapping : loadMapping(`${def.storageKey}:account-mapping`);
  const dismissed = remote.dismissed && typeof remote.dismissed === 'object'
    ? remote.dismissed : loadMapping(`${def.storageKey}:account-dismissed`);

  return { def, entries, mapping, dismissed };
}

// Framework/list matches for one company: rows already mapped to it, plus
// fuzzy suggestions the user hasn't dismissed. Mirrors ListsMatchPanel.
function matchCompany(companyNorm, loadedLists) {
  if (!companyNorm) return [];
  const out = [];
  for (const { def, entries, mapping, dismissed } of loadedLists) {
    for (const e of entries) {
      const mappedTo = mapping[e.matchKey] || '';
      const mappedNorm = normalizeCompany(mappedTo);
      if (mappedNorm && mappedNorm === companyNorm) {
        out.push({ list: def.label, storageKey: def.storageKey, rawName: e.rawName, score: 1, state: 'mapped' });
        continue;
      }
      if (dismissed[e.matchKey]) continue;
      if (mappedTo) continue; // mapped to a different company — leave alone
      const score = fuzzyScore(e.norm, companyNorm);
      if (score >= 0.5) {
        out.push({ list: def.label, storageKey: def.storageKey, rawName: e.rawName, score, state: 'suggested' });
      }
    }
  }
  // Mapped first, then by descending score; dedupe identical list+row.
  const seen = new Set();
  return out
    .sort((a, b) => (a.state === 'mapped' ? 0 : 1) - (b.state === 'mapped' ? 0 : 1) || b.score - a.score)
    .filter(m => {
      const k = `${m.storageKey}::${(m.rawName || '').toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// Compact date label for the "researched …" stamp.
function fmtStamp(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

// Revenue block for one company card. Shows the persisted research when
// present (headline figure + supporting detail + citations), otherwise a
// "Research revenue" button that asks Claude (with web search) to find
// the company's most recent annual revenue. `disabled` guards the
// unnamed-company card, which has nothing to research.
function RevenueSection({ data, loading, error, disabled, onResearch }) {
  const btn = (label) => (
    <button
      type="button"
      onClick={onResearch}
      disabled={loading || disabled}
      style={{
        fontSize: '0.65rem', fontWeight: 700, fontFamily: 'inherit',
        padding: '0.2rem 0.55rem', borderRadius: 999, cursor: (loading || disabled) ? 'default' : 'pointer',
        border: '1px solid var(--color-accent)', background: 'var(--color-surface)',
        color: 'var(--color-accent)', opacity: (loading || disabled) ? 0.5 : 1, whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );

  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>
      {data && (data.revenue || data.summary) ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
              {data.revenue || '—'}
            </span>
            {data.fiscalYear && <span style={{ fontSize: '0.65rem' }}>{data.fiscalYear}</span>}
          </div>
          {(data.ownership || data.ticker || data.employees) && (
            <div style={{ marginTop: '0.15rem', fontSize: '0.65rem' }}>
              {[data.ownership, data.ticker, data.employees ? `${Number(data.employees).toLocaleString()} employees` : '']
                .filter(Boolean).join(' · ')}
            </div>
          )}
          {data.summary && (
            <div style={{ marginTop: '0.25rem', color: 'var(--color-text)', fontStyle: 'italic' }}>{data.summary}</div>
          )}
          {Array.isArray(data.sources) && data.sources.length > 0 && (
            <div style={{ marginTop: '0.3rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.5rem' }}>
              {data.sources.slice(0, 6).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                  title={s.url}
                  style={{ fontSize: '0.62rem', color: 'var(--color-accent)', textDecoration: 'none', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ↗ {s.title || s.url}
                </a>
              ))}
            </div>
          )}
          <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {btn(loading ? 'Researching…' : 'Re-run research')}
            {data.savedAt && !loading && (
              <span style={{ fontSize: '0.6rem' }}>researched {fmtStamp(data.savedAt)}</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontStyle: 'italic' }}>
            {loading ? 'Researching revenue…' : 'Revenue: pending research'}
          </span>
          {btn(loading ? 'Researching…' : 'Research revenue')}
        </div>
      )}
      {error && (
        <div style={{ marginTop: '0.25rem', color: '#B91C1C', fontSize: '0.65rem' }}>{error}</div>
      )}
    </div>
  );
}

export default function CorporateCompliance({ sites = [], settings, updateSettingsPath }) {
  const companies = useMemo(() => {
    const byCompany = new Map();
    for (const site of sites) {
      const name = String(site.company || '').trim() || UNNAMED;
      if (!byCompany.has(name)) {
        byCompany.set(name, { name, total: 0, california: 0, caSites: [] });
      }
      const entry = byCompany.get(name);
      entry.total += 1;
      if (isCalifornia(site.state)) {
        entry.california += 1;
        if (site.siteName || site.city) {
          entry.caSites.push([site.siteName, site.city].filter(Boolean).join(' — '));
        }
      }
    }
    return [...byCompany.values()].sort(
      (a, b) => b.california - a.california || b.total - a.total || a.name.localeCompare(b.name)
    );
  }, [sites]);

  const totalCA = companies.reduce((sum, c) => sum + c.california, 0);

  // Persisted revenue-research blobs keyed by company slug (synced via
  // settings.companyRevenueResearch). Transient loading / error state per
  // company lives in local state; the resolved data is read back from
  // settings so it survives reloads and syncs across devices.
  const revenueResearch = settings?.companyRevenueResearch || {};
  const [revState, setRevState] = useState({});

  const researchRevenue = useCallback(async (name) => {
    const company = String(name || '').trim();
    if (!company || company === UNNAMED) return;
    const slug = revenueSlug(company);
    setRevState(s => ({ ...s, [company]: { loading: true, error: null } }));
    try {
      const r = await apiFetch('/api/research-revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
      if (!r.ok) {
        const txt = await r.text();
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { msg = txt.slice(0, 200) || msg; }
        setRevState(s => ({ ...s, [company]: { loading: false, error: msg } }));
        return;
      }
      const data = await r.json();
      const stamped = { ...data, savedAt: Date.now() };
      setRevState(s => ({ ...s, [company]: { loading: false, error: null } }));
      if (updateSettingsPath && slug) {
        updateSettingsPath({ [`companyRevenueResearch.${slug}`]: stamped });
      }
    } catch (err) {
      setRevState(s => ({ ...s, [company]: { loading: false, error: err?.message || 'Request failed' } }));
    }
  }, [updateSettingsPath]);

  // Re-scan when the company set or the synced list mappings change.
  const companyKey = companies.map(c => c.name).join('|');
  const [listMatches, setListMatches] = useState({});
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const names = companies.map(c => c.name).filter(n => n && n !== UNNAMED);
      if (names.length === 0) { setListMatches({}); return; }
      setScanning(true);
      try {
        const loaded = (await Promise.all(UPLOADED_LISTS.map(def => loadListEntries(def, settings)))).filter(Boolean);
        if (cancelled) return;
        const byCompany = {};
        for (const name of names) {
          byCompany[name] = matchCompany(normalizeCompany(name), loaded);
        }
        setListMatches(byCompany);
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, settings?._lastWriteAt]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Corporate Compliance
        </h1>
        <span style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--color-accent)', background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 999, padding: '0.15rem 0.6rem',
        }}>
          Coming soon
        </span>
      </div>
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', maxWidth: 640, marginTop: '0.35rem' }}>
        Company-specific research lives here: <strong>annual revenue</strong> and{' '}
        <strong>California site operations</strong> per company. Each card also fuzzy-matches the
        company name against the uploaded <strong>Lists</strong> (CDP, GRESB, SBT, Ecovadis, …) to
        show which sustainability frameworks it appears on.
      </p>

      {companies.length === 0 ? (
        <div style={{
          marginTop: '1.5rem', padding: '2rem', textAlign: 'center',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)',
          border: '1px dashed var(--color-border)', borderRadius: 8,
        }}>
          No sites loaded yet. Upload sites on the Utility Lookup tab to preview companies here.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: '1rem 0 0.5rem' }}>
            {companies.length} {companies.length === 1 ? 'company' : 'companies'} ·{' '}
            <strong style={{ color: '#166534' }}>{totalCA}</strong> California{' '}
            {totalCA === 1 ? 'site' : 'sites'}
            {scanning && <span> · scanning lists…</span>}
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {companies.map((c) => {
              const matches = listMatches[c.name] || [];
              return (
                <div key={c.name} style={{
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  background: 'var(--color-surface)', padding: '0.75rem 0.9rem',
                }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                    {c.total} {c.total === 1 ? 'site' : 'sites'}
                    {c.california > 0 && (
                      <>
                        {' · '}
                        <strong style={{ color: '#166534' }}>{c.california} in CA</strong>
                      </>
                    )}
                  </div>
                  <RevenueSection
                    data={revenueResearch[revenueSlug(c.name)] || null}
                    loading={!!revState[c.name]?.loading}
                    error={revState[c.name]?.error || null}
                    disabled={c.name === UNNAMED}
                    onResearch={() => researchRevenue(c.name)}
                  />

                  {/* Framework / List matches */}
                  <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                      Framework / List matches
                      {c.name !== UNNAMED && matches.length > 0 && <span> ({matches.length})</span>}
                    </div>
                    {c.name === UNNAMED ? (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        Add a company name to match against lists.
                      </div>
                    ) : scanning && matches.length === 0 ? (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Scanning…</div>
                    ) : matches.length === 0 ? (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>No list matches</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {matches.map((m, i) => {
                          const color = chipColor(m.list);
                          const pct = Math.round((m.score || 0) * 100);
                          return (
                            <div key={`${m.storageKey}::${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                              <span style={{
                                flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                                borderRadius: 4, background: color.bg, color: color.text,
                              }}>{m.list}</span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.rawName}>
                                {m.rawName || <em style={{ color: 'var(--color-text-muted)' }}>(unnamed row)</em>}
                              </span>
                              <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, color: m.state === 'mapped' ? '#166534' : 'var(--color-text-muted)' }}>
                                {m.state === 'mapped' ? 'mapped' : `${pct}%`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {c.caSites.length > 0 && (
                    <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.1rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>
                      {c.caSites.slice(0, 5).map((label, i) => (
                        <li key={i}>{label}</li>
                      ))}
                      {c.caSites.length > 5 && (
                        <li style={{ color: 'var(--color-text-muted)', listStyle: 'none', marginLeft: '-1.1rem' }}>
                          +{c.caSites.length - 5} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
