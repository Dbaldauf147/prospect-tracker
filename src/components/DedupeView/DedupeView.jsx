import { useState, useEffect, useMemo } from 'react';
import styles from './DedupeView.module.css';

const CACHE_KEY = 'hubspot-sync-cache';
const DISMISSED_KEY = 'dedupe-dismissed';

function loadHubSpotCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY))); } catch { return new Set(); }
}

function saveDismissed(set) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

// Normalize name for comparison
function normName(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

// Simple similarity check — are two strings very close?
function isSimilar(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  // Levenshtein-ish: check if only 1-2 chars different for short strings
  if (Math.abs(na.length - nb.length) > 2) return false;
  let diff = 0;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  for (let i = 0; i < longer.length; i++) {
    if (longer[i] !== shorter[i]) diff++;
    if (diff > 2) return false;
  }
  return true;
}

function findDuplicateGroups(contacts) {
  // Filter out @se.com contacts
  contacts = contacts.filter(c => !(c.email || '').toLowerCase().endsWith('@se.com'));

  const groups = [];
  const used = new Set();

  // 1. Exact email matches
  const byEmail = new Map();
  for (const c of contacts) {
    const email = (c.email || '').toLowerCase().trim();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(c);
  }
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    const ids = group.map(c => c.id).sort().join('|');
    groups.push({ reason: 'Same email', type: 'email', key: `email:${email}`, contacts: group, matchValue: email });
    group.forEach(c => used.add(c.id));
  }

  // 2. Similar names at same company
  const byCompany = new Map();
  for (const c of contacts) {
    const company = normName(c.company);
    if (!company) continue;
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(c);
  }
  for (const [company, companyContacts] of byCompany) {
    for (let i = 0; i < companyContacts.length; i++) {
      for (let j = i + 1; j < companyContacts.length; j++) {
        const a = companyContacts[i];
        const b = companyContacts[j];
        if (used.has(a.id) && used.has(b.id)) continue;
        const nameA = `${a.firstname || ''} ${a.lastname || ''}`.trim();
        const nameB = `${b.firstname || ''} ${b.lastname || ''}`.trim();
        if (isSimilar(nameA, nameB) && nameA.length > 2) {
          const key = `name:${[a.id, b.id].sort().join('|')}`;
          groups.push({ reason: 'Similar name, same company', type: 'name', key, contacts: [a, b], matchValue: `${nameA} / ${nameB} at ${a.company}` });
          used.add(a.id);
          used.add(b.id);
        }
      }
    }
  }

  // 3. Same name, different companies
  const byName = new Map();
  for (const c of contacts) {
    const name = normName(`${c.firstname}${c.lastname}`);
    if (!name || name.length < 4) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(c);
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const newGroup = group.filter(c => !used.has(c.id));
    if (newGroup.length < 2) continue;
    const key = `fullname:${name}`;
    const displayName = `${group[0].firstname || ''} ${group[0].lastname || ''}`.trim();
    groups.push({ reason: 'Same name', type: 'company', key, contacts: newGroup, matchValue: displayName });
    newGroup.forEach(c => used.add(c.id));
  }

  return groups;
}

