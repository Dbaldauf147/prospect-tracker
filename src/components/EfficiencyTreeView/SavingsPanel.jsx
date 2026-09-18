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
  parseForwardTable, parseNymexTable, percentileRank, priceStats, sourceSummary, termLadder, yearRows,
  addMonths, monthKey,
} from '../../utils/nymexSavings.js';
import { downloadSavingsMonths } from '../../utils/savingsExport.js';

// The Savings subtab on Service Deep Dives: load the NYMEX record, describe a
// contract and its hedge layers, and see what the hedge is worth over the
// term.
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
function NumberField({ label, hint, value, step = 'any', min, max, suffix, onCommit, width }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? String(value ?? '');
  const commit = () => { if (draft !== null) onCommit(draft); setDraft(null); };
  return (
    <label className={styles.field} style={width ? { width } : undefined}>
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

export function SavingsPanel({ settings = {}, settingsLoaded = false, updateSettings }) {
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

  const termData = run.months.map(m => ({
    key: m.key, label: m.label, short: m.short, assumed: m.assumed, source: m.source,
    index: m.indexAllIn, contract: m.contractAllIn,
    saving: m.saving, cumulative: m.cumulative, volume: m.volume,
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
    for (const m of run.months) {
      const last = bands[bands.length - 1];
      if (last && last.source === m.source) { last.x2 = m.key; last.count += 1; continue; }
      bands.push({ source: m.source, x1: m.key, x2: m.key, count: 1 });
    }
    return bands.filter(band => band.source !== 'settled');
  }, [run.months]);

  const BAND_STYLE = {
    forward: { fill: INDEX_COLOR, fillOpacity: 0.06, text: 'forward curve' },
    assumed: { fill: AXIS_TEXT, fillOpacity: 0.1, text: 'flat' },
  };
  // A band gets a label only when there is room for one and it is not the
  // whole term - a label on a one-month run lands on its neighbour, and a
  // label on the whole term lands on the y axis while saying nothing the
  // note above the chart does not.
  const bandLabel = (band) => (band.count >= 5 && band.count < run.months.length
    ? { value: BAND_STYLE[band.source].text, position: 'insideTop', fill: AXIS_TEXT, fontSize: 9, fontWeight: 700 }
    : undefined);

  // Recharts samples ticks by width, which can drop every January - and
  // January is the only label carrying a year. So the ticks are chosen
  // rather than sampled: the Januaries, plus the first month of the term so
  // that a term shorter than a year still says when it runs.
  const termTicks = useMemo(() => {
    // A short label carries a year only in January, so those are the anchors.
    // The first month of the term joins them only when the term holds no
    // January at all, because a term opening in October would otherwise put
    // its label hard against the one three months later.
    const januaries = run.months.filter(m => m.month === 1);
    const picks = januaries.length ? januaries : run.months.slice(0, 1);
    // Still too many to read on a long term, so thin them evenly.
    const stride = Math.ceil(picks.length / 8) || 1;
    return picks.filter((_, i) => i % stride === 0).map(m => m.key);
  }, [run.months]);

  // Key to the label shown under it. The axis plots the unique month; this
  // turns it back into something short enough to read.
  const shortByKey = useMemo(() => new Map(run.months.map(m => [m.key, m.short])), [run.months]);

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
          <span className={styles.barFacts}>
            {stats
              ? `${stats.count.toLocaleString('en-US')} months, ${series[0].label} to ${series[series.length - 1].label} · low ${price(stats.min)} · median ${price(stats.median)} · high ${price(stats.max)}`
              : 'No settles loaded.'}
          </span>
          <span className={custom ? styles.pillCustom : styles.pillShipped}>
            {custom ? `Yours${state.loadedAt ? `, loaded ${state.loadedAt}` : ''}` : 'Shipped'}
          </span>
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.smallBtn} onClick={() => openPaste('settles')}>
            {pasteKind === 'settles' ? 'Close' : 'Load settles'}
          </button>
          {custom && <button type="button" className={styles.smallBtn} onClick={resetTable}>Reset</button>}
          <button type="button" className={styles.smallBtn} onClick={() => setShowHistory(v => !v)}>
            {showHistory ? 'Hide the table' : 'Show the table'}
          </button>
        </div>
      </div>

      {/* The curve gets a row of its own rather than a line in the settles
          row, because it is the table that goes stale: the date it was
          quoted at belongs beside it, not in a tooltip. */}
      <div className={styles.bar}>
        <div className={styles.barMain}>
          <span className={styles.barTitle}>Forward curve</span>
          <span className={styles.barFacts}>
            {curve.length
              ? `${curve.length} month${curve.length === 1 ? '' : 's'}, ${curve[0].label} to ${curve[curve.length - 1].label} · low ${price(curveStats.min)} · avg ${price(curveStats.mean)} · high ${price(curveStats.max)}`
              : 'No curve loaded, so every month past the last settle prices at the flat assumption.'}
          </span>
          <span className={customForward ? styles.pillCustom : styles.pillShipped}>{forwardAsOf}</span>
          {gapMonths > 0 && (
            <span className={styles.pillGap} title="Neither table covers these months, so they price at the flat assumption. Paste a curve that starts earlier to close the gap.">
              {gapMonths} month{gapMonths === 1 ? '' : 's'} uncovered
            </span>
          )}
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.smallBtn} onClick={() => openPaste('forward')}>
            {pasteKind === 'forward' ? 'Close' : 'Load curve'}
          </button>
          {customForward && <button type="button" className={styles.smallBtn} onClick={resetCurve}>Reset</button>}
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

      {/* ── the contract ──────────────────────────────────────────────── */}
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
            <NumberField
              label="Forward assumption" hint="months with no settle yet" width="11rem" step="0.01" suffix={NYMEX_UNIT}
              value={s.forwardPrice} onCommit={v => patchScenario({ forwardPrice: v })}
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
      </div>

      <div className={styles.rowActions}>
        <button type="button" className={styles.smallBtn} onClick={copySummary}>Copy the summary</button>
        <button type="button" className={styles.smallBtn} onClick={() => setShowMonths(v => !v)}>
          {showMonths ? 'Hide the month by month' : 'Show the month by month'}
        </button>
        {/* Next to the toggle rather than inside the table, so it is there
            whether or not the months are open. */}
        <button
          type="button"
          className={styles.smallBtn}
          onClick={exportMonths}
          title="Every month of the term as a spreadsheet: index and contract all-in, the volume, what each leg costs and the saving running, with the scenario on a second sheet."
        >Export the months to Excel</button>
        {(run.totals.forwardMonths > 0 || run.totals.assumedMonths > 0) && (
          <span className={styles.muted}>
            The settles run out at {run.lastSettled?.label || 'the end of the table'}.
            {run.totals.forwardMonths > 0 && ` ${run.totals.forwardMonths} month${run.totals.forwardMonths === 1 ? ' is' : 's are'} priced off the curve (${forwardAsOf}).`}
            {run.totals.assumedMonths > 0 && ` ${run.totals.assumedMonths} month${run.totals.assumedMonths === 1 ? '' : 's'} neither table reaches, priced flat at ${price(s.forwardPrice)}.`}
          </span>
        )}
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
          title="Over the term: index against this contract"
          note={`All-in ${NYMEX_UNIT}, basis and adder included on both. Priced from: ${sourceSummary(run.totals)}.`}
          legend={<LegendKey items={[{ label: 'At index', color: INDEX_COLOR }, { label: 'This contract', color: CONTRACT_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={termData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={termTicks}
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
                <Legend wrapperStyle={{ display: 'none' }} />
                <Line type="monotone" dataKey="index" name="At index" stroke={INDEX_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
                <Line type="monotone" dataKey="contract" name="This contract" stroke={CONTRACT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="What it has saved, running total"
          note="Index bill less contract bill, accumulated across the term."
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={termData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
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
                  ticks={termTicks}
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
          note="One bar per month. Below the line is a month the market came in under the strike and the hedge cost money."
          legend={<LegendKey items={[{ label: 'Hedge saved', color: SAVED_COLOR }, { label: 'Hedge cost', color: COST_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={termData} margin={{ top: 8, right: 32, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={termTicks}
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
                <Tooltip
                  content={<ChartTip format={v => usd(v)} />}
                  cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                />
                <Bar dataKey="saving" name="Saving" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {termData.map(row => (
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

      {/* ── the numbers behind the pictures ───────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitle}>Year by year</div>
        </div>
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
              {run.years.map(y => (
                <tr key={y.year}>
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
              <tr className={styles.totalRow}>
                <th scope="row">Term</th>
                <td className={styles.tdNum}>{run.months.length}</td>
                <td className={styles.tdNum}>{vol(run.totals.volume)}</td>
                <td className={styles.tdNum}>{price(run.totals.avgIndex)}</td>
                <td className={styles.tdNum}>{usd(run.totals.indexCost)}</td>
                <td className={styles.tdNum}>{usd(run.totals.contractCost)}</td>
                <td className={run.totals.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(run.totals.saving)}</td>
                <td className={run.totals.saving >= 0 ? styles.tdGood : styles.tdBad}>{price(run.totals.savingPerDth)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {showMonths && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Month by month</div>
          </div>
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
                {run.months.map(m => (
                  <tr key={m.key} className={m.source === 'assumed' ? styles.assumedRow : undefined}>
                    <th scope="row">
                      {m.label}
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
                    <td className={styles.tdNum}>{vol(m.volume)}</td>
                    <td className={styles.tdNum}>{usd(m.indexCost)}</td>
                    <td className={styles.tdNum}>{usd(m.contractCost)}</td>
                    <td className={m.saving >= 0 ? styles.tdGood : styles.tdBad}>{usd(m.saving)}</td>
                    <td className={styles.tdNum}>{usd(m.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* A whole list of sites, against the one contract above it. Same
          tables underneath, so the two always agree about what a month
          costs. */}
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
        Savings are the same volume priced twice: once at the market price for the month, once at what this contract charges after its hedge layers. Basis and the retail adder sit on both legs, so they move the bill and not the saving. Each month takes the best price there is for it, in this order: the settle, then the forward curve, then one flat assumption where neither reaches. Every chart, table and tile says which, because a saving measured against a settle and a saving quoted off a curve are different claims. A curve also goes stale in a way a settle never does, so the date it was quoted at travels with it.
        {!hasSavedSavings(settings) && settingsLoaded && ' Nothing is saved yet, so this is the shipped table and a worked example. The first thing you change saves a copy of your own.'}
      </div>
    </div>
  );
}

export default SavingsPanel;
