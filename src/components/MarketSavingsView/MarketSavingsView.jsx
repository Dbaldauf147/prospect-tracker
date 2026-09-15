import { useMemo, useState } from 'react';
import {
  NA_MARKET_ROWS,
  COUNTRY_MARKET_ROWS,
  bandIsEditable,
  countrySavingsKey,
  countrySavingsOverride,
  countSavingsOverrides,
  defaultCountryBand,
  defaultStateBand,
  formatSavingsRange,
  MARKET_SAVINGS_SETTINGS_KEY,
  stateSavingsOverride,
} from '../../utils/marketSavings';
import styles from './MarketSavingsView.module.css';

// Utility Lookup > Market Savings. The indicative commodity-savings band
// behind every savings figure the app quotes, in one editable table.
//
// The bands used to be a pair of hard-coded maps inside SitesView, which
// meant a seller whose own bid history said 3 - 5 % in Texas had no way
// to say so, and the European markets the reference table carries as
// "TBD" could never be given a figure at all. This tab is where those
// numbers are typed. What is typed here is the seller's own (it saves
// under their settings, not into the shipped tables) and it reaches
// every surface that quotes a band: the Indicative Savings sheets, the
// by-state and by-country overviews, the site rows behind them.
//
// What is NOT editable here is whether a market is competitive. That
// status decides which sites count as deregulated and which tier a
// market lands in, so it stays with the reference tables; a regulated
// market earns nothing whatever percentage is typed against it, and the
// honest thing is to show the row without figures rather than accept a
// number that would quietly do nothing. Those rows read "Regulated" or
// "No opportunity" in the status column and carry no inputs.

const SCOPES = [
  { key: 'na', label: 'States / Provinces' },
  { key: 'countries', label: 'Countries' },
];

// The state maps spell a competitive market 'yes'; everything else is
// already a display string. A market absent from its map is regulated.
function stateStatusLabel(band) {
  if (!band) return 'Regulated';
  return band.status === 'yes' ? 'Deregulated' : band.status;
}

// Which of the three ways a status reads: earning a full band, earning a
// gated one, or earning nothing. Drives the status pill's colour only.
function pillClass(band) {
  if (!bandIsEditable(band)) return styles.pillOff;
  const s = String(band?.status || '').toLowerCase();
  return (s === 'yes' || s === 'deregulated') ? styles.pillOn : styles.pillPart;
}

// "2.5" out of "2.5", " 2.5 % ", "2,5" is not a thing here. Returns null
// for anything that isn't a usable percentage, which the caller reads as
// "leave what's stored alone".
function parsePct(typed) {
  const cleaned = String(typed ?? '').replace(/%/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 1000) / 1000;
}

// 2, 2.5, 0.25 - never 2.50, never 2.4999999999999996.
function showPct(n) {
  return n == null ? '' : String(Math.round(n * 1000) / 1000);
}

