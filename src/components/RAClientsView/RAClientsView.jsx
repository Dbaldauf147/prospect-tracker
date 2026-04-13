import { useState, useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import raClientsData from '../../data/raClients.json';
import styles from './RAClientsView.module.css';

const COLUMNS = [
  { key: 'MDM Name', label: 'MDM Name', defaultWidth: 220, sticky: true },
  { key: 'Client Added', label: 'Client Added', defaultWidth: 110 },
  { key: 'First Activity', label: 'First Activity', defaultWidth: 110 },
  { key: 'Recent Activity', label: 'Recent Activity', defaultWidth: 120 },
  { key: 'Years with Access', label: 'Years w/ Access', defaultWidth: 100 },
  { key: 'RA Completeness', label: 'RA Completeness', defaultWidth: 115 },
  { key: 'Users', label: 'Users', defaultWidth: 70 },
  { key: 'Sites', label: 'Sites', defaultWidth: 70 },
  { key: 'IDM Portfolio', label: 'IDM Portfolio', defaultWidth: 100 },
  { key: 'Projects', label: 'Projects', defaultWidth: 80 },
  { key: 'AV Apps', label: 'AV Apps', defaultWidth: 75 },
  { key: 'Surveys', label: 'Surveys', defaultWidth: 80 },
  { key: 'Corporate HQ', label: 'Corporate HQ', defaultWidth: 120 },
  { key: 'Global Footprint', label: 'Global Footprint', defaultWidth: 110 },
  { key: 'Average Site Cost', label: 'Avg Site Cost', defaultWidth: 120,
    render: (row) => {
      const v = row['Average Site Cost'];
      if (v == null || v === '' || v === '-') return '—';
      return '$' + Number(v).toLocaleString();
    },
  },
  { key: 'Client Management Team', label: 'Client Mgmt Team', defaultWidth: 180 },
];

const rows = raClientsData.map((r, i) => ({ ...r, id: i }));

export function RAClientsView() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.values(r).some(v => String(v).toLowerCase().includes(term))
    );
  }, [search]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>RA Clients</h1>
          <div className={styles.subtitle}>{rows.length} clients</div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      <DataTable
        tableId="ra-clients"
        columns={COLUMNS}
        rows={filtered}
        alwaysVisible={['MDM Name']}
        emptyMessage="No matching RA clients found"
      />
    </div>
  );
}
