// Turning a stage's human timing text into a calendar range.
//
// The Gantt needs real dates, but nobody wants to retype "Aug–Sep 2026" as a
// pair of date pickers. So Timing stays the primary field — free text, written
// the way it reads on a slide — and this module parses it into a start/end
// range. Explicit dates on the stage always win; parsing is the fallback, so a
// timing the parser can't read ("6 weeks after kickoff") is fixed by filling
// in the date cells rather than by rewording the label.
//
// Everything is plain yyyy-mm-dd strings and UTC math — no local-timezone
// Date parsing, which would shift a date across a day boundary depending on
// where the browser is.

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR = MONTHS.map(m => m.slice(0, 3));

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Days in month `m` (1-based) of year `y`.
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Milliseconds for an ISO date, or null. Used for positioning only.
export function isoToMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function msToIso(ms) {
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Month index (0-11) for a full or abbreviated month name, or -1.
function monthIndex(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\.$/, '');
  if (!key) return -1;
  const full = MONTHS.indexOf(key);
  if (full >= 0) return full;
  return MONTH_ABBR.indexOf(key.slice(0, 3));
}

function twoDigitYear(y) {
  const n = Number(y);
  if (String(y).length <= 2) return n + (n < 70 ? 2000 : 1900);
  return n;
}

// Parse one point in time. Returns { start, end, grain } covering the whole
// unit named — "Jan 2027" spans the entire month, "2027" the entire year —
// so a range built from two of these covers both endpoints inclusively.
function parsePoint(text) {
  const s = String(text || '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;

  let m;
  // 2026-07-31
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { start: iso(y, mo, d), end: iso(y, mo, d), grain: 'day' };
  }
  // 7/31/2026 or 7-31-26
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s))) {
    const y = twoDigitYear(m[3]);
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { start: iso(y, mo, d), end: iso(y, mo, d), grain: 'day' };
  }
  // 2026-07 / 7-2026
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12) return null;
    return { start: iso(y, mo, 1), end: iso(y, mo, daysInMonth(y, mo)), grain: 'month' };
  }
  // Q3 2026 / 3Q26 / Q3-2026
  if ((m = /^(?:q\s*([1-4])|([1-4])\s*q)[\s-]*(\d{2,4})$/i.exec(s))) {
    const q = Number(m[1] || m[2]);
    const y = twoDigitYear(m[3]);
    const startMo = (q - 1) * 3 + 1, endMo = startMo + 2;
    return { start: iso(y, startMo, 1), end: iso(y, endMo, daysInMonth(y, endMo)), grain: 'quarter' };
  }
  // Jan 2027 / January 2027 / Sep-2026
  if ((m = /^([A-Za-z]{3,9})\.?[\s-]+(\d{2,4})$/.exec(s))) {
    const mi = monthIndex(m[1]);
    if (mi < 0) return null;
    const y = twoDigitYear(m[2]);
    return { start: iso(y, mi + 1, 1), end: iso(y, mi + 1, daysInMonth(y, mi + 1)), grain: 'month' };
  }
  // Bare month name — no year to anchor it to.
  if (/^[A-Za-z]{3,9}\.?$/.test(s) && monthIndex(s) >= 0) return null;
  // 2026
  if ((m = /^(\d{4})$/.exec(s))) {
    const y = Number(m[1]);
    return { start: iso(y, 1, 1), end: iso(y, 12, 31), grain: 'year' };
  }
  return null;
}

// Split on an en/em dash, hyphen, "to", or "through" — but not on the hyphens
// inside an ISO date or a numeric date, so "2026-07-31" survives intact.
function splitRange(text) {
  const s = String(text || '').replace(/[‒-―]/g, '–').trim();
  const byWord = /\s+(?:to|through|thru|until)\s+/i;
  if (byWord.test(s)) return s.split(byWord, 2).map(p => p.trim());
  const parts = s.split('–');
  if (parts.length === 2) return parts.map(p => p.trim());
  // Hyphen split only when neither side looks like a date that owns its
  // hyphens (ISO or m-d-y).
  const hy = s.split('-');
  if (hy.length === 2 && !/^\d{4}$/.test(hy[0].trim()) && !/^\d{1,2}$/.test(hy[0].trim())) {
    return hy.map(p => p.trim());
  }
  return null;
}

