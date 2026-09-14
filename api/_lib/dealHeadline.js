// Reading an acquisition out of a news headline, with rules and no model.
//
// This exists because the digest's one remaining cost was a Claude call per
// company to answer a question a headline mostly answers itself. News
// headlines are written to one shape almost without exception —
// BUYER VERB TARGET, "Blackstone to acquire Acme Facilities" — so which
// side of the verb the tracked firm sits on is what decides whether it
// bought something or was bought. That is a rule, not a judgement.
//
// The design choice that makes rules safe here is the third answer. Every
// headline comes back as one of:
//
//   - a deal, when a verb matched and the firm was on the buying side;
//   - skipped, when something disqualified it (a fund close, a rumour, the
//     firm selling) — these are never shown;
//   - unsure, when the words are about a deal but the shape is not one of
//     the ones read confidently.
//
// Unsure headlines are listed in the email under the firm rather than
// dropped. A rules pass will always miss shapes a model would catch; what
// it must not do is swallow them silently, and a one-line headline with a
// link costs the reader two seconds to dismiss. Precision over recall in
// what it *claims*, and nothing thrown away.

// Google News appends " - Publisher" to every title. It has to come off
// before any position test, or the publisher's name lands in the target.
export function stripPublisher(title) {
  return String(title || '')
    .replace(/\s+[-–—]\s+[^-–—]{2,40}$/, '') // em-dash-ok: parses headlines
    .replace(/\s+/g, ' ')
    .trim();
}

// Never an acquisition by this firm, whatever else the headline says.
// Checked first and on the whole line, because each of these makes the
// rest of the sentence mean something other than what it looks like.
const DISQUALIFIERS = [
  // Raising money is not spending it — and "closes $20bn fund" otherwise
  // reads as a completed deal to a verb-and-position rule.
  [/\b(fund|vehicle|continuation fund)\b[^.]*\b(close[sd]?|closing|raise[sd]?|raising|target(s|ed)?)\b/i, 'fund raise'],
  [/\b(raise[sd]?|raising|closes?|closed)\b[^.]*\$[\d.,]+\s*(b|bn|billion|m|mm|million)\b[^.]*\bfund\b/i, 'fund raise'],
  [/\bdry powder\b/i, 'fund raise'],
  // Unconfirmed. A digest that reports talks as deals is worse than one
  // that reports nothing.
  [/\b(explore[sd]?|exploring|weigh[s|ed]*|weighing|mull[s|ed]*|mulling|consider(s|ing|ed)?|in talks|near(s|ing)?\b|reportedly|rumou?r|could|might|may|said to be|eyeing|eyes)\b/i, 'unconfirmed'],
  // The firm on the exit side.
  [/\b(divest(s|ed|ing|ment)?|offload(s|ed|ing)?|exit(s|ed|ing)?)\b/i, 'exit'],
  [/\b(ipo|initial public offering|go(es)? public|spin[- ]?off)\b/i, 'not an acquisition'],
  [/\b(earnings|results|revenue|profit|loss|appoint(s|ed|ment)?|name[sd]?\b[^.]*\b(ceo|cfo|coo|chair|partner|head)\b|hire[sd]?|promote[sd]?|step(s|ped)? down|lawsuit|sue[sd]?|settle[sd]?|fine[sd]?|probe|investigation)\b/i, 'not an acquisition'],
  // A minority position is explicitly out of scope for this digest.
  [/\b(minority|non[- ]control(ling)?|passive)\b/i, 'minority'],
  [/\b(series [a-f]|venture round|seed round|funding round|led a \$)\b/i, 'venture round'],
];

