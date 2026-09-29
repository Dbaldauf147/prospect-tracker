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
// subtab's price check reads them (an SIA often fills them on one sheet).
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
