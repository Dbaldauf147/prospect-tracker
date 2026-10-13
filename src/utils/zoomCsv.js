// The four-column CSV the app hands to ZoomInfo: Company, Zoom Company ID,
// Zoom Company Name, Company URL. The same columns My Accounts' Zoom
// exports write, so every file can go into ZoomInfo the same way.
//
// Rows are company records (Table View prospects), read for their own
// company / zoomCompanyId / zoomCompanyName / website. Companies excluded
// from ZoomInfo on their popup are dropped (utils/zoomExportExclude.js).
//
// Pure apart from downloadZoomCsv, so the text can be asserted in Node:
// scripts/zoomCsv.test.mjs.

import { buildZoomExcludedMatcher } from './zoomExportExclude.js';

export const ZOOM_CSV_HEADER = ['Company', 'Zoom Company ID', 'Zoom Company Name', 'Company URL'];

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * { csv, kept, excluded } for `rows`. `allProspects` is the whole Table
 * View, which is where the Exclude from ZoomInfo flags live.
 */
export function buildZoomCsv(rows, allProspects = rows) {
  const isExcluded = buildZoomExcludedMatcher(allProspects);
  const kept = (rows || []).filter(p => !isExcluded({ id: p?.id, company: p?.company, zoomId: p?.zoomCompanyId }));
  const lines = [ZOOM_CSV_HEADER, ...kept.map(p => [
    p.company || '', p.zoomCompanyId || '', p.zoomCompanyName || '', p.website || '',
  ])];
  return {
    csv: lines.map(r => r.map(csvCell).join(',')).join('\n'),
    kept: kept.length,
    excluded: (rows || []).length - kept.length,
  };
}

export function downloadZoomCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
