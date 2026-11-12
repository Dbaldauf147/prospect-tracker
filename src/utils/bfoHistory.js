import { bfoCompanyNamesOf } from './bfoCompanyNames.js';

// BFO History: the opportunities BFO (Salesforce) holds against an account,
// transcribed by the Agents tab's "BFO History" task from the account's
// Oppty 360 tab ("Opportunities of this Account" set to "All of the above",
// Open and Closed, every page) and pasted into the company popup's BFO
// History tab. Stored on the company record as
//   bfoHistory: { rows: [{ status, name, leader, ... }], pastedAt: ISO }
// A paste replaces the whole list: the agent transcribes every page, so the
// new paste is the full picture and anything missing from it is gone in BFO.

export const BFO_HISTORY_COLUMNS = [
  { key: 'status', label: 'Status', aliases: ['status', 'tab', 'open/closed', 'open or closed'] },
  { key: 'name', label: 'Opportunity Name', aliases: ['opportunity name', 'opportunity', 'name', 'opp name'] },
  { key: 'leader', label: 'Leader', aliases: ['leader', 'owner', 'opportunity owner'] },
  { key: 'stage', label: 'Stage', aliases: ['stage'] },
  { key: 'amount', label: 'Amount', aliases: ['amount'] },
  { key: 'closeDate', label: 'Close Date', aliases: ['close date', 'close'] },
  { key: 'lastModified', label: 'Last Modified Date', aliases: ['last modified date', 'last modified', 'modified'] },
  { key: 'reporting', label: 'Included in Reporting', aliases: ['included in reporting', 'reporting', 'included'] },
  { key: 'probability', label: '% Probability', aliases: ['% probability', 'probability', 'probability (%)', 'prob'] },
  // Which of the company's BFO accounts the row came from, when it has
  // several (utils/bfoCompanyNames). Last so a headerless paste from before
  // this column still lines up.
  { key: 'account', label: 'BFO Account', aliases: ['bfo account', 'account', 'account name', 'bfo company name', 'bfo name'] },
];

// The header line the agent is told to write, tab separated.
export const BFO_HISTORY_HEADER = BFO_HISTORY_COLUMNS.map(c => c.label).join('\t');

// How long a pasted history counts as current: companies pasted more
// recently than this are left out of the Agents task so a run doesn't redo
// every account each time.
export const BFO_HISTORY_FRESH_DAYS = 30;

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  if (line.includes('|')) {
    // A markdown table row: drop the empty cells outside the edge pipes.
    let cells = line.split('|').map(c => c.trim());
    if (cells.length && cells[0] === '') cells = cells.slice(1);
    if (cells.length && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
    return cells;
  }
  return [line.trim()];
}

const isMarkdownRule = (cells) => cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c));

// Text -> { rows, error }. The first line is a header when any of its cells
// names a known column; without one, cells are read in BFO_HISTORY_COLUMNS
// order. A checkmark in Included in Reporting reads as "Yes".
export function parseBfoHistory(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
  const table = lines.map(splitLine).filter(cells => !isMarkdownRule(cells));
  if (!table.length) return { rows: [], error: 'Nothing to read: paste the tab-separated table, header first.' };

  let keys = BFO_HISTORY_COLUMNS.map(c => c.key);
  let body = table;
  const headerKeys = table[0].map(cell => {
    const n = norm(cell);
    return BFO_HISTORY_COLUMNS.find(c => c.aliases.includes(n))?.key || null;
  });
  if (headerKeys.some(Boolean)) {
    keys = headerKeys;
    body = table.slice(1);
  }
  if (!keys.includes('name')) return { rows: [], error: 'No Opportunity Name column found in the header.' };

  const rows = [];
  for (const cells of body) {
    if (cells.length < 2) continue;
    const row = {};
    keys.forEach((k, i) => { if (k) row[k] = (cells[i] ?? '').trim(); });
    if (!row.name) continue;
    if (row.reporting != null && /^(✓|✔|☑|x|true|checked)$/i.test(row.reporting)) row.reporting = 'Yes';
    if (row.status) {
      const s = norm(row.status);
      row.status = s.startsWith('open') ? 'Open' : s.startsWith('closed') ? 'Closed' : row.status;
    }
    rows.push(row);
  }
  if (!rows.length) return { rows: [], error: 'No opportunity rows found under the header.' };
  return { rows, error: '' };
}