// The firm sits to the LEFT of these and is the buyer.
const BUY_FORWARD = [
  /\b(?:to\s+)?acquires?\b/i,
  // Active past tense — "Blackstone acquired Acme". BUY_REVERSE is tested
  // first, so "acquired by" is already resolved the other way round before
  // this can see it.
  /\bacquired\b/i,
  /\b(?:announces?|completes?|closes?)\s+(?:the\s+)?acquisitions?\s+of\b/i,
  /\bacquisitions?\s+of\b/i,
  /\bcompletes?\s+(?:the\s+)?acquisition\s+of\b/i,
  /\bagree[sd]?\s+to\s+(?:acquire|buy|purchase)\b/i,
  /\b(?:to\s+)?buys?\b/i,
  /\bbought\b/i,
  /\b(?:to\s+)?purchases?\b/i,
  /\bsnaps?\s+up\b/i,
  /\btakes?\s+(?:majority|controlling)\s+(?:stake|interest|position)\s+in\b/i,
  /\bto\s+take\b/i,
  /\brecapitalize[sd]?\b/i,
  /\badds?\b/i,
  /\binvests?\s+in\b/i,
  /\binvestment\s+in\b/i,
  /\bbacks?\b/i,
];

// The firm sits to the RIGHT of these and is the buyer.
const BUY_REVERSE = [
  /\b(?:to\s+be\s+)?acquired\s+by\b/i,
  /\bbought\s+by\b/i,
  /\bsnapped\s+up\s+by\b/i,
  /\bpurchased\s+by\b/i,
  /\bsold\s+to\b/i,
  /\bsells?\b[^,]*\bto\b/i,
];

// The firm sits to the LEFT of these and is SELLING — its own exit, not a
// purchase. Checked before the forward verbs, because "sells X to Y" also
// contains a reverse verb and the seller must not be credited with a buy.
const SELL_FORWARD = [
  /\b(?:to\s+)?sells?\b/i,
  /\bsold\b/i,
  /\bagree[sd]?\s+to\s+sell\b/i,
];

// Shapes read with enough confidence to print as a deal. Everything else
// that still smells like a deal falls through to "unsure".
const CONFIDENT_FORWARD = [
  /\b(?:to\s+)?acquires?\b/i,
  /\bacquired\b/i,
  /\bto\s+take\b/i,
  // How a press release says it. A firm's own newsroom is the earliest and
  // most reliable account of its deals, and it almost never uses the verb
  // — "Announces Acquisition of", "Completes Acquisition of".
  /\b(?:announces?|completes?|closes?)\s+(?:the\s+)?acquisitions?\s+of\b/i,
  /\bacquisitions?\s+of\b/i,
  /\bcompletes?\s+(?:the\s+)?acquisition\s+of\b/i,
  /\bagree[sd]?\s+to\s+(?:acquire|buy|purchase)\b/i,
  /\b(?:to\s+)?buys?\b/i,
  /\bbought\b/i,
  /\bsnaps?\s+up\b/i,
  /\btakes?\s+(?:majority|controlling)\s+(?:stake|interest|position)\s+in\b/i,
];

const DEAL_WORDS = /\b(acquir|acquisition|buy|bought|purchas|takeover|take-private|merge|bolt-?on|add-?on|stake|deal|invest|back|sell|sold|sale|snap)/i;

function firstMatch(patterns, text) {
  let best = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length, verb: m[0] };
  }
  return best;
}

// Does this side of the verb name the tracked firm? Reuses the same
// variants the feed query was built from, so "CD&R" counts as the firm
// wherever the headline writes it that way.
function namesFirm(side, variants) {
  const hay = side.toLowerCase();
  return variants.some((v) => {
    const needle = String(v).toLowerCase().trim();
    if (!needle) return false;
    if (hay.includes(needle)) return true;
    // A firm's distinctive words, so "Clayton, Dubilier & Rice" still
    // matches "Clayton Dubilier and Rice". Generic words are excluded in
    // newsFeeds.mentionsCompany for the same reason and by the same list.
    const words = needle.split(/[^a-z0-9]+/).filter(w => w.length > 4 && !GENERIC.has(w));
    return words.length > 0 && words.every(w => hay.includes(w));
  });
}

