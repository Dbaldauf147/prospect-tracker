// CSV mechanics: quoting a cell, joining a table, handing the file to the
// browser.
//
// Lifted out of campaignExport once a second export needed them (the
// company popup's Site List). They are the parts with no opinion about
// what is being exported, so both callers quote and download identically
// and a fix to the escaping lands in one place. campaignExport re-exports
// them so its own callers and tests did not have to move.

import { stripDashes } from './exportSanitize.js';

// One CSV cell. Quoted only where it has to be, doubled quotes inside.
export function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Header row + data rows -> the finished file. CRLF line endings: Excel reads
// either, but a bare \n confuses a few older Windows tools and nothing is
// gained by risking it.
export function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

// Hand the file to the browser. The only part of this module that needs a DOM;
// the BOM is what makes Excel open a UTF-8 CSV as UTF-8 rather than mangling
// every accented name in it.
export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + stripDashes(csv)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
