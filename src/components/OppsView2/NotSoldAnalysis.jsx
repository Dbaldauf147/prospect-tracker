import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { fmtMoneyWhole } from '../../utils/pricingOptionCalc';
import {
  notSoldBreakdown, quotedOf, reasonOf, sourceOf,
} from '../../utils/notSoldAnalysis';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

function money(n) {
  return n > 0 ? fmtMoneyWhole(Math.round(n)) : '-';
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
                  {money(quotedOf(r) || 0)}
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
  // What the open drilldown is showing: { title, subtitle, rows }.
  const [drill, setDrill] = useState(null);

  const data = useMemo(() => notSoldBreakdown(records, { from, to }), [records, from, to]);

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
      key: 'lost',
      label: 'Quoted $ Lost',
      defaultWidth: 130,
      render: (row) => (
        <div
          style={{ textAlign: 'right' }}
          title={row.lost > 0 ? undefined : 'None of these losses carried a Quoted Amount.'}
        >{money(row.lost)}</div>
      ),
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
      key: 'lost',
      label: 'Quoted $ Lost',
      defaultWidth: 130,
      render: (row) => <div style={{ textAlign: 'right' }}>{money(row.lost)}</div>,
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
  ], []);

  const ranged = !!(from || to);

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
        {ranged && (
          <button
            className={styles.clearFiltersBtn}
            onClick={() => { setFrom(''); setTo(''); }}
          >Clear filters</button>
        )}
        <span className={styles.resultCount}>
          {data.lossCount} loss{data.lossCount === 1 ? '' : 'es'}
          {ranged ? ' closed in range' : ''}
          {data.lostValue > 0 && ` · ${money(data.lostValue)} quoted across ${data.quotedLosses}`}
          {` · ${data.winCount} won in the same window`}
          {' · click a row to see the opps'}
        </span>
        {/* Said rather than silently done: with a range set there's no way to
            place a loss that never got a Close Date, so it sits out. */}
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
            emptyMessage={ranged ? 'No opps were closed Not Sold in this range.' : 'No opps are marked Not Sold yet.'}
            onRowClick={(row) => setDrill({
              title: `Reason: ${row.reason}`,
              subtitle: `Every loss filed under this reason${ranged ? ', closed in the current range.' : '.'}`,
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
            alwaysVisible={['source']}
            exportFileName="Not Sold by source"
            emptyMessage={ranged ? 'No opps were closed Not Sold in this range.' : 'No opps are marked Not Sold yet.'}
            onRowClick={(row) => setDrill({
              title: `Source: ${row.source}`,
              subtitle: `Every loss from this source${ranged ? ', closed in the current range.' : '.'}`,
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
