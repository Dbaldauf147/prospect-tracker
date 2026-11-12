// The file behind a "Dan's Company Export" email, read into rows: from
// the email's "Download CSV" link, or from a file attached to it. Shared by
// the Outlook and Gmail readers (api/hubspot-export-mail.js,
// api/_lib/hubspotExportGmail.js).

import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// HubSpot hands the export over as a .zip holding the CSV (or .xlsx). An
// .xlsx is itself a zip, so a zip with Excel's own [Content_Types].xml is
// passed through as is; any other zip is opened and its spreadsheet read.
export async function unzipIfNeeded(buf) {
  if (!(buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b)) return buf;
  const zip = await JSZip.loadAsync(buf);
  if (zip.file('[Content_Types].xml')) return buf;
  const files = Object.values(zip.files)
    .filter(f => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && /\.(csv|xlsx|xls)$/i.test(f.name));
  if (!files.length) {
    throw new HttpError(422, `The downloaded zip has no CSV or Excel file in it (it has: ${Object.keys(zip.files).join(', ') || 'nothing'}).`);
  }
  // Prefer a CSV; among several, the biggest is the report.
  const sized = await Promise.all(files.map(async f => ({ f, data: await f.async('nodebuffer') })));
  sized.sort((a, b) => (/\.csv$/i.test(b.f.name) - /\.csv$/i.test(a.f.name)) || (b.data.length - a.data.length));
  return sized[0].data;
}

/** A CSV or Excel file (zipped or not) as rows keyed by header. */
export async function rowsFromFile(buf) {
  const file = await unzipIfNeeded(buf);
  // Reads CSV and Excel alike, as the manual upload does.
  const wb = XLSX.read(file, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

export async function download(link) {
  const r = await fetch(link, { redirect: 'follow' });
  if (!r.ok) throw new HttpError(502, `The Download CSV link answered HTTP ${r.status}. It may have expired; the next email brings a new one.`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = String(r.headers.get('content-type') || '');
  if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(buf.subarray(0, 200).toString('utf8'))) {
    throw new HttpError(502, 'The Download CSV link returned a web page instead of a file (it may now ask for a HubSpot login).');
  }
  return rowsFromFile(buf);
}
