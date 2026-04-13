import styles from './Sidebar.module.css';

export function Sidebar({ view, setView, user, onLogout, onSync }) {
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
          className={view === 'accounts' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('accounts')}
        >
          <span className={styles.navIcon}>&#9733;</span>
          My Accounts
        </button>
        <button
          className={view === 'table' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('table')}
        >
          <span className={styles.navIcon}>&#9776;</span>
          Table View
        </button>
        <button
          className={view === 'targets' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('targets')}
        >
          <span className={styles.navIcon}>&#9872;</span>
          Target Accounts
        </button>
        <button
          className={view === 'opps' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('opps')}
        >
          <span className={styles.navIcon}>&#36;</span>
          Opps
        </button>
        <button
          className={view === 'clients' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('clients')}
        >
          <span className={styles.navIcon}>&#9878;</span>
          Clients
        </button>
        <button
          className={view === 'raclients' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('raclients')}
        >
          <span className={styles.navIcon}>&#9881;</span>
          RA Clients
        </button>
        <button
          className={view === 'activity' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('activity')}
        >
          <span className={styles.navIcon}>&#9202;</span>
          Activity
        </button>
        <button
          className={view === 'hubspot' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('hubspot')}
        >
          <span className={styles.navIcon}>&#9993;</span>
          HubSpot Contacts
        </button>
        <button
          className={view === 'drafts' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('drafts')}
        >
          <span className={styles.navIcon}>&#9999;</span>
          Draft Emails
        </button>
        <button
          className={view === 'progress' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('progress')}
        >
          <span className={styles.navIcon}>&#128200;</span>
          Progress
        </button>
        <button
          className={view === 'campaigns' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('campaigns')}
        >
          <span className={styles.navIcon}>&#128231;</span>
          Email Campaigns
        </button>
        <button
          className={view === 'vibe' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('vibe')}
        >
          <span className={styles.navIcon}>&#128269;</span>
          Vibe Prospecting
        </button>
        <button
          className={view === 'dedupe' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('dedupe')}
        >
          <span className={styles.navIcon}>&#x2702;</span>
          Deduplication
        </button>
        <button
          className={styles.navItem}
          onClick={onSync}
        >
          <span className={styles.navIcon}>&#8635;</span>
          Sync Google Sheets
        </button>
        <button
          className={view === 'privacy' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('privacy')}
        >
          <span className={styles.navIcon}>&#128274;</span>
          Privacy & Security
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
