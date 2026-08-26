import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { loadList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { reportingStatus, REPORTED_COLORS, NOT_REPORTED_COLORS } from '../../utils/reportingFrameworks';
import { sustainabilityProfile, describeSustainability } from '../../utils/sustainabilityProfile';
import { userLsGet } from '../../utils/userLs';
import {
  parseEmployeesInput, parseTextInput, resolveCompanyFacts,
} from '../../utils/companyFacts';
import { apiFetch } from '../../utils/apiFetch';
import { classifyHqRegion, normalizeHqRegion, NORTH_AMERICA, OUTSIDE_NORTH_AMERICA } from '../../utils/hqRegion';
import {
  JURISDICTION_QUESTIONS, SCREENING_ANSWERS, REGULATIONS_BY_JURISDICTION,
  deriveRegulationVerdict, parseRevenueUsd, pickThresholdRevenue,
  JURISDICTION_CRITERIA_GROUPS, criterionKey,
  deriveCriterion, deriveDoingBusinessInCA, deriveCsrdWaveVerdict, californiaRevenueScreen,
  companyScreeningKey, ALWAYS_SHOW_REGULATIONS,
} from '../../data/corporateComplianceScreening';
import {
  summarizeSiteRegions, regionCountryLabel,
  isCaliforniaSite, excludedCaliforniaCountries,
  SITE_REGION_ORDER, UNKNOWN_REGION,
} from '../../utils/siteRegion';

// Firestore path segment for a company's persisted revenue research —
// same slug shape the prospect modal uses for its research blobs.
const revenueSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

// Corporate Compliance — placeholder scaffold, now with framework-list
// mapping. Company-specific research (revenue, California site operations)
// still lands in the per-company cards; alongside it we fuzzy-match each
// company name against the uploaded Lists (CDP, GRESB, SBT, Ecovadis, …)
// and surface which frameworks it appears on.

const UNNAMED = '(Unnamed company)';

// Company cards span the full page width, so unconstrained prose and
// question rows would run edge to edge. Cap the text-heavy blocks at a
// readable measure — the card itself still fills the page.
const READABLE_MAX = '90ch';

// Canonical key for a company. Defined alongside the screening data so the
// Compliance Roadmap can read the same answers back under the same key —
// see companyScreeningKey.
const companyKeyOf = companyScreeningKey;

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

// Revenue block for one company card. Deliberately just the headline
// figure: the research still persists ownership, employee count, the
// written summary and its citations, but rendering all of it buried the
// one number this row exists for. The supporting detail moves to the
// hover title so it stays reachable. With no research yet, a "Research
// revenue" button asks Claude (with web search) for the company's most
// recent annual revenue. `disabled` guards the unnamed-company card,
// which has nothing to research.
// A researched figure that can be typed over.
//
// The three facts this card carries - revenue, headcount, HQ - are
// research output, and research is sometimes wrong or blank. They also
// feed the compliance verdicts below (CSRD's 1,000-employee test, the SB
// 253 / SB 261 thresholds), so being stuck with a wrong one means being
// stuck with a wrong answer.
//
// The value itself is the control: click it and it becomes an input.
// There is no edit button competing with the research button already on
// each row, and nothing moves when the mode changes.
//
// An edit never overwrites the research - it sits on top of it - so a
// corrected figure carries a marker naming what was researched, and
// clearing the box hands the row back. That is the only way to undo, so
// an empty box has to be a save rather than a rejection.
function EditableFact({
  value, display, edited, researched, placeholder, parse, onSave, disabled, label, hint = '',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function open() {
    if (disabled) return;
    setDraft(value == null ? '' : String(value));
    setError('');
    setEditing(true);
  }

  function commit() {
    const result = parse(draft);
    if (!result.ok) { setError(result.error); return; }
    onSave(result.value);
    setEditing(false);
    setError('');
  }

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            // Escape abandons the edit. Checked before blur can save it,
            // which is why the input is torn down here rather than by
            // letting the blur handler run.
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setError(''); }
          }}
          onBlur={commit}
          aria-label={label}
          placeholder={placeholder}
          style={{
            fontSize: 'var(--font-size-sm)', fontWeight: 700, fontFamily: 'inherit',
            padding: '0.05rem 0.3rem', borderRadius: 4, minWidth: 0, width: '11ch',
            border: `1px solid ${error ? '#B91C1C' : 'var(--color-accent)'}`,
            background: 'var(--color-surface)', color: 'var(--color-text)',
          }}
        />
        {error && <span style={{ color: '#B91C1C', fontSize: '0.62rem' }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.3rem' }}>
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        // The research detail this value used to carry on hover is kept,
        // with the edit affordance appended rather than replacing it.
        title={[hint, disabled ? '' : 'Click to edit'].filter(Boolean).join('\n\n') || undefined}
        style={{
          fontWeight: 700,
          color: display ? 'var(--color-text)' : 'var(--color-text-muted)',
          fontStyle: display ? 'normal' : 'italic',
          fontSize: display ? 'var(--font-size-sm)' : 'var(--font-size-xs)',
          cursor: disabled ? 'default' : 'text',
          borderBottom: disabled ? 'none' : '1px dashed var(--color-border)',
        }}
      >{display || placeholder}</span>
      {edited && (
        // Says the figure was typed, not researched, and what it replaced.
        // Without this a corrected card is indistinguishable from a
        // correct one, and nobody can tell which numbers to trust.
        <span
          title={researched == null || researched === ''
            ? 'Entered by hand. Nothing was researched for this field.'
            : `Entered by hand, replacing the researched ${researched}.`}
          style={{ fontSize: '0.58rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '0.05rem 0.3rem', whiteSpace: 'nowrap' }}
        >edited</span>
      )}
      {edited && !disabled && (
        <button
          type="button"
          onClick={() => onSave(null)}
          title={researched == null || researched === ''
            ? 'Clear this value'
            : `Go back to the researched ${researched}`}
          aria-label={`Revert ${label}`}
          style={{ fontSize: '0.62rem', fontFamily: 'inherit', lineHeight: 1, padding: '0.05rem 0.2rem', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}
        >↺</button>
      )}
    </span>
  );
}

function RevenueSection({ data, fact, loading, error, disabled, onResearch, onEdit }) {
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

  // The detail that used to render inline (ownership / employees, the
  // summary, and when it was researched) rides on the hover title instead,
  // so it stays reachable without crowding the figure.
  // Employees moved out to its own card row, so it's no longer repeated here.
  const detail = data
    ? [
        [data.ownership, data.ticker].filter(Boolean).join(' · '),
        data.summary,
        data.savedAt ? `researched ${fmtStamp(data.savedAt)}` : '',
      ].filter(Boolean).join('\n\n')
    : '';

  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
      {loading && !fact.value ? (
        <span style={{ fontStyle: 'italic' }}>Researching revenue…</span>
      ) : (
        <EditableFact
          value={fact.value}
          display={fact.value || ''}
          edited={fact.edited}
          researched={fact.researched}
          placeholder={data ? 'Revenue: not reported' : 'Revenue: pending research'}
          parse={parseTextInput}
          onSave={onEdit}
          disabled={disabled}
          label="Revenue"
          hint={detail}
        />
      )}
      {/* The fiscal year belongs to the researched figure, so it is not
          shown against a hand-entered one it does not describe. */}
      {data?.fiscalYear && !fact.edited && <span style={{ fontSize: '0.65rem' }}>{data.fiscalYear}</span>}
      {btn(loading ? 'Researching…' : (data ? 'Re-run research' : 'Research revenue'))}
      {error && (
        <span style={{ color: '#B91C1C', fontSize: '0.65rem' }}>{error}</span>
      )}
    </div>
  );
}

// The company's parent, and what the parent's revenue is.
//
// Every regime on this page tests its thresholds at the CONSOLIDATED
// group, not at the entity whose sites happen to be in the file. CSRD
// catches a subsidiary through its ultimate parent; SB 253 and SB 261
// are written against "total annual revenues" of the parent entity. So
// screening Barings on Barings' own numbers can answer the wrong
// question entirely — the number that decides it belongs to whoever
// owns Barings.
//
// Hence a row rather than a note: name the parent, research ITS revenue
// (the same /api/research-revenue run every other card uses, keyed by
// the parent's own slug so it is reusable and never overwrites the
// subsidiary's figure), and the threshold questions below can be
// answered against the right entity.
//
// Left blank means "no parent" — a company that is its own ultimate
// parent, which is the common case and needs no ceremony.
function ParentCompanySection({
  value, onSave, disabled, revenue, revenueLoading, revenueError, onResearch, screening,
  ownRevenue = '',
}) {
  // Adjusted during render rather than in an effect: the saved value can
  // change underneath this input (a Master Analysis import, an edit on
  // another device), and the draft has to follow — but an effect for it
  // is a second render pass for something React can settle in the first.
  const [draft, setDraft] = useState(value || '');
  const [lastValue, setLastValue] = useState(value || '');
  if ((value || '') !== lastValue) {
    setLastValue(value || '');
    setDraft(value || '');
  }
  const saved = String(value || '').trim();
  const dirty = draft !== (value || '');

  const commit = () => { if (dirty) onSave(draft.trim()); };

  const btn = (label, onClick, off) => (
    <button
      type="button"
      onClick={onClick}
      disabled={off}
      style={{
        fontSize: '0.65rem', fontWeight: 700, fontFamily: 'inherit',
        padding: '0.2rem 0.55rem', borderRadius: 999, cursor: off ? 'default' : 'pointer',
        border: '1px solid var(--color-accent)', background: 'var(--color-surface)',
        color: 'var(--color-accent)', opacity: off ? 0.5 : 1, whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );

  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
      <input
        value={draft}
        disabled={disabled}
        placeholder="Ultimate parent, if any…"
        aria-label="Parent company"
        title="The entity the thresholds are actually tested at. Leave blank when this company is its own ultimate parent."
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setDraft(value || ''); }
        }}
        style={{
          flex: '1 1 180px', maxWidth: 240, boxSizing: 'border-box',
          padding: '0.2rem 0.35rem', fontSize: '0.7rem', fontFamily: 'inherit',
          color: 'var(--color-text)', background: 'var(--color-surface)',
          border: `1px solid ${dirty ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 4, opacity: disabled ? 0.5 : 1,
        }}
      />
      {saved && (
        revenue && (revenue.revenue || revenue.summary) ? (
          <>
            <span
              title={[
                [revenue.ownership, revenue.ticker].filter(Boolean).join(' · '),
                revenue.summary,
                revenue.savedAt ? `researched ${fmtStamp(revenue.savedAt)}` : '',
              ].filter(Boolean).join('\n\n') || undefined}
              style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}
            >
              {revenue.revenue || '-'}
            </span>
            {revenue.fiscalYear && <span style={{ fontSize: '0.65rem' }}>{revenue.fiscalYear}</span>}
            {btn(revenueLoading ? 'Researching…' : 'Re-run parent revenue', onResearch, revenueLoading)}
          </>
        ) : (
          <>
            <span style={{ fontStyle: 'italic' }}>
              {revenueLoading ? 'Researching parent revenue…' : 'Parent revenue: pending research'}
            </span>
            {btn(revenueLoading ? 'Researching…' : 'Research parent revenue', onResearch, revenueLoading)}
          </>
        )
      )}
      {/* Which figure the thresholds below are actually measured against.
          Either side can trigger a mandate, so the larger one is the test
          subject — and a card that changed its own basis without saying so
          would be the worst version of this feature. Three states, because
          "not screened on" would be a lie about a researched parent whose
          figure simply lost to the company's own. */}
      {saved && (() => {
        const researched = !!(revenue && revenue.revenue);
        const label = screening ? 'thresholds use this'
          : researched ? 'company’s own is higher'
          : 'not screened on yet';
        const title = screening
          ? 'The Compliance rows below are derived from this parent’s revenue: every regime here tests the consolidated group, and the parent’s figure is the larger of the two.'
          : researched
            ? `Either figure can trigger a mandate, so the thresholds test the larger — this company’s own revenue${ownRevenue ? ` (${ownRevenue})` : ''}. The parent’s is on file and takes over if it ever exceeds it.`
            : 'Research the parent’s revenue and the Compliance rows below will be derived from it whenever it exceeds this company’s own.';
        return (
          <span
            title={title}
            style={{
              fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
              padding: '0.1rem 0.4rem', borderRadius: 999, whiteSpace: 'nowrap',
              border: `1px solid ${screening ? '#86EFAC' : researched ? '#BFDBFE' : 'var(--color-border)'}`,
              background: screening ? '#DCFCE7' : researched ? '#EFF6FF' : 'var(--color-surface)',
              color: screening ? '#166534' : researched ? '#1E40AF' : 'var(--color-text-muted)',
            }}
          >
            {label}
          </span>
        );
      })()}
      {revenueError && (
        <span style={{ color: '#B91C1C', fontSize: '0.65rem' }}>{revenueError}</span>
      )}
    </div>
  );
}

// Where the company is headquartered, and whether that puts it in North
// America. Both halves matter on this page: the location itself is the
// jurisdiction context for the screening questions below, and the
// North America / Outside of North America call is the exact value the
// company popup's HQ Region dropdown takes — so a card that knows it can
// fill that field when it's blank.
//
// The location comes from whichever source has it: this row's own curated
// lookup, the revenue-research run, or the HQ Location the My Accounts page
// already stored. The region is whatever was researched, else derived from
// the location, else whatever the company record already says.
function HqSection({ location, fact, region, source, loading, error, disabled, notFound, onLookup, onSetRegion, onEditLocation, canApply, onApply }) {
  const btn = (label, onClick, disabledNow) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabledNow}
      style={{
        fontSize: '0.65rem', fontWeight: 700, fontFamily: 'inherit',
        padding: '0.2rem 0.55rem', borderRadius: 999, cursor: disabledNow ? 'default' : 'pointer',
        border: '1px solid var(--color-accent)', background: 'var(--color-surface)',
        color: 'var(--color-accent)', opacity: disabledNow ? 0.5 : 1, whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );

  const inNA = region === NORTH_AMERICA;

  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      {loading && !fact?.value ? (
        <span style={{ fontStyle: 'italic' }}>Looking up HQ…</span>
      ) : (
        <EditableFact
          value={fact?.value ?? location}
          display={fact?.value || location || ''}
          edited={!!fact?.edited}
          researched={fact?.researched}
          placeholder={notFound ? 'No HQ on file: try "Research everything"' : 'HQ: pending lookup'}
          parse={parseTextInput}
          onSave={onEditLocation}
          disabled={disabled}
          label="HQ location"
          hint={source ? `from ${source}` : ''}
        />
      )}

      {/* The two-value call the company popup stores. It's the same choice
          that popup's dropdown offers, rendered as a select rather than a
          static chip so a missing (or wrong) region can be fixed here —
          colour-coded the way the list chips elsewhere on the card are. */}
      <select
        value={region || ''}
        onChange={(e) => onSetRegion(e.target.value)}
        disabled={disabled}
        aria-label="HQ region"
        title={region ? undefined : 'Not known: set it here, or look up the HQ.'}
        style={{
          fontSize: '0.62rem', fontWeight: 700, fontFamily: 'inherit',
          padding: '0.1rem 0.25rem', borderRadius: 4,
          border: `1px solid ${region ? 'transparent' : 'var(--color-border)'}`,
          background: region ? (inNA ? '#DCFCE7' : '#E0E7FF') : 'var(--color-surface)',
          color: region ? (inNA ? '#166534' : '#3730A3') : 'var(--color-text-muted)',
        }}
      >
        <option value="">Region unknown</option>
        <option value={NORTH_AMERICA}>{NORTH_AMERICA}</option>
        <option value={OUTSIDE_NORTH_AMERICA}>{OUTSIDE_NORTH_AMERICA}</option>
      </select>

      {btn(loading ? 'Looking up…' : location ? 'Re-run lookup' : 'Look up HQ', onLookup, loading || disabled)}

      {/* Only offered when the company record's HQ Region is actually blank —
          this never overwrites a region already set on the popup. */}
      {canApply && btn('Fill company field', onApply, false)}

      {error && <span style={{ color: '#B91C1C', fontSize: '0.65rem' }}>{error}</span>}
    </div>
  );
}

// Total employees, from the same research blob the revenue row reads. Kept
// as its own row because headcount gates regimes independently of revenue
// (CSRD's 1,000-employee test, for one). No button of its own — the figure
// arrives with the revenue run, so "Re-run research" up there refreshes it.
function EmployeesSection({ data, fact, loading, disabled, onEdit }) {
  const count = Number(fact?.value);
  const has = Number.isFinite(count) && count > 0;
  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
      {loading && !has ? (
        <span style={{ fontStyle: 'italic' }}>Researching employees…</span>
      ) : (
        <EditableFact
          value={has ? count : null}
          display={has ? count.toLocaleString() : ''}
          edited={!!fact?.edited}
          researched={fact?.researched == null ? null : Number(fact.researched).toLocaleString()}
          placeholder={data ? 'Not reported' : 'Employees: pending research'}
          parse={parseEmployeesInput}
          onSave={onEdit}
          disabled={disabled}
          label="Employees"
        />
      )}
    </div>
  );
}

// Compact "value metric" list, e.g. "1,000 Employees · 450 Global Net Turnover".
// Normalize a typed reference URL, and refuse anything that isn't http(s) —
// a stored "javascript:" value would otherwise become a clickable script
// once rendered as an anchor. Returns '' for anything unusable.
function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
  const withScheme = hasScheme ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // Without a scheme to go on, "not a url at all" parses as a hostname and
    // used to be saved as a link that goes nowhere. Insist it look like a
    // domain — dotted, no spaces. A typed-out scheme is taken at its word, so
    // an intranet host like http://sharepoint/page still works.
    if (!hasScheme && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return '';
    return u.href;
  } catch { return ''; }
}

// Shorten a URL for display beside a question, so a long statute link can't
// push the Applies? column off screen.
function urlLabel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const tail = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
    return (tail ? `${host}/…/${tail}` : host).slice(0, 40);
  } catch { return String(url).slice(0, 40); }
}

// A reference link the user maintains for one question or regulation: click
// to open, ✎ to edit, "+ link" when empty. Persisted per company alongside
// the screening answers so it survives reloads and syncs across devices.
// What the user recorded after reading the linked source. Free text, saved
// on blur (and on Ctrl/Cmd+Enter) rather than per keystroke, so a paragraph
// of notes doesn't become a write per character.
function FindingsBox({ value, onSave, ariaLabel, disabled }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  if (disabled) return null;
  const dirty = draft !== (value || '');
  return (
    <textarea
      value={draft}
      rows={2}
      placeholder="Findings from this source…"
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (dirty) onSave(draft.trim()); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setDraft(value || ''); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', marginTop: '0.2rem', resize: 'vertical',
        padding: '0.2rem 0.3rem', fontSize: '0.63rem', fontFamily: 'inherit', lineHeight: 1.35,
        color: 'var(--color-text)', background: 'var(--color-surface)',
        // A subtle outline while unsaved, so it's clear blur will commit.
        border: `1px solid ${dirty ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 4,
      }}
    />
  );
}

// The right-hand column for one question / regulation: the user's reference
// link stacked over the findings they recorded from it.
function ReferenceCell({ url, findings, onSaveUrl, onSaveFindings, label, disabled, shared }) {
  return (
    // Side by side: the link is a short fixed-width control, the notes box
    // takes the rest. Stacked, the two doubled every row's height for no
    // gain once the table had the width to hold both.
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
      <div style={{ flex: '0 0 auto', maxWidth: '48%', minWidth: 0 }}>
        <ReferenceLink
          url={url}
          onSave={onSaveUrl}
          ariaLabel={`Reference URL for ${label}`}
          disabled={disabled}
          shared={shared}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FindingsBox
          value={findings}
          onSave={onSaveFindings}
          ariaLabel={`Findings for ${label}`}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// `shared` marks a link that belongs to the question rather than to the
// company — the page you go to look the answer up. Saving one puts it on
// every company's copy of that row, which is the point: the source doesn't
// change from company to company, so nobody should have to re-paste it.
function ReferenceLink({ url, onSave, ariaLabel, disabled, shared }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url || '');
  // Set while the mouse is down on ✕ so the blur it fires first isn't
  // treated as "clicked away, save it" — cancel has to mean cancel.
  const cancellingRef = useRef(false);
  useEffect(() => { setDraft(url || ''); }, [url]);

  const tiny = {
    fontSize: '0.58rem', fontWeight: 700, fontFamily: 'inherit',
    padding: '0.05rem 0.3rem', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
  };

  if (disabled) return null;

  if (editing) {
    const invalid = !!draft.trim() && !safeUrl(draft);
    const commit = () => {
      // A non-empty entry that isn't a usable http(s) URL is rejected rather
      // than saved as a dead link; clearing the box removes the link. A
      // rejection leaves the editor open with the reason on screen — the
      // old silent return read as "the button didn't keep my link".
      if (draft.trim() && !safeUrl(draft)) return;
      onSave(draft.trim() ? safeUrl(draft) : '');
      setEditing(false);
    };
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem', flexWrap: 'wrap' }}
        // Clicking away commits what was typed rather than throwing it out.
        // Requiring Save or Enter is the single biggest reason a pasted link
        // never appeared: type it, click the next row, and it was gone.
        onBlur={(e) => {
          // Focus moved to Save / ✕ inside this editor — let the button act.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (cancellingRef.current) return;
          if (draft.trim() === (url || '')) { setEditing(false); return; }
          commit();
        }}
      >
        <input
          type="text"
          value={draft}
          autoFocus
          placeholder="https://…"
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { setDraft(url || ''); setEditing(false); }
          }}
          style={{
            width: 170, padding: '0.1rem 0.3rem', fontSize: '0.62rem', fontFamily: 'inherit',
            border: `1px solid ${invalid ? '#DC2626' : 'var(--color-border)'}`, borderRadius: 4,
          }}
        />
        <button type="button" onClick={commit} title={invalid ? 'Enter a valid http(s) URL' : 'Save link'} style={tiny}>Save</button>
        <button
          type="button"
          onMouseDown={() => { cancellingRef.current = true; }}
          onClick={() => { cancellingRef.current = false; setDraft(url || ''); setEditing(false); }}
          title="Cancel"
          style={tiny}
        >✕</button>
        {invalid && (
          <span style={{ width: '100%', fontSize: '0.58rem', color: '#B91C1C' }}>
            Not a usable web address: it needs to look like example.com/page.
          </span>
        )}
      </span>
    );
  }

  if (url) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem' }}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          style={{ fontSize: '0.62rem', color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >↗ {urlLabel(url)}</a>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={shared ? 'Edit this shared link: it applies to every company' : 'Edit link'}
          style={tiny}
        >✎</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={shared
        ? 'Add the page you look this up on: saved once and shown on every company'
        : 'Add a reference URL for this question'}
      style={{ ...tiny, marginTop: '0.2rem', opacity: 0.75 }}
    >+ link</button>
  );
}

