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

// How long a step lasts, said in the unit that suits it. A survey is a
// fortnight, a rollout is four months, and writing both in months means
// writing the short one as a fraction nobody types.
//
// Everything downstream of getStageMonths — the SVG bars, the Excel grid, the
// deal composer's month arithmetic — places steps in whole month columns, so
// a duration is converted to months and rounded UP: a step of any length
// occupies at least the column it starts in. Two weeks and three weeks
// therefore draw the same width; the chart's grain is the month, and the
// duration is what the step actually says it is.
// A relative month has no calendar to split on, so the week axis gives it
// four even weeks; the duration conversion below divides by the same four,
// which is what keeps a four-week step exactly one column wide.
export const WEEKS_PER_RELATIVE_MONTH = 4;

export const STEP_DURATION_UNITS = ['days', 'weeks', 'months'];
export const DEFAULT_DURATION_UNIT = 'weeks';
export const STEP_DURATION_UNIT_LABELS = { days: 'Days', weeks: 'Weeks', months: 'Months' };

// Weeks convert at WEEKS_PER_RELATIVE_MONTH, the same four-weeks-to-a-month
// the week axis is drawn with, so a four-week step is exactly one column
// rather than one-and-a-bit. Days follow at seven to the week for the same
// reason — the arithmetic a reader can do off the axis is the arithmetic
// that placed the bar.
const MONTHS_PER_UNIT = {
  months: 1,
  weeks: 1 / WEEKS_PER_RELATIVE_MONTH,
  days: 1 / (WEEKS_PER_RELATIVE_MONTH * 7),
};

// The steps a stage waits on, as a list of stage ids.
//
// Stored as a comma-separated string rather than an array — the same shape
// every other multi-value field in this app uses (see parseMulti), and the
// shape a single id was already stored in, so a timeline authored when a step
// could only wait on one thing reads back as a one-element list with no
// migration. Ids can't contain a comma (makeTimelineId is base36), so
// splitting on one is safe.
export function parseDependsOn(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v ?? '').trim()).filter(Boolean))];
  return [...new Set(String(value ?? '').split(',').map(s => s.trim()).filter(Boolean))];
}

// The whole months a { duration, durationUnit } occupies, or null when the
// stage doesn't carry one.
export function durationToMonths(duration, unit) {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return null;
  const per = MONTHS_PER_UNIT[unit] ?? MONTHS_PER_UNIT[DEFAULT_DURATION_UNIT];
  return Math.max(1, Math.ceil(n * per));
}

