import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import styles from './SavingsPanel.module.css';
import { SitePricingPanel } from './SitePricingPanel.jsx';
import { NYMEX_MONTH_LABELS, NYMEX_UNIT } from '../../data/nymexHistory.js';
import {
  SAVINGS_KEY, SHIPPED_FORWARD, SHIPPED_FORWARD_ASOF, SHIPPED_SETTLES, TERM_LADDER, VOLUME_SHAPES,
  buildSavings, forwardSeries, getSavingsState, hasSavedSavings, monthlySeries, normalizeSavingsState,
  parseForwardTable, parseMonthlyVolumes, parseNymexTable, percentileRank, priceStats, sourceSummary,
  termLadder, volumeSummary, yearRows,
  addMonths, monthKey, historySlot, LOOKBACK_ALL, MAX_LOOKBACK_MONTHS,
} from '../../utils/nymexSavings.js';
import { downloadSavingsMonths } from '../../utils/savingsExport.js';

// The Sourcing area on Service Deep Dives: load the NYMEX record, describe a
// contract and its hedge layers, and see what the hedge is worth over the
// term.
//
// Two subtabs, one component, because they are two readings of one set of
// numbers rather than two pages. `section` picks which:
//
//   contract   one term, priced twice, as tiles, charts and tables
//   sites      a pasted list of renewals, each priced off the same tables
//
// The settle record and the forward curve stay on screen in both, since
// both readings price off them and the buttons that load them are here.
// Everything below that is one section or the other. One component rather
// than two because the tables, the curve date and the flat assumption have
// to be the same numbers in both - split them and the two subtabs quietly
// start disagreeing about what a month cost.
//
// The page is built around one comparison and shows it four ways, because
// each way answers a question somebody actually asks in the room:
//
//   Is this a good price?      the strike against 35 years of settles
//   What does it cost me?      index and contract all-in, month by month
//   What has it saved?         the running total, and which months paid
//   How long should I go?      the same hedge at 12, 24, 36, 48 and 60 months
//
// Every month is priced from one of three places - the settle, the forward
// curve, or one flat number where neither reaches - and the page never
// quietly mixes them. Each appears with its own mark on the chart, its own
// flag in the tables and its own count in the tiles, because a saving
// measured against a settle and a saving quoted off a curve are different
// claims even when they come to the same number.

const SAVE_DELAY_MS = 800;

// How far back the page looks, as the handful of answers anybody gives.
// "All of the record" is the one that matters and it is not a number: it
// follows whatever settle table is loaded, so pasting a longer one reaches
// further without anybody re-picking it.
const LOOKBACK_CHOICES = [12, 24, 36, 60, 120];

// The consumption table is a calendar: a row per month, a column per year.
// It opens on the term's years plus this many behind them, because a
// thirty-seven column table is a real thing somebody may want and never the
// one they want on the way to editing last December.
const CALENDAR_LOOKBACK_YEARS = 3;

// Spelled out down the side of that table, the way a consumption schedule
// off a utility bill spells them. The short labels stay on the charts, where
// there is no room for these.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Two series, one job each: what the market did, and what the contract
// charges for it. Warm against cool so the pair survives colour blindness
// (checked, worst case deutan/protan dE 20) and both carry a direct label at
// the end of the line as well.
const INDEX_COLOR = '#C2410C';
const CONTRACT_COLOR = '#0369A1';
// Polarity, not identity: a month the hedge paid for itself against a month
// it cost money. Never used for a series.
// Quotes are the SAME measure as settles in another state, so they take the
// same hue and say so with a dash instead. A second hue here would claim the
// forward curve is a different quantity from the price it is a forecast of.
const FORWARD_DASH = '7 4';
const SAVED_COLOR = '#0D9488';
const COST_COLOR = '#B91C1C';
const GRID = '#E2E8F0';
const AXIS_TEXT = '#64748B';