const GENERIC = new Set([
  'capital', 'partners', 'group', 'global', 'management', 'holdings',
  'investments', 'equity', 'private', 'infrastructure', 'company',
]);

// A deal value, when the headline states one. Outlets write the same
// number half a dozen ways ($3bn, $3 billion, $450M, €1.2 bn); the email
// shows one.
function dealValue(text) {
  const m = text.match(/([$€£])\s?([\d][\d.,]*)\s*(billion|bn|b|million|mm|m|k)?\b/i);
  if (!m) return '';
  const [, sym, num, unitRaw] = m;
  const u = String(unitRaw || '').toLowerCase();
  const unit = /^(billion|bn|b)$/.test(u) ? 'B' : /^(million|mm|m)$/.test(u) ? 'M' : /^k$/.test(u) ? 'K' : '';
  return `${sym}${num.replace(/,$/, '')}${unit}`;
}

// What kind of deal, from the words that mark one.
function dealTypeFor(text, firmIsDirectBuyer, isPe) {
  if (/\b(take[s]?\s+.*\bprivate\b|take-private|go-private)\b/i.test(text)) return 'Take-private';
  if (/\b(-backed|\bbacked\b|portfolio company|platform company)\b/i.test(text)) return 'Add-on';
  // Explicit asset language only. Matching on words that appear in company
  // names ("Acme Facilities Services") labelled every operating business a
  // pile of assets.
  if (/\b(?:the\s+)?assets\s+of\b|\basset\s+portfolio\b|\bportfolio\s+of\s+\d|\b\d+\s+(?:plants?|facilities|sites)\b/i.test(text)) return 'Asset purchase';
  if (isPe && firmIsDirectBuyer) return 'Platform';
  return 'Acquisition';
}

// Where a party's name stops and the rest of the sentence starts. Without
// these the target of "acquires Acme Facilities for $450M" is recorded as
// a company called "Acme Facilities for $450M".
const TAIL_BOUNDARIES = [
  /\s+for\s+[$€£]/i,
  /\s+in\s+(?:a\s+)?[$€£]/i,
  /\s+at\s+[$€£]/i,
  /\s+in\s+(?:a|an|the)\s+[^,]*\bdeal\b/i,
  /\s+in\s+[$€£][^,]*\bdeal\b/i,
  /\s+from\s+/i,          // "acquires X from Y" — X is the target
  /\s+to\s+(?:expand|create|form|boost|strengthen|add)\b/i,
  /\s+as\s+it\s+/i,
  /\s+amid\s+/i,
  /\s*[,:;]\s+(?:the|a|an|which|adding|expanding|marking)\b/i,
  /\s+—\s+/, // em-dash-ok: parses headlines
];