// The duration written out — "3 weeks", "1 month" — for the places that show
// it outside the editor that set it.
export function formatStepDuration(duration, unit) {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return '';
  const noun = STEP_DURATION_UNITS.includes(unit) ? unit : DEFAULT_DURATION_UNIT;
  return `${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
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

  // How long the step was said to last, in the unit it was said in. Ranks
  // under a typed Span — that cell is someone naming month columns directly —
  // and over anything read off the dates, because a duration is a statement
  // about length while a timing label like "Aug 2026" is only a statement
  // about when. Applies in both positioning modes: a step can be placed by
  // its date and still be two weeks long.
  const durationSpan = durationToMonths(stage?.duration, stage?.durationUnit);
  if (span == null && durationSpan != null) span = durationSpan;

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
    // Whether that month came from something the author actually stated — a
    // typed Month, or a date the step carries — rather than from the "start
    // at kickoff" fallback. placeStages needs the difference: a step nobody
    // placed is one its dependencies are free to place.
    anchored: month != null,
    milestone: isMilestone,
  };
}

// Where a timeline's steps actually sit, once the ones nobody placed are
// sequenced behind the steps they wait on. Returns one position per stage,
// in the order given, each the shape getStageMonths returns.
//
// A step can declare both a duration and the steps it waits on without ever
// naming a month — that's exactly what the Services popup writes, and it's
// the whole content of "this happens after that". Placing each step on its
// own, every one of them fell back to month 1: a ten-step implementation
// drew as ten bars all starting at kickoff, with every dependency arrow
// running backwards out of a step that hadn't finished yet. The chart said
// the plan was impossible when what was impossible was the placement.
//
// A step the author DID place keeps its month. Their word is the plan, and a
// stated position that contradicts a dependency is a real conflict worth
// seeing — the renderers draw that link in red, and re-sequencing it here
// would hide it. Only the unplaced are moved.
//
// A dependency cycle settles nothing, so its members keep the fallback and
// the red links say so. That's better than picking an arbitrary member to
// break, which would draw a confident plan out of a contradiction.
/**
 * The run-up shift: pre-signature steps take the first columns and everything
 * after the signature is pushed right by however many they occupy.
 *
 * That's how an authored timeline gets a run-up without renumbering its axis
 * into negatives — its months are relative, kickoff is month 1, so a
 * pre-kickoff step's END month IS the length of the run-up.
 *
 * A plan that STATES where its signature is has already placed every step on
 * the axis it means, pre-signature ones included, so there is nothing to
 * shift — and shifting anyway is actively wrong, because the end month it
 * measures is then an absolute position rather than a length. The deal
 * rollout is the case: it schedules every band from the signature date, and
 * the popup can move the whole plan right to start the window before kickoff.
 * Under the shift, a two-month run-in made preSpan 3 instead of 1 and shoved
 * every step after the signature three months out — a phantom gap that grew
 * the earlier the window started.
 *
 * `raw` is [{ stage, month, span, ... }]; returns { preSpan, placed }.
 */
export function applyRunUpShift(raw, statedSignature = 0) {
  const list = Array.isArray(raw) ? raw : [];
  if (Math.floor(Number(statedSignature) || 0) > 0) return { preSpan: 0, placed: list };
  const preSpan = list
    .filter(p => p.stage?.preKickoff)
    .reduce((a, p) => Math.max(a, p.month + p.span - 1), 0);
  if (!preSpan) return { preSpan: 0, placed: list };
  return { preSpan, placed: list.map(p => (p.stage?.preKickoff ? p : { ...p, month: p.month + preSpan })) };
}

export function placeStages(stages, baseMonth, mode = 'months') {
  const list = Array.isArray(stages) ? stages : [];
  const pos = list.map(st => getStageMonths(st, baseMonth, mode));

  const indexById = new Map();
  list.forEach((st, i) => {
    const id = String(st?.id ?? '');
    if (id && !indexById.has(id)) indexById.set(id, i);
  });
  const deps = list.map((st, i) => parseDependsOn(st?.dependsOn)
    .map(id => indexById.get(String(id)))
    .filter(j => j != null && j !== i));

  // Settled = this step's month is final. Anchored steps start settled, and
  // so does anything waiting on nothing we can resolve.
  const settled = pos.map((p, i) => p.anchored || deps[i].length === 0);
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < list.length; i++) {
      if (settled[i] || !deps[i].every(j => settled[j])) continue;
      // The month after the last of them ends: a predecessor at month m
      // spanning s months occupies through m + s - 1.
      pos[i] = { ...pos[i], month: Math.max(...deps[i].map(j => pos[j].month + pos[j].span)) };
      settled[i] = true;
      moved = true;
    }
  }
  return pos;
}

// Where in its month a date falls, as 0…1 — the 1st lands near 0, the last
// day near 1. Lets a milestone sit at the point of the month it actually
// happens rather than in the middle of the column.
export function monthDayFraction(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return null;
  return (d - 0.5) / daysInMonth(y, mo);
}

// The month a timeline's columns are counted from.
//
// With a declared range that's the range's own first month, so a step lands in
// the column whose label matches its date. Measuring from the earliest dated
// stage instead — which is all there was before ranges existed — shifts every
// step whenever a stage starts before the range does, and a step the window
// drops would still push the rest sideways. Without a range there are no
// calendar labels to line up with, so the earliest stage remains the origin.
export function placementBaseMonth(template, stages) {
  const window = resolveMonthWindow(template, null);
  if (window.fromRange) {
    const base = parseMonthAnchor(window.anchor);
    if (base) return base.y * 12 + (base.m - 1);
  }
  return timelineBaseMonth(stages);
}

// Steps the timeline's window leaves out.
//
// A step that falls outside the window isn't drawn at all — clamping its bar
// to the edge reads as work happening at the boundary, which is worse than
// not showing it. The Timelines page warns about what it left out; the
// graphic and the exports just don't carry it. One rule, so the page and
// every renderer always agree on what's missing.
//
// With a declared date range the test is the dates: a step is out when its
// whole range sits before the first day or on/after the last. Without one,
// the window is a month count and the test is placement — a step positioned
// past the last column. Undated steps in a dated window stay in: they're
// placed by month number, not by a date the range could exclude.
export function stagesOutsideWindow(template, { baseMonth, mode, monthCount } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) return [];
  const range = getTimelineRange(template);
  if (range) {
    const window = resolveMonthWindow(template, null);
    const bounds = monthWindowBounds(window.anchor, window.monthCount);
    if (!bounds) return [];
    return stages.filter(stage => {
      const r = getStageRange(stage);
      if (!r) return false;
      return isoToMs(r.end) < bounds.startMs || isoToMs(r.start) >= bounds.endMs;
    });
  }
  if (!(Number(monthCount) > 0)) return [];
  return stages.filter(stage => {
    const pos = getStageMonths(stage, baseMonth, mode);
    return pos.month > monthCount;
  });
}

// The same, for a stage: read off its start date, or null when it has no
// date to place it by (a timeline written purely in month numbers).
export function stageMonthFraction(stage) {
  const range = getStageRange(stage);
  return range ? monthDayFraction(range.start) : null;
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

// --- The timeline's own date range --------------------------------------
// A timeline can declare the window it covers — a start and an end date it is
// drawn against — instead of letting whichever stages happen to be dated
// decide where the chart begins and ends. One declared range drives every
// surface (the visual, the .xlsx, the .svg / .png), which is the point: the
// table and its export line up on the same months.

// { start, end } as ISO dates, ordered, or null when either end is unset or
// unreadable. A half-filled range is no range — a chart anchored to one end
// and derived at the other would be a confusing hybrid.
export function getTimelineRange(template) {
  const start = String(template?.rangeStart || '').trim();
  const end = String(template?.rangeEnd || '').trim();
  const a = isoToMs(start);
  const b = isoToMs(end);
  if (a == null || b == null) return null;
  return a <= b ? { start, end } : { start: end, end: start };
}

// The month grid to draw: which real month is column 1, how many columns, and
// whether the columns carry calendar labels.
//
// A declared range wins and always reads as calendar months — that's what
// picking dates asks for. Without one this falls back to the anchor-month and
// month-count settings, so a timeline that never sets a range behaves exactly
// as it did before. `needed` is how many months the stages themselves occupy,
// used only by the "Auto (fit the steps)" fallback.
//
// The range snaps out to whole months at both ends. Part-months would leave
// the Gantt's first tick hanging off the left of its own chart, and the
// implementation grid can't draw half a column at all — snapping is what lets
// all three surfaces agree on one set of columns.
export function resolveMonthWindow(template, needed) {
  const range = getTimelineRange(template);
  if (range) {
    const s = /^(\d{4})-(\d{2})-\d{2}$/.exec(range.start);
    const e = /^(\d{4})-(\d{2})-\d{2}$/.exec(range.end);
    const startOrd = Number(s[1]) * 12 + (Number(s[2]) - 1);
    const endOrd = Number(e[1]) * 12 + (Number(e[2]) - 1);
    return {
      anchor: `${s[1]}-${s[2]}`,
      // Capped well above any real engagement, purely so a typo'd year can't
      // ask for ten thousand columns.
      monthCount: Math.max(1, Math.min(120, endOrd - startOrd + 1)),
      calendar: true,
      fromRange: true,
    };
  }
  return {
    anchor: String(template?.anchorMonth || '').trim(),
    monthCount: Math.max(
      1,
      Math.min(36, Number(template?.monthCount) > 0
        ? Math.floor(template.monthCount)
        : Math.max(12, Number(needed) > 0 ? Number(needed) : 12)),
    ),
    calendar: template?.monthMode === 'calendar',
    fromRange: false,
  };
}

// The window as milliseconds, for the date-scaled Gantt: first day of month 1
// through the last day of the final month (end exclusive, so a bar drawn to
// the end of the last day reaches the right edge). Null without an anchor.
export function monthWindowBounds(anchor, monthCount) {
  const base = parseMonthAnchor(anchor);
  if (!base) return null;
  const last = anchorPlus(anchor, Math.max(1, monthCount) - 1);
  return {
    startMs: Date.UTC(base.y, base.m - 1, 1),
    endMs: Date.UTC(last.y, last.m - 1, daysInMonth(last.y, last.m)) + 86400000,
  };
}

// Human summary of a resolved window — "Jul 2026 – Jun 2027 · 12 months" —
// for the hint under the date pickers.
export function describeMonthWindow(anchor, monthCount) {
  const base = parseMonthAnchor(anchor);
  if (!base) return '';
  const last = anchorPlus(anchor, Math.max(1, monthCount) - 1);
  return `${monthLabel(base.y, base.m, true)} – ${monthLabel(last.y, last.m, true)}`
    + ` · ${monthCount} month${monthCount === 1 ? '' : 's'}`;
}

// --- Week ticks under the month axis ------------------------------------
// The implementation format positions steps by whole months, but a month
// column is a coarse thing to read a date against, so the axis carries a
// second row of week ticks beneath the months.
//
// A calendar-anchored month is split on its real week starts (Mondays) and
// each segment is labelled with that Monday's day, positioned by the day it
// falls on — so the ticks line up with the today marker rather than sitting
// on even quarters. The days before the first Monday are the tail of the
// previous month's week; they get their own leading segment so the row still
// covers the whole month.
//
// A relative month ("month 1, month 2…") has no calendar to split on, so it
// takes four even weeks numbered straight through the timeline: week 6 of a
// 12-month plan reads off the axis without counting.
// (declared above, beside the duration conversion that also reads it)

export function timelineWeekTicks(anchor, monthCount, calendar, weekly = true) {
  const out = [];
  const count = Math.max(1, Math.floor(monthCount) || 1);
  for (let m = 1; m <= count; m += 1) {
    // Monthly axis: the month IS the tick. Returning one unlabelled span
    // covering the whole column keeps every caller's "which tick does this
    // fraction land in" arithmetic working — the grid just has one tick per
    // month to land in, so it comes out month-wide.
    if (!weekly) {
      out.push({ month: m, weeks: [{ label: '', from: 0, to: 1 }] });
      continue;
    }
    const cal = calendar ? anchorPlus(anchor, m - 1) : null;
    if (!cal) {
      const weeks = [];
      for (let i = 0; i < WEEKS_PER_RELATIVE_MONTH; i += 1) {
        weeks.push({
          label: String((m - 1) * WEEKS_PER_RELATIVE_MONTH + i + 1),
          from: i / WEEKS_PER_RELATIVE_MONTH,
          to: (i + 1) / WEEKS_PER_RELATIVE_MONTH,
        });
      }
      out.push({ month: m, weeks });
      continue;
    }
    const dim = daysInMonth(cal.y, cal.m);
    const dow = new Date(Date.UTC(cal.y, cal.m - 1, 1)).getUTCDay(); // 0 = Sunday
    const firstMonday = 1 + ((8 - (dow || 7)) % 7);
    const starts = firstMonday === 1 ? [] : [1];
    for (let d = firstMonday; d <= dim; d += 7) starts.push(d);
    out.push({
      month: m,
      weeks: starts.map((d, i) => ({
        label: String(d),
        from: (d - 1) / dim,
        to: (i + 1 < starts.length ? starts[i + 1] - 1 : dim) / dim,
      })),
    });
  }
  return out;
}

// The same ticks flattened into one column series, for the surfaces that
// think in columns (the Excel grid) rather than in fractions of a month.
export function flattenWeekTicks(ticks) {
  const cols = [];
  ticks.forEach(({ month, weeks }) => {
    weeks.forEach((week, i) => {
      cols.push({ month, label: week.label, first: i === 0, last: i === weeks.length - 1 });
    });
  });
  return cols;
}

// Month label for an axis tick: "Aug 2026", or just "Aug" when the year is
// already established by an earlier tick.
export function monthLabel(y, m, withYear) {
  const name = MONTH_ABBR[m - 1];
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return withYear ? `${cap} ${y}` : cap;
}
