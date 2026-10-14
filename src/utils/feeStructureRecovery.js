// Saved fee structures rebuilt from the Excel files the Pricing page wrote.
//
// The structures live on their own Pricing key (serviceFeeStructures) and,
// until they synced to the account, in one browser only, so some were lost.
// Every export written from them still says what they held:
//
//   As built      (Fee Builder export) one line per fee, with the service it
//                 came from (a fee several services share has a sub-row per
//                 service), its type, fee / unit, unit and start month
//   Cost deltas   (both exports) each cost line, its type and the fee the
//                 Fee Builder priced it into
//   Fee deltas    (both exports) the Fee Builder's fees by name, used when a
//                 file has no As built sheet (the Pricing tab's Fee Margin
//                 export); a fee's service then comes from the cost lines
//                 priced into it, through the Line Item -> Services mapping
//
// A Cost deltas table copied out of Excel and pasted works too
// (parsePastedCostDeltas). It names no fee rows, so each fee is read off
// its name and the cost lines priced into it: monthly if any of them is
// monthly or rolled, else Setup or One Time; Per Site / Per Account / ...
// when its name says so, else Fixed; no Start Month.
//
// What a rebuilt structure holds: a row per fee the service built, and an
// allocation per cost line pointing it at the fee it was priced into. A row
// that prices cost lines leaves its Fee blank, so it derives from those
// costs at today's GM% the way the original did; only a row no cost line
// feeds keeps the fee / unit the file shows. Unit Count is left to derive
// from the SIA, and a Start Month of 1 is left blank (it is the default).
// The files don't record pass-through, so a pass-through fee comes back
// as an ordinary one.
//
// Pure: the ExcelJS read is the one adapter (sheetRows), everything else
// takes plain arrays, so scripts/feeStructureRecovery.test.mjs runs it.

import { serviceKey, costKey, newFeeStructureId, costBucket, feeBucket } from './pricingServices.js';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (v) => String(v ?? '').trim();
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// An ExcelJS cell value as plain text or number: rich text joined, a
// formula's result, a hyperlink's text.
function cellValue(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map(t => t.text || '').join('');
  if ('result' in v) return cellValue(v.result);
  if ('text' in v) return cellValue(v.text);
  return '';
}

// One sheet as { cells, level } rows (cells 0-based), for parseExport.
export function sheetRows(ws) {
  const out = [];
  if (!ws) return out;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    out.push({ cells: vals.map(cellValue), level: row.outlineLevel || 0 });
  });
  return out;
}

// The rows between a header (found by `isHeader`) and the Total line.
function tableAfter(rows, isHeader) {
  const at = rows.findIndex(r => isHeader(r.cells.map(text)));
  if (at === -1) return null;
  const out = [];
  for (const r of rows.slice(at + 1)) {
    const first = text(r.cells[0]);
    if (first === 'Total') break;
    if (!r.cells.some(c => text(c))) continue;
    out.push(r);
  }
  return out;
}

const ON_SCHEDULE = 'on the schedule';

// What one export says: { feeRows: [{ feeName, services, type, feePerUnit,
// unit, startMonth }], costLines: [{ lineItem, type, fee }] }, from its
// sheets as sheetRows gives them ({ 'As built': rows, ... }). `services`
// is the service names the file ties the fee to (empty when it doesn't
// say). Null when the file has neither fee sheet.
export function parseExport(sheets) {
  const feeRows = [];
  const asBuilt = tableAfter(sheets['As built'] || [], c => c[0] === 'Fee' && c[1] === 'From');
  if (asBuilt) {
    const leaf = (r, from) => {
      const c = r.cells;
      const feeName = text(c[0]);
      if (!feeName) return;
      const services = String(from ?? '').split(',').map(text).filter(s => s && norm(s) !== ON_SCHEDULE);
      if (!services.length) return; // a row on the schedule no structure wrote
      feeRows.push({ feeName, services, type: text(c[2]), feePerUnit: num(c[3]), unit: text(c[4]), startMonth: num(c[6]) });
    };
    for (let i = 0; i < asBuilt.length; i++) {
      const r = asBuilt[i];
      if (r.level > 0) continue;
      const subs = [];
      while (asBuilt[i + 1]?.level > 0) subs.push(asBuilt[++i]);
      if (subs.length) for (const s of subs) leaf(s, s.cells[1]);
      else leaf(r, r.cells[1]);
    }
  } else {
    // Fee deltas: Fee line item, then six Pricing tab columns, then the
    // Fee Builder's Type, Fee, Unit, Units, Start Month, Term fees.
    const fees = tableAfter(sheets['Fee deltas'] || [], c => c[0] === 'Fee line item' && c[7] === 'Type');
    if (!fees) return null;
    for (const r of fees) {
      const c = r.cells;
      const feeName = text(c[0]);
      if (!feeName || (!text(c[7]) && num(c[8]) == null)) continue;
      feeRows.push({ feeName, services: [], type: text(c[7]), feePerUnit: num(c[8]), unit: text(c[9]), startMonth: num(c[11]) });
    }
  }
  const costLines = [];
  const costs = tableAfter(sheets['Cost deltas'] || [], c => c[0] === 'Cost line item' && c[6] === 'Priced into fee');
  for (const r of costs || []) {
    const c = r.cells;
    const lineItem = text(c[0]);
    if (!lineItem) continue;
    const logged = text(c[4]);
    costLines.push({ lineItem, type: text(c[1]), fee: text(c[6]) || (logged && logged !== 'No fee' ? logged : '') });
  }
  return { feeRows, costLines };
}

