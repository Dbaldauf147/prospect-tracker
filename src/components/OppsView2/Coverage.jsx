import { useMemo, useState } from 'react';
import { SALES_COVERAGE } from '../../data/salesCoverage';
import { cleanCoverage, coverageFromSettings, withCoverageEdit } from '../../utils/salesCoverage';
import { settingsHaveLoaded } from '../../utils/tablePrefsSync';
import styles from './OppsView2.module.css';

// Opps > Coverage: which salesperson covers each vertical, grouped under
// the team lead, laid out like the source sheet. The search box narrows
// on vertical, salesperson or team, so "who has Grocery?" or "what does
// Sara cover?" is one word away.
//
// Any team, vertical or salesperson cell can be edited in place: click it,
// type, Enter or click away to save, Escape to back out. Edit turns the
// whole table into inputs over a draft copy for the structural changes
// (adding and removing teams and verticals); Save writes the tidied draft
// to settings.salesCoverage, Cancel drops it. Until the first save the
// list is the default in data/salesCoverage.js.
const th = {
  zIndex: 1,
  textAlign: 'left',
  padding: '0.45rem 0.75rem',
  background: '#1F4E79',
  color: '#fff',
  fontWeight: 600,
  position: 'sticky',
  top: 0,
};
const td = {
  padding: '0.3rem 0.75rem',
  borderBottom: '1px solid var(--color-border, #E2E8F0)',
};
const teamRow = {
  padding: '0.35rem 0.75rem',
  background: '#D9E1F2',
  color: '#1E293B',
  fontWeight: 700,
};
const input = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.25rem 0.4rem',
  font: 'inherit',
  border: '1px solid var(--color-border, #CBD5E1)',
  borderRadius: 4,
  background: 'var(--color-surface, #fff)',
  color: 'inherit',
};
const linkBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: '0.75rem',
  color: 'var(--color-accent, #2563EB)',
  cursor: 'pointer',
};
const removeBtn = { ...linkBtn, color: '#B91C1C' };

// A cell that turns into an input on click and saves on Enter or blur.
function InlineCell({ value, onCommit, disabled, placeholder, style }) {
  const [text, setText] = useState(null);
  if (disabled) return <span style={style}>{value}</span>;
  if (text === null) {
    return (
      <span
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={() => setText(value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setText(value); } }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(37, 99, 235, 0.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        style={{ display: 'block', minHeight: '1.2em', margin: '-0.15rem -0.3rem', padding: '0.15rem 0.3rem', borderRadius: 4, cursor: 'text', ...style }}
      >{value || <span style={{ color: '#CBD5E1' }}>{placeholder}</span>}</span>
    );
  }
  const commit = () => {
    const next = text;
    setText(null);
    if (next.trim() !== String(value || '').trim()) onCommit(next);
  };
  return (
    <input
      autoFocus
      onFocus={e => e.target.select()}
      style={{ ...input, ...style }}
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setText(null); }
      }}
    />
  );
}

// The draft keeps salespeople as the typed "A, B" string so a comma can be
// typed mid-name; cleanCoverage splits it back into a list on save.
function toDraft(groups) {
  return groups.map(g => ({
    team: g.team,
    rows: g.rows.map(r => ({ vertical: r.vertical, salespeople: r.salespeople.join(', ') })),
  }));
}

