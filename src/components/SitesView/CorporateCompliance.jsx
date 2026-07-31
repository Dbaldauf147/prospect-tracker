import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { loadList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { userLsGet } from '../../utils/userLs';
import { apiFetch } from '../../utils/apiFetch';
import {
  JURISDICTION_QUESTIONS, SCREENING_ANSWERS, REGULATIONS_BY_JURISDICTION,
  deriveRegulationVerdict, parseRevenueUsd,
  JURISDICTION_CRITERIA_GROUPS, criterionKey,
  deriveCriterion, deriveDoingBusinessInCA, deriveCsrdWaveVerdict, californiaRevenueScreen,
} from '../../data/corporateComplianceScreening';

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

// Revenue block for one company card. Deliberately just the headline
// figure: the research still persists ownership, employee count, the
// written summary and its citations, but rendering all of it buried the
// one number this row exists for. The supporting detail moves to the
// hover title so it stays reachable. With no research yet, a "Research
// revenue" button asks Claude (with web search) for the company's most
// recent annual revenue. `disabled` guards the unnamed-company card,
// which has nothing to research.
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
      {data && (data.revenue || data.summary) ? (
        <>
          <span
            title={detail || undefined}
            style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}
          >
            {data.revenue || '—'}
          </span>
          {data.fiscalYear && <span style={{ fontSize: '0.65rem' }}>{data.fiscalYear}</span>}
          {btn(loading ? 'Researching…' : 'Re-run research')}
        </>
      ) : (
        <>
          <span style={{ fontStyle: 'italic' }}>
            {loading ? 'Researching revenue…' : 'Revenue: pending research'}
          </span>
          {btn(loading ? 'Researching…' : 'Research revenue')}
        </>
      )}
      {error && (
        <span style={{ color: '#B91C1C', fontSize: '0.65rem' }}>{error}</span>
      )}
    </div>
  );
}

