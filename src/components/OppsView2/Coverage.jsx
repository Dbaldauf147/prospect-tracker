import { useMemo, useState } from 'react';
import { SALES_COVERAGE } from '../../data/salesCoverage';
import styles from './OppsView2.module.css';

// Opps > Coverage: which salesperson covers each vertical, grouped under
// the team lead, laid out like the source sheet. The search box narrows
// on vertical, salesperson or team, so "who has Grocery?" or "what does
// Sara cover?" is one word away.
const th = {
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

export function Coverage() {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SALES_COVERAGE
      .map(g => ({
        team: g.team,
        rows: !q || g.team.toLowerCase().includes(q)
          ? g.rows
          : g.rows.filter(r =>
            r.vertical.toLowerCase().includes(q)
            || r.salespeople.some(s => s.toLowerCase().includes(q))),
      }))
      .filter(g => g.rows.length > 0);
  }, [query]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <div className={styles.searchRow}>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search vertical, salesperson or team"
          style={{ padding: '0.35rem 0.6rem', minWidth: 280, fontSize: '0.8rem' }}
        />
        <span className={styles.resultCount}>
          {count} vertical assignment{count === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ padding: '0 1.25rem 1.25rem' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>Team</th>
              <th style={th}>Vertical</th>
              <th style={th}>Salesperson</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={3} style={{ ...td, color: '#64748B' }}>No matches.</td></tr>
            )}
            {groups.map(g => [
              <tr key={g.team}>
                <td colSpan={3} style={teamRow}>{g.team}</td>
              </tr>,
              ...g.rows.map(r => (
                <tr key={`${g.team}|${r.vertical}`}>
                  <td style={{ ...td, color: '#94A3B8' }}>{g.team}</td>
                  <td style={td}>{r.vertical}</td>
                  <td style={td}>{r.salespeople.join(', ')}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
