import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import styles from './SavingsPanel.module.css';
import { NYMEX_MONTH_LABELS, NYMEX_UNIT } from '../../data/nymexHistory.js';
import {
  SAVINGS_KEY, SHIPPED_SETTLES, TERM_LADDER, VOLUME_SHAPES,
  buildSavings, getSavingsState, hasSavedSavings, monthlySeries, normalizeSavingsState, parseNymexTable,
  percentileRank, priceStats, termLadder, yearRows, addMonths, monthKey,
} from '../../utils/nymexSavings.js';

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
// Everything is priced off the settle table above it, so a term in the past
// is a measurement and a term in the future is priced at the forward
// assumption and marked. The page never quietly mixes the two.

const SAVE_DELAY_MS = 800;

// Two series, one job each: what the market did, and what the contract
// charges for it. Warm against cool so the pair survives colour blindness
// (checked, worst case deutan/protan dE 20) and both carry a direct label at
// the end of the line as well.
const INDEX_COLOR = '#C2410C';
const CONTRACT_COLOR = '#0369A1';
// Polarity, not identity: a month the hedge paid for itself against a month
// it cost money. Never used for a series.
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
      <div className={tone === 'good' ? styles.tileValueGood : tone === 'bad' ? styles.tileValueBad : styles.tileValue}>{value}</div>
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
          <span className={styles.legendSwatch} style={{ background: it.color }} aria-hidden="true" />
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
  const [pasteOpen, setPasteOpen] = useState(false);
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
  const series = useMemo(() => monthlySeries(settles), [settles]);
  const stats = useMemo(() => priceStats(series), [series]);
  const run = useMemo(() => buildSavings(state.scenario, series), [state.scenario, series]);
  const ladder = useMemo(() => termLadder(state.scenario, series), [state.scenario, series]);
  const history = useMemo(() => yearRows(settles), [settles]);
  const s = run.scenario;
  const strikeRank = run.hedge.price == null ? null : percentileRank(series, run.hedge.price);

  const termStart = { year: s.startYear, month: s.startMonth };
  const termEnd = addMonths(s.startYear, s.startMonth, s.termMonths - 1);
  const termStartKey = monthKey(termStart.year, termStart.month);
  const termEndKey = monthKey(termEnd.year, termEnd.month);

  // The whole record, thinned for the axis but not for the line: every settle
  // is still a point, only the labels are sampled.
  const historyData = useMemo(() => series.map(p => ({
    key: p.key, label: p.label, year: p.year, month: p.month, price: p.price,
  })), [series]);

  const termData = run.months.map(m => ({
    key: m.key, label: m.label, short: m.short, assumed: m.assumed,
    index: m.indexAllIn, contract: m.contractAllIn,
    saving: m.saving, cumulative: m.cumulative, volume: m.volume,
  }));

  // Where the term sits inside the history chart, so the strip of market the
  // contract actually covers is visible rather than described.
  const termBandStart = series.find(p => p.key >= termStartKey)?.key;
  const termBandEnd = [...series].reverse().find(p => p.key <= termEndKey)?.key;

  const firstAssumed = run.months.find(m => m.assumed);

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
    return picks.filter((_, i) => i % stride === 0).map(m => m.short);
  }, [run.months]);

  function loadPaste() {
    const parsed = parseNymexTable(pasteText);
    if (!parsed.years) {
      setPasteError('No rows read. Each line wants a year, then twelve monthly settles.');
      return;
    }
    apply({
      ...state,
      settles: parsed.settles,
      loadedAt: new Date().toISOString().slice(0, 10),
    });
    setPasteOpen(false);
    setPasteText('');
    setPasteError('');
    setStatus(`Loaded ${parsed.years} year${parsed.years === 1 ? '' : 's'} and ${parsed.months} settled month${parsed.months === 1 ? '' : 's'}${parsed.skipped.length ? `, skipping ${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'} it could not read` : ''}.`);
  }

  function resetTable() {
    if (!window.confirm('Put the shipped NYMEX table back? The table you loaded is replaced, and your contract and hedge layers are kept.')) return;
    apply({ ...state, settles: null, loadedAt: null });
    setStatus('Back on the shipped table.');
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
      run.totals.assumedMonths
        ? `${run.totals.settledMonths} of ${s.termMonths} months are settled market; the other ${run.totals.assumedMonths} are priced at ${price(s.forwardPrice)}.`
        : `Every month of the term is settled market, so this is measured rather than forecast.`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setStatus('Summary copied.');
    } catch {
      setStatus('Clipboard blocked. Select the tiles and copy them instead.');
    }
  }

  const savingTone = run.totals.saving >= 0 ? 'good' : 'bad';

  return (
    <div className={styles.wrap}>
      {/* ── the record this is all priced off ─────────────────────────── */}
      <div className={styles.bar}>
        <div className={styles.barMain}>
          <span className={styles.barTitle}>NYMEX Henry Hub settles</span>
          <span className={styles.barFacts}>
            {stats
              ? `${stats.count.toLocaleString('en-US')} months, ${series[0].label} to ${series[series.length - 1].label} · low ${price(stats.min)} · median ${price(stats.median)} · high ${price(stats.max)}`
              : 'No settles loaded.'}
          </span>
          <span className={custom ? styles.pillCustom : styles.pillShipped}>
            {custom ? `Your table${state.loadedAt ? `, loaded ${state.loadedAt}` : ''}` : 'Shipped table'}
          </span>
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.smallBtn} onClick={() => setPasteOpen(v => !v)}>
            {pasteOpen ? 'Close' : 'Load data'}
          </button>
          {custom && <button type="button" className={styles.smallBtn} onClick={resetTable}>Reset to the shipped table</button>}
          <button type="button" className={styles.smallBtn} onClick={() => setShowHistory(v => !v)}>
            {showHistory ? 'Hide the table' : 'Show the table'}
          </button>
          {status && <span className={styles.muted}>{status}</span>}
        </div>
      </div>

      {pasteOpen && (
        <div className={styles.pastePanel}>
          <div className={styles.fieldLabel}>
            Paste a settle table
            <span className={styles.fieldHint}>
              One line per year: the year, then Jan to Dec, tab or comma separated. A header row and an AVG column on the end are ignored, so a block copied straight out of a spreadsheet comes in as it is. Blank cells stay blank rather than becoming zeroes.
            </span>
          </div>
          <textarea
            className={styles.textarea}
            rows={6}
            value={pasteText}
            placeholder={`YEAR\tJan\tFeb\tMar\t...\tDec\n2025\t3.514\t3.535\t3.906\t...\t4.424`}
            onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
          />
          {pasteError && <div className={styles.warn}>{pasteError}</div>}
          <div className={styles.rowActions}>
            <button type="button" className={styles.primaryBtn} onClick={loadPaste} disabled={!pasteText.trim()}>Load it</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setPasteOpen(false); setPasteError(''); }}>Cancel</button>
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
          label="Measured"
          value={`${run.totals.settledMonths} of ${s.termMonths}`}
          sub={run.totals.assumedMonths
            ? `${run.totals.assumedMonths} priced at ${price(s.forwardPrice)}`
            : 'every month settled'}
          title="How much of the term is market the NYMEX table actually carries, rather than the forward assumption."
        />
      </div>

      <div className={styles.rowActions}>
        <button type="button" className={styles.smallBtn} onClick={copySummary}>Copy the summary</button>
        <button type="button" className={styles.smallBtn} onClick={() => setShowMonths(v => !v)}>
          {showMonths ? 'Hide the month by month' : 'Show the month by month'}
        </button>
        {firstAssumed && (
          <span className={styles.muted}>
            The settles run out at {run.lastSettled?.label || 'the end of the table'}, so {firstAssumed.label} onwards is priced at the forward assumption.
          </span>
        )}
      </div>

      {/* ── the record, and where this contract sits in it ────────────── */}
      <ChartCard
        title={`Henry Hub settles, ${series.length ? series[0].year : ''} to ${series.length ? series[series.length - 1].year : ''}`}
        note="Every settled month on the table above. The shaded strip is the term; the rule is the blended strike, so the question of whether this is a good price is answered against the whole record rather than against last winter."
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
                dataKey="price"
                name="Settle"
                stroke={INDEX_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* ── the term, priced twice ────────────────────────────────────── */}
      <div className={styles.chartGrid}>
        <ChartCard
          title="Over the term: index against this contract"
          note={`All-in ${NYMEX_UNIT}, basis and adder included on both.`}
          legend={<LegendKey items={[{ label: 'At index', color: INDEX_COLOR }, { label: 'This contract', color: CONTRACT_COLOR }]} />}
        >
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={termData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={termTicks}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={v => `$${v.toFixed(2)}`}
                />
                {firstAssumed && (
                  <ReferenceArea
                    x1={firstAssumed.short}
                    x2={termData[termData.length - 1]?.short}
                    fill={AXIS_TEXT}
                    fillOpacity={0.07}
                    label={{ value: 'assumed', position: 'insideTop', fill: AXIS_TEXT, fontSize: 9, fontWeight: 700 }}
                  />
                )}
                <Tooltip
                  content={(
                    <ChartTip
                      format={v => `${price(v)} ${NYMEX_UNIT}`}
                      footer={row => (row?.assumed
                        ? <div className={styles.tipNote}>priced at the forward assumption</div>
                        : null)}
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
              <AreaChart data={termData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="savings-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SAVED_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SAVED_COLOR} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={termTicks}
                  interval={0}
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
              <BarChart data={termData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 10, fill: AXIS_TEXT }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  ticks={termTicks}
                  interval={0}
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
          note={`The same hedge and the same start, run for ${TERM_LADDER.join(', ')} months. Hover a bar for how much of it is settled market rather than assumption.`}
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
                          {price(row?.savingPerDth)} a Dth · {row?.assumedMonths
                            ? `${row.settledMonths} settled, ${row.assumedMonths} assumed`
                            : 'every month settled'}
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
                    {y.assumed > 0 && <span className={styles.assumedFlag} title={`${y.assumed} of this year's ${y.months} months are priced at the forward assumption`}>{y.assumed} assumed</span>}
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
                  <tr key={m.key} className={m.assumed ? styles.assumedRow : undefined}>
                    <th scope="row">
                      {m.label}
                      {m.assumed && <span className={styles.assumedFlag} title="No settle for this month yet, so it is priced at the forward assumption">assumed</span>}
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

      <div className={styles.footNote}>
        Savings are the same volume priced twice: once at the NYMEX settle for the month, once at what this contract charges after its hedge layers. Basis and the retail adder sit on both legs, so they move the bill and not the saving. Months with no settle yet are priced at the forward assumption and marked; nothing on this page is a forward curve.
        {!hasSavedSavings(settings) && settingsLoaded && ' Nothing is saved yet, so this is the shipped table and a worked example. The first thing you change saves a copy of your own.'}
      </div>
    </div>
  );
}

export default SavingsPanel;
