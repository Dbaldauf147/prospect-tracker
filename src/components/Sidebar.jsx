import { useState, useEffect, useRef } from 'react';
import styles from './Sidebar.module.css';

export function Sidebar({ view, setView, user, onLogout, onSync, onOpenBackups, onOpenCdmName, onOpenDailyLog, isAdmin = false, issuesCount = 0 }) {
  const initials = user?.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase()
    : user?.email?.[0]?.toUpperCase() || '?';

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrapRef = useRef(null);

  // Close the gear popover when the user clicks outside of it.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e) => {
      if (!settingsWrapRef.current?.contains(e.target)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  function chooseView(next) {
    setView(next);
    setSettingsOpen(false);
  }

  const settingsItems = [
    { kind: 'view',    key: 'vibe',    label: 'Vibe Prospecting',  icon: '\u{1F50D}' },
    { kind: 'action',  key: 'sync',    label: 'Sync Google Sheets', icon: '↻',          onClick: () => { onSync?.(); setSettingsOpen(false); } },
    { kind: 'action',  key: 'cdm',     label: 'CDM Name',           icon: '\u{1F464}',   onClick: () => { onOpenCdmName?.(); setSettingsOpen(false); } },
    { kind: 'action',  key: 'backups', label: 'Backups',            icon: '\u{1F4BE}',   onClick: () => { onOpenBackups?.(); setSettingsOpen(false); } },
    ...(isAdmin ? [
      { kind: 'action', key: 'dailyLog', label: 'Daily Success Log', icon: '\u{1F4DD}', onClick: () => { onOpenDailyLog?.(); setSettingsOpen(false); } },
    ] : []),
    { kind: 'view',    key: 'privacy', label: 'Privacy & Security', icon: '\u{1F512}' },
  ];
  const activeInSettings = settingsItems.some(it => it.kind === 'view' && it.key === view);

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
          className={view === 'lists' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('lists')}
        >
          <span className={styles.navIcon}>&#9776;</span>
          Lists
        </button>
        {/* Opps - Old nav hidden — uncomment to restore. Route is still wired up in App.jsx so the view is reachable manually if needed.
        <button
          className={view === 'opps' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('opps')}
        >
          <span className={styles.navIcon}>&#36;</span>
          Opps - Old
        </button>
        */}
        <button
          className={view === 'opps2' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('opps2')}
        >
          <span className={styles.navIcon}>&#36;</span>
          Opps
        </button>
        <button
          className={view === 'dropdowns' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('dropdowns')}
        >
          <span className={styles.navIcon}>&#9776;</span>
          Dropdowns
        </button>
        <button
          className={view === 'clients' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('clients')}
        >
          <span className={styles.navIcon}>&#9878;</span>
          Clients
        </button>
        <button
          className={view === 'issues' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('issues')}
        >
          <span className={styles.navIcon}>&#9888;</span>
          Issues
          {issuesCount > 0 && (
            <span className={styles.navBadge}>{issuesCount > 99 ? '99+' : issuesCount}</span>
          )}
        </button>
        <button
          className={view === 'activity' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('activity')}
        >
          <span className={styles.navIcon}>&#9202;</span>
          Activity
        </button>
        <button
          className={view === 'agents' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('agents')}
        >
          <span className={styles.navIcon}>&#129302;</span>
          Agents
        </button>
        <button
          className={view === 'pe' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('pe')}
        >
          <span className={styles.navIcon}>&#127970;</span>
          PE Portfolio
        </button>
        <button
          className={view === 'contacts' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('contacts')}
        >
          <span className={styles.navIcon}>&#128100;</span>
          Contacts
        </button>
        <button
          className={view === 'drafts' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('drafts')}
        >
          <span className={styles.navIcon}>&#9999;</span>
          Draft Emails
        </button>
        <button
          className={view === 'charts' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('charts')}
        >
          <span className={styles.navIcon}>&#128202;</span>
          Charts
        </button>
        <button
          className={view === 'pricing' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('pricing')}
        >
          <span className={styles.navIcon}>&#128181;</span>
          Pricing
        </button>
        <button
          className={view === 'bfo' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('bfo')}
        >
          <span className={styles.navIcon}>&#128203;</span>
          BFO Activity
        </button>
      </nav>

      <div className={styles.settingsWrap} ref={settingsWrapRef}>
        <button
          className={(settingsOpen || activeInSettings) ? styles.settingsBtnActive : styles.settingsBtn}
          onClick={() => setSettingsOpen(v => !v)}
          title="Settings"
        >
          <span className={styles.navIcon}>&#9881;</span>
          Settings
          <span className={styles.settingsCaret}>{settingsOpen ? '▾' : '▸'}</span>
        </button>
        {settingsOpen && (
          <div className={styles.settingsPopover} role="menu">
            {settingsItems.map(it => {
              const isActive = it.kind === 'view' && view === it.key;
              return (
                <button
                  key={it.key}
                  role="menuitem"
                  className={isActive ? styles.settingsItemActive : styles.settingsItem}
                  onClick={() => {
                    if (it.kind === 'action') it.onClick();
                    else chooseView(it.key);
                  }}
                >
                  <span className={styles.navIcon}>{it.icon}</span>
                  {it.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

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