function cutTail(s) {
  let out = String(s || '');
  let cut = out.length;
  for (const re of TAIL_BOUNDARIES) {
    const m = out.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return out.slice(0, cut);
}

// Trim a side of the verb down to the party it names.
function cleanParty(s) {
  return cutTail(s)
    // "to take X private" leaves the adjective hanging off the target.
    .replace(/\s+private\s*$/i, '')
    // Leading date/section junk some outlets prefix.
    .replace(/^(exclusive|breaking|update\s*\d*|deal news)\s*[:|-]\s*/i, '')
    .replace(/^[\s,:;–—-]+|[\s,:;.–—-]+$/g, '') // em-dash-ok: parses headlines
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Read one feed item as an acquisition by `entry.company`.
 *
 * Returns one of:
 *   { deal }            — confident enough to print
 *   { skip: 'reason' }  — disqualified, never shown
 *   { unsure: true }    — deal-shaped but not a shape we read; listed as a
 *                         headline under the firm so it isn't lost
 */
export function classifyHeadline(item, entry, variants) {
  const title = stripPublisher(item?.title);
  if (!title) return { skip: 'no title' };

  for (const [re, reason] of DISQUALIFIERS) {
    if (re.test(title)) return { skip: reason };
  }
  if (!DEAL_WORDS.test(title)) return { skip: 'not deal news' };

  // A sale names three parties — "Apollo sells Gamma Logistics to
  // Blackstone" — and splitting it on one verb gets it wrong in the worst
  // way available: the span "sells … to" puts the SELLER on the left, so a
  // two-sided read records Apollo as the thing Blackstone bought. Pull the
  // three apart explicitly before any other shape is tried.
  const sale = title.match(/^(.*?)\s+(?:has\s+|have\s+)?(?:agreed\s+to\s+|to\s+)?(?:sells?|sold)\s+(.+?)\s+to\s+(.+)$/i);
  if (sale) {
    const [, seller, asset, buyer] = sale;
    if (namesFirm(buyer, variants)) {
      return {
        deal: {
          target: cleanParty(asset),
          buyer: cleanParty(buyer) || entry.company,
          dealType: dealTypeFor(title, true, entry.isPe),
          value: dealValue(title),
          summary: title,
        },
      };
    }
    // The firm is the seller, or the thing being sold. Neither is a
    // purchase by it.
    if (namesFirm(seller, variants)) return { skip: 'the firm is selling' };
    if (namesFirm(asset, variants)) return { skip: 'the firm is the target' };
    return { skip: 'a sale between other parties' };
  }

  // Any other selling shape with the firm on the left is its own exit.
  const sell = firstMatch(SELL_FORWARD, title);
  if (sell && namesFirm(title.slice(0, sell.index), variants)) {
    return { skip: 'the firm is selling' };
  }

  const reverse = firstMatch(BUY_REVERSE, title);
  if (reverse) {
    const right = title.slice(reverse.index + reverse.length);
    const left = title.slice(0, reverse.index);
    if (namesFirm(right, variants)) {
      return {
        deal: {
          target: cleanParty(left),
          buyer: cleanParty(right) || entry.company,
          dealType: dealTypeFor(title, true, entry.isPe),
          value: dealValue(title),
          summary: title,
        },
      };
    }
    // The firm is on the left of "acquired by" — it is the one being
    // bought, which is the opposite of what this digest reports.
    if (namesFirm(left, variants)) return { skip: 'the firm is the target' };
  }

  const fwd = firstMatch(BUY_FORWARD, title);
  if (fwd) {
    const left = title.slice(0, fwd.index);
    const right = title.slice(fwd.index + fwd.length);
    if (namesFirm(left, variants)) {
      // Only the verbs whose object is unambiguously the thing bought get
      // printed as a deal. "backs", "invests in", "adds" are real signals
      // but too loose to assert an acquisition from, so they go to the
      // reader as headlines instead.
      const confident = CONFIDENT_FORWARD.some(re => re.test(fwd.verb));
      if (!confident) return { unsure: true };
      const target = cleanParty(right);
      if (!target) return { unsure: true };
      // "CD&R-backed Foo Corp acquires Bar" — the buyer of record is the
      // portfolio company, and the left side names both.
      const sponsorOnly = /-backed\b|\bbacked\b|portfolio company/i.test(left);
      return {
        deal: {
          target,
          buyer: cleanParty(left),
          dealType: sponsorOnly ? 'Add-on' : dealTypeFor(title, true, entry.isPe),
          value: dealValue(title),
          summary: title,
        },
      };
    }
    if (namesFirm(right, variants)) return { skip: 'the firm is the target' };
  }

  // Deal words, but no shape this reads. Only worth showing the reader if
  // the headline is about this firm at all — the per-company feeds only
  // ever returned its own stories, but a newsletter is one body of text
  // offered to every tracked firm in the list, and without this every
  // firm's "also in the news" fills up with every other firm's deals.
  if (!namesFirm(title, variants)) return { skip: 'not about this firm' };
  return { unsure: true };
}

export const __testing = { DISQUALIFIERS, BUY_FORWARD, BUY_REVERSE, SELL_FORWARD, dealValue, dealTypeFor };
