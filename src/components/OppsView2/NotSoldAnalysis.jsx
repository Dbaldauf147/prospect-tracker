import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { fmtMoneyWhole } from '../../utils/pricingOptionCalc';
import { parseMoney } from '../../utils/oppsMetrics';
import {
  notSoldBreakdown, notSoldYears, reasonOf, sourceOf, sourceReasonRows,
} from '../../utils/notSoldAnalysis';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// One opp's own Quoted Amount, in the drilldown. The aggregate "$ lost"
// columns are gone from the tables — a loss total built only from the opps
// that happened to carry a figure reads as a number when it is a sample —
// but what a single deal was quoted at is a fact about that deal.
function money(v) {
  const n = parseMoney(v);
  return n != null && n > 0 ? fmtMoneyWhole(Math.round(n)) : '-';
}

// A share-of-losses cell: the number and a bar, so the long tail of
// one-off reasons reads as a tail rather than as a list of equals.
function ShareCell({ percent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ minWidth: 48, textAlign: 'right' }}>{percent.toFixed(1)}%</span>
      <div className={styles.serviceBar} style={{ flex: 1 }}>
        <div className={styles.serviceBarFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// The losses behind whatever row was clicked. One popup for both tables —
// they're the same opps filed two ways, so they read the same way too.
function LossDrilldown({ title, subtitle, rows, onOpenOpp, onClose }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(1040px, 94vw)', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
            {title}
            <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', ...muted }}>
              {rows.length} loss{rows.length === 1 ? '' : 'es'}
            </span>
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <p style={{ marginTop: 0, fontSize: '0.78rem', ...muted }}>{subtitle} Click a row to open its details.</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: '0.4rem 0.5rem' }}>Account</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Source</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Reason</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Scope</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Competition</th>
              <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>Quoted $</th>
              <th style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>Close Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r._id}
                onClick={() => onOpenOpp?.(r._id)}
                style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{r['Account'] || '-'}</td>
                <td style={{ padding: '0.4rem 0.5rem' }}>{sourceOf(r)}</td>
                <td style={{ padding: '0.4rem 0.5rem' }}>{reasonOf(r)}</td>
                <td style={{ padding: '0.4rem 0.5rem' }}>{r['Scope'] || '-'}</td>
                <td style={{ padding: '0.4rem 0.5rem' }}>{r['Competition'] || '-'}</td>
                <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {money(r['Quoted Amount'])}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{r['Close Date'] || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>,
    document.body,
  );
}

// The year filter. Only a handful of years ever have losses in them, so
// they're chips rather than a dropdown: every option visible, one click to
// include or drop one. Nothing selected means every year — so a year that
// only shows up in next year's data needs no re-selecting to be counted.
function YearChips({ years, selected, onToggle, onClear }) {
  if (years.length === 0) return null;
  const all = selected.length === 0;
  return (
    <span className={styles.notSoldYears}>
      <span className={styles.filterLabel} style={{ marginRight: 2 }}>Years</span>
      <button
        type="button"
        className={all ? styles.notSoldYearOn : styles.notSoldYear}
        onClick={onClear}
        title="Count losses from every year"
      >All</button>
      {years.map(y => (
        <button
          key={y}
          type="button"
          className={selected.includes(y) ? styles.notSoldYearOn : styles.notSoldYear}
          onClick={() => onToggle(y)}
          title={selected.includes(y) ? `Stop counting ${y}` : `Include ${y}`}
        >{y}</button>
      ))}
    </span>
  );
}

