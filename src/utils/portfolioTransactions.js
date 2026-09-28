// The acquisitions and dispositions logged against a company on the
// Portfolio tab's second page. Each one is a row somebody typed in, or
// pasted out of the weekly Company Acquisition News digest
// (api/_lib/companyNews.js), and it lives on the prospect record as
// `portfolioTransactions` so it autosaves with the rest of the card.

export const TRANSACTION_KINDS = ['Acquisition', 'Disposition'];

// What sort of deal it was. The acquisition list is the digest's own
// (DEAL_TYPES in companyNews.js) so a pasted deal keeps the label the email
// gave it; the disposition list is the other side of the same trades.
export const DEAL_TYPES_BY_KIND = {
  Acquisition: ['Platform', 'Add-on', 'Take-private', 'Asset purchase', 'Acquisition'],
  Disposition: ['Divestiture', 'Asset sale', 'Exit', 'Carve-out', 'Spin-off'],
};

const ALL_DEAL_TYPES = [...DEAL_TYPES_BY_KIND.Acquisition, ...DEAL_TYPES_BY_KIND.Disposition];

function newId() {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function blankTransaction(kind = 'Acquisition', patch = {}) {
  return {
    id: newId(),
    kind: TRANSACTION_KINDS.includes(kind) ? kind : 'Acquisition',
    date: todayIso(),
    asset: '',
    // Which of this company's vehicles did the deal (a fund, a portfolio
    // company making an add-on); blank means the company itself.
    entity: '',
    // The other side: the seller on an acquisition, the buyer on a
    // disposition.
    counterparty: '',
    dealType: '',
    sector: '',
    value: '',
    sites: '',
    sourceTitle: '',
    sourceUrl: '',
    notes: '',
    loggedAt: Date.now(),
    ...patch,
  };
}

// Newest first; an undated row sinks to the bottom rather than the top, since
// "no date" is the least useful thing to lead with.
export function sortTransactions(rows) {
  return [...(rows || [])].sort((a, b) => {
    const da = String(a?.date || '');
    const db = String(b?.date || '');
    if (da === db) return (Number(b?.loggedAt) || 0) - (Number(a?.loggedAt) || 0);
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });
}

// Counts for the header line: everything logged, and the last twelve months,
// which is the window people ask about ("have they been buying lately?").
export function summarizeTransactions(rows, now = Date.now()) {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  const cutoffIso = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
  const out = { acquisitions: 0, dispositions: 0, recentAcquisitions: 0, recentDispositions: 0 };
  for (const r of rows || []) {
    const recent = !!r?.date && String(r.date) >= cutoffIso;
    if (r?.kind === 'Disposition') {
      out.dispositions += 1;
      if (recent) out.recentDispositions += 1;
    } else {
      out.acquisitions += 1;
      if (recent) out.recentAcquisitions += 1;
    }
  }
  return out;
}

const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/;
const ARROW = /\s*→\s*$/;

// "Add-on · Industrial Services · $450M · 12 sites" back into its parts.
// The digest writes those four in that order but drops any it doesn't have,
// so each piece is recognised by its shape rather than its position.
function parseMeta(line) {
  const out = {};
  for (const raw of line.split('·')) {
    const part = raw.trim();
    if (!part) continue;
    if (!out.dealType && ALL_DEAL_TYPES.includes(part)) out.dealType = part;
    else if (!out.sites && /\bsites?$/i.test(part)) out.sites = part.replace(/\s*sites?$/i, '').trim();
    else if (!out.value && /^[$€£]|\d\s*(m|mm|bn|b|million|billion)\b/i.test(part)) out.value = part;
    else if (!out.sector) out.sector = part;
  }
  return out;
}

function looksLikeMeta(line) {
  if (line.includes('·')) return true;
  return ALL_DEAL_TYPES.includes(line.trim());
}

// Read deals out of text copied from the digest email. Each deal in the email
// is a date cell followed by the target, a meta line, "Buyer: ...", a
// one-sentence summary and a source link ending in an arrow - any of the
// middle three may be missing. Everything between one deal's source link and
// the next date (company headings, the email's header and footer) is skipped.
//
// `links` is the anchors from the clipboard's HTML, when the paste carried
// any, as [{ text, href }]: plain text loses the URL, so a source line is
// matched back to its link by its text.
export function parseDigestText(text, links = []) {
  const tokens = String(text || '')
    .split(/[\r\n\t]+/)
    .map((s) => s.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);

  const linkFor = (title) => {
    const want = title.replace(ARROW, '').trim().toLowerCase();
    const hit = (links || []).find((l) => String(l?.text || '').replace(ARROW, '').trim().toLowerCase() === want);
    return hit && /^https?:\/\//i.test(String(hit.href || '')) ? String(hit.href) : '';
  };

  const deals = [];
  let cur = null;
  let closed = true;
  for (const tok of tokens) {
    if (DATE_LINE.test(tok)) {
      cur = { date: tok };
      deals.push(cur);
      closed = false;
      continue;
    }
    if (!cur || closed) continue;
    if (!cur.asset) {
      // The email tags each deal BOUGHT or SOLD ahead of its name, and a
      // copy runs the tag into the name ("SOLDAcme Services").
      const tag = tok.match(/^(BOUGHT|SOLD)\s*(.*)$/);
      if (tag) {
        cur.kind = tag[1] === 'SOLD' ? 'Disposition' : 'Acquisition';
        if (tag[2]) cur.asset = tag[2];
        continue;
      }
      cur.asset = tok;
      continue;
    }
    // Our side of the deal: "Buyer" on an acquisition, "Seller" on a sale.
    if (/^(buyer|seller):/i.test(tok)) { cur.buyer = tok.replace(/^(buyer|seller):\s*/i, ''); continue; }
    // The other side.
    if (/^(sold to|bought from):/i.test(tok)) { cur.counterparty = tok.replace(/^(sold to|bought from):\s*/i, ''); continue; }
    if (ARROW.test(tok)) {
      cur.sourceTitle = tok.replace(ARROW, '').trim();
      cur.sourceUrl = linkFor(tok);
      closed = true;
      continue;
    }
    if (!cur.metaSeen && !cur.notes && looksLikeMeta(tok)) {
      Object.assign(cur, parseMeta(tok));
      cur.metaSeen = true;
      continue;
    }
    cur.notes = cur.notes ? `${cur.notes} ${tok}` : tok;
  }

  return deals
    .filter((d) => d.asset)
    .map((d) => ({
      kind: d.kind || 'Acquisition',
      date: d.date,
      asset: d.asset,
      counterparty: d.counterparty || '',
      // The digest's "Buyer" is the entity on our side of the deal - the
      // company itself, or the portfolio company that made an add-on.
      entity: d.buyer || '',
      dealType: d.dealType || '',
      sector: d.sector || '',
      value: d.value || '',
      sites: d.sites || '',
      sourceTitle: d.sourceTitle || '',
      sourceUrl: d.sourceUrl || '',
      notes: d.notes || '',
    }));
}

// A pasted deal that is already on the log (same asset, same date) is not
// added twice - the digest can carry the same deal in consecutive weeks.
export function transactionKey(r) {
  return `${String(r?.asset || '').trim().toLowerCase()}|${String(r?.date || '')}`;
}
