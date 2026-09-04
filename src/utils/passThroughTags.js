// Tagging Line Items as pass-through, rather than answering yes/no on every
// one of them.
//
// Pass-through is a property of a (Line Item, Type) pair: tag one and every
// matching CTS row on every option bills at face cost, no markup, excluded
// from Deal margin. The mapping itself is a flat map of pair key → true, and
// that hasn't changed — what changed is how a pair gets into it. Enumerating
// every pair in the workbook with a Yes/No beside it puts the two or three
// pass-through pairs in a list of eighty, and the answer for the other
// seventy-seven was never in question.
//
// So: the pairs a workbook offers are a suggestion list, and the mapping shows
// only what has actually been tagged.
//
// The fiddly part is turning what someone typed into a pair key, because a
// Line Item alone often isn't one. "Commercial Client Management NAM" exists as
// both a Setup and a Recurring cost, and those are separately billable — the
// Setup half being marked up while the Recurring half passes through is a
// normal thing to want. A name carrying one type resolves on its own; a name
// carrying two has to be asked about rather than guessed at, because guessing
// wrong writes a mapping that silently reprices the other half.
//
// Lives outside PricingView.jsx so that resolution can be asserted directly —
// see scripts/passThroughTags.test.mjs.

// Pair key. MUST match linkedToDefaultKey in PricingView.jsx — the same map is
// read by the Pricing table's isPassThrough, and a key built differently here
// would tag a pair the table never looks up.
export function passThroughPairKey(lineItem, type) {
  return `${(lineItem || '').trim().toLowerCase()}::${(type || '').trim().toLowerCase()}`;
}

// How a pair reads in the picker and in the tagged list. The separator is
// what splitPairLabel below looks for, so it has to be something a Line Item
// name won't contain.
export const PAIR_LABEL_SEP = ' · ';

export function pairLabel(lineItem, type) {
  const item = String(lineItem || '').trim();
  const t = String(type || '').trim();
  return t ? `${item}${PAIR_LABEL_SEP}${t}` : item;
}

// Same label, safe to put in a sentence. The Type column occasionally holds a
// whole paragraph of fee prose that the parser had nowhere else to put; a
// confirmation message that repeats all of it buries what it is confirming.
// The table clamps its own cells in CSS — this is for running text.
export function pairLabelShort(lineItem, type, max = 44) {
  const t = String(type || '').trim();
  const clipped = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  return pairLabel(lineItem, clipped);
}

// Every (Line Item, Type) pair the loaded workbook offers, plus any pair
// already tagged. A tagged pair whose workbook has since been replaced still
// needs a row — otherwise the mapping is invisible and can't be undone.
//
// `activeOptionNumber` picks which option's CTS is summed for display; a pair
// appearing twice in one option sums, which is what the Pricing table charges.
export function collectPassThroughPairs({ options = [], tagged = {}, activeOptionNumber, typeOf } = {}) {
  const type = typeof typeOf === 'function' ? typeOf : (item) => item?.type || '';
  const byKey = new Map();

  for (const opt of options) {
    for (const section of opt?.sections || []) {
      for (const item of section?.items || []) {
        const t = type(item);
        const key = passThroughPairKey(item?.description, t);
        let row = byKey.get(key);
        if (!row) {
          row = {
            key,
            lineItem: item?.description || '',
            type: t,
            options: [],
            activeCts: null,
            reachable: true,
          };
          byKey.set(key, row);
        }
        if (opt?.sheetName && !row.options.includes(opt.sheetName)) row.options.push(opt.sheetName);
        if (opt?.optionNumber === activeOptionNumber && typeof item?.cts === 'number') {
          row.activeCts = (row.activeCts || 0) + item.cts;
        }
      }
    }
  }

  for (const [key, on] of Object.entries(tagged || {})) {
    if (!on || byKey.has(key)) continue;
    const [keyItem, keyType] = String(key).split('::');
    byKey.set(key, {
      key,
      lineItem: keyItem || '',
      type: keyType || '',
      options: [],
      activeCts: null,
      reachable: false,
    });
  }

  const rows = [...byKey.values()].sort((a, b) =>
    (a.lineItem || '').localeCompare(b.lineItem || '')
    || (a.type || '').localeCompare(b.type || ''));

  return {
    all: rows,
    tagged: rows.filter(r => tagged?.[r.key] === true),
    untagged: rows.filter(r => tagged?.[r.key] !== true),
  };
}

