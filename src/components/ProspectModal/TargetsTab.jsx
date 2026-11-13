// Company popup > Targets: the company's sustainability targets, logged by
// hand. One row per target: what kind it is (off the user's own list of
// types, see TargetTypeSelect), the year it was set, its base year, up to two
// target years, which of Scopes 1, 2 and 3 it covers, and when its five-yearly
// refresh falls due. Every cell edits in place and autosaves with the rest of
// the card. See utils/companyTargets for the stored shape.
import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import {
  TARGET_SCOPES, REFRESH_CYCLE_YEARS, blankTarget, normalizeTargets,
  updateTarget, removeTarget, refreshDue,
} from '../../utils/companyTargets';
import { TargetTypeSelect } from './TargetTypeSelect';
import { useTargetTypeOptions } from './useTargetTypeOptions';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '0.2rem 0.4rem', fontSize: '0.8rem',
  border: '1px solid #E2E8F0', borderRadius: 4, fontFamily: 'inherit', background: '#fff',
};
const yearStyle = { ...inputStyle, fontVariantNumeric: 'tabular-nums' };
const addBtn = {
  padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #2563EB', background: '#2563EB',
  color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const rowBtn = {
  background: 'none', border: '1px solid transparent', borderRadius: 4, padding: '0 6px',
  lineHeight: 1.2, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', color: '#94A3B8',
};

const REFRESH_COLORS = {
  overdue: { background: '#FEE2E2', color: '#991B1B' },
  due: { background: '#FEF3C7', color: '#92400E' },
  upcoming: { background: '#F1F5F9', color: '#334155' },
};

const YEAR_COLUMNS = [
  { key: 'yearSet', label: 'Year Set' },
  { key: 'baseYear', label: 'Base Year' },
  { key: 'targetYear1', label: 'Target Year 1' },
  { key: 'targetYear2', label: 'Target Year 2' },
];
const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };

export function TargetsTab({ company = '', targets, onChange, settings, updateSettings }) {
  const rows = useMemo(() => normalizeTargets(targets), [targets]);
  const typeOptions = useTargetTypeOptions();
  const edit = (id, key, value) => onChange(updateTarget(rows, id, key, value));
  const add = () => onChange([...rows, blankTarget()]);
  const remove = (row) => {
    const named = row.type ? `the "${row.type}" target` : 'this target';
    if (window.confirm(`Delete ${named}?`)) onChange(removeTarget(rows, row.id));
  };

  const columns = [
    {
      key: 'type',
      label: 'Target Type',
      defaultWidth: 260,
      getSortValue: r => r.type.toLowerCase() || null,
      getFilterValue: r => r.type,
      exportValue: r => r.type,
      render: r => (
        <TargetTypeSelect
          value={r.type}
          options={typeOptions}
          onChange={v => edit(r.id, 'type', v)}
        />
      ),
    },
    ...YEAR_COLUMNS.map(c => ({
      key: c.key,
      label: c.label,
      defaultWidth: 120,
      getSortValue: r => (r[c.key] ? Number(r[c.key]) : null),
      getFilterValue: r => r[c.key],
      exportValue: r => r[c.key],
      render: r => (
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={r[c.key]}
          placeholder="YYYY"
          aria-label={c.label}
          onChange={e => edit(r.id, c.key, e.target.value)}
          style={yearStyle}
        />
      ),
    })),
    ...TARGET_SCOPES.map(k => ({
      key: k,
      label: SCOPE_LABELS[k],
      defaultWidth: 90,
      getSortValue: r => (r[k] ? 1 : 0),
      getFilterValue: r => (r[k] ? 'Included' : 'Not included'),
      exportValue: r => (r[k] ? 'Yes' : 'No'),
      render: r => (
        <label style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={r[k]}
            aria-label={`${SCOPE_LABELS[k]} included`}
            onChange={e => edit(r.id, k, e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      ),
    })),
    {
      key: 'refreshDue',
      label: 'Refresh Due',
      defaultWidth: 160,
      getSortValue: r => refreshDue(r)?.year ?? null,
      getFilterValue: r => refreshDue(r)?.label || '',
      exportValue: r => refreshDue(r)?.year ?? '',
      render: r => {
        const due = refreshDue(r);
        if (!due) {
          return <span style={{ color: '#94A3B8', fontSize: '0.75rem' }} title="Log the year set to schedule its refresh">-</span>;
        }
        return (
          <span
            title={`Refreshed every ${REFRESH_CYCLE_YEARS} years: set in ${r.yearSet}, so due in ${due.year}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}
          >
            <strong style={{ color: '#1E293B' }}>{due.year}</strong>
            <span style={{ ...REFRESH_COLORS[due.status], padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700 }}>
              {due.label}
            </span>
          </span>
        );
      },
    },
    {
      key: '__delete__',
      label: '',
      defaultWidth: 50,
      exportValue: () => '',
      render: r => (
        <button type="button" style={rowBtn} title="Delete this target" aria-label="Delete this target"
          onClick={() => remove(r)}>&#10005;</button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        The sustainability targets {company ? <strong>{company}</strong> : 'this company'} has set:
        the kind of target, the year it was set, its base year, up to two target years, and which
        scopes it covers. Each target is due a refresh {REFRESH_CYCLE_YEARS} years after the year
        it was set. Changes save as you type.
      </div>
      <div>
        <button type="button" onClick={add} style={addBtn}>+ Add target</button>
      </div>
      {/* DataTable fills a flex column, so it needs a box with a height.
          Sized to the rows so a company with one or two targets doesn't
          sit above a screen of empty table, capped so a long list scrolls. */}
      <div style={{
        height: `min(55vh, ${150 + Math.max(rows.length, 1) * 40}px)`,
        display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0',
        borderRadius: 8, overflow: 'hidden', background: '#fff',
      }}>
      <DataTable
        tableId="company-targets"
        columns={columns}
        rows={rows}
        alwaysVisible={['type']}
        emptyMessage={rows.length ? 'No targets match the filters.' : 'No targets logged yet. Use + Add target to log one.'}
        // The filter row only once there is something to filter: on an empty
        // table its boxes look like the place to type a new target in.
        enableColumnFilters={rows.length > 0}
        exportFileName={`${company || 'Company'} targets`}
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
