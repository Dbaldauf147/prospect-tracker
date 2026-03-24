import styles from './Sidebar.module.css';

export function Sidebar({ view, setView, user, onLogout }) {
  const initials = user?.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase()
    : user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoText}>Prospect Tracker</div>
        <div className={styles.logoSub}>Sales Pipeline</div>
      </div>

      <nav className={styles.nav}>
        <button
          className={view === 'table' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('table')}
        >
          <span className={styles.navIcon}>&#9776;</span>
          Table View
        </button>
        <button
          className={view === 'kanban' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('kanban')}
        >
          <span className={styles.navIcon}>&#9634;</span>
          Pipeline View
        </button>
      </nav>

      <div className={styles.userSection}>
        <div className={styles.avatar}>
          {user?.photoURL ? <img src={user.photoURL} alt="" /> : initials}
        </div>
        <span className={styles.userName}>{user?.displayName || user?.email}</span>
        <button className={styles.logoutBtn} onClick={onLogout} title="Sign out">&#x2192;</button>
      </div>
    </div>
  );
}