// The fee unit a fee's name implies ("Per site monthly" bills Per Site).
function unitFromName(name) {
  const n = norm(name);
  if (/\bper site\b/.test(n)) return 'Per Site';
  if (/\bper (account|a\/c)\b/.test(n)) return 'Per Account';
  if (/\bper meter\b/.test(n)) return 'Per Meter';
  if (/\bkwh\b/.test(n)) return 'Per kWh';
  if (/\bdth\b/.test(n)) return 'Per Dth';
  return 'Fixed';
}

// Cost deltas tables pasted as text (tab separated, as Excel copies them):
// one { feeRows, costLines } per table, so several pasted together come
// back as several structures. Every fee a cost line is priced into gets a
// row (see the note at the top for how its type and unit are read).
export function parsePastedCostDeltas(pasted) {
  const lines = String(pasted || '').split(/\r?\n/).map(l => l.split('\t').map(text));
  const tables = [];
  let cur = null;
  for (const c of lines) {
    if (c[0] === 'Cost line item' && c[1] === 'Type') { cur = []; tables.push(cur); continue; }
    if (!cur) continue;
    if (c[0] === 'Total' || (!c[0] && !c[1])) { if (c[0] === 'Total') cur = null; continue; }
    const logged = c[4] || '';
    cur.push({ lineItem: c[0], type: c[1] || '', fee: c[6] || (logged && logged !== 'No fee' ? logged : '') });
  }
  return tables.filter(t => t.length).map(costLines => {
    const byFee = new Map();
    for (const c of costLines) {
      if (!c.fee) continue;
      const k = norm(c.fee);
      if (!byFee.has(k)) byFee.set(k, { name: c.fee, buckets: new Set(), setupOnly: true });
      const f = byFee.get(k);
      f.buckets.add(costBucket(c.type));
      if (!/^setup/i.test(c.type)) f.setupOnly = false;
    }
    const feeRows = [...byFee.values()].map(f => ({
      feeName: f.name,
      services: [],
      type: f.buckets.has('recurring') || f.buckets.has('rolled') ? 'Recurring (monthly)' : (f.setupOnly ? 'Setup' : 'One Time'),
      feePerUnit: null,
      unit: unitFromName(f.name),
      startMonth: null,
    }));
    return { feeRows, costLines };
  });
}