// Parse a timing string into { start, end } ISO dates, or null when it can't
// be read. Handles "Aug–Sep 2026" (year carried from the right side to the
// left) and "7/31/2026 – 9/25/2026" alike.
export function parseTimingRange(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const direct = parsePoint(raw);
  if (direct) return { start: direct.start, end: direct.end };

  const parts = splitRange(raw);
  if (!parts) return null;
  let [left, right] = parts;
  if (!left || !right) return null;

  let a = parsePoint(left);
  const b = parsePoint(right);
  // "Aug–Sep 2026": the left side has no year of its own, so borrow the
  // right side's. Same for "Q1–Q3 2027".
  if (!a && b) {
    const yearMatch = /(\d{4})\s*$/.exec(right) || /(\d{4})/.exec(right);
    if (yearMatch) a = parsePoint(`${left} ${yearMatch[1]}`);
  }
  if (!a || !b) return null;
  const startMs = isoToMs(a.start), endMs = isoToMs(b.end);
  if (startMs == null || endMs == null) return null;
  return startMs <= endMs
    ? { start: a.start, end: b.end }
    : { start: b.start, end: a.end };
}

// The range a stage actually occupies: explicit dates first, the parsed
// timing text second. `derived` tells the UI the dates came from the label,
// so it can show them as automatic rather than as something the user typed.
export function getStageRange(stage) {
  const explicitStart = String(stage?.start || '').trim();
  const explicitEnd = String(stage?.end || '').trim();
  const parsed = parseTimingRange(stage?.timing);

  const start = explicitStart || parsed?.start || '';
  // A stage with only a start date is a point in time, not an open-ended bar.
  const end = explicitEnd || parsed?.end || start;
  if (!start) return null;
  if (isoToMs(start) == null || isoToMs(end) == null) return null;
  const flip = isoToMs(end) < isoToMs(start);
  return {
    start: flip ? end : start,
    end: flip ? start : end,
    derivedStart: !explicitStart && !!parsed,
    derivedEnd: !explicitEnd && !!parsed,
    milestone: (flip ? start : end) === (flip ? end : start),
  };
}

// Human label for a range, used on the graphic when a stage has dates but no
// timing text of its own.
export function formatRangeLabel(range) {
  if (!range) return '';
  const short = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  };
  return range.milestone ? short(range.start) : `${short(range.start)} – ${short(range.end)}`;
}

// --- Relative months ----------------------------------------------------
// The implementation format counts in months from kickoff ("month 1") rather
// than on a calendar, because that's how a proposal timeline is written
// before a contract is signed. A stage can say so directly via startMonth /
// months; otherwise its calendar range is measured against the earliest dated
// stage in the timeline, so a dated timeline still renders in this format.

