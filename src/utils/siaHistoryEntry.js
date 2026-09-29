// The record the SIA load history keeps for one uploaded SIA workbook.
// Pure: built from the parser's output so it can be tested without a
// browser. Storage lives in siaLoadHistory.js.
//
// The entry keeps what somebody would want back from an old SIA without
// the file: every option's header details (sites, accounts, salesperson,
// date, solution description, target GM) and every cost line. The parser's
// raw row copies and diagnostic samples are left behind - they are the
// file again, not the answer.

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function buildSiaHistoryEntry({ id, fileName, loadedAt, sizeBytes, options }) {
  return {
    id: String(id),
    fileName: String(fileName || 'workbook.xlsx'),
    loadedAt: num(loadedAt) ?? Date.now(),
    sizeBytes: num(sizeBytes),
    options: (options || []).map(opt => ({
      optionNumber: opt.optionNumber ?? null,
      sheetName: opt.sheetName || '',
      hidden: !!opt.hidden,
      solutionDescription: opt.solutionDescription || '',
      siteCount: num(opt.siteCount),
      accountCount: num(opt.accountCount),
      targetGmPct: num(opt.targetGmPct),
      useTargetGm: typeof opt.useTargetGm === 'boolean' ? opt.useTargetGm : null,
      headerDetails: (opt.headerDetails || []).map(d => ({ label: String(d.label), value: String(d.value ?? '') })),
      costItems: (opt.sections || []).flatMap(section => (section.items || []).map(item => ({
        section: section.title || '',
        description: item.description || '',
        type: item.type || '',
        cts: num(item.cts),
        startMonth: item.startMonth || '',
        comments: item.comments || '',
        gmPct: num(item.gmPct),
      }))),
      altFees: (opt.altFees || [])
        .filter(a => a && (a.altItem || a.fee != null))
        .map(a => ({
          altItem: a.altItem || '',
          type: a.type || '',
          fee: num(a.fee),
          unit: a.unit || '',
          unitCount: num(a.unitCount),
          startMonth: num(a.startMonth),
        })),
    })),
  };
}

// The one-line figures the history list shows per load. Sites and accounts
// come off the first option that carries them, the way the Services
// subtab's price check reads them (an SIA often fills them on one sheet);
// the key facts (company, date, spend, kWh, gas) the same way. Worked out
// from the stored header details rather than saved alongside them, so
// loads recorded before these columns existed fill in too.
export function siaHistorySummary(entry) {
  const options = entry?.options || [];
  const first = (k) => options.find(o => typeof o[k] === 'number' && o[k] > 0)?.[k] ?? null;
  let costLines = 0;
  let ctsTotal = 0;
  for (const o of options) {
    for (const it of o.costItems || []) {
      costLines += 1;
      if (typeof it.cts === 'number') ctsTotal += it.cts;
    }
  }
  const salesperson = options
    .flatMap(o => o.headerDetails || [])
    .find(d => /sales\s*person/i.test(d.label) && d.value)?.value || '';
  return {
    optionCount: options.length,
    sites: first('siteCount'),
    accounts: first('accountCount'),
    costLines,
    ctsTotal,
    salesperson,
    ...siaKeyFacts(options),
  };
}

// Newest first; one entry per id, the later-loaded copy winning.
export function mergeSiaHistory(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const e of list || []) {
      if (!e?.id) continue;
      const prev = byId.get(e.id);
      if (!prev || (e.loadedAt || 0) >= (prev.loadedAt || 0)) byId.set(e.id, e);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b.loadedAt || 0) - (a.loadedAt || 0));
}

// The five figures that identify an SIA at a glance: who it is for, when it
// was drawn up, and how big the book is (annual spend, electric kWh, gas in
// MMBtu or Dth). All five sit in the header block as label / value pairs,
// so they are read back out of headerDetails, first option that carries
// each one winning. Labels vary between SIA templates ("Client" vs
// "Company Name", "Annual Gas (Dth)" vs "Annual MMBtu"), hence the loose
// matching. The gas unit is taken from whichever label matched, so the
// figure is never shown against the wrong unit.
const COMPANY_RE = /^((client|company|customer)(\s*name)?|account\s*name)$/i;
const DATE_RE = /^(sia\s*)?date$/i;
const SPEND_RE = /\bspend\b/i;
const KWH_RE = /\bkwh\b/i;
const GAS_RE = /\b(mmbtu|dth|decatherms?|dekatherms?)\b/i;

function factNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function siaKeyFacts(options) {
  const details = (options || []).flatMap(o => o?.headerDetails || [])
    .map(d => ({ label: String(d?.label ?? '').trim(), value: String(d?.value ?? '').trim() }))
    .filter(d => d.label && d.value);
  const find = (re, { numeric = false } = {}) => details.find(d => re.test(d.label) && (!numeric || factNumber(d.value) != null));
  const company = find(COMPANY_RE);
  const date = find(DATE_RE);
  const spend = find(SPEND_RE, { numeric: true });
  const kwh = find(KWH_RE, { numeric: true });
  const gas = details.find(d => GAS_RE.test(d.label) && !KWH_RE.test(d.label) && factNumber(d.value) != null);
  const gasUnit = gas ? (/mmbtu/i.test(gas.label) ? 'MMBtu' : 'Dth') : '';
  return {
    company: company?.value || '',
    date: date?.value || '',
    annualSpend: spend ? factNumber(spend.value) : null,
    annualKwh: kwh ? factNumber(kwh.value) : null,
    annualGas: gas ? factNumber(gas.value) : null,
    gasUnit,
  };
}

// The cost lines of one history entry that a search matches, for the SIA
// History filter. A line matches when the text is anywhere in its line
// item, section, type or comments (case-insensitive). Returns one array of
// matching line indexes per option, in the entry's option order, so the
// page can list the hits and mark them in the option view.
export function siaCostLineMatches(entry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  return (entry?.options || []).map(o => {
    if (!q) return [];
    const hits = [];
    (o.costItems || []).forEach((it, i) => {
      const hay = [it.description, it.section, it.type, it.comments].join(' ').toLowerCase();
      if (hay.includes(q)) hits.push(i);
    });
    return hits;
  });
}
