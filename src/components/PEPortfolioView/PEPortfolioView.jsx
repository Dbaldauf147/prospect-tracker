import { useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOpps2Newest, setOppField } from '../../utils/opps2Store';
import { formatAum } from '../../utils/formatters';
import { formatDateDisplay } from '../../utils/oppsCallIn';
import { PE_STAGES } from '../../data/enums';
import { downloadPortfolioCompaniesWorkbook } from '../../utils/portfolioCompaniesWorkbook';
import { PEOppsScheduleModal } from './PEOppsScheduleModal';
import { DataTable } from '../common/DataTable';

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

export function PEPortfolioView({ prospects = [], onSelectProspect }) {
  const { user } = useAuth();
  const [subtab, setSubtab] = useState('portfolio');
  const [showClosed, setShowClosed] = useState(false);
  const [oppsQuery, setOppsQuery] = useState('');
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
  const DEFAULT_COL_WIDTHS = { company: 240, peAum: 110, geography: 110, dm: 170, met: 170, mapping: 110, pcDownload: 120, opps: 100, ratio: 120, clients: 110, keyContacts: 120, caseStudy: 110, discovery: 100, piloting: 100, existingPartnership: 150 };
  // company is sticky and always shown — every other column is opt-in.
  const ALL_COL_KEYS = ['company', 'peAum', 'geography', 'dm', 'met', 'mapping', 'pcDownload', 'opps', 'ratio', 'clients', 'keyContacts', 'caseStudy', 'discovery', 'piloting', 'existingPartnership'];
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-portfolio:col-widths')) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('pe-portfolio:sort-key') || 'ratio');
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('pe-portfolio:sort-dir') || 'desc');
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-portfolio:visible-cols'));
      if (Array.isArray(saved)) {
        const next = new Set([...saved, 'company']);
        // One-time migration: reveal the PE Stage columns for users whose
        // saved set predates them, so they show up without a manual opt-in.
        if (!localStorage.getItem('pe-portfolio:cols-pe-stage')) {
          next.add('discovery'); next.add('piloting'); next.add('existingPartnership');
          try { localStorage.setItem('pe-portfolio:cols-pe-stage', '1'); } catch {}
        }
        // One-time migration: reveal the PC Download column for users
        // whose saved set predates it.
        if (!localStorage.getItem('pe-portfolio:cols-pc-download')) {
          next.add('pcDownload');
          try { localStorage.setItem('pe-portfolio:cols-pc-download', '1'); } catch {}
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

  const filteredPeOpps = useMemo(() => {
    const q = oppsQuery.trim().toLowerCase();
    if (!q) return peOpps;
    return peOpps.filter(r =>
      [r['Account'], r['Contact'], r['Stage'], r['Scope'], r['Source'], r['Type'], r['Sales Partner'], r['Status'], r['BFO Link'], r['Next Steps']]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }, [peOpps, oppsQuery]);

  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects]);

  // Total mapped portfolio companies across every PE firm — drives the
  // "All Companies" sub-tab count.
  const allPortfolioCompanyCount = useMemo(() => (
    peFirms.reduce((s, pe) => s + (Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies.length : 0), 0)
  ), [peFirms]);

  // Portfolio company → PE firm (lowercased name) lookup, from each prospect's peOwner field.
  const portfolioByPe = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const owner = (p.peOwner || '').trim().toLowerCase();
      if (!owner) continue;
      if (!map.has(owner)) map.set(owner, []);
      map.get(owner).push(p);
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
        if (companiesMatch(name, acct)) list.push(r);
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
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        domain,
        metInPerson: tags.includes('met in person'),
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

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

  // Per-firm stage stats — the row-level data behind the stages table.
  //   decisionMakerNames  : DM contacts on this PE firm (or its PCs)
  //   pcMappingCount      : portfolio companies linked via peOwner
  //   pcOppsCount         : PCs that have ≥1 opp (any stage)
  //   activeOpps, totalOpps : aggregated across the PE firm + all PCs,
  //                           active = non-closed non-invalid stage;
  //                           total = every non-invalid stage
  //   pcClientCount       : PCs where status === 'Client'
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

      // PC Opps — PCs with ≥1 opp.
      let pcOppsCount = 0;
      for (const p of portfolio) {
        if ((oppsByProspectId.get(p.id) || []).length > 0) pcOppsCount++;
      }

      // Aggregate opps for the PE firm itself + every portfolio company.
      // We re-scan the Opps records so we also catch opps that land
      // directly on the PE firm's account name (not just its PCs).
      let active = 0;
      let total = 0;
      const oppsNames = [firmName, ...portfolio.map(p => (p.company || '').toLowerCase().trim()).filter(Boolean)];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct) continue;
        if (!oppsNames.some(n => companiesMatch(n, acct))) continue;
        total++;
        if (!CLOSED_STAGES.has(stage)) active++;
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

      // Case study presence — Yes when the PE firm itself OR any of its
      // portfolio companies has the caseStudyCreated flag set.
      const caseStudyFirm = !!pe.caseStudyCreated;
      const caseStudyPcs = portfolio.filter(p => !!p.caseStudyCreated);
      const caseStudyYes = caseStudyFirm || caseStudyPcs.length > 0;
      const caseStudyTipNames = [
        ...(caseStudyFirm ? [pe.company] : []),
        ...caseStudyPcs.map(p => p.company),
      ];

      out.set(pe.id, {
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
        pcOppsCount,
        activeOpps: active,
        totalOpps: total,
        pcClientCount,
        keyContactCount: keyNames.length,
        keyContactNames: keyNames,
        caseStudyYes,
        caseStudyTipNames,
      });
    }
    return out;
  }, [peFirms, portfolioByPe, oppsByProspectId, decisionMakers, keyContacts, oppsRecords]);

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
        case 'opps':
          cmp = (sa.pcOppsCount || 0) - (sb.pcOppsCount || 0);
          break;
        case 'ratio':
          cmp = (sa.activeOpps || 0) - (sb.activeOpps || 0);
          if (cmp === 0) cmp = (sa.totalOpps || 0) - (sb.totalOpps || 0);
          break;
        case 'clients':
          cmp = (sa.pcClientCount || 0) - (sb.pcClientCount || 0);
          break;
        case 'keyContacts':
          cmp = (sa.keyContactCount || 0) - (sb.keyContactCount || 0);
          break;
        case 'caseStudy':
          cmp = (sa.caseStudyYes ? 1 : 0) - (sb.caseStudyYes ? 1 : 0);
          break;
        case 'discovery':
          cmp = (a.peStage === 'Discovery' ? 1 : 0) - (b.peStage === 'Discovery' ? 1 : 0);
          break;
        case 'piloting':
          cmp = (a.peStage === 'Piloting' ? 1 : 0) - (b.peStage === 'Piloting' ? 1 : 0);
          break;
        case 'existingPartnership':
          cmp = (a.peStage === 'Existing Partnership' ? 1 : 0) - (b.peStage === 'Existing Partnership' ? 1 : 0);
          break;
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.company || '').localeCompare(b.company || '');
      return cmp;
    });
    return arr;
  }, [peFirms, stageStatsByFirm, sortKey, sortDir]);

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
              ? <>PE firms grouped by their <strong>PE Stage</strong> (set in each firm's company popup): <code>Discovery</code>, <code>Piloting</code>, and <code>Existing Partnership</code>.</>
              : subtab === 'companies'
              ? <>Every mapped <strong>portfolio company</strong> across all PE firms (from each firm's Portfolio Companies tab), merged into one searchable, filterable table.</>
              : <>Every opportunity from the <strong>Opps 2</strong> tab with Type = <code>Private Equity</code> or Source = <code>PE partner</code>.</>}
          </div>
        </div>
        {subtab === 'portfolio' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
            <span>Include closed (Sold / Not Sold / Lost)</span>
          </label>
        )}
      </div>

      {/* Sub-tab bar — Portfolio firms vs. the flat PE Opps list. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid #E2E8F0', margin: '0 1.25rem 0.5rem', flexShrink: 0 }}>
        {[
          { key: 'portfolio', label: 'Portfolio', count: peFirms.length },
          { key: 'stages', label: 'PE Stages', count: peFirms.length },
          { key: 'companies', label: 'All Companies', count: allPortfolioCompanyCount },
          { key: 'opps', label: 'PE Opps', count: peOpps.length },
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
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 999,
                background: isActive ? '#7C3AED' : '#E2E8F0',
                color: isActive ? '#fff' : '#475569',
              }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {subtab === 'opps' ? (
        <PEOppsTab
          opps={filteredPeOpps}
          totalOpps={peOpps.length}
          query={oppsQuery}
          setQuery={setOppsQuery}
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
          onSelectProspect={onSelectProspect}
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
              met: 'Met in Person', mapping: 'PC Mapping', pcDownload: 'PC Download', opps: 'PC Opps', ratio: 'PC Opps 2/4',
              clients: 'PC Clients', keyContacts: 'Key Contacts', caseStudy: 'Case Study',
              discovery: 'Discovery', piloting: 'Piloting', existingPartnership: 'Existing Partnership',
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
            No Opps data loaded. Open the <strong>Opps</strong> tab once to sync it from Google Sheets; counts will populate here afterwards.
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
                : `${peFirms.length} total PE firms loaded — adjust your search.`}
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
            { key: 'opps',    label: 'PC Opps', align: 'center',    tip: 'Count of portfolio companies that have at least one opportunity in the Opps tab' },
            { key: 'ratio',   label: 'PC Opps 2/4', align: 'center', tip: 'Active / total opps aggregated across the PE firm plus every portfolio company' },
            { key: 'clients', label: 'PC Clients', align: 'center',  tip: 'Portfolio companies currently set to status = Client' },
            { key: 'keyContacts', label: 'Key Contacts', align: 'center', tip: 'Count of HubSpot contacts tagged "Dan Key Target" across the PE firm plus its portfolio companies' },
            { key: 'caseStudy', label: 'Case Study', align: 'center', tip: 'Yes when the PE firm or any of its portfolio companies has "Case Study Created?" set to Yes on its company page' },
            { key: 'discovery', label: 'Discovery', align: 'center', tip: 'Checked when this PE firm\'s PE Stage (set in its company popup) is Discovery' },
            { key: 'piloting', label: 'Piloting', align: 'center', tip: 'Checked when this PE firm\'s PE Stage (set in its company popup) is Piloting' },
            { key: 'existingPartnership', label: 'Existing Partnership', align: 'center', tip: 'Checked when this PE firm\'s PE Stage (set in its company popup) is Existing Partnership' },
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
                        {pe.geography || '—'}
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
                            <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>—</div>
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
                              <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>—</span>
                            )}
                          </div>
                        );
                      })()}

                      {visibleCols.has('opps') && (
                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.pcOppsCount || 0) > 0 ? '#7C3AED' : '#CBD5E1' }}>
                        {stats.pcOppsCount || 0}
                      </div>
                      )}

                      {visibleCols.has('ratio') && (
                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.activeOpps || 0) > 0 ? '#7C3AED' : (stats.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }} title="active / total opportunities across this firm and its portfolio companies">
                        {(stats.activeOpps || 0)}/{(stats.totalOpps || 0)}
                      </div>
                      )}

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
                        title={stats.caseStudyYes
                          ? `Case study marked on:\n${(stats.caseStudyTipNames || []).join('\n')}`
                          : 'No PE firm or portfolio company on this row has "Case Study Created?" set to Yes'}
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700 }}
                      >
                        {stats.caseStudyYes ? (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' }}>Yes</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#64748B' }}>No</span>
                        )}
                      </div>
                      )}

                      {[
                        { key: 'discovery', stage: 'Discovery' },
                        { key: 'piloting', stage: 'Piloting' },
                        { key: 'existingPartnership', stage: 'Existing Partnership' },
                      ].map(({ key, stage }) => visibleCols.has(key) && (
                        <div
                          key={key}
                          title={pe.peStage === stage
                            ? `PE Stage set to "${stage}" in this firm's company popup`
                            : pe.peStage
                              ? `PE Stage is "${pe.peStage}", not "${stage}"`
                              : 'No PE Stage set on this firm\'s company popup'}
                          style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: pe.peStage === stage ? '#7C3AED' : '#CBD5E1' }}
                        >
                          {pe.peStage === stage ? '✓' : '—'}
                        </div>
                      ))}

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

// "All Companies" sub-tab: every PE firm's mapped portfolio companies
// (the entries in each firm's Portfolio Companies tab) flattened into a
// single table, with a global search plus per-column filters and sorting
// via the shared DataTable. A leading PE Firm column records which firm
// each company came from and links back to that firm's company popup.
function PEAllCompaniesTab({ firms, onSelectProspect }) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const out = [];
    let id = 0;
    for (const pe of firms) {
      const pcs = Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies : [];
      for (const pc of pcs) {
        out.push({
          id: id++,
          _peId: pe.id,
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
          pcDescription: pc.pcDescription || '',
          notes: pc.notes || '',
        });
      }
    }
    return out;
  }, [firms]);

  const columns = useMemo(() => [
    { key: 'peFirm', label: 'PE Firm', defaultWidth: 190, sticky: true, render: (r) => (
      <button
        type="button"
        onClick={() => { const pe = firms.find(f => f.id === r._peId); if (pe) onSelectProspect?.(pe); }}
        title={`Open "${r.peFirm}" in the Table View`}
        style={{ background: 'none', border: 'none', padding: 0, color: '#7C3AED', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left' }}
      >
        {r.peFirm || '—'}
      </button>
    ) },
    { key: 'companyName', label: 'Company Name', defaultWidth: 220 },
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
    { key: 'pcDescription', label: 'PC Description', defaultWidth: 320 },
    { key: 'notes', label: 'Notes', defaultWidth: 220 },
  ], [firms, onSelectProspect]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [search, rows]);

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
        {search.trim() && <span style={{ fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>{filtered.length} of {rows.length}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No portfolio companies mapped yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Open a PE firm's company popup and add companies in its <strong>Portfolio Companies</strong> tab — they'll be merged here.
            </div>
          </div>
        ) : (
          <DataTable
            tableId="pe-all-portfolio-companies"
            columns={columns}
            rows={filtered}
            alwaysVisible={['peFirm']}
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

// PE firms laid out as a Kanban board by engagement stage (peStage):
// one column per stage — Discovery, Piloting, Existing Partnership, plus
// an Unassigned column for firms with no stage set — so the user can
// scan which PE relationships sit at each phase. Cards link back to the
// firm's company popup; stage is set per firm in that popup's "PE Stage"
// dropdown. The whole board (respecting the search filter) exports to
// Excel via the toolbar button.
function PEStagesTab({ firms, portfolioByPe, onSelectProspect }) {
  const [query, setQuery] = useState('');
  const STAGE_META = [
    { stage: 'Discovery', accent: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
    { stage: 'Piloting', accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
    { stage: 'Existing Partnership', accent: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
    { stage: 'Unassigned', accent: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' },
  ];
  const stageOf = (pe) => (PE_STAGES.includes(pe.peStage) ? pe.peStage : 'Unassigned');
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
            { text: pe.company || '—', font: { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FF1E293B' } } },
            { text: `\n${formatAum(pe.peAum)}   ·   ${pe.geography || '—'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF475569' } } },
            { text: `\n${pcCount} portfolio co${pcCount === 1 ? '' : 's'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF64748B' } } },
          ],
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.bg) } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        cell.border = cardBorder(m);
      });
    }

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
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pe.company || '—'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginTop: '0.35rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: pe.peAum ? '#1E293B' : '#CBD5E1' }} title={pe.peAum ? `PE AUM: $${pe.peAum}B` : 'No PE AUM set'}>{formatAum(pe.peAum)}</span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: pe.geography ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pe.geography || 'No geography set'}>{pe.geography || '—'}</span>
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
        placeholder="—"
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
function PEOppsTab({ opps, totalOpps, query, setQuery, oppsLoaded, prospects, onSelectProspect, onEditField, user }) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const ALL_COLUMNS = [
    { key: 'Account', label: 'Account', width: '1.6fr' },
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
    title.value = `PE Opportunities · ${opps.length} opp${opps.length === 1 ? '' : 's'}`;
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

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `pe-opps-${date}.xlsx`;
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
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${totalOpps} PE opp${totalOpps === 1 ? '' : 's'}…`}
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
        oppsRows={sortedOpps}
        allColumns={ALL_COLUMNS.map(c => ({ key: c.key, label: c.label }))}
        defaultColumns={[...visibleCols]}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {!oppsLoaded && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            No Opps data loaded. Open the <strong>Opps 2</strong> tab once to sync it; PE opps will populate here afterwards.
          </div>
        )}
        {opps.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {totalOpps === 0 ? 'No PE opps found' : `No opps match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {totalOpps === 0
                ? <>No Opps 2 rows have Type = <code>Private Equity</code> or Source = <code>PE partner</code>.</>
                : `${totalOpps} total PE opps loaded — adjust your search.`}
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
                      >{val || '—'}</div>
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