function monthOrdinal(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

// The month ordinal of the earliest dated stage, or null when nothing in the
// timeline carries a date.
export function timelineBaseMonth(stages) {
  const ords = (Array.isArray(stages) ? stages : [])
    .map(s => { const r = getStageRange(s); return r ? monthOrdinal(r.start) : null; })
    .filter(v => v != null);
  return ords.length ? Math.min(...ords) : null;
}

// { month, span } for a stage, both 1-based counts of whole months.
//
// `mode` decides what drives the position. 'dates' (the standard) measures the
// stage's calendar range against the timeline's earliest dated stage, ignoring
// any month numbers left over from another mode. 'months' takes the typed
// startMonth / months and only falls back to the dates where they're blank —
// that's the option for a proposal written before any date is fixed.
export function getStageMonths(stage, baseMonth, mode = 'months') {
  const useTyped = mode !== 'dates';
  const explicitStart = useTyped ? Number(stage?.startMonth) : NaN;
  const explicitSpan = useTyped ? Number(stage?.months) : NaN;
  let month = Number.isFinite(explicitStart) && explicitStart >= 1 ? Math.floor(explicitStart) : null;
  let span = Number.isFinite(explicitSpan) && explicitSpan >= 1 ? Math.floor(explicitSpan) : null;

  if (month == null || span == null) {
    const range = getStageRange(stage);
    if (range && baseMonth != null) {
      const startOrd = monthOrdinal(range.start);
      const endOrd = monthOrdinal(range.end);
      if (startOrd != null && month == null) month = startOrd - baseMonth + 1;
      if (startOrd != null && endOrd != null && span == null) span = endOrd - startOrd + 1;
    }
  }
  // A milestone is a point in time: it sits in its start month and never
  // spans, whatever its dates or months value imply. Collapsing the span
  // here keeps every surface consistent — the SVG, the Excel grid and the
  // Stages sheet all read their placement from this one function.
  const isMilestone = stage?.kind === 'milestone';
  return {
    month: Math.max(1, month ?? 1),
    span: isMilestone ? 1 : Math.max(1, span ?? 1),
    explicit: Number.isFinite(explicitStart) && explicitStart >= 1,
    milestone: isMilestone,
  };
}

// --- Calendar anchoring for the implementation format -------------------
// A relative timeline ("month 1, month 2…") can be pinned to the calendar by
// declaring which real month is month 1. Anchors are 'YYYY-MM' strings, the
// same value an <input type="month"> produces.

// The current month as an anchor string, for the "This month" button.
export function currentMonthAnchor() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Parse 'YYYY-MM' into { y, m }, or null.
export function parseMonthAnchor(anchor) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(anchor || '').trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { y: Number(m[1]), m: month };
}

// The calendar month `offset` months after an anchor (offset 0 = month 1).
export function anchorPlus(anchor, offset) {
  const base = parseMonthAnchor(anchor);
  if (!base) return null;
  const ord = base.y * 12 + (base.m - 1) + offset;
  return { y: Math.floor(ord / 12), m: (ord % 12) + 1 };
}

// Which 1-based timeline month contains today, or null when today falls
// outside the anchored window.
export function todayMonthIndex(anchor, monthCount) {
  const base = parseMonthAnchor(anchor);
  if (!base) return null;
  const now = new Date();
  const nowOrd = now.getFullYear() * 12 + now.getMonth();
  const baseOrd = base.y * 12 + (base.m - 1);
  const index = nowOrd - baseOrd + 1;
  return index >= 1 && index <= monthCount ? index : null;
}

// Where today falls in the anchored window, measured in months from the start
// of month 1 — 0 is the 1st of month 1, 1.5 is the midpoint of month 2. The
// fractional part is the position within the current month (day 1 at the
// column's left edge, the last day just short of its right edge), so a marker
// drawn from this tracks the date instead of jumping a whole column at each
// month end. Null when today sits outside the window, since a marker clamped
// to an edge would read as "the timeline starts (or ends) today".
export function todayMonthOffset(anchor, monthCount) {
  const base = parseMonthAnchor(anchor);
  if (!base) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const whole = (y * 12 + (m - 1)) - (base.y * 12 + (base.m - 1));
  const offset = whole + (now.getDate() - 1) / daysInMonth(y, m);
  return offset >= 0 && offset < monthCount ? offset : null;
}

// Month label for an axis tick: "Aug 2026", or just "Aug" when the year is
// already established by an earlier tick.
export function monthLabel(y, m, withYear) {
  const name = MONTH_ABBR[m - 1];
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return withYear ? `${cap} ${y}` : cap;
}