// Structures rebuilt from one parsed export: { [serviceKey]: { service,
// rows, allocations } }.
//   servicesFor (lineItem) => the service names the Line Item -> Services
//               mapping ties it to
//   knownServices the service catalog's names, so a name in the file is
//               written under the catalog's own spelling
export function recoverFeeStructures({ feeRows = [], costLines = [] } = {}, { servicesFor = () => [], knownServices = [] } = {}) {
  const known = new Map(knownServices.map(n => [norm(n), n]));
  const canon = (n) => known.get(norm(n)) || text(n);

  // Which services own a fee row of each name: the file's own word first,
  // and the services of the cost lines priced into it.
  const rowsByFee = new Map();
  for (const r of feeRows) {
    const k = norm(r.feeName);
    if (!rowsByFee.has(k)) rowsByFee.set(k, []);
    rowsByFee.get(k).push(r);
  }
  const named = new Map(); // fee -> Set of services the file names
  for (const r of feeRows) {
    for (const s of r.services) {
      const k = norm(r.feeName);
      if (!named.has(k)) named.set(k, new Set());
      named.get(k).add(canon(s));
    }
  }
  // A cost line's service: those the mapping gives it, narrowed to the ones
  // the file names for its fee when it names any.
  const costService = costLines.map(c => {
    const mapped = (servicesFor(c.lineItem) || []).map(canon);
    const fk = norm(c.fee);
    if (!fk) return mapped.length === 1 ? mapped : [];
    const onFee = named.get(fk);
    if (onFee?.size) {
      const both = mapped.filter(s => onFee.has(s));
      if (both.length) return both;
      return onFee.size === 1 ? [...onFee] : [];
    }
    return mapped;
  });

  const out = {};
  const slot = (service) => {
    const k = serviceKey(service);
    if (!out[k]) out[k] = { service, rows: [], allocations: {}, fed: new Set() };
    return out[k];
  };
  // Cost lines first, so each service knows which fees its costs feed.
  costLines.forEach((c, i) => {
    const fk = norm(c.fee);
    if (fk && !rowsByFee.has(fk)) return; // a fee the file has no row for
    for (const s of costService[i]) {
      const st = slot(s);
      const a = { fee: fk };
      // An upfront cost on a monthly fee only bills once it is rolled over
      // the term, so a priced-in one was rolled.
      if (fk) {
        const feeType = (rowsByFee.get(fk) || [])[0]?.type;
        if (costBucket(c.type) === 'upfront' && feeBucket(feeType) === 'recurring') a.roll = true;
        st.fed.add(fk);
      }
      st.allocations[costKey(c.lineItem, c.type)] = a;
    }
  });
  for (const [fk, list] of rowsByFee) {
    const services = new Set([...(named.get(fk) || [])]);
    for (const st of Object.values(out)) if (st.fed.has(fk)) services.add(st.service);
    for (const s of services) {
      const st = slot(s);
      if (st.rows.some(x => norm(x.feeName) === fk)) continue;
      // The service's own line where the file gives one per service.
      const r = list.find(x => x.services.some(n => norm(n) === norm(s))) || list[0];
      st.rows.push({
        feeName: r.feeName,
        type: r.type,
        fee: st.fed.has(fk) ? null : r.feePerUnit,
        unit: r.unit,
        unitCount: null,
        startMonth: r.startMonth > 1 ? r.startMonth : null,
        passThrough: false,
      });
    }
  }
  // A service that only has "not covered" picks has nothing to recover.
  for (const [k, st] of Object.entries(out)) {
    delete st.fed;
    if (!st.rows.length) delete out[k];
  }
  return out;
}

const sameStructure = (a, b) => JSON.stringify({ r: a.rows, a: a.allocations || {} }) === JSON.stringify({ r: b.rows, a: b.allocations || {} });

// The rebuilt structures added to the saved ones under `name`, never in
// place of one: a service's existing structures stay, and its standard
// stays unless it had none. A structure already saved with the same rows
// and allocations (the same file recovered twice) isn't added again.
export function addRecoveredStructures(saved, recovered, name) {
  const next = { ...(saved || {}) };
  const added = [];
  const already = [];
  for (const [k, rec] of Object.entries(recovered || {})) {
    const cur = next[k] || { structures: [], standardId: null };
    const list = Array.isArray(cur.structures) ? cur.structures : [];
    if (list.some(x => sameStructure(x, rec))) { already.push(rec.service); continue; }
    const id = newFeeStructureId();
    next[k] = {
      ...cur,
      structures: [...list, { id, name, rows: rec.rows, allocations: rec.allocations }],
      standardId: cur.standardId || id,
    };
    added.push(rec.service);
  }
  return { next, added, already };
}

// The structure name a file's recovery is saved under: the Fee Builder's
// own file name (fee-schedule-Option-1-2026-10-10.xlsx) read back as
// "Recovered Option 1 (2026-10-10)", any other file by its name.
export function recoveredName(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
  const m = /^fee-schedule-(.+?)-(\d{4}-\d{2}-\d{2})$/i.exec(base);
  if (m) return `Recovered ${m[1].replace(/-/g, ' ')} (${m[2]})`;
  return `Recovered ${base || 'export'}`;
}
