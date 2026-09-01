import { useEffect } from 'react';
import { formatMoney, formatMoneyRange } from '../../utils/servicePricing';
import { lineBasisText } from '../../utils/pricingAnalysis';

// The saved deal estimate behind an opp's Estimated Fee, as the table it
// was worked out on.
//
// Read-only, and deliberately so: this is what the deal was priced at, not
// a live calculation. Re-pricing happens on Dropdowns › Services Pricing,
// which saves a new one over this. Every figure here is the one that was
// saved — a rate edited since, a service retired since, a count corrected
// since, none of them move a number on this page. That's the point of a
// saved analysis: it says what was quoted, not what today's card would say.
//
// Styled inline, like the other popups this folder opens (see
// DealTimelineModal) — the view's CSS module carries no modal vocabulary.

const cell = { padding: '5px 10px', borderBottom: '1px solid var(--color-border-light)', verticalAlign: 'top' };
const numCell = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const headCell = {
  padding: '6px 10px', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-alt, #F8FAFC)',
  position: 'sticky', top: 0,
};
const muted = { color: 'var(--color-text-muted)' };
const footCell = { padding: '5px 10px', borderTop: '1px solid var(--color-border-light)' };

function when(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
}

export function PricingAnalysisModal({ analysis, account, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!analysis) return null;
  const counts = Object.entries(analysis.counts || {});

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Above the cell popups this opens from.
        zIndex: 10020,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(920px, 96vw)', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontSize: '0.78rem', color: 'var(--color-text)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 16px', borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>
              Estimated fee — {account || analysis.account || 'this opp'}
            </div>
            {/* What the number was worked out against, in one line: the
                counts are the assumptions the whole estimate rests on, and
                a fee read without them is a fee taken on trust. */}
            <div style={{ marginTop: 2, color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>
              {analysis.lines.length} service{analysis.lines.length === 1 ? '' : 's'}
              {counts.length > 0 && (
                <>{' · priced against '}{counts.map(([unit, n]) => `${n.toLocaleString('en-US')} ${unit}`).join(', ')}</>
              )}
              {analysis.dealSize ? ` · deal size ${formatMoney(analysis.dealSize)}` : ''}
              {analysis.savedAt ? ` · saved ${when(analysis.savedAt)}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: '1.2rem', lineHeight: 1, color: 'var(--color-text-muted)', padding: 0,
            }}
          >×</button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headCell}>Service</th>
                <th style={headCell}>How it was priced</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Units</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Year 1 fee</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Deal value</th>
              </tr>
            </thead>
            <tbody>
              {analysis.lines.map(line => (
                <tr key={line.name}>
                  <td style={cell}>
                    {line.name}
                    {/* A recurring line's term is what makes its deal value
                        differ from its year-one fee, so it says so here
                        rather than leaving the two numbers unexplained. */}
                    {line.recurring && line.years > 1 && (
                      <span style={{ ...muted, fontSize: '0.7rem' }}> · {line.years} years</span>
                    )}
                  </td>
                  <td style={cell}>
                    {lineBasisText(line) || <span style={muted}>Not priced</span>}
                    {line.unitsTyped && (
                      <span style={{ ...muted, fontSize: '0.7rem' }}> · units set for this deal</span>
                    )}
                  </td>
                  <td style={numCell}>
                    {line.units === null ? <span style={muted}>-</span> : line.units.toLocaleString('en-US')}
                  </td>
                  <td style={numCell}>
                    {line.fee === null ? <span style={muted}>-</span> : formatMoneyRange(line.fee, line.feeHigh)}
                  </td>
                  <td style={numCell}>
                    {line.value === null ? <span style={muted}>-</span> : formatMoneyRange(line.value, line.valueHigh)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...footCell, ...muted }} colSpan={3}>Recurring / year</td>
                <td style={{ ...footCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} colSpan={2}>
                  {formatMoneyRange(analysis.recurringAnnual, analysis.recurringAnnualHigh) || '$0'}
                </td>
              </tr>
              <tr>
                <td style={{ ...footCell, ...muted, borderTop: 'none' }} colSpan={3}>One-off projects</td>
                <td style={{ ...footCell, borderTop: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} colSpan={2}>
                  {formatMoneyRange(analysis.oneTime, analysis.oneTimeHigh) || '$0'}
                </td>
              </tr>
              <tr>
                <td style={{ ...footCell, ...muted, borderTop: 'none' }} colSpan={3}>Contract value</td>
                <td style={{ ...footCell, borderTop: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} colSpan={2}>
                  {formatMoneyRange(analysis.contractValue, analysis.contractValueHigh) || '$0'}
                </td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...footCell, borderTop: '1px solid var(--color-border)' }} colSpan={3}>Estimated Year 1 fee</td>
                <td style={{
                  ...footCell, borderTop: '1px solid var(--color-border)',
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-accent)',
                }} colSpan={2}>{formatMoneyRange(analysis.year1Total, analysis.year1TotalHigh) || '$0'}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Said once, under the table: the total is short by whatever these
            would have come to, and anyone comparing it to a quote needs to
            know that before they go hunting for the difference. */}
        {analysis.unpriced.length > 0 && (
          <div style={{
            padding: '8px 16px', background: '#FEF3C7', color: '#92400E',
            fontSize: '0.72rem', lineHeight: 1.4,
          }}>
            Not counted — nothing priced them when this was saved: {analysis.unpriced.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
