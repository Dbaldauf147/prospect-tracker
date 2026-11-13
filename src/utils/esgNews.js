// Prospecting > News: the ESG News Roundups and the list of things Dan wants
// left out of them.
//
// The roundup is written by a Claude scheduled task ("ESG News daily
// roundup"), not by this app: it reads the esg-news Gmail label, writes a
// Google Doc and emails it. Two things now pass between that task and the
// app, both through api/esg-news.js:
//
//   - before writing, the task GETs the filter list and leaves out any
//     story a filter matches;
//   - after sending, it POSTs the finished roundup, which the News subtab
//     shows.
//
// Both live under esgNews/ in Firestore (admin-only in the rules):
//   esgNews/settings                  { filters: [string], updatedAt }
//   esgNews/settings/roundups/{date}  { date, title, markdown, docUrl, receivedAt }
//
// Pure, so the API and the page share one set of rules
// (scripts/esgNews.test.mjs).

export const ESG_NEWS_COLLECTION = 'esgNews';
export const ESG_NEWS_SETTINGS_DOC = 'settings';
export const ESG_NEWS_ROUNDUPS = 'roundups';

export const MAX_FILTERS = 200;
export const MAX_FILTER_LENGTH = 300;
export const MAX_MARKDOWN = 200000;

// The filter list as stored: trimmed, blank and duplicate entries (ignoring
// case) dropped, each capped in length, in the order they were added.
export function normalizeFilters(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const f = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FILTER_LENGTH);
    const key = f.toLowerCase();
    if (!f || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= MAX_FILTERS) break;
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A posted roundup -> { roundup } or { error }. The date is the doc id, so a
// re-run of the same day replaces that day's entry rather than adding a
// second one.
export function normalizeRoundup(body, nowIso = new Date().toISOString()) {
  const b = body && typeof body === 'object' ? body : {};
  const date = String(b.date || '').trim();
  if (!DATE_RE.test(date)) return { error: 'date must be YYYY-MM-DD' };
  const markdown = String(b.markdown || '');
  if (!markdown.trim()) return { error: 'markdown is required' };
  if (markdown.length > MAX_MARKDOWN) return { error: `markdown is over ${MAX_MARKDOWN} characters` };
  const docUrl = String(b.docUrl || '').trim();
  return {
    roundup: {
      date,
      title: String(b.title || `ESG News Roundup - ${date}`).trim().slice(0, 300),
      markdown,
      docUrl: /^https:\/\//i.test(docUrl) ? docUrl.slice(0, 2000) : '',
      receivedAt: nowIso,
    },
  };
}

// ---- Showing a roundup ----------------------------------------------------
// The roundup arrives as Markdown written by the task. It is drawn as React
// elements from these blocks, never as HTML, so nothing in it can run on the
// page. Only what the roundup uses is understood: headings, bullets,
// numbered items, paragraphs, **bold** and [links](https://...).

// One line of text -> [{ text, bold?, href? }].
export function parseInline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const s = String(text ?? '');
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], href: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// Markdown -> [{ type: 'heading', level, text } | { type: 'list', ordered,
// items: [text] } | { type: 'para', text }].
export function parseRoundupMarkdown(md) {
  const blocks = [];
  let list = null;
  let para = null;
  const flush = () => {
    if (list) blocks.push(list);
    if (para) blocks.push(para);
    list = null;
    para = null;
  };
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (para) { blocks.push(para); para = null; }
      if (!list || list.ordered !== ordered) {
        if (list) blocks.push(list);
        list = { type: 'list', ordered, items: [] };
      }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (list) { blocks.push(list); list = null; }
    para = para ? { ...para, text: `${para.text} ${line}` } : { type: 'para', text: line };
  }
  flush();
  return blocks;
}