function thresholdText(thresholds) {
  return (thresholds || []).map(t => `${t.value} ${t.metric}`).join(' · ');
}

// "How is this populated?" — the badge beside a California criterion's
// value. Says where the number came from so a derived Yes isn't mistaken
// for one somebody checked.
const CRITERION_SOURCE = {
  // Covers both runs behind the button: the revenue research fills the
  // California thresholds, the compliance research fills the CSRD figures and
  // the CBAM import verdicts. The row's own tooltip names which one and says
  // what it found, so this only has to say it wasn't typed by hand.
  research: { label: 'from research', title: 'Derived from the research on this card, not entered by hand. Hover the value for what it found; pick a value to override.' },
  sites: { label: 'from sites', title: 'Counted from the uploaded site list: the California sites matched to this company. Pick a value to override.' },
  manual: { label: 'manual', title: 'Nothing on this page settles this one: answer it by hand.' },
};

// A figure a criterion asks for rather than a Yes/No — turnover in millions,
// a headcount. Holds a local draft and commits on blur / Enter, so one
// settings write per edit rather than one per keystroke. Blank clears the
// saved value, handing the row back to whatever can be derived for it.
function NumberCriterionInput({ value, derived, title, ariaLabel, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  // Re-sync in render rather than an effect, matching the number cells
  // elsewhere in the app.
  const [last, setLast] = useState(value ?? '');
  if ((value ?? '') !== last) {
    setLast(value ?? '');
    setDraft(value ?? '');
  }
  const commit = () => {
    const raw = String(draft).trim();
    if (raw === (value ?? '')) return;
    onCommit(raw);
  };
  return (
    <input
      type="number"
      min="0"
      step="any"
      value={draft}
      title={title}
      aria-label={ariaLabel}
      placeholder="-"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value ?? ''); e.currentTarget.blur(); }
      }}
      style={{
        width: 84, boxSizing: 'border-box', fontSize: '0.68rem', fontWeight: 700,
        fontFamily: 'inherit', padding: '0.15rem 0.35rem', borderRadius: 5,
        border: `1px ${derived ? 'dashed' : 'solid'} var(--color-border)`,
        background: 'var(--color-surface)', color: 'var(--color-text)',
      }}
    />
  );
}

