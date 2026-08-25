import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeExcelWorkbook } from '../../utils/exportSanitize.js';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOpps2Newest, setOppField } from '../../utils/opps2Store';
import { formatAum } from '../../utils/formatters';
import { formatDateDisplay, toISODate, daysFromToday } from '../../utils/oppsCallIn';
import { PE_STAGES, STATUSES, STATUS_COLORS, TYPES, TIERS, GEOGRAPHIES } from '../../data/enums';
import { InlineCell } from '../TableView/TableView';
import { buildTypeOptions, buildCdmOptions, persistCustomOption, buildStrategyOptions, persistCustomStrategy, buildAssetTypeOptions } from '../../utils/prospectOptions';
import { TagMultiSelect } from '../common/TagMultiSelect';
import { computePortfolioFitScore, siteCountNumber, downloadPortfolioCompaniesWorkbook } from '../../utils/portfolioCompaniesWorkbook';
import { pickTopPortfolioCompany, buildStatusIndex, topPcCompanyKeys, TOP_PC_EXCLUDED_STATUSES } from '../../utils/topPortfolioCompany';
import { PEOppsScheduleModal } from './PEOppsScheduleModal';
import { CompanyNewsScheduleModal } from './CompanyNewsScheduleModal';
import { PEServicesReportModal } from './PEServicesReportModal';
import { DataTable } from '../common/DataTable';
import { PasteAddModal } from '../TableView/PasteAddModal';
import { splitPeOwners } from '../../utils/peOwners';
import { loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT } from '../../utils/clientManagerStore';
import { computeListFlags, LIST_FLAG_BY_LABEL } from '../../utils/listFlags';
import { useSavedAnalyses, formatAnalysisDate } from '../../hooks/useSavedAnalyses';
import { getServiceCategories, serviceBucketOf, UNGROUPED_SERVICES } from '../../utils/serviceCategoriesStore';
import { serviceStatusColor } from '../../utils/serviceStatusColors';

// Reference list behind the "Strategies" sub-tab — the core private-equity
// investment strategies, each with a short plain-language description. The
// user rates the value of each on a 0–10 slider; the score is saved per
// user in settings.peStrategyRatings keyed by strategy id.
const PE_STRATEGIES = [
  { id: 'buyout', name: 'Buyout / LBO', description: 'Acquire a controlling stake in a mature, cash-generative company, often using significant debt (leverage), then improve operations and exit for a return on equity.' },
  { id: 'growth', name: 'Growth Equity', description: 'Take minority stakes in established, fast-growing companies that need capital to scale (expansion, new markets, acquisitions), without a control change or heavy leverage.' },
  { id: 'venture', name: 'Venture Capital', description: 'Fund early-stage, high-growth startups in exchange for equity, accepting high failure rates in return for outsized returns from the winners.' },
  { id: 'growth_buyout', name: 'Middle-Market Buyout', description: 'Control buyouts of smaller mid-market businesses, where value is driven more by operational improvement and buy-and-build than by financial engineering.' },
  { id: 'distressed', name: 'Distressed / Special Situations', description: 'Invest in troubled companies (via debt, restructuring, or turnaround equity), betting on a recovery or a favorable outcome in bankruptcy/reorganization.' },
  { id: 'mezzanine', name: 'Mezzanine / Private Credit', description: 'Provide subordinated debt or direct loans that sit between senior debt and equity, earning higher yields plus occasional equity upside (warrants).' },
  { id: 'secondaries', name: 'Secondaries', description: 'Buy existing LP interests or portfolios of assets from other investors seeking early liquidity, typically at a discount to net asset value.' },
  { id: 'fund_of_funds', name: 'Fund of Funds', description: 'Invest in a diversified portfolio of other PE funds rather than companies directly, spreading manager and vintage-year risk for LPs.' },
  { id: 'infrastructure', name: 'Infrastructure', description: 'Own long-duration real assets (energy, transport, utilities, digital infrastructure), prized for stable, often inflation-linked cash flows.' },
  { id: 'real_estate', name: 'Real Estate', description: 'Acquire, develop, or reposition property across core, value-add, and opportunistic risk profiles for income plus capital appreciation.' },
];

// Reference list behind the "Categories" sub-tab within Strategies — the
// higher-level strategy categories, each with a short plain-language
// description. Same 0–10 value slider as the Investment Strategies list, but
// rated independently and saved per user in settings.peStrategyCategoryRatings.
const PE_STRATEGY_CATEGORIES = [
  { id: 'cat_venture', name: 'Venture Capital', description: 'Fund early-stage, high-growth startups in exchange for equity, accepting high failure rates in return for outsized returns from the winners.' },
  { id: 'cat_buyout', name: 'Buyout', description: 'Acquire a controlling stake in a mature, cash-generative company, often using significant debt (leverage), then improve operations and exit for a return on equity.' },
  { id: 'cat_real_estate', name: 'Real Estate', description: 'Acquire, develop, or reposition property across core, value-add, and opportunistic risk profiles for income plus capital appreciation.' },
  { id: 'cat_infrastructure', name: 'Infrastructure', description: 'Own long-duration real assets (transport, utilities, digital infrastructure), prized for stable, often inflation-linked cash flows.' },
  { id: 'cat_growth', name: 'Growth Equity', description: 'Take minority stakes in established, fast-growing companies that need capital to scale (expansion, new markets, acquisitions), without a control change or heavy leverage.' },
  { id: 'cat_energy', name: 'Energy', description: 'Invest across energy assets and companies (traditional and renewable power, oil & gas, transition infrastructure), for cash yield and long-term value.' },
  { id: 'cat_credit', name: 'Credit', description: 'Lend to companies through direct loans, mezzanine, or distressed debt, earning contractual yield that sits senior to equity, sometimes with equity upside.' },
];

// Reference list behind the "Case Study" sub-tab — the industries our
// experience spans. Each row's editable Company / Summary / Results cells
// are saved per user in settings.peCaseStudies, keyed by industry id.
const CASE_STUDY_INDUSTRIES = [
  { id: 'automotive', name: 'Automotive' },
  { id: 'food_bev', name: 'Food & Bev' },
  { id: 'hospitality', name: 'Hospitality' },
  { id: 'retail', name: 'Retail' },
  { id: 'manufacturing', name: 'Manufacturing' },
  { id: 'pharmaceutical', name: 'Pharmaceutical' },
  { id: 'oil_gas', name: 'Oil & Gas' },
  { id: 'transportation', name: 'Transportation' },
  { id: 'travel_tourism', name: 'Travel and Tourism' },
  { id: 'renewable_energy', name: 'Renewable Energy' },
  { id: 'microgrids', name: 'Microgrids' },
  { id: 'software', name: 'Software' },
  { id: 'chemicals', name: 'Chemicals' },
  { id: 'packaging', name: 'Packaging' },
  { id: 'aerospace_manufacturing', name: 'Aerospace Manufacturing' },
];

// Closed/invalid stages from the Opps tab — these shouldn't count toward "active pipeline".
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// Parse an Opps date cell (ISO or anything Date.parse handles) into a
// Date, or null when it's blank/unparseable. Mirrors Opps 2's toISODate
// so the PE Opps tab agrees with how dates are stored there.
function parseOppsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return isNaN(t) ? null : new Date(t);
}

