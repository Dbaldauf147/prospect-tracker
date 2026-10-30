// My Accounts > Hubspot Mapping: "Export HubSpot Import File". Dan imports
// the file into HubSpot (Companies, "Update existing companies only",
// "Create a list from this import") to get a static list of his accounts'
// companies for reporting. Three sheets:
//
//   Import     one row per HubSpot Company ID (Record ID), so every
//              duplicate record makes the list; an account with no ID but
//              a website goes in by Company Domain Name instead.
//   Review     the accounts worth a second look before importing, with why.
//   Reference  every column of the tab, one row per account, unsplit.
//
// Every account on the tab goes in, active and inactive, whatever the
// filters on screen say. Only in HubSpot rows (no account) are left out.
//
// Pure apart from the Workbook class passed in, so it runs under plain
// Node in the tests (scripts/hubspotImportFile.test.mjs).

import { normalizeCompany } from './companyNorm.js';
import { domainKey } from './seHubspotExisting.js';

export const IMPORT_HEADERS = ['Record ID', 'Company Domain Name', 'Name', 'Tracker Name'];
export const REVIEW_HEADERS = ['Tracker Name', 'HubSpot Company', 'HubSpot Company ID(s)', 'Matched By', 'Possible Match', 'Hubspot Duplicates', 'Reason'];
const HOW = { website: 'Website', name: 'Name', linked: 'Your link' };

const trim = (v) => String(v ?? '').trim();
// The mapping stands in "row-N" for the ID when the export had no Company
// ID column: that is not a HubSpot record.
const realId = (id) => { const s = trim(id); return s && !/^row-\d+$/.test(s) ? s : ''; };

/**
 * A domain as HubSpot keys companies on it: lowercase, no http(s)://, no
 * www., no path, query or trailing slash. An email address gives its
 * domain. Anything that isn't a domain reads as ''.
 */
export const normalizeDomain = (v) => domainKey(v);

/** A row's HubSpot Company IDs, trimmed, once each, in the tab's order. */
export function hubspotIdsOf(row) {
  const out = [];
  for (const c of row?.hubspot || []) {
    // A cell can itself hold "1, 2, 3"; split it the same way.
    for (const id of String(c?.id ?? '').split(',').map(realId)) {
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

// The account's own website, else its email domain.
const accountDomain = (a) => normalizeDomain(a?.website) || normalizeDomain(a?.emailDomain);

/**
 * The three sheets' rows from the tab's mapping (buildHubspotMapping).
 * `reference` is [{ label, value(row) }], the tab's columns, for the
 * Reference sheet and for the Review sheet's cells.
 */
export function buildHubspotImportSheets(mapping = [], { reference = [] } = {}) {
  const accountRows = (mapping || []).filter(r => r?.account)
    .slice().sort((x, y) => trim(x.account.company).localeCompare(trim(y.account.company)));
  const refValue = (r, label) => {
    const col = reference.find(c => c.label === label);
    return col ? trim(col.value(r)) : '';
  };

  const importRows = [];
  const reviewRows = [];
  const seenIds = new Set();
  const seenDomains = new Set();
  let noIdNoDomain = 0;

  for (const r of accountRows) {
    const tracker = trim(r.account.company);
    const ids = hubspotIdsOf(r);
    const reasons = [];

    if (ids.length) {
      for (const id of ids) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const c = r.hubspot.find(h => String(h.id).split(',').map(realId).includes(id)) || {};
        importRows.push({ 'Record ID': id, 'Company Domain Name': '', Name: trim(c.name), 'Tracker Name': tracker });
      }
    } else {
      const domain = accountDomain(r.account);
      if (domain) {
        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          importRows.push({ 'Record ID': '', 'Company Domain Name': domain, Name: '', 'Tracker Name': tracker });
        }
        reasons.push(`No HubSpot Company ID, imported by domain ${domain}`);
      } else {
        noIdNoDomain += 1;
        reasons.push('No HubSpot Company ID and no domain available, left off Import');
      }
    }

    if (r.how === 'name') reasons.push('Matched by Name only');
    if (r.suggestions?.length) reasons.push('Has a Possible Match');
    if (r.duplicates?.length) reasons.push('Has Hubspot Duplicates');
    if (ids.length > 1) reasons.push(`${ids.length} HubSpot Company IDs: ${ids.join(', ')}`);
    const own = normalizeCompany(tracker);
    const differing = [...new Set((r.hubspot || []).map(c => trim(c.name)).filter(n => n && normalizeCompany(n) !== own))];
    if (differing.length) reasons.push(`HubSpot name differs: ${differing.join(', ')}`);

    if (reasons.length) {
      reviewRows.push({
        'Tracker Name': tracker,
        'HubSpot Company': [...new Set((r.hubspot || []).map(c => trim(c.name)).filter(Boolean))].join(', '),
        'HubSpot Company ID(s)': ids.join(', '),
        'Matched By': HOW[r.how] || '',
        'Possible Match': refValue(r, 'Possible Match') || (r.suggestions || []).map(m => `${m.name} (${m.score}%)`).join(', '),
        'Hubspot Duplicates': refValue(r, 'Hubspot Duplicates') || (r.duplicates || []).map(c => `${c.name} (${c.id})`).join(', '),
        Reason: reasons.join('; '),
      });
    }
  }

  const referenceRows = accountRows.map(r => Object.fromEntries(reference.map(c => [c.label, trim(c.value(r))])));
  return {
    importRows,
    reviewRows,
    referenceRows,
    referenceHeaders: reference.map(c => c.label),
    counts: { accounts: accountRows.length, importRows: importRows.length, reviewRows: reviewRows.length, noIdNoDomain },
  };
}

// Columns whose values are HubSpot IDs: stored and formatted as text, so
// Excel neither rounds an 11+ digit ID nor shows it as 5.85E+10.
const ID_HEADERS = new Set(['Record ID', 'HubSpot Company ID(s)', 'HubSpot Company ID']);

function addSheet(wb, name, headers, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map(h => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length);
    return { header: h, key: h, width: Math.min(Math.max(longest + 2, 12), 60), ...(ID_HEADERS.has(h) ? { style: { numFmt: '@' } } : {}) };
  });
  // Every value goes in as a string, so nothing is reread as a number.
  for (const r of rows) ws.addRow(Object.fromEntries(headers.map(h => [h, String(r[h] ?? '')])));
  ws.getRow(1).font = { bold: true };
  if (headers.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return ws;
}

/** The workbook, built with the ExcelJS Workbook class passed in. */
export function buildHubspotImportWorkbook(Workbook, sheets) {
  const wb = new Workbook();
  wb.created = new Date();
  addSheet(wb, 'Import', IMPORT_HEADERS, sheets.importRows);
  addSheet(wb, 'Review', REVIEW_HEADERS, sheets.reviewRows);
  addSheet(wb, 'Reference', sheets.referenceHeaders, sheets.referenceRows);
  return wb;
}

/** hubspot-company-import-YYYY-MM-DD.xlsx, in the viewer's own date. */
export function hubspotImportFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `hubspot-company-import-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.xlsx`;
}