// True when the company's BFO History was pasted within the fresh window.
export function bfoHistoryIsFresh(history, nowMs = Date.now(), days = BFO_HISTORY_FRESH_DAYS) {
  const t = Date.parse(history?.pastedAt || '');
  if (!Number.isFinite(t)) return false;
  return nowMs - t < days * 86400000;
}

// The DMs Without Activity rows -> one entry per company, with how many of
// its decision makers are on the list. [{ prospect, company, bfoCompanyName,
// dmCount, fresh, pastedAt }], sorted by company.
export function bfoHistoryTargets(entries, accountOf, nowMs = Date.now()) {
  const byId = new Map();
  for (const { contact } of entries || []) {
    const p = accountOf(contact);
    if (!p?.id) continue;
    const cur = byId.get(p.id);
    if (cur) { cur.dmCount += 1; continue; }
    byId.set(p.id, {
      prospect: p,
      company: String(p.company || '').trim(),
      // Every BFO name the company has, "; "-separated: the prompt tells
      // the agent to search each.
      bfoCompanyName: bfoCompanyNamesOf(p).join('; '),
      dmCount: 1,
      fresh: bfoHistoryIsFresh(p.bfoHistory, nowMs),
      pastedAt: p.bfoHistory?.pastedAt || '',
    });
  }
  return [...byId.values()].sort((a, b) => a.company.localeCompare(b.company));
}

// Issues tab rows for the BFO History task: every company on it with no BFO
// Company Name, which leaves it out of the prompt (the agent has nothing to
// search BFO for, so its opportunities never get pulled). `targets` is
// bfoHistoryTargets' output; the row clears once the name is filled in.
export function bfoHistoryMissingNameIssues(targets) {
  const out = [];
  for (const t of targets || []) {
    if (t.bfoCompanyName || !t.prospect?.id) continue;
    out.push({
      id: `bfo-history-no-name:${t.prospect.id}`,
      source: 'Agents',
      type: 'BFO Company Name missing',
      company: t.company || '-',
      prospectId: t.prospect.id,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'bfoCompanyName' },
      detail: `On the BFO History task (${t.dmCount} DM${t.dmCount === 1 ? '' : 's'} without activity) but has no BFO Company Name, so its BFO opps can't be pulled`,
    });
  }
  return out;
}

// Ignored rows. The popup's BFO History tab can set rows aside (an opp that
// isn't really this account's, a duplicate); they're stored as keys on the
// history, bfoHistory.ignored: [key], so they stay hidden across a new paste
// (which replaces the rows) as long as BFO still lists them the same way.
// The key is the opportunity name plus its close date: names repeat across
// years ("Renewal"), and the pair is what the Oppty 360 tab shows.
export function bfoHistoryRowKey(row) {
  return `${norm(row?.name)}|${norm(row?.closeDate)}`;
}

// The history with these row keys ignored (ignore = true) or restored
// (ignore = false). Returns a new object; rows are untouched.
export function setBfoHistoryIgnored(history, keys, ignore) {
  return setHistoryKeys(history, 'ignored', keys, ignore);
}

// Rows marked OK: checked and fine. Unlike ignored they stay on screen,
// marked as reviewed. Stored the same way, bfoHistory.ok: [key], so the
// mark survives a new paste.
export function setBfoHistoryOk(history, keys, ok) {
  return setHistoryKeys(history, 'ok', keys, ok);
}

function setHistoryKeys(history, field, keys, on) {
  const cur = new Set(history?.[field] || []);
  for (const k of keys || []) {
    if (on) cur.add(k); else cur.delete(k);
  }
  return { ...(history || {}), [field]: [...cur].sort() };
}

// What a new paste carries over from the history it replaces: the ignored
// and OK marks, which are keyed on the rows rather than stored on them.
export function bfoHistoryMarks(history) {
  const out = {};
  if (history?.ignored?.length) out.ignored = history.ignored;
  if (history?.ok?.length) out.ok = history.ok;
  return out;
}