// Values Opps 2 treats as "no data" in a numeric cell.
const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// Resolve a row's "Call In" the same way Opps 2 does: a blank-sentinel
// stored value wins (the cell was deliberately cleared); otherwise it's
// the live calendar-day count from today to the Follow Up date, falling
// back to the stored number when there's no parseable Follow Up.
function resolveCallIn(r) {
  if (r && 'Call In' in r) {
    const s = r['Call In'] == null ? '' : String(r['Call In']).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  const followUp = parseOppsDate(r['Follow Up']);
  if (followUp) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    followUp.setHours(0, 0, 0, 0);
    return Math.round((followUp - today) / 86400000);
  }
  if (r && 'Call In' in r) {
    const n = parseFloat(String(r['Call In']).replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// One palette for a PE Stage, shared by everything that paints one: the
// PE Stages board, the Days in Stage board, and the PE Stage column on the
// Portfolio table. It lived twice, copied between the two boards, and a
// third copy for the column would have made a drift between them a matter
// of time.
const PE_STAGE_META = [
  { stage: 'Discovery', accent: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  { stage: 'Piloting', accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  { stage: 'Existing Partnership', accent: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { stage: 'Not Sold', accent: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  { stage: 'Unassigned', accent: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' },
];

// A firm's stage as one of the five above — anything unrecognised (blank,
// or a value retired from PE_STAGES) reads as Unassigned rather than
// painting an unstyled chip.
function peStageOf(peStage) {
  return PE_STAGES.includes(peStage) ? peStage : 'Unassigned';
}

function peStageMeta(peStage) {
  const stage = peStageOf(peStage);
  return PE_STAGE_META.find(m => m.stage === stage) || PE_STAGE_META[PE_STAGE_META.length - 1];
}

// Same fuzzy match the My Accounts table uses, so the Opps column here agrees with that one.
function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  // Acronym / single-token match — catches "TIAA" vs "(TIAA) Teachers
  // Insurance and Annuity Association of America" by treating parens
  // as word separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// Resolve a company's Client Manager from the shared clients-manager-map
// the SAME way the company popup does (resolveClientManagerFromMap): try
// the exact normalized key first, then fall back to a fuzzy companiesMatch
// scan. The popup matched fuzzily while this view only did an exact-key
// lookup, so portfolio companies whose name drifts from the Clients-tab
// name (e.g. "Perform Properties fka ShopCore" vs "ShopCore") showed a
// blank Client Manager here even though the popup displayed one.
function resolveManagerFromMap(company, map) {
  const key = String(company || '').trim().toLowerCase();
  if (!key || !map) return '';
  if (map[key]) return map[key];
  for (const [k, v] of Object.entries(map)) {
    if (v && companiesMatch(k, company)) return v;
  }
  return '';
}

// Stricter matcher used only for tying an Opps record's Account to a
// company name (the PE firm or one of its portfolio companies). The
// general `companiesMatch` above is deliberately loose so contact/DM
// lookups catch acronyms and partial names — but that looseness
// over-counts opportunities: a single shared word (e.g. a portfolio
// company called "Origin" matching an unrelated "Origin Bank" deal) or a
// 60%-length substring would inflate a firm's active/total. Here we only
// accept an exact normalized match or a full multi-word phrase that one
// account name contains in the other, so the PE Opps count reflects deals
// that genuinely belong to the firm or its portfolio companies.
const CO_SUFFIX_RE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|holdings?)\b\.?/gi;
function normalizeAccount(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CO_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function accountMatchesCompany(companyName, oppAccount) {
  const a = normalizeAccount(companyName);
  const b = normalizeAccount(oppAccount);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const [shortW, longW] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  // Require the shorter side to be a multi-word phrase appearing verbatim
  // (with word boundaries) inside the longer one. A single shared word is
  // never enough — that's what produced the false-positive opp counts.
  if (shortW.length < 2) return false;
  return (' ' + longW.join(' ') + ' ').includes(' ' + shortW.join(' ') + ' ');
}

// Drop deals closed (Sold / Not Sold) more than a month ago — the same
// recency rule peOpps applies, factored out so the firm-scoped PE Opps
// view (which skips the Type/Source filter) can reuse it.
function oppWithinRecency(r) {
  const stage = String(r['Stage'] || '').trim().toLowerCase();
  if (stage === 'sold' || stage === 'not sold') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const closed = parseOppsDate(r['Close Date']);
    if (!closed || closed < cutoff) return false;
  }
  return true;
}

// A Table View prospect "belongs" to the selected PE firm when one of its
// PE Owner tokens matches the firm name. Deliberately a bidirectional
// substring test (not the stricter companiesMatch, which fails on the
// length ratio for "Blue Owl" ↔ "Blue Owl Capital") so the short
// canonical name still catches its longer variants — preserving the
// original Blue Owl tab's contains-match while generalizing it to any
// firm the user picks.
function prospectOwnedByFirm(peOwnerStr, firm) {
  const f = String(firm || '').trim().toLowerCase();
  if (!f) return false;
  return splitPeOwners(peOwnerStr).some(o => {
    const t = o.trim().toLowerCase();
    if (!t) return false;
    if (t.includes(f)) return true;              // owner ⊇ firm  ("Blue Owl Capital" ⊇ "Blue Owl")
    if (t.length >= 4 && f.includes(t)) return true; // firm ⊇ owner (picked a long name, owner uses a short variant)
    return false;
  });
}

// Firm name backing the dedicated "Blackstone Opps" sub-tab. Matched the
// same bidirectional way prospectOwnedByFirm / accountMatchesCompany work,
// so "Blackstone", "Blackstone Inc", and companies whose PE Owner names
// Blackstone all land in the tab.
const BLACKSTONE_FIRM = 'Blackstone';

// Narrow the PE Opps list to a single firm: every opp — regardless of
// Type / Source — whose Account matches the firm itself or one of its
// portfolio companies (the peOwner linkage), still dropping long-closed
// deals. An empty firm returns the unscoped PE Opps list. Shared by the
// PE Opps firm picker and the Blackstone tab so both filter identically.
function computeFirmScopedOpps(firm, peOpps, oppsRecords, prospects) {
  if (!String(firm || '').trim()) return peOpps;
  const names = new Set([firm.trim().toLowerCase()]);
  for (const p of prospects) {
    if (prospectOwnedByFirm(p.peOwner, firm)) {
      const n = (p.company || '').trim().toLowerCase();
      if (n) names.add(n);
    }
  }
  const nameList = [...names];
  return oppsRecords.filter(r => oppWithinRecency(r) && nameList.some(n => accountMatchesCompany(n, r['Account'])));
}

// Earliest opportunity Start Date across every opp that belongs to a PE
// firm — the firm itself or any of its portfolio companies (the same
// peOwner linkage computeFirmScopedOpps uses), but WITHOUT the
// long-closed-deal drop so a firm's genuinely-earliest opportunity still
// counts. Returns an ISO YYYY-MM-DD string, or null when the firm has no
// dated opportunity. Used to back-date a Discovery firm's "days in stage"
// clock to when its first opportunity opened, instead of the day the board
// first loaded.
function earliestFirmOppStartISO(firm, oppsRecords, prospects) {
  const f = String(firm || '').trim().toLowerCase();
  if (!f) return null;
  const names = new Set([f]);
  for (const p of prospects) {
    if (prospectOwnedByFirm(p.peOwner, firm)) {
      const n = (p.company || '').trim().toLowerCase();
      if (n) names.add(n);
    }
  }
  const nameList = [...names];
  let best = null;
  for (const r of oppsRecords) {
    if (!nameList.some(n => accountMatchesCompany(n, r['Account']))) continue;
    const iso = toISODate(r['Start Date']);
    if (!iso) continue;
    if (best == null || iso < best) best = iso; // ISO YYYY-MM-DD sorts chronologically
  }
  return best;
}

// Reads Opps 2 — the canonical opps store. Local IndexedDB first for
// speed; falls back to the user's Firestore `opps2Data` doc when the
// local cache is empty (e.g. fresh browser, never opened Opps 2 here
// yet) so this view doesn't show "No Opps data loaded" right after
// sign-in on a new machine.
function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    // Read the canonical Opps 2 store the way the rest of the app does:
    // the strictly-newer of the local IndexedDB cache and the Firestore
    // doc, with Firestore's chunked payload reassembled. The inline
    // reader this replaced only read the doc's `json` field and bailed
    // when the doc was chunked (large datasets), and it always preferred
    // local IDB even when Firestore was newer. That let the on-screen PE
    // Opps table drift from the server-built PE Opps email, which reads
    // the same (chunk-aware) Firestore doc.
    const refresh = async () => {
      try {
        const data = await loadOpps2Newest(userId);
        const recs = Array.isArray(data?.records) ? data.records : null;
        if (!cancelled && recs && recs.length > 0) setRecords(recs);
      } catch { /* leave records empty on failure */ }
    };
    refresh();
    // Re-pull when Opps 2 writes its cache (e.g. an inline Sales Partner
    // edit here, or an edit on the Opps 2 tab) so the table stays live.
    const onUpdate = () => { refresh(); };
    window.addEventListener('opps2-cache-updated', onUpdate);
    return () => { cancelled = true; window.removeEventListener('opps2-cache-updated', onUpdate); };
  }, [userId]);
  return [records, setRecords];
}

export function PEPortfolioView({ prospects = [], onSelectProspect, metInPersonMap = {}, onUpdateProspect, onAddProspect, settings, updateSettings }) {
  const { user } = useAuth();
  const [subtab, setSubtab] = useState('portfolio');
  // Acquisition-news digest: covers every company ticked "Track acquisition
  // news" on its company popup, so it lives on the page rather than a tab.
  const [newsScheduleOpen, setNewsScheduleOpen] = useState(false);
  // Which PE firm the "PE Firm" sub-tab (formerly hardcoded to Blue Owl)
  // is showing. Defaults to Blue Owl so the tab opens exactly as before;
  // the in-tab picker lets the user switch to any other firm. The last
  // pick is persisted (like the other PE view prefs) so it survives a
  // refresh or navigating away and back.
  const [peFirm, setPeFirm] = useState(() => {
    try { return localStorage.getItem('pe-portfolio:pe-firm') || 'Blue Owl'; } catch { return 'Blue Owl'; }
  });
  const [showClosed, setShowClosed] = useState(false);
  const [oppsQuery, setOppsQuery] = useState('');
  // Independent search box for the dedicated Blackstone Opps tab.
  const [blackstoneQuery, setBlackstoneQuery] = useState('');
  // PE Opps firm scope. '' = the full PE Opps list (Type = Private Equity
  // OR Source = PE partner). A firm name narrows to every opp tied to that
  // firm or its portfolio companies — any Type/Source — for a per-firm
  // digest (e.g. Blackstone). Persisted like the other PE view prefs.
  const [oppsFirm, setOppsFirm] = useState(() => {
    try { return localStorage.getItem('pe-portfolio:opps-firm') || ''; } catch { return ''; }
  });
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:opps-firm', oppsFirm); } catch { /* ignore */ }
  }, [oppsFirm]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
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
  // Persisted column widths + sort so the layout survives reloads.
  const DEFAULT_COL_WIDTHS = { company: 240, peAum: 110, geography: 110, dm: 170, met: 170, mapping: 110, pcDownload: 120, ratio: 120, topPc: 200, topPcAnalysis: 140, topPcStatus: 150, clients: 110, keyContacts: 120, caseStudy: 110, peStage: 170, newsFeed: 110 };
  // company is sticky and always shown — every other column is opt-in.
  const ALL_COL_KEYS = ['company', 'peAum', 'geography', 'dm', 'met', 'mapping', 'pcDownload', 'ratio', 'topPc', 'topPcAnalysis', 'topPcStatus', 'clients', 'keyContacts', 'caseStudy', 'peStage', 'newsFeed'];
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-portfolio:col-widths')) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => {
    const saved = localStorage.getItem('pe-portfolio:sort-key') || 'ratio';
    // A table sorted by one of the retired per-stage tick columns now
    // sorts by the combined one, rather than falling through to the
    // default comparator with no sort arrow to explain it.
    return ['discovery', 'piloting', 'existingPartnership', 'notSold'].includes(saved) ? 'peStage' : saved;
  });
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('pe-portfolio:sort-dir') || 'desc');
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-portfolio:visible-cols'));
      if (Array.isArray(saved)) {
        const next = new Set([...saved, 'company']);
        // The four one-per-stage tick columns (discovery / piloting /
        // existingPartnership / notSold) are now the single peStage
        // column. Anyone who had any of them showing gets the combined
        // one; the retired keys are dropped below so the "n/m" count and
        // the saved width map don't keep carrying them.
        const RETIRED_STAGE_COLS = ['discovery', 'piloting', 'existingPartnership', 'notSold'];
        if (RETIRED_STAGE_COLS.some(k => next.has(k))) next.add('peStage');
        for (const k of RETIRED_STAGE_COLS) next.delete(k);
        // …and for a saved set old enough to predate the tick columns
        // entirely, reveal the combined one once.
        if (!localStorage.getItem('pe-portfolio:cols-pe-stage-combined')) {
          next.add('peStage');
          try { localStorage.setItem('pe-portfolio:cols-pe-stage-combined', '1'); } catch {}
        }
        // One-time migration: reveal the PC Download column for users
        // whose saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-pc-download')) {
          next.add('pcDownload');
          try { localStorage.setItem('pe-portfolio:cols-pc-download', '1'); } catch {}
        }
        // One-time migration: reveal the News Feed column for users whose
        // saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-news-feed')) {
          next.add('newsFeed');
          try { localStorage.setItem('pe-portfolio:cols-news-feed', '1'); } catch {}
        }
        // One-time migration: reveal the Top PC column for users whose
        // saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-top-pc')) {
          next.add('topPc');
          try { localStorage.setItem('pe-portfolio:cols-top-pc', '1'); } catch {}
        }
        // One-time migration: reveal the Top PC Status column for users
        // whose saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-top-pc-status')) {
          next.add('topPcStatus');
          try { localStorage.setItem('pe-portfolio:cols-top-pc-status', '1'); } catch {}
        }
        // One-time migration: reveal the Top PC Analysis column for users
        // whose saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-top-pc-analysis')) {
          next.add('topPcAnalysis');
          try { localStorage.setItem('pe-portfolio:cols-top-pc-analysis', '1'); } catch {}
        }
        return next;
      }
    } catch {}
    return new Set(ALL_COL_KEYS);
  });
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  useEffect(() => {
    if (!colMenuOpen) return;
    function handleClick(e) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colMenuOpen]);
  function toggleCol(key) {
    if (key === 'company') return;
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:pe-firm', peFirm); } catch {}
  }, [peFirm]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:col-widths', JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:sort-key', sortKey); } catch {}
  }, [sortKey]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:sort-dir', sortDir); } catch {}
  }, [sortDir]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:visible-cols', JSON.stringify([...visibleCols])); } catch {}
  }, [visibleCols]);
  const resizingRef = useRef(null);
  function startResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key: colKey, startX: e.clientX, startWidth: colWidths[colKey] || 100 };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const next = Math.max(60, resizingRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current.key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function toggleSort(key) {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key);
  }
  const [oppsRecords, setOppsRecords] = useOppsRecords(user?.uid);

  // Download a PE firm's mapped portfolio companies (the entries in its
  // Portfolio Companies tab — the same array behind the PC Mapping
  // column) as an Excel file. Uses the shared workbook builder so the
  // output is identical to the company pop-up's "Download Current Data"
  // button: Schneider-branded, opportunity-score ranked, with the Top 5
  // Overview / Deep Dives / Methodology aux tabs carried over.
  const exportPortfolioCompanies = async (pe) => {
    const rows = Array.isArray(pe?.portfolioCompanies) ? pe.portfolioCompanies : [];
    if (rows.length === 0) return;
    await downloadPortfolioCompaniesWorkbook({
      company: pe.company || 'pe_firm',
      rows,
      topFive: pe.portfolioTopFive || null,
      overview: pe.portfolioOverview || null,
    });
  };

  // Edit a single field on a PE opp directly from the PE Opps table.
  // Optimistically updates the in-memory rows, then persists to the
  // shared Opps 2 store (cache + Firestore). On failure the persisted
  // value never lands; the next reload reconciles from the store.
  const updateOppField = async (oppId, field, value) => {
    setOppsRecords(prev => prev.map(r => (
      String(r._id) === String(oppId)
        ? { ...r, [field]: value, _rowUpdatedAt: Date.now() }
        : r
    )));
    try {
      await setOppField(user?.uid, oppId, field, value);
    } catch (err) {
      console.error('PE Opps: failed to save field edit', { field, oppId, err });
    }
  };

  // PE Opps sub-tab: every Opps 2 row whose Type is "Private Equity"
  // OR whose Source is "PE partner" (case/space-insensitive so minor
  // data-entry variants still match). These are the deals tied to the
  // PE channel regardless of whether the account is mapped to a PE firm
  // on the Portfolio tab.
  //
  // Opps closed (Sold / Not Sold) more than a month ago are dropped so
  // the list stays focused on live + recently-closed deals. A closed opp
  // with no parseable Close Date is also dropped (treated as stale).
  const peOpps = useMemo(() => {
    const norm = s => String(s || '').trim().toLowerCase();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    return oppsRecords.filter(r => {
      const type = norm(r['Type']);
      const source = norm(r['Source']);
      if (type !== 'private equity' && source !== 'pe partner') return false;
      const stage = norm(r['Stage']);
      if (stage === 'sold' || stage === 'not sold') {
        const closed = parseOppsDate(r['Close Date']);
        if (!closed || closed < cutoff) return false;
      }
      return true;
    });
  }, [oppsRecords]);

  // When a firm is picked, swap the all-PE list for every opp tied to that
  // firm or one of its portfolio companies — regardless of Type / Source —
  // matched the same way the PE Overview counts are (account ↔ company),
  // still dropping long-closed deals. Empty firm = the original PE Opps set.
  const peOppsScoped = useMemo(
    () => computeFirmScopedOpps(oppsFirm, peOpps, oppsRecords, prospects),
    [oppsFirm, peOpps, oppsRecords, prospects],
  );

  const filteredPeOpps = useMemo(() => {
    const q = oppsQuery.trim().toLowerCase();
    if (!q) return peOppsScoped;
    return peOppsScoped.filter(r =>
      [r['Account'], r['Contact'], r['Stage'], r['Scope'], r['Source'], r['Type'], r['Sales Partner'], r['Status'], r['BFO Link'], r['Next Steps']]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }, [peOppsScoped, oppsQuery]);

  // Dedicated "Blackstone Opps" sub-tab — the same PE Opps view locked to
  // Blackstone (firm + its portfolio companies), with its own search box so
  // it stays independent of the main PE Opps tab.
  const blackstoneOpps = useMemo(
    () => computeFirmScopedOpps(BLACKSTONE_FIRM, peOpps, oppsRecords, prospects),
    [peOpps, oppsRecords, prospects],
  );

  const filteredBlackstoneOpps = useMemo(() => {
    const q = blackstoneQuery.trim().toLowerCase();
    if (!q) return blackstoneOpps;
    return blackstoneOpps.filter(r =>
      [r['Account'], r['Contact'], r['Stage'], r['Scope'], r['Source'], r['Type'], r['Sales Partner'], r['Status'], r['BFO Link'], r['Next Steps']]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }, [blackstoneOpps, blackstoneQuery]);

  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects]);

  // "Days in Stage" needs to know when each firm entered its current PE
  // Stage. Going forward that's stamped on every stage change (see
  // useProspects.updateProspect). For firms that already had a stage set
  // before this shipped, "start the clock now": stamp today once so they
  // begin counting from here instead of showing blank forever. Runs a
  // single pass per mount once the firms have loaded.
  const peStageBackfilledRef = useRef(false);
  useEffect(() => {
    if (peStageBackfilledRef.current || !peFirms.length) return;
    peStageBackfilledRef.current = true;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const p of peFirms) {
      if (PE_STAGES.includes(p.peStage) && !p.peStageEnteredAt) {
        onUpdateProspect?.(p.id, { peStageEnteredAt: today });
      }
    }
  }, [peFirms, onUpdateProspect]);

  // Discovery firms count from their FIRST opportunity, not the day this
  // board first loaded: a firm we've been discovering for months should
  // read its real age, not restart at 0. Waits for opps to load, then
  // stamps each Discovery firm's peStageEnteredAt with the earliest Start
  // Date across its opportunities (firm + portfolio companies). Only ever
  // moves the date EARLIER, so it's idempotent — and self-heals a firm
  // that was previously stamped "today" by the pass above. Non-Discovery
  // stages keep their stamp-on-entry date. Runs once opps are present.
  const peDiscoveryImportRef = useRef(false);
  useEffect(() => {
    if (peDiscoveryImportRef.current || !peFirms.length || oppsRecords.length === 0) return;
    peDiscoveryImportRef.current = true;
    for (const p of peFirms) {
      if (p.peStage !== 'Discovery') continue;
      const earliest = earliestFirmOppStartISO(p.company, oppsRecords, prospects);
      if (!earliest) continue;
      const current = toISODate(p.peStageEnteredAt);
      if (!current || earliest < current) {
        onUpdateProspect?.(p.id, { peStageEnteredAt: earliest });
      }
    }
  }, [peFirms, oppsRecords, prospects, onUpdateProspect]);

  // PE Firm sub-tab: every Table View prospect whose PE Owner names the
  // selected firm (bidirectional contains-match so variants like "Blue
  // Owl Capital" still land here). Prospects typed as Portfolio Company
  // are excluded.
  const peFirmCompanies = useMemo(() => (
    prospects
      .filter(p => p.type !== 'Portfolio Company' && prospectOwnedByFirm(p.peOwner, peFirm))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, peFirm]);

  // Dropdown vocabulary for the firm picker: every distinct PE Owner set
  // on a Table View prospect + every PE firm name, deduped
  // case-insensitively and sorted. The current selection is always
  // included so the <select> can show it even before any data names it.
  const peFirmOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (v) => {
      const t = String(v || '').trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    push(peFirm);
    for (const p of prospects) for (const o of splitPeOwners(p.peOwner)) push(o);
    for (const pe of peFirms) push(pe.company);
    return out.sort((a, b) => a.localeCompare(b));
  }, [prospects, peFirms, peFirm]);

  // Portfolio company → PE firm (lowercased name) lookup, from each
  // prospect's peOwner field. A company can list several owners
  // (comma-separated) and is linked under each of them.
  const portfolioByPe = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      for (const owner of splitPeOwners(p.peOwner)) {
        const key = owner.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
    }
    return map;
  }, [prospects]);

  // Bucket each Opps row into a portfolio company (using fuzzy account-name match).
  // Produces: Map<prospectId, Array<oppRecord>>
  const oppsByProspectId = useMemo(() => {
    const map = new Map();
    if (oppsRecords.length === 0) return map;
    // Narrow search to only prospects that are tagged as portfolio companies
    const portfolioProspects = prospects.filter(p => (p.peOwner || '').trim());
    for (const p of portfolioProspects) {
      const list = [];
      const name = (p.company || '').toLowerCase();
      if (!name) continue;
      for (const r of oppsRecords) {
        const acct = (r['Account'] || '').toLowerCase();
        if (accountMatchesCompany(name, acct)) list.push(r);
      }
      if (list.length > 0) map.set(p.id, list);
    }
    return map;
  }, [prospects, oppsRecords]);

  // Generic email domains to ignore when matching contacts by domain.
  const FREE_MAIL = useMemo(() => new Set([
    'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
    'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  ]), []);

  // Flat list of DM contacts so each PE firm can match by either company
  // name OR registered email domain — same dual-match the prospect modal
  // uses, so the table here doesn't disagree with what the popup shows.
  const decisionMakers = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('decision maker')) continue;
      const company = (c.company || '').toLowerCase().trim();
      // The contact's own typed company text, preserved by the sync
      // alongside the canonical association name. Lets a decision maker
      // match by the company the user actually entered even when the
      // HubSpot Company association is blank or rebranded.
      const companyText = (c.companyText || '').toLowerCase().trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      // "Met In Person" is now a local Prospect Tracker checkbox
      // (settings.contactMetInPerson), not a HubSpot tag — prefer the saved
      // local value, falling back to the legacy tag for untouched contacts.
      const cmId = String(c.id || c.vid || '');
      const metInPerson = (cmId && Object.prototype.hasOwnProperty.call(metInPersonMap, cmId))
        ? !!metInPersonMap[cmId]
        : tags.includes('met in person');
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        companyText,
        domain,
        metInPerson,
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL, metInPersonMap]);

  // Same flat-list pattern for the "Dan Key Target" tag.
  const keyContacts = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('dan key target')) continue;
      const company = (c.company || '').toLowerCase().trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        domain,
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

  // Pull the registered email domains off a prospect — both manual
  // emailDomain entries and the website hostname. Used to bucket DM /
  // Key Target contacts onto the right PE firm by domain.
  const collectProspectDomains = (p, into) => {
    if (!p) return;
    if (p.emailDomain) {
      for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
        const at = entry.lastIndexOf('@');
        const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
        if (d) into.add(d);
      }
    }
    if (p.website) {
      const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) into.add(d);
    }
  };

  // Key-contact names per Blue Owl company. A HubSpot "Decision Maker"
  // contact ties to a row on either (a) a strict 1-to-1 company-name match
  // — the contact's HubSpot Company is the *same* company as the row after
  // normalizing case, punctuation and legal suffixes — or (b) the contact's
  // email domain matching one of THIS row's own registered domains. We still
  // deliberately drop the loose fuzzy substring / acronym match, and the
  // domain check is scoped per-row (never the PE owner's or sibling PCs'
  // domains): both guards keep a PE owner's decision maker (e.g. Dan Egan on
  // "Blue Owl") from leaking onto portfolio-company rows that merely share a
  // token or a union domain. The earlier regression came from matching
  // against the firm-wide union of domains; a single company's own domain is
  // safe and lets e.g. delpers@americancampus.com land on the ACC row even
  // when its typed Company text doesn't normalize-equal the row name. We also
  // do NOT spread in the company's PE owner or related portfolio companies,
  // so each row shows only its own contacts. Deduped by display name. Feeds
  // the Blue Owl tab's "Key Contacts" column.
  const blueOwlDmByCompanyId = useMemo(() => {
    const map = new Map();
    if (decisionMakers.length === 0) return map;
    for (const p of peFirmCompanies) {
      const rowName = normalizeAccount(p.company);
      // Per-company registered domains — this prospect's own emailDomain /
      // website only, never the PE owner's or sibling portfolio companies'.
      // A domain match scoped to a single row stays precise (a contact at
      // americancampus.com lands only on the ACC row) and can't leak a PE
      // owner's decision maker the way the old union-domain fallback did.
      const rowDomains = new Set();
      collectProspectDomains(p, rowDomains);
      // Former names / rebrands the user recorded on this company (the
      // "Also Known As" field). A contact whose synced HubSpot Company is
      // the rebranded entity — e.g. "Andmore" against the row
      // "International Market Centers (IMC)" — shares no words with the row
      // name, so neither exact nor fuzzy name matching can bridge it. The
      // alias list closes that gap without per-contact re-saves or domain
      // registration.
      const aliasNames = String(p.aliases || '')
        .split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
      if (!rowName && rowDomains.size === 0 && aliasNames.length === 0) continue;
      const seen = new Set();
      const names = [];
      for (const dm of decisionMakers) {
        // Name match is fuzzy (companiesMatch) so a contact whose synced
        // HubSpot Company is a variant of the row name — e.g. the canonical
        // association "ShopCore" vs the row "Perform Properties fka ShopCore"
        // — still lands here without the user having to re-save the contact
        // to force an exact-string association. This mirrors what the company
        // popup's own contact list already shows. To honor the original
        // anti-leak intent, a contact that belongs to the PE owner itself (its
        // company matches the selected firm) is barred from fuzzy-spraying
        // across that firm's portfolio companies — it only attaches on an
        // exact name match. The per-row domain match is unchanged and stays
        // scoped to this company's own registered domains.
        // Company name is the PRIMARY signal: compare BOTH the contact's
        // canonical association name and the company text the user typed on
        // the contact (so a decision maker still matches when the HubSpot
        // association is blank or points at a rebranded record). Email
        // domain is only a fallback below.
        const dmNames = [dm.company, dm.companyText].filter(Boolean);
        const exactName = rowName && dmNames.some(n => normalizeAccount(n) === rowName);
        const ownerContact = peFirm && dmNames.some(n => companiesMatch(n, peFirm));
        const fuzzyName = !ownerContact && dmNames.some(n => companiesMatch(n, p.company));
        // Match against any recorded former name / alias for this company,
        // so a rebranded association (e.g. "Andmore") still lands on the row.
        const aliasMatch = !ownerContact && dmNames.some(n => aliasNames.some(a => companiesMatch(n, a)));
        // Fallback only: per-row email domain (scoped to this company's own
        // registered domains).
        const domainMatch = dm.domain && rowDomains.has(dm.domain);
        if (!exactName && !fuzzyName && !aliasMatch && !domainMatch) continue;
        if (seen.has(dm.name)) continue;
        seen.add(dm.name);
        names.push(dm.name);
      }
      if (names.length) map.set(p.id, names);
    }
    return map;
  }, [peFirmCompanies, decisionMakers, peFirm]);

  // Per-firm stage stats — the row-level data behind the stages table.
  //   decisionMakerNames  : DM contacts on this PE firm (or its PCs)
  //   pcMappingCount      : portfolio companies linked via peOwner
  //   activeOpps, totalOpps : aggregated across the PE firm + all PCs,
  //                           active = non-closed non-invalid stage;
  //                           total = every non-invalid stage
  //   pcClientCount       : PCs where status === 'Client'
  // Status by company name, for the Top PC column's filter. Built once
  // over every prospect rather than per firm: the mapped PC rows carry no
  // status of their own, so it comes off the tracker record that shares
  // the company's name.
  const statusByCompany = useMemo(() => buildStatusIndex(prospects), [prospects]);

  // Same keying, but back to the whole record, so clicking a Top PC opens
  // it in the Table View when the company is tracked. Indexed under every
  // alternate name too, so the link follows the same join the status does
  // — otherwise a company could show a status and still not be clickable.
  const prospectByPcKey = useMemo(() => {
    const m = new Map();
    for (const p of prospects) {
      for (const k of topPcCompanyKeys(p?.company)) {
        if (!m.has(k)) m.set(k, p);
      }
    }
    return m;
  }, [prospects]);

  // The record a Top PC links to, under the same alternate-name rules.
  const prospectForPc = useCallback((name) => {
    for (const k of topPcCompanyKeys(name)) {
      const hit = prospectByPcKey.get(k);
      if (hit) return hit;
    }
    return null;
  }, [prospectByPcKey]);

  const stageStatsByFirm = useMemo(() => {
    const out = new Map();
    for (const pe of peFirms) {
      const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
      const firmName = (pe.company || '').trim().toLowerCase();
      // DM: match each contact on the firm name (or any portfolio company
      // name) OR a registered email domain on this firm / its portfolio
      // companies. The dual-match mirrors the prospect modal so the table
      // here doesn't disagree with what the popup shows for the same firm.
      const dmCandidates = [firmName, ...portfolio.map(p => (p.company || '').toLowerCase().trim()).filter(Boolean)];
      const firmDomains = new Set();
      collectProspectDomains(pe, firmDomains);
      for (const p of portfolio) collectProspectDomains(p, firmDomains);
      const dmEntries = [];
      const dmSeen = new Set();
      for (const dm of decisionMakers) {
        const matches =
          (dm.company && dmCandidates.some(n => companiesMatch(n, dm.company))) ||
          (dm.domain && firmDomains.has(dm.domain));
        if (!matches) continue;
        if (dmSeen.has(dm.name)) continue;
        dmSeen.add(dm.name);
        dmEntries.push(dm);
      }
      const dmNames = dmEntries.map(e => e.name);
      const metInPersonCount = dmEntries.filter(e => e.metInPerson).length;
      const nycCount = dmEntries.filter(e => /(new york|nyc)/i.test(e.city || '')).length;

      // Aggregate opps for the PE firm itself + every portfolio company.
      // We re-scan the Opps records so we also catch opps that land
      // directly on the PE firm's account name (not just its PCs).
      let active = 0;
      let total = 0;
      // The individual opp records behind the active/total counts, so the
      // PE Opps column can show *which* opps are included on hover.
      const oppsTip = [];
      const oppsNames = [firmName, ...portfolio.map(p => (p.company || '').toLowerCase().trim()).filter(Boolean)];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct) continue;
        if (!oppsNames.some(n => accountMatchesCompany(n, acct))) continue;
        total++;
        const isActive = !CLOSED_STAGES.has(stage);
        if (isActive) active++;
        oppsTip.push({
          title: r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)',
          account: r['Account'] || '',
          stage,
          active: isActive,
        });
      }

      // PCs that have converted to Clients.
      const pcClientCount = portfolio.filter(p => p.status === 'Client').length;

      // "Dan Key Target" contacts across the PE firm + all PCs. Same
      // company-or-domain matching as the DM lookup above, deduped by
      // display name.
      const keySeen = new Set();
      const keyNames = [];
      for (const kc of keyContacts) {
        const matches =
          (kc.company && dmCandidates.some(n => companiesMatch(n, kc.company))) ||
          (kc.domain && firmDomains.has(kc.domain));
        if (!matches) continue;
        if (keySeen.has(kc.name)) continue;
        keySeen.add(kc.name);
        keyNames.push(kc.name);
      }

      // Case study state across the PE firm + its portfolio companies. Each
      // record's caseStudyCreated is tri-state: true (Yes), 'in-progress', or
      // false (No). The row shows the strongest state present — Yes wins over
      // In Progress wins over No — with tooltips listing which companies.
      const isCaseStudyYes = (v) => v === true;
      const isCaseStudyInProgress = (v) => v === 'in-progress';
      const caseStudyYesNames = [
        ...(isCaseStudyYes(pe.caseStudyCreated) ? [pe.company] : []),
        ...portfolio.filter(p => isCaseStudyYes(p.caseStudyCreated)).map(p => p.company),
      ];
      const caseStudyInProgressNames = [
        ...(isCaseStudyInProgress(pe.caseStudyCreated) ? [pe.company] : []),
        ...portfolio.filter(p => isCaseStudyInProgress(p.caseStudyCreated)).map(p => p.company),
      ];
      const caseStudyState = caseStudyYesNames.length > 0
        ? 'yes'
        : (caseStudyInProgressNames.length > 0 ? 'in-progress' : 'no');

      // Best portfolio company to work next: highest Opportunity Score
      // among North America-based PCs we haven't already closed off.
      const topPc = pickTopPortfolioCompany(pe.portfolioCompanies, statusByCompany);

      out.set(pe.id, {
        topPc,
        decisionMakerNames: dmNames,
        decisionMakerEntries: dmEntries,
        metInPersonCount,
        nycCount,
        pcMappingCount: portfolio.length,
        // "Have I populated this PE firm's Portfolio Companies tab?"
        // Yes when the PE firm's own prospect record carries any
        // entries in its portfolioCompanies array — independent of
        // how many separate prospects reference it via peOwner.
        pcMapped: Array.isArray(pe.portfolioCompanies) && pe.portfolioCompanies.length > 0,
        activeOpps: active,
        totalOpps: total,
        oppsTip,
        pcClientCount,
        keyContactCount: keyNames.length,
        keyContactNames: keyNames,
        caseStudyState,
        caseStudyYesNames,
        caseStudyInProgressNames,
      });
    }
    return out;
  }, [peFirms, portfolioByPe, decisionMakers, keyContacts, oppsRecords, statusByCompany]);

  // Has the Top PC had its Master Analysis saved? The question the Top PC
  // column raises next — that company is the one to work, so whether the
  // analysis behind the conversation exists is part of reading the row.
  //
  // Only each firm's Top PC is looked up, not every mapped portfolio
  // company: useSavedAnalyses falls back to a per-company Firestore read
  // for anything without a save marker, and one row's worth of those is
  // the difference between a handful of reads and hundreds.
  const topPcProspects = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const stats of stageStatsByFirm.values()) {
      const name = stats?.topPc?.companyName;
      if (!name) continue;
      const match = prospectForPc(name);
      if (!match?.id || seen.has(match.id)) continue;
      seen.add(match.id);
      out.push(match);
    }
    return out;
  }, [stageStatsByFirm, prospectForPc]);
  const topPcAnalyses = useSavedAnalyses(topPcProspects);
  // A firm's Top PC analysis meta, or null when there's no Top PC, no
  // prospect record behind it, or nothing saved against that record.
  const analysisForTopPc = useCallback((stats) => {
    const name = stats?.topPc?.companyName;
    if (!name) return null;
    const match = prospectForPc(name);
    return match?.id ? (topPcAnalyses.get(match.id) || null) : null;
  }, [prospectForPc, topPcAnalyses]);

  const sortedPeFirms = useMemo(() => {
    const arr = [...peFirms];
    arr.sort((a, b) => {
      const sa = stageStatsByFirm.get(a.id) || {};
      const sb = stageStatsByFirm.get(b.id) || {};
      let cmp = 0;
      switch (sortKey) {
        case 'company':
          cmp = (a.company || '').localeCompare(b.company || '');
          break;
        case 'peAum':
          cmp = (a.peAum || 0) - (b.peAum || 0);
          break;
        case 'geography':
          cmp = (a.geography || '').localeCompare(b.geography || '');
          break;
        case 'dm':
          cmp = ((sa.decisionMakerNames || []).length) - ((sb.decisionMakerNames || []).length);
          break;
        case 'met':
          cmp = (sa.metInPersonCount || 0) - (sb.metInPersonCount || 0);
          if (cmp === 0) cmp = (sa.nycCount || 0) - (sb.nycCount || 0);
          break;
        case 'mapping':
          cmp = (sa.pcMapped ? 1 : 0) - (sb.pcMapped ? 1 : 0);
          break;
        case 'ratio':
          cmp = (sa.activeOpps || 0) - (sb.activeOpps || 0);
          if (cmp === 0) cmp = (sa.totalOpps || 0) - (sb.totalOpps || 0);
          break;
        case 'topPc': {
          // Firms with nothing eligible rank below every firm that has a
          // pick — last descending, first ascending — rather than mixing
          // in among the genuinely low scores as a zero would.
          const rank = (st) => (st.topPc ? st.topPc.score : -1);
          cmp = rank(sa) - rank(sb);
          break;
        }
        case 'topPcAnalysis': {
          // Newest save first descending, which is what "who's been
          // analysed, and how recently" wants. Below every real save sit
          // the Top PCs with nothing saved, and below those the firms
          // with no Top PC at all — the two dash-looking cells don't
          // interleave, same as the status column above.
          const rank = (st) => {
            if (!st.topPc) return -2;
            const meta = analysisForTopPc(st);
            if (!meta) return -1;
            const t = meta.savedAt ? new Date(meta.savedAt).getTime() : 0;
            return Number.isFinite(t) && t > 0 ? t : 0;
          };
          cmp = rank(sa) - rank(sb);
          break;
        }
        case 'topPcStatus': {
          // STATUSES order — the order the status dropdown offers them —
          // so this column groups the way the rest of the app lists
          // statuses rather than alphabetically. A Top PC with no prospect
          // record of its own has no status and ranks below every real
          // one; a firm with no Top PC at all ranks below that again, so
          // the two blank-looking cells don't interleave.
          const rank = (st) => {
            if (!st.topPc) return -2;
            const i = STATUSES.indexOf(st.topPc.status);
            return i < 0 ? -1 : i;
          };
          cmp = rank(sa) - rank(sb);
          break;
        }
        case 'clients':
          cmp = (sa.pcClientCount || 0) - (sb.pcClientCount || 0);
          break;
        case 'keyContacts':
          cmp = (sa.keyContactCount || 0) - (sb.keyContactCount || 0);
          break;
        case 'caseStudy': {
          const rank = (s) => s.caseStudyState === 'yes' ? 2 : s.caseStudyState === 'in-progress' ? 1 : 0;
          cmp = rank(sa) - rank(sb);
          break;
        }
        case 'newsFeed':
          // Plain on/off, so tracked firms group at one end and the
          // company-name tiebreak below orders each group.
          cmp = Number(a.trackAcquisitionNews === true) - Number(b.trackAcquisitionNews === true);
          break;
        case 'peStage': {
          // PE_STAGES order — the same order the Stages board lays its
          // columns out in. Unassigned ranks below every real stage, so
          // it lands at one end rather than sorting as "D" for Discovery.
          const rank = (p) => PE_STAGES.indexOf(p.peStage);
          cmp = rank(a) - rank(b);
          break;
        }
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.company || '').localeCompare(b.company || '');
      return cmp;
    });
    return arr;
  }, [peFirms, stageStatsByFirm, sortKey, sortDir, analysisForTopPc]);

  const q = query.trim().toLowerCase();
  const filteredFirms = q
    ? sortedPeFirms.filter(p => (p.company || '').toLowerCase().includes(q))
    : sortedPeFirms;

  function toggle(peId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(peId)) next.delete(peId);
      else next.add(peId);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>PE Portfolio</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 640 }}>
            {subtab === 'portfolio'
              ? <>Every prospect with Type = <code>Private Equity</code>, sorted by pipeline from their portfolio companies. Opportunity counts come from the <strong>Opps</strong> tab (same as the Opps column in My Accounts).</>
              : subtab === 'stages'
              ? <>PE firms grouped by their <strong>PE Stage</strong> (set in each firm's company popup): <code>Discovery</code>, <code>Piloting</code>, <code>Existing Partnership</code>, and <code>Not Sold</code>.</>
              : subtab === 'companies'
              ? <>Every mapped <strong>portfolio company</strong> across all PE firms (from each firm's Portfolio Companies tab), merged into one searchable, filterable table. <strong>Opportunity Score</strong> is ranked within each PC's own firm: matching that firm's export. The <strong>PE Owner</strong> dropdown filters to one owner, matching the source PE firm, the company's own PE Owner from Table View, or firms that owner owns: so picking <code>Blue Owl</code> also shows the portfolio companies of every Blue Owl-owned firm.</>
              : subtab === 'blueOwl'
              ? <>Every company from the Table View whose <strong>PE Owner</strong> (set in its company popup) is <code>{peFirm || '-'}</code>. Pick a different firm from the dropdown to switch the view. Double-click any cell to edit it: same dropdowns as Table View.</>
              : subtab === 'blueOwlServices'
              ? <>The same <code>{peFirm || '-'}</code> companies as <strong>PE Overview</strong>, with every explored service broken out into one column per <strong>service bucket</strong> — the boxes the services board groups services into (a service's box is its <strong>Service Bucket</strong> on the Dropdowns › Services tab). Each bucket lists what sold in <span style={{ color: SOLD_TEXT, fontWeight: 700 }}>green</span>, what's still in progress in <span style={{ color: IN_PROGRESS_TEXT, fontWeight: 700 }}>yellow</span>, and what didn't sell in <span style={{ color: NOT_SOLD_TEXT, fontWeight: 700 }}>red</span> — so the Services Sold and Services Not Sold columns aren't repeated here. Every other PE Overview column is, and this tab keeps its own column layout. <strong>Export Excel</strong> carries the same three colours into the file.</>
              : subtab === 'stageDays'
              ? <>PE firms grouped by their <strong>PE Stage</strong>, each card showing how many days the firm has sat in that stage. The clock starts when a firm's PE Stage changes (set in its company popup); firms already in a stage started counting the day this shipped. Longest-waiting firms lead each column.</>
              : subtab === 'strategies'
              ? <>Reference lists of <strong>private-equity strategies</strong>, each with a short description: switch between the detailed <strong>Investment Strategies</strong> and the higher-level <strong>Categories</strong>. Drag each slider to rate how valuable that strategy is to you (0–10); your ratings save automatically and are ranked highest-first per list.</>
              : subtab === 'caseStudy'
              ? <>The <strong>industries our experience spans</strong>. Fill in the <strong>Company</strong>, <strong>Summary</strong>, and <strong>Results</strong> for a case study in each industry: your edits save automatically.</>
              : <>Every opportunity from the <strong>Opps</strong> tab with Type = <code>Private Equity</code> or Source = <code>PE partner</code>.</>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          {subtab === 'portfolio' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
              <span>Include closed (Sold / Not Sold / Lost)</span>
            </label>
          )}
          {/* Spans every company ticked "Track acquisition news", not just
              this tab's rows, so it sits in the page header rather than in
              any one sub-tab's toolbar. */}
          <button
            type="button"
            onClick={() => setNewsScheduleOpen(true)}
            title={'Schedule a recurring email of acquisitions made by the companies you\'ve ticked "Track acquisition news" on'}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #7C3AED', borderRadius: 6, background: '#fff', color: '#7C3AED', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >📰 Acquisition news</button>
        </div>
      </div>

      <CompanyNewsScheduleModal
        open={newsScheduleOpen}
        onClose={() => setNewsScheduleOpen(false)}
        uid={user?.uid}
        prospects={prospects}
      />

      {/* Sub-tab bar — Portfolio firms vs. the flat PE Opps list. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid #E2E8F0', margin: '0 1.25rem 0.5rem', flexShrink: 0 }}>
        {[
          { key: 'portfolio', label: 'Portfolio' },
          { key: 'stages', label: 'PE Stages' },
          { key: 'companies', label: 'All PCs' },
          { key: 'blueOwl', label: 'PE Overview' },
          { key: 'blueOwlServices', label: 'PE Overview - Services' },
          { key: 'opps', label: 'PE Opps' },
          { key: 'stageDays', label: 'Days in Stage' },
          { key: 'strategies', label: 'Strategies' },
          { key: 'caseStudy', label: 'Case Study' },
          { key: 'blackstoneOpps', label: 'Blackstone Opps' },
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
                borderBottom: isActive ? '2px solid #7C3AED' : '2px solid transparent',
                color: isActive ? '#7C3AED' : '#64748B',
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
            </button>
          );
        })}
      </div>

      {subtab === 'opps' ? (
        <PEOppsTab
          opps={filteredPeOpps}
          totalOpps={peOppsScoped.length}
          query={oppsQuery}
          setQuery={setOppsQuery}
          firm={oppsFirm}
          setFirm={setOppsFirm}
          firmOptions={peFirmOptions}
          oppsLoaded={oppsRecords.length > 0}
          prospects={prospects}
          onSelectProspect={onSelectProspect}
          onEditField={updateOppField}
          user={user}
        />
      ) : subtab === 'blackstoneOpps' ? (
        // Same PE Opps tab, hard-scoped to Blackstone. Omitting setFirm
        // hides the firm picker (the scope is fixed) while firm still
        // drives the export label and the email-schedule scope.
        <PEOppsTab
          opps={filteredBlackstoneOpps}
          totalOpps={blackstoneOpps.length}
          query={blackstoneQuery}
          setQuery={setBlackstoneQuery}
          firm={BLACKSTONE_FIRM}
          oppsLoaded={oppsRecords.length > 0}
          prospects={prospects}
          onSelectProspect={onSelectProspect}
          onEditField={updateOppField}
          user={user}
        />
      ) : subtab === 'stages' ? (
        <PEStagesTab
          firms={peFirms}
          portfolioByPe={portfolioByPe}
          onSelectProspect={onSelectProspect}
        />
      ) : subtab === 'companies' ? (
        <PEAllCompaniesTab
          firms={peFirms}
          prospects={prospects}
          onSelectProspect={onSelectProspect}
        />
      ) : subtab === 'blueOwl' ? (
        // Keyed per tab: the two tabs render the same component at the
        // same spot in this chain, so without distinct keys React would
        // reuse one instance and only swap props — and the Services tab
        // would inherit PE Overview's saved column visibility, hiding
        // the very bucket columns it exists to show (plus its search,
        // sort and row selection).
        <PEBlueOwlTab
          key="pe-overview"
          companies={peFirmCompanies}
          selectedFirm={peFirm}
          firmOptions={peFirmOptions}
          onSelectFirm={setPeFirm}
          prospects={prospects}
          oppsRecords={oppsRecords}
          portfolioByPe={portfolioByPe}
          dmNamesByCompanyId={blueOwlDmByCompanyId}
          onSelectProspect={onSelectProspect}
          onUpdateProspect={onUpdateProspect}
          onAddProspect={onAddProspect}
          onDownloadPortfolio={exportPortfolioCompanies}
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : subtab === 'blueOwlServices' ? (
        <PEBlueOwlTab
          key="pe-overview-services"
          variant="services"
          companies={peFirmCompanies}
          selectedFirm={peFirm}
          firmOptions={peFirmOptions}
          onSelectFirm={setPeFirm}
          prospects={prospects}
          oppsRecords={oppsRecords}
          portfolioByPe={portfolioByPe}
          dmNamesByCompanyId={blueOwlDmByCompanyId}
          onSelectProspect={onSelectProspect}
          onUpdateProspect={onUpdateProspect}
          onAddProspect={onAddProspect}
          onDownloadPortfolio={exportPortfolioCompanies}
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : subtab === 'stageDays' ? (
        <PEStageDaysTab
          firms={peFirms}
          portfolioByPe={portfolioByPe}
          onSelectProspect={onSelectProspect}
        />
      ) : subtab === 'strategies' ? (
        <PEStrategiesTab
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : subtab === 'caseStudy' ? (
        <PECaseStudyTab
          settings={settings}
          updateSettings={updateSettings}
        />
      ) : (
      <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${peFirms.length} PE firm${peFirms.length === 1 ? '' : 's'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <div ref={colMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColMenuOpen(o => !o)}
            style={{ padding: '0.4rem 0.7rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.72rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >Columns ({visibleCols.size}/{ALL_COL_KEYS.length})</button>
          {colMenuOpen && (() => {
            const COL_LABELS = {
              company: 'PE firm', peAum: 'PE AUM', geography: 'Geography', dm: 'Decision Maker Found?',
              met: 'Met in Person', mapping: 'PC Mapping', pcDownload: 'PC Download', ratio: 'PE Opps',
              topPc: 'Top PC', topPcAnalysis: 'Top PC Analysis', topPcStatus: 'Top PC Status',
              clients: 'PC Clients', keyContacts: 'Key Contacts', caseStudy: 'Case Study',
              peStage: 'PE Stage', newsFeed: 'News Feed',
            };
            return (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 200, padding: '0.3rem 0' }}>
                {ALL_COL_KEYS.map(key => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: key === 'company' ? '#94A3B8' : '#334155', cursor: key === 'company' ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={visibleCols.has(key)}
                      disabled={key === 'company'}
                      onChange={() => toggleCol(key)}
                    />
                    <span style={{ flex: 1 }}>{COL_LABELS[key] || key}</span>
                  </label>
                ))}
                <div style={{ borderTop: '1px solid #F1F5F9', marginTop: '0.3rem', padding: '0.3rem 0.6rem', display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={() => setVisibleCols(new Set(ALL_COL_KEYS))}
                    style={{ flex: 1, padding: '0.25rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 4, background: '#fff', fontSize: '0.68rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
                  >Show all</button>
                  <button
                    type="button"
                    onClick={() => setVisibleCols(new Set(['company']))}
                    style={{ flex: 1, padding: '0.25rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 4, background: '#fff', fontSize: '0.68rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
                  >Hide all</button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {oppsRecords.length === 0 && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            No Opps data loaded. Open the <strong>Opps</strong> tab once to sync it; counts will populate here afterwards.
          </div>
        )}
        {filteredFirms.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {peFirms.length === 0 ? 'No PE firms found' : `No firms match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {peFirms.length === 0
                ? <>Scanned {prospects.length} prospect{prospects.length === 1 ? '' : 's'}. Set a prospect's <strong>Type</strong> to <code>Private Equity</code> to list it here.</>
                : `${peFirms.length} total PE firms loaded: adjust your search.`}
            </div>
          </div>
        ) : (() => {
          const ALL_HEADER_COLUMNS = [
            { key: 'company', label: 'PE firm', align: 'left',   tip: 'Sort by company name' },
            { key: 'peAum',   label: 'PE AUM', align: 'right', tip: 'AUM (in billions) pulled from each PE firm\'s Table View record. Sort by AUM.' },
            { key: 'geography', label: 'Geography', align: 'left', tip: 'Geography from the PE firm\'s prospect record (Global / NAM / State-Regional)' },
            { key: 'dm',      label: 'Decision Maker Found?', align: 'left', tip: 'Sort by number of decision makers found on HubSpot' },
            { key: 'met',     label: 'Met in Person', align: 'left', tip: 'Met-in-person count / total decision makers, plus how many of them list New York / NYC as their city' },
            { key: 'mapping', label: 'PC Mapping', align: 'center', tip: 'Yes when the PE firm has entries in its Portfolio Companies tab; No otherwise' },
            { key: 'pcDownload', label: 'PC Download', align: 'center', tip: 'Download this PE firm\'s mapped portfolio companies (from its Portfolio Companies tab) as an Excel file' },
            { key: 'ratio',   label: 'PE Opps', align: 'center', tip: 'Active / total opps aggregated across the PE firm plus every portfolio company' },
            { key: 'topPc', label: 'Top PC', align: 'left', tip: `The firm's highest Opportunity Score portfolio company (same score as the All PCs tab), limited to North America HQs and excluding ${TOP_PC_EXCLUDED_STATUSES.join(' / ')}` },
            { key: 'topPcAnalysis', label: 'Top PC Analysis', align: 'center', tip: 'Whether a Master Analysis has been saved against the Top PC (the workbook the Utility Lookup page saves), and when. Sorts newest save first; Top PCs with nothing saved sort below those, and firms with no Top PC below them.' },
            { key: 'topPcStatus', label: 'Top PC Status', align: 'center', tip: "The Top PC's status: the one set on this firm's Portfolio Companies list when it has one, otherwise the Table View status of the matching prospect. Blank when it has neither — the Top PC filter only excludes companies it can see are closed." },
            { key: 'clients', label: 'PC Clients', align: 'center',  tip: 'Portfolio companies currently set to status = Client' },
            { key: 'keyContacts', label: 'Key Contacts', align: 'center', tip: 'Count of HubSpot contacts tagged "Dan Key Target" across the PE firm plus its portfolio companies' },
            { key: 'caseStudy', label: 'Case Study', align: 'center', tip: 'Yes when the PE firm or any of its portfolio companies has "Case Study Created?" set to Yes on its company page; In Progress when one is marked In Progress (and none are Yes)' },
            { key: 'peStage', label: 'PE Stage', align: 'center', tip: `This firm's PE Stage, set in its company popup: ${PE_STAGES.join(' / ')}. Sorts in that order, with unassigned firms at one end.` },
            { key: 'newsFeed', label: 'News Feed', align: 'center', tip: 'Yes when "Track acquisition news" is ticked on this firm\'s company popup, which includes it in the weekly acquisition-news email. Sort to group the tracked firms together.' },
          ];
          const HEADER_COLUMNS = ALL_HEADER_COLUMNS.filter(c => visibleCols.has(c.key));
          const GRID = `${HEADER_COLUMNS.map(c => `${colWidths[c.key] || DEFAULT_COL_WIDTHS[c.key] || 110}px`).join(' ')} 28px`;
          const SORT_GLYPH = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
          return (
            <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', position: 'sticky', top: 0, zIndex: 1 }}>
                {HEADER_COLUMNS.map(c => (
                  <div
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    title={c.tip}
                    style={{
                      position: 'relative',
                      padding: '0.35rem 0.6rem',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: sortKey === c.key ? '#1E293B' : '#475569',
                      textAlign: c.align,
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: sortKey === c.key ? '#E2E8F0' : 'transparent',
                      borderRight: '1px solid #E2E8F0',
                    }}
                  >
                    {c.label}{SORT_GLYPH(c.key)}
                    <span
                      onMouseDown={e => startResize(c.key, e)}
                      onClick={e => e.stopPropagation()}
                      style={RESIZE_HANDLE}
                      title="Drag to resize"
                    />
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.6rem' }}></div>
              </div>

              {filteredFirms.map((pe, rowIdx) => {
                const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
                const allOpps = portfolio.flatMap(p => (oppsByProspectId.get(p.id) || []).map(r => ({ ...r, _company: p.company, _prospectId: p.id })));
                const visibleOpps = allOpps.filter(r => {
                  const stage = (r['Stage'] || '').trim();
                  if (INVALID_STAGES.has(stage)) return false;
                  if (!showClosed && CLOSED_STAGES.has(stage)) return false;
                  return true;
                });
                const oppsByStage = new Map();
                for (const r of visibleOpps) {
                  const key = (r['Stage'] || 'Unspecified').trim() || 'Unspecified';
                  if (!oppsByStage.has(key)) oppsByStage.set(key, []);
                  oppsByStage.get(key).push(r);
                }
                const stageOrder = Array.from(oppsByStage.keys()).sort((a, b) => a.localeCompare(b));
                const isExpanded = expanded.has(pe.id);
                const stats = stageStatsByFirm.get(pe.id) || {};
                const dmFound = (stats.decisionMakerNames || []).length > 0;
                return (
                  <div key={pe.id} style={{ borderTop: rowIdx === 0 ? 'none' : '1px solid #E2E8F0' }}>
                    <button
                      type="button"
                      onClick={() => toggle(pe.id)}
                      style={{ width: '100%', padding: 0, background: isExpanded ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center' }}
                    >
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={pe.company}
                        onClick={e => { e.stopPropagation(); onSelectProspect?.(pe); }}
                      >{pe.company}</div>

                      {visibleCols.has('peAum') && (
                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: pe.peAum ? '#1E293B' : '#CBD5E1' }}
                        title={pe.peAum ? `PE AUM from Table View: $${pe.peAum}B` : 'No PE AUM set on this prospect record'}
                      >
                        {formatAum(pe.peAum)}
                      </div>
                      )}

                      {visibleCols.has('geography') && (
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, color: pe.geography ? '#1E293B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={pe.geography || 'No geography set on this prospect record'}
                      >
                        {pe.geography || '-'}
                      </div>
                      )}

                      {visibleCols.has('dm') && (
                      <div style={{ padding: '0.55rem 0.6rem' }}>
                        <span
                          title={dmFound ? (stats.decisionMakerNames || []).join(', ') : 'No HubSpot contact tagged "decision maker" for this firm or its portfolio companies'}
                          style={{
                            padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                            background: dmFound ? '#DCFCE7' : '#FEE2E2',
                            color:      dmFound ? '#166534' : '#991B1B',
                            border: `1px solid ${dmFound ? '#86EFAC' : '#FCA5A5'}`,
                          }}
                        >{dmFound ? `✓ ${(stats.decisionMakerNames || []).length} found` : '✗ Not found'}</span>
                      </div>
                      )}

                      {visibleCols.has('met') && (() => {
                        const dmTotal = (stats.decisionMakerNames || []).length;
                        const met = stats.metInPersonCount || 0;
                        const nyc = stats.nycCount || 0;
                        if (dmTotal === 0) {
                          return (
                            <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>-</div>
                          );
                        }
                        const nycList = (stats.decisionMakerEntries || [])
                          .filter(e => /(new york|nyc)/i.test(e.city || ''))
                          .map(e => `${e.name}${e.city ? ` (${e.city})` : ''}`)
                          .join(', ');
                        const metList = (stats.decisionMakerEntries || [])
                          .filter(e => e.metInPerson)
                          .map(e => e.name)
                          .join(', ');
                        const tipParts = [];
                        if (met > 0) tipParts.push(`Met in person: ${metList}`);
                        else tipParts.push('No decision makers tagged "met in person" yet');
                        if (nyc > 0) tipParts.push(`In NY: ${nycList}`);
                        const cityChips = (() => {
                          // NYC is already covered by the (N in New York) badge above —
                          // drop it from the per-city list. Group the rest by city so
                          // multiples render as "2 in London" instead of two chips.
                          const groups = new Map();
                          for (const e of (stats.decisionMakerEntries || [])) {
                            if (/(new york|nyc)/i.test(e.city || '')) continue;
                            const city = (e.city || '').trim();
                            const key = city.toLowerCase() || '__nocity__';
                            const display = city || 'No city';
                            const cur = groups.get(key) || { display, names: [], hasCity: !!city };
                            cur.names.push(e.name);
                            groups.set(key, cur);
                          }
                          return [...groups.values()];
                        })();
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }} title={tipParts.join('\n')}>
                            <span
                              style={{
                                padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                                background: met > 0 ? '#DCFCE7' : '#F1F5F9',
                                color:      met > 0 ? '#166534' : '#94A3B8',
                                border: `1px solid ${met > 0 ? '#86EFAC' : '#E2E8F0'}`,
                              }}
                            >{met}/{dmTotal}</span>
                            {nyc > 0 && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#5B21B6' }}>
                                ({nyc} in New York)
                              </span>
                            )}
                            {cityChips.map((c, i) => {
                              const label = c.names.length > 1
                                ? `${c.names.length} in ${c.display}`
                                : c.display;
                              const fg = c.hasCity ? '#9A3412' : '#94A3B8';
                              return (
                                <span
                                  key={`${c.display}-${i}`}
                                  title={c.names.join(', ') + (c.hasCity ? '' : ' (city not set)')}
                                  style={{ fontSize: '0.65rem', fontWeight: 600, color: fg, whiteSpace: 'nowrap' }}
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {visibleCols.has('mapping') && (
                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700 }}>
                        {stats.pcMapped ? (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' }}>Yes</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#64748B' }}>No</span>
                        )}
                      </div>
                      )}

                      {visibleCols.has('pcDownload') && (() => {
                        const pcCount = Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies.length : 0;
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                            {pcCount > 0 ? (
                              <span
                                role="button"
                                tabIndex={0}
                                title={`Download ${pcCount} mapped portfolio compan${pcCount === 1 ? 'y' : 'ies'} as Excel`}
                                onClick={e => { e.stopPropagation(); exportPortfolioCompanies(pe); }}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); exportPortfolioCompanies(pe); } }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                ⬇ {pcCount}
                              </span>
                            ) : (
                              <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>-</span>
                            )}
                          </div>
                        );
                      })()}

                      {visibleCols.has('ratio') && (() => {
                        const oppsTip = stats.oppsTip || [];
                        const fmt = o => `• ${o.title}${o.stage ? `: ${o.stage}` : ''}${o.account ? ` [${o.account}]` : ''}`;
                        let tipText;
                        if (oppsTip.length === 0) {
                          tipText = 'No opportunities on this firm or its portfolio companies';
                        } else {
                          const activeList = oppsTip.filter(o => o.active);
                          const closedList = oppsTip.filter(o => !o.active);
                          const lines = ['active / total opportunities across this firm and its portfolio companies', ''];
                          lines.push(`Active (${activeList.length}):`);
                          lines.push(...(activeList.length ? activeList.map(fmt) : ['  (none)']));
                          lines.push(`Closed (${closedList.length}):`);
                          lines.push(...(closedList.length ? closedList.map(fmt) : ['  (none)']));
                          tipText = lines.join('\n');
                        }
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.activeOpps || 0) > 0 ? '#7C3AED' : (stats.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }} title={tipText}>
                            {(stats.activeOpps || 0)}/{(stats.totalOpps || 0)}
                          </div>
                        );
                      })()}

                      {visibleCols.has('topPc') && (() => {
                        const top = stats.topPc;
                        if (!top) {
                          return (
                            <div
                              style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}
                              title={stats.pcMapped
                                ? `No portfolio company on this firm is North America-based, scored, and clear of ${TOP_PC_EXCLUDED_STATUSES.join(' / ')}.`
                                : 'No portfolio companies mapped on this firm yet — fill in its Portfolio Companies tab.'}
                            >-</div>
                          );
                        }
                        const match = prospectForPc(top.companyName);
                        const skipped = [
                          top.skippedRegion ? `${top.skippedRegion} outside North America` : '',
                          top.skippedStatus ? `${top.skippedStatus} ${TOP_PC_EXCLUDED_STATUSES.join(' / ')}` : '',
                          top.skippedNoScore ? `${top.skippedNoScore} with no score` : '',
                        ].filter(Boolean);
                        return (
                          <div
                            style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}
                            title={[
                              `${top.companyName} — Opportunity Score ${top.score}`,
                              top.hqLocation ? `HQ: ${top.hqLocation}` : '',
                              top.status
                                ? `Status: ${top.status}${top.statusFromRow ? ' (set on this firm\'s Portfolio Companies list)' : (top.statusCompany ? ` (from "${top.statusCompany}")` : '')}`
                                : 'Not tracked as its own prospect',
                              `Top of ${top.eligible} eligible of ${top.total} mapped portfolio ${top.total === 1 ? 'company' : 'companies'}.`,
                              skipped.length ? `Excluded: ${skipped.join(', ')}.` : '',
                              match ? 'Click to open it in the Table View.' : '',
                            ].filter(Boolean).join('\n')}
                            onClick={match ? (e) => { e.stopPropagation(); onSelectProspect?.(match); } : undefined}
                          >
                            <span
                              style={{
                                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                fontSize: '0.75rem', fontWeight: 600,
                                color: match ? '#7C3AED' : '#1E293B',
                                textDecoration: match ? 'underline' : 'none',
                              }}
                            >{top.companyName}</span>
                            <span
                              style={{
                                flex: '0 0 auto', fontSize: '0.68rem', fontWeight: 700, color: '#0F172A',
                                background: '#E0E7FF', borderRadius: 4, padding: '0.05rem 0.3rem',
                              }}
                            >{top.score}</span>
                          </div>
                        );
                      })()}

                      {visibleCols.has('topPcAnalysis') && (() => {
                        const top = stats.topPc;
                        if (!top) {
                          return (
                            <div
                              style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', color: '#CBD5E1' }}
                              title="No Top PC on this row, so there's no analysis to look for."
                            >-</div>
                          );
                        }
                        // A Top PC that isn't tracked as its own prospect
                        // has nowhere for an analysis to live, which is a
                        // different answer from "tracked, none saved" —
                        // saying "Not saved" there would read as work to
                        // do when the company has to be added first.
                        const match = prospectForPc(top.companyName);
                        if (!match) {
                          return (
                            <div
                              style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', color: '#CBD5E1' }}
                              title={`${top.companyName} isn't tracked as its own prospect, so there's nothing to save a Master Analysis against. Add it in the Table View first.`}
                            >-</div>
                          );
                        }
                        const meta = topPcAnalyses.get(match.id) || null;
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', overflow: 'hidden' }}>
                            {meta ? (
                              <span
                                title={[
                                  `${top.companyName} has a Master Analysis saved${meta.savedAt ? ` on ${new Date(meta.savedAt).toLocaleString()}` : ''}.`,
                                  meta.fileName || '',
                                  meta.sizeBytes ? `${(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '',
                                  'Download it from this company\'s popup, or pull it back onto the Utility Lookup page with Import Analysis.',
                                ].filter(Boolean).join('\n')}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, color: '#166534' }}
                              >✓ {formatAnalysisDate(meta.savedAt)}</span>
                            ) : (
                              <span
                                title={`No Master Analysis saved against ${top.companyName} yet — run it on the Utility Lookup page and use "Save to ${top.companyName}".`}
                                style={{ color: '#94A3B8', fontStyle: 'italic' }}
                              >Not saved</span>
                            )}
                          </div>
                        );
                      })()}

                      {visibleCols.has('topPcStatus') && (() => {
                        const top = stats.topPc;
                        if (!top) {
                          return (
                            <div
                              style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', color: '#CBD5E1' }}
                              title="No Top PC on this row, so there's no status to show."
                            >-</div>
                          );
                        }
                        // A Top PC with no status anywhere is a real state,
                        // not missing data: the Top PC filter only excludes
                        // companies it can see are closed, so an untracked
                        // one is eligible and lands here.
                        const color = STATUS_COLORS[top.status];
                        return (
                          <div
                            style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, overflow: 'hidden' }}
                            title={top.status
                              ? (top.statusFromRow
                                ? `${top.companyName} is set to "${top.status}" on this firm's Portfolio Companies list`
                                : `${top.statusCompany || top.companyName} is set to "${top.status}" in the Table View${top.statusCompany ? `, matched to this row's "${top.companyName}"` : ''}`)
                              : `${top.companyName} has no status on this firm's Portfolio Companies list and no prospect record of its own`}
                          >
                            <span
                              style={{
                                display: 'inline-block', maxWidth: '100%', overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom',
                                padding: '1px 8px', borderRadius: 999,
                                background: color ? `${color}1A` : '#F8FAFC',
                                border: `1px solid ${color || '#E2E8F0'}`,
                                color: color || '#64748B',
                                fontStyle: top.status ? 'normal' : 'italic',
                                fontWeight: top.status ? 700 : 500,
                              }}
                            >{top.status || 'Not tracked'}</span>
                          </div>
                        );
                      })()}

                      {visibleCols.has('clients') && (
                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.pcClientCount || 0) > 0 ? '#10B981' : '#CBD5E1' }}>
                        {stats.pcClientCount || 0}
                      </div>
                      )}

                      {visibleCols.has('keyContacts') && (
                      <div
                        title={(stats.keyContactNames || []).join('\n') || undefined}
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.keyContactCount || 0) > 0 ? '#0891B2' : '#CBD5E1' }}
                      >
                        {stats.keyContactCount || 0}
                      </div>
                      )}

                      {visibleCols.has('caseStudy') && (
                      <div
                        title={stats.caseStudyState === 'yes'
                          ? `Case study created on:\n${(stats.caseStudyYesNames || []).join('\n')}`
                          : stats.caseStudyState === 'in-progress'
                            ? `Case study in progress on:\n${(stats.caseStudyInProgressNames || []).join('\n')}`
                            : 'No PE firm or portfolio company on this row has "Case Study Created?" set to Yes or In Progress'}
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700 }}
                      >
                        {stats.caseStudyState === 'yes' ? (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' }}>Yes</span>
                        ) : stats.caseStudyState === 'in-progress' ? (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>In Progress</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#64748B' }}>No</span>
                        )}
                      </div>
                      )}

                      {visibleCols.has('peStage') && (() => {
                        const meta = peStageMeta(pe.peStage);
                        const assigned = meta.stage !== 'Unassigned';
                        return (
                          <div
                            title={assigned
                              ? `PE Stage set to "${meta.stage}" in this firm's company popup`
                              : 'No PE Stage set on this firm\'s company popup'}
                            style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, overflow: 'hidden' }}
                          >
                            <span
                              style={{
                                display: 'inline-block', maxWidth: '100%', overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom',
                                padding: '1px 8px', borderRadius: 999,
                                background: meta.bg, border: `1px solid ${meta.border}`, color: meta.accent,
                                fontStyle: assigned ? 'normal' : 'italic', fontWeight: assigned ? 700 : 500,
                              }}
                            >{assigned ? meta.stage : 'Unassigned'}</span>
                          </div>
                        );
                      })()}

                      {visibleCols.has('newsFeed') && (() => {
                        // Mirrors the "Track acquisition news" checkbox on the
                        // firm's company popup — the same flag the weekly
                        // acquisition-news digest reads to pick its companies.
                        const tracked = pe.trackAcquisitionNews === true;
                        return (
                          <div
                            title={tracked
                              ? `"${pe.company}" is included in the weekly acquisition-news email. Untick "Track acquisition news" on its company popup to stop.`
                              : `"${pe.company}" is not in the weekly acquisition-news email. Tick "Track acquisition news" on its company popup to include it.`}
                            style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700 }}
                          >
                            {tracked ? (
                              <span style={{ padding: '1px 8px', borderRadius: 999, background: '#F3E8FF', border: '1px solid #DDD6FE', color: '#6D28D9' }}>Yes</span>
                            ) : (
                              <span style={{ padding: '1px 8px', borderRadius: 999, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#64748B' }}>No</span>
                            )}
                          </div>
                        );
                      })()}

                      <div style={{ padding: '0.55rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
                        {isExpanded ? '▾' : '▸'}
                      </div>
                    </button>

              {isExpanded && (
                <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {portfolio.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic' }}>
                      No portfolio companies point to this PE firm. Open a portfolio company's popup and set its <strong>PE Owner</strong> to &quot;{pe.company}&quot;.
                    </div>
                  ) : (
                    <>
                      {stageOrder.map(stage => {
                        const list = oppsByStage.get(stage) || [];
                        return (
                          <div key={stage} style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                              {stage} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({list.length})</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.4rem' }}>
                              {list.map((r, idx) => {
                                const parent = prospects.find(p => p.id === r._prospectId);
                                const title = r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
                                const value = r['Amount'] || r['Value'] || r['$'] || '';
                                const closeDate = r['Close Date'] || r['Est. Close'] || r['Target Close'] || '';
                                return (
                                  <div
                                    key={`${r._prospectId}-${idx}`}
                                    onClick={() => parent && onSelectProspect?.(parent)}
                                    style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: 'pointer' }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F6'}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                                  >
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                    <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r._company}</div>
                                    {value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>{String(value).startsWith('$') ? value : `$${value}`}</div>}
                                    {closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {closeDate}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {visibleOpps.length === 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic' }}>
                          No {showClosed ? '' : 'active '}opportunities on this PE firm's portfolio in the Opps tab.
                        </div>
                      )}
                      <div style={{ paddingTop: '0.4rem', borderTop: '1px dashed #E2E8F0' }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', marginBottom: '0.3rem' }}>
                          Linked portfolio companies
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {portfolio.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => onSelectProspect?.(p)}
                              style={{ padding: '2px 10px', background: '#EFF6FF', color: '#3B82F6', border: '1px solid #3B82F6', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#3B82F6'; e.currentTarget.style.color = '#fff'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#3B82F6'; }}
                            >{p.company}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
            </div>
          );
        })()}
      </div>
      </>
      )}
    </div>
  );
}

// "All PCs" sub-tab: every PE firm's mapped portfolio companies
// (the entries in each firm's Portfolio Companies tab) flattened into a
// single table, with a global search plus per-column filters and sorting
// via the shared DataTable. A leading PE Firm column records which firm
// each company came from and links back to that firm's company popup.
// The PE Owner dropdown filters rows to one owner: a row passes when the
// source PE firm matches the pick, the portfolio company itself is a
// Table View prospect whose PE Owner field matches it, or the source
// firm is in turn owned by the pick (GP stakes — picking "Blue Owl"
// also shows the portfolio companies of every firm whose PE Owner is
// Blue Owl). Matching uses the shared fuzzy companiesMatch so name
// variants ("Blue Owl" ↔ "Blue Owl Capital") line up.
function PEAllCompaniesTab({ firms, prospects = [], onSelectProspect }) {
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');

  // External Frameworks: the same list-flag signal the PC analysis table
  // in the prospect modal shows (CDP, GRESB, SBT, …), computed here for
  // every mapped portfolio company. Refreshes when a Lists-page mapping
  // is saved elsewhere (custom coverage-changed event) or another tab
  // writes to storage, so the column stays in step with those surfaces.
  const [listFlagsByCompany, setListFlagsByCompany] = useState(() => new Map());
  const [flagVersion, setFlagVersion] = useState(0);
  useEffect(() => {
    const bump = () => setFlagVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  const pcNames = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const pe of firms) {
      for (const pc of (Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies : [])) {
        const name = (pc.companyName || '').trim();
        if (!name) continue;
        const k = name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(name);
      }
    }
    return out;
  }, [firms]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (pcNames.length === 0) {
        if (!cancelled) setListFlagsByCompany(new Map());
        return;
      }
      const flags = await computeListFlags(pcNames, { prospects });
      if (!cancelled) setListFlagsByCompany(flags);
    })();
    return () => { cancelled = true; };
  }, [pcNames, prospects, flagVersion]);

  // Dropdown vocabulary: every PE firm that contributed rows + every
  // distinct PE Owner set on a Table View prospect, deduped
  // case-insensitively and sorted.
  const ownerOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (v) => {
      const t = String(v || '').trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    for (const pe of firms) {
      if (Array.isArray(pe.portfolioCompanies) && pe.portfolioCompanies.length > 0) push(pe.company);
    }
    for (const p of prospects) for (const o of splitPeOwners(p.peOwner)) push(o);
    return out.sort((a, b) => a.localeCompare(b));
  }, [firms, prospects]);

  // Company name (lowercased) → its Table View PE Owners (a company can
  // list several, comma-separated), for the "or the Company" half of
  // the owner filter.
  const ownerByCompany = useMemo(() => {
    const m = new Map();
    for (const p of prospects) {
      const owners = splitPeOwners(p.peOwner);
      const name = (p.company || '').trim().toLowerCase();
      if (owners.length && name) m.set(name, owners);
    }
    return m;
  }, [prospects]);

  const rows = useMemo(() => {
    const out = [];
    let id = 0;
    for (const pe of firms) {
      const pcs = Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies : [];
      // Opportunity Score is normalized within each firm's own portfolio —
      // same maxima/year-range basis as the firm's "Download Current Data"
      // export — so a PC's score here matches what it shows in that export.
      const maxE = pcs.reduce((m, r) => Math.max(m, Number(r.energyGwh) || 0), 0);
      const maxS = pcs.reduce((m, r) => Math.max(m, siteCountNumber(r.siteCount)), 0);
      const years = pcs.map(r => Number(r.acquisitionYear)).filter(y => y > 0);
      const yearRange = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;
      for (const pc of pcs) {
        out.push({
          id: id++,
          _peId: pe.id,
          score: computePortfolioFitScore(pc, maxE, maxS, yearRange),
          peFirm: pe.company || '',
          companyName: pc.companyName || '',
          sector: pc.sector || pc.industry || '',
          subsector: pc.subsector || '',
          subsectorScore: pc.subsectorScore ?? '',
          strategy: pc.strategy || '',
          hqCity: pc.hqCity || '',
          hqCountry: pc.hqCountry || '',
          energyGwh: pc.energyGwh ?? '',
          estElectricity: pc.estElectricity ?? '',
          estNaturalGas: pc.estNaturalGas ?? '',
          siteCount: pc.siteCount ?? '',
          acquisitionYear: pc.acquisitionYear ?? '',
          raClientMatch: pc.raClientMatch || '',
          clientManager: pc.clientManager || '',
          targetAccount: pc.targetAccount || '',
          frameworks: [...(listFlagsByCompany.get((pc.companyName || '').trim().toLowerCase()) || [])],
          pcDescription: pc.pcDescription || '',
          notes: pc.notes || '',
        });
      }
    }
    return out;
  }, [firms, listFlagsByCompany]);

  const columns = useMemo(() => [
    { key: 'peFirm', label: 'PE Firm', defaultWidth: 190, sticky: true, render: (r) => (
      <button
        type="button"
        onClick={() => { const pe = firms.find(f => f.id === r._peId); if (pe) onSelectProspect?.(pe); }}
        title={`Open "${r.peFirm}" in the Table View`}
        style={{ background: 'none', border: 'none', padding: 0, color: '#7C3AED', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left' }}
      >
        {r.peFirm || '-'}
      </button>
    ) },
    { key: 'companyName', label: 'Company Name', defaultWidth: 220 },
    { key: 'score', label: 'Opportunity Score', defaultWidth: 130, getSortValue: (r) => r.score, render: (r) => (r.score == null ? 'N/A' : r.score) },
    { key: 'sector', label: 'Sector', defaultWidth: 200 },
    { key: 'subsector', label: 'Subsector', defaultWidth: 180 },
    { key: 'subsectorScore', label: 'Subsector Score', defaultWidth: 120 },
    { key: 'strategy', label: 'Strategy', defaultWidth: 140 },
    { key: 'hqCity', label: 'HQ City', defaultWidth: 150 },
    { key: 'hqCountry', label: 'HQ Country', defaultWidth: 130 },
    { key: 'energyGwh', label: 'Est. Energy (GWh/yr)', defaultWidth: 150 },
    { key: 'estElectricity', label: 'Est. Electricity', defaultWidth: 130 },
    { key: 'estNaturalGas', label: 'Est. Natural Gas', defaultWidth: 130 },
    { key: 'siteCount', label: 'Site Count', defaultWidth: 100 },
    { key: 'acquisitionYear', label: 'Acquisition Year', defaultWidth: 120 },
    { key: 'raClientMatch', label: 'RA Client Match', defaultWidth: 160 },
    { key: 'clientManager', label: 'Client Manager', defaultWidth: 160 },
    { key: 'targetAccount', label: 'Target Account', defaultWidth: 160 },
    {
      key: 'frameworks',
      label: 'External Frameworks',
      defaultWidth: 200,
      headerTitle: 'External reporting / disclosure frameworks this company has been mapped onto from the Lists tab: same signal as the PC analysis table',
      getFilterValue: (r) => r.frameworks.join(', '),
      getSortValue: (r) => r.frameworks.join(', '),
      exportValue: (r) => r.frameworks.join(', '),
      render: (r) => (
        r.frameworks.length === 0
          ? <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>-</span>
          : (
            <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {r.frameworks.map(label => {
                const color = LIST_FLAG_BY_LABEL[label]?.color || { bg: '#F1F5F9', text: '#334155' };
                return (
                  <span
                    key={label}
                    title={`Flagged on the ${label} list`}
                    style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: color.bg, color: color.text, whiteSpace: 'nowrap' }}
                  >{label}</span>
                );
              })}
            </span>
          )
      ),
    },
    { key: 'pcDescription', label: 'PC Description', defaultWidth: 320 },
    { key: 'notes', label: 'Notes', defaultWidth: 220 },
  ], [firms, onSelectProspect]);

  const filtered = useMemo(() => {
    let out = rows;
    if (ownerFilter) {
      out = out.filter(r => {
        if (companiesMatch(r.peFirm, ownerFilter)) return true;
        const owners = ownerByCompany.get(r.companyName.trim().toLowerCase()) || [];
        if (owners.some(o => companiesMatch(o, ownerFilter))) return true;
        // One level up the ownership chain: the firm that mapped this
        // PC is itself owned by the pick (its Table View PE Owner
        // matches), so its portfolio companies belong to the pick's
        // GP-stakes family too.
        const firmOwners = ownerByCompany.get(r.peFirm.trim().toLowerCase()) || [];
        return firmOwners.some(o => companiesMatch(o, ownerFilter));
      });
    }
    const term = search.trim().toLowerCase();
    if (!term) return out;
    return out.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [search, rows, ownerFilter, ownerByCompany]);

  return (
    <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${rows.length} portfolio compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <select
          value={ownerFilter}
          onChange={e => setOwnerFilter(e.target.value)}
          title="Show only companies under one PE owner: matches the source PE firm, the company's own PE Owner from Table View, or firms that owner owns (their PCs count too)"
          style={{
            maxWidth: 220, padding: '0.4rem 0.6rem',
            border: `1px solid ${ownerFilter ? '#7C3AED' : '#E2E8F0'}`, borderRadius: 6,
            fontSize: '0.78rem', fontFamily: 'inherit',
            color: ownerFilter ? '#7C3AED' : 'inherit', fontWeight: ownerFilter ? 700 : 400,
            background: '#fff', cursor: 'pointer',
          }}
        >
          <option value="">All PE Owners</option>
          {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {(search.trim() || ownerFilter) && <span style={{ fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>{filtered.length} of {rows.length}</span>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No portfolio companies mapped yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Open a PE firm's company popup and add companies in its <strong>Portfolio Companies</strong> tab: they'll be merged here.
            </div>
          </div>
        ) : (
          <DataTable
            tableId="pe-all-portfolio-companies"
            columns={columns}
            rows={filtered}
            alwaysVisible={['peFirm']}
            defaultSort={{ key: 'score', direction: 'desc' }}
            enableColumnFilters
            emptyMessage="No portfolio companies match your filters"
            exportFileName="pe_portfolio_companies"
            exportPrimarySheetName="Portfolio Companies"
          />
        )}
      </div>
    </>
  );
}

// Rows pasted onto the PE Firm tab that don't carry their own PE Owner
// column inherit the currently selected firm — new companies land in
// Table View already owned by it (so they show up on this tab), and
// matched companies with a blank PE Owner get it filled. The default is
// built per-render from the selected firm, so there's no module-level
// constant here anymore.

// Prospect fields the bulk-edit bar can set. Enum-backed
// fields render a picker fed from the shared vocabularies; HQ Region's
// two options mirror the company popup's dropdown. peAum is parsed to
// a number (blank clears it).
const BLUE_OWL_BULK_FIELDS = [
  { key: 'status', label: 'Status', options: STATUSES },
  { key: 'cdm', label: 'CDM' },
  { key: 'type', label: 'Type', options: TYPES },
  { key: 'tier', label: 'Tier', options: TIERS },
  { key: 'geography', label: 'Geography', options: GEOGRAPHIES },
  { key: 'hqRegion', label: 'HQ Region', options: ['North America', 'Outside of North America'] },
  { key: 'website', label: 'Website' },
  { key: 'peAum', label: 'PE AUM ($B)', type: 'number' },
  { key: 'peOwner', label: 'PE Owner' },
  { key: 'notes', label: 'Notes' },
];

// Bulk-edit bar for the Blue Owl tab — appears once any rows are
// checked. Pick a field, give it a value, Apply writes it to every
// selected company's Table View record. Same shape as Opps 2's
// MassEditBar, but against prospect fields. A blank value clears the
// field (the Apply button is explicit about which it'll do).
function BlueOwlBulkEditBar({ selectedCount, applying, onApply, onClear }) {
  const [fieldKey, setFieldKey] = useState('status');
  const [value, setValue] = useState('');
  // Reset the value buffer when the field changes so a stale value from
  // the previous field doesn't get applied by accident.
  useEffect(() => { setValue(''); }, [fieldKey]);
  const field = BLUE_OWL_BULK_FIELDS.find(f => f.key === fieldKey) || BLUE_OWL_BULK_FIELDS[0];
  const inputStyle = { padding: '0.3rem 0.45rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.78rem' }}>
      <span style={{ fontWeight: 700, color: '#1E3A8A' }}>{selectedCount} selected</span>
      <span style={{ color: '#64748B' }}>·</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: '#64748B' }}>Set</span>
        <select value={fieldKey} onChange={e => setFieldKey(e.target.value)} style={inputStyle}>
          {BLUE_OWL_BULK_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      <span style={{ color: '#64748B' }}>to</span>
      {field.options ? (
        <select value={value} onChange={e => setValue(e.target.value)} style={{ ...inputStyle, minWidth: 170 }}>
          <option value="">(blank (clear))</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          step={field.type === 'number' ? 'any' : undefined}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="New value (blank to clear)"
          style={{ ...inputStyle, minWidth: 200 }}
        />
      )}
      <button
        type="button"
        disabled={applying}
        onClick={() => onApply(field, value)}
        style={{ padding: '0.35rem 0.85rem', background: applying ? '#94A3B8' : '#3B82F6', border: 'none', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', color: '#fff', cursor: applying ? 'wait' : 'pointer' }}
      >{applying ? 'Applying…' : `${value.trim() ? 'Apply to' : 'Clear on'} ${selectedCount}`}</button>
      <button
        type="button"
        onClick={onClear}
        disabled={applying}
        style={{ padding: '0.35rem 0.7rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', color: '#475569', cursor: 'pointer' }}
      >Clear selection</button>
    </div>
  );
}

// PE Firm sub-tab: every Table View prospect whose PE Owner names the
// firm picked in the in-tab dropdown (defaulting to Blue Owl), as one
// searchable, filterable table via the shared DataTable. Unlike All PCs
// (which reads each firm's Portfolio Companies tab), these are full
// prospect records — so each row links straight to the company's own
// popup, the Paste from Excel button writes straight back to Table View
// (fill blanks / optionally overwrite on existing companies, add the
// rest as new prospects owned by the selected firm), and every
// prospect-backed cell edits in place through Table View's InlineCell
// (double-click; enum columns get the same dropdown options Table View
// shows, including "+ Add new" for Type / CDM).
// Compact read-only cell for a list of names (PC opp companies /
// contacts / decision makers): shows them comma-joined on one line,
// truncated with the full list on hover, or a muted placeholder when
// the list is empty.
// Sold reads dark green, in-flight reads dark yellow, Not Sold reads red —
// the same three colours the company card's Services Explored grid and the
// Opps Scope picker paint those statuses, so a service looks the same
// wherever it's listed.
const SOLD_TEXT = serviceStatusColor('Sold').color || '#166534';
const IN_PROGRESS_TEXT = serviceStatusColor('In Progress').color || '#854D0E';
const NOT_SOLD_TEXT = serviceStatusColor('Not Sold').color || '#991B1B';

// A services cell that carries its outcome in its colour: the sold ones
// first in dark green, then the ones marked Not Sold in red. Same one-line,
// ellipsised shape as NameListCell — the tooltip spells the split out in
// full, since the row only has room for the first few.
function ServiceOutcomeCell({ sold = [], inProgress = [], notSold = [], empty }) {
  // Won first, then in flight, then lost: the cell reads down the pipeline
  // rather than in whatever order the statuses happened to be entered.
  const groups = [
    { label: 'Sold', names: sold.filter(Boolean), color: SOLD_TEXT },
    { label: 'In progress', names: inProgress.filter(Boolean), color: IN_PROGRESS_TEXT },
    { label: 'Not sold', names: notSold.filter(Boolean), color: NOT_SOLD_TEXT },
  ].filter(g => g.names.length > 0);
  if (groups.length === 0) {
    return <span style={{ color: '#CBD5E1' }} title={empty || ''}>-</span>;
  }
  const tip = groups.map(g => `${g.label}:\n${g.names.map(n => `• ${n}`).join('\n')}`).join('\n\n');
  const parts = groups.flatMap(g => g.names.map(name => ({ name, color: g.color })));
  return (
    <span
      title={tip}
      style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.78rem' }}
    >
      {parts.map(({ name, color }, i) => (
        <span key={name} style={{ color }}>{i > 0 ? ', ' : ''}{name}</span>
      ))}
    </span>
  );
}

// A row's entry for one bucket, always shaped { sold, notSold } even when
// the row has nothing filed in that box.
const EMPTY_BUCKET = { sold: [], inProgress: [], notSold: [] };
function bucketOf(row, name) { return row._byBucket[name] || EMPTY_BUCKET; }

// Every service in a bucket cell whatever its outcome — what the column's
// filter box matches on, so typing a service name finds the row either way.
function bucketNames(box) { return [...box.sold, ...box.inProgress, ...box.notSold]; }

// One outcome cell as a single export string, for an export that can only
// carry text — the not-sold and in-flight ones say so in words there,
// because nothing else would tell them apart.
function bucketExport(box) {
  return [
    ...box.sold,
    ...box.inProgress.map(n => `${n} (in progress)`),
    ...box.notSold.map(n => `${n} (not sold)`),
  ].join(', ');
}

// The same cell as coloured runs, for an export that can carry colour: one
// run per service, in the pipeline order the on-screen cell reads in. The
// styled workbook picks these up (see exportSchneider) and the words drop
// out — the colour is the marker there, exactly as it is on screen.
function outcomeRuns({ sold = [], inProgress = [], notSold = [] }) {
  return [
    ...sold.filter(Boolean).map(text => ({ text, color: SOLD_TEXT })),
    ...inProgress.filter(Boolean).map(text => ({ text, color: IN_PROGRESS_TEXT })),
    ...notSold.filter(Boolean).map(text => ({ text, color: NOT_SOLD_TEXT })),
  ];
}

function NameListCell({ items, empty }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) {
    return <span style={{ color: '#CBD5E1' }} title={empty || ''}>-</span>;
  }
  return (
    <span
      title={list.join('\n')}
      style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.78rem', color: '#334155' }}
    >
      {list.join(', ')}
    </span>
  );
}

// Inline editor for the Blue Owl tab's Client Manager column. Mirrors the
// Clients tab's editor (local draft, commit on blur/Enter, revert on
// Escape) and writes to the same per-company clientManagerStore, so a
// manager typed here and on the Clients tab stays in sync. Swallows click
// + keydown so editing doesn't open the row's popup or hit table shortcuts.
function ClientManagerCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="-"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.78rem', fontFamily: 'inherit',
      }}
    />
  );
}

// Read-only popup that shows the Opps-tab opportunities matched to a
// company — opened from the PE Overview tab's Services In Progress cell.
// Active (in-flight) opps are listed first so the "current" opportunity
// behind the in-progress services is front and centre. Each opp shows the
// fields users scan for on the Opps tab; the BFO Link opens the full
// opportunity record in a new tab.
function CompanyOppsModal({ company, opps = [], onClose, onOpenCompany }) {
  const backdropMouseDown = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const oppTitle = (r) => r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
  const fields = [
    ['Account', (r) => r['Account']],
    ['Contact', (r) => r['Contact']],
    ['Scope', (r) => r['Scope']],
    ['Sales Partner', (r) => r['Sales Partner']],
    ['Amount', (r) => { const v = r['Amount'] || r['Value'] || r['$'] || ''; return v && !String(v).startsWith('$') ? `$${v}` : v; }],
    ['Close Date', (r) => formatDateDisplay(r['Close Date'] || r['Est. Close'] || r['Target Close'] || '')],
    ['Next Steps', (r) => r['Next Steps']],
  ];
  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640, maxWidth: '94vw', maxHeight: '88vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Opportunities: {company || '-'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {opps.length} matching opportunit{opps.length === 1 ? 'y' : 'ies'} from the Opps tab
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{ flexShrink: 0, marginLeft: '0.75rem', background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, color: '#94A3B8', cursor: 'pointer' }}
          >×</button>
        </div>
        <div style={{ padding: '0.85rem 1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {opps.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: '#64748B', fontStyle: 'italic' }}>No opportunities found.</div>
          ) : opps.map((r, idx) => {
            const stage = (r['Stage'] || '').trim();
            const isActive = !CLOSED_STAGES.has(stage) && !INVALID_STAGES.has(stage);
            const bfoLink = r['BFO Link'];
            return (
              <div key={idx} style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.6rem 0.75rem', background: isActive ? '#FAF5FF' : '#FBFBFB' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {oppTitle(r)}
                  </div>
                  {stage && (
                    <span style={{ flexShrink: 0, padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', background: isActive ? '#7C3AED' : '#CBD5E1', color: '#fff' }}>
                      {stage}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.6rem', fontSize: '0.75rem' }}>
                  {fields.map(([label, get]) => {
                    const val = get(r);
                    if (val == null || String(val).trim() === '' || String(val).trim() === '-') return null;
                    return (
                      <div key={label} style={{ display: 'contents' }}>
                        <div style={{ color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
                        <div style={{ color: '#334155', wordBreak: 'break-word' }}>{String(val)}</div>
                      </div>
                    );
                  })}
                </div>
                {bfoLink && /^https?:\/\//i.test(String(bfoLink).trim()) && (
                  <a
                    href={String(bfoLink).trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: '0.5rem', fontSize: '0.72rem', fontWeight: 600, color: '#2563EB' }}
                  >Open in BFO ↗</a>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.7rem 1rem', borderTop: '1px solid #E2E8F0' }}>
          {onOpenCompany && (
            <button
              type="button"
              onClick={onOpenCompany}
              style={{ padding: '0.4rem 0.85rem', border: '1px solid #7C3AED', borderRadius: 6, background: '#fff', color: '#7C3AED', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >Open company in Table View</button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.4rem 0.85rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', color: '#334155', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// `variant` picks which of the two tabs this instance is rendering:
//   'overview' — the PE Overview tab: every company column.
//   'services' — the PE Overview - Services tab: the same columns plus
//                the services breakdown, one column per Service Bucket,
//                sold in green, in progress in yellow and not sold in red
//                (which is why this variant drops the Services Not Sold
//                column). Same rows,
//                same editing, its own saved column layout (own tableId)
//                so widening the Services tab out to the bucket columns
//                doesn't disturb the layout the user keeps on PE Overview.
function PEBlueOwlTab({ variant = 'overview', companies, selectedFirm = '', firmOptions = [], onSelectFirm, prospects = [], oppsRecords = [], portfolioByPe = new Map(), dmNamesByCompanyId = new Map(), onSelectProspect, onUpdateProspect, onAddProspect, onDownloadPortfolio, settings, updateSettings }) {
  const isServicesVariant = variant === 'services';
  const tabLabel = isServicesVariant ? 'PE Overview - Services' : 'PE Overview';
  const firmLabel = selectedFirm.trim() || 'PE firm';
  // Strategy-tag vocabulary shared with the company popup, so a tag added
  // in either surface shows up in the other.
  const strategyOptions = useMemo(() => buildStrategyOptions(prospects, settings), [prospects, settings]);
  // Asset Types vocabulary, managed on the Dropdowns tab — fed into the
  // Asset Types column's inline tags editor so it matches Table View.
  const assetTypeOptions = useMemo(() => buildAssetTypeOptions(prospects, settings), [prospects, settings]);
  // Toggle one strategy tag on a firm, persisting the whole array.
  const toggleStrategy = useCallback((prospect, tag) => {
    const current = Array.isArray(prospect?.strategies) ? prospect.strategies : [];
    const next = current.includes(tag) ? current.filter(s => s !== tag) : [...current, tag];
    onUpdateProspect?.(prospect.id, { strategies: next });
  }, [onUpdateProspect]);
  const addStrategy = useCallback((tag) => persistCustomStrategy(tag, settings, updateSettings), [settings, updateSettings]);
  const [search, setSearch] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // Client Manager values live in the shared per-company store (the same
  // one the Clients tab edits), keyed by normalized company name. Mirror
  // it into state and refresh on the store's change event + cross-tab
  // storage writes so the column stays live as managers are edited here
  // or on the Clients tab.
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  useEffect(() => {
    const refresh = () => setManagerMap(loadClientManagerMap());
    const onStorage = (e) => { if (e.key === 'clients-manager-map') refresh(); };
    window.addEventListener(CLIENT_MANAGER_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CLIENT_MANAGER_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  // Bulk-edit selection. filteredRowIds mirrors the rows currently
  // passing the DataTable's column filters (and this tab's search) so
  // the header checkbox selects exactly what's on screen.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [filteredRowIds, setFilteredRowIds] = useState(() => new Set());
  const [bulkApplying, setBulkApplying] = useState(false);
  // Row whose matching Opps-tab opportunities are shown in the detail
  // popup — set by clicking a Services In Progress cell that has a
  // current opp on the company.
  const [oppsModalRow, setOppsModalRow] = useState(null);
  const [servicesReportOpen, setServicesReportOpen] = useState(false);

  // Set-equality guard (same as Opps 2's handler): returning prev when
  // the ids haven't changed stops the notify → setState → re-render →
  // notify cycle the DataTable callback would otherwise feed.
  const handleFilteredRowsChange = useCallback((tableRows) => {
    setFilteredRowIds(prev => {
      const next = new Set();
      for (const r of (tableRows || [])) if (r?.id != null) next.add(r.id);
      if (prev.size === next.size && [...prev].every(id => next.has(id))) return prev;
      return next;
    });
  }, []);

  // A bulk edit can move a company off this tab (e.g. PE Owner no
  // longer names Blue Owl, or Type set to Portfolio Company) — drop
  // departed ids from the selection so the count stays honest.
  useEffect(() => {
    setSelectedIds(prev => {
      const valid = new Set(companies.map(p => p.id));
      if ([...prev].every(id => valid.has(id))) return prev;
      return new Set([...prev].filter(id => valid.has(id)));
    });
  }, [companies]);

  // Write one field to every selected company's Table View record.
  // Sequential so a flaky write surfaces per company instead of a
  // half-applied Promise.all; failures are collected and reported.
  async function applyBulkEdit(field, rawValue) {
    if (!onUpdateProspect || selectedIds.size === 0) return;
    let value = rawValue.trim();
    if (field.type === 'number') {
      const n = parseFloat(value.replace(/[,$]/g, ''));
      value = Number.isFinite(n) ? n : null;
    }
    setBulkApplying(true);
    const failed = [];
    try {
      for (const id of selectedIds) {
        try {
          await onUpdateProspect(id, { [field.key]: value });
        } catch (err) {
          console.error('Blue Owl bulk edit: update failed', { id, field: field.key, err });
          failed.push(companies.find(c => c.id === id)?.company || id);
        }
      }
      if (failed.length) {
        window.alert(`Bulk edit failed for ${failed.length} compan${failed.length === 1 ? 'y' : 'ies'}: try again:\n  ${failed.join('\n  ')}`);
      }
    } finally {
      setBulkApplying(false);
    }
  }

  // Per-company opp counts from the Opps tab, shown as active/total.
  // Same matcher and stage buckets the Portfolio tab's PE Opps column
  // uses: accounts tie to companies via the strict accountMatchesCompany,
  // invalid stages are dropped entirely, total counts every opp ever and
  // active excludes the closed stages (Sold / Not Sold / Closed / Lost).
  const oppCountsByCompanyId = useMemo(() => {
    const map = new Map();
    if (oppsRecords.length === 0) return map;
    for (const p of companies) {
      const name = (p.company || '').trim().toLowerCase();
      if (!name) continue;
      let active = 0;
      let total = 0;
      const tip = [];
      // Keep the matching opp records so the Services In Progress cell can
      // pop their details — active stages first, then the rest, so the
      // "current" opps surface at the top of the modal.
      const records = [];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct || !accountMatchesCompany(name, acct)) continue;
        total++;
        const isActive = !CLOSED_STAGES.has(stage);
        if (isActive) active++;
        records.push({ record: r, isActive });
        tip.push(`• ${r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)'}${stage ? `: ${stage}` : ''}`);
      }
      records.sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1));
      if (total > 0) map.set(p.id, { active, total, tip, records: records.map(x => x.record) });
    }
    return map;
  }, [companies, oppsRecords]);

  // Same counting for each firm's portfolio companies — every prospect
  // whose PE Owner names this firm (the portfolioByPe linkage the
  // Portfolio tab uses). Opps are scanned outer-loop so an opp whose
  // account matches two sister PCs still counts once.
  const pcOppCountsByCompanyId = useMemo(() => {
    const map = new Map();
    if (oppsRecords.length === 0) return map;
    for (const p of companies) {
      const portfolio = portfolioByPe.get((p.company || '').trim().toLowerCase()) || [];
      if (portfolio.length === 0) continue;
      const pcNames = portfolio
        .map(pc => ({ name: (pc.company || '').trim().toLowerCase(), display: pc.company }))
        .filter(pc => pc.name);
      let active = 0;
      let total = 0;
      const tip = [];
      // Distinct portfolio-company names that carry a PC opp, and the
      // distinct contact names tied to those opps — surfaced as their own
      // columns next to PC Opps.
      const companySeen = new Set();
      const companyNames = [];
      const contactSeen = new Set();
      const contactNames = [];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct) continue;
        const pcMatch = pcNames.find(pc => accountMatchesCompany(pc.name, acct));
        if (!pcMatch) continue;
        total++;
        if (!CLOSED_STAGES.has(stage)) active++;
        tip.push(`• ${r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)'}${stage ? `: ${stage}` : ''} [${pcMatch.display}]`);
        const display = (pcMatch.display || '').trim();
        if (display && !companySeen.has(display.toLowerCase())) {
          companySeen.add(display.toLowerCase());
          companyNames.push(display);
        }
        for (const c of String(r['Contact'] || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)) {
          if (contactSeen.has(c.toLowerCase())) continue;
          contactSeen.add(c.toLowerCase());
          contactNames.push(c);
        }
      }
      if (total > 0) map.set(p.id, { active, total, tip, companyNames, contactNames });
    }
    return map;
  }, [companies, portfolioByPe, oppsRecords]);

  // Which of these companies already have a Master Analysis saved against
  // them (the workbook the Utility Lookup page saves), and when.
  const savedAnalyses = useSavedAnalyses(companies);

  // Services Sold, broken out by the service's bucket — the box the
  // services board files it in ("DATA", "RA Modules", "GHG Reporting", …),
  // the same layout the Opps Scope picker lays out and the Service Bucket
  // column on Dropdowns › Services edits. One column per box (below), so a
  // row shows which part of the portfolio each sold service came from
  // instead of one run-on list.
  //
  // Every box gets a column whether or not a sold service currently sits in
  // it, so the columns don't appear and vanish as the user switches PE firm
  // (which would churn their saved column layout).
  const serviceCategories = useMemo(() => getServiceCategories(settings), [settings]);
  // Column key per box, in board order. Prefixed and slugged so a box name
  // with punctuation or spaces can't collide with a real column key or
  // break the saved-prefs maps.
  const bucketColumns = useMemo(() => (isServicesVariant ? serviceCategories.map(c => c.name).map(name => ({
    name,
    key: `svcBucket:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  })) : []), [serviceCategories, isServicesVariant]);

  const rows = useMemo(() => companies.map(p => {
    const counts = oppCountsByCompanyId.get(p.id);
    const pcCounts = pcOppCountsByCompanyId.get(p.id);
    const analysis = savedAnalyses.get(p.id) || null;
    // Bucket the explored services by outcome. "In Progress" is any
    // service that's been explored but isn't a terminal Sold / Not Sold
    // (or N/A / blank) — i.e. the in-flight statuses (Exploring, Quoting,
    // Verbal, In Progress, etc.).
    const svc = p.servicesExplored || {};
    const servicesSold = [];
    const servicesNotSold = [];
    const servicesInProgress = [];
    for (const [name, status] of Object.entries(svc)) {
      const s = String(status || '').trim();
      if (s === 'Sold') servicesSold.push(name);
      else if (s === 'Not Sold') servicesNotSold.push(name);
      else if (s && s !== '-' && s !== 'N/A') servicesInProgress.push(name);
    }
    // Every explored service grouped by bucket, plus a catch-all for the
    // ones no box claims — the Scope picker's "Other services" card. All
    // three outcomes live in the same cell (green / yellow / red) rather
    // than in three columns, so a box reads as "here's what we sold, what's
    // still open, and what we lost". The buckets always sum back to
    // Services Sold + In Progress + Not Sold: nothing is dropped.
    const byBucket = {};
    const noBucket = { sold: [], inProgress: [], notSold: [] };
    const fileService = (name, outcome) => {
      const bucket = serviceBucketOf(serviceCategories, name);
      const box = bucket ? (byBucket[bucket] ||= { sold: [], inProgress: [], notSold: [] }) : noBucket;
      box[outcome].push(name);
    };
    for (const name of servicesSold) fileService(name, 'sold');
    for (const name of servicesInProgress) fileService(name, 'inProgress');
    for (const name of servicesNotSold) fileService(name, 'notSold');
    return {
      id: p.id,
      _prospect: p,
      _byBucket: byBucket,
      _noBucket: noBucket,
      _oppsTip: counts?.tip || [],
      _oppRecords: counts?.records || [],
      _pcOppsTip: pcCounts?.tip || [],
      _pcCount: (portfolioByPe.get((p.company || '').trim().toLowerCase()) || []).length,
      // Mapped portfolio companies from this firm's own Portfolio
      // Companies tab — the array the PC Download export ships.
      _pcMappedCount: Array.isArray(p.portfolioCompanies) ? p.portfolioCompanies.length : 0,
      strategies: Array.isArray(p.strategies) ? p.strategies : [],
      company: p.company || '',
      status: p.status || '',
      cdm: p.cdm || '',
      clientManager: resolveManagerFromMap(p.company, managerMap),
      type: p.type || '',
      assetTypes: Array.isArray(p.assetTypes) ? p.assetTypes : [],
      tier: p.tier || '',
      geography: p.geography || '',
      hqRegion: p.hqRegion || '',
      website: p.website || '',
      peAum: p.peAum ?? '',
      oppsActive: counts?.active || 0,
      oppsTotal: counts?.total || 0,
      pcOppsActive: pcCounts?.active || 0,
      pcOppsTotal: pcCounts?.total || 0,
      pcOppCompanies: pcCounts?.companyNames || [],
      pcOppContacts: pcCounts?.contactNames || [],
      decisionMakerNames: dmNamesByCompanyId.get(p.id) || [],
      servicesSold,
      servicesNotSold,
      servicesInProgress,
      peOwner: p.peOwner || '',
      notes: p.notes || '',
      // Master Analysis saved against this company: the timestamp drives
      // sorting (0 = none), the meta drives the cell's tooltip.
      _analysis: analysis,
      analysisSavedAt: analysis?.savedAt ? new Date(analysis.savedAt).getTime() || 0 : (analysis ? 1 : 0),
    };
  }), [companies, oppCountsByCompanyId, pcOppCountsByCompanyId, portfolioByPe, dmNamesByCompanyId, managerMap, savedAnalyses, serviceCategories]);

  // Same dropdown vocabularies as Table View's inline editors, built
  // from the full prospect list so the options match exactly.
  const typeOptions = useMemo(() => buildTypeOptions(prospects, settings), [prospects, settings]);
  const cdmOptions = useMemo(() => buildCdmOptions(prospects, settings), [prospects, settings]);
  const handleAddOption = useCallback((colKey, name) => {
    persistCustomOption(colKey, name, settings, updateSettings, cdmOptions);
  }, [settings, updateSettings, cdmOptions]);

  const columns = useMemo(() => {
    // Each prospect-backed cell edits through Table View's InlineCell
    // (double-click to edit; enum columns drop down the same options
    // Table View shows). colDefs mirror Table View's COLUMNS for the
    // overlapping fields. The Opps / PC Opps columns stay read-only —
    // they're derived from the Opps tab, not stored on the prospect.
    const editable = (colDef, getValue) => function EditableCell(r) {
      return (
        <InlineCell
          value={getValue ? getValue(r) : r[colDef.key]}
          prospect={r._prospect}
          colDef={colDef}
          onUpdate={onUpdateProspect}
          onAddOption={handleAddOption}
        />
      );
    };
    return [
      { key: 'company', label: 'Company', defaultWidth: 240, sticky: true, render: (r) => (
        <button
          type="button"
          onClick={() => onSelectProspect?.(r._prospect)}
          title={`Open "${r.company}" in the Table View`}
          style={{ background: 'none', border: 'none', padding: 0, color: '#7C3AED', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left' }}
        >
          {r.company || '-'}
        </button>
      ) },
      // Explored-services breakdown, pulled from each prospect's
      // servicesExplored map (service name -> status). Read-only here —
      // edit the statuses in the prospect's Services Explored panel.
      //
      // Services Sold is PE Overview's. The Services tab drops it for the
      // same reason it drops Services Not Sold: every sold service is
      // already in its bucket column there, in green, so a second run-on
      // list of the same names would just cost a column's width.
      ...(isServicesVariant ? [] : [{ key: 'servicesSold', label: 'Services Sold', defaultWidth: 220,
        getSortValue: (r) => r.servicesSold.length,
        getFilterValue: (r) => r.servicesSold.join(', '),
        exportValue: (r) => r.servicesSold.join(', '),
        exportRuns: (r) => outcomeRuns({ sold: r.servicesSold }),
        render: (r) => <ServiceOutcomeCell sold={r.servicesSold} empty="No services sold" /> }]),
      // One column per bucket: what that box sold in dark green, what's
      // still in flight in dark yellow, then what it lost in red.
      ...bucketColumns.map(({ name, key }) => ({
        key,
        label: name,
        // Wider than the old "#DATA" project columns were: bucket names
        // are words, not tags. The longest few still truncate — the
        // header's tooltip spells them out, and widths are draggable.
        defaultWidth: 200,
        renderHeader: (label) => (
          <span title={`Services the services board files under "${name}": sold in green, in progress in yellow, Not Sold in red (a service's box is its Service Bucket on the Dropdowns › Services tab)`}>{label}</span>
        ),
        // Sold count leads the sort, then in-flight, then not-sold, so a
        // firm that bought the most in this box sorts to the top and the
        // ones with the most still open follow.
        getSortValue: (r) => bucketOf(r, name).sold.length * 1e6
          + bucketOf(r, name).inProgress.length * 1e3
          + bucketOf(r, name).notSold.length,
        getFilterValue: (r) => bucketNames(bucketOf(r, name)).join(', '),
        exportValue: (r) => bucketExport(bucketOf(r, name)),
        exportRuns: (r) => outcomeRuns(bucketOf(r, name)),
        render: (r) => <ServiceOutcomeCell {...bucketOf(r, name)} empty={`No ${name} services explored`} />,
      })),
      // Services no box claims — the same card the Scope picker adds. Kept
      // so the per-bucket columns account for every explored service rather
      // than quietly losing the unfiled ones.
      ...(isServicesVariant ? [{ key: 'svcBucketNone', label: UNGROUPED_SERVICES, defaultWidth: 200,
        renderHeader: (label) => (
          <span title="Services that no box on the services board claims: sold in green, in progress in yellow, Not Sold in red — set a Service Bucket on the Dropdowns › Services tab to file one">{label}</span>
        ),
        getSortValue: (r) => r._noBucket.sold.length * 1e6
          + r._noBucket.inProgress.length * 1e3
          + r._noBucket.notSold.length,
        getFilterValue: (r) => bucketNames(r._noBucket).join(', '),
        exportValue: (r) => bucketExport(r._noBucket),
        exportRuns: (r) => outcomeRuns(r._noBucket),
        render: (r) => <ServiceOutcomeCell {...r._noBucket} empty="No unfiled services explored" /> }] : []),
      // Services Not Sold has its own column on PE Overview. The Services
      // tab drops it: every not-sold service is already in its bucket
      // column there, in red, so a second run-on list of the same names
      // would just cost a column's width.
      ...(isServicesVariant ? [] : [{ key: 'servicesNotSold', label: 'Services Not Sold', defaultWidth: 220,
        getSortValue: (r) => r.servicesNotSold.length,
        getFilterValue: (r) => r.servicesNotSold.join(', '),
        exportValue: (r) => r.servicesNotSold.join(', '),
        exportRuns: (r) => outcomeRuns({ notSold: r.servicesNotSold }),
        render: (r) => <ServiceOutcomeCell notSold={r.servicesNotSold} empty="No services marked not sold" /> }]),
      // Services In Progress: in-flight explored services. When the
      // company has a matching opp in the Opps tab, the cell becomes a
      // link that pops those opps' details (active first) — so a user can
      // jump from "what's in progress" to the live opportunity behind it.
      { key: 'servicesInProgress', label: 'Services In Progress', defaultWidth: 220,
        getSortValue: (r) => r.servicesInProgress.length,
        getFilterValue: (r) => r.servicesInProgress.join(', '),
        exportValue: (r) => r.servicesInProgress.join(', '),
        exportRuns: (r) => outcomeRuns({ inProgress: r.servicesInProgress }),
        render: (r) => {
          // Dark yellow, same as the in-flight services in the bucket
          // columns — except when the row has matching opps, where the cell
          // is a link and stays the table's link purple so it still reads
          // as clickable.
          if (r.servicesInProgress.length === 0 || r._oppRecords.length === 0) {
            return <ServiceOutcomeCell inProgress={r.servicesInProgress} empty="No services in progress" />;
          }
          const oppCount = r._oppRecords.length;
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOppsModalRow(r); }}
              title={`View ${oppCount} matching opportunit${oppCount === 1 ? 'y' : 'ies'} from the Opps tab\n${r._oppsTip.join('\n')}`}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '0.78rem', color: '#7C3AED', fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                textDecoration: 'underline', textDecorationStyle: 'dotted',
              }}
            >
              {r.servicesInProgress.join(', ')}
            </button>
          );
        } },
      // Bulk-edit checkbox. Sits after the Company column (not before)
      // because Company is the sticky column pinned at left: 0 — a
      // column to its left would slide underneath it on horizontal
      // scroll. The header checkbox selects/clears every row passing
      // the current filters.
      { key: '_select', label: '', defaultWidth: 36, getFilterValue: () => '', renderHeader: () => {
        const filteredArr = [...filteredRowIds];
        const selectedInFilter = filteredArr.filter(id => selectedIds.has(id)).length;
        const allSelected = filteredArr.length > 0 && selectedInFilter === filteredArr.length;
        return (
          <input
            type="checkbox"
            ref={(el) => { if (el) el.indeterminate = selectedInFilter > 0 && !allSelected; }}
            checked={allSelected}
            disabled={filteredArr.length === 0}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelectedIds(prev => {
                const next = new Set(prev);
                for (const id of filteredArr) { if (checked) next.add(id); else next.delete(id); }
                return next;
              });
            }}
            style={{ margin: 0, cursor: filteredArr.length === 0 ? 'not-allowed' : 'pointer' }}
            title={allSelected
              ? `Clear selection for all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`
              : `Select all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'} for bulk edit`}
          />
        );
      }, render: (r) => (
        <input
          type="checkbox"
          checked={selectedIds.has(r.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (checked) next.add(r.id); else next.delete(r.id);
              return next;
            });
          }}
          style={{ margin: 0, cursor: 'pointer' }}
          title="Select for bulk edit"
        />
      ) },
      { key: 'status', label: 'Status', defaultWidth: 140, render: editable({ key: 'status', label: 'Status', type: 'enum', options: STATUSES }) },
      { key: 'cdm', label: 'CDM', defaultWidth: 160, render: editable({ key: 'cdm', label: 'CDM', type: 'enum', options: cdmOptions, allowAddNew: true }) },
      // Client Manager — the per-company manager stored in the shared
      // clientManagerStore (same value the Clients tab shows/edits), keyed
      // by company name. Editable inline here; commits sync to the Clients
      // tab via the store's change event.
      { key: 'clientManager', label: 'Client Manager', defaultWidth: 170,
        getSortValue: (r) => (r.clientManager || '').toLowerCase(),
        getFilterValue: (r) => r.clientManager,
        exportValue: (r) => r.clientManager,
        render: (r) => <ClientManagerCell company={r.company} value={r.clientManager} onCommit={setClientManager} /> },
      { key: 'type', label: 'Type', defaultWidth: 150, render: editable({ key: 'type', label: 'Type', type: 'enum', options: typeOptions, allowAddNew: true }) },
      // Asset Types — the same multi-tag field Table View shows, edited
      // inline through InlineCell's TagsCell. Its vocabulary is managed on
      // the Dropdowns tab (assetTypeOptions). Read the array off the
      // prospect so sort/filter/export agree with the values being edited.
      { key: 'assetTypes', label: 'Asset Types', defaultWidth: 170,
        getSortValue: (r) => r.assetTypes.length,
        getFilterValue: (r) => r.assetTypes.join(', '),
        exportValue: (r) => r.assetTypes.join(', '),
        render: editable({ key: 'assetTypes', label: 'Asset Types', type: 'tags', options: assetTypeOptions }, (r) => r.assetTypes) },
      { key: 'tier', label: 'Tier', defaultWidth: 100, render: editable({ key: 'tier', label: 'Tier', type: 'enum', options: TIERS }) },
      { key: 'geography', label: 'Geography', defaultWidth: 130, render: editable({ key: 'geography', label: 'Geography', type: 'enum', options: GEOGRAPHIES }) },
      { key: 'hqRegion', label: 'HQ Region', defaultWidth: 130, render: editable({ key: 'hqRegion', label: 'HQ Region' }) },
      { key: 'website', label: 'Website', defaultWidth: 200, render: editable({ key: 'website', label: 'Website', type: 'link' }) },
      // The row keeps '' for missing AUM (so global search doesn't hit
      // "null"); normalize to null for the cell so it renders '—'.
      { key: 'peAum', label: 'PE AUM ($B)', defaultWidth: 110, getSortValue: (r) => Number(r.peAum) || 0, render: editable({ key: 'peAum', label: 'PE AUM', type: 'number', format: 'aum' }, (r) => (typeof r.peAum === 'number' ? r.peAum : null)) },
      // Sort by active first, total as the tiebreak (active is what the
      // user scans for; 1e6 keeps totals from ever outranking an active).
      { key: 'opps', label: 'Opps', defaultWidth: 90, getSortValue: (r) => r.oppsActive * 1e6 + r.oppsTotal, exportValue: (r) => `${r.oppsActive}/${r.oppsTotal}`, render: (r) => (
        <span
          title={r._oppsTip.length ? `active / total opps from the Opps tab\n${r._oppsTip.join('\n')}` : 'No opportunities on this company in the Opps tab'}
          style={{ fontWeight: 700, color: r.oppsActive > 0 ? '#7C3AED' : r.oppsTotal > 0 ? '#64748B' : '#CBD5E1' }}
        >{r.oppsActive}/{r.oppsTotal}</span>
      ) },
      { key: 'pcOpps', label: 'PC Opps', defaultWidth: 90, getSortValue: (r) => r.pcOppsActive * 1e6 + r.pcOppsTotal, exportValue: (r) => `${r.pcOppsActive}/${r.pcOppsTotal}`, render: (r) => (
        <span
          title={r._pcOppsTip.length
            ? `active / total opps across this firm's ${r._pcCount} portfolio compan${r._pcCount === 1 ? 'y' : 'ies'}\n${r._pcOppsTip.join('\n')}`
            : r._pcCount > 0
            ? `No opps on this firm's ${r._pcCount} portfolio compan${r._pcCount === 1 ? 'y' : 'ies'} in the Opps tab`
            : 'No portfolio companies point to this firm: set a company\'s PE Owner to link it'}
          style={{ fontWeight: 700, color: r.pcOppsActive > 0 ? '#7C3AED' : r.pcOppsTotal > 0 ? '#64748B' : '#CBD5E1' }}
        >{r.pcOppsActive}/{r.pcOppsTotal}</span>
      ) },
      // PC Download: count of this firm's mapped portfolio companies (its
      // Portfolio Companies tab) with a click-to-download of that exact
      // Excel workbook — same export the Portfolio tab's PC Download
      // column and the company pop-up's "Download Current Data" ship.
      { key: 'pcDownload', label: 'PC Download', defaultWidth: 110, getSortValue: (r) => r._pcMappedCount, exportValue: (r) => String(r._pcMappedCount), render: (r) => (
        r._pcMappedCount > 0 ? (
          <span
            role="button"
            tabIndex={0}
            title={`Download ${r._pcMappedCount} mapped portfolio compan${r._pcMappedCount === 1 ? 'y' : 'ies'} as Excel`}
            onClick={(e) => { e.stopPropagation(); onDownloadPortfolio?.(r._prospect); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onDownloadPortfolio?.(r._prospect); } }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }}
          >⬇ {r._pcMappedCount}</span>
        ) : <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>-</span>
      ) },
      // Master Analysis: whether this company has one saved (from the
      // Utility Lookup page's "Save to <company>") and when it was written.
      // Sorts newest-saved first so "who's been analysed, and how recently"
      // is one click; companies with nothing saved sort to the bottom.
      {
        key: 'masterAnalysis', label: 'Master Analysis', defaultWidth: 130,
        getSortValue: (r) => r.analysisSavedAt,
        getFilterValue: (r) => (r._analysis ? 'Saved master analysis' : 'No master analysis'),
        exportValue: (r) => (r._analysis
          ? (r._analysis.savedAt ? new Date(r._analysis.savedAt).toLocaleDateString() : 'Saved')
          : ''),
        render: (r) => (r._analysis ? (
          <span
            title={[
              `${r.company} has a Master Analysis saved${r._analysis.savedAt ? ` on ${new Date(r._analysis.savedAt).toLocaleString()}` : ''}.`,
              r._analysis.fileName || '',
              r._analysis.sizeBytes ? `${(r._analysis.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '',
              'Download it from this company\'s popup, or pull it back onto the Utility Lookup page with Import Analysis.',
            ].filter(Boolean).join('\n')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 700, color: '#166534' }}
          >✓ {formatAnalysisDate(r._analysis.savedAt)}</span>
        ) : (
          <span title="No Master Analysis saved against this company yet" style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>-</span>
        )),
      },
      // Read-only companions to PC Opps: the portfolio companies that
      // carry those opps, and the contacts tied to them (both pulled from
      // the same Opps-tab scan).
      { key: 'pcOppCompanies', label: 'PC Opp Companies', defaultWidth: 220, getSortValue: (r) => r.pcOppCompanies.length, getFilterValue: (r) => r.pcOppCompanies.join(', '), exportValue: (r) => r.pcOppCompanies.join(', '), render: (r) => <NameListCell items={r.pcOppCompanies} empty="No PC opps" /> },
      { key: 'pcOppContacts', label: 'PC Opp Contacts', defaultWidth: 220, getSortValue: (r) => r.pcOppContacts.length, getFilterValue: (r) => r.pcOppContacts.join(', '), exportValue: (r) => r.pcOppContacts.join(', '), render: (r) => <NameListCell items={r.pcOppContacts} empty="No contacts on PC opps" /> },
      // Decision-Maker contacts for this PE firm (HubSpot "Decision
      // Maker"-tagged, matched by company or email domain).
      { key: 'decisionMakers', label: 'Key Contacts', defaultWidth: 220, getSortValue: (r) => r.decisionMakerNames.length, getFilterValue: (r) => r.decisionMakerNames.join(', '), exportValue: (r) => r.decisionMakerNames.join(', '), render: (r) => <NameListCell items={r.decisionMakerNames} empty="No key contacts found" /> },
      { key: 'peOwner', label: 'PE Owner', defaultWidth: 170, render: editable({ key: 'peOwner', label: 'PE Owner' }) },
      // Strategies: multi-tag investment-strategy field, editable inline
      // (same control + vocabulary as the company pop-up, with add-new).
      { key: 'strategies', label: 'Strategies', defaultWidth: 260, getSortValue: (r) => r.strategies.length, getFilterValue: (r) => r.strategies.join(', '), exportValue: (r) => r.strategies.join(', '), render: (r) => (
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <TagMultiSelect
            options={strategyOptions}
            selected={r.strategies}
            onToggle={(tag) => toggleStrategy(r._prospect, tag)}
            onAddNew={addStrategy}
            placeholder="Add strategies…"
          />
        </div>
      ) },
      { key: 'notes', label: 'Notes', defaultWidth: 320, render: editable({ key: 'notes', label: 'Notes', type: 'notes' }) },
    ];
  }, [onSelectProspect, onUpdateProspect, handleAddOption, typeOptions, cdmOptions, assetTypeOptions, selectedIds, filteredRowIds, onDownloadPortfolio, strategyOptions, toggleStrategy, addStrategy, bucketColumns, isServicesVariant]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [search, rows]);

  // Which companies the services report covers. Checking rows scopes it to
  // those (the same selection the bulk-edit bar acts on); otherwise it
  // takes whatever the search and the table's column filters have left on
  // screen. Either way it reports on what the user is looking at rather
  // than on a set they'd have to go and verify.
  const servicesReportScope = useMemo(() => {
    if (selectedIds.size > 0) {
      return {
        companies: rows.filter(r => selectedIds.has(r.id)).map(r => r._prospect),
        note: `${selectedIds.size} selected compan${selectedIds.size === 1 ? 'y' : 'ies'}`,
      };
    }
    // filteredRowIds is empty until the DataTable has reported once (and
    // when the table isn't rendered at all), so fall back to the search
    // results rather than reporting on nothing.
    const onScreen = filteredRowIds.size > 0
      ? filtered.filter(r => filteredRowIds.has(r.id))
      : filtered;
    const note = onScreen.length === rows.length
      ? ''
      : `filtered to ${onScreen.length} of ${rows.length}`;
    return { companies: onScreen.map(r => r._prospect), note };
  }, [selectedIds, filteredRowIds, filtered, rows]);

  // Apply a confirmed paste plan (from PasteAddModal in upsert mode):
  // adds go through onAddProspect (idempotent by company key), updates
  // through onUpdateProspect with only the changed fields. The table —
  // and Table View — refresh live off the prospects subscription.
  async function handlePasteImport(plan) {
    setPasteOpen(false);
    setImporting(true);
    let added = 0;
    let updated = 0;
    const failed = [];
    try {
      for (const record of (plan.toAdd || [])) {
        try {
          await onAddProspect?.(record);
          added++;
        } catch (err) {
          console.error('Blue Owl paste: add failed for', record.company, err);
          failed.push(record.company);
        }
      }
      for (const u of (plan.toUpdate || [])) {
        try {
          await onUpdateProspect?.(u.id, u.changes);
          updated++;
        } catch (err) {
          console.error('Blue Owl paste: update failed for', u.company, err);
          failed.push(u.company);
        }
      }
      const parts = [`${added} added`, `${updated} updated`];
      if (plan.unchanged?.length) parts.push(`${plan.unchanged.length} unchanged`);
      if (plan.noCompany) parts.push(`${plan.noCompany} without a company skipped`);
      if (failed.length) parts.push(`${failed.length} FAILED`);
      window.alert(`Blue Owl paste: ${parts.join(' · ')}.${failed.length ? `\n\nFailed rows: try them again:\n  ${failed.join('\n  ')}` : ''}`);
    } finally {
      setImporting(false);
    }
  }

  // Schneider-branded Excel export for the PE Overview table. DataTable
  // hands us its currently-visible columns (in order) and the sorted +
  // filtered rows; we render them into a styled .xlsx (green title band,
  // dark-green header, Nunito Sans, zebra rows) matching the other
  // Schneider exports, using each column's exportValue mapper so the file
  // reflects what's on screen.
  const exportSchneider = async ({ columns: exportCols, rows: exportRows, colNames }) => {
    const { Workbook } = await import('exceljs');
    const SE_GREEN = 'FF3DCD58';
    const SE_GREEN_DARK = 'FF009530';
    const SE_BORDER = 'FFD4DDE1';
    const SE_TEXT = 'FF1E293B';
    const ZEBRA = 'FFF1F8F4';
    const BODY_FONT = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT } };
    // The screen's colours, in the ARGB ExcelJS wants — so a service reads
    // the same green / yellow / red in the file as it does in the table.
    const argb = (hex) => `FF${String(hex).replace('#', '').toUpperCase()}`;
    const cols = (exportCols || []).filter(c => c.key !== '_select');
    const headers = cols.map(c => colNames?.[c.key] || c.label || c.key);

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet(`${firmLabel} ${isServicesVariant ? 'Services' : 'Companies'}`.slice(0, 31), {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    ws.columns = cols.map((c, i) => ({ width: i === 0 ? 34 : Math.max((headers[i] || '').length + 4, 16) }));

    ws.mergeCells(1, 1, 1, cols.length);
    const title = ws.getCell(1, 1);
    title.value = 'Schneider Electric';
    title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 30;

    ws.mergeCells(2, 1, 2, cols.length);
    const sub = ws.getCell(2, 1);
    sub.value = `${tabLabel} · ${firmLabel} · ${exportRows.length} compan${exportRows.length === 1 ? 'y' : 'ies'}`;
    sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 20;

    const headerRow = ws.getRow(3);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: SE_BORDER } },
        bottom: { style: 'thin', color: { argb: SE_BORDER } },
        left: { style: 'thin', color: { argb: SE_BORDER } },
        right: { style: 'thin', color: { argb: SE_BORDER } },
      };
    });
    headerRow.height = 26;

    exportRows.forEach((row, ri) => {
      const r = ws.getRow(4 + ri);
      cols.forEach((c, ci) => {
        const cell = r.getCell(ci + 1);
        // Columns whose cells colour-code their contents (the service
        // outcome ones) hand over runs instead of a string, so each service
        // keeps its own colour rather than the whole cell taking one.
        const runs = typeof c.exportRuns === 'function' ? c.exportRuns(row) : null;
        if (runs && runs.length > 0) {
          cell.value = {
            richText: runs.map((run, i) => ({
              font: { ...BODY_FONT, bold: true, color: { argb: argb(run.color) } },
              text: `${i > 0 ? ', ' : ''}${run.text}`,
            })),
          };
        } else {
          let val = typeof c.exportValue === 'function' ? c.exportValue(row) : row[c.key];
          if (Array.isArray(val)) val = val.join(', ');
          cell.value = val === '' || val == null ? null : val;
        }
        cell.font = BODY_FONT;
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: SE_BORDER } },
          left: { style: 'thin', color: { argb: SE_BORDER } },
          right: { style: 'thin', color: { argb: SE_BORDER } },
        };
      });
    });

    if (cols.length > 0) {
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
    }

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const safe = (selectedFirm.trim() || 'pe_firm').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}_pe_overview_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
          PE firm
          <select
            value={selectedFirm}
            onChange={e => onSelectFirm?.(e.target.value)}
            title="Choose which PE firm's companies to show"
            style={{ padding: '0.4rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', color: '#1E293B', maxWidth: 240, cursor: 'pointer' }}
          >
            {firmOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${rows.length} ${firmLabel} compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        {search.trim() && <span style={{ fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>{filtered.length} of {rows.length}</span>}
        <button
          type="button"
          onClick={() => setServicesReportOpen(true)}
          disabled={rows.length === 0}
          title={rows.length === 0
            ? `No ${firmLabel} companies to report on`
            : `Pick services and see where each of these ${servicesReportScope.companies.length} compan${servicesReportScope.companies.length === 1 ? 'y' : 'ies'} stands on them`}
          style={{ padding: '0.4rem 0.75rem', border: '1px solid #E2E8F0', borderRadius: 6, background: rows.length === 0 ? '#F1F5F9' : '#fff', fontSize: '0.72rem', fontWeight: 600, color: rows.length === 0 ? '#94A3B8' : '#334155', cursor: rows.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >Services Report</button>
        {(onAddProspect || onUpdateProspect) && (
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            disabled={importing}
            title={`Copy rows from Excel (with the header row) and paste them in: fills blank fields on companies already in Table View and adds the rest as ${firmLabel} companies`}
            style={{ padding: '0.4rem 0.75rem', border: '1px solid #E2E8F0', borderRadius: 6, background: importing ? '#F1F5F9' : '#fff', fontSize: '0.72rem', fontWeight: 600, color: importing ? '#94A3B8' : '#334155', cursor: importing ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >{importing ? 'Importing…' : 'Paste from Excel'}</button>
        )}
      </div>
      {onUpdateProspect && selectedIds.size > 0 && (
        <BlueOwlBulkEditBar
          selectedCount={selectedIds.size}
          applying={bulkApplying}
          onApply={applyBulkEdit}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      {pasteOpen && (
        <PasteAddModal
          existingProspects={prospects}
          mode="upsert"
          defaults={{ peOwner: selectedFirm }}
          onImport={handlePasteImport}
          onClose={() => setPasteOpen(false)}
        />
      )}
      {oppsModalRow && (
        <CompanyOppsModal
          company={oppsModalRow.company}
          opps={oppsModalRow._oppRecords}
          onClose={() => setOppsModalRow(null)}
          onOpenCompany={() => { const p = oppsModalRow._prospect; setOppsModalRow(null); onSelectProspect?.(p); }}
        />
      )}
      {servicesReportOpen && (
        <PEServicesReportModal
          companies={servicesReportScope.companies}
          firmLabel={firmLabel}
          scopeNote={servicesReportScope.note}
          oppsRecords={oppsRecords}
          settings={settings}
          updateSettings={updateSettings}
          onSelectProspect={onSelectProspect}
          onClose={() => setServicesReportOpen(false)}
        />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No {firmLabel} companies found</div>
            <div style={{ fontSize: '0.78rem' }}>
              Open a company's popup and set its <strong>PE Owner</strong> to <code>{selectedFirm.trim() || 'the firm'}</code>: it'll show up here. Or pick a different firm from the dropdown above.
            </div>
          </div>
        ) : (
          <DataTable
            // Each tab keeps its own saved column layout. PE Overview
            // stays on its existing key — the numeric suffix is bumped
            // whenever columns are added, so a saved visible-set from an
            // older layout can't hide them (HQ Region / Website / PE AUM
            // at -2, Opps at -3, PC Opps at -4, the bulk-edit checkbox at
            // -5, the PC Opp Companies / Contacts + Decision Makers
            // columns at -6, the PC Download + Strategies columns at -7,
            // the Asset Types column at -9, the per-Local-Project-Name
            // Services Sold columns at -10, which then moved to the
            // Services tab). The Services tab starts on its own key so
            // widening it out to the bucket columns never disturbs the
            // layout the user keeps on PE Overview; it went to -2 when
            // the Services Sold breakdown switched from Local Project
            // Name to Service Bucket, since every one of those columns
            // changed key and a saved order would otherwise strand the
            // new ones at the far right.
            tableId={isServicesVariant ? 'pe-overview-services-2' : 'pe-blue-owl-companies-10'}
            columns={columns}
            rows={filtered}
            alwaysVisible={['company', '_select']}
            removableColumns
            onFilteredRowsChange={handleFilteredRowsChange}
            defaultSort={{ key: 'company', direction: 'asc' }}
            enableColumnFilters
            emptyMessage={`No ${firmLabel} companies match your filters`}
            exportFileName={`${(selectedFirm.trim() || 'pe_firm').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_companies${isServicesVariant ? '_services' : ''}`}
            exportPrimarySheetName={`${firmLabel} ${isServicesVariant ? 'Services' : 'Companies'}`.slice(0, 31)}
            onExport={exportSchneider}
          />
        )}
      </div>
    </>
  );
}

// PE firms laid out as a Kanban board by engagement stage (peStage):
// one column per stage — Discovery, Piloting, Existing Partnership, Not Sold,
// plus an Unassigned column for firms with no stage set — so the user can
// scan which PE relationships sit at each phase. Cards link back to the
// firm's company popup; stage is set per firm in that popup's "PE Stage"
// dropdown. The whole board (respecting the search filter) exports to
// Excel via the toolbar button.
function PEStagesTab({ firms, portfolioByPe, onSelectProspect }) {
  const [query, setQuery] = useState('');
  const STAGE_META = PE_STAGE_META;
  const stageOf = (pe) => peStageOf(pe.peStage);
  const pcCountOf = (pe) => (portfolioByPe.get((pe.company || '').trim().toLowerCase()) || []).length;
  const q = query.trim().toLowerCase();
  const filtered = q ? firms.filter(p => (p.company || '').toLowerCase().includes(q)) : firms;
  const groups = new Map(STAGE_META.map(m => [m.stage, []]));
  for (const pe of filtered) groups.get(stageOf(pe)).push(pe);

  // SE-formatted XLSX export that mirrors the on-screen Kanban board:
  // one spreadsheet column per stage, each holding stacked "firm cards"
  // (name + AUM · geography + portfolio-company count) in the stage's
  // accent palette, with a slim spacer column between stages for the gap.
  const exportToExcel = async () => {
    const { Workbook } = await import('exceljs');
    // STAGE_META carries CSS hex (#RRGGBB); ExcelJS wants ARGB ('FF'+RGB).
    const argb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();
    const cardBorder = (m) => ({
      left: { style: 'thick', color: { argb: argb(m.accent) } },
      top: { style: 'thin', color: { argb: argb(m.border) } },
      bottom: { style: 'thin', color: { argb: argb(m.border) } },
      right: { style: 'thin', color: { argb: argb(m.border) } },
    });
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN = 'FF3DCD58';

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('PE Stages', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });

    // Lay out one column per stage with a spacer column in between.
    const stageCol = {};
    const colSpecs = [];
    STAGE_META.forEach((m, i) => {
      stageCol[m.stage] = colSpecs.length + 1;
      colSpecs.push({ width: 34 });
      if (i < STAGE_META.length - 1) colSpecs.push({ width: 3 });
    });
    ws.columns = colSpecs;
    const lastCol = colSpecs.length;

    // Title band across the whole board (Schneider green, white text).
    ws.mergeCells(1, 1, 1, lastCol);
    const title = ws.getCell(1, 1);
    title.value = `PE Stages · ${filtered.length} PE firm${filtered.length === 1 ? '' : 's'}`;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 6; // spacer

    // Stage header row (3) — each column in its own accent color, with a
    // count badge baked into the label, matching the on-screen headers.
    const headerRow = ws.getRow(3);
    STAGE_META.forEach((m) => {
      const list = groups.get(m.stage) || [];
      const cell = headerRow.getCell(stageCol[m.stage]);
      cell.value = `${m.stage}  (${list.length})`;
      cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.accent) } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    });
    headerRow.height = 24;

    // Card rows — one row per firm slot; the tallest column sets how many
    // rows we draw, and shorter columns just leave their cells blank
    // (so the board has uneven column heights, like the page).
    const maxLen = Math.max(0, ...STAGE_META.map((m) => (groups.get(m.stage) || []).length));
    for (let i = 0; i < Math.max(maxLen, 1); i++) {
      const row = ws.getRow(4 + i);
      row.height = 46;
      STAGE_META.forEach((m) => {
        const list = groups.get(m.stage) || [];
        const cell = row.getCell(stageCol[m.stage]);
        const pe = list[i];
        if (!pe) {
          // First empty slot of an empty column gets a placeholder card,
          // mirroring the "No PE firms at this stage." note on the page.
          if (i === 0 && list.length === 0) {
            cell.value = 'No PE firms at this stage.';
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.bg) } };
            cell.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: 'FF94A3B8' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = cardBorder(m);
          }
          return;
        }
        const pcCount = pcCountOf(pe);
        cell.value = {
          richText: [
            { text: pe.company || '-', font: { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FF1E293B' } } },
            { text: `\n${formatAum(pe.peAum)}   ·   ${pe.geography || '-'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF475569' } } },
            { text: `\n${pcCount} portfolio co${pcCount === 1 ? '' : 's'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF64748B' } } },
          ],
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.bg) } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        cell.border = cardBorder(m);
      });
    }

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pe-stages-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${firms.length} PE firm${firms.length === 1 ? '' : 's'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={exportToExcel}
          disabled={filtered.length === 0}
          title={filtered.length === 0 ? 'No PE firms to export' : 'Export the board to Excel (.xlsx)'}
          style={{ padding: '0.4rem 0.75rem', border: '1px solid #E2E8F0', borderRadius: 6, background: filtered.length === 0 ? '#F1F5F9' : '#fff', fontSize: '0.72rem', fontWeight: 600, color: filtered.length === 0 ? '#94A3B8' : '#334155', cursor: filtered.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >Export to Excel</button>
      </div>
      {firms.length === 0 ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No PE firms found</div>
            <div style={{ fontSize: '0.78rem' }}>Set a prospect's <strong>Type</strong> to <code>Private Equity</code> to list it here.</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '0.75rem', overflowX: 'auto', overflowY: 'hidden', padding: '0 1.25rem 1.25rem' }}>
          {STAGE_META.map(({ stage, accent, bg, border }) => {
            const list = groups.get(stage) || [];
            return (
              <div key={stage} style={{ flex: '0 0 290px', display: 'flex', flexDirection: 'column', minHeight: 0, border: `1px solid ${border}`, borderRadius: 8, background: '#F8FAFC', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.75rem', background: bg, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage}</span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: accent, color: '#fff' }}>{list.length}</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {list.length === 0 ? (
                    <div style={{ padding: '0.6rem 0.5rem', fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic', textAlign: 'center' }}>
                      {q ? 'No matches here.' : 'No PE firms at this stage.'}
                    </div>
                  ) : list.map((pe) => {
                    const pcCount = pcCountOf(pe);
                    return (
                      <button
                        key={pe.id}
                        type="button"
                        onClick={() => onSelectProspect?.(pe)}
                        title={`Open ${pe.company || 'this firm'}`}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #E2E8F0', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '0.55rem 0.6rem', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pe.company || '-'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginTop: '0.35rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: pe.peAum ? '#1E293B' : '#CBD5E1' }} title={pe.peAum ? `PE AUM: $${pe.peAum}B` : 'No PE AUM set'}>{formatAum(pe.peAum)}</span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: pe.geography ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pe.geography || 'No geography set'}>{pe.geography || '-'}</span>
                        </div>
                        <div style={{ marginTop: '0.3rem', fontSize: '0.66rem', fontWeight: 600, color: pcCount ? '#64748B' : '#CBD5E1' }} title="Portfolio companies linked to this firm">
                          {pcCount} portfolio co{pcCount === 1 ? '' : 's'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// PE firms laid out by PE Stage — the same Kanban shape as the PE Stages
// board, but each card carries a "days in stage" badge and the columns
// sort longest-waiting firm first. Mirrors the Opps page's Days-in-Stage
// board (day counts, longest-stalling on top) at the firm level. The day
// count reads `peStageEnteredAt` (stamped whenever a firm's PE Stage
// changes); firms with no stamp yet show "—".
function PEStageDaysTab({ firms, portfolioByPe, onSelectProspect }) {
  const [query, setQuery] = useState('');
  const [hideUnassigned, setHideUnassigned] = useState(false);
  const STAGE_META = PE_STAGE_META;
  const stageOf = (pe) => peStageOf(pe.peStage);
  const pcCountOf = (pe) => (portfolioByPe.get((pe.company || '').trim().toLowerCase()) || []).length;
  // Days the firm has sat in its current PE Stage. null when there's no
  // entry date recorded (Unassigned firms, or ones not yet stamped).
  const daysOf = (pe) => {
    const iso = toISODate(pe.peStageEnteredAt);
    if (!iso) return null;
    return Math.max(0, -daysFromToday(iso));
  };
  const q = query.trim().toLowerCase();
  const filtered = q ? firms.filter(p => (p.company || '').toLowerCase().includes(q)) : firms;
  const groups = new Map(STAGE_META.map(m => [m.stage, []]));
  for (const pe of filtered) groups.get(stageOf(pe)).push(pe);
  // Longest-waiting firm first in each column; firms with no day count
  // settle at the bottom, tie-broken by name so the order is stable.
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const da = daysOf(a); const dbv = daysOf(b);
      if (da == null && dbv == null) return (a.company || '').localeCompare(b.company || '');
      if (da == null) return 1;
      if (dbv == null) return -1;
      return dbv - da || (a.company || '').localeCompare(b.company || '');
    });
  }
  const columns = STAGE_META.filter(m => !(hideUnassigned && m.stage === 'Unassigned'));
  const unassignedCount = (groups.get('Unassigned') || []).length;
  // Day-badge color ramp — the longer a firm has sat in a stage the more
  // it stands out. Neutral for fresh entries, amber past ~3 months, red
  // past ~6 so a stalled relationship is obvious at a glance.
  const dayColor = (days) => (days == null ? '#CBD5E1' : days >= 180 ? '#DC2626' : days >= 90 ? '#B45309' : '#475569');

  return (
    <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${firms.length} PE firm${firms.length === 1 ? '' : 's'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#64748B', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={hideUnassigned} onChange={e => setHideUnassigned(e.target.checked)} />
          Hide Unassigned ({unassignedCount})
        </label>
      </div>
      {firms.length === 0 ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No PE firms found</div>
            <div style={{ fontSize: '0.78rem' }}>Set a prospect's <strong>Type</strong> to <code>Private Equity</code> to list it here.</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '0.75rem', overflowX: 'auto', overflowY: 'hidden', padding: '0 1.25rem 1.25rem' }}>
          {columns.map(({ stage, accent, bg, border }) => {
            const list = groups.get(stage) || [];
            return (
              <div key={stage} style={{ flex: '0 0 290px', display: 'flex', flexDirection: 'column', minHeight: 0, border: `1px solid ${border}`, borderRadius: 8, background: '#F8FAFC', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.75rem', background: bg, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage}</span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: accent, color: '#fff' }}>{list.length}</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {list.length === 0 ? (
                    <div style={{ padding: '0.6rem 0.5rem', fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic', textAlign: 'center' }}>
                      {q ? 'No matches here.' : 'No PE firms at this stage.'}
                    </div>
                  ) : list.map((pe) => {
                    const pcCount = pcCountOf(pe);
                    const days = daysOf(pe);
                    const enteredISO = toISODate(pe.peStageEnteredAt);
                    const badgeTitle = stage === 'Unassigned'
                      ? 'No PE Stage set: set one in this firm\'s company popup to start the clock.'
                      : enteredISO
                        ? `In ${stage} since ${formatDateDisplay(enteredISO)} · ${days} day${days === 1 ? '' : 's'}`
                        : 'No entry date recorded yet.';
                    return (
                      <button
                        key={pe.id}
                        type="button"
                        onClick={() => onSelectProspect?.(pe)}
                        title={`Open ${pe.company || 'this firm'}`}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #E2E8F0', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '0.55rem 0.6rem', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{pe.company || '-'}</span>
                          <span
                            title={badgeTitle}
                            style={{ fontSize: '0.72rem', fontWeight: 700, color: dayColor(days), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            {days == null ? '-' : `${days}d`}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginTop: '0.35rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: pe.peAum ? '#1E293B' : '#CBD5E1' }} title={pe.peAum ? `PE AUM: $${pe.peAum}B` : 'No PE AUM set'}>{formatAum(pe.peAum)}</span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: pe.geography ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pe.geography || 'No geography set'}>{pe.geography || '-'}</span>
                        </div>
                        <div style={{ marginTop: '0.3rem', fontSize: '0.66rem', fontWeight: 600, color: pcCount ? '#64748B' : '#CBD5E1' }} title="Portfolio companies linked to this firm">
                          {pcCount} portfolio co{pcCount === 1 ? '' : 's'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// Inline-editable table cell (used for the Sales Partner column).
// Commits on blur / Enter; Escape reverts. Click and key events are
// stopped from bubbling so editing doesn't trigger the row's
// navigate-to-prospect handler. The input is uncontrolled and keyed on
// the stored value: the DOM owns the text while focused (no per-key
// React state), and an external change (e.g. a re-sort after commit)
// remounts it with the new value — no sync effect needed.
function EditableCell({ value, align, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ padding: '0.25rem 0.35rem', borderRight: '1px solid #F1F5F9', display: 'flex' }}
    >
      <input
        key={initial}
        type="text"
        defaultValue={initial}
        placeholder="-"
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
        }}
        style={{
          width: '100%', padding: '0.25rem 0.35rem', border: '1px solid transparent',
          borderRadius: 4, fontSize: '0.74rem', fontFamily: 'inherit', color: '#334155',
          background: 'transparent', textAlign: align || 'left',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid #E2E8F0'; }}
        onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = '1px solid transparent'; }}
      />
    </div>
  );
}

// Flat table of PE-channel opportunities pulled straight from the
// Opps 2 store — anything with Type = "Private Equity" or Source =
// "PE partner". Rows link back to the matching prospect when one
// exists so the user can jump into the company popup.
function PEOppsTab({ opps, totalOpps, query, setQuery, firm = '', setFirm, firmOptions = [], oppsLoaded, prospects, onSelectProspect, onEditField, user }) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const firmLabel = firm.trim();
  const ALL_COLUMNS = [
    { key: 'Account', label: 'Account', width: '1.6fr' },
    { key: 'Contact', label: 'Contacts', width: '1.4fr' },
    { key: 'Stage', label: 'Stage', width: '1fr' },
    { key: 'Type', label: 'Type', width: '1fr' },
    { key: 'Source', label: 'Source', width: '1fr' },
    { key: 'Sales Partner', label: 'Sales Partner', width: '1.2fr', editable: true },
    { key: 'Scope', label: 'Scope', width: '0.9fr' },
    { key: 'Quoted Amount', label: 'Quoted Amount', width: '1fr', align: 'right' },
    { key: 'Status', label: 'Status', width: '1.4fr' },
    { key: 'BFO Link', label: 'BFO Opportunity Name', width: '1.6fr' },
    { key: 'Next Steps', label: 'Next Steps', width: '1.8fr' },
    { key: 'Last Client Heard From Us', label: 'Last Client Heard From Us', width: '1.3fr', value: r => formatDateDisplay(r['Last Client Heard From Us']) },
    { key: 'Call In', label: 'Call In', width: '0.8fr', align: 'right', value: r => { const n = resolveCallIn(r); return n == null ? '' : String(n); } },
    { key: 'Close Date', label: 'Close Date', width: '1fr', value: r => formatDateDisplay(r['Close Date']) },
  ];
  const ALL_KEYS = ALL_COLUMNS.map(c => c.key);
  const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

  // Column chooser — drives both the on-screen table and the export.
  // Account always stays on (it's the row anchor). Persisted so the
  // chosen layout survives reloads.
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-opps:visible-cols'));
      if (Array.isArray(saved)) return new Set([...saved, 'Account']);
    } catch { /* fall through to default */ }
    return new Set(ALL_KEYS);
  });
  useEffect(() => {
    try { localStorage.setItem('pe-opps:visible-cols', JSON.stringify([...visibleCols])); } catch { /* ignore */ }
  }, [visibleCols]);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  useEffect(() => {
    if (!colMenuOpen) return;
    function handleClick(e) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colMenuOpen]);
  function toggleCol(key) {
    if (key === 'Account') return;
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const COLUMNS = ALL_COLUMNS.filter(c => visibleCols.has(c.key));
  const GRID = COLUMNS.map(c => c.width).join(' ');

  // Default ordering: Sales Partner first, then Stage. Blanks sort last so
  // populated rows group at the top; Account breaks any remaining ties.
  // Drives both the on-screen rows and the Excel export so they match.
  const sortedOpps = useMemo(() => {
    const val = (r, k) => String(r[k] ?? '').trim().toLowerCase();
    const cmp = (a, b, k) => {
      const va = val(a, k), vb = val(b, k);
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return va.localeCompare(vb);
    };
    return [...opps].sort((a, b) =>
      cmp(a, b, 'Sales Partner')
      || cmp(a, b, 'Stage')
      || String(a['Account'] || '').localeCompare(String(b['Account'] || '')));
  }, [opps]);

  // SE-formatted (Schneider-branded) XLSX export of the rows shown,
  // limited to the visible columns. Mirrors the green palette / layout
  // of the Key Contacts export so SE collateral stays consistent.
  const handleExport = async () => {
    if (opps.length === 0) return;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_GREEN = 'FF3DCD58';
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('PE Opps', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });
    ws.columns = COLUMNS.map(c => ({ width: Math.min(Math.max(c.label.length + 4, 16), 40) }));

    // Title row — Schneider green band, white text.
    ws.mergeCells(1, 1, 1, COLUMNS.length);
    const title = ws.getCell(1, 1);
    title.value = `${firmLabel ? `${firmLabel} · ` : ''}PE Opportunities · ${opps.length} opp${opps.length === 1 ? '' : 's'}`;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 6; // spacer

    // Header row 3 — light-green wash, dark-green bold text.
    const headerRow = ws.getRow(3);
    COLUMNS.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    });
    headerRow.height = 22;

    // Data rows with subtle alternating green banding.
    sortedOpps.forEach((r, idx) => {
      const row = ws.getRow(4 + idx);
      COLUMNS.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = cellValue(r, col);
        cell.font = { name: 'Nunito Sans', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: col.align === 'right' ? 'right' : 'left', indent: 1, wrapText: false };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FCF8' } };
      });
      row.height = 18;
    });

    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } };

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    const slug = firmLabel ? `${firmLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-` : '';
    a.download = `${slug}pe-opps-${date}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const findProspect = (account) => {
    const name = (account || '').toLowerCase();
    if (!name) return null;
    return prospects.find(p => companiesMatch((p.company || '').toLowerCase(), name)) || null;
  };

  return (
    <>
      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {setFirm && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
            Firm
            <select
              value={firm}
              onChange={e => setFirm(e.target.value)}
              title="Scope the list to one PE firm: every opp on that firm or its portfolio companies. Choose “All PE Opps” for the full PE channel."
              style={{ padding: '0.4rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', color: '#1E293B', maxWidth: 220, cursor: 'pointer' }}
            >
              <option value="">All PE Opps</option>
              {firmOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={firmLabel ? `Search ${totalOpps} ${firmLabel} opp${totalOpps === 1 ? '' : 's'}…` : `Search ${totalOpps} PE opp${totalOpps === 1 ? '' : 's'}…`}
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <div ref={colMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColMenuOpen(o => !o)}
            style={{ padding: '0.4rem 0.7rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.72rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >Columns ({visibleCols.size}/{ALL_KEYS.length})</button>
          {colMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 220, padding: '0.3rem 0' }}>
              {ALL_COLUMNS.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: c.key === 'Account' ? '#94A3B8' : '#334155', cursor: c.key === 'Account' ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={visibleCols.has(c.key)}
                    disabled={c.key === 'Account'}
                    onChange={() => toggleCol(c.key)}
                  />
                  <span style={{ flex: 1 }}>{c.label}</span>
                </label>
              ))}
              <div style={{ borderTop: '1px solid #F1F5F9', marginTop: '0.3rem', padding: '0.3rem 0.6rem', display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => setVisibleCols(new Set(ALL_KEYS))}
                  style={{ flex: 1, padding: '0.25rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 4, background: '#fff', fontSize: '0.68rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
                >Show all</button>
                <button
                  type="button"
                  onClick={() => setVisibleCols(new Set(['Account']))}
                  style={{ flex: 1, padding: '0.25rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 4, background: '#fff', fontSize: '0.68rem', fontWeight: 600, color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}
                >Hide all</button>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={opps.length === 0}
          title={opps.length ? 'Download the visible columns of the PE opps shown below as an SE-formatted Excel file' : 'No PE opps to export'}
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', borderRadius: 6, background: opps.length ? '#009530' : '#E2E8F0', color: opps.length ? '#fff' : '#94A3B8', fontSize: '0.72rem', fontWeight: 700, cursor: opps.length ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >Export to Excel</button>
        <button
          type="button"
          onClick={() => setScheduleOpen(true)}
          title="Schedule a recurring email that sends this PE Opps Excel file to a list of recipients"
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', borderRadius: 6, background: '#fff', color: '#009530', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >Schedule email</button>
      </div>

      <PEOppsScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        uid={user?.uid}
        email={user?.email}
        firm={firmLabel}
        oppsRows={sortedOpps}
        allColumns={ALL_COLUMNS.map(c => ({ key: c.key, label: c.label }))}
        defaultColumns={[...visibleCols]}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {!oppsLoaded && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            No Opps data loaded. Open the <strong>Opps</strong> tab once to sync it; PE opps will populate here afterwards.
          </div>
        )}
        {opps.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {totalOpps === 0 ? (firmLabel ? `No ${firmLabel} opps found` : 'No PE opps found') : `No opps match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {totalOpps === 0
                ? (firmLabel
                    ? <>No Opps rows have an Account matching <strong>{firmLabel}</strong> or a company whose PE Owner is <strong>{firmLabel}</strong>.</>
                    : <>No Opps rows have Type = <code>Private Equity</code> or Source = <code>PE partner</code>.</>)
                : `${totalOpps} total ${firmLabel || 'PE'} opps loaded: adjust your search.`}
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', position: 'sticky', top: 0, zIndex: 1 }}>
              {COLUMNS.map(c => (
                <div
                  key={c.key}
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#475569', textAlign: c.align || 'left', borderRight: '1px solid #E2E8F0' }}
                >{c.label}</div>
              ))}
            </div>
            {sortedOpps.map((r, idx) => {
              const parent = findProspect(r['Account']);
              // Tint lost deals light red so they read at a glance. The
              // base color also drives the hover handlers so the tint
              // survives mouse-over instead of flashing back to white.
              const isNotSold = String(r['Stage'] || '').trim().toLowerCase() === 'not sold';
              const baseBg = isNotSold ? '#FEE2E2' : '#fff';
              const hoverBg = isNotSold ? '#FECACA' : '#F8FAFC';
              return (
                <div
                  key={r._id || r.id || idx}
                  onClick={() => parent && onSelectProspect?.(parent)}
                  style={{ display: 'grid', gridTemplateColumns: GRID, borderTop: idx === 0 ? 'none' : '1px solid #E2E8F0', cursor: parent ? 'pointer' : 'default', background: baseBg }}
                  onMouseEnter={e => { if (parent) e.currentTarget.style.background = hoverBg; }}
                  onMouseLeave={e => { e.currentTarget.style.background = baseBg; }}
                >
                  {COLUMNS.map(c => {
                    const val = cellValue(r, c) || '';
                    const isAccount = c.key === 'Account';
                    if (c.editable && onEditField) {
                      return (
                        <EditableCell
                          key={c.key}
                          value={r[c.key] ?? ''}
                          align={c.align}
                          onCommit={(v) => onEditField(r._id, c.key, v)}
                        />
                      );
                    }
                    return (
                      <div
                        key={c.key}
                        title={String(val)}
                        style={{ padding: '0.5rem 0.6rem', fontSize: '0.74rem', fontWeight: isAccount ? 700 : 500, color: isAccount ? '#1E293B' : '#334155', textAlign: c.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRight: '1px solid #F1F5F9' }}
                      >{val || '-'}</div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// "Strategies" sub-tab — hosts two nested, independently-ranked reference
// lists (Investment Strategies and Categories), each a table of strategies
// with descriptions and a 0–10 value slider. A small tab bar switches between
// them; each keeps its own ratings under a separate settings key.
function PEStrategiesTab({ settings, updateSettings }) {
  // Two nested lists under Strategies, each ranked independently: the detailed
  // Investment Strategies list and the higher-level Categories list. Each keeps
  // its own ratings under a separate settings key.
  const [stratTab, setStratTab] = useState('investment');
  const TABS = [
    { key: 'investment', label: 'Investment Strategies', strategies: PE_STRATEGIES, settingsKey: 'peStrategyRatings' },
    { key: 'categories', label: 'Categories', strategies: PE_STRATEGY_CATEGORIES, settingsKey: 'peStrategyCategoryRatings' },
  ];
  const active = TABS.find(t => t.key === stratTab) || TABS[0];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '0.35rem', padding: '0 1.25rem', marginBottom: '0.5rem' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStratTab(t.key)}
            style={{
              padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              border: stratTab === t.key ? '1px solid #7C3AED' : '1px solid #E2E8F0',
              background: stratTab === t.key ? '#F3EEFF' : '#FFFFFF',
              color: stratTab === t.key ? '#6D28D9' : '#64748B',
            }}
          >{t.label}</button>
        ))}
      </div>
      {/* Remount per tab so each list hydrates its own ratings cleanly. */}
      <StrategyRatingTable
        key={active.key}
        strategies={active.strategies}
        settingsKey={active.settingsKey}
        settings={settings}
        updateSettings={updateSettings}
      />
    </div>
  );
}

// Ranked 0–10 value-slider table for a list of strategies. Ratings persist per
// user under settings[settingsKey] (keyed by strategy id). Rows sort
// highest-rated first, but the order is frozen while a slider is being dragged
// so rows don't jump out from under the cursor.
function StrategyRatingTable({ strategies, settingsKey, settings, updateSettings }) {
  const RATING_MAX = 10;

  // Live, editable copy of the ratings for smooth dragging.
  const [ratings, setRatings] = useState(() => settings?.[settingsKey] || {});
  // Snapshot the row ORDER is derived from. Updated on drag-release (and on
  // keyboard edits) rather than every slider tick, so rows don't reshuffle
  // out from under the cursor while a slider is being dragged.
  const [sortRatings, setSortRatings] = useState(() => settings?.[settingsKey] || {});

  const draggingRef = useRef(false);
  const saveTimer = useRef(null);
  // The last value we wrote (or hydrated), so the sync effect below can
  // tell "the server echoed our own save" from "another device changed it".
  const lastSyncedRef = useRef(JSON.stringify(settings?.[settingsKey] || {}));

  // Hydrate when settings first load, or when another device/tab changes the
  // ratings. Guarded by a JSON compare (and skipped mid-drag) so our own
  // optimistic saves don't stomp a slider the user is still holding.
  useEffect(() => {
    if (draggingRef.current) return;
    const incoming = JSON.stringify(settings?.[settingsKey] || {});
    if (incoming !== lastSyncedRef.current) {
      lastSyncedRef.current = incoming;
      const val = settings?.[settingsKey] || {};
      setRatings(val);
      setSortRatings(val);
    }
  }, [settings, settingsKey]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persist = useCallback((next) => {
    lastSyncedRef.current = JSON.stringify(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { updateSettings({ [settingsKey]: next }); }, 400);
  }, [updateSettings, settingsKey]);

  const setRating = useCallback((id, value) => {
    setRatings(prev => {
      const next = { ...prev, [id]: value };
      persist(next);
      // Keyboard (arrow-key) edits fire no drag events — reorder immediately.
      // During a pointer drag we defer reordering to drag-release below.
      if (!draggingRef.current) setSortRatings(next);
      return next;
    });
  }, [persist]);

  // Read `ratings` directly (not via a ref) — event handlers always close
  // over the latest committed render, so this sees the final dragged value.
  const startDrag = () => { draggingRef.current = true; };
  const endDrag = () => {
    draggingRef.current = false;
    setSortRatings(ratings);
  };

  const ratingOf = (id) => (Number.isFinite(ratings[id]) ? ratings[id] : 0);

  // Display order: highest rating first, ties broken by canonical list order.
  // Driven by the frozen `sortRatings` snapshot, not the live values.
  const orderedIds = useMemo(() => {
    const idx = Object.fromEntries(strategies.map((s, i) => [s.id, i]));
    const rank = (id) => (Number.isFinite(sortRatings[id]) ? sortRatings[id] : 0);
    return strategies.map(s => s.id).sort((a, b) => {
      const d = rank(b) - rank(a);
      return d !== 0 ? d : idx[a] - idx[b];
    });
  }, [sortRatings, strategies]);

  const byId = Object.fromEntries(strategies.map(s => [s.id, s]));
  const rated = strategies.filter(s => Number.isFinite(ratings[s.id])).length;
  const GRID_COLS = '48px minmax(160px, 1fr) minmax(240px, 2.2fr) 220px';

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.6rem' }}>
        {rated} of {strategies.length} strategies rated
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: GRID_COLS,
          alignItems: 'center',
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          fontSize: '0.68rem',
          fontWeight: 700,
          color: '#475569',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>#</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Strategy</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Description</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Value rating</div>
        </div>
        {orderedIds.map((id, i) => {
          const s = byId[id];
          const value = ratingOf(id);
          const pct = (value / RATING_MAX) * 100;
          return (
            <div
              key={id}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                alignItems: 'center',
                borderBottom: i === orderedIds.length - 1 ? 'none' : '1px solid #F1F5F9',
                background: i % 2 ? '#FFFFFF' : '#FCFCFD',
              }}
            >
              <div style={{ padding: '0.6rem', textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#94A3B8' }}>{i + 1}</div>
              <div style={{ padding: '0.6rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>{s.name}</div>
              <div style={{ padding: '0.6rem', fontSize: '0.72rem', color: '#475569', lineHeight: 1.45 }}>{s.description}</div>
              <div style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <input
                  type="range"
                  min={0}
                  max={RATING_MAX}
                  step={1}
                  value={value}
                  onChange={(e) => setRating(id, Number(e.target.value))}
                  onMouseDown={startDrag}
                  onMouseUp={endDrag}
                  onTouchStart={startDrag}
                  onTouchEnd={endDrag}
                  onBlur={endDrag}
                  aria-label={`Value rating for ${s.name}`}
                  style={{
                    flex: 1,
                    accentColor: '#7C3AED',
                    background: `linear-gradient(to right, #7C3AED 0%, #7C3AED ${pct}%, #E2E8F0 ${pct}%, #E2E8F0 100%)`,
                    height: 4,
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                />
                <span style={{
                  minWidth: 34,
                  textAlign: 'center',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: value > 0 ? '#7C3AED' : '#94A3B8',
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: value > 0 ? '#F3EEFF' : '#F1F5F9',
                }}>{value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "Case Study" sub-tab — a table of the industries our experience spans.
// Each industry row has editable Company / Summary / Results cells, saved per
// user in settings.peCaseStudies (keyed by industry id). Edits are held in
// local state for responsive typing and flushed to settings on a short
// debounce, mirroring the Strategies tab's persistence.
function PECaseStudyTab({ settings, updateSettings }) {
  const [data, setData] = useState(() => settings?.peCaseStudies || {});
  const saveTimer = useRef(null);
  const lastSyncedRef = useRef(JSON.stringify(settings?.peCaseStudies || {}));
  // True while a cell is focused, so a settings echo doesn't stomp the text
  // the user is actively typing.
  const editingRef = useRef(false);

  // Hydrate on first load, or when another device/tab changes the data.
  useEffect(() => {
    if (editingRef.current) return;
    const incoming = JSON.stringify(settings?.peCaseStudies || {});
    if (incoming !== lastSyncedRef.current) {
      lastSyncedRef.current = incoming;
      setData(settings?.peCaseStudies || {});
    }
  }, [settings]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persist = useCallback((next) => {
    lastSyncedRef.current = JSON.stringify(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { updateSettings({ peCaseStudies: next }); }, 400);
  }, [updateSettings]);

  const setField = useCallback((id, field, value) => {
    setData(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), [field]: value } };
      persist(next);
      return next;
    });
  }, [persist]);

  const filled = CASE_STUDY_INDUSTRIES.filter(ind => {
    const d = data[ind.id];
    return d && (d.company || d.summary || d.results);
  }).length;

  const GRID_COLS = '48px minmax(150px, 0.9fr) minmax(140px, 1fr) minmax(240px, 1.8fr) minmax(200px, 1.4fr)';
  const cellInputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    padding: '0.4rem 0.5rem',
    fontSize: '0.74rem',
    fontFamily: 'inherit',
    color: '#1E293B',
    resize: 'vertical',
    background: '#fff',
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.6rem' }}>
        {filled} of {CASE_STUDY_INDUSTRIES.length} industries with a case study
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: GRID_COLS,
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          fontSize: '0.68rem',
          fontWeight: 700,
          color: '#475569',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>#</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Industry</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Company</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Summary</div>
          <div style={{ padding: '0.55rem 0.6rem' }}>Results</div>
        </div>
        {CASE_STUDY_INDUSTRIES.map((ind, i) => {
          const d = data[ind.id] || {};
          return (
            <div
              key={ind.id}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                alignItems: 'start',
                borderBottom: i === CASE_STUDY_INDUSTRIES.length - 1 ? 'none' : '1px solid #F1F5F9',
                background: i % 2 ? '#FFFFFF' : '#FCFCFD',
              }}
            >
              <div style={{ padding: '0.6rem', textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#94A3B8', alignSelf: 'center' }}>{i + 1}</div>
              <div style={{ padding: '0.6rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B', alignSelf: 'center' }}>{ind.name}</div>
              <div style={{ padding: '0.5rem 0.6rem' }}>
                <input
                  type="text"
                  value={d.company || ''}
                  placeholder="Company"
                  onChange={(e) => setField(ind.id, 'company', e.target.value)}
                  onFocus={() => { editingRef.current = true; }}
                  onBlur={() => { editingRef.current = false; }}
                  style={cellInputStyle}
                />
              </div>
              <div style={{ padding: '0.5rem 0.6rem' }}>
                <textarea
                  rows={2}
                  value={d.summary || ''}
                  placeholder="What was the engagement?"
                  onChange={(e) => setField(ind.id, 'summary', e.target.value)}
                  onFocus={() => { editingRef.current = true; }}
                  onBlur={() => { editingRef.current = false; }}
                  style={cellInputStyle}
                />
              </div>
              <div style={{ padding: '0.5rem 0.6rem' }}>
                <textarea
                  rows={2}
                  value={d.results || ''}
                  placeholder="Outcome / results"
                  onChange={(e) => setField(ind.id, 'results', e.target.value)}
                  onFocus={() => { editingRef.current = true; }}
                  onBlur={() => { editingRef.current = false; }}
                  style={cellInputStyle}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