export function DedupeView() {
  const [data, setData] = useState(loadHubSpotCache);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [status, setStatus] = useState(null);
  const [merging, setMerging] = useState(false);
  const [selectedKeep, setSelectedKeep] = useState({}); // key -> contactId to keep
  const [tab, setTab] = useState('all');

  // Re-read cache when it changes
  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = loadHubSpotCache();
      if (fresh?.syncedAt !== data?.syncedAt) setData(fresh);
    }, 5000);
    return () => clearInterval(interval);
  }, [data]);

  const contacts = data?.contacts || [];

  const allGroups = useMemo(() => findDuplicateGroups(contacts), [contacts]);
  const groups = allGroups.filter(g => !dismissed.has(g.key));

  const emailGroups = groups.filter(g => g.type === 'email');
  const nameGroups = groups.filter(g => g.type === 'name');
  const companyGroups = groups.filter(g => g.type === 'company');

  const visibleGroups = tab === 'email' ? emailGroups : tab === 'name' ? nameGroups : tab === 'company' ? companyGroups : groups;

  function dismiss(key) {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      saveDismissed(next);
      return next;
    });
  }

  async function handleMerge(group) {
    const keepId = selectedKeep[group.key];
    if (!keepId) {
      setStatus({ type: 'error', message: 'Select which contact to keep first' });
      return;
    }
    const toDelete = group.contacts.filter(c => c.id !== keepId);
    if (toDelete.length === 0) return;

    setMerging(true);
    setStatus(null);
    let deleted = 0, errors = 0;
    for (const c of toDelete) {
      try {
        const res = await fetch('/api/hubspot?action=delete-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: c.id }),
        });
        const json = await res.json();
        if (json.error) errors++;
        else deleted++;
      } catch { errors++; }
    }

    // Update local cache
    const deleteIds = new Set(toDelete.map(c => c.id));
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, contacts: prev.contacts.filter(c => !deleteIds.has(c.id)) };
      localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
      return updated;
    });

    dismiss(group.key);
    setStatus({ type: 'success', message: `Merged: kept 1, deleted ${deleted}${errors > 0 ? `, ${errors} errors` : ''}` });
    setMerging(false);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Deduplication</h2>
          <span className={styles.subtitle}>Find and merge duplicate contacts in HubSpot</span>
        </div>
      </div>

      {status && (
        <div className={status.type === 'success' ? styles.success : styles.error}>
          {status.message}
        </div>
      )}

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total Contacts</div>
          <div className={styles.summaryValue}>{contacts.length}</div>
        </div>
        <div className={styles.summaryCard} style={{ borderLeftColor: '#DC2626' }}>
          <div className={styles.summaryLabel}>Duplicate Groups</div>
          <div className={styles.summaryValue}>{groups.length}</div>
        </div>
        <div className={styles.summaryCard} style={{ borderLeftColor: '#F59E0B' }}>
          <div className={styles.summaryLabel}>Contacts to Review</div>
          <div className={styles.summaryValue}>{groups.reduce((s, g) => s + g.contacts.length, 0)}</div>
        </div>
        <div className={styles.summaryCard} style={{ borderLeftColor: '#6B7280' }}>
          <div className={styles.summaryLabel}>Dismissed</div>
          <div className={styles.summaryValue}>{dismissed.size}</div>
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={tab === 'all' ? styles.tabActive : styles.tab} onClick={() => setTab('all')}>
          All <span className={styles.tabCount}>{groups.length}</span>
        </button>
        <button className={tab === 'email' ? styles.tabActive : styles.tab} onClick={() => setTab('email')}>
          Same Email <span className={styles.tabCount}>{emailGroups.length}</span>
        </button>
        <button className={tab === 'name' ? styles.tabActive : styles.tab} onClick={() => setTab('name')}>
          Similar Name <span className={styles.tabCount}>{nameGroups.length}</span>
        </button>
        <button className={tab === 'company' ? styles.tabActive : styles.tab} onClick={() => setTab('company')}>
          Same Name <span className={styles.tabCount}>{companyGroups.length}</span>
        </button>
      </div>

      {contacts.length === 0 ? (
        <div className={styles.empty}>Sync HubSpot contacts first to scan for duplicates</div>
      ) : visibleGroups.length === 0 ? (
        <div className={styles.empty}>No duplicates found. Your contacts look clean!</div>
      ) : (
        <div className={styles.groupList}>
          {visibleGroups.map(group => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={
                  group.type === 'email' ? styles.badgeEmail :
                  group.type === 'name' ? styles.badgeName :
                  styles.badgeCompany
                }>
                  {group.reason}
                </span>
                <span className={styles.groupReason}>{group.matchValue}</span>
                <span className={styles.groupCount}>{group.contacts.length} contacts</span>
                <div className={styles.groupActions}>
                  <button
                    className={styles.mergeBtn}
                    onClick={() => handleMerge(group)}
                    disabled={merging || !selectedKeep[group.key]}
                  >
                    Merge
                  </button>
                  <button className={styles.dismissBtn} onClick={() => dismiss(group.key)}>
                    Dismiss
                  </button>
                </div>
              </div>
              {group.contacts.map(c => {
                const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || 'No name';
                const isKeep = selectedKeep[group.key] === c.id;
                return (
                  <div key={c.id} className={styles.contactRow}>
                    <input
                      type="radio"
                      name={`keep-${group.key}`}
                      className={styles.contactRadio}
                      checked={isKeep}
                      onChange={() => setSelectedKeep(prev => ({ ...prev, [group.key]: c.id }))}
                    />
                    <div className={styles.contactInfo}>
                      <span className={styles.contactName}>{name}</span>
                      <div className={styles.contactDetail}>
                        <span className={styles.contactDetailItem}>
                          <span className={styles.contactDetailLabel}>Email:</span>
                          <span className={styles.contactDetailValue}>{c.email || '—'}</span>
                        </span>
                        <span className={styles.contactDetailItem}>
                          <span className={styles.contactDetailLabel}>Company:</span>
                          <span className={styles.contactDetailValue}>{c.company || '—'}</span>
                        </span>
                        <span className={styles.contactDetailItem}>
                          <span className={styles.contactDetailLabel}>Title:</span>
                          <span className={styles.contactDetailValue}>{c.jobtitle || '—'}</span>
                        </span>
                        <span className={styles.contactDetailItem}>
                          <span className={styles.contactDetailLabel}>Phone:</span>
                          <span className={styles.contactDetailValue}>{c.phone || '—'}</span>
                        </span>
                      </div>
                    </div>
                    {isKeep && <span className={styles.keepBadge}>Keep</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