// One source's reasons, opened out under its row: what goes wrong with this
// source, and how much of the whole picture each of those is. The two
// percentages answer different questions — a source can lose most of its own
// deals to one reason while barely moving the business total.
function SourceReasons({ row }) {
  return (
    <table className={styles.notSoldReasonTable}>
      <thead>
        <tr>
          <th>Reason Not Sold</th>
          <th style={{ textAlign: 'right' }}>Losses</th>
          <th style={{ textAlign: 'right' }}>% of {row.source}</th>
          <th style={{ textAlign: 'right' }}>% of all losses</th>
        </tr>
      </thead>
      <tbody>
        {row.reasons.map(r => (
          <tr key={r.reason}>
            <td>{r.reason}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.count}</td>
            <td style={{ textAlign: 'right' }}>{r.percent.toFixed(1)}%</td>
            <td style={{ textAlign: 'right', ...muted }}>{r.percentAll.toFixed(1)}%</td>
          </tr>
        ))}
        <tr className={styles.notSoldReasonTotal}>
          <td>Total</td>
          <td style={{ textAlign: 'right' }}>{row.losses}</td>
          <td style={{ textAlign: 'right' }}>100.0%</td>
          <td style={{ textAlign: 'right', ...muted }}>{row.percent.toFixed(1)}%</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Opps › Not Sold Analysis.
 *
 * Why deals are lost, and where the losses come from. The By Source tab
 * carried this as a single "Top Reason Not Sold" column, which could name the
 * leader per source and nothing else — not how far ahead it was, not what the
 * losses were worth, and not which sources a reason concentrates in. Both
 * tables here are the same set of lost opps filed two ways, so their totals
 * always agree.
 *
 * The window is a Close Date range: "losses in Q3" means deals lost in Q3,
 * whenever they opened.
 */
export function NotSoldAnalysis({ records, settings, updateSettings, onOpenOpp }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Close years to count. Empty means all of them.
  const [years, setYears] = useState([]);
  // Which source rows are opened out into their reason breakdown.
  const [expanded, setExpanded] = useState(() => new Set());
  // What the open drilldown is showing: { title, subtitle, rows }.
  const [drill, setDrill] = useState(null);

  const yearOptions = useMemo(() => notSoldYears(records), [records]);
  const data = useMemo(
    () => notSoldBreakdown(records, { from, to, years }),
    [records, from, to, years],
  );

  function toggleYear(y) {
    setYears(prev => (prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y]));
  }
  function toggleExpanded(source) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source); else next.add(source);
      return next;
    });
  }

  const reasonColumns = useMemo(() => [
    {
      key: 'reason',
      label: 'Reason Not Sold',
      defaultWidth: 260,
      render: (row) => (
        <span style={{ color: 'var(--color-link, #2563EB)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {row.reason}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Losses',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>,
    },
    {
      key: 'percent',
      label: '% of Losses',
      defaultWidth: 220,
      render: (row) => <ShareCell percent={row.percent} />,
    },
    {
      key: 'sourceList',
      label: 'Sources',
      defaultWidth: 300,
      render: (row) => (
        <div
          title={row.sources.map(s => `${s.source}: ${s.count}`).join('\n')}
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {row.sources.map(s => `${s.source} (${s.count})`).join(', ')}
        </div>
      ),
    },
  ], []);

  const sourceColumns = useMemo(() => [
    {
      // Its own control rather than the row click, which already opens the
      // losses themselves. The click is stopped here so opening the
      // breakdown doesn't also open the popup over the top of it.
      key: 'expand',
      label: '',
      defaultWidth: 34,
      render: (row) => (
        <button
          type="button"
          className={styles.notSoldExpandBtn}
          onClick={(e) => { e.stopPropagation(); toggleExpanded(row.source); }}
          title={expanded.has(row.source)
            ? `Hide ${row.source}'s reasons`
            : `Show every reason ${row.source} lost on`}
          aria-label={expanded.has(row.source) ? 'Collapse' : 'Expand'}
        >{expanded.has(row.source) ? '\u25BE' : '\u25B8'}</button>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ color: 'var(--color-link, #2563EB)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'losses',
      label: 'Losses',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.losses}</div>,
    },
    {
      key: 'lossRate',
      label: 'Loss Rate',
      defaultWidth: 110,
      render: (row) => (
        <div
          style={{ textAlign: 'right' }}
          title={`${row.losses} lost of ${row.losses + row.wins} decided (Sold + Not Sold) from this source, closed in this window.`}
        >{row.lossRate == null ? '-' : `${row.lossRate.toFixed(1)}%`}</div>
      ),
    },
    {
      key: 'percent',
      label: '% of Losses',
      defaultWidth: 220,
      render: (row) => <ShareCell percent={row.percent} />,
    },
    {
      key: 'topReason',
      label: 'Top Reason',
      defaultWidth: 240,
      // Same shape the By Source tab's reason cell had: the leader, how far
      // ahead it is, and the rest in the tooltip.
      render: (row) => {
        if (!row.topReason) return <span style={muted}>-</span>;
        const rest = row.reasons.length - 1;
        return (
          <div
            title={row.reasons.map(r => `${r.reason}: ${r.count}`).join('\n')}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {row.topReason.reason}
            <span style={muted}>
              {' '}({row.topReason.count}/{row.losses}{rest ? `, +${rest} more` : ''})
            </span>
          </div>
        );
      },
    },
  ], [expanded]);

  const windowed = data.windowed;

  return (
    <>
      <div className={styles.searchRow}>
        <label className={styles.filterLabel}>
          Closed from
          <input
            type="date"
            className={styles.filterInput}
            value={from}
            max={to || undefined}
            onChange={e => setFrom(e.target.value)}
          />
        </label>
        <label className={styles.filterLabel}>
          To
          <input
            type="date"
            className={styles.filterInput}
            value={to}
            min={from || undefined}
            onChange={e => setTo(e.target.value)}
          />
        </label>
        <YearChips
          years={yearOptions}
          selected={years}
          onToggle={toggleYear}
          onClear={() => setYears([])}
        />
        {windowed && (
          <button
            className={styles.clearFiltersBtn}
            onClick={() => { setFrom(''); setTo(''); setYears([]); }}
          >Clear filters</button>
        )}
        <span className={styles.resultCount}>
          {data.lossCount} loss{data.lossCount === 1 ? '' : 'es'}
          {windowed ? ' closed in range' : ''}
          {` · ${data.winCount} won in the same window`}
          {' · click a row to see the opps'}
        </span>
        {/* Said rather than silently done: with a window set there's no way
            to place a loss that never got a Close Date, so it sits out. */}
        {data.undated > 0 && (
          <span className={styles.resultCount} style={{ color: '#92400E' }}>
            {data.undated} not counted — no Close Date
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 className={styles.notSoldSectionTitle}>Top reasons</h3>
          <DataTable
            tableId="opps2-not-sold-reasons"
            columns={reasonColumns}
            rows={data.reasons.map(r => ({ ...r, id: r.reason }))}
            alwaysVisible={['reason']}
            exportFileName="Not Sold by reason"
            emptyMessage={windowed ? 'No opps were closed Not Sold in this range.' : 'No opps are marked Not Sold yet.'}
            onRowClick={(row) => setDrill({
              title: `Reason: ${row.reason}`,
              subtitle: `Every loss filed under this reason${windowed ? ', closed in the current range.' : '.'}`,
              rows: data.rows.filter(r => reasonOf(r) === row.reason),
            })}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 className={styles.notSoldSectionTitle}>Not sold by source</h3>
          <DataTable
            tableId="opps2-not-sold-sources"
            columns={sourceColumns}
            rows={data.sources.map(r => ({ ...r, id: r.source }))}
            alwaysVisible={['expand', 'source']}
            expandedRowIds={expanded}
            renderExpansion={(row) => <SourceReasons row={row} />}
            toolbarActions={[{
              key: 'expandAll',
              label: expanded.size === data.sources.length && data.sources.length > 0
                ? 'Collapse all'
                : 'Expand all',
              title: 'Open every source out into the reasons behind its losses',
              onClick: () => setExpanded(prev => (
                prev.size === data.sources.length ? new Set() : new Set(data.sources.map(r => r.source))
              )),
              disabled: data.sources.length === 0,
            }]}
            exportFileName="Not Sold by source"
            // The reason breakdown is an on-screen expansion, so it would
            // otherwise be the one part of this tab you couldn't take away
            // with you.
            exportExtraSheets={[{ name: 'Reasons by source', rows: sourceReasonRows(data.sources) }]}
            emptyMessage={windowed ? 'No opps were closed Not Sold in this range.' : 'No opps are marked Not Sold yet.'}
            onRowClick={(row) => setDrill({
              title: `Source: ${row.source}`,
              subtitle: `Every loss from this source${windowed ? ', closed in the current range.' : '.'}`,
              rows: data.rows.filter(r => sourceOf(r) === row.source),
            })}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      </div>

      {drill && (
        <LossDrilldown
          title={drill.title}
          subtitle={drill.subtitle}
          rows={drill.rows}
          onOpenOpp={(id) => { setDrill(null); onOpenOpp?.(id); }}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}
