import { useState } from 'react';
import { RAClientsView } from '../RAClientsView/RAClientsView';
import { TargetAccountsView } from '../TargetAccountsView/TargetAccountsView';
import styles from './ListsView.module.css';

const SUBTABS = [
  { key: 'raclients', label: 'RA Clients' },
  { key: 'targets', label: 'Target Accounts' },
];

export function ListsView({ onTargetAccountsLoaded }) {
  const [subtab, setSubtab] = useState('raclients');

  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabs}>
        {SUBTABS.map(t => (
          <button
            key={t.key}
            className={subtab === t.key ? styles.subtabActive : styles.subtab}
            onClick={() => setSubtab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {subtab === 'raclients' && <RAClientsView />}
        {subtab === 'targets' && <TargetAccountsView onDataLoaded={onTargetAccountsLoaded} />}
      </div>
    </div>
  );
}