function SourceBadge({ source }) {
  const meta = CRITERION_SOURCE[source];
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      style={{
        fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.04em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'help', whiteSpace: 'nowrap',
      }}
    >{meta.label}</span>
  );
}


// Everything on this page that's filed under a company's canonical key. A
// company is identified by its normalized name, so renaming it — retyping the
// portfolio company, or mapping a different Company Name column — files new
// work under a new key and leaves the old work stranded under the old one.
// COMPLIANCE_MAPS is what the recovery panel looks through and moves.
const COMPLIANCE_MAPS = [
  { setting: 'companyComplianceLinks', noun: 'link' },
  { setting: 'companyComplianceFindings', noun: 'finding' },
  { setting: 'corporateComplianceScreening', noun: 'answer' },
  { setting: 'companyComplianceResearch', noun: 'research run', whole: true },
];

// "3 links · 2 answers" for one stranded company.
function describeStranded(parts) {
  return parts
    .map(p => `${p.count} ${p.noun}${p.count === 1 ? '' : 's'}`)
    .join(' · ');
}

// Persistence key for one regulation's Applies? answer, e.g.
// "california__sb-253". Stored in the same per-company screening map as
// the jurisdiction answers, so it needs the same Firestore-safe shape:
// no dots, and a double underscore that can't collide with a
// jurisdiction key (those are single words).
function regulationAnswerKey(jurisdictionKey, regulation) {
  const slug = String(regulation || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${jurisdictionKey}__${slug}`;
}

// Colour a screening answer select: Yes = green, No = muted, Unknown = amber
// (researched but unresolved — deliberately distinct from the blank
// nobody-has-looked-yet state), blank = default. `derived` renders an
// auto-filled value in the same colour but dashed, so a computed answer
// doesn't masquerade as one somebody entered.
function answerSelectStyle(val, derived = false) {
  const base = {
    fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
    padding: '0.15rem 0.35rem', borderRadius: 5, cursor: 'pointer',
    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    color: 'var(--color-text-muted)', flexShrink: 0,
  };
  const style = val === 'Yes'
    ? { ...base, borderColor: '#86EFAC', background: '#F0FDF4', color: '#166534' }
    : val === 'Unknown'
      ? { ...base, borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' }
      : val === 'No'
        ? { ...base, color: 'var(--color-text)' }
        : base;
  return derived ? { ...style, borderStyle: 'dashed' } : style;
}

// Per-company jurisdiction screening, rendered as a Jurisdiction /
// Screening / Applies? table. Each of the six gating questions is a row;
// answering "Yes" adds a sub-row per regulation that jurisdiction
// triggers, carrying the threshold it screens on and its own Applies?
// answer. `answers` is this company's saved map ({ california: 'Yes',
// california__sb-253: 'Yes', … }); `onSet(key, value)` persists one
// answer. The "Research answers" button asks Claude (web search) to fill
// the jurisdiction rows; `research` holds that run's rationale + sources.
//
// Every reference link on this table is filed against the row, not the
// company (`sharedLinks` / `onSetSharedLink`) — a statute is the same page
// whoever is being screened. `links` is the old per-company map, read as a
// fallback so anything saved before that stays on screen.
function JurisdictionScreening({ answers, links, sharedLinks, onSetSharedLink, findings, onSetFindings, caSiteCount = 0, revenue = '', revenueEntity = '', employees = null, onSet, disabled, onResearch, researching, researchError, research }) {
  // Revenue drives the derived Applies? verdicts (SB 253 / SB 261). Parsed
  // once per render rather than per regulation row.
  //
  // `revenue` is the figure the thresholds are tested against, which is not
  // always this company's own: every regime here measures the consolidated
  // group, so a company with a parent recorded is screened on the parent's
  // revenue. `revenueEntity` names that parent when it is, and rides into
  // every basis string so a verdict always says whose number cleared the bar.
  const revenueLabel = String(revenue || '').trim();
  const revenueUsd = parseRevenueUsd(revenueLabel);
  // Inputs the California criteria derive themselves from, and the
  // one-of-three doing-business result they add up to. That result is what
  // gates SB 253 / SB 261 — the jurisdiction question alone only asks
  // whether the company operates or sells there.
  const criterionContext = {
    revenueUsd, revenueLabel, revenueEntity, caSiteCount,
    employees: Number.isFinite(Number(employees)) && employees !== null && employees !== ''
      ? Number(employees) : null,
    // The CSRD figures and CBAM import verdicts the compliance research run
    // turned up, plus its per-field rationale for the tooltips. Two payloads
    // rather than one because they're established from different evidence:
    // a run can settle the turnover and still not know what gets imported.
    csrd: research?.csrd || null,
    csrdNotes: research?.csrdNotes || null,
    cbam: research?.cbam || null,
    cbamNotes: research?.cbamNotes || null,
    // "Present in the EU" for Wave 2 — the jurisdiction question asks exactly
    // that, so the wave rules read it rather than a second copy of it.
    euAnswer: answers?.eu || '',
  };
  const doingBusinessInCA = deriveDoingBusinessInCA(answers, criterionContext);
  // Under the lowest California threshold, no mandate can bite and the
  // doing-business questions stop mattering — the rows go N/A and the
  // mandates read as ruled out rather than merely unanswered.
  const caScreen = californiaRevenueScreen(answers, criterionContext);
  const caRuledOut = caScreen.screenedOut;
  const caRuledOutWhy = `Revenue is under ${caScreen.floorLabel}, the lowest California threshold, so no California mandate can apply and this test can't change that.`;
  // Ruled-out rows carry the tint; the red left rule keeps them legible for
  // anyone who can't pick the fill out of a dense table.
  const ruledOutRow = { background: '#FEE2E2', boxShadow: 'inset 3px 0 0 #DC2626' };

  // A ruled-out jurisdiction collapses its workings by default: none of those
  // rows can change the verdict, so they're noise on a card being scanned.
  // Keyed by jurisdiction so expanding one doesn't expand the rest, and held
  // in component state rather than saved — it's a viewing choice, not data.
  const [expandedRuledOut, setExpandedRuledOut] = useState({});
  const th = {
    textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.62rem', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap',
  };
  const td = {
    padding: '0.35rem 0.5rem', fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)',
    verticalAlign: 'top', lineHeight: 1.35,
  };

  return (
    // Capped so each Yes/No select stays beside its question instead of
    // drifting to the far edge of a full-width card.
    <div>
      {!disabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.35rem' }}>
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
        </div>
      )}
      {disabled ? (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Add a company name to screen jurisdictions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '20%' }}>Jurisdiction</th>
                <th style={{ ...th, width: '26%' }}>Screening</th>
                {/* Wide enough for the select plus the "auto" badge beside
                    it — any narrower and the badge overflows into the
                    Reference column. */}
                <th style={{ ...th, width: '14%' }}>Applies?</th>
                <th style={{ ...th, width: '40%' }}>
                  Reference &amp; Findings
                  <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>: your link + notes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTION_QUESTIONS.map((q) => {
                const val = answers?.[q.key] || '';
                const regs = REGULATIONS_BY_JURISDICTION[q.key] || [];
                const note = research?.notes?.[q.key] || '';
                const ruledOut = q.key === 'california' && caRuledOut;
                const collapsed = ruledOut && !expandedRuledOut[q.key];
                // What collapsing hides, and how much of it the user has
                // already annotated — a count of their own work is the one
                // thing that shouldn't disappear without saying so.
                const criteriaRows = (JURISDICTION_CRITERIA_GROUPS[q.key] || [])
                  .flatMap((g) => g.rows.map((row) => criterionKey(q.key, row.key)));
                const regKeys = regs.map((r) => regulationAnswerKey(q.key, r.regulation));
                const hiddenCount = criteriaRows.length + regKeys.length;
                const hiddenAnnotated = [...criteriaRows, ...regKeys]
                  .filter((k) => sharedLinks?.[k] || links?.[k] || findings?.[k]).length;
                return (
                  <Fragment key={q.key}>
                    <tr style={ruledOut ? ruledOutRow : undefined} title={ruledOut ? caRuledOutWhy : undefined}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{q.jurisdiction}</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>{q.question}</div>
                        {ruledOut && (
                          <div style={{ marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span style={{ color: '#991B1B', fontWeight: 700, fontSize: '0.62rem' }}>
                              Ruled out: under {caScreen.floorLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpandedRuledOut((m) => ({ ...m, [q.key]: !m[q.key] }))}
                              title={collapsed
                                ? 'Show the rows behind this verdict: editing one is how you undo it'
                                : 'Hide the rows behind this verdict'}
                              style={{
                                fontSize: '0.58rem', fontWeight: 700, fontFamily: 'inherit',
                                padding: '0.05rem 0.35rem', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid #FCA5A5', background: '#FFF1F2', color: '#991B1B',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {collapsed
                                ? `show ${hiddenCount} row${hiddenCount === 1 ? '' : 's'}${hiddenAnnotated ? ` · ${hiddenAnnotated} with notes` : ''}`
                                : 'hide rows'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        {/* The screening signal for this jurisdiction: the
                            CA site count we can prove from the uploaded
                            file, plus whatever the research turned up. */}
                        {q.key === 'california' && caSiteCount > 0 && (
                          <div style={{ color: '#166534', fontWeight: 700 }}>
                            {caSiteCount} {caSiteCount === 1 ? 'site' : 'sites'}
                          </div>
                        )}
                        {note
                          ? <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.68rem' }}>{note}</div>
                          : (q.key !== 'california' || caSiteCount === 0)
                            ? <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                            : null}
                      </td>
                      <td style={td}>
                        {/* Ruled out and collapsed, this row is the verdict
                            line for the whole jurisdiction, so Applies? says
                            No rather than showing the operate/sell question's
                            own dash. The stored answer isn't touched — it's
                            named in the tooltip, and the select comes back the
                            moment the workings are expanded, which is when
                            somebody is actually editing them. */}
                        {ruledOut && collapsed ? (
                          <span
                            title={`No California mandate applies. ${caRuledOutWhy}`
                              + (val ? ` Screening answer on file: ${val}.` : '')
                              + ' Expand the rows to edit it.'}
                            style={{
                              fontWeight: 700, fontSize: '0.68rem', color: '#991B1B',
                              cursor: 'help', letterSpacing: '0.04em',
                            }}
                          >No</span>
                        ) : (
                          <select
                            value={val}
                            onChange={(e) => onSet(q.key, e.target.value)}
                            aria-label={`${q.jurisdiction}: ${q.question}`}
                            style={answerSelectStyle(val)}
                          >
                            <option value="">-</option>
                            {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={td}>
                        {/* The page that answers "do they operate there?" —
                            a regulator's register, a scope note — is the
                            same page for every company, so the link is
                            shared. The findings stay this company's. */}
                        <ReferenceCell
                          url={sharedLinks?.[q.key] || links?.[q.key] || ''}
                          findings={findings?.[q.key] || ''}
                          onSaveUrl={(v) => onSetSharedLink?.(q.key, v)}
                          onSaveFindings={(v) => onSetFindings?.(q.key, v)}
                          label={q.jurisdiction}
                          disabled={disabled}
                          shared
                        />
                      </td>
                    </tr>
                    {/* Regulations this jurisdiction triggers. Shown for a
                        Yes and for an Unknown — an unresolved jurisdiction
                        still needs its mandates visible so they can be
                        answered by hand — but not while the question is
                        unanswered, which would expand every jurisdiction on
                        a fresh company. Each carries its own Applies?
                        answer, keyed jurisdiction__regulation-slug. */}
                    {/* California's two tests spelled out: the worldwide
                        revenue thresholds, and the one-of-three
                        doing-business check. Both feed the SB 253 / SB 261
                        Applies? rows below. */}
                    {!collapsed && (JURISDICTION_CRITERIA_GROUPS[q.key] || []).map((group) => {
                      // Criteria rows are always on, for California and the
                      // EU alike: they're how you arrive at the jurisdiction's
                      // answer (or, for CSRD, the figures you need in front of
                      // you to give it), so hiding them behind that answer
                      // would put the work behind the conclusion it supports.
                      // The mandate rows below are the consequences, and those
                      // still wait for a Yes.
                      const shownRows = group.rows;
                      // The doing-business leg is moot once the revenue leg
                      // has failed: its answers can't change any verdict, so
                      // they read N/A rather than sitting there unanswered.
                      // The revenue rows themselves stay live — they're the
                      // evidence, and editing one is how you undo this.
                      const groupNA = ruledOut && group.key === 'doing-business';
                      return (
                      <Fragment key={group.key}>
                        <tr>
                          <td style={{ ...td, paddingLeft: '1.4rem', fontWeight: 700 }}>
                            {group.label}
                          </td>
                          <td style={td} colSpan={3}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>
                              {groupNA ? caRuledOutWhy : group.note}
                            </span>
                          </td>
                        </tr>
                        {shownRows.map((row) => {
                          const cKey = criterionKey(q.key, row.key);
                          const saved = answers?.[cKey] || '';
                          // A hand-entered value always wins; clearing it falls
                          // back to whatever the card can work out.
                          const derived = saved ? null : deriveCriterion(row, criterionContext);
                          const shown = saved || derived?.verdict || '';
                          return (
                            <tr key={cKey}>
                              <td style={{ ...td, paddingLeft: '2.4rem' }}>{row.label}</td>
                              <td style={td}>
                                {row.fromSiteCount ? (
                                  <span style={{ fontWeight: 700, color: caSiteCount > 0 ? '#166534' : 'var(--color-text-muted)' }}>
                                    {caSiteCount} {caSiteCount === 1 ? 'site' : 'sites'} in CA
                                  </span>
                                ) : row.note ? (
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>{row.note}</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={td}>
                                {groupNA ? (
                                  <span
                                    title={caRuledOutWhy}
                                    style={{
                                      fontWeight: 700, fontSize: '0.68rem', color: '#991B1B',
                                      cursor: 'help', letterSpacing: '0.04em',
                                    }}
                                  >N/A</span>
                                ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0, flexWrap: 'wrap' }}>
                                  {row.kind === 'number' ? (
                                    <NumberCriterionInput
                                      value={shown}
                                      derived={!!derived}
                                      title={derived ? derived.basis : undefined}
                                      ariaLabel={`${q.jurisdiction}: ${row.label}`}
                                      onCommit={(v) => onSet(cKey, v)}
                                    />
                                  ) : (
                                    <select
                                      value={shown}
                                      onChange={(e) => onSet(cKey, e.target.value)}
                                      aria-label={`${q.jurisdiction} criterion: ${row.label}`}
                                      title={derived ? derived.basis : undefined}
                                      style={answerSelectStyle(shown, !!derived)}
                                    >
                                      <option value="">-</option>
                                      {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                  )}
                                  <SourceBadge source={row.source} />
                                </div>
                                )}
                              </td>
                              <td style={td}>
                                {/* A criterion row is one somebody looks up,
                                    and they look it up in the same place for
                                    every company — so its link is shared,
                                    while the findings beside it stay this
                                    company's. An older per-company link still
                                    shows until a shared one is saved over it,
                                    so nothing already recorded disappears. */}
                                <ReferenceCell
                                  url={sharedLinks?.[cKey] || links?.[cKey] || ''}
                                  findings={findings?.[cKey] || ''}
                                  onSaveUrl={(v) => onSetSharedLink?.(cKey, v)}
                                  onSaveFindings={(v) => onSetFindings?.(cKey, v)}
                                  label={row.label}
                                  disabled={disabled}
                                  shared
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                      );
                    })}
                    {!collapsed && regs.map((r) => {
                      const rKey = regulationAnswerKey(q.key, r.regulation);
                      // A regulation carrying this company's own work — its
                      // findings, or a per-company link saved before mandate
                      // links became shared — stays on screen even if the
                      // jurisdiction answer stops triggering it, so saved
                      // research never disappears with the row. (Every
                      // jurisdiction shows its mandates now, so this only
                      // matters if one is ever taken back out of that set.)
                      const triggered = val === 'Yes' || val === 'Unknown'
                        || ALWAYS_SHOW_REGULATIONS.has(q.key);
                      if (!triggered && !(sharedLinks?.[rKey] || links?.[rKey] || findings?.[rKey])) return null;
                      const rVal = answers?.[rKey] || '';
                      // Pure threshold tests (SB 253 / SB 261) answer
                      // themselves from the revenue already on this card.
                      // A hand-picked answer always wins; choosing "—"
                      // falls back to the derived value.
                      // California's two turn on revenue plus doing business
                      // there; the CSRD waves turn on the EU rows above.
                      const auto = rVal ? null : (q.key === 'eu'
                        ? deriveCsrdWaveVerdict(r, { answers, context: criterionContext })
                        : deriveRegulationVerdict(r, {
                          revenueUsd,
                          revenueLabel,
                          revenueEntity,
                          jurisdictionAnswer: val,
                          jurisdictionLabel: q.jurisdiction,
                          doingBusiness: q.key === 'california' ? doingBusinessInCA : undefined,
                        }));
                      const shownVal = rVal || auto?.verdict || '';
                      // A mandate its jurisdiction has ruled out on revenue
                      // is tinted, so a card scanned at a glance says which
                      // regimes are off the table rather than just showing a
                      // column of Nos.
                      return (
                        <tr key={rKey} style={ruledOut ? ruledOutRow : undefined} title={ruledOut ? caRuledOutWhy : undefined}>
                          <td style={{ ...td, paddingLeft: '1.4rem' }}>
                            <div style={{ fontWeight: 700, color: ruledOut ? '#991B1B' : undefined }}>{r.regulation}</div>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>{r.timeline}</div>
                          </td>
                          <td style={td} title={r.description}>
                            {r.thresholds.length > 0
                              ? thresholdText(r.thresholds)
                              : <span style={{ color: 'var(--color-text-muted)' }}>{r.description}</span>}
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0, flexWrap: 'wrap' }}>
                              <select
                                value={shownVal}
                                onChange={(e) => onSet(rKey, e.target.value)}
                                aria-label={`${r.regulation} applies?`}
                                title={auto ? auto.basis : undefined}
                                style={answerSelectStyle(shownVal, !!auto)}
                              >
                                <option value="">-</option>
                                {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                              {auto && (
                                <span
                                  title={auto.basis}
                                  style={{
                                    fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.04em',
                                    color: 'var(--color-text-muted)', textTransform: 'uppercase', cursor: 'help',
                                  }}
                                >auto</span>
                              )}
                            </div>
                          </td>
                          <td style={td}>
                            {/* A mandate's link points at the regulation —
                                the statute, the regulator's guidance — which
                                is the same page whichever company is being
                                screened, so it's shared like the manual rows'
                                are. The findings stay this company's: what
                                that mandate means for them is not generic. An
                                older per-company link still shows until a
                                shared one is saved over it. */}
                            <ReferenceCell
                              url={sharedLinks?.[rKey] || links?.[rKey] || ''}
                              findings={findings?.[rKey] || ''}
                              onSaveUrl={(v) => onSetSharedLink?.(rKey, v)}
                              onSaveFindings={(v) => onSetFindings?.(rKey, v)}
                              label={r.regulation}
                              disabled={disabled}
                              shared
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {researchError && (
            <div style={{ fontSize: '0.63rem', color: '#B91C1C' }}>{researchError}</div>
          )}
          {research && (research.summary || (research.sources && research.sources.length > 0) || research.savedAt) && (
            <div style={{ marginTop: '0.15rem', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
              {research.summary && <div style={{ fontStyle: 'italic', marginBottom: '0.2rem', maxWidth: READABLE_MAX }}>{research.summary}</div>}
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
        <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>- what each question screens for</span>
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

// One aligned label / value row of a company "card table". The label sits
// in a fixed-width left gutter (top-aligned) so every section — Sites,
// Revenue, Jurisdiction, Lists, CA sites — lines up as table rows instead
// of stacked blocks. A top border draws the row separators.
// Sustainability targets + disclosure status for one company card, read
// from the matched company record. Read-only: the company page owns both
// fields, and duplicating an editor here would give the same value two
// homes that could disagree.
//
// The three chips always render, even with no targets written down —
// "reports under CSRD but has published no targets" is a finding in its
// own right, and a row that vanished would hide it.
function SustainabilityTargets({ profile, prospect, listMatched, unnamed }) {
  const muted = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' };
  if (unnamed) {
    return <div style={muted}>Add a company name to pull its targets across.</div>;
  }
  // No company record is no longer the end of the row. A company can be
  // researched from its company page without ever being added to the
  // table, and that research — targets, frameworks, the published reports
  // — is exactly what this row is for; refusing to show it because a
  // record is missing threw away the answer while claiming there wasn't
  // one.
  const targets = profile.targets;
  const statuses = reportingStatus(profile.frameworks, listMatched);
  const empty = describeSustainability(profile, { hasProspect: !!prospect });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
        {statuses.map(({ label, reported, name }) => {
          const c = reported ? REPORTED_COLORS : NOT_REPORTED_COLORS;
          return (
            <span
              key={label}
              title={`${name} — ${reported ? 'reported' : 'not reported'}. Set on the company page's Frameworks field.`}
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                borderRadius: 4, whiteSpace: 'nowrap',
                background: c.bg, color: c.text, border: `1px solid ${c.border}`,
              }}
            >{reported ? '\u2713' : '\u2013'} {label}</span>
          );
        })}

        {/* Frameworks the research confirmed that aren't one of the three
            regimes above. A company whose only framework is UN PRI used to
            render as three dashes — nothing found — when something had. */}
        {profile.otherFrameworks.map(label => (
          <span
            key={label}
            title={`${label} — found by research. Not one of the three disclosure regimes screened above.`}
            style={{
              fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem',
              borderRadius: 4, whiteSpace: 'nowrap',
              background: REPORTED_COLORS.bg, color: REPORTED_COLORS.text,
              border: `1px solid ${REPORTED_COLORS.border}`,
            }}
          >{'\u2713'} {label}</span>
        ))}

        {/* Named in the research narrative, absent from its own structured
            list. The two halves of one research run disagreeing is worth
            surfacing, not resolving by picking a side: the summary repeats
            what a company says about itself, while the list is held to
            direct evidence of a published report. */}
        {profile.claimedFrameworks.map(label => (
          <span
            key={`claimed-${label}`}
            title={`${label} — the research narrative says this company reports under it, but the run found no published report to confirm it. Check the reports below before relying on it.`}
            style={{
              fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem',
              borderRadius: 4, whiteSpace: 'nowrap',
              background: '#FEF9C3', color: '#854D0E', border: '1px solid #FDE68A',
            }}
          >? {label} claimed</span>
        ))}
      </div>
      {targets.length === 0 ? (
        <div style={muted}>{empty || 'No sustainability targets recorded on the company page.'}</div>
      ) : (
        <>
          <ul style={{ margin: 0, paddingLeft: '1.05rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
            {targets.map((t, i) => (
              <li key={`${i}-${t}`} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>{t}</li>
            ))}
          </ul>
          {/* Research that nobody has confirmed is labelled as such. A
              machine's reading of a company's commitments is a good
              starting point and a bad thing to quote back as fact. */}
          {profile.targetsSource === 'research' && (
            <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
              From Claude research, not yet confirmed on the company page.
            </div>
          )}
        </>
      )}

      {/* The published reports the research turned up. These are the
          documents a screening decision gets checked against, so they
          belong next to the targets rather than one page away. */}
      {profile.reports.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'baseline' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-muted)' }}>
            Reports
          </span>
          {profile.reports.map(r => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              title={r.title}
              style={{
                fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-accent)',
                maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >{r.title}{r.year ? ` (${r.year})` : ''}</a>
          ))}
        </div>
      )}

      {profile.summary && (
        <div
          title={profile.programs.length ? profile.programs.map(x => `• ${x}`).join('\n') : undefined}
          style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', lineHeight: 1.35 }}
        >
          {profile.summary}
          {profile.programs.length > 0 && (
            <span style={{ fontWeight: 700 }}> · {profile.programs.length} programme{profile.programs.length === 1 ? '' : 's'}</span>
          )}
        </div>
      )}
    </div>
  );
}

function CardRow({ label, children, first }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: '0.6rem',
      padding: '0.5rem 0', alignItems: 'start',
      borderTop: first ? 'none' : '1px solid var(--color-border)',
    }}>
      <div style={{
        fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.04em', color: 'var(--color-text-muted)', paddingTop: '0.1rem',
      }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// North America / Europe / Rest of World split of a site count, rendered
// as inline "· 180 North America" segments after the total. All three
// headline buckets always show (a zero reads as "none there", which is
// itself the answer); Unknown only appears when sites couldn't be placed,
// so the segments always add back up to the total. Each segment's hover
// lists the countries behind it.
function RegionBreakdown({ summary }) {
  if (!summary || summary.total === 0) return null;
  const buckets = SITE_REGION_ORDER.filter(
    region => region !== UNKNOWN_REGION || summary.counts[region] > 0
  );
  return (
    <>
      {buckets.map((region) => {
        const count = summary.counts[region] || 0;
        const title = region === UNKNOWN_REGION
          ? 'Sites with no country on the upload and no recognizable US state or Canadian province. Map a Country column on the Utility Lookup tab to place them.'
          : `${region}: ${regionCountryLabel(summary.countries[region])}`;
        return (
          <Fragment key={region}>
            {' · '}
            <span title={title} style={{ whiteSpace: 'nowrap', opacity: count === 0 ? 0.55 : 1 }}>
              <strong style={{ color: count === 0 ? 'inherit' : 'var(--color-text)' }}>{count}</strong>
              {' '}{region}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

// Rows the California count deliberately left out: a California State
// with a country that isn't the US. Reported rather than silently
// dropped — a "CA" State on non-US rows is almost always a mis-mapped
// State / Country column, and the number is the user's cue to fix it.
// Renders nothing when every "CA" row checks out, which is the norm.
function CaExcludedNote({ excluded }) {
  if (!excluded || excluded.length === 0) return null;
  const n = excluded.reduce((sum, c) => sum + c.count, 0);
  return (
    <span
      title={`${n} row${n === 1 ? '' : 's'} with a California State ${n === 1 ? 'was' : 'were'} left out of this count because ${n === 1 ? 'its' : 'their'} Country isn't the United States (${regionCountryLabel(excluded)}). "CA" also arrives as a country code for Canada and as a Spanish province: check the State / Country column mapping on the Utility Lookup tab if these should have counted.`}
      style={{ marginLeft: '0.3rem', color: '#B45309', cursor: 'help' }}
    >
      · {n} non-US &ldquo;CA&rdquo; {n === 1 ? 'row' : 'rows'} excluded ⚠
    </span>
  );
}


// Compliance research filed against a company key no company on this page
// carries. Usually that's simply another company, screened when a different
// site list was loaded — the page shows one portfolio at a time, so most of
// this list is history rather than a problem. It matters in one case: a
// company renamed (the portfolio field retyped, a different Company Name
// column mapped) files later work under the new name and leaves the earlier
// work behind, and moving it across is how that's undone.
//
// So it stays folded away by default and says what it is, rather than
// announcing every company ever screened as though something had gone wrong.
function OtherCompanyResearchPanel({ stranded, companies, onReattach }) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState({});
  if (companies.length === 0) return null;
  const only = companies.length === 1 ? companies[0].key : '';
  return (
    <div style={{
      margin: '0 0 0.6rem', fontSize: 'var(--font-size-xs)',
      color: 'var(--color-text-muted)',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 'var(--font-size-xs)', fontFamily: 'inherit', padding: 0,
          border: 'none', background: 'transparent', color: 'var(--color-text-muted)',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? '▾' : '▸'} Compliance research saved for {stranded.length} other{' '}
        {stranded.length === 1 ? 'company' : 'companies'}
        {open ? '' : ': kept, not shown on this page'}
      </button>
      {open && (
        <div style={{
          marginTop: '0.35rem', padding: '0.45rem 0.6rem',
          border: '1px solid var(--color-border-light)', borderRadius: 6,
          background: 'var(--color-bg)',
        }}>
          <div style={{ marginBottom: '0.35rem', lineHeight: 1.4 }}>
            Screened when a different site list was loaded, and kept for when it
            comes back. Nothing here needs doing: unless one of them is a
            company on this page under an old name, in which case move it over.
          </div>
          {stranded.map((row) => {
            const target = picks[row.key] || only;
            return (
              <div key={row.key} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                flexWrap: 'wrap', padding: '0.15rem 0',
              }}>
                <strong style={{ color: 'var(--color-text)' }}>{row.key}</strong>
                <span>- {describeStranded(row.parts)}</span>
                <select
                  value={target}
                  onChange={(e) => setPicks(m => ({ ...m, [row.key]: e.target.value }))}
                  aria-label={`Move ${row.key} research to`}
                  style={{
                    fontSize: '0.68rem', fontFamily: 'inherit', padding: '0.1rem 0.25rem',
                    border: '1px solid var(--color-border)', borderRadius: 4,
                  }}
                >
                  <option value="">Move to…</option>
                  {companies.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => {
                    const to = companies.find(c => c.key === target);
                    if (!to) return;
                    // Naming both ends: the move clears the old key, so a
                    // wrong pick here isn't a click away from undoing.
                    if (!window.confirm(`Move the research saved under "${row.key}" (${describeStranded(row.parts)}) onto ${to.name}?\n\nDo this only if they are the same company. Anything already recorded against ${to.name} is kept: this only fills in what's missing.`)) return;
                    onReattach(row.key, target);
                  }}
                  style={{
                    fontSize: '0.62rem', fontWeight: 700, fontFamily: 'inherit',
                    padding: '0.1rem 0.45rem', borderRadius: 4,
                    cursor: target ? 'pointer' : 'default',
                    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                    color: 'var(--color-text-muted)', opacity: target ? 1 : 0.5,
                  }}
                >Move</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CorporateCompliance({ sites = [], settings, updateSettingsPath, prospects = [], updateProspect }) {
  // Map each canonical company key to a matching prospect (company) record,
  // so researched revenue can be written onto that company's popup field and
  // its current revenue can be surfaced here. Keyed the same way companies on
  // this page are (companyKeyOf → normalized name), so cosmetic spelling
  // differences still line up.
  const prospectByKey = useMemo(() => {
    const map = new Map();
    for (const p of prospects || []) {
      const key = companyKeyOf(p?.company);
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [prospects]);
  const companies = useMemo(() => {
    // Group by the canonical company key (the file-matching identity), so
    // name variants collapse onto one company and its saved answers.
    const byKey = new Map();
    for (const site of sites) {
      const rawName = String(site.company || '').trim();
      const key = companyKeyOf(rawName);
      const mapKey = key || '__unnamed__';
      if (!byKey.has(mapKey)) {
        byKey.set(mapKey, { key, total: 0, california: 0, caSites: [], sites: [], names: new Map() });
      }
      const entry = byKey.get(mapKey);
      entry.total += 1;
      entry.sites.push(site);
      if (rawName) entry.names.set(rawName, (entry.names.get(rawName) || 0) + 1);
      if (isCaliforniaSite(site)) {
        entry.california += 1;
        if (site.siteName || site.city) {
          entry.caSites.push([site.siteName, site.city].filter(Boolean).join(': '));
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
      return {
        key: e.key, name, total: e.total, california: e.california, caSites: e.caSites,
        // North America / Europe / Rest of World split of this company's
        // sites, with the per-country detail behind the hover.
        regions: summarizeSiteRegions(e.sites),
        // "CA" State rows the country test rejected — reported next to
        // the California count so the exclusion is visible.
        caExcluded: excludedCaliforniaCountries(e.sites),
      };
    });
    return out.sort(
      (a, b) => b.california - a.california || b.total - a.total || a.name.localeCompare(b.name)
    );
  }, [sites]);

  const totalCA = companies.reduce((sum, c) => sum + c.california, 0);
  // Portfolio-wide region split for the summary line above the cards —
  // computed off every uploaded site, so it matches the sum of the cards.
  const totalRegions = useMemo(() => summarizeSiteRegions(sites), [sites]);
  const totalCaExcluded = useMemo(() => excludedCaliforniaCountries(sites), [sites]);

  // Persisted revenue-research blobs keyed by company slug (synced via
  // settings.companyRevenueResearch). Transient loading / error state per
  // company lives in local state; the resolved data is read back from
  // settings so it survives reloads and syncs across devices.
  // Memoized so the `|| {}` fallback isn't a new object every render — the
  // HQ callbacks below take it as a dependency.
  const revenueResearch = useMemo(() => settings?.companyRevenueResearch || {}, [settings?.companyRevenueResearch]);
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

  // Each company's ultimate parent, keyed the same way the screening
  // answers are (the canonical company identity, not a raw-name slug) so
  // the two travel together. Blank means the company is its own parent.
  // Memoized like the other settings-backed maps on this page: the `|| {}`
  // fallback is a fresh object every render, and parentOf is now a
  // dependency of the revenue research, which would churn on each one.
  const parentCompanies = useMemo(
    () => settings?.corporateComplianceParent || {},
    [settings?.corporateComplianceParent],
  );
  const setParentCompany = useCallback((slug, value) => {
    if (!updateSettingsPath || !slug) return;
    updateSettingsPath({ [`corporateComplianceParent.${slug}`]: String(value || '').trim() || null });
  }, [updateSettingsPath]);

  // Saved "Research with Claude" runs, keyed by a slug of the company
  // name. The company page writes them; this page reads them, so a
  // company researched there needs no second run here.
  const companyResearch = useMemo(
    () => settings?.companyResearch || {},
    [settings?.companyResearch],
  );

  const parentOf = useCallback(
    (key) => String(parentCompanies[key] || '').trim(),
    [parentCompanies],
  );

  // Reference URLs this page used to file per company (company slug →
  // question or regulation key). Nothing writes here any more — links belong
  // to the row, not the company — but it's still read as a fallback, and the
  // promotion effect below lifts what's in it into the shared map.
  const complianceLinks = useMemo(
    () => settings?.companyComplianceLinks || {},
    [settings?.companyComplianceLinks],
  );
  // Manual findings the user recorded from each reference link. Its own map
  // for the same reason the links are: never confusable with an answer.
  const complianceFindings = settings?.companyComplianceFindings || {};
  const setComplianceFinding = (slug, key, text) => {
    if (!updateSettingsPath || !slug) return;
    updateSettingsPath({ [`companyComplianceFindings.${slug}.${key}`]: text || null });
  };
  // Every reference link on this page — the statute, the regulator's
  // guidance, the register somebody checks. None of it changes from company
  // to company, so it's filed by row key alone rather than under a company,
  // and shows on every card. Filing them per company was why a link pasted
  // on one card was missing on the next, and why renaming a company (or
  // re-uploading the site list under a different name) lost them outright.
  const sharedLinks = useMemo(
    () => settings?.complianceReferenceLinks || {},
    [settings?.complianceReferenceLinks],
  );
  const setSharedLink = useCallback((key, url) => {
    if (!updateSettingsPath || !key) return;
    updateSettingsPath({ [`complianceReferenceLinks.${key}`]: url || null });
  }, [updateSettingsPath]);

  // One-time lift of the per-company links into the shared map, so links
  // recorded before this stop being invisible on every other company. Runs
  // only when there's something to lift and stamps itself, so deleting a
  // shared link afterwards doesn't resurrect it from the old copy. Anything
  // already shared wins; where companies disagreed on a row, the URL the most
  // of them recorded does (ties break on company key, so it's deterministic).
  // The per-company copies are left where they are — this adds, never
  // destroys, and they still serve as the read fallback.
  useEffect(() => {
    if (!updateSettingsPath || settings?.complianceLinksPromotedAt) return;
    const byRow = new Map();
    for (const [companyKey, rows] of Object.entries(settings?.companyComplianceLinks || {})) {
      if (!rows || typeof rows !== 'object') continue;
      for (const [rowKey, url] of Object.entries(rows)) {
        if (!rowKey || typeof url !== 'string' || !url.trim()) continue;
        if (sharedLinks[rowKey]) continue;
        if (!byRow.has(rowKey)) byRow.set(rowKey, new Map());
        const votes = byRow.get(rowKey);
        const prior = votes.get(url) || { count: 0, firstCompany: companyKey };
        votes.set(url, { count: prior.count + 1, firstCompany: prior.firstCompany });
      }
    }
    if (byRow.size === 0) return;
    const updates = { complianceLinksPromotedAt: Date.now() };
    for (const [rowKey, votes] of byRow) {
      const [url] = [...votes.entries()].sort(
        (a, b) => b[1].count - a[1].count || a[1].firstCompany.localeCompare(b[1].firstCompany),
      )[0];
      updates[`complianceReferenceLinks.${rowKey}`] = url;
    }
    updateSettingsPath(updates);
  }, [settings?.complianceLinksPromotedAt, settings?.companyComplianceLinks, sharedLinks, updateSettingsPath]);

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

  // Headquarters, keyed by company slug (settings.companyHqResearch). Its own
  // map rather than a field on the revenue blob, because the curated
  // /api/hq-lookup can fill it without a research run — and because the HQ
  // Location the My Accounts page already stores lives outside that blob too.
  const hqResearch = useMemo(() => settings?.companyHqResearch || {}, [settings?.companyHqResearch]);

  // Figures typed over the research, keyed by the same company slug
  // (settings.companyFactEdits). Held apart from the research rather than
  // written into it so "Re-run research" cannot silently discard a
  // correction, and so the card can still say what it was corrected from.
  const factEdits = useMemo(() => settings?.companyFactEdits || {}, [settings?.companyFactEdits]);

  const setFactEdit = useCallback((name, field, value) => {
    const slug = revenueSlug(name);
    if (!slug || !updateSettingsPath) return;
    // null clears the override and hands the row back to the research,
    // which is how an edit is undone.
    updateSettingsPath({ [`companyFactEdits.${slug}.${field}`]: value ?? null });
  }, [updateSettingsPath]);
  // HQ Locations the My Accounts page auto-detected, keyed by prospect id.
  // Read as a fallback so a company already looked up over there doesn't have
  // to be looked up again here.
  const hqRegionMap = useMemo(() => settings?.hqRegionMap || {}, [settings?.hqRegionMap]);
  const [hqState, setHqState] = useState({});

  // Everything this card knows about one company's HQ, resolved from the
  // three sources in priority order: this row's own lookup, the revenue
  // research run, then the My Accounts HQ Location column. The region is
  // whatever was explicitly set or researched, else derived from the
  // location, else the value already on the company record.
  const hqInfoFor = useCallback((name) => {
    const slug = revenueSlug(name);
    const saved = hqResearch[slug] || null;
    const rev = revenueResearch[slug] || null;
    const prospect = prospectByKey.get(companyKeyOf(name)) || null;
    const fromAccounts = prospect?.id ? String(hqRegionMap[prospect.id] || '').trim() : '';

    const researchedLocation = String(saved?.location || '').trim()
      || String(rev?.headquarters || '').trim()
      || fromAccounts;
    // A typed HQ outranks all three research sources. The region is then
    // derived from whatever the card actually shows, so correcting the
    // location moves the North America call with it.
    const { hqLocation } = resolveCompanyFacts({
      edits: factEdits[slug] || null,
      hqLocation: researchedLocation,
    });
    const location = hqLocation.value || '';
    const source = hqLocation.edited ? 'entered by hand'
      : saved?.location ? 'HQ lookup'
      : rev?.headquarters ? 'revenue research'
      : fromAccounts ? 'My Accounts HQ Location' : '';

    const region = normalizeHqRegion(saved?.region)
      || normalizeHqRegion(rev?.hqRegion)
      || classifyHqRegion(location)
      || normalizeHqRegion(prospect?.hqRegion);

    return { slug, location, source, region, prospect, locationFact: hqLocation };
  }, [hqResearch, revenueResearch, hqRegionMap, prospectByKey, factEdits]);

  // Revenue and headcount as the card shows them: the research with any
  // hand-entered correction on top. One resolution feeds the rows AND the
  // screening below, so a corrected headcount changes the CSRD answer
  // rather than only the figure above it.
  const factsFor = useCallback((name) => resolveCompanyFacts({
    edits: factEdits[revenueSlug(name)] || null,
    revenueResearch: revenueResearch[revenueSlug(name)] || null,
  }), [factEdits, revenueResearch]);

  /**
   * The revenue the thresholds are tested against, and whose it is.
   *
   * Every regime this page screens measures the CONSOLIDATED group — CSRD
   * catches a subsidiary through its ultimate parent, SB 253 and SB 261 are
   * written against the parent entity's total annual revenues — but a
   * company large enough on its own is caught whatever its owner turns over.
   * Either figure can trigger a mandate, so the larger of the two is the
   * test subject (see pickThresholdRevenue). `entity` names the parent only
   * when the parent's number is the one under test.
   */
  const thresholdRevenueFor = useCallback((key, name, facts) => {
    const own = String(facts?.revenue?.value || '').trim()
      || String(prospectByKey.get(key)?.revenue || '').trim();
    const parent = parentOf(key);
    return pickThresholdRevenue({
      own,
      parent: parent ? String(revenueResearch[revenueSlug(parent)]?.revenue || '').trim() : '',
      parentName: parent,
    });
  }, [parentOf, revenueResearch, prospectByKey]);

  // Push a known HQ onto the matching company record — the reason this row
  // exists. Only fills blanks: an HQ Region already chosen on the popup, or
  // an HQ Location already set in My Accounts, is left exactly as it is.
  const applyHqToProspect = useCallback((name, location, region) => {
    const prospect = prospectByKey.get(companyKeyOf(name));
    if (!prospect?.id) return;
    const normRegion = normalizeHqRegion(region);
    if (normRegion && updateProspect && !normalizeHqRegion(prospect.hqRegion)) {
      updateProspect(prospect.id, { hqRegion: normRegion });
    }
    // The location goes to the same map the My Accounts HQ Location column
    // reads, keyed by prospect id. Guarded because that id becomes a
    // Firestore dotted field-path segment: an id carrying a dot or one of
    // the reserved characters would address the wrong (or no) field.
    const loc = String(location || '').trim();
    const idSafe = prospect.id && !/[.~*/[\]]/.test(prospect.id);
    if (loc && idSafe && updateSettingsPath && !String(hqRegionMap[prospect.id] || '').trim()) {
      updateSettingsPath({ [`hqRegionMap.${prospect.id}`]: loc });
    }
  }, [prospectByKey, updateProspect, updateSettingsPath, hqRegionMap]);

  // Curated HQ lookup — the same endpoint the My Accounts "Auto-detect HQ
  // Location" button uses. Instant and free where it hits; where it misses,
  // the revenue research run (which now reports headquarters too) fills it.
  const lookupHq = useCallback(async (name) => {
    const company = String(name || '').trim();
    if (!company || company === UNNAMED) return;
    const slug = revenueSlug(company);
    setHqState(s => ({ ...s, [company]: { loading: true, error: null, notFound: false } }));
    try {
      const r = await apiFetch('/api/hq-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: [company] }),
      });
      if (!r.ok) {
        const txt = await r.text();
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { msg = txt.slice(0, 200) || msg; }
        setHqState(s => ({ ...s, [company]: { loading: false, error: msg, notFound: false } }));
        return;
      }
      const json = await r.json();
      const location = String(json?.results?.[company]?.location || '').trim();
      if (!location) {
        setHqState(s => ({ ...s, [company]: { loading: false, error: null, notFound: true } }));
        return;
      }
      const region = classifyHqRegion(location);
      setHqState(s => ({ ...s, [company]: { loading: false, error: null, notFound: false } }));
      if (updateSettingsPath && slug) {
        updateSettingsPath({ [`companyHqResearch.${slug}`]: { location, region, savedAt: Date.now() } });
      }
      applyHqToProspect(company, location, region);
    } catch (err) {
      setHqState(s => ({ ...s, [company]: { loading: false, error: err?.message || 'Request failed', notFound: false } }));
    }
  }, [updateSettingsPath, applyHqToProspect]);

  // Hand-set region. Saved as an override on this card's own map (so it wins
  // over anything researched) and pushed to the company record when that
  // field is still blank.
  const setHqRegion = useCallback((name, value) => {
    const company = String(name || '').trim();
    const slug = revenueSlug(company);
    if (!slug || !updateSettingsPath) return;
    const region = normalizeHqRegion(value);
    updateSettingsPath({ [`companyHqResearch.${slug}.region`]: region || null });
    if (region) applyHqToProspect(company, '', region);
  }, [updateSettingsPath, applyHqToProspect]);

  // Self-reference for the parent chain below. A useCallback can't call
  // itself by name without becoming its own dependency, and the chained
  // run is the same function with the parent step switched off.
  const researchRevenueRef = useRef(null);

  // `applyParent` is on for a card's own run and off for the chained run
  // against the parent it just found — one level only, so a group three
  // deep doesn't walk itself up the tree on a single click.
  const researchRevenue = useCallback(async (name, { applyParent = true } = {}) => {
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
      // Also write the headline revenue figure onto the matching company
      // (prospect) record, so it shows on that company's popup and in the
      // TableView Revenue column. Only when a company record exists and the
      // research produced a figure.
      const revenue = String(data.revenue || '').trim();
      if (updateProspect && revenue) {
        const match = prospectByKey.get(companyKeyOf(company));
        if (match?.id && match.revenue !== revenue) {
          updateProspect(match.id, { revenue });
        }
      }
      // Same for the headquarters this run reported — it fills the popup's
      // HQ Region field and the My Accounts HQ Location column when either
      // is still blank.
      applyHqToProspect(
        company,
        data.headquarters,
        normalizeHqRegion(data.hqRegion) || classifyHqRegion(data.headquarters),
      );
      // The parent, which every regime on this page actually tests its
      // thresholds against. Filled only when the card has none — a parent
      // the user typed is a decision, and research doesn't get to overrule
      // it. On first discovery the parent's own revenue is researched too:
      // a named parent with no figure leaves the Compliance rows below
      // still derived from the subsidiary, which is the thing naming it
      // was meant to fix.
      const foundParent = applyParent ? String(data.parentCompany || '').trim() : '';
      const key = foundParent ? companyKeyOf(company) : '';
      if (key && !parentOf(key)) {
        setParentCompany(key, foundParent);
        researchRevenueRef.current?.(foundParent, { applyParent: false });
      }
    } catch (err) {
      setRevState(s => ({ ...s, [company]: { loading: false, error: err?.message || 'Request failed' } }));
    }
  }, [updateSettingsPath, updateProspect, prospectByKey, applyHqToProspect, parentOf, setParentCompany]);
  researchRevenueRef.current = researchRevenue;

  // Persisted compliance-research blobs (per-question verdicts + rationale
  // + sources), keyed by the canonical company key so they line up with the
  // screening answers. Transient loading / error lives in local state.
  const complianceResearch = settings?.companyComplianceResearch || {};

  // Compliance work filed under a company key that no company on this page
  // carries any more — what a rename leaves behind. The links, findings and
  // answers are all still in settings; nothing on screen reads them, which is
  // what makes a rename look like the page threw the work away.
  const strandedResearch = useMemo(() => {
    const live = new Set(companies.map(c => c.key).filter(Boolean));
    const byKey = new Map();
    for (const m of COMPLIANCE_MAPS) {
      const map = settings?.[m.setting] || {};
      for (const [key, value] of Object.entries(map)) {
        if (!key || live.has(key) || !value || typeof value !== 'object') continue;
        const count = m.whole ? 1 : Object.keys(value).length;
        if (!count) continue;
        if (!byKey.has(key)) byKey.set(key, { key, parts: [] });
        byKey.get(key).parts.push({ noun: m.noun, count });
      }
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [settings, companies]);

  // Move one stranded key's work onto a company that's on the page. Anything
  // already recorded under the target wins — the point is to recover work,
  // never to overwrite newer work with older. The old key is cleared once
  // its contents have been folded in, so the panel empties as it's used.
  const reattachResearch = useCallback((fromKey, toKey) => {
    if (!updateSettingsPath || !fromKey || !toKey || fromKey === toKey) return;
    const updates = {};
    for (const m of COMPLIANCE_MAPS) {
      const map = settings?.[m.setting] || {};
      const from = map[fromKey];
      if (!from || typeof from !== 'object') continue;
      const to = map[toKey];
      if (m.whole) {
        // One blob per company (the research run) — keep the target's, since
        // a rerun under the new name is the fresher of the two.
        if (!to) updates[`${m.setting}.${toKey}`] = from;
      } else {
        updates[`${m.setting}.${toKey}`] = { ...from, ...(to || {}) };
      }
      updates[`${m.setting}.${fromKey}`] = null;
    }
    if (Object.keys(updates).length > 0) updateSettingsPath(updates);
  }, [settings, updateSettingsPath]);

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
      // Fill each dropdown. Unknown is persisted as a real answer rather
      // than cleared — "we looked and couldn't tell" is a different state
      // from "nobody has looked", and clearing it also used to hide that
      // jurisdiction's mandates entirely. Anything unrecognised still
      // clears, so a malformed verdict can't stick.
      for (const q of JURISDICTION_QUESTIONS) {
        const a = answers[q.key];
        // Only write a verdict we recognise. An unrecognised one used to
        // clear the cell, which quietly destroyed an answer the user had
        // set by hand — and with it the jurisdiction's regulation rows and
        // every reference link attached to them. A malformed verdict still
        // can't stick; it just no longer takes the old answer down with it.
        if (SCREENING_ANSWERS.includes(a)) {
          updates[`corporateComplianceScreening.${key}.${q.key}`] = a;
        }
      }
      // Keep the rationale + sources alongside so the card can explain itself.
      // `csrd` holds the researched CSRD inputs and `cbam` the two import
      // verdicts CBAM screens on, which the EU criteria rows derive from —
      // stored rather than written straight into the answers so a
      // hand-entered value still wins and re-running research doesn't
      // overwrite it. A run from before CBAM was researched simply has no
      // `cbam` key, and those rows stay open, which is what they were.
      updates[`companyComplianceResearch.${key}`] = {
        notes: data.notes || {},
        summary: String(data.summary || ''),
        sources: Array.isArray(data.sources) ? data.sources : [],
        csrd: data.csrd && typeof data.csrd === 'object' ? data.csrd : null,
        csrdNotes: data.csrdNotes && typeof data.csrdNotes === 'object' ? data.csrdNotes : null,
        cbam: data.cbam && typeof data.cbam === 'object' ? data.cbam : null,
        cbamNotes: data.cbamNotes && typeof data.cbamNotes === 'object' ? data.cbamNotes : null,
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
        Screen each company against the corporate disclosure regimes: <strong>California</strong>{' '}
        (SB 253 / SB 261), <strong>EU</strong> (CSRD), <strong>UK</strong>, <strong>Australia</strong>,{' '}
        <strong>Mexico</strong>, and <strong>Brazil</strong>: with the six gating questions on each card.
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
          Applies to every site without a mapped Company Name column: across all Utility Lookup subtabs.
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
            <strong style={{ color: 'var(--color-text)' }}>{totalRegions.total}</strong>{' '}
            {totalRegions.total === 1 ? 'site' : 'sites'}
            <RegionBreakdown summary={totalRegions} />
            {' · '}
            <strong style={{ color: '#166534' }}>{totalCA}</strong> California{' '}
            {totalCA === 1 ? 'site' : 'sites'}
            <CaExcludedNote excluded={totalCaExcluded} />
            {scanning && <span> · scanning lists…</span>}
          </div>
          {strandedResearch.length > 0 && (
            <OtherCompanyResearchPanel
              stranded={strandedResearch}
              companies={companies.filter(c => c.key)}
              onReattach={reattachResearch}
            />
          )}
          {/* One company per row — each card spans the full page width. */}
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr' }}>
            {companies.map((c) => {
              const matches = listMatches[c.name] || [];
              // Labels a *confirmed* Lists-page mapping supplies for this
              // company. Suggestions are excluded on purpose: the company
              // card treats only confirmed mappings as "Auto", so counting
              // fuzzy hits here would claim a disclosure the card doesn't.
              const reportedLists = matches.filter(m => m.state === 'mapped').map(m => m.list);
              // True while either the revenue or the jurisdiction research
              // for this company is in flight — drives the combined button.
              const anyResearching = !!revState[c.name]?.loading || !!screenState[c.key]?.loading;
              // Resolved HQ for this company (location + North America call),
              // drawn from whichever source has it.
              const hq = hqInfoFor(c.name);
              // Revenue and headcount, research with any correction on top.
              const facts = factsFor(c.name);
              // The entity the thresholds are measured at. Every regime on
              // this card tests the CONSOLIDATED group, so a recorded parent
              // whose revenue has been researched IS the test subject; with
              // no parent, or one nobody has researched yet, it stays this
              // company's own figure and nothing changes.
              const thresholdRevenue = thresholdRevenueFor(c.key, c.name, facts);
              // Targets, frameworks, programmes and published reports —
              // the curated company-page fields where they exist, the
              // saved Claude research where they don't.
              const sustainability = sustainabilityProfile({
                company: c.name,
                prospect: prospectByKey.get(c.key) || null,
                companyResearch,
              });
              return (
                <div key={c.key || c.name} style={{
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  background: 'var(--color-surface)', padding: '0.75rem 0.9rem',
                }}>
                  {/* Card header — company name on the left, one-click
                      research on the right. The button sizes to its label
                      (a full-width card would otherwise stretch it across
                      the whole page). The per-section buttons below still
                      re-run just one facet. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div
                      title={c.name}
                      style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {c.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => { researchRevenue(c.name); researchCompliance(c.name, c.key); }}
                      disabled={!c.key || anyResearching}
                      title="Research this company's annual revenue, answer all six jurisdiction questions, and fill the EU screening rows below them — the CSRD turnover and headcount figures, and what it imports into the EU for CBAM — in one go."
                      style={{
                        flexShrink: 0, padding: '0.4rem 0.8rem', borderRadius: 6,
                        border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff',
                        fontSize: 'var(--font-size-xs)', fontWeight: 700, fontFamily: 'inherit',
                        cursor: (!c.key || anyResearching) ? 'default' : 'pointer',
                        opacity: (!c.key || anyResearching) ? 0.55 : 1,
                      }}
                    >
                      {anyResearching ? 'Researching…' : '🔎 Research everything'}
                    </button>
                  </div>

                  {/* Everything below reads as an aligned label / value
                      table: one CardRow per section instead of stacked
                      blocks. */}
                  <div style={{ marginTop: '0.6rem' }}>
                    {/* Framework / List matches — first row on the card, so the
                        frameworks a company already reports to (GRESB, CDP, …)
                        read before the site / revenue detail. */}
                    <CardRow label={`Lists${c.name !== UNNAMED && matches.length > 0 ? ` (${matches.length})` : ''}`} first>
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
                    </CardRow>

                    <CardRow label="Sites">
                      {/* Two lines: the whole portfolio and its region
                          split, then the California count — which carries
                          its own trailing note, so running the two
                          together would read as one long list. */}
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <span>
                          {c.total} {c.total === 1 ? 'site' : 'sites'}
                          <RegionBreakdown summary={c.regions} />
                        </span>
                        {(c.california > 0 || c.caExcluded.length > 0) && (
                          <span>
                            <strong style={{ color: '#166534' }}>{c.california} in CA</strong>
                            <CaExcludedNote excluded={c.caExcluded} />
                          </span>
                        )}
                      </div>
                    </CardRow>

                    {/* Headquarters — where the company is based, and the
                        North America / Outside of North America call the
                        company popup stores. Sits above Revenue because the
                        jurisdiction questions below read in that order. */}
                    <CardRow label="HQ">
                      <HqSection
                        location={hq.location}
                        fact={hq.locationFact}
                        region={hq.region}
                        source={hq.source}
                        loading={!!hqState[c.name]?.loading}
                        error={hqState[c.name]?.error || null}
                        notFound={!!hqState[c.name]?.notFound}
                        disabled={c.name === UNNAMED}
                        onLookup={() => lookupHq(c.name)}
                        onSetRegion={(value) => setHqRegion(c.name, value)}
                        onEditLocation={(value) => setFactEdit(c.name, 'hqLocation', value)}
                        canApply={
                          !!hq.region && !!hq.prospect?.id
                          && !normalizeHqRegion(hq.prospect.hqRegion)
                        }
                        onApply={() => applyHqToProspect(c.name, hq.location, hq.region)}
                      />
                    </CardRow>

                    <CardRow label="Revenue">
                      <RevenueSection
                        data={revenueResearch[revenueSlug(c.name)] || null}
                        fact={facts.revenue}
                        loading={!!revState[c.name]?.loading}
                        error={revState[c.name]?.error || null}
                        disabled={c.name === UNNAMED}
                        onResearch={() => researchRevenue(c.name)}
                        onEdit={(value) => setFactEdit(c.name, 'revenue', value)}
                      />
                    </CardRow>

                    {/* Parent — sits directly under Revenue because it is
                        the same question asked of the other entity: every
                        regime here tests its thresholds at the consolidated
                        group, so a small subsidiary is caught by a large
                        parent. Either figure can trigger a mandate, so the
                        screening runs on whichever is larger. */}
                    {(() => {
                      const parent = parentOf(c.key);
                      return (
                        <CardRow label="Parent">
                          <ParentCompanySection
                            value={parent}
                            disabled={c.name === UNNAMED}
                            onSave={(value) => setParentCompany(c.key, value)}
                            revenue={parent ? (revenueResearch[revenueSlug(parent)] || null) : null}
                            revenueLoading={!!(parent && revState[parent]?.loading)}
                            revenueError={(parent && revState[parent]?.error) || null}
                            onResearch={() => researchRevenue(parent)}
                            screening={thresholdRevenue.entity === parent}
                            ownRevenue={facts.revenue.value || ''}
                          />
                        </CardRow>
                      );
                    })()}

                    {/* Employees — its own row rather than buried in the
                        Revenue hover, since headcount gates regimes in its
                        own right (e.g. CSRD's 1,000-employee threshold).
                        Comes from the same revenue-research run. */}
                    <CardRow label="Employees">
                      <EmployeesSection
                        data={revenueResearch[revenueSlug(c.name)] || null}
                        fact={facts.employees}
                        loading={!!revState[c.name]?.loading}
                        disabled={c.name === UNNAMED}
                        onEdit={(value) => setFactEdit(c.name, 'employees', value)}
                      />
                    </CardRow>

                    {/* Sustainability targets from the matched company card,
                        with whether the company actually discloses under
                        CSRD / IFRS / TCFD. Read-only here: the company page
                        owns both, and this screener is where they get used.
                        A target with no disclosure behind it is a different
                        conversation from one filed in an audited report, and
                        the screening questions below are the place that
                        distinction matters. */}
                    <CardRow label="Targets">
                      <SustainabilityTargets
                        profile={sustainability}
                        prospect={prospectByKey.get(c.key) || null}
                        listMatched={reportedLists}
                        unnamed={c.name === UNNAMED}
                      />
                    </CardRow>

                    {/* Jurisdiction screening — the six gating questions.
                        Keyed by the canonical company identity (c.key) so
                        answers save against the matched company from the
                        uploaded file, not a raw-name slug. */}
                    {/* Labelled "Compliance" rather than "Jurisdiction" so
                        the gutter doesn't repeat the table's own
                        Jurisdiction column header. */}
                    <CardRow label="Compliance">
                      <JurisdictionScreening
                        answers={screening[c.key] || null}
                        links={complianceLinks[c.key] || null}
                        findings={complianceFindings[c.key] || null}
                        onSetFindings={(fieldKey, text) => setComplianceFinding(c.key, fieldKey, text)}
                        sharedLinks={sharedLinks}
                        onSetSharedLink={setSharedLink}
                        caSiteCount={c.california}
                        // Prefills the CSRD Employee Count row.
                        employees={facts.employees.value}
                        // Feeds the derived SB 253 / SB 261 verdicts.
                        //
                        // The threshold entity, not necessarily this company:
                        // every regime here measures the consolidated group,
                        // and either side can trigger a mandate, so the
                        // larger of this company's revenue and its parent's
                        // is what the thresholds are tested against. Without
                        // a parent — or with one nobody has researched yet —
                        // this is the company's own figure, preferring the
                        // researched one and falling back to whatever the
                        // matched company record carries.
                        revenue={thresholdRevenue.label}
                        revenueEntity={thresholdRevenue.entity}
                        disabled={!c.key}
                        onSet={(qKey, value) => setScreeningAnswer(c.key, qKey, value)}
                        onResearch={() => researchCompliance(c.name, c.key)}
                        researching={!!screenState[c.key]?.loading}
                        researchError={screenState[c.key]?.error || null}
                        research={complianceResearch[c.key] || null}
                      />
                    </CardRow>

                    {c.caSites.length > 0 && (
                      <CardRow label="CA sites">
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>
                          {c.caSites.slice(0, 5).map((label, i) => (
                            <li key={i}>{label}</li>
                          ))}
                          {c.caSites.length > 5 && (
                            <li style={{ color: 'var(--color-text-muted)', listStyle: 'none', marginLeft: '-1.1rem' }}>
                              +{c.caSites.length - 5} more
                            </li>
                          )}
                        </ul>
                      </CardRow>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
