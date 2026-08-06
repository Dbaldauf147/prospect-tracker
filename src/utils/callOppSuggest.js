// Which opportunity is this call probably about?
//
// A call arrives from Granola with a title someone typed into a calendar
// invite — "New Client Connect - Ettinger Engineering", "MassMutual /
// Schneider intro" — and a list of who was on it. The opps table has
// account names, notes, and the contacts they are with. Nobody wants to
// read one against the other 40 times, so this scores every opp against
// one call and hands back the few worth looking at.
//
// Suggestions only. Nothing here tags anything: every match is offered to
// the user with the reason it was found, because the failure mode of
// auto-tagging a call onto the wrong deal is a summary pushed into
// somebody else's opportunity.
//
// Pure: a call and a list of opps in, ranked candidates out.

// Extension included so this resolves under plain Node for the tests.
import { normalizeCompanyKey, brandFromDomain, FREE_MAIL_DOMAINS } from './companyGuess.js';

// Words that appear in meeting titles and say nothing about which deal it
// is. Stripped before the call's name is read for company-ish tokens,
// otherwise "Weekly Sync" matches an opp whose notes mention a weekly
// sync and the real signal is buried under noise.
const MEETING_WORDS = new Set([
  'call', 'calls', 'meeting', 'meet', 'sync', 'weekly', 'monthly', 'quarterly', 'biweekly',
  'intro', 'introduction', 'introductory', 'connect', 'kickoff', 'kick', 'off', 'demo',
  'discovery', 'check', 'checkin', 'catch', 'catchup', 'review', 'touch', 'base', 'touchbase',
  'follow', 'followup', 'chat', 'discussion', 'discuss', 'session', 'brainstorm', 'workshop',
  'update', 'updates', 'status', 'debrief', 'recap', 'prep', 'planning', 'agenda',
  'new', 'client', 'clients', 'customer', 'prospect', 'account', 'opportunity', 'opp', 'deal', 'deals',
  'zoom', 'teams', 'google', 'hangout', 'webex', 'granola', 'note', 'notes', 'untitled', 'recording',
  'and', 'with', 'the', 'for', 'from', 'via', 'plus', 'amp',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'am', 'pm', 'est', 'cst', 'mst', 'pst', 'edt', 'cdt', 'mdt', 'pdt',
  'energy', 'sustainability', 'schneider', 'electric', 'exchange',
]);

// A token has to be this long before it is allowed to match on its own.
// Short ones ("cs", "gp", "abc") collide across a book of business.
const MIN_TOKEN = 4;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

/**
 * What a call says about who it was with.
 *
 *   { company, nameKey, tokens, brands }
 *
 * `tokens` are the distinctive words in the call's title — meeting
 * furniture removed — and `brands` are company names implied by the email
 * domains of the people on it, which is the signal that survives a title
 * like "Intro call" with nothing in it at all.
 */
export function callSignals(call) {
  const company = textOf(call?.company);
  const nameKey = normalizeCompanyKey(call?.name);
  const tokens = nameKey.split(' ')
    .filter(t => t.length >= MIN_TOKEN && !MEETING_WORDS.has(t) && !/^\d+$/.test(t));

  const ownDomain = domainOf(call?.owner?.email);
  const brands = new Set();
  for (const person of (Array.isArray(call?.attendees) ? call.attendees : [])) {
    const domain = domainOf(person?.email);
    if (!domain || domain === ownDomain || FREE_MAIL_DOMAINS.has(domain)) continue;
    const key = normalizeCompanyKey(brandFromDomain(domain));
    if (key) brands.add(key);
  }
  return { company, nameKey, tokens, brands: [...brands] };
}