const usd = (n) => (n == null || !Number.isFinite(n) ? '-' : `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`);
const usdShort = (n) => {
  if (n == null || !Number.isFinite(n)) return '-';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${sign}$${Math.round(v / 1e3)}k`;
  return `${sign}$${Math.round(v)}`;
};
const price = (n, dp = 3) => (n == null || !Number.isFinite(n) ? '-' : `$${n.toFixed(dp)}`);
const pct = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '-' : `${(n * 100).toFixed(dp)}%`);
const vol = (n) => (n == null || !Number.isFinite(n) ? '-' : Math.round(n).toLocaleString('en-US'));
const ordinal = (n) => {
  const v = Math.round(n);
  const tens = v % 100;
  if (tens >= 11 && tens <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
};

// A number the user types. Kept as text while they are typing so a half-typed
// "2." or an emptied box does not snap back to a number under the cursor;
// committed on blur, which is when they have finished saying it.
//
// The draft is null whenever nobody is typing, and the prop shows through -
// so the box follows the scenario without an effect syncing the two, and
// dropping the draft on blur is what puts the CLEANED value on screen (a
// term of "999" comes back as the 120 the scenario clamped it to).
function NumberField({ label, hint, title, value, step = 'any', min, max, suffix, onCommit, width }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? String(value ?? '');
  const commit = () => { if (draft !== null) onCommit(draft); setDraft(null); };
  return (
    <label className={styles.field} title={title} style={width ? { width } : undefined}>
      <span className={styles.fieldLabel}>
        {label}
        {hint && <span className={styles.fieldHint}>{hint}</span>}
      </span>
      <span className={styles.inputWrap}>
        <input
          className={styles.input}
          type="number"
          step={step}
          min={min}
          max={max}
          value={shown}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        {suffix && <span className={styles.inputSuffix}>{suffix}</span>}
      </span>
    </label>
  );
}

// One month's consumption. Same draft-on-blur rule as NumberField, for the
// same reason, with one addition: an EMPTY box is a month the user has not
// given a volume for, and it prices off the annual number and the shape
// instead. So the placeholder is that shaped volume - the box shows what it
// would use, and typing over it is what asserts something.
// One month's volume, as a box in the consumption calendar. The row and the
// column already say which month it is, so the box is the box alone.
//
// Same draft-while-typing rule as NumberField: an emptied box has to stay
// empty under the cursor, because emptying it is how somebody puts a month
// back on the shape and a value snapping back mid-edit would fight them.
function VolumeCell({ value, shaped, title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value == null ? '' : String(value));
  const commit = () => {
    if (draft !== null) onCommit(draft.trim() === '' ? null : draft);
    setDraft(null);
  };
  return (
    <input
      className={styles.volumeInput}
      type="number"
      step="1"
      min="0"
      inputMode="decimal"
      title={title}
      aria-label={title}
      value={shown}
      placeholder={shaped == null ? '' : Math.round(shaped).toLocaleString('en-US')}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

function Tile({ label, value, sub, tone = 'plain', title }) {
  return (
    <div className={styles.tile} title={title}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={
        tone === 'good' ? styles.tileValueGood
          : tone === 'bad' ? styles.tileValueBad
            : tone === 'warn' ? styles.tileValueWarn
              : styles.tileValue
      }>{value}</div>
      {sub && <div className={styles.tileSub}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, note, legend, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>{title}</div>
        {legend}
      </div>
      {note && <div className={styles.cardNote}>{note}</div>}
      {children}
    </div>
  );
}

function LegendKey({ items }) {
  return (
    <div className={styles.legend}>
      {items.map(it => (
        <span key={it.label} className={styles.legendItem}>
          {/* A dashed key for a dashed line: identity here is the mark, not
              only the colour, because both states share a hue. */}
          <span
            className={it.dash ? styles.legendSwatchDash : styles.legendSwatch}
            style={it.dash
              ? { backgroundImage: `repeating-linear-gradient(to right, ${it.color} 0 4px, transparent 4px 7px)` }
              : { background: it.color }}
            aria-hidden="true"
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Recharts' default tooltip prints the raw series keys and unformatted
// numbers, which on a page whose whole point is dollars per Dth is the one
// place a reader will not forgive it.
function ChartTip({ active, payload, label, format, footer }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className={styles.tip}>
      <div className={styles.tipHead}>{row?.label || label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tipRow}>
          <span className={styles.tipSwatch} style={{ background: p.color }} aria-hidden="true" />
          <span className={styles.tipName}>{p.name}</span>
          <span className={styles.tipValue}>{format(p.value, p.dataKey, row)}</span>
        </div>
      ))}
      {footer?.(row)}
    </div>
  );
}

export function SavingsPanel({ settings = {}, settingsLoaded = false, updateSettings, section = 'contract' }) {
  const [state, setState] = useState(() => getSavingsState(settings));
  const [status, setStatus] = useState('');
  // The paste box serves both tables. `pasteKind` is null when it is shut,
  // and 'settles' or 'forward' for the one it is aimed at - two boxes side
  // by side would be two places to paste the same thing into wrongly.
  const [pasteKind, setPasteKind] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  // The consumption block: whether the month boxes are open, and the paste
  // box that fills them. It gets a box of its own rather than sharing the one
  // above: that one is aimed at whichever PRICE table it was opened for, and
  // volumes are neither of them.
  const [showVolumes, setShowVolumes] = useState(false);
  const [volumePaste, setVolumePaste] = useState(null);
  const [volumeError, setVolumeError] = useState('');
  // Which end of the window a pasted column of volumes lands on. 'term'
  // starts at the month the term opens, which is what the box did before the
  // look-back existed; 'history' ENDS at the month before it, because "here
  // are my last eighteen months of bills" is the shape history arrives in
  // and it must not depend on how deep the look-back happens to be set.
  const [volumeAnchor, setVolumeAnchor] = useState('term');
  // Whether every year of the window has a column in the consumption table,
  // or only the term's and a few behind it. Purely about how much is on
  // screen; nothing is discarded either way.
  const [allVolumeYears, setAllVolumeYears] = useState(false);
  // Whether the cost and saving charts draw the whole window or the term
  // alone. The term is still the deal being decided, so it stays one click
  // away from a look-back that runs for decades.
  const [chartSpan, setChartSpan] = useState('window');

  // Same shape as the tree above it: local state is the truth while a save is
  // owed, so a snapshot echoing back from Firestore mid-edit cannot eat what
  // is being typed.
  const pendingRef = useRef(false);
  const timerRef = useRef(null);
  // The latest state, readable without depending on it. The adopt effect
  // below has to compare against what is on screen WITHOUT re-running every
  // time that changes - re-running is exactly how a just-typed edit gets
  // reverted by a snapshot that has not caught up yet.
  //
  // Written in an effect rather than during render, and declared first so it
  // is already current by the time the effects after it run.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  const save = useCallback((next) => {
    if (!updateSettings) return;
    pendingRef.current = true;
    setStatus('Saving…');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Promise.resolve(updateSettings({ [SAVINGS_KEY]: next }))
        .then(() => setStatus('Saved'))
        .catch(() => setStatus('Save failed'))
        .finally(() => { pendingRef.current = false; });
    }, SAVE_DELAY_MS);
  }, [updateSettings]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const apply = useCallback((next) => { setState(next); save(next); }, [save]);
  const patchScenario = useCallback((patch) => {
    const prev = stateRef.current;
    apply({ ...prev, scenario: { ...prev.scenario, ...patch } });
  }, [apply]);

  // The saved blob, read straight off the settings document. Hoisted out of
  // the memo so the dependency is the thing that actually changes rather
  // than a lookup the linter cannot follow.
  const savedRaw = settings?.[SAVINGS_KEY];
  const storedJson = useMemo(() => JSON.stringify(normalizeSavingsState(savedRaw)), [savedRaw]);
  //
  // Adopting is a setState from an effect, which the hooks rules flag on
  // sight. It is the exception the rule names rather than the mistake it
  // hunts: the external system is the settings document, the effect is
  // subscribed to a version arriving from it, and there is nowhere else for
  // the adoption to happen - reading it during render would mean reading
  // `pendingRef` during render, and deriving it instead would throw away the
  // local edit the debounce is still holding. The tree beside this panel
  // adopts the same way.
  useEffect(() => {
    if (!settingsLoaded || pendingRef.current) return;
    if (storedJson === JSON.stringify(stateRef.current)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(JSON.parse(storedJson));
  }, [storedJson, settingsLoaded]);

  const settles = state.settles || SHIPPED_SETTLES;
  const custom = !!state.settles;
  const forward = state.forward || SHIPPED_FORWARD;
  const customForward = !!state.forward;
  const forwardAsOf = customForward
    ? (state.forwardAsOf ? `pasted ${state.forwardAsOf}` : 'pasted')
    : `quoted ${SHIPPED_FORWARD_ASOF}`;
  const series = useMemo(() => monthlySeries(settles), [settles]);
  const curve = useMemo(() => forwardSeries(forward), [forward]);
  const stats = useMemo(() => priceStats(series), [series]);
  const curveStats = useMemo(() => priceStats(curve) || { min: null, max: null, mean: null }, [curve]);
  // Months between the last settle and the first quote that neither table
  // covers. Real with the shipped pair - the settles stop in September and
  // the quotes start in November - and the kind of hole that is invisible
  // until a term runs through it, so the page counts it out loud.
  const gapMonths = useMemo(() => {
    if (!series.length || !curve.length) return 0;
    const last = series[series.length - 1];
    const first = curve[0];
    const months = (first.year * 12 + first.month) - (last.year * 12 + last.month) - 1;
    return Math.max(0, months);
  }, [series, curve]);
  const run = useMemo(() => buildSavings(state.scenario, series, curve), [state.scenario, series, curve]);
  const ladder = useMemo(() => termLadder(state.scenario, series, curve), [state.scenario, series, curve]);
  const history = useMemo(() => yearRows(settles), [settles]);
  const s = run.scenario;
  const strikeRank = run.hedge.price == null ? null : percentileRank(series, run.hedge.price);

  // What a month WOULD price at off the annual number and the shape. The
  // month boxes show it as their placeholder, so an empty box says what it
  // falls back to rather than looking like a zero.
  const shapedVolume = (month) => s.annualVolumeDth * VOLUME_SHAPES[s.volumeShape].weights[month - 1];
  const enteredVolumes = run.totals.enteredVolumeMonths;
  // Values sitting past the end of the term: kept rather than trimmed, so
  // shortening a term and lengthening it again does not lose what was typed.
  const volumesPastTerm = Math.max(0, (s.monthlyVolumes || []).length - s.termMonths);

  // ── the look-back ──────────────────────────────────────────────────────
  // How many months of it there actually are, which is not what the scenario
  // asked for when it asked for the whole record: that answer comes out of
  // the settle table, and changes the moment somebody pastes a longer one.
  const back = run.lookback;
  const hasBack = back > 0;
  const backEntered = run.historyTotals.enteredVolumeMonths;
  const volumesPastBack = Math.max(0, (s.historyVolumes || []).length - back);
  const backStart = run.history[0];
  const backEnd = run.history[run.history.length - 1];
  const backSpan = hasBack ? `${backStart.label} – ${backEnd.label}` : '';
  // What the control says under its own label. The three cases are worth
  // spelling out: a look-back that is running, one asked for but with no
  // record in front of the term to give it, and one switched off.
  const lookbackHint = hasBack
    ? `${back} month${back === 1 ? '' : 's'} before it, ${backSpan}`
    : s.lookback === LOOKBACK_ALL
      ? 'the record does not reach behind this term'
      : 'the term only';
  // The list offered, plus whatever number is already stored if it is not
  // one of them - a saved scenario must not lose its setting to a dropdown.
  const lookbackOptions = useMemo(() => {
    const set = new Set(LOOKBACK_CHOICES);
    if (typeof s.lookback === 'number' && s.lookback > 0) set.add(s.lookback);
    return [...set].sort((a, b) => a - b);
  }, [s.lookback]);

  // Which months the cost and saving charts draw. The whole window once
  // there is a look-back, because that is what including history means; the
  // term alone is a click away, and the term is shaded either way so the
  // deal never gets lost inside thirty years of record.
  // ── the consumption calendar ───────────────────────────────────────────
  // Every month of the window, found by its place on the calendar rather
  // than by its place in the term. The table is a pivot: the rows and
  // columns are a year and a month, and this is what turns that pair back
  // into the slot it is stored in. Both lists are indexed off the term - the
  // term's forwards, the look-back's backwards - so the map is built once
  // from the run rather than computed per cell.
  const volumeSlots = useMemo(() => {
    const map = new Map();
    run.history.forEach((m, i) => map.set(m.key, { list: 'history', slot: historySlot(run.lookback, i), month: m }));
    run.months.forEach((m, i) => map.set(m.key, { list: 'term', slot: i, month: m }));
    return map;
  }, [run.history, run.months, run.lookback]);

  // A column per calendar year the window touches, oldest first. A year is
  // whole in the table even where the window only holds part of it: the
  // months it does not reach come back as empty cells, which is what says
  // the window stops there.
  const windowYears = useMemo(() => {
    const years = new Set(run.all.map(m => m.year));
    return [...years].sort((a, b) => a - b);
  }, [run.all]);
  const termYears = useMemo(() => new Set(run.months.map(m => m.year)), [run.months]);
  const firstTermYear = run.months[0]?.year ?? windowYears[0];
  // Worked out whether or not the table is expanded, so the button knows
  // there is something to expand INTO rather than deciding from what is
  // currently on screen.
  const collapsedYears = windowYears.filter(y => y >= firstTermYear - CALENDAR_LOOKBACK_YEARS);
  const shownYears = allVolumeYears ? windowYears : collapsedYears;
  const moreYears = windowYears.length - collapsedYears.length;

  const wholeWindow = hasBack && chartSpan === 'window';
  const chartMonths = wholeWindow ? run.all : run.months;
  const backTone = run.historyTotals.saving >= 0 ? 'good' : 'bad';

  const termStart = { year: s.startYear, month: s.startMonth };
  const termEnd = addMonths(s.startYear, s.startMonth, s.termMonths - 1);
  const termStartKey = monthKey(termStart.year, termStart.month);
  const termEndKey = monthKey(termEnd.year, termEnd.month);

  // The whole record, thinned for the axis but not for the line: every settle
  // is still a point, only the labels are sampled.
  // Settles and quotes on one timeline, as two keys rather than two charts:
  // it is the same measure in two states, so it is one line that changes
  // from solid to dashed where the market stops having happened.
  //
  // The last settle is repeated into the forward key so the two halves join
  // up instead of leaving a visual gap at the handover. Where the tables
  // leave a real gap - a month neither covers - the keys are genuinely null
  // and the line breaks, which is the honest picture.
  const historyData = useMemo(() => {
    const rows = series.map(p => ({
      key: p.key, label: p.label, year: p.year, month: p.month, settle: p.price, forward: null,
    }));
    const lastSettle = rows[rows.length - 1];
    if (lastSettle && curve.length) {
      const next = addMonths(lastSettle.year, lastSettle.month, 1);
      // Only when the curve picks up the very next month. With the shipped
      // tables it does not - the settles stop at September and the quotes
      // start in November - so the line breaks over the missing month
      // rather than drawing a segment across a price nobody has.
      if (curve[0].key === monthKey(next.year, next.month)) lastSettle.forward = lastSettle.settle;
    }
    for (const p of curve) {
      rows.push({ key: p.key, label: p.label, year: p.year, month: p.month, settle: null, forward: p.price });
    }
    return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }, [series, curve]);

  // The running total shown is the one that matches the span on screen:
  // across the whole window when the whole window is drawn, and the term's
  // own - which opens at zero on the month the term opens - when it is not.
  // Drawing the term alone off a total that already carries a backtest would
  // put the line somewhere it never was.
  const chartData = chartMonths.map(m => ({
    key: m.key, label: m.label, short: m.short, assumed: m.assumed, source: m.source,
    phase: m.phase,
    index: m.indexAllIn, contract: m.contractAllIn,
    saving: m.saving, cumulative: wholeWindow ? m.cumulativeAll : m.cumulative, volume: m.volume,
  }));

  // Where the term sits inside the history chart, so the strip of market the
  // contract actually covers is visible rather than described. Looked up on
  // the whole timeline rather than on the settles: a forward term sits
  // entirely past the end of them, and searching only the settles is how the
  // band silently disappears exactly when the term is the interesting one.
  const termBandStart = historyData.find(r => r.key >= termStartKey)?.key;
  const termBandEnd = [...historyData].reverse().find(r => r.key <= termEndKey)?.key;

  // The stretches of the term that are not settled market, as CONSECUTIVE
  // runs rather than first-to-last.
  //
  // They interleave: with the shipped tables a term straddling today runs
  // settles, then the uncovered month, then two years of curve, then flat
  // again past its end. Shading first-flat to last-flat would paint the grey
  // band straight over the curve in the middle and say the whole tail was
  // guessed.
  const sourceBands = useMemo(() => {
    const bands = [];
    for (const m of chartMonths) {
      const last = bands[bands.length - 1];
      if (last && last.source === m.source) { last.x2 = m.key; last.count += 1; continue; }
      bands.push({ source: m.source, x1: m.key, x2: m.key, count: 1 });
    }
    return bands.filter(band => band.source !== 'settled');
  }, [chartMonths]);

  // Where the term begins inside a chart that is drawing the whole window.
  // Without it a reader cannot tell which end of a thirty-year line is the
  // deal, and the deal is the point.
  // The element itself rather than a component wrapping it: Recharts reads
  // the type of each child to decide what to draw, so a ReferenceLine hidden
  // inside a component of ours is a child it does not recognise and never
  // renders.
  const termMarkKey = wholeWindow ? run.months[0]?.key : null;
  const termMark = termMarkKey ? (
    <ReferenceLine
      x={termMarkKey}
      stroke={CONTRACT_COLOR}
      strokeWidth={1.5}
      strokeDasharray="4 3"
      // To the LEFT of the rule, over the look-back. To its right is where
      // the forward-curve band puts its own label and where the plot runs
      // out on a term that ends the chart, so a label on that side lands on
      // top of one or gets clipped by the other.
      label={{ value: 'term', position: 'insideTopLeft', fill: CONTRACT_COLOR, fontSize: 9, fontWeight: 700 }}
    />
  ) : null;

  const BAND_STYLE = {
    forward: { fill: INDEX_COLOR, fillOpacity: 0.06, text: 'forward curve' },
    assumed: { fill: AXIS_TEXT, fillOpacity: 0.1, text: 'flat' },
  };
  // A band gets a label only when there is room for one and it is not the
  // whole term - a label on a one-month run lands on its neighbour, and a
  // label on the whole term lands on the y axis while saying nothing the
  // note above the chart does not.
  const bandLabel = (band) => (band.count >= 5 && band.count < chartMonths.length
    ? { value: BAND_STYLE[band.source].text, position: 'insideTop', fill: AXIS_TEXT, fontSize: 9, fontWeight: 700 }
    : undefined);

  // Recharts samples ticks by width, which can drop every January - and
  // January is the only label carrying a year. So the ticks are chosen
  // rather than sampled: the Januaries, plus the first month of the term so
  // that a term shorter than a year still says when it runs.
  const chartTicks = useMemo(() => {
    // A short label carries a year only in January, so those are the anchors.
    // The first month of the term joins them only when the term holds no
    // January at all, because a term opening in October would otherwise put
    // its label hard against the one three months later.
    const januaries = chartMonths.filter(m => m.month === 1);
    const picks = januaries.length ? januaries : chartMonths.slice(0, 1);
    // Still too many to read on a long term, so thin them evenly.
    const stride = Math.ceil(picks.length / 8) || 1;
    return picks.filter((_, i) => i % stride === 0).map(m => m.key);
  }, [chartMonths]);

  // Key to the label shown under it. The axis plots the unique month; this
  // turns it back into something short enough to read.
  const shortByKey = useMemo(() => new Map(chartMonths.map(m => [m.key, m.short])), [chartMonths]);

  function openPaste(kind) {
    setPasteKind(prev => (prev === kind ? null : kind));
    setPasteText('');
    setPasteError('');
  }

  const skippedNote = (skipped) => (skipped.length
    ? `, skipping ${skipped.length} line${skipped.length === 1 ? '' : 's'} it could not read`
    : '');

  function loadPaste() {
    const today = new Date().toISOString().slice(0, 10);
    if (pasteKind === 'forward') {
      const parsed = parseForwardTable(pasteText);
      if (!parsed.months) {
        setPasteError('No quotes read. Each line wants a month and a price, like "Nov 26  $3.043".');
        return;
      }
      apply({ ...state, forward: parsed.forward, forwardAsOf: today });
      setPasteKind(null);
      setPasteText('');
      setPasteError('');
      setStatus(`Loaded a ${parsed.months} month curve${skippedNote(parsed.skipped)}.`);
      return;
    }
    const parsed = parseNymexTable(pasteText);
    if (!parsed.years) {
      setPasteError('No rows read. Each line wants a year, then twelve monthly settles.');
      return;
    }
    apply({ ...state, settles: parsed.settles, loadedAt: today });
    setPasteKind(null);
    setPasteText('');
    setPasteError('');
    setStatus(`Loaded ${parsed.years} year${parsed.years === 1 ? '' : 's'} and ${parsed.months} settled month${parsed.months === 1 ? '' : 's'}${skippedNote(parsed.skipped)}.`);
  }

  function resetTable() {
    if (!window.confirm('Put the shipped settle table back? The table you loaded is replaced. Your curve, contract and hedge layers are kept.')) return;
    apply({ ...state, settles: null, loadedAt: null });
    setStatus('Back on the shipped settle table.');
  }

  function resetCurve() {
    if (!window.confirm('Put the shipped forward curve back? The curve you loaded is replaced. Your settles, contract and hedge layers are kept.')) return;
    apply({ ...state, forward: null, forwardAsOf: null });
    setStatus('Back on the shipped curve.');
  }

  function setLayer(i, patch) {
    const layers = s.layers.map((l, j) => (j === i ? { ...l, ...patch } : l));
    patchScenario({ layers });
  }
  function addLayer() {
    const room = Math.max(0, 100 - s.layers.reduce((n, l) => n + l.pct, 0));
    patchScenario({
      layers: [...s.layers, {
        id: `L${s.layers.length + 1}`,
        label: `Layer ${s.layers.length + 1}`,
        pct: Math.min(25, room),
        price: run.hedge.price ?? stats?.last?.price ?? 3,
      }],
    });
  }
  function removeLayer(i) {
    if (s.layers.length <= 1) { setStatus('A contract needs a layer. Set it to 0% to price the term at index.'); return; }
    patchScenario({ layers: s.layers.filter((_, j) => j !== i) });
  }

  // One month's volume. Either list is indexed from the term - forwards for
  // the term's own months, backwards for the look-back - so a month being
  // cleared leaves a hole rather than closing up. Closing it up would slide
  // every neighbouring month one place along.
  function setMonthVolume(list, i, raw) {
    const key = list === 'history' ? 'historyVolumes' : 'monthlyVolumes';
    const next = [...(s[key] || [])];
    while (next.length <= i) next.push(null);
    next[i] = raw == null ? null : raw;
    patchScenario({ [key]: next });
  }

  function loadVolumes() {
    const toHistory = volumeAnchor === 'history';
    const room = toHistory ? MAX_LOOKBACK_MONTHS : undefined;
    const parsed = parseMonthlyVolumes(volumePaste, room);
    if (!parsed.count) {
      setVolumeError(toHistory
        ? 'No volumes read. One value per month before the term, oldest first, a line each or a row across.'
        : 'No volumes read. One value per month of the term, a line each or a row across, and a label in front of each is fine.');
      return;
    }
    // A history paste is read oldest first, the way a column of bills comes
    // off a spreadsheet, and stored backwards from the term - so the LAST
    // value given is the month before the term opens whether they pasted
    // eighteen months or eighty, and the look-back's depth never moves it.
    patchScenario(toHistory
      ? { historyVolumes: [...parsed.volumes].reverse() }
      : { monthlyVolumes: parsed.volumes });
    setVolumePaste(null);
    setVolumeError('');
    setShowVolumes(true);
    // A history paste reaches years the table is not showing, so it opens
    // them: loading volumes and not seeing where they went is worse than a
    // wide table.
    if (toHistory) setAllVolumeYears(true);
    const over = parsed.volumes.length - (toHistory ? back : s.termMonths);
    const labels = parsed.labels?.length || 0;
    setStatus([
      `Loaded ${parsed.count} monthly volume${parsed.count === 1 ? '' : 's'}`,
      toHistory ? ' for the months before the term' : '',
      parsed.blanks ? `, leaving ${parsed.blanks} month${parsed.blanks === 1 ? '' : 's'} on the shape` : '',
      // Named rather than counted among the lines it could not read: a month
      // label is expected, and copying the boxes off the page produces one
      // per month.
      labels ? `, reading past ${labels} month label${labels === 1 ? '' : 's'}` : '',
      skippedNote(parsed.skipped),
      over > 0
        ? `. ${over} more than the ${toHistory ? 'look-back reaches' : 'term runs'}, so ${over === 1 ? 'it sits' : 'they sit'} unused until you ${toHistory ? 'look further back' : 'lengthen it'}.`
        : '.',
    ].join(''));
  }

  function clearVolumes() {
    const both = backEntered > 0 && enteredVolumes > 0;
    if (!window.confirm(both
      ? 'Clear the monthly volumes, the look-back ones as well as the term\u2019s? Every month goes back to the annual volume spread over the shape.'
      : 'Clear the monthly volumes? Every month goes back to the annual volume spread over the shape.')) return;
    patchScenario({ monthlyVolumes: [], historyVolumes: [] });
    setShowVolumes(false);
    setStatus('Monthly volumes cleared. Every month is back on the annual volume and the shape.');
  }

  async function copySummary() {
    const lines = [
      s.name ? `${s.name} - hedge savings` : 'Hedge savings',
      `Term: ${run.months[0]?.label || '-'} to ${run.months[run.months.length - 1]?.label || '-'} (${s.termMonths} months)`,
      `Volume: ${vol(run.totals.volume)} Dth over the term`,
      `Hedged: ${run.hedge.pct.toFixed(0)}% at ${price(run.hedge.price)} ${NYMEX_UNIT}`,
      `At index: ${usd(run.totals.indexCost)} (${price(run.totals.avgIndexAllIn)} all-in)`,
      `On contract: ${usd(run.totals.contractCost)} (${price(run.totals.avgContractAllIn)} all-in)`,
      `Saving: ${usd(run.totals.saving)} (${pct(run.totals.savingPct)}, ${price(run.totals.savingPerDth)} a Dth)`,
      `Priced from: ${sourceSummary(run.totals)}.`,
      // The look-back goes out as its own block, never added into the term's
      // saving: one is a deal being decided and the other is market that has
      // already settled, and a pasted summary travels further than the page.
      ...(hasBack ? [
        '',
        `Look back: ${backSpan} (${back} months)`,
        `Volume: ${vol(run.historyTotals.volume)} Dth`,
        `The same hedge over those months: ${usd(run.historyTotals.saving)} (${price(run.historyTotals.savingPerDth)} a Dth)`,
        `Priced from: ${sourceSummary(run.historyTotals)}.`,
        `Look-back and term together: ${usd(run.allTotals.saving)} over ${vol(run.allTotals.volume)} Dth.`,
        '',
      ] : []),
      run.totals.assumedMonths
        ? `${run.totals.assumedMonths} month${run.totals.assumedMonths === 1 ? '' : 's'} sit past both tables and price flat at ${price(s.forwardPrice)}.`
        : run.totals.forwardMonths
          ? `The forward months are quoted off the curve ${forwardAsOf}, not measured.`
          : 'Every month of the term is settled market, so this is measured rather than forecast.',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setStatus('Summary copied.');
    } catch {
      setStatus('Clipboard blocked. Select the tiles and copy them instead.');
    }
  }

  // The month by month table as a workbook, with the scenario on a second
  // sheet so the savings arrive with the assumptions that produced them.
  // The file is built in utils/savingsExport.js, which is where the shape of
  // it is pinned by a test.
  async function exportMonths() {
    if (!run.months.length) { setStatus('No months in the term to export.'); return; }
    try {
      const n = await downloadSavingsMonths(run, {
        forwardAsOf,
        customSettles: custom,
        customForward,
      });
      setStatus(`Exported ${n} month${n === 1 ? '' : 's'}.`);
    } catch {
      setStatus('The export failed. Copy the summary instead, or reload and try again.');
    }
  }

  const savingTone = run.totals.saving >= 0 ? 'good' : 'bad';

  return (
    <div className={styles.wrap}>
      {/* ── the record this is all priced off ─────────────────────────── */}
      <div className={styles.bar}>
        <div className={styles.barMain}>
          <span className={styles.barTitle}>Settles</span>
          <span
            className={styles.barFacts}
            title={stats
              ? `${stats.count.toLocaleString('en-US')} settled months, ${series[0].label} to ${series[series.length - 1].label}. Low ${price(stats.min)}, median ${price(stats.median)}, high ${price(stats.max)}.`
              : undefined}>
            {stats
              ? `${stats.count.toLocaleString('en-US')} mo, ${series[0].label} – ${series[series.length - 1].label} · ${price(stats.min)} / ${price(stats.median)} / ${price(stats.max)}`
              : 'No settles loaded.'}
          </span>
          <span className={custom ? styles.pillCustom : styles.pillShipped}>
            {custom ? `Yours${state.loadedAt ? `, loaded ${state.loadedAt}` : ''}` : 'Shipped'}
          </span>
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.smallBtn} title="Paste a settle table" onClick={() => openPaste('settles')}>
            {pasteKind === 'settles' ? 'Close' : 'Load'}
          </button>
          {custom && <button type="button" className={styles.smallBtn} title="Go back to the shipped settles" onClick={resetTable}>Reset</button>}
          <button type="button" className={styles.smallBtn} title="The settle table, year by year" onClick={() => setShowHistory(v => !v)}>
            {showHistory ? 'Hide' : 'Table'}
          </button>
        </div>
      </div>

      {/* The curve gets a row of its own rather than a line in the settles
          row, because it is the table that goes stale: the date it was
          quoted at belongs beside it, not in a tooltip. */}
      <div className={styles.bar}>
        <div className={styles.barMain}>
          <span className={styles.barTitle}>Forward curve</span>
          <span
            className={styles.barFacts}
            title={curve.length
              ? `${curve.length} quoted month${curve.length === 1 ? '' : 's'}, ${curve[0].label} to ${curve[curve.length - 1].label}. Low ${price(curveStats.min)}, average ${price(curveStats.mean)}, high ${price(curveStats.max)}.`
              : 'Every month past the last settle prices at the flat assumption until a curve is loaded.'}>
            {curve.length
              ? `${curve.length} mo, ${curve[0].label} – ${curve[curve.length - 1].label} · ${price(curveStats.min)} / ${price(curveStats.mean)} / ${price(curveStats.max)}`
              : 'No curve loaded.'}
          </span>
          <span className={customForward ? styles.pillCustom : styles.pillShipped}>{forwardAsOf}</span>
          {gapMonths > 0 && (
            <span className={styles.pillGap} title="Neither table covers these months, so they price at the flat assumption. Paste a curve that starts earlier to close the gap.">
              {gapMonths} mo uncovered
            </span>
          )}
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.smallBtn} title="Paste a forward curve" onClick={() => openPaste('forward')}>
            {pasteKind === 'forward' ? 'Close' : 'Load'}
          </button>
          {customForward && <button type="button" className={styles.smallBtn} title="Go back to the shipped curve" onClick={resetCurve}>Reset</button>}
          {/* The third price source, beside the two tables it takes over
              from rather than down among the contract terms. It is not a
              term of anybody's deal: it is the number the page falls back
              on when no table reaches the month, so both subtabs price off
              it and both need it in reach. */}
          <NumberField
            label="Flat" title="The price a month falls back on when neither table reaches it"
            width="9.5rem" step="0.01" suffix={NYMEX_UNIT}
            value={s.forwardPrice} onCommit={v => patchScenario({ forwardPrice: v })}
          />
          {status && <span className={styles.muted}>{status}</span>}
        </div>
      </div>

      {pasteKind && (
        <div className={styles.pastePanel}>
          <div className={styles.fieldLabel}>
            {pasteKind === 'settles' ? 'Paste a settle table' : 'Paste a forward curve'}
            <span className={styles.fieldHint}>
              {pasteKind === 'settles'
                ? 'One line per year: the year, then Jan to Dec, tab or comma separated. A header row and an AVG column on the end are ignored, so a block copied straight out of a spreadsheet comes in as it is. Blank cells stay blank rather than becoming zeroes.'
                : 'One line per month: the month, then the price. The month can be written any way it comes ("Nov 26", "November 2026", "2027-01", "1/27"), dollar signs and a header row are ignored, and the price is whatever is last on the line. This replaces the whole curve rather than merging into it.'}
            </span>
          </div>
          <textarea
            className={styles.textarea}
            rows={6}
            value={pasteText}
            placeholder={pasteKind === 'settles'
              ? `YEAR\tJan\tFeb\tMar\t...\tDec\n2025\t3.514\t3.535\t3.906\t...\t4.424`
              : `Month\tPrice\nNov 26\t$3.043\nDec 26\t$3.418`}
            onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
          />
          {pasteError && <div className={styles.warn}>{pasteError}</div>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.primaryBtn} onClick={loadPaste} disabled={!pasteText.trim()}>Load it</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setPasteKind(null); setPasteError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className={styles.historyWrap}>
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th className={styles.thYear}>Year</th>
                {NYMEX_MONTH_LABELS.map(m => <th key={m}>{m}</th>)}
                <th className={styles.thAvg}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {history.map(row => (
                <tr key={row.year}>
                  <th className={styles.thYear} scope="row">{row.year}</th>
                  {row.months.map((v, i) => (
                    <td key={i} className={v == null ? styles.cellEmpty : styles.cell}>{v == null ? '' : v.toFixed(3)}</td>
                  ))}
                  <td className={styles.cellAvg}>{row.avg == null ? '' : row.avg.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── one term, priced twice: the Contract savings subtab ───────── */}
      {section === 'contract' && (
      <>
      <div className={styles.inputs}>
        <div className={styles.inputGroup}>
          <div className={styles.groupTitle}>Contract</div>
          <div className={styles.fieldRow}>
            <label className={styles.field} style={{ width: '13rem' }}>
              <span className={styles.fieldLabel}>Name<span className={styles.fieldHint}>what this scenario is</span></span>
              <span className={styles.inputWrap}>
                <input
                  className={styles.input}
                  type="text"
                  value={s.name}
                  placeholder="e.g. Midwest plants, 2027 renewal"
                  onChange={e => patchScenario({ name: e.target.value })}
                />
              </span>
            </label>
            <label className={styles.field} style={{ width: '7rem' }}>
              <span className={styles.fieldLabel}>Starts<span className={styles.fieldHint}>first month</span></span>
              <span className={styles.inputWrap}>
                <select
                  className={styles.input}
                  value={s.startMonth}
                  onChange={e => patchScenario({ startMonth: Number(e.target.value) })}
                >
                  {NYMEX_MONTH_LABELS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </span>
            </label>
            <NumberField
              label="Year" hint="term opens in" width="6rem" step="1"
              value={s.startYear} onCommit={v => patchScenario({ startYear: v })}
            />
            <NumberField
              label="Term" hint="how long it runs" width="7.5rem" step="1" min="1" suffix="mo"
              value={s.termMonths} onCommit={v => patchScenario({ termMonths: v })}
            />
            {/* The months BEFORE the term, run through the same hedge. A
                second reading rather than a longer term, so it sits beside
                the term rather than inside it and its saving is reported
                apart from the term's everywhere on the page. */}
            <label className={styles.field} style={{ width: '11rem' }}>
              <span className={styles.fieldLabel}>
                Look back
                <span className={styles.fieldHint}>{lookbackHint}</span>
              </span>
              <span className={styles.inputWrap}>
                <select
                  className={styles.input}
                  value={s.lookback === LOOKBACK_ALL ? LOOKBACK_ALL : String(s.lookback)}
                  onChange={e => patchScenario({
                    lookback: e.target.value === LOOKBACK_ALL ? LOOKBACK_ALL : Number(e.target.value),
                  })}
                >
                  {/* Not a number, and it must not become one: it follows
                      whatever settle table is loaded, so a longer paste
                      reaches further back without anybody re-picking it. */}
                  <option value={LOOKBACK_ALL}>All of the record</option>
                  <option value="0">None, the term only</option>
                  {lookbackOptions.map(n => <option key={n} value={String(n)}>{n} months</option>)}
                </select>
              </span>
            </label>
            <NumberField
              label="Annual volume" hint="burned in a year" width="9.5rem" step="1000" suffix="Dth"
              value={s.annualVolumeDth} onCommit={v => patchScenario({ annualVolumeDth: v })}
            />
            <label className={styles.field} style={{ width: '10rem' }}>
              <span className={styles.fieldLabel}>
                Volume shape
                <span className={styles.fieldHint}>{VOLUME_SHAPES[s.volumeShape].note}</span>
              </span>
              <span className={styles.inputWrap}>
                <select
                  className={styles.input}
                  value={s.volumeShape}
                  onChange={e => patchScenario({ volumeShape: e.target.value })}
                >
                  {Object.entries(VOLUME_SHAPES).map(([key, shape]) => (
                    <option key={key} value={key}>{shape.label}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <div className={styles.fieldRow}>
            <NumberField
              label="Basis" hint="delivered point vs Henry Hub" width="9rem" step="0.01" suffix={NYMEX_UNIT}
              value={s.basis} onCommit={v => patchScenario({ basis: v })}
            />
            <NumberField
              label="Retail adder" hint="margin, transport, fees" width="9.5rem" step="0.01" suffix={NYMEX_UNIT}
              value={s.adder} onCommit={v => patchScenario({ adder: v })}
            />
            <div className={styles.fieldNote}>
              Basis and the adder are charged whether the volume is hedged or not, so they move the bill and drop out of the saving.
            </div>
          </div>

        </div>

        <div className={styles.inputGroup}>
          <div className={styles.groupTitle}>
            Hedge positions
            <span className={styles.groupHint}>
              Each layer locks a slice of the volume at a price. Whatever is left floats at the index.
            </span>
          </div>
          <table className={styles.layerTable}>
            <thead>
              <tr>
                <th>Layer</th>
                <th className={styles.thNum}>% of volume</th>
                <th className={styles.thNum}>Price ({NYMEX_UNIT})</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.layers.map((l, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className={styles.inputSmall}
                      type="text"
                      value={l.label}
                      onChange={e => setLayer(i, { label: e.target.value })}
                    />
                  </td>
                  <td className={styles.tdNum}>
                    <NumberField
                      label="" value={l.pct} step="1" min="0" max="100" suffix="%"
                      onCommit={v => setLayer(i, { pct: v })}
                    />
                  </td>
                  <td className={styles.tdNum}>
                    <NumberField
                      label="" value={l.price} step="0.01" min="0"
                      onCommit={v => setLayer(i, { price: v })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => removeLayer(i)}
                      title={`Remove ${l.label}`}
                    >&#215;</button>
                  </td>
                </tr>
              ))}
              <tr className={styles.layerTotal}>
                <th scope="row">Hedged</th>
                <td className={styles.tdNum}>{run.hedge.pct.toFixed(0)}%</td>
                <td className={styles.tdNum}>{price(run.hedge.price)}</td>
                <td />
              </tr>
              <tr className={styles.layerFloat}>
                <th scope="row">At index</th>
                <td className={styles.tdNum}>{(100 - run.hedge.pct).toFixed(0)}%</td>
                <td className={styles.tdNum}>market</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className={styles.rowActions}>
            <button type="button" className={styles.smallBtn} onClick={addLayer}>+ Add a layer</button>
            {run.hedge.over && <span className={styles.warn}>The layers add up to more than the volume, so they are clipped at 100%.</span>}
          </div>
        </div>
      </div>

{/* ── the volumes themselves ──────────────────────────────────
          The annual number and the shape are an estimate of what burns
          when. Real consumption, month by month, is the thing itself, so
          it wins wherever it is given and the page says which months
          have it. */}
      <div className={styles.volumeBlock}>
        <div className={styles.volumeHead}>
          <span className={styles.groupTitle}>
        Monthly consumption
        <span className={styles.groupHint}>
          {enteredVolumes
            ? `${enteredVolumes} of ${s.termMonths} month${s.termMonths === 1 ? '' : 's'} burn a volume you gave. ${volumeSummary(run.totals)}, ${vol(run.totals.volume)} Dth over the term.`
            : `Every month prices off the annual volume spread over the ${VOLUME_SHAPES[s.volumeShape].label.toLowerCase()} shape. Give a month its own volume and it uses that instead.`}
          {/* The look-back's volumes are counted apart from the
              term's, the way its saving is: real consumption behind
              the term is the thing worth entering there, and how
              much of it there is says how much of the look-back is
              measured rather than spread off an annual number. */}
          {hasBack && (backEntered
            ? ` Behind it, ${backEntered} of ${back} look-back month${back === 1 ? '' : 's'} do too: ${volumeSummary(run.historyTotals)}, ${vol(run.historyTotals.volume)} Dth over ${backSpan}.`
            : ` The ${back} month${back === 1 ? '' : 's'} of look-back behind it price the same way. Paste what actually burned and they use that instead.`)}
        </span>
          </span>
          <div className={styles.volumeActions}>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => { setVolumePaste(prev => (prev == null ? '' : null)); setVolumeError(''); }}
        >{volumePaste == null ? 'Paste volumes' : 'Close'}</button>
        <button type="button" className={styles.smallBtn} onClick={() => setShowVolumes(v => !v)}>
          {showVolumes ? 'Hide the months' : enteredVolumes ? 'Edit the months' : 'Enter them by month'}
        </button>
        {enteredVolumes > 0 && (
          <button type="button" className={styles.smallBtn} onClick={clearVolumes}>Clear</button>
        )}
          </div>
        </div>

        {volumePaste != null && (
          <div className={styles.pastePanel}>
        {/* Which end of the window the column lands on. Two buttons
            rather than a dropdown, because it is the one thing about
            this box that can be got wrong and it has to be readable
            without being opened. Only offered when there is a
            look-back to paste into. */}
        {hasBack && (
          <div className={styles.anchorRow}>
            <button
              type="button"
              className={volumeAnchor === 'term' ? styles.anchorBtnOn : styles.anchorBtn}
              onClick={() => { setVolumeAnchor('term'); setVolumeError(''); }}
            >The term</button>
            <button
              type="button"
              className={volumeAnchor === 'history' ? styles.anchorBtnOn : styles.anchorBtn}
              onClick={() => { setVolumeAnchor('history'); setVolumeError(''); }}
            >The months before it</button>
          </div>
        )}
        <div className={styles.fieldLabel}>
          {volumeAnchor === 'history' && hasBack
            ? 'Paste what burned before the term'
            : "Paste the term's volumes"}
          <span className={styles.fieldHint}>
            {volumeAnchor === 'history' && hasBack ? (
              <>
                One value per month, oldest first, ending at {backEnd.label} - the month before the term opens. Paste as many
                months as you have and they fill backwards from there, so eighteen months of bills land on the eighteen months
                behind the term whatever the look-back is set to. Anything older than {backStart.label} is held until you look
                further back.
              </>
            ) : (
              <>
                One value per month of the term, in the order it runs, starting at {run.months[0]?.label || 'the first month'}.
              </>
            )}
            {' '}A line each or one row copied across both work, a label in front of each number is ignored ("Jan 2027 3,100"), and
            so is a unit after it. A month label on a line of its own is read as a label rather than as a volume, so the boxes
            below copy back in as they stand. A blank leaves that month on the shape rather than reading it as a zero. This
            replaces the whole list.
          </span>
        </div>
        <textarea
          className={styles.textarea}
          rows={6}
          value={volumePaste}
          placeholder={`Month\tDth\n${(volumeAnchor === 'history' && hasBack
            ? run.history.slice(-3)
            : run.months.slice(0, 3)
          ).map((m, i) => `${m.label}\t${[3100, 2780, 2240][i].toLocaleString('en-US')}`).join('\n')}`}
          onChange={e => { setVolumePaste(e.target.value); setVolumeError(''); }}
        />
        {volumeError && <div className={styles.warn}>{volumeError}</div>}
        <div className={styles.rowActions}>
          <button type="button" className={styles.primaryBtn} onClick={loadVolumes} disabled={!volumePaste.trim()}>Load them</button>
          <button type="button" className={styles.smallBtn} onClick={() => { setVolumePaste(null); setVolumeError(''); }}>Cancel</button>
        </div>
          </div>
        )}

        {showVolumes && (
          <>
        {/* A calendar rather than a run of boxes: a row per month, a
            column per year, which is the shape consumption arrives
            in off a bill and off every spreadsheet anybody keeps it
            in. Reading last February against the February before it
            is then a glance sideways instead of a count of twelve.

            The term's columns are marked, because the table is laid
            out by the calendar while the volumes underneath are tied
            to the term, and which cells are the deal is the one
            thing the calendar cannot say by itself. */}
        <div className={styles.volumeSection}>
          <span className={styles.volumeSectionTitle}>
            Dth by month
            <span className={styles.volumeSectionHint}>
              {' '}{run.all[0]?.label} – {run.all[run.all.length - 1]?.label}
              {hasBack && ', the term ruled'}
            </span>
          </span>
          {moreYears > 0 && (
            <button
              type="button"
              className={styles.smallBtn}
              onClick={() => setAllVolumeYears(v => !v)}
            >
              {allVolumeYears
                ? `Show ${collapsedYears.length} years`
                : `Show all ${windowYears.length} years`}
            </button>
          )}
        </div>
        <div className={styles.calendarWrap}>
          <table className={styles.calendarTable}>
            <thead>
              <tr>
                <th className={styles.calendarCorner} />
                {shownYears.map(y => (
                  <th key={y} className={termYears.has(y) ? styles.calendarYearTerm : styles.calendarYear}>{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTH_NAMES.map((name, i) => {
                const month = i + 1;
                return (
                  <tr key={name}>
                    <th scope="row" className={styles.calendarMonth}>{name}</th>
                    {shownYears.map(y => {
                      const at = volumeSlots.get(monthKey(y, month));
                      // A month the window does not reach. Left
                      // blank rather than given a box: a box would
                      // invite a volume for a month nothing prices.
                      if (!at) return <td key={y} className={styles.calendarEmpty} />;
                      const list = at.list === 'history' ? (s.historyVolumes || []) : (s.monthlyVolumes || []);
                      return (
                        <td key={y} className={at.list === 'term' ? styles.calendarCellTerm : styles.calendarCell}>
                          <VolumeCell
                            value={list[at.slot] ?? null}
                            shaped={shapedVolume(month)}
                            title={`${name} ${y}, ${at.list === 'term' ? 'in the term' : 'in the look-back'}`}
                            onCommit={raw => setMonthVolume(at.list, at.slot, raw)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.fieldNote}>
          A box left empty prices off the annual volume and the shape, which is the number shown greyed in it. A month the window
          does not reach has no box at all. The table is laid out by the calendar, but what it holds is still tied to the term:
          month one is always the month the term opens, so re-dating the term carries these volumes with it and they land on
          different cells.
          {hasBack && ' The look-back\u2019s are tied to the term from the other end, so the last of them is always the month before it opens: looking further back adds months at the old end and moves nothing you have typed.'}
          {volumesPastTerm > 0 && ` ${volumesPastTerm} more volume${volumesPastTerm === 1 ? '' : 's'} than the term runs ${volumesPastTerm === 1 ? 'is' : 'are'} held past its end, unused until the term is lengthened.`}
          {volumesPastBack > 0 && ` ${volumesPastBack} more look-back volume${volumesPastBack === 1 ? '' : 's'} than the look-back reaches ${volumesPastBack === 1 ? 'is' : 'are'} held behind it, unused until you look further back.`}
        </div>
          </>
        )}
      </div>

      {/* ── the answer ────────────────────────────────────────────────── */}
      <div className={styles.tiles}>
        <Tile
          label="Saving over the term"
          value={usd(run.totals.saving)}
          sub={`${pct(run.totals.savingPct)} of the index bill`}
          tone={savingTone}
          title="What the same volume costs at index, less what it costs on this contract."
        />
        <Tile
          label="Per Dth"
          value={price(run.totals.savingPerDth)}
          sub={`over ${vol(run.totals.volume)} Dth`}
          tone={savingTone}
        />
        <Tile
          label="At index"
          value={usd(run.totals.indexCost)}
          sub={`${price(run.totals.avgIndexAllIn)} all-in`}
        />
        <Tile
          label="On this contract"
          value={usd(run.totals.contractCost)}
          sub={`${price(run.totals.avgContractAllIn)} all-in`}
        />
        <Tile
          label="Hedged"
          value={`${run.hedge.pct.toFixed(0)}%`}
          sub={run.hedge.price == null ? 'nothing locked' : `at ${price(run.hedge.price)}`}
        />
        <Tile
          label="Strike vs the record"
          value={strikeRank == null ? '-' : ordinal(strikeRank * 100)}
          sub={strikeRank == null ? 'no hedge to rank' : `${pct(strikeRank, 0)} of months settled at or below it`}
          title="Where the blended strike sits in every settle on the table above."
        />
        <Tile
          label="Term"
          value={`${s.termMonths} mo`}
          sub={run.months.length
            ? `${run.months[0].label} to ${run.months[run.months.length - 1].label}`
            : '-'}
        />
        <Tile
          label="Priced off the market"
          value={`${run.totals.pricedMonths} of ${s.termMonths}`}
          sub={sourceSummary(run.totals)}
          tone={run.totals.assumedMonths ? 'warn' : 'plain'}
          title={`Months with a settle or a quote behind them. The rest price at the flat assumption of ${price(s.forwardPrice)}, which is the only one of the three that is nobody's price.`}
        />
        {/* The look-back, reported apart from the term rather than added to
            it. The two are different claims - one is a deal being decided,
            the other is market that already settled - and a headline that
            ran them together would let a forward deal take the credit for a
            backtest. The third tile adds them, once, and says so. */}
        {hasBack && (
          <>
            <Tile
              label="Over the look-back"
              value={usd(run.historyTotals.saving)}
              sub={`${back} mo, ${backSpan}`}
              tone={backTone}
              title="What the same hedge, the same layers and the same basis and adder would have done over the months before the term. A backtest, not part of the deal."
            />
            <Tile
              label="Measured, not quoted"
              value={`${run.historyTotals.settledMonths} of ${back}`}
              sub={sourceSummary(run.historyTotals)}
              tone={run.historyTotals.assumedMonths ? 'warn' : 'plain'}
              title="Look-back months with a settle behind them. A look-back that runs past the last settle is quoted off the curve like any other month, and then it is a forecast rather than a measurement."
            />
            <Tile
              label="Look-back and term"
              value={usd(run.allTotals.saving)}
              sub={`${run.allTotals.months} months, ${vol(run.allTotals.volume)} Dth`}
              tone={run.allTotals.saving >= 0 ? 'good' : 'bad'}
            />
          </>
        )}
      </div>

      <div className={styles.rowActions}>
        <button type="button" className={styles.smallBtn} onClick={copySummary}>Copy the summary</button>
        <button type="button" className={styles.smallBtn} onClick={() => setShowMonths(v => !v)}>
          {showMonths ? 'Hide the month by month' : 'Show the month by month'}
        </button>
        {/* A look-back can run for decades, and the term is still the thing
            being decided, so the charts below stay one click from showing it
            on its own. */}
        {hasBack && (
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => setChartSpan(v => (v === 'window' ? 'term' : 'window'))}
            title="Whether the three charts below draw the look-back and the term together, or the term on its own."
          >
            {wholeWindow ? 'Chart the term on its own' : 'Chart the whole window'}
          </button>
        )}
        {/* Next to the toggle rather than inside the table, so it is there
            whether or not the months are open. */}
        <button
          type="button"
          className={styles.smallBtn}
          onClick={exportMonths}
          title="Every month of the term as a spreadsheet: index and contract all-in, the volume, what each leg costs and the saving running, with the scenario on a second sheet."
        >Export the months to Excel</button>
        {hasBack && (
          <span className={styles.muted}>
            The look-back runs {backSpan}, priced off the same tables: {sourceSummary(run.historyTotals)}.
            {' '}Its saving is what this hedge would have done over months that have already happened, so it is reported beside the
            term rather than inside it.
          </span>
        )}
        {(run.totals.forwardMonths > 0 || run.totals.assumedMonths > 0) && (
          <span className={styles.muted}>
            The settles run out at {run.lastSettled?.label || 'the end of the table'}.
            {run.totals.forwardMonths > 0 && ` ${run.totals.forwardMonths} month${run.totals.forwardMonths === 1 ? ' is' : 's are'} priced off the curve (${forwardAsOf}).`}
            {run.totals.assumedMonths > 0 && ` ${run.totals.assumedMonths} month${run.totals.assumedMonths === 1 ? '' : 's'} neither table reaches, priced flat at ${price(s.forwardPrice)}.`}
          </span>
        )}
      </div>

      {/* ── the numbers, above the pictures ───────────────────────────── */}
      {/* Ahead of the charts rather than under them: this is the table
          somebody reads off to a customer, and a year row is the unit both
          sides of that conversation budget in. The charts argue the case;
          this is the case. */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitle}>Year by year</div>
        </div>
        {hasBack && (
          <div className={styles.cardNote}>
            The term first, then the record behind it. A year the term opens or closes in appears in both, counting only the months it
            holds in each, so the two blocks add up to the pair on the last row.
          </div>
        )}
        <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Year</th>
                <th className={styles.thNum}>Months</th>
                <th className={styles.thNum}>Volume (Dth)</th>
                <th className={styles.thNum}>Avg index</th>
                <th className={styles.thNum}>At index</th>
                <th className={styles.thNum}>On contract</th>
                <th className={styles.thNum}>Saving</th>
                <th className={styles.thNum}>Per Dth</th>
              </tr>
            </thead>
            <tbody>
              {/* The term first, with its own total under it. Chronological
                  order across the whole window would open this table on 1990
                  and bury the two or three years of the deal thirty-seven
                  rows down a scroll, which is the opposite of what a table
                  at the top of the page is for.

                  A year the term opens or closes in appears in BOTH groups,
                  because it genuinely holds months of both: `years` counts
                  only its term months and `historyYears` only its look-back
                  ones, so the two groups add up to the pair exactly and
                  neither row carries months it is not about. One row with
                  combined figures and a flag would be a number that belongs
                  to neither reading. */}
              {hasBack && (
                <tr className={styles.groupRow}>
                  <th scope="row" colSpan={8}>
                    The term
                    <span className={styles.groupRowHint}>
                      {run.months[0]?.label} – {run.months[run.months.length - 1]?.label}, {s.termMonths} month{s.termMonths === 1 ? '' : 's'}
                    </span>
                  </th>
                </tr>
              )}
              {run.years.map(y => (
                <tr key={`term-${y.year}`} className={hasBack ? styles.termRow : undefined}>
                  <th scope="row">
                    {y.year}
                    {y.forward > 0 && (
                      <span className={styles.curveFlag} title={`${y.forward} of this year's ${y.months} months are priced off the forward curve`}>{y.forward} curve</span>
                    )}
                    {y.assumed > 0 && (
                      <span className={styles.assumedFlag} title={`${y.assumed} of this year's ${y.months} months are priced at the flat assumption`}>{y.assumed} flat</span>
                    )}
                  </th>
                  <td className={styles.tdNum}>{y.months}</td>
                  <td className={styles.tdNum}>{vol(y.volume)}</td>
                  <td className={styles.tdNum}>{price(y.avgIndex)}</td>
                  <td className={styles.tdNum}>{usd(y.indexCost)}</td>
                  <td className={styles.tdNum}>{usd(y.contractCost)}</td>
                  <td className={y.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(y.saving)}</td>
                  <td className={y.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(y.savingPerDth)}</td>
                </tr>
              ))}
              <tr className={hasBack ? styles.subTotalRow : styles.totalRow}>
                <th scope="row">Term</th>
                <td className={styles.tdNum}>{run.months.length}</td>
                <td className={styles.tdNum}>{vol(run.totals.volume)}</td>
                <td className={styles.tdNum}>{price(run.totals.avgIndex)}</td>
                <td className={styles.tdNum}>{usd(run.totals.indexCost)}</td>
                <td className={styles.tdNum}>{usd(run.totals.contractCost)}</td>
                <td className={run.totals.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(run.totals.saving)}</td>
                <td className={run.totals.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(run.totals.savingPerDth)}</td>
              </tr>

              {hasBack && (
                <tr className={styles.groupRow}>
                  <th scope="row" colSpan={8}>
                    Before the term
                    <span className={styles.groupRowHint}>
                      {backSpan}, {back} month{back === 1 ? '' : 's'}, the same hedge against market that has already settled
                    </span>
                  </th>
                </tr>
              )}
              {hasBack && run.historyYears.map(y => (
                <tr key={`back-${y.year}`} className={styles.backRow}>
                  <th scope="row">
                    {y.year}
                    {y.forward > 0 && (
                      <span className={styles.curveFlag} title={`${y.forward} of this year's ${y.months} months are priced off the forward curve`}>{y.forward} curve</span>
                    )}
                    {y.assumed > 0 && (
                      <span className={styles.assumedFlag} title={`${y.assumed} of this year's ${y.months} months are priced at the flat assumption`}>{y.assumed} flat</span>
                    )}
                  </th>
                  <td className={styles.tdNum}>{y.months}</td>
                  <td className={styles.tdNum}>{vol(y.volume)}</td>
                  <td className={styles.tdNum}>{price(y.avgIndex)}</td>
                  <td className={styles.tdNum}>{usd(y.indexCost)}</td>
                  <td className={styles.tdNum}>{usd(y.contractCost)}</td>
                  <td className={y.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(y.saving)}</td>
                  <td className={y.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(y.savingPerDth)}</td>
                </tr>
              ))}
              {hasBack && (
                <tr className={styles.subTotalRow}>
                  <th scope="row">Look-back</th>
                  <td className={styles.tdNum}>{back}</td>
                  <td className={styles.tdNum}>{vol(run.historyTotals.volume)}</td>
                  <td className={styles.tdNum}>{price(run.historyTotals.avgIndex)}</td>
                  <td className={styles.tdNum}>{usd(run.historyTotals.indexCost)}</td>
                  <td className={styles.tdNum}>{usd(run.historyTotals.contractCost)}</td>
                  <td className={run.historyTotals.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(run.historyTotals.saving)}</td>
                  <td className={run.historyTotals.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(run.historyTotals.savingPerDth)}</td>
                </tr>
              )}
              {hasBack && (
                <tr className={styles.totalRow}>
                  <th scope="row">Both</th>
                  <td className={styles.tdNum}>{run.allTotals.months}</td>
                  <td className={styles.tdNum}>{vol(run.allTotals.volume)}</td>
                  <td className={styles.tdNum}>{price(run.allTotals.avgIndex)}</td>
                  <td className={styles.tdNum}>{usd(run.allTotals.indexCost)}</td>
                  <td className={styles.tdNum}>{usd(run.allTotals.contractCost)}</td>
                  <td className={run.allTotals.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(run.allTotals.saving)}</td>
                  <td className={run.allTotals.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(run.allTotals.savingPerDth)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── the record, and where this contract sits in it ────────────── */}
      <ChartCard
        title={`Henry Hub, ${series.length ? series[0].year : ''} to ${curve.length ? curve[curve.length - 1].year : (series.length ? series[series.length - 1].year : '')}`}
        note={`Settled months solid, the forward curve dashed (${forwardAsOf}). The shaded strip is the term; the rule is the blended strike, so the question of whether this is a good price is answered against the whole record rather than against last winter.`}
        legend={<LegendKey items={[
          { label: 'Settled', color: INDEX_COLOR },
          { label: 'Forward curve', color: INDEX_COLOR, dash: true },
        ]} />}
      >
        <div className={styles.chartBox}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={historyData} margin={{ top: 8, right: 88, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="key"
                tick={{ fontSize: 10, fill: AXIS_TEXT }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={44}
                tickFormatter={k => k.slice(0, 4)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: AXIS_TEXT }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={v => `$${v}`}
              />
              {termBandStart && termBandEnd && (
                <ReferenceArea x1={termBandStart} x2={termBandEnd} fill={CONTRACT_COLOR} fillOpacity={0.09} />
              )}
              {run.hedge.price != null && (
                <ReferenceLine
                  y={run.hedge.price}
                  stroke={CONTRACT_COLOR}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  label={{
                    value: `strike ${price(run.hedge.price, 2)}`,
                    position: 'right',
                    fill: CONTRACT_COLOR,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                />
              )}
              <Tooltip
                content={<ChartTip format={v => `${price(v)} ${NYMEX_UNIT}`} />}
                cursor={{ stroke: AXIS_TEXT, strokeDasharray: '3 3' }}
              />
              <Line
                type="monotone"
                dataKey="settle"
                name="Settled"
                stroke={INDEX_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="forward"
                name="Forward curve"
                stroke={INDEX_COLOR}
                strokeWidth={2}
                strokeDasharray={FORWARD_DASH}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* ── the term, priced twice ────────────────────────────────────── */}
      <div className={styles.chartGrid}>
        <ChartCard
          title={wholeWindow ? 'Look-back and term: index against this contract' : 'Over the term: index against this contract'}
          note={`All-in ${NYMEX_UNIT}, basis and adder included on both. Priced from: ${sourceSummary(wholeWindow ? run.allTotals : run.totals)}.${wholeWindow ? ' The rule marks where the term opens; everything left of it is settled record.' : ''}`}
          legend={<LegendKey items={[{ label: 'At index', color: INDEX_COLOR }, { label: 'This contract', color: CONTRACT_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={chartData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={chartTicks}
                  interval={0}
                  tickFormatter={k => shortByKey.get(k) || k}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={v => `$${v.toFixed(2)}`}
                />
                {/* Two different shades for two different claims: the
                    stretch priced off the curve, and the stretch priced off
                    one flat number because neither table reaches it. */}
                {sourceBands.map(band => (
                  <ReferenceArea
                    key={`${band.source}-${band.x1}`}
                    x1={band.x1}
                    x2={band.x2}
                    fill={BAND_STYLE[band.source].fill}
                    fillOpacity={BAND_STYLE[band.source].fillOpacity}
                    label={bandLabel(band)}
                  />
                ))}
                <Tooltip
                  content={(
                    <ChartTip
                      format={v => `${price(v)} ${NYMEX_UNIT}`}
                      footer={row => (row?.source === 'settled' ? null : (
                        <div className={styles.tipNote}>
                          {row?.source === 'forward' ? 'priced off the forward curve' : 'priced at the flat assumption'}
                        </div>
                      ))}
                    />
                  )}
                  cursor={{ stroke: AXIS_TEXT, strokeDasharray: '3 3' }}
                />
                {termMark}
                <Legend wrapperStyle={{ display: 'none' }} />
                <Line type="monotone" dataKey="index" name="At index" stroke={INDEX_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
                <Line type="monotone" dataKey="contract" name="This contract" stroke={CONTRACT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="What it has saved, running total"
          note={wholeWindow
            ? 'Index bill less contract bill, accumulated across the look-back and on through the term. The rule marks where the term opens.'
            : 'Index bill less contract bill, accumulated across the term.'}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="savings-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SAVED_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SAVED_COLOR} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={chartTicks}
                  interval={0}
                  tickFormatter={k => shortByKey.get(k) || k}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={usdShort}
                />
                <ReferenceLine y={0} stroke={AXIS_TEXT} strokeWidth={1} />
                {termMark}
                <Tooltip
                  content={<ChartTip format={v => usd(v)} />}
                  cursor={{ stroke: AXIS_TEXT, strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name="Saved so far"
                  stroke={SAVED_COLOR}
                  strokeWidth={2}
                  fill="url(#savings-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Which months paid for it"
          note={`One bar per month${wholeWindow ? ' of the look-back and the term' : ''}. Below the line is a month the market came in under the strike and the hedge cost money.`}
          legend={<LegendKey items={[{ label: 'Hedge saved', color: SAVED_COLOR }, { label: 'Hedge cost', color: COST_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chartData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={chartTicks}
                  interval={0}
                  tickFormatter={k => shortByKey.get(k) || k}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={usdShort}
                />
                <ReferenceLine y={0} stroke={AXIS_TEXT} strokeWidth={1} />
                {termMark}
                <Tooltip
                  content={<ChartTip format={v => usd(v)} />}
                  cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                />
                {/* The corner radius is dropped once the bars are hairlines,
                    which is what four hundred months of look-back makes them:
                    rounding a one-pixel bar turns the chart into a row of
                    dots that all read as the same height. */}
                <Bar
                  dataKey="saving"
                  name="Saving"
                  radius={chartData.length > 72 ? 0 : [4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  {chartData.map(row => (
                    <Cell key={row.key} fill={row.saving >= 0 ? SAVED_COLOR : COST_COLOR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="How long to go for"
          note={`The same hedge and the same start, run for ${TERM_LADDER.join(', ')} months. Hover a bar for where its prices come from.`}
          legend={<LegendKey items={[{ label: 'Hedge saved', color: SAVED_COLOR }, { label: 'Hedge cost', color: COST_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart
                data={ladder.map(r => ({ ...r, label: `${r.termMonths} months` }))}
                layout="vertical"
                margin={{ top: 8, right: 56, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  tickFormatter={usdShort}
                />
                <YAxis
                  type="category"
                  dataKey="termMonths"
                  tick={{ fontSize: 11, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={v => `${v} mo`}
                />
                <ReferenceLine x={0} stroke={AXIS_TEXT} strokeWidth={1} />
                <Tooltip
                  content={(
                    <ChartTip
                      format={v => usd(v)}
                      footer={row => (
                        <div className={styles.tipNote}>
                          {price(row?.savingPerDth)} a Dth · {row?.sources}
                        </div>
                      )}
                    />
                  )}
                  cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                />
                <Bar dataKey="saving" name="Saving" radius={[0, 4, 4, 0]} isAnimationActive={false}
                  label={{
                    position: 'right',
                    fontSize: 10,
                    fontWeight: 700,
                    fill: AXIS_TEXT,
                    formatter: usdShort,
                  }}
                >
                  {ladder.map(r => (
                    <Cell key={r.termMonths} fill={r.saving >= 0 ? SAVED_COLOR : COST_COLOR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {showMonths && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Month by month</div>
          </div>
          {hasBack && (
            <div className={styles.cardNote}>
              The look-back first, then the term, with the term&rsquo;s opening month marked. The running column carries straight
              across both, so the figure on the last row is the pair rather than the term on its own; the term&rsquo;s own saving is
              in the tiles above and on the Term row of the table before this one.
            </div>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className={styles.thNum}>Index</th>
                  <th className={styles.thNum}>Index all-in</th>
                  <th className={styles.thNum}>Contract all-in</th>
                  <th className={styles.thNum}>Volume (Dth)</th>
                  <th className={styles.thNum}>At index</th>
                  <th className={styles.thNum}>On contract</th>
                  <th className={styles.thNum}>Saving</th>
                  <th className={styles.thNum}>Running</th>
                </tr>
              </thead>
              <tbody>
                {(hasBack ? run.all : run.months).map(m => (
                  <tr
                    key={m.key}
                    className={m.source === 'assumed'
                      ? styles.assumedRow
                      : (hasBack && m.phase === 'history' ? styles.backRow : undefined)}
                  >
                    <th scope="row">
                      {m.label}
                      {/* Named once, on the month the term opens, rather than
                          on every row: a flag on four hundred rows is
                          wallpaper, and the one place a reader needs to find
                          is where one reading becomes the other. */}
                      {hasBack && m.key === run.months[0]?.key && (
                        <span className={styles.backFlag} title="The term opens here. Everything above is the look-back.">term opens</span>
                      )}
                      {m.source === 'forward' && (
                        <span className={styles.curveFlag} title={`No settle for this month yet, so it is priced off the forward curve (${forwardAsOf})`}>curve</span>
                      )}
                      {m.source === 'assumed' && (
                        <span className={styles.assumedFlag} title="Neither the settles nor the curve reach this month, so it is priced at the flat assumption">flat</span>
                      )}
                    </th>
                    <td className={styles.tdNum}>{price(m.index)}</td>
                    <td className={styles.tdNum}>{price(m.indexAllIn)}</td>
                    <td className={styles.tdNum}>{price(m.contractAllIn)}</td>
                    <td className={styles.tdNum}>
                      {vol(m.volume)}
                      {/* Only where the term MIXES the two. With nothing
                          entered every row would carry the same flag, which
                          says less than the one line above the table does. */}
                      {(enteredVolumes > 0 || backEntered > 0) && m.volumeSource === 'shape' && (
                        <span className={styles.shapeFlag} title="No volume given for this month, so it prices off the annual volume spread over the shape">shape</span>
                      )}
                    </td>
                    <td className={styles.tdNum}>{usd(m.indexCost)}</td>
                    <td className={styles.tdNum}>{usd(m.contractCost)}</td>
                    <td className={m.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(m.saving)}</td>
                    <td className={styles.tdNum}>{usd(hasBack ? m.cumulativeAll : m.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={styles.footNote}>
        {hasBack && `The look-back is the months before the term run through the same hedge, the same layers and the same basis and adder, as far back as the settle table reaches. It is a backtest: what this contract would have done against market that has already settled, which is a different claim from what it will do against market that has not. So it is counted, charted and exported beside the term rather than inside it, and the term's own saving means exactly what it meant before there was a look-back. `}
        Savings are the same volume priced twice: once at the market price for the month, once at what this contract charges after its hedge layers. That volume is whatever you gave the month, and the annual number spread over the shape wherever you gave none, which every table says per month. Basis and the retail adder sit on both legs, so they move the bill and not the saving. Each month takes the best price there is for it, in this order: the settle, then the forward curve, then one flat assumption where neither reaches. Every chart, table and tile says which, because a saving measured against a settle and a saving quoted off a curve are different claims. A curve also goes stale in a way a settle never does, so the date it was quoted at travels with it.
        {!hasSavedSavings(settings) && settingsLoaded && ' Nothing is saved yet, so this is the shipped table and a worked example. The first thing you change saves a copy of your own.'}
      </div>
      </>
      )}

      {/* ── a whole list of renewals: the Site pricing subtab ─────────── */}
      {/* The same tables underneath as the contract subtab, so the two
          always agree about what a month cost. */}
      {section === 'sites' && (
      <>
      <SitePricingPanel
        settings={settings}
        settingsLoaded={settingsLoaded}
        updateSettings={updateSettings}
        series={series}
        forward={curve}
        flatPrice={s.forwardPrice}
        forwardAsOf={forwardAsOf}
      />

      <div className={styles.footNote}>
        Every term in the sheet is priced off the tables at the top of this page: the settles wherever they reach, the forward curve past them, and the flat assumption past both. Each row says which mix it used, because a term averaged off settles and a term quoted off a curve are different claims. The split between market and deal is the number the sheet cannot produce on its own, and the two add back up to the net.
      </div>
      </>
      )}
    </div>
  );
}

export default SavingsPanel;