// One end of a band. Shows the figure, edits as a bare number, commits on
// blur / Enter and cancels on Escape. Only writes when the value actually
// changed, so clicking in and back out again can't blank a band.
function PctCell({ value, editable, title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const editing = draft !== null;
  const initial = showPct(value);

  if (!editable) {
    return <span className={styles.notEditable} title={title}>-</span>;
  }

  function commit() {
    const typed = (draft ?? '').trim();
    setDraft(null);
    if (typed === initial) return;
    const pct = parsePct(typed);
    if (pct === null) return;
    onCommit(pct);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={styles.pctButton}
        title={title || 'Click to edit'}
        onClick={() => setDraft(initial)}
      >
        {initial === '' ? <span className={styles.unset}>Set</span> : `${initial}%`}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min="0"
      max="100"
      step="0.25"
      inputMode="decimal"
      className={styles.pctInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
    />
  );
}

export function MarketSavingsView({ settings = {}, updateSettingsPath }) {
  const [scope, setScope] = useState('na');
  const [search, setSearch] = useState('');
  const [editedOnly, setEditedOnly] = useState(false);

  const editCount = countSavingsOverrides(settings);

  // One row per market, with both commodities resolved: the shipped band,
  // the seller's override if there is one, and the figures to show (the
  // override when present, the shipped band otherwise).
  const rows = useMemo(() => {
    const build = (kind, id, name, label, group, bandFor, overrideFor) => {
      const bands = {};
      for (const commodity of ['electric', 'gas']) {
        const base = bandFor(commodity);
        const override = overrideFor(commodity);
        const editable = bandIsEditable(base);
        bands[commodity] = {
          base,
          override,
          editable,
          statusLabel: kind === 'country'
            ? (base?.status || 'No opportunity')
            : stateStatusLabel(base),
          low: override ? override.low : (base?.lowPct == null ? null : base.lowPct * 100),
          high: override ? override.high : (base?.highPct == null ? null : base.highPct * 100),
        };
      }
      return { id, name, label, group, bands, edited: !!(bands.electric.override || bands.gas.override) };
    };

    if (scope === 'na') {
      return NA_MARKET_ROWS.map(m => build(
        'state',
        m.code,
        m.name,
        `${m.name} (${m.code})`,
        m.nation,
        (commodity) => defaultStateBand(m.code, commodity),
        (commodity) => stateSavingsOverride(settings, m.code, commodity),
      ));
    }
    return COUNTRY_MARKET_ROWS.map(c => build(
      'country',
      countrySavingsKey(c.name),
      c.name,
      c.name,
      c.region,
      (commodity) => defaultCountryBand(c.name, commodity),
      (commodity) => countrySavingsOverride(settings, c.name, commodity),
    ));
  }, [scope, settings]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (editedOnly && !r.edited) return false;
      if (!q) return true;
      return r.label.toLowerCase().includes(q) || String(r.group).toLowerCase().includes(q);
    });
  }, [rows, search, editedOnly]);

  // Where a market's figures live in settings.
  function marketPath(row) {
    const bucket = scope === 'na' ? 'states' : 'countries';
    return `${MARKET_SAVINGS_SETTINGS_KEY}.${bucket}.${row.id}`;
  }

  // Save one end of a band. The other end comes along, because a band is
  // a pair and half of one can't be quoted: a market with no committed
  // figures at all (a European "TBD") takes the typed number for both
  // ends until the second one is typed.
  function saveEnd(row, commodity, end, pct) {
    if (!updateSettingsPath) return;
    const band = row.bands[commodity];
    const other = end === 'low' ? band.high : band.low;
    const pair = end === 'low'
      ? { low: pct, high: other == null ? pct : other }
      : { low: other == null ? pct : other, high: pct };
    // The canonical name rides along with the figures. Country keys are
    // slugged to survive being a dotted Firestore path, and a slug on its
    // own can't be read back into the name it came from.
    updateSettingsPath({
      [`${marketPath(row)}.${commodity}`]: pair,
      [`${marketPath(row)}.name`]: row.name,
    });
  }

  function resetCommodity(row, commodity) {
    if (!updateSettingsPath) return;
    const other = commodity === 'electric' ? 'gas' : 'electric';
    // Clearing the last of a market's figures clears the market entry
    // itself, so a full reset doesn't leave a row of nothing but a name.
    const path = row.bands[other].override
      ? `${marketPath(row)}.${commodity}`
      : marketPath(row);
    updateSettingsPath({ [path]: null });
  }

  function resetAll() {
    if (!updateSettingsPath) return;
    const plural = editCount === 1 ? 'edit' : 'edits';
    if (!window.confirm(`Clear all ${editCount} savings ${plural} and go back to the shipped figures?`)) return;
    updateSettingsPath({ [MARKET_SAVINGS_SETTINGS_KEY]: null });
  }

  function commodityCells(row, commodity) {
    const band = row.bands[commodity];
    const reason = band.editable
      ? (band.override ? 'Your figure. Click to change it.' : 'Shipped figure. Click to set your own.')
      : `${band.statusLabel}: no savings band, so there is no figure to set.`;
    const inverted = band.low != null && band.high != null && band.low > band.high;
    return (
      <>
        <td className={styles.pctCell}>
          <PctCell
            value={band.low}
            editable={band.editable}
            title={reason}
            onCommit={(pct) => saveEnd(row, commodity, 'low', pct)}
          />
        </td>
        <td className={styles.pctCell}>
          <PctCell
            value={band.high}
            editable={band.editable}
            title={reason}
            onCommit={(pct) => saveEnd(row, commodity, 'high', pct)}
          />
        </td>
        <td className={styles.rangeCell}>
          {inverted && (
            <span className={styles.warn} title="Low is above high. The band reads backwards until one of them is changed.">!</span>
          )}
          <span className={band.override ? styles.rangeEdited : styles.range}>
            {band.low == null || band.high == null
              ? <span className={styles.unset}>{band.editable ? 'TBD' : '-'}</span>
              : formatSavingsRange(band.low / 100, band.high / 100)}
          </span>
          {band.override && (
            <button
              type="button"
              className={styles.resetCell}
              title="Go back to the shipped figure"
              onClick={() => resetCommodity(row, commodity)}
            >↺</button>
          )}
        </td>
      </>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Market Savings</h2>
          <div className={styles.subtitle}>
            The low and high indicative savings percentage each market earns on deregulated
            electric and gas spend. Edits are yours, they save as you type, and every savings
            figure the app quotes picks them up.
          </div>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.editCount}>
            {editCount === 0 ? 'No edits' : `${editCount} edited`}
          </span>
          {editCount > 0 && (
            <button type="button" className={styles.resetAll} onClick={resetAll}>
              Reset all
            </button>
          )}
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.toggleGroup}>
          {SCOPES.map(s => (
            <button
              key={s.key}
              type="button"
              className={scope === s.key ? styles.toggleActive : styles.toggle}
              onClick={() => setScope(s.key)}
            >{s.label}</button>
          ))}
        </div>
        <input
          className={styles.searchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={scope === 'na' ? 'Search state or province...' : 'Search country or region...'}
        />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={editedOnly}
            onChange={(e) => setEditedOnly(e.target.checked)}
          />
          Edited only
        </label>
        <span className={styles.resultCount}>
          {visibleRows.length} of {rows.length}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.marketCol}>{scope === 'na' ? 'State / Province' : 'Country'}</th>
              <th rowSpan={2} className={styles.groupCol}>{scope === 'na' ? 'Country' : 'Region'}</th>
              <th colSpan={4} className={styles.commodityHead}>Electric</th>
              <th colSpan={4} className={`${styles.commodityHead} ${styles.commodityHeadAlt}`}>Gas</th>
            </tr>
            <tr>
              <th className={styles.statusCol}>Status</th>
              <th className={styles.pctCol}>Low</th>
              <th className={styles.pctCol}>High</th>
              <th className={styles.rangeCol}>Band</th>
              <th className={styles.statusCol}>Status</th>
              <th className={styles.pctCol}>Low</th>
              <th className={styles.pctCol}>High</th>
              <th className={styles.rangeCol}>Band</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={10} className={styles.empty}>No markets match that search.</td>
              </tr>
            )}
            {visibleRows.map(row => (
              <tr key={row.id} className={row.edited ? styles.rowEdited : undefined}>
                <td className={styles.marketCell}>{row.label}</td>
                <td className={styles.groupCell}>{row.group}</td>
                <td className={styles.statusCell}>
                  <span className={pillClass(row.bands.electric.base)}>
                    {row.bands.electric.statusLabel}
                  </span>
                </td>
                {commodityCells(row, 'electric')}
                <td className={styles.statusCell}>
                  <span className={pillClass(row.bands.gas.base)}>
                    {row.bands.gas.statusLabel}
                  </span>
                </td>
                {commodityCells(row, 'gas')}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
