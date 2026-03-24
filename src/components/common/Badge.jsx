import styles from './Badge.module.css';

export function Badge({ label, color }) {
  const bg = color + '18';
  return (
    <span className={styles.badge} style={{ color, background: bg }}>
      {label}
    </span>
  );
}
