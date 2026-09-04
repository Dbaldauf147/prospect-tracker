// "Last updated" for data that arrives by paste.
//
// The BFO Activity and Leads tables hold whatever was last copied out of
// Salesforce. Nothing refreshes them and nothing expires them, so a table
// pasted this morning and one pasted five weeks ago look identical — same
// rows, same counts, same confident-looking Close Dates. The only thing that
// separates a current pipeline from a stale one is when the paste happened,
// and that was never recorded.
//
// What is wanted from the label is a staleness judgement, not a timestamp:
// "3 days ago" answers the question, "9/4/2026, 8:12 AM" makes you do the
// subtraction. So the relative form leads and the exact time rides along in
// the tooltip, where it settles which paste you are looking at.
//
// Past a week the relative form stops meaning anything useful ("47 days ago"
// is just a big number), so it hands over to the date itself.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;

/**
 * @param {number} ts   Epoch ms of the last paste.
 * @param {number} now  Epoch ms to measure against (injectable for tests).
 * @returns {{relative: string, exact: string}|null} null when there is no
 *          usable timestamp — the caller decides what to say instead.
 */
export function formatLastUpdated(ts, now = Date.now()) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;

  const exact = new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // A timestamp ahead of the clock means skew (a device an hour fast, a
  // mirror landing from elsewhere), not a paste from the future. Reading it
  // as "in 40 minutes" would be worse than useless, so it reads as current.
  const diff = now - t;
  if (diff < MINUTE) return { relative: 'just now', exact };
  if (diff < HOUR) return { relative: plural(Math.floor(diff / MINUTE), 'minute'), exact };
  if (diff < DAY) return { relative: plural(Math.floor(diff / HOUR), 'hour'), exact };
  if (diff < 7 * DAY) return { relative: plural(Math.floor(diff / DAY), 'day'), exact };

  // Past a week, the date says more than the count of days does.
  return {
    relative: new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' }),
    exact,
  };
}