export function Coverage({ settings, updateSettings }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const editing = draft != null;
  const coverage = coverageFromSettings(settings);
  const customized = Array.isArray(settings?.salesCoverage);
  const canEdit = !!updateSettings && settingsHaveLoaded(settings);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Each row keeps its place in the full list (gi / ri), so an inline
    // edit made under a search lands on the right row.
    return coverage
      .map((g, gi) => {
        const rows = g.rows.map((r, ri) => ({ ...r, ri }));
        return {
          team: g.team,
          gi,
          rows: !q || g.team.toLowerCase().includes(q)
            ? rows
            : rows.filter(r =>
              r.vertical.toLowerCase().includes(q)
              || r.salespeople.some(s => s.toLowerCase().includes(q))),
        };
      })
      .filter(g => g.rows.length > 0 || (!q && g.team));
  }, [coverage, query]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  const editTeam = (gi, patch) => setDraft(d => d.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const editRow = (gi, ri, patch) => editTeam(gi, {
    rows: draft[gi].rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)),
  });
  const addRow = gi => editTeam(gi, { rows: [...draft[gi].rows, { vertical: '', salespeople: '' }] });
  const removeRow = (gi, ri) => editTeam(gi, { rows: draft[gi].rows.filter((_, j) => j !== ri) });
  const addTeam = () => setDraft(d => [...d, { team: '', rows: [{ vertical: '', salespeople: '' }] }]);
  const removeTeam = gi => {
    const g = draft[gi];
    if (g.rows.length && !window.confirm(`Remove ${g.team || 'this team'} and its ${g.rows.length} vertical${g.rows.length === 1 ? '' : 's'}?`)) return;
    setDraft(d => d.filter((_, i) => i !== gi));
  };

  const saveCell = (edit) => updateSettings({ salesCoverage: withCoverageEdit(coverage, edit) });

  const save = () => {
    updateSettings({ salesCoverage: cleanCoverage(draft) });
    setDraft(null);
  };
  const resetToDefault = () => {
    if (!window.confirm('Replace your edits with the original coverage list?')) return;
    setDraft(toDraft(SALES_COVERAGE));
  };

  return (
    <>
      <div className={styles.searchRow}>
        {editing ? (
          <>
            <button type="button" className={styles.clearFiltersBtn} onClick={save}
              style={{ color: '#fff', background: 'var(--color-accent, #2563EB)', borderColor: 'transparent' }}>
              Save
            </button>
            <button type="button" className={styles.clearFiltersBtn} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className={styles.clearFiltersBtn} onClick={addTeam}>+ Add team</button>
            {customized && (
              <button type="button" className={styles.clearFiltersBtn} onClick={resetToDefault}>Reset to original</button>
            )}
            <span className={styles.resultCount}>
              Separate several salespeople with commas. Blank rows are dropped on save.
            </span>
          </>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search vertical, salesperson or team"
              style={{ padding: '0.35rem 0.6rem', minWidth: 280, fontSize: '0.8rem' }}
            />
            <span className={styles.resultCount}>
              {count} vertical assignment{count === 1 ? '' : 's'}{canEdit ? ' · click any cell to edit it' : ''}
            </span>
            <button
              type="button"
              className={styles.clearFiltersBtn}
              disabled={!canEdit}
              title={canEdit ? 'Add or remove teams and verticals' : 'Loading your settings'}
              onClick={() => { setQuery(''); setDraft(toDraft(coverage)); }}
            >Edit</button>
          </>
        )}
      </div>
      {/* The Opps wrapper clips its overflow (every other tab scrolls inside
          its own DataTable), so this list needs its own scroll box or the
          bottom teams are unreachable. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 1.25rem 1.25rem' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>Team</th>
              <th style={th}>Vertical</th>
              <th style={th}>Salesperson</th>
              {editing && <th style={{ ...th, width: 70 }} />}
            </tr>
          </thead>
          <tbody>
            {editing ? draft.map((g, gi) => [
              <tr key={`t${gi}`}>
                <td colSpan={3} style={teamRow}>
                  <input
                    style={{ ...input, fontWeight: 700, maxWidth: 280 }}
                    value={g.team}
                    placeholder="Team lead"
                    aria-label="Team lead"
                    onChange={e => editTeam(gi, { team: e.target.value })}
                  />
                </td>
                <td style={teamRow}>
                  <button type="button" style={removeBtn} onClick={() => removeTeam(gi)}>Remove</button>
                </td>
              </tr>,
              ...g.rows.map((r, ri) => (
                <tr key={`t${gi}r${ri}`}>
                  <td style={{ ...td, color: '#94A3B8' }}>{g.team}</td>
                  <td style={td}>
                    <input style={input} value={r.vertical} placeholder="Vertical" aria-label="Vertical"
                      onChange={e => editRow(gi, ri, { vertical: e.target.value })} />
                  </td>
                  <td style={td}>
                    <input style={input} value={r.salespeople} placeholder="Salesperson" aria-label="Salesperson"
                      onChange={e => editRow(gi, ri, { salespeople: e.target.value })} />
                  </td>
                  <td style={td}>
                    <button type="button" style={removeBtn} aria-label="Remove vertical"
                      onClick={() => removeRow(gi, ri)}>Remove</button>
                  </td>
                </tr>
              )),
              <tr key={`t${gi}add`}>
                <td style={td} />
                <td colSpan={3} style={td}>
                  <button type="button" style={linkBtn} onClick={() => addRow(gi)}>+ Add vertical</button>
                </td>
              </tr>,
            ]) : (
              <>
                {groups.length === 0 && (
                  <tr><td colSpan={3} style={{ ...td, color: '#64748B' }}>No matches.</td></tr>
                )}
                {groups.map(g => [
                  <tr key={`t${g.gi}`}>
                    <td colSpan={3} style={teamRow}>
                      <InlineCell value={g.team} disabled={!canEdit} placeholder="Team lead" style={{ maxWidth: 280 }}
                        onCommit={v => saveCell({ gi: g.gi, field: 'team', value: v })} />
                    </td>
                  </tr>,
                  ...g.rows.map(r => (
                    <tr key={`t${g.gi}r${r.ri}`}>
                      <td style={{ ...td, color: '#94A3B8' }}>{g.team}</td>
                      <td style={td}>
                        <InlineCell value={r.vertical} disabled={!canEdit} placeholder="Vertical"
                          onCommit={v => saveCell({ gi: g.gi, ri: r.ri, field: 'vertical', value: v })} />
                      </td>
                      <td style={td}>
                        <InlineCell value={r.salespeople.join(', ')} disabled={!canEdit} placeholder="Salesperson"
                          onCommit={v => saveCell({ gi: g.gi, ri: r.ri, field: 'salespeople', value: v })} />
                      </td>
                    </tr>
                  )),
                ])}
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
