import { useState, useEffect, useMemo, useRef } from 'react';
import styles from './Sidebar.module.css';
import { AGENTS_RUN_INTERVAL_BUSINESS_DAYS } from '../utils/agentsRunReminder';

// Predictive company + contact search shown in the sidebar header (replaces
// the old "Sales Pipeline" subtitle). Type a company name, or a contact's
// name / email, and pick a match: a company opens its account popup via
// onSelectProspect; a contact opens that same popup focused on the contact
// (onSelectContact) — the handlers the rest of the app uses. Matches prefer
// names that start with the query, then ones that contain it; each group is
// capped so the dropdown stays short.
function CompanySearch({ prospects = [], contacts = [], onSelectProspect, onSelectContact, onCreateCompany }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);

  // One entry per company (deduped by lowercased name, first prospect wins).
  const companies = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of prospects) {
      const name = String(p?.company || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [prospects]);

  const companyMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts = [];
    const includes = [];
    for (const p of companies) {
      const name = String(p.company).toLowerCase();
      if (name.startsWith(q)) starts.push(p);
      else if (name.includes(q)) includes.push(p);
    }
    const byName = (a, b) => String(a.company).localeCompare(String(b.company));
    starts.sort(byName);
    includes.sort(byName);
    return [...starts, ...includes].slice(0, 6);
  }, [companies, query]);

  // Contacts matched by full name or email. Deduped by contact id (falling
  // back to a name+email key), starts-with ranked ahead of contains.
  const contactMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const starts = [];
    const includes = [];
    for (const c of contacts) {
      const name = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
      const email = String(c?.email || '').trim();
      if (!name && !email) continue;
      const key = String(c?.id ?? `${name}|${email}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const nl = name.toLowerCase();
      const el = email.toLowerCase();
      if (nl.startsWith(q) || el.startsWith(q)) starts.push(c);
      else if (nl.includes(q) || el.includes(q)) includes.push(c);
    }
    const byName = (a, b) => {
      const an = [a?.firstname, a?.lastname].filter(Boolean).join(' ');
      const bn = [b?.firstname, b?.lastname].filter(Boolean).join(' ');
      return an.localeCompare(bn);
    };
    starts.sort(byName);
    includes.sort(byName);
    return [...starts, ...includes].slice(0, 6);
  }, [contacts, query]);

  // Whether the typed name already exists as a company. Compared against the
  // full roster, not just the capped match list, so a name that exists but
  // ranked past the cap doesn't offer a duplicate-creating "Create" row.
  const exactCompanyExists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return companies.some(p => String(p.company).trim().toLowerCase() === q);
  }, [companies, query]);

  // Flat, keyboard-navigable list: companies first, then contacts, then the
  // "create this company" row. Each item carries its type so Enter / click
  // routes to the right handler. The create row is offered whenever the typed
  // name isn't already a company — so it covers both "nothing matched" and
  // "something matched, but not the company I meant". It sorts last so the
  // default Enter still opens the top existing match.
  const items = useMemo(() => {
    const base = [
      ...companyMatches.map(p => ({ type: 'company', data: p })),
      ...contactMatches.map(c => ({ type: 'contact', data: c })),
    ];
    const name = query.trim();
    if (onCreateCompany && name && !exactCompanyExists) {
      base.push({ type: 'create', data: name });
    }
    return base;
  }, [companyMatches, contactMatches, query, exactCompanyExists, onCreateCompany]);

  useEffect(() => { setActive(0); }, [query]);

  // Close the dropdown when clicking outside the search.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(item) {
    if (!item) return;
    if (item.type === 'company') onSelectProspect?.(item.data);
    else if (item.type === 'create') onCreateCompany?.(item.data);
    else onSelectContact?.(item.data);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (items[active]) { e.preventDefault(); choose(items[active]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  const showDropdown = open && query.trim().length > 0;
  const firstContactIdx = companyMatches.length; // where the Contacts group starts

  return (
    <div className={styles.searchWrap} ref={wrapRef}>
      <input
        className={styles.searchInput}
        type="text"
        placeholder="Search companies & contacts…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (query.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
        aria-label="Search companies and contacts"
        autoComplete="off"
      />
      {showDropdown && (
        <div className={styles.searchDropdown} role="listbox">
          {/* Still say plainly that nothing matched — the create row below
              is an offer, not a search result. */}
          {companyMatches.length === 0 && contactMatches.length === 0 && (
            <div className={styles.searchEmpty}>No companies or contacts match &ldquo;{query.trim()}&rdquo;.</div>
          )}
          {items.map((item, i) => {
            const isCompany = item.type === 'company';
            const isCreate = item.type === 'create';
            const showCompaniesHeader = i === 0 && isCompany;
            const showContactsHeader = i === firstContactIdx && !isCompany && !isCreate;
            const activeCls = i === active ? `${styles.searchItem} ${styles.searchItemActive}` : styles.searchItem;
            if (isCreate) {
              // No company by this name yet — offer to create it. Opens the
              // same new-company popup as "+ New", prefilled with the name.
              return (
                <div key="create-company">
                  {i > 0 && <div className={styles.searchDivider} />}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`${activeCls} ${styles.searchCreate}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                    title={`Create "${item.data}" as a new company`}
                  >
                    {/* Action on the first line, the name on the second —
                        the sidebar is narrow, so this keeps "Create
                        company" always readable and lets a long name
                        ellipsize on its own line. */}
                    <span className={styles.searchCreatePlus} aria-hidden="true">+</span>
                    Create company
                    <span className={styles.searchItemSub}>&ldquo;{item.data}&rdquo;</span>
                  </button>
                </div>
              );
            }
            if (isCompany) {
              const p = item.data;
              return (
                <div key={`c-${p.id ?? p.company}`}>
                  {showCompaniesHeader && contactMatches.length > 0 && <div className={styles.searchGroup}>Companies</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={activeCls}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                    title={p.company}
                  >
                    {p.company}
                    {p.status ? <span className={styles.searchItemSub}>{p.status}</span> : null}
                  </button>
                </div>
              );
            }
            const c = item.data;
            const name = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || c?.email || '(unnamed contact)';
            const sub = [c?.email, c?.company].filter(Boolean).join(' · ');
            return (
              <div key={`k-${c?.id ?? `${name}-${i}`}`}>
                {showContactsHeader && <div className={styles.searchGroup}>Contacts</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={activeCls}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                  title={sub ? `${name} · ${sub}` : name}
                >
                  {name}
                  {sub ? <span className={styles.searchItemSub}>{sub}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ view, setView, user, onLogout, onSync, onOpenBackups, onOpenCdmName, onOpenDailyLog, isAdmin = false, dailyLogEnabled = true, whatToDoTodayEnabled = true, onToggleDailyLog, onToggleWhatToDoToday, issuesCount = 0, oppsDueCount = null, prospectingTagDebt = null, prospectingDue = 0, agentsRunDue = false, prospects = [], contacts = [], onSelectProspect, onSelectContact, onCreateCompany }) {
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
      { kind: 'toggle', key: 'toggleWhatToDo', label: 'What to do today', icon: '☀', checked: whatToDoTodayEnabled, onToggle: () => onToggleWhatToDoToday?.() },
      { kind: 'toggle', key: 'toggleDailyLog', label: 'Daily Success Log', icon: '\u{1F4DD}', checked: dailyLogEnabled, onToggle: () => onToggleDailyLog?.() },
      ...(dailyLogEnabled ? [
        { kind: 'action', key: 'dailyLog', label: 'Open Daily Success Log', icon: '\u{1F4D6}', onClick: () => { onOpenDailyLog?.(); setSettingsOpen(false); } },
      ] : []),
    ] : []),
    { kind: 'view',    key: 'privacy', label: 'Privacy & Security', icon: '\u{1F512}' },
  ];
  const activeInSettings = settingsItems.some(it => it.kind === 'view' && it.key === view);

  return (
    <div className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoText}>Prospect Tracker</div>
        <CompanySearch prospects={prospects} contacts={contacts} onSelectProspect={onSelectProspect} onSelectContact={onSelectContact} onCreateCompany={onCreateCompany} />
      </div>

      <nav className={styles.nav}>
        <button
          className={(view === 'accounts' || view === 'companyType') ? styles.navItemActive : styles.navItem}
          onClick={() => setView('accounts')}
        >
          <span className={styles.navIcon}>&#9733;</span>
          My Accounts
        </button>
        <button
          className={view === 'prospecting' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('prospecting')}
        >
          <span className={styles.navIcon}>&#127919;</span>
          Prospecting
          {/* Contact rosters whose tags still aren't fully mapped, one
              apiece — the same count the Prospecting page shows beside its
              Tagged row, and held back the same way until step 1 is clear,
              so the badge never sends the user past the work the ladder puts
              first. Null (not 0) when there's nothing to show. */}
          {prospectingTagDebt > 0 && (
            <span
              className={styles.navBadge}
              title={`${prospectingTagDebt} contact ${prospectingTagDebt === 1 ? 'roster is' : 'rosters are'} short of fully mapped tags. Open Prospecting to see which — Active isn't counted.`}
            >{prospectingTagDebt > 99 ? '99+' : prospectingTagDebt}</span>
          )}
          {/* A step of the ladder is outstanding: everything above it is
              caught up, so it's the work owed right now and nothing counts
              it but the user. One dot, not a number — the page names the
              step, and there is only ever one of these standing. It clears
              when the step is marked caught up there (and comes back
              tomorrow, like the mark itself). */}
          {prospectingDue > 0 && (
            <span
              className={styles.navDot}
              aria-label="A prospecting step is outstanding"
              title={prospectingDue === 1
                ? 'A prospecting step is outstanding: everything above it is caught up. Open Prospecting and mark it caught up once you\'ve worked it.'
                : `${prospectingDue} prospecting steps are outstanding. Open Prospecting and mark them caught up once you've worked them.`}
            />
          )}
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
          className={view === 'strategic' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('strategic')}
        >
          <span className={styles.navIcon}>&#127919;</span>
          Strategic Accounts
        </button>
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
          {/* Calls owed right now: Call In at or below zero, nothing in the
              "No Further Action Today" column. Same red badge the Issues
              item uses. Hidden at 0 (and while the count is still null,
              i.e. the Opps store hasn't answered yet) so a clear day reads
              as clear. */}
          {oppsDueCount > 0 && (
            <span
              className={styles.navBadge}
              title={`${oppsDueCount} opp${oppsDueCount === 1 ? '' : 's'} due to be called (Call In 0 or less, no "No Further Action Today" mark)`}
            >{oppsDueCount > 99 ? '99+' : oppsDueCount}</span>
          )}
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
          title={agentsRunDue
            ? `The agent prompts haven't been run in ${AGENTS_RUN_INTERVAL_BUSINESS_DAYS}+ business days: open Agents, run them, then hit "Agents Ran".`
            : undefined}
        >
          <span className={styles.navIcon}>&#129302;</span>
          Agents
          {agentsRunDue && (
            <span
              className={styles.navAlert}
              aria-label="Agent prompts are due to be run"
            >!</span>
          )}
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
        {/* Draft Emails carries Email Campaigns and Email Tracking as
            sub-tabs, so those don't get sidebar entries of their own. */}
        <button
          className={view === 'drafts' || view === 'campaigns' || view === 'tracking' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('drafts')}
        >
          <span className={styles.navIcon}>&#9999;</span>
          Draft Emails
        </button>
        <button
          className={view === 'recordings' ? styles.navItemActive : styles.navItem}
          onClick={() => setView('recordings')}
        >
          <span className={styles.navIcon}>&#127908;</span>
          Call Recordings
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
                  role={it.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={it.kind === 'toggle' ? it.checked : undefined}
                  className={isActive ? styles.settingsItemActive : styles.settingsItem}
                  onClick={() => {
                    // Toggles flip a setting in place and keep the menu
                    // open so several can be changed in one pass.
                    if (it.kind === 'toggle') it.onToggle();
                    else if (it.kind === 'action') it.onClick();
                    else chooseView(it.key);
                  }}
                >
                  <span className={styles.navIcon}>{it.icon}</span>
                  {it.label}
                  {it.kind === 'toggle' && (
                    <span className={it.checked ? styles.toggleStateOn : styles.toggleStateOff}>
                      {it.checked ? 'On' : 'Off'}
                    </span>
                  )}
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
