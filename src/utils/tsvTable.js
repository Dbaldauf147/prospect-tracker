// Shared helpers for the paste-a-printable-view tables (BFO Activity and
// the Leads subtab). Both let the user copy a table out of Salesforce /
// BFO and paste it in; these functions turn that tab-separated text into
// { headers, rows } and compare cell values for click-to-sort.

// BFO/Salesforce copy the active sort indicator into the header text —
// e.g. "Age Sorted Descending" or "Close DateSorted Ascending" (the space
// before "Sorted" is sometimes dropped). Strip that suffix (and any stray
// sort arrow) so the canonical column name survives the paste.
export function cleanHeader(h) {
  return String(h || '')
    .replace(/\s*[▲▼↑↓]\s*$/, '')
    .replace(/\s*sorted\s+(ascending|descending)\s*$/i, '')
    .trim();
}

export function parseTSV(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line) => line.split('\t');
  const rawHeaders = split(lines[0]).map(cleanHeader);
  // Make headers unique so duplicate column names don't collide.
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const c = seen.get(base) || 0;
    seen.set(base, c + 1);
    return c === 0 ? base : `${base} (${c + 1})`;
  });
  const rows = lines.slice(1).map(line => {
    const cells = split(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}

export function compareValues(a, b) {
  // Try number/currency first
  const numA = Number(String(a).replace(/[$,\s]/g, ''));
  const numB = Number(String(b).replace(/[$,\s]/g, ''));
  if (Number.isFinite(numA) && Number.isFinite(numB) && /\d/.test(String(a)) && /\d/.test(String(b))) {
    return numA - numB;
  }
  // Try date (M/D/YYYY)
  const dA = Date.parse(a);
  const dB = Date.parse(b);
  if (!Number.isNaN(dA) && !Number.isNaN(dB) && /\d/.test(String(a)) && /\d/.test(String(b))) {
    return dA - dB;
  }
  return String(a).localeCompare(String(b));
}