// The opp's own text, read once per opp rather than once per call.
function oppSignals(opp) {
  const account = textOf(opp?.['Account']);
  const accountKey = normalizeCompanyKey(account);
  const bfoKey = normalizeCompanyKey(opp?.['BFO Company Name']);
  // "Notes" is the older memo field; "Next Steps" is the rich per-step
  // one the header calls Notes. Both are where a company gets mentioned
  // in passing ("their parent, MassMutual, signs off"), which is exactly
  // the match this is for.
  const notesKey = normalizeCompanyKey(
    [opp?.['Notes'], opp?.['Next Steps'], opp?.['Waiting On']].filter(Boolean).join(' '),
  );
  return {
    account,
    accountKey,
    accountTokens: new Set(accountKey.split(' ').filter(t => t.length >= MIN_TOKEN)),
    bfoKey,
    notesKey,
  };
}

// Does `key` appear in `haystack` as whole words? Both are already
// normalized to single-spaced lowercase, so padding makes the boundary
// check a substring test — "mass" must not match "massmutual".
function containsPhrase(haystack, key) {
  if (!haystack || !key) return false;
  return ` ${haystack} `.includes(` ${key} `);
}

/**
 * Rank the opps that might be this call's, best first.
 *
 * Each candidate is `{ opp, score, reasons }` — reasons are the phrases
 * the UI shows so the user can tell a real match from a coincidence
 * without opening the opp. Anything below `minScore` is left out
 * entirely: a bad suggestion costs more than no suggestion, because it
 * invites a mis-tag with one click.
 */
export function suggestOppsForCall(call, opps, { limit = 4, minScore = 40 } = {}) {
  const signals = callSignals(call);
  const companyKey = normalizeCompanyKey(signals.company);
  const list = Array.isArray(opps) ? opps : [];
  if (!companyKey && !signals.nameKey && signals.brands.length === 0) return [];

  const scored = [];
  for (const opp of list) {
    if (!opp || !opp._id) continue;
    const o = oppSignals(opp);
    if (!o.accountKey && !o.notesKey) continue;

    let score = 0;
    const reasons = [];

    // The call is already linked to a company. Any opp on that account is
    // almost certainly the answer, and this is the common case: the sync
    // matched the company from the attendees and stopped there.
    if (companyKey && (companyKey === o.accountKey || companyKey === o.bfoKey)) {
      score = Math.max(score, 100);
      reasons.push(`same account as the call’s company (${signals.company})`);
    }

    // The account name, whole, inside the call's title.
    if (o.accountKey && containsPhrase(signals.nameKey, o.accountKey)) {
      score = Math.max(score, 90);
      reasons.push(`“${o.account}” is in the call title`);
    }

    // An attendee's email domain resolves to the account.
    for (const brand of signals.brands) {
      if (!brand) continue;
      if (brand === o.accountKey || containsPhrase(o.accountKey, brand)) {
        score = Math.max(score, 85);
        reasons.push('an attendee’s email domain matches the account');
        break;
      }
    }

    // Distinctive words shared between the title and the account name.
    // Scored by how much of the account name they cover, so "Ettinger" on
    // a two-word account beats one word of a five-word one.
    const shared = signals.tokens.filter(t => o.accountTokens.has(t));
    if (shared.length > 0) {
      const coverage = shared.length / Math.max(1, o.accountTokens.size);
      const tokenScore = 55 + Math.round(coverage * 20);
      if (tokenScore > score) {
        score = tokenScore;
        reasons.push(`“${shared.join('”, “')}” matches the account name`);
      } else {
        reasons.push(`“${shared.join('”, “')}” matches the account name`);
      }
    }

    // The company in the call's title turns up in the opp's notes. Weaker
    // on purpose — a note can mention anyone — but it is how a call gets
    // matched to the deal it is about when the account is the parent, the
    // broker, or a name nobody uses out loud.
    for (const token of signals.tokens) {
      if (o.notesKey && containsPhrase(o.notesKey, token)) {
        score = Math.max(score, 45);
        reasons.push(`“${token}” appears in the opp’s notes`);
        break;
      }
    }

    if (score >= minScore) scored.push({ opp, score, reasons });
  }

  return scored
    .sort((a, b) => b.score - a.score
      || String(a.opp?.['Account'] || '').localeCompare(String(b.opp?.['Account'] || '')))
    .slice(0, Math.max(0, limit));
}
