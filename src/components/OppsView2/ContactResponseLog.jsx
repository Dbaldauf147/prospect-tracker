import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { contactResponseSummary } from '../../utils/contactResponse';

const labelStyle = {
  fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
  color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.15rem',
};
const muted = { color: 'var(--color-text-muted)' };
const days = (n) => (n == null ? '-' : `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`);

const COLUMNS = [
  { key: 'date', label: 'Heard from on', defaultWidth: 120, getSortValue: (e) => e.date, exportValue: (e) => e.date, render: (e) => e.date },
  { key: 'contact', label: 'Contact (starred)', defaultWidth: 170, getFilterValue: (e) => e.contact || '', exportValue: (e) => e.contact || '', render: (e) => e.contact || <span style={muted}>-</span> },
  {
    key: 'gap', label: 'Days since previous', defaultWidth: 150,
    getSortValue: (e) => e.gapDays ?? -1, exportValue: (e) => e.gapDays ?? '',
    render: (e) => <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.gapDays == null ? <span style={muted}>first</span> : e.gapDays}</div>,
  },
  { key: 'stage', label: 'Stage then', defaultWidth: 130, getFilterValue: (e) => e.stage || '', exportValue: (e) => e.stage || '', render: (e) => e.stage || <span style={muted}>-</span> },
  {
    key: 'age', label: 'Opp age then', defaultWidth: 120,
    getSortValue: (e) => e.oppAgeDays ?? -1, exportValue: (e) => e.oppAgeDays ?? '',
    render: (e) => <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.oppAgeDays == null ? <span style={muted}>-</span> : `${e.oppAgeDays}d`}</div>,
  },
  {
    key: 'source', label: 'Logged', defaultWidth: 150, exportValue: (e) => (e.source === 'existing' ? 'Date already on the opp' : e.loggedAt || ''),
    render: (e) => <span style={muted}>{e.source === 'existing' ? 'Date already on the opp' : String(e.loggedAt || '').slice(0, 10)}</span>,
  },
];

/**
 * Opp details > Activity: how long since we heard from the opp's starred
 * contact, how long they usually take to come back, and every heard-from
 * logged so far (utils/contactResponse). The log grows each time the
 * Last Client Heard From Us date moves on.
 */
export function ContactResponseLog({ opp, settings }) {
  const sum = useMemo(() => contactResponseSummary(opp), [opp]);
  const rows = useMemo(() => sum.entries.map((e, i) => ({ ...e, id: `${e.date}-${i}` })), [sum]);
  const slower = sum.daysSince != null && sum.medianGap != null && sum.daysSince > sum.medianGap;
  return (
    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border-light)' }}>
      <div style={{ ...labelStyle, marginBottom: '0.4rem' }}>Contact response history</div>
      {!sum.lastHeard ? (
        <div style={{ fontSize: '0.8rem', ...muted }}>
          Nothing heard from {sum.contact || 'the starred contact'} yet. Set <strong>Last Client Heard From Us</strong> and each new date is logged here.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1.25rem', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            <span>
              <strong style={{ fontSize: '1rem', color: slower ? '#B91C1C' : 'var(--color-text)' }}>{days(sum.daysSince)}</strong>
              {' '}since we heard from <strong>{sum.contact || 'the contact'}</strong> <span style={muted}>({sum.lastHeard})</span>
            </span>
            <span title="The middle of the gaps between one heard-from and the next">
              Usual gap: <strong>{days(sum.medianGap)}</strong>
              {sum.gaps.length > 0 && <span style={muted}> (median of {sum.gaps.length})</span>}
            </span>
            {sum.lastGap != null && <span>Last gap: <strong>{days(sum.lastGap)}</strong></span>}
          </div>
          {slower && (
            <div style={{ fontSize: '0.75rem', color: '#B91C1C', marginBottom: '0.5rem' }}>
              Longer than they usually take to come back.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(360, 120 + rows.length * 36) }}>
            <DataTable
              tableId="opp-contact-response-log"
              columns={COLUMNS}
              rows={rows}
              alwaysVisible={['date']}
              enableColumnFilters={false}
              emptyMessage="No heard-from dates logged yet."
              exportFileName={`Contact response history - ${String(opp?.Account || 'opp').trim()}`}
              settings={settings}
            />
          </div>
          <div style={{ fontSize: '0.7rem', ...muted, marginTop: '0.35rem' }}>
            Logged each time Last Client Heard From Us moves to a new date, against whoever is starred then. Calendar days.
          </div>
        </>
      )}
    </div>
  );
}
