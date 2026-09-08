// A campaign's subject lines.
//
// A campaign used to be one subject line: the string sent mail was matched
// against. But the same outreach often goes out under more than one subject —
// an A/B test of two lines, a follow-up wave reworded, a market update sent
// to one segment as "Q3 power market update" and to another as "Q3 update:
// ERCOT". Those are one campaign with one contact list and one set of
// numbers, and splitting them into two saved campaigns split the roster and
// the response rate with them.
//
// So a campaign now carries `subjects`, a list. `subject` is kept in step as
// the first of them, because plenty of things still read it — campaigns saved
// before this, the Draft Emails → Email Campaigns handoff, the API request
// body — and a campaign that only ever has one subject looks exactly as it
// always did.
//
// Everything here is pure and dependency-free (scripts/campaignSubjects.test.mjs).

/**
 * Clean a list of subject lines: trimmed, blanks dropped, case-insensitive
 * duplicates collapsed, original order kept. Accepts a single string too, so
 * callers don't have to wrap.
 */
export function normalizeSubjects(list) {
  const raw = Array.isArray(list) ? list : [list];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const s = String(value ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Every subject line a campaign matches on, newest model first and falling
 * back to the single `subject` a campaign saved before this carries.
 */
export function campaignSubjects(c) {
  const list = normalizeSubjects(c?.subjects);
  return list.length ? list : normalizeSubjects(c?.subject);
}

/** The campaign's first subject line — what `subject` has always meant. */
export function primarySubject(c) {
  return campaignSubjects(c)[0] || '';
}

/**
 * A campaign with `subjects` set to `list`, and `subject` kept pointing at
 * the first of them. The one place the two fields are written, so they can't
 * drift apart.
 */
export function withSubjects(c, list) {
  const subjects = normalizeSubjects(list);
  return { ...c, subjects, subject: subjects[0] || '' };
}

/**
 * Which of a campaign's subject lines claims a sent subject, or '' for none.
 *
 * The containment test the campaign report has always used — a campaign owns
 * a send when the SENT subject contains the CAMPAIGN subject — so a draft
 * that picked up a prefix ("RE: ") or a suffix still counts. With several
 * subjects the longest match wins, which is the most specific one.
 *
 * Takes a campaign or a bare list of subjects.
 */
export function matchedSubject(campaignOrSubjects, sentSubject) {
  const sent = String(sentSubject || '').toLowerCase();
  if (!sent) return '';
  const list = Array.isArray(campaignOrSubjects)
    ? normalizeSubjects(campaignOrSubjects)
    : campaignSubjects(campaignOrSubjects);
  let best = '';
  for (const s of list) {
    if (!sent.includes(s.toLowerCase())) continue;
    if (s.length > best.length) best = s;
  }
  return best;
}

/** Whether any of the campaign's subject lines claims this sent subject. */
export function subjectsMatch(campaignOrSubjects, sentSubject) {
  return matchedSubject(campaignOrSubjects, sentSubject) !== '';
}

/**
 * Whether a campaign's subject lines are the same set as `list` — used to
 * skip a save (and the refresh that follows it) when an edit changed nothing.
 * Order and case don't count: the subjects are a set of match patterns.
 */
export function sameSubjects(a, b) {
  const x = normalizeSubjects(a).map(s => s.toLowerCase()).sort();
  const y = normalizeSubjects(b).map(s => s.toLowerCase()).sort();
  return x.length === y.length && x.every((s, i) => s === y[i]);
}

/** Split a textarea's contents (one subject line per row) into subjects. */
export function parseSubjectLines(text) {
  return normalizeSubjects(String(text || '').split('\n'));
}

/** The inverse: a campaign's subjects as textarea contents. */
export function subjectLinesText(c) {
  return campaignSubjects(c).join('\n');
}