// Total employees, from the same research blob the revenue row reads. Kept
// as its own row because headcount gates regimes independently of revenue
// (CSRD's 1,000-employee test, for one). No button of its own — the figure
// arrives with the revenue run, so "Re-run research" up there refreshes it.
function EmployeesSection({ data, loading }) {
  const count = Number(data?.employees);
  const has = Number.isFinite(count) && count > 0;
  return (
    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
      {has ? (
        <span style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
          {count.toLocaleString()}
        </span>
      ) : (
        <span style={{ fontStyle: 'italic' }}>
          {loading
            ? 'Researching employees…'
            : data
              ? 'Not reported'
              : 'Employees: pending research'}
        </span>
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
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
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
function ReferenceCell({ url, findings, onSaveUrl, onSaveFindings, label, disabled }) {
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

function ReferenceLink({ url, onSave, ariaLabel, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url || '');
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
      // than saved as a dead link; clearing the box removes the link.
      if (draft.trim() && !safeUrl(draft)) return;
      onSave(draft.trim() ? safeUrl(draft) : '');
      setEditing(false);
    };
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem' }}>
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
        <button type="button" onClick={() => { setDraft(url || ''); setEditing(false); }} title="Cancel" style={tiny}>✕</button>
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
        <button type="button" onClick={() => setEditing(true)} title="Edit link" style={tiny}>✎</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Add a reference URL for this question"
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
  research: { label: 'from research', title: 'Derived from the revenue research on this card. Pick a value to override.' },
  sites: { label: 'from sites', title: 'Counted from the uploaded site list — the California sites matched to this company. Pick a value to override.' },
  manual: { label: 'manual', title: 'Nothing on this page settles this one — answer it by hand.' },
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
      placeholder="—"
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
function JurisdictionScreening({ answers, links, onSetLink, findings, onSetFindings, caSiteCount = 0, revenue = '', employees = null, onSet, disabled, onResearch, researching, researchError, research }) {
  // Revenue drives the derived Applies? verdicts (SB 253 / SB 261). Parsed
  // once per render rather than per regulation row.
  const revenueLabel = String(revenue || '').trim();
  const revenueUsd = parseRevenueUsd(revenueLabel);
  // Inputs the California criteria derive themselves from, and the
  // one-of-three doing-business result they add up to. That result is what
  // gates SB 253 / SB 261 — the jurisdiction question alone only asks
  // whether the company operates or sells there.
  const criterionContext = {
    revenueUsd, revenueLabel, caSiteCount,
    employees: Number.isFinite(Number(employees)) && employees !== null && employees !== ''
      ? Number(employees) : null,
    // The CSRD figures the compliance research run turned up, plus its
    // per-field rationale for the tooltips.
    csrd: research?.csrd || null,
    csrdNotes: research?.csrdNotes || null,
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
                  <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}> — your link + notes</span>
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
                  .filter((k) => links?.[k] || findings?.[k]).length;
                return (
                  <Fragment key={q.key}>
                    <tr style={ruledOut ? ruledOutRow : undefined} title={ruledOut ? caRuledOutWhy : undefined}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{q.jurisdiction}</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>{q.question}</div>
                        {ruledOut && (
                          <div style={{ marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span style={{ color: '#991B1B', fontWeight: 700, fontSize: '0.62rem' }}>
                              Ruled out — under {caScreen.floorLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpandedRuledOut((m) => ({ ...m, [q.key]: !m[q.key] }))}
                              title={collapsed
                                ? 'Show the rows behind this verdict — editing one is how you undo it'
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
                            ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            : null}
                      </td>
                      <td style={td}>
                        <select
                          value={val}
                          onChange={(e) => onSet(q.key, e.target.value)}
                          aria-label={`${q.jurisdiction}: ${q.question}`}
                          style={answerSelectStyle(val)}
                        >
                          <option value="">—</option>
                          {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        <ReferenceCell
                          url={links?.[q.key] || ''}
                          findings={findings?.[q.key] || ''}
                          onSaveUrl={(v) => onSetLink?.(q.key, v)}
                          onSaveFindings={(v) => onSetFindings?.(q.key, v)}
                          label={q.jurisdiction}
                          disabled={disabled}
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
                      // California's rows aren't consequences of its answer —
                      // they're how you arrive at it, so hiding them until the
                      // question is answered would put the work behind the
                      // answer it supports. They stay always on. The EU's are
                      // what CSRD screens on once the company is already in
                      // scope, so they wait for a Yes (or an Unknown, still
                      // unresolved) — except any row already answered or
                      // annotated, which stays put rather than taking the
                      // user's work with it.
                      const gated = group.showWhenTriggered;
                      const triggered = val === 'Yes' || val === 'Unknown';
                      const shownRows = group.rows.filter((row) => {
                        if (!gated || triggered) return true;
                        const k = criterionKey(q.key, row.key);
                        return answers?.[k] || links?.[k] || findings?.[k];
                      });
                      if (shownRows.length === 0) return null;
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
                                  <span style={{ color: 'var(--color-text-muted)' }}>—</span>
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
                                      <option value="">—</option>
                                      {SCREENING_ANSWERS.map((a) => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                  )}
                                  <SourceBadge source={row.source} />
                                </div>
                                )}
                              </td>
                              <td style={td}>
                                <ReferenceCell
                                  url={links?.[cKey] || ''}
                                  findings={findings?.[cKey] || ''}
                                  onSaveUrl={(v) => onSetLink?.(cKey, v)}
                                  onSaveFindings={(v) => onSetFindings?.(cKey, v)}
                                  label={row.label}
                                  disabled={disabled}
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
                      // A regulation the user has attached a link or findings
                      // to stays on screen even when the jurisdiction answer
                      // no longer triggers it — their saved research should
                      // never disappear with the row.
                      const triggered = val === 'Yes' || val === 'Unknown';
                      if (!triggered && !(links?.[rKey] || findings?.[rKey])) return null;
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
                                <option value="">—</option>
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
                            <ReferenceCell
                              url={links?.[rKey] || ''}
                              findings={findings?.[rKey] || ''}
                              onSaveUrl={(v) => onSetLink?.(rKey, v)}
                              onSaveFindings={(v) => onSetFindings?.(rKey, v)}
                              label={r.regulation}
                              disabled={disabled}
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

// One aligned label / value row of a company "card table". The label sits
// in a fixed-width left gutter (top-aligned) so every section — Sites,
// Revenue, Jurisdiction, Lists, CA sites — lines up as table rows instead
// of stacked blocks. A top border draws the row separators.
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

  // Reference URLs the user attaches to each question / regulation. Kept in
  // their own map (company slug → question or regulation key) rather than
  // beside the answers, so a URL can never be read as a screening answer.
  const complianceLinks = settings?.companyComplianceLinks || {};
  // Manual findings the user recorded from each reference link. Its own map
  // for the same reason the links are: never confusable with an answer.
  const complianceFindings = settings?.companyComplianceFindings || {};
  const setComplianceFinding = (slug, key, text) => {
    if (!updateSettingsPath || !slug) return;
    updateSettingsPath({ [`companyComplianceFindings.${slug}.${key}`]: text || null });
  };
  const setComplianceLink = useCallback((slug, key, url) => {
    if (!updateSettingsPath || !slug) return;
    updateSettingsPath({ [`companyComplianceLinks.${slug}.${key}`]: url || null });
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
    } catch (err) {
      setRevState(s => ({ ...s, [company]: { loading: false, error: err?.message || 'Request failed' } }));
    }
  }, [updateSettingsPath, updateProspect, prospectByKey]);

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
      // `csrd` holds the researched CSRD inputs, which the EU criteria rows
      // derive from — stored rather than written straight into the answers so
      // a hand-entered value still wins and re-running research doesn't
      // overwrite it.
      updates[`companyComplianceResearch.${key}`] = {
        notes: data.notes || {},
        summary: String(data.summary || ''),
        sources: Array.isArray(data.sources) ? data.sources : [],
        csrd: data.csrd && typeof data.csrd === 'object' ? data.csrd : null,
        csrdNotes: data.csrdNotes && typeof data.csrdNotes === 'object' ? data.csrdNotes : null,
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
          {/* One company per row — each card spans the full page width. */}
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr' }}>
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
                      title="Research this company's annual revenue and answer all six jurisdiction questions in one go."
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
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        {c.total} {c.total === 1 ? 'site' : 'sites'}
                        {c.california > 0 && (
                          <>
                            {' · '}
                            <strong style={{ color: '#166534' }}>{c.california} in CA</strong>
                          </>
                        )}
                      </span>
                    </CardRow>

                    <CardRow label="Revenue">
                      <RevenueSection
                        data={revenueResearch[revenueSlug(c.name)] || null}
                        loading={!!revState[c.name]?.loading}
                        error={revState[c.name]?.error || null}
                        disabled={c.name === UNNAMED}
                        onResearch={() => researchRevenue(c.name)}
                      />
                    </CardRow>

                    {/* Employees — its own row rather than buried in the
                        Revenue hover, since headcount gates regimes in its
                        own right (e.g. CSRD's 1,000-employee threshold).
                        Comes from the same revenue-research run. */}
                    <CardRow label="Employees">
                      <EmployeesSection
                        data={revenueResearch[revenueSlug(c.name)] || null}
                        loading={!!revState[c.name]?.loading}
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
                        onSetLink={(fieldKey, url) => setComplianceLink(c.key, fieldKey, url)}
                        caSiteCount={c.california}
                        // Prefills the CSRD Employee Count row.
                        employees={revenueResearch[revenueSlug(c.name)]?.employees ?? null}
                        // Feeds the derived SB 253 / SB 261 verdicts. Prefer
                        // the researched figure shown in the Revenue row,
                        // falling back to whatever the matched company
                        // record already carries.
                        revenue={
                          revenueResearch[revenueSlug(c.name)]?.revenue
                          || prospectByKey.get(c.key)?.revenue
                          || ''
                        }
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
