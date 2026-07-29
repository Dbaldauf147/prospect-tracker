import { useEffect, useMemo, useState, useCallback } from 'react';
import { loadList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { userLsGet } from '../../utils/userLs';
import { apiFetch } from '../../utils/apiFetch';
import { JURISDICTION_QUESTIONS, SCREENING_ANSWERS, REGULATIONS_BY_JURISDICTION } from '../../data/corporateComplianceScreening';

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

// Canonical key for a company, using the SAME normalization the page uses
// to match company names from the uploaded Utility Lookup file
// (companyNorm — lower-cased, corporate suffixes and punctuation stripped).
// Screening answers are saved under this key so a company keeps its
// answers regardless of cosmetic name differences ("Acme Inc" vs
// "ACME, INC."), and name variants collapse onto one company. Hyphenated
// so it is safe as a Firestore dotted field-path segment (no dots).
function companyKeyOf(name) {
  const norm = normalizeCompany(name);
  return norm ? norm.replace(/\s+/g, '-') : '';
}

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

// Compact "value metric" list, e.g. "1,000 Employees · 450 Global Net Turnover".
function thresholdText(thresholds) {
  return (thresholds || []).map(t => `${t.value} ${t.metric}`).join(' · ');
}

// Colour a screening answer select: Yes = green, No = muted, blank = default.
function answerSelectStyle(val) {
  const base = {
    fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
    padding: '0.15rem 0.35rem', borderRadius: 5, cursor: 'pointer',
    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    color: 'var(--color-text-muted)', flexShrink: 0,
  };
  if (val === 'Yes') return { ...base, borderColor: '#86EFAC', background: '#F0FDF4', color: '#166534' };
  if (val === 'No') return { ...base, color: 'var(--color-text)' };
  return base;
}

// Per-company jurisdiction screening: the six Yes/No gating questions.
// Answering "Yes" reveals the regulations that jurisdiction may trigger
// (from the reference data). `answers` is this company's saved map
// ({ california: 'Yes', ... }); `onSet(key, value)` persists one answer.
// The "Research answers" button asks Claude (web search) to fill them all
// in; `research` holds the last run's per-question rationale + sources.
function JurisdictionScreening({ answers, caSiteCount = 0, onSet, disabled, onResearch, researching, researchError, research }) {
  return (
    <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          Jurisdiction screening
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={onResearch}
            disabled={researching}
            title="Use Claude (with web search) to answer all six questions for this company. You can still edit any answer."
            style={{
              fontSize: '0.62rem', fontWeight: 700, fontFamily: 'inherit',
              padding: '0.15rem 0.5rem', borderRadius: 999, cursor: researching ? 'default' : 'pointer',
              border: '1px solid var(--color-accent)', background: 'var(--color-surface)',
              color: 'var(--color-accent)', opacity: researching ? 0.5 : 1, whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {researching ? 'Researching…' : (research ? 'Re-run answers' : 'Research answers')}
          </button>
        )}
      </div>
      {disabled ? (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Add a company name to screen jurisdictions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {JURISDICTION_QUESTIONS.map((q) => {
            const val = answers?.[q.key] || '';
            const regs = REGULATIONS_BY_JURISDICTION[q.key] || [];
            const note = research?.notes?.[q.key] || '';
            return (
              <div key={q.key}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                  <label style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text)', lineHeight: 1.35 }}>
                    <span style={{ fontWeight: 700 }}>{q.jurisdiction}</span>{' '}
                    <span style={{ color: 'var(--color-text-muted)' }}>{q.question}</span>
                    {q.key === 'california' && caSiteCount > 0 && (
                      <span style={{ color: '#166534', fontWeight: 700 }}> · {caSiteCount} CA {caSiteCount === 1 ? 'site' : 'sites'} on file</span>
                    )}
                  </label>
                  <select
                    value={val}
                    onChange={(e) => onSet(q.key, e.target.value)}
                    aria-label={`${q.jurisdiction}: ${q.question}`}
                    style={answerSelectStyle(val)}
                  >
                    <option value="">—</option>
                    {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                {note && (
                  <div style={{ margin: '0.15rem 0 0', paddingLeft: '0.1rem', fontSize: '0.63rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    {note}
                  </div>
                )}
                {val === 'Yes' && regs.length > 0 && (
                  <ul style={{ margin: '0.25rem 0 0', paddingLeft: '0.95rem', fontSize: '0.65rem', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {regs.map((r) => (
                      <li key={r.regulation}>
                        <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{r.regulation}</span>
                        {' · '}{r.timeline}
                        {r.thresholds.length > 0 && <> · {thresholdText(r.thresholds)}</>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {researchError && (
            <div style={{ fontSize: '0.63rem', color: '#B91C1C' }}>{researchError}</div>
          )}
          {research && (research.summary || (research.sources && research.sources.length > 0) || research.savedAt) && (
            <div style={{ marginTop: '0.15rem', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
              {research.summary && <div style={{ fontStyle: 'italic', marginBottom: '0.2rem' }}>{research.summary}</div>}
              {Array.isArray(research.sources) && research.sources.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.5rem' }}>
                  {research.sources.slice(0, 6).map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.url}
                      style={{ color: 'var(--color-accent)', textDecoration: 'none', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      ↗ {s.title || s.url}
                    </a>
                  ))}
                </div>
              )}
              {research.savedAt && <div style={{ marginTop: '0.2rem' }}>answered {fmtStamp(research.savedAt)}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Collapsible reference for the screening "logic": every jurisdiction's
// regulations with reporting timeline, description, and the numeric
// thresholds that gate them. Static — shown once at the top of the page.
function RegulationReference() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: '0.75rem', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem',
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          padding: '0.55rem 0.9rem', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text)',
        }}
      >
        <span style={{ color: 'var(--color-text-muted)' }}>{open ? '▾' : '▸'}</span>
        Regulation reference &amp; thresholds
        <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>— what each question screens for</span>
      </button>
      {open && (
        <div style={{ padding: '0 0.9rem 0.75rem' }}>
          {JURISDICTION_QUESTIONS.map((q) => {
            const regs = REGULATIONS_BY_JURISDICTION[q.key] || [];
            return (
              <div key={q.key} style={{ marginTop: '0.7rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-xs)' }}>{q.jurisdiction}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{q.question}</div>
                {regs.map((r) => (
                  <div key={r.regulation} style={{ marginTop: '0.35rem', paddingLeft: '0.6rem', borderLeft: '2px solid var(--color-border)' }}>
                    <div style={{ fontSize: 'var(--font-size-xs)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{r.regulation}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}> · {r.timeline}</span>
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text)', marginTop: '0.1rem' }}>{r.description}</div>
                    {r.thresholds.length > 0 && (
                      <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                        Thresholds: {thresholdText(r.thresholds)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CorporateCompliance({ sites = [], settings, updateSettingsPath }) {
  const companies = useMemo(() => {
    // Group by the canonical company key (the file-matching identity), so
    // name variants collapse onto one company and its saved answers.
    const byKey = new Map();
    for (const site of sites) {
      const rawName = String(site.company || '').trim();
      const key = companyKeyOf(rawName);
      const mapKey = key || '__unnamed__';
      if (!byKey.has(mapKey)) {
        byKey.set(mapKey, { key, total: 0, california: 0, caSites: [], names: new Map() });
      }
      const entry = byKey.get(mapKey);
      entry.total += 1;
      if (rawName) entry.names.set(rawName, (entry.names.get(rawName) || 0) + 1);
      if (isCalifornia(site.state)) {
        entry.california += 1;
        if (site.siteName || site.city) {
          entry.caSites.push([site.siteName, site.city].filter(Boolean).join(' — '));
        }
      }
    }
    // Display name = the most common raw spelling in the group (tie-break:
    // longer, then alphabetical) so the label is stable across sessions.
    const out = [...byKey.values()].map((e) => {
      let name = UNNAMED;
      let bestCount = -1;
      for (const [n, c] of e.names) {
        if (c > bestCount || (c === bestCount && (n.length > name.length || (n.length === name.length && n < name)))) {
          name = n; bestCount = c;
        }
      }
      return { key: e.key, name, total: e.total, california: e.california, caSites: e.caSites };
    });
    return out.sort(
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

  // Per-company jurisdiction screening answers, keyed by company slug then
  // jurisdiction key (settings.corporateComplianceScreening). Persisted via
  // updateSettingsPath so a single answer writes just its own leaf; an
  // empty answer deletes the leaf (null → delete).
  const screening = settings?.corporateComplianceScreening || {};
  const setScreeningAnswer = useCallback((slug, key, value) => {
    if (!updateSettingsPath || !slug) return;
    updateSettingsPath({ [`corporateComplianceScreening.${slug}.${key}`]: value || null });
  }, [updateSettingsPath]);

  // Portfolio company field. Writes the shared setting SitesView reads to
  // name every uploaded site that has no per-row Company Name column — so
  // setting it here names the company across all Utility Lookup subtabs.
  // Local input state (persist on blur / Enter) avoids a write per
  // keystroke; re-sync if the value changes elsewhere (Save to Company,
  // the site-list lookup).
  const savedPortfolioCompany = String(settings?.utilityLookupCompanyName || '');
  const [companyInput, setCompanyInput] = useState(savedPortfolioCompany);
  useEffect(() => { setCompanyInput(savedPortfolioCompany); }, [savedPortfolioCompany]);
  const applyPortfolioCompany = useCallback((value) => {
    if (!updateSettingsPath) return;
    const v = String(value ?? '').trim();
    updateSettingsPath({ utilityLookupCompanyName: v || null });
  }, [updateSettingsPath]);

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

  // Persisted compliance-research blobs (per-question verdicts + rationale
  // + sources), keyed by the canonical company key so they line up with the
  // screening answers. Transient loading / error lives in local state.
  const complianceResearch = settings?.companyComplianceResearch || {};
  const [screenState, setScreenState] = useState({});

  // Ask Claude (web search) to answer all six gating questions, then fill
  // the screening dropdowns and persist the run's rationale + sources — in
  // ONE settings write. The user can still override any answer by hand.
  const researchCompliance = useCallback(async (name, key) => {
    const company = String(name || '').trim();
    if (!company || company === UNNAMED || !key) return;
    setScreenState(s => ({ ...s, [key]: { loading: true, error: null } }));
    try {
      const r = await apiFetch('/api/research-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
      if (!r.ok) {
        const txt = await r.text();
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { msg = txt.slice(0, 200) || msg; }
        setScreenState(s => ({ ...s, [key]: { loading: false, error: msg } }));
        return;
      }
      const data = await r.json();
      const answers = data.answers || {};
      const updates = {};
      // Fill each dropdown: Yes/No are set, Unknown clears the answer (null).
      for (const q of JURISDICTION_QUESTIONS) {
        const a = answers[q.key];
        updates[`corporateComplianceScreening.${key}.${q.key}`] = (a === 'Yes' || a === 'No') ? a : null;
      }
      // Keep the rationale + sources alongside so the card can explain itself.
      updates[`companyComplianceResearch.${key}`] = {
        notes: data.notes || {},
        summary: String(data.summary || ''),
        sources: Array.isArray(data.sources) ? data.sources : [],
        savedAt: Date.now(),
      };
      setScreenState(s => ({ ...s, [key]: { loading: false, error: null } }));
      if (updateSettingsPath) updateSettingsPath(updates);
    } catch (err) {
      setScreenState(s => ({ ...s, [key]: { loading: false, error: err?.message || 'Request failed' } }));
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
        Screen each company against the corporate disclosure regimes — <strong>California</strong>{' '}
        (SB 253 / SB 261), <strong>EU</strong> (CSRD), <strong>UK</strong>, <strong>Australia</strong>,{' '}
        <strong>Mexico</strong>, and <strong>Brazil</strong> — with the six gating questions on each card.
        Cards also carry <strong>annual revenue</strong> research, <strong>California site operations</strong>,
        and fuzzy matches against the uploaded <strong>Lists</strong> (CDP, GRESB, SBT, Ecovadis, …).
      </p>

      <RegulationReference />

      {/* Portfolio company — names every uploaded site that has no per-row
          Company Name column, across all Utility Lookup subtabs. */}
      <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <label htmlFor="cc-portfolio-company" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text)' }}>
          Portfolio company
        </label>
        <input
          id="cc-portfolio-company"
          value={companyInput}
          onChange={(e) => setCompanyInput(e.target.value)}
          onBlur={(e) => applyPortfolioCompany(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPortfolioCompany(e.currentTarget.value); e.currentTarget.blur(); } }}
          placeholder="Name the company for all uploaded sites…"
          style={{ flex: '1 1 260px', maxWidth: 360, padding: '0.35rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 'var(--font-size-xs)', fontFamily: 'inherit', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
        {savedPortfolioCompany && (
          <button
            type="button"
            onClick={() => { setCompanyInput(''); applyPortfolioCompany(''); }}
            title="Clear the portfolio company (sites fall back to any mapped Company Name column)"
            style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
          Applies to every site without a mapped Company Name column — across all Utility Lookup subtabs.
        </span>
      </div>

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
              // True while either the revenue or the jurisdiction research
              // for this company is in flight — drives the combined button.
              const anyResearching = !!revState[c.name]?.loading || !!screenState[c.key]?.loading;
              return (
                <div key={c.key || c.name} style={{
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

                  {/* One-click: revenue research + all six jurisdiction
                      answers together. The per-section buttons below still
                      re-run just one facet. */}
                  <button
                    type="button"
                    onClick={() => { researchRevenue(c.name); researchCompliance(c.name, c.key); }}
                    disabled={!c.key || anyResearching}
                    title="Research this company's annual revenue and answer all six jurisdiction questions in one go."
                    style={{
                      marginTop: '0.5rem', width: '100%', padding: '0.4rem 0.6rem', borderRadius: 6,
                      border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff',
                      fontSize: 'var(--font-size-xs)', fontWeight: 700, fontFamily: 'inherit',
                      cursor: (!c.key || anyResearching) ? 'default' : 'pointer',
                      opacity: (!c.key || anyResearching) ? 0.55 : 1,
                    }}
                  >
                    {anyResearching ? 'Researching…' : '🔎 Research everything'}
                  </button>

                  <RevenueSection
                    data={revenueResearch[revenueSlug(c.name)] || null}
                    loading={!!revState[c.name]?.loading}
                    error={revState[c.name]?.error || null}
                    disabled={c.name === UNNAMED}
                    onResearch={() => researchRevenue(c.name)}
                  />

                  {/* Jurisdiction screening — the six gating questions.
                      Keyed by the canonical company identity (c.key) so
                      answers save against the matched company from the
                      uploaded file, not a raw-name slug. */}
                  <JurisdictionScreening
                    answers={screening[c.key] || null}
                    caSiteCount={c.california}
                    disabled={!c.key}
                    onSet={(qKey, value) => setScreeningAnswer(c.key, qKey, value)}
                    onResearch={() => researchCompliance(c.name, c.key)}
                    researching={!!screenState[c.key]?.loading}
                    researchError={screenState[c.key]?.error || null}
                    research={complianceResearch[c.key] || null}
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