// Split a picker entry back into its halves. Only the label form this module
// produces is recognised — anything else is treated as a bare Line Item name,
// so a name that happens to contain the separator still resolves through the
// normal name lookup below rather than being cut in half.
export function splitPairLabel(text, pairs = []) {
  const s = String(text || '').trim();
  const idx = s.lastIndexOf(PAIR_LABEL_SEP);
  if (idx < 0) return null;
  const lineItem = s.slice(0, idx).trim();
  const type = s.slice(idx + PAIR_LABEL_SEP.length).trim();
  const key = passThroughPairKey(lineItem, type);
  return pairs.some(p => p.key === key) ? { lineItem, type, key } : null;
}

/**
 * Turn what the user typed into the pair to tag.
 *
 * @param {object} input
 * @param {string} input.text   Line Item name, or a "Line Item · Type" label
 *                              picked out of the suggestion list.
 * @param {string} input.type   Type chosen alongside it, if any.
 * @param {Array}  input.pairs  Known pairs (from collectPassThroughPairs().all).
 * @param {object} input.tagged The current mapping, to catch re-tagging.
 * @returns {{ok: true, key, lineItem, type, known}|{ok: false, error, lineItem?, types?}}
 *
 * error is one of:
 *   empty          nothing typed
 *   need-type      free-text name the workbook doesn't know, and no Type picked
 *   ambiguous      the name carries several types and none was picked
 *   already-tagged that pair is already in the mapping
 */
export function resolvePassThroughDraft({ text, type, pairs = [], tagged = {} } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty' };

  const chosenType = String(type || '').trim();
  const done = (lineItem, t, known) => {
    const key = passThroughPairKey(lineItem, t);
    if (tagged?.[key] === true) return { ok: false, error: 'already-tagged', lineItem, type: t, key };
    return { ok: true, key, lineItem, type: t, known };
  };

  // Picked straight out of the suggestion list: the label carries its own
  // type, and it wins over whatever the Type box happens to be showing.
  const fromLabel = splitPairLabel(raw, pairs);
  if (fromLabel) return done(fromLabel.lineItem, fromLabel.type, true);

  // Typed a bare name. What types does the workbook have under it?
  const lower = raw.toLowerCase();
  const matches = pairs.filter(p => String(p.lineItem || '').trim().toLowerCase() === lower);

  if (chosenType) {
    const exact = matches.find(p => String(p.type || '').trim().toLowerCase() === chosenType.toLowerCase());
    // Use the workbook's own spelling of both halves when it has this pair —
    // the key lowercases anyway, but the label the user then sees should be
    // the one the Pricing table shows.
    if (exact) return done(exact.lineItem, exact.type, true);
    return done(raw, chosenType, matches.length > 0);
  }

  if (matches.length === 1) return done(matches[0].lineItem, matches[0].type, true);
  if (matches.length > 1) {
    return {
      ok: false,
      error: 'ambiguous',
      lineItem: matches[0].lineItem,
      types: matches.map(m => m.type),
    };
  }
  return { ok: false, error: 'need-type', lineItem: raw };
}

// What the picker offers: the untagged pairs, each shown in the shortest form
// that still resolves to one pair. A Line Item the workbook carries under a
// single Type is offered by name alone; only a name carrying several needs the
// "· Type" half to say which one.
//
// This is not only tidiness. The parser sometimes lands a whole paragraph of
// fee prose in the Type column — a suggestion list of those is unreadable, and
// the name on its own is what the user was going to type anyway.
//
// Ambiguity is judged against every known pair, tagged ones included: tagging
// the Setup half of a name does not make its Recurring half offerable by name,
// because the name still resolves to two things.
export function pickerSuggestions(pairs = [], tagged = {}) {
  const countByName = new Map();
  for (const p of pairs) {
    const name = String(p?.lineItem || '').trim().toLowerCase();
    countByName.set(name, (countByName.get(name) || 0) + 1);
  }
  return pairs
    .filter(p => tagged?.[p.key] !== true)
    .map(p => {
      const name = String(p.lineItem || '').trim();
      const alone = countByName.get(name.toLowerCase()) === 1;
      return {
        key: p.key,
        lineItem: p.lineItem,
        type: p.type,
        value: alone ? name : pairLabel(p.lineItem, p.type),
      };
    });
}

// Distinct Types across the known pairs, for the Type dropdown. Sorted, blanks
// dropped. The parser sometimes lands prose in the Type column (a fee
// description that spilled), so these are whatever the workbook actually has
// rather than a fixed three.
export function pairTypes(pairs = []) {
  const seen = new Map();
  for (const p of pairs) {
    const t = String(p?.type || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
