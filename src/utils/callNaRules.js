// Auto-N/A rules: meeting names that never belong to an opportunity.
//
// A calendar is mostly recurrences. The same weekly 1:1, the same
// monthly office hours, the same prospecting block — Granola sits in all
// of them and writes a note for each, and every one of those notes lands
// in the triage queue asking the same question it asked last week. Over a
// quarter that is most of the queue, and all of it is the same handful of
// answers.
//
// A rule answers once. Name the meeting, and every call whose name
// matches it — the ones already stored and the ones that haven't
// happened yet — is marked N/A without being asked about again.
//
// Two things this must never do, both of which would be worse than not
// existing:
//
//   - override a decision the user made by hand. A rule is a default,
//     not an authority, so it only ever touches calls nobody has ruled
//     on. Clearing an auto-N/A is itself a decision, which is why that
//     marks the call manual and takes it out of the rules' reach.
//   - match more than the user meant. The matching below is deliberately
//     dull — case-insensitive substring on a normalised name — because
//     a rule that quietly swallows a real client call costs far more
//     than one that misses a few recurrences.
//
// Pure: no fetch, no React, no storage (scripts/callNaRules.test.mjs).

import { oppTagStateOf, autoNaPatch, OPP_TAG_NONE } from './callOppTag.js';

/** How many rules one user can have. A guard on the stored list, not a
 *  target — past this the user wants a different tool. */
export const MAX_NA_RULES = 50;

/**
 * A name reduced to what two humans would call "the same meeting".
 *
 * Calendar clients and notetakers decorate a title in ways that carry no
 * meaning: a "Canceled:" prefix, smart quotes pasted from a document, a
 * doubled space, an invisible non-breaking space from Outlook. A rule
 * typed by hand will have none of those, so a raw comparison misses the
 * very recurrences it was written for.
 */
export function normalizeMeetingName(name) {
  return String(name || '')
    .normalize('NFKD')
    // Curly quotes and dashes → their plain equivalents, so a rule typed
    // with a hyphen still matches a title Outlook em-dashed.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .toLowerCase()
    .replace(/^(canceled|cancelled|updated|fw|fwd|re|accepted|declined|tentative):\s*/g, '')
    // Everything that isn't a letter or digit becomes one space. That
    // makes "HUBSPOT HOUR [Optional]" and "Hubspot Hour (optional)" the
    // same string, which is the point.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One stored rule → its usable form, or null when there's nothing in it. */
export function normalizeRule(rule) {
  const text = typeof rule === 'string' ? rule : String(rule?.text || '');
  const trimmed = text.trim();
  if (!trimmed) return null;
  const key = normalizeMeetingName(trimmed);
  // A rule that normalises to nothing — punctuation only — would match
  // every name on earth, since "" is a substring of everything. That is
  // the one input capable of marking a user's entire history N/A, so it
  // is refused rather than stored.
  if (!key) return null;
  return { text: trimmed, key };
}

/** The stored list, cleaned: blanks dropped, duplicates collapsed, capped. */
export function normalizeRules(rules) {
  const out = [];
  const seen = new Set();
  for (const rule of (Array.isArray(rules) ? rules : [])) {
    const normalized = normalizeRule(rule);
    if (!normalized || seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    out.push(normalized);
    if (out.length >= MAX_NA_RULES) break;
  }
  return out;
}

/** Does this rule cover this meeting name? */
export function ruleMatchesName(rule, name) {
  const normalized = normalizeRule(rule);
  if (!normalized) return false;
  const target = normalizeMeetingName(name);
  if (!target) return false;
  return target.includes(normalized.key);
}

/**
 * The first rule covering this name, or null.
 *
 * First rather than best: the rule is only ever used to explain the tag,
 * and a name matching two rules is N/A either way.
 */
export function matchingRule(rules, name) {
  const target = normalizeMeetingName(name);
  if (!target) return null;
  for (const rule of normalizeRules(rules)) {
    if (target.includes(rule.key)) return rule;
  }
  return null;
}

/**
 * Which calls a rule set would newly mark N/A, and why.
 *
 * Returns [{ id, name, rule }] — only calls that are UNDECIDED and that
 * the user has never ruled on by hand. Anything already tagged, already
 * N/A, or previously decided and cleared is left exactly where it is.
 *
 * This is what the page counts before it writes anything: "37 calls
 * match" is a number worth seeing before agreeing to it.
 */
export function autoNaMatches(records, rules) {
  const active = normalizeRules(rules);
  if (active.length === 0) return [];
  const list = Array.isArray(records) ? records : Object.values(records || {});
  const matches = [];
  for (const record of list) {
    if (!record?.id) continue;
    if (record.oppTagManual) continue;
    if (oppTagStateOf(record) !== OPP_TAG_NONE) continue;
    const name = record.name || '';
    const target = normalizeMeetingName(name);
    if (!target) continue;
    const rule = active.find(r => target.includes(r.key));
    if (rule) matches.push({ id: record.id, name, rule: rule.text });
  }
  return matches;
}

/**
 * The patch for one incoming call, or null when no rule covers it.
 *
 * Used on the sync path, where the record is being written anyway — so
 * a recurrence is N/A by the time it first appears, rather than passing
 * through the queue on its way there. `existing` is what is already
 * stored under that id, if anything: a call the user has ruled on is
 * left alone even when a rule matches its name.
 */
export function autoNaPatchFor(call, rules, existing = null, now = new Date()) {
  if (existing?.oppTagManual) return null;
  if (existing && oppTagStateOf(existing) !== OPP_TAG_NONE) return null;
  const rule = matchingRule(rules, call?.name || '');
  return rule ? autoNaPatch(rule.text, now) : null;
}

/**
 * What a rule set does to a list of calls, said in one sentence.
 *
 * Counts are over the calls a rule WOULD change, so the number the page
 * shows is the number of writes the button will make.
 */
export function describeNaRules({ rules = [], matches = 0, total = 0 } = {}) {
  const active = normalizeRules(rules);
  if (active.length === 0) {
    return 'No auto-N/A rules yet. Add the name of a recurring meeting — a weekly 1:1, office hours, a prospecting block — and calls with that name are marked N/A as they arrive.';
  }
  const ruleCount = `${active.length} rule${active.length === 1 ? '' : 's'}`;
  if (matches === 0) {
    return total > 0
      ? `${ruleCount}, and every stored call they cover is already dealt with. New calls matching them are marked N/A as they sync.`
      : `${ruleCount}. New calls matching them are marked N/A as they sync.`;
  }
  return `${ruleCount} covering ${matches} untagged call${matches === 1 ? '' : 's'}.`;
}
