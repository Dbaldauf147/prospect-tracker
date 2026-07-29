import { useState, useEffect, useMemo } from 'react';
import { RAClientsView } from '../RAClientsView/RAClientsView';
import { TargetAccountsView } from '../TargetAccountsView/TargetAccountsView';
import { RECAClientsView } from '../RECAClientsView/RECAClientsView';
import { EcoActClientsView } from '../EcoActClientsView/EcoActClientsView';
import { SitesView } from '../SitesView/SitesView';
import { MasterSiteListView } from '../MasterSiteListView/MasterSiteListView';
import { UploadedListView } from '../UploadedListView/UploadedListView';
import { loadList as loadListFromIDB } from '../../utils/uploadedListStore';
import { matchesCdm } from '../../utils/cdmMatch';
import { userLsGet } from '../../utils/userLs';
import styles from './ListsView.module.css';

const SUBTABS = [
  { key: 'raclients', label: 'RA Clients' },
  { key: 'targets', label: 'Targets' },
  { key: 'largest', label: 'Largest', storageKey: 'largest-list-override' },
  { key: 'strategic', label: 'Strategic Accounts', storageKey: 'strategic-accounts-override' },
  { key: 'sites', label: 'Utility Lookup' },
  { key: 'mastersites', label: 'Master Site List' },
  { key: 'recaclients', label: 'RECA', storageKey: 'reca-clients-override' },
  { key: 'ecoactclients', label: 'EcoAct', storageKey: 'ecoact-clients-override' },
  { key: 'csrd', label: 'CSRD', storageKey: 'csrd-list-override' },
  { key: 'cdp', label: 'CDP', storageKey: 'cdp-list-override' },
  { key: 'gresb', label: 'GRESB', storageKey: 'gresb-list-override' },
  { key: 'sbt', label: 'SBT', storageKey: 'sbt-list-override' },
  { key: 'casb', label: 'CA SB', storageKey: 'casb-list-override' },
  { key: 'betterbuildings', label: 'Better Buildings', storageKey: 'better-buildings-override' },
  { key: 'bfoopps', label: 'BFO Opps', storageKey: 'bfo-opps-override' },
];

const LIST_CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
function normalizeListCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(LIST_CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function pickListNameKey(headers) {
  if (!headers?.length) return null;
  return headers.find(k => /company|name|organi[sz]ation|signatory|entity|\bfirm\b/i.test(k)) || headers[0];
}
function safeReadMap(key) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Prefer the Firestore-synced copy of a list-mapping field when it
// exists; fall back to localStorage so coverage still works before
// Firestore loads or on the legacy local-only path.
function pickRemoteOrLocal(remote, field, lsKey) {
  if (remote && remote[field] && typeof remote[field] === 'object') return remote[field];
  return safeReadMap(lsKey);
}

function readSavedUrl(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

// Prepend https:// for links pasted without a protocol so the <a> href
// opens the intended page instead of being treated as a same-origin path.
function ensureProtocol(url) {
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

function DataSourceLink({ storageKey }) {
  const [saved, setSaved] = useState(() => readSavedUrl(storageKey));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);

  // When the parent swaps storageKey (subtab change), re-read from
  // localStorage and reset the edit state so we don't bleed drafts
  // across subtabs.
  useEffect(() => {
    const v = readSavedUrl(storageKey);
    setSaved(v);
    setDraft(v);
    setEditing(false);
  }, [storageKey]);

  function save() {
    const url = draft.trim();
    try {
      if (url) localStorage.setItem(storageKey, url);
      else localStorage.removeItem(storageKey);
    } catch {}
    setSaved(url);
    setEditing(false);
  }

  function clear() {
    try { localStorage.removeItem(storageKey); } catch {}
    setSaved('');
    setDraft('');
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(false); }}
          placeholder="Paste data source URL..."
          style={{ flex: 1, minWidth: 200, padding: '0.25rem 0.5rem', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={save}
          style={{ padding: '0.25rem 0.5rem', border: 'none', borderRadius: 4, background: 'var(--color-accent)', color: '#fff', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >Save</button>
        <button
          type="button"
          onClick={() => { setDraft(saved); setEditing(false); }}
          style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#64748B', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Cancel</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {saved ? (
        <>
          <a
            href={ensureProtocol(saved)}
            target="_blank"
            rel="noopener noreferrer"
            title={saved}
            style={{ fontSize: '0.72rem', color: 'var(--color-accent)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >
            Data source
          </a>
          <button
            type="button"
            onClick={() => { setDraft(saved); setEditing(true); }}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
          >Edit</button>
          <button
            type="button"
            onClick={clear}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
            onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
          >×</button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(''); setEditing(true); }}
          style={{ fontSize: '0.72rem', color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
        >+ Add data source link</button>
      )}
    </div>
  );
}

export function ListsView({ onTargetAccountsLoaded, prospects = [], onSelectProspect, cdmName, settings, updateSettings, updateSettingsPath, updateProspect }) {
  const [subtab, setSubtab] = useState('raclients');
  // { [subtabKey]: { mapped, touched, pct } } — green subtab when pct===100.
  const [coverageByKey, setCoverageByKey] = useState({});
  // Bumped on subtab change, custom coverage-changed events, and
  // cross-tab storage events so every way the mappings can change
  // triggers a recompute.
  const [coverageVersion, setCoverageVersion] = useState(0);
  useEffect(() => { setCoverageVersion(v => v + 1); }, [subtab]);
  // Firestore-driven mapping/dismiss/block updates don't fire storage
  // events, so bump coverage explicitly whenever the synced
  // listMappings slice changes identity (every persist or remote sync).
  useEffect(() => { setCoverageVersion(v => v + 1); }, [settings?.listMappings]);
  useEffect(() => {
    const bump = () => setCoverageVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    // Global Target-Accounts block toggles change the My-Accounts set
    // we count against; the storage event only fires cross-tab, so the
    // custom event is what keeps the same window in sync.
    window.addEventListener('target-accounts:blocked-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('target-accounts:blocked-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  // When a brand-new Target Accounts list is uploaded, wipe every
  // per-prospect tier-mismatch dismissal so the new list starts from a
  // clean slate — any mismatch that was previously "Dismissed" on the My
  // Accounts page will re-surface for re-review against the fresh tiers.
  // Returns the number of prospects whose dismissal was cleared.
  function clearTierMismatchIgnores() {
    let cleared = 0;
    for (const p of prospects) {
      if (p.ignoreTierMismatch) {
        if (updateProspect) updateProspect(p.id, { ignoreTierMismatch: false });
        cleared++;
      }
    }
    return cleared;
  }

  const listDefinitions = useMemo(
    () => SUBTABS.filter(t => t.storageKey),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve the "My Accounts" set: prefer MyAccountsView's published
      // list, fall back to CDM-matching prospects so we still have a
      // signal before My Accounts is opened.
      let myAccountNames = null;
      try {
        const raw = userLsGet('my-accounts:active-names');
        myAccountNames = raw ? JSON.parse(raw) : null;
      } catch {}
      // Globally-blocked Target Accounts are excluded from
      // UploadedListView's suggestion pool, so counting them here would
      // pin the tab below 100% with phantom suggestions the user
      // can't see or resolve.
      const blockedAccountNames = new Set();
      try {
        const raw = userLsGet('target-accounts:blocked-names');
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) {
          for (const s of arr) {
            const k = String(s || '').toLowerCase().trim();
            if (k) blockedAccountNames.add(k);
          }
        }
      } catch {}
      const accountSet = new Set();
      if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
        for (const n of myAccountNames) {
          const k = String(n || '').toLowerCase().trim();
          if (k && !blockedAccountNames.has(k)) accountSet.add(k);
        }
      } else {
        for (const p of prospects) {
          if (!matchesCdm(p.cdm, cdmName)) continue;
          const k = (p.company || '').toLowerCase().trim();
          if (k && !blockedAccountNames.has(k)) accountSet.add(k);
        }
      }

      const accountNorms = [...accountSet].map(k => ({ key: k, norm: normalizeListCompany(k) })).filter(a => a.norm);
      const accountExactByNorm = new Map(accountNorms.map(a => [a.norm, a.key]));

      // Portfolio Companies set — union across every prospect.
      const portfolioSet = new Set();
      for (const p of prospects) {
        for (const pc of (p.portfolioCompanies || [])) {
          const k = String(pc?.companyName || '').toLowerCase().trim();
          if (k) portfolioSet.add(k);
        }
      }
      const portfolioNorms = [...portfolioSet]
        .map(k => ({ key: k, norm: normalizeListCompany(k) }))
        .filter(a => a.norm);
      const portfolioExactByNorm = new Map(portfolioNorms.map(a => [a.norm, a.key]));

      function computeForSet(listRows, mapping, dismissed, blocked, targetSet, targetNorms, exactByNorm) {
        const confirmed = new Set();
        const suggested = new Set();
        const headers = Object.keys(listRows[0] || {});
        const nameKey = pickListNameKey(headers);
        if (!nameKey) return { mapped: 0, touched: 0, pct: 0 };
        for (const row of listRows) {
          const rawName = String(row[nameKey] ?? '').trim();
          if (!rawName) continue;
          const norm = normalizeListCompany(rawName);
          if (!norm) continue;
          const mk = `name::${norm}`;
          if (dismissed[mk]) continue;
          const confirmedName = mapping[mk];
          if (typeof confirmedName === 'string' && confirmedName) {
            const key = confirmedName.toLowerCase().trim();
            if (targetSet.has(key)) confirmed.add(key);
            continue;
          }
          // A globally-blocked prospect hides the suggestion pill in
          // UploadedListView via filterBlocked, so leaving it counted
          // here would keep the tab perpetually < 100% with no pill
          // for the user to act on.
          const exact = exactByNorm.get(norm);
          if (exact) {
            if (!blocked[norm]) suggested.add(exact);
            continue;
          }
          // Pick the shortest matching target norm ignoring the block;
          // if that best candidate is blocked, drop the suggestion
          // entirely rather than falling through to a longer match —
          // this mirrors UploadedListView's suggestFrom + filterBlocked
          // chain so the two coverage counts stay in lockstep.
          let best = null;
          for (const a of targetNorms) {
            if (a.norm.length < 3) continue;
            if (norm.includes(a.norm) || a.norm.includes(norm)) {
              if (!best || a.norm.length < best.norm.length) best = a;
            }
          }
          if (best && !blocked[best.norm]) suggested.add(best.key);
        }
        const pending = [...suggested].filter(k => !confirmed.has(k)).length;
        const touched = confirmed.size + pending;
        const pct = touched > 0 ? Math.round((confirmed.size / touched) * 100) : 0;
        return { mapped: confirmed.size, touched, pct };
      }

      const result = {};
      for (const def of listDefinitions) {
        let listRows = null;
        try {
          listRows = await loadListFromIDB(def.storageKey);
        } catch {}
        if (cancelled) return;
        if (!Array.isArray(listRows) || listRows.length === 0) {
          result[def.key] = {
            myAccounts: { mapped: 0, touched: 0, pct: 0 },
            portfolio: { mapped: 0, touched: 0, pct: 0 },
          };
          continue;
        }
        const remote = settings?.listMappings?.[def.storageKey];
        const myAccountsMapping = pickRemoteOrLocal(remote, 'myAccountMapping', `${def.storageKey}:my-accounts-mapping`);
        const myAccountsDismissed = pickRemoteOrLocal(remote, 'myAccountDismissed', `${def.storageKey}:my-accounts-dismissed`);
        const myAccountsBlocked = pickRemoteOrLocal(remote, 'myAccountBlocked', `${def.storageKey}:my-accounts-blocked`);
        const portfolioMapping = pickRemoteOrLocal(remote, 'portfolioMapping', `${def.storageKey}:portfolio-mapping`);
        const portfolioDismissed = pickRemoteOrLocal(remote, 'portfolioDismissed', `${def.storageKey}:portfolio-dismissed`);
        const portfolioBlocked = pickRemoteOrLocal(remote, 'portfolioBlocked', `${def.storageKey}:portfolio-blocked`);
        result[def.key] = {
          myAccounts: computeForSet(listRows, myAccountsMapping, myAccountsDismissed, myAccountsBlocked, accountSet, accountNorms, accountExactByNorm),
          portfolio:  computeForSet(listRows, portfolioMapping,  portfolioDismissed,  portfolioBlocked,  portfolioSet, portfolioNorms, portfolioExactByNorm),
        };
      }
      if (!cancelled) setCoverageByKey(result);
    })();
    return () => { cancelled = true; };
  }, [prospects, coverageVersion, listDefinitions, cdmName]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabBar}>
        <div className={styles.subtabs}>
          {SUBTABS.map(t => {
            const cov = coverageByKey[t.key];
            // A tab flips green only when both mapping scopes are
            // fully resolved. An empty scope (no matches) counts as
            // trivially complete — but at least one of the two must
            // have had matches to avoid green-flagging pristine tabs.
            const myCov = cov?.myAccounts;
            const portCov = cov?.portfolio;
            const myDone = !myCov || myCov.touched === 0 || myCov.pct === 100;
            const portDone = !portCov || portCov.touched === 0 || portCov.pct === 100;
            const anyTouched = (myCov && myCov.touched > 0) || (portCov && portCov.touched > 0);
            const complete = anyTouched && myDone && portDone;
            const isActive = subtab === t.key;
            // 100 %-complete tabs flip to a green scheme whether or not
            // they're the active tab — so the signal stays visible.
            const completeStyle = complete
              ? (isActive
                  ? { color: '#FFFFFF', background: '#16A34A', borderBottomColor: '#16A34A' }
                  : { color: '#166534', background: '#DCFCE7' })
              : undefined;
            return (
              <button
                key={t.key}
                className={isActive ? styles.subtabActive : styles.subtab}
                style={completeStyle}
                title={complete ? (() => {
                  const parts = [];
                  if (myCov?.touched) parts.push(`${myCov.touched} My Accounts`);
                  if (portCov?.touched) parts.push(`${portCov.touched} Portfolio Companies`);
                  return `${t.label}: ${parts.join(' + ')} fully mapped`;
                })() : undefined}
                onClick={() => setSubtab(t.key)}
              >
                {t.label}{complete && ' ✓'}
              </button>
            );
          })}
        </div>
        <div className={styles.sourceLink}>
          <DataSourceLink storageKey={`list-source-url:${subtab}`} />
        </div>
      </div>
      <div className={styles.content}>
        {subtab === 'raclients' && <RAClientsView settings={settings} updateSettings={updateSettings} />}
        {subtab === 'targets' && <TargetAccountsView onDataLoaded={onTargetAccountsLoaded} settings={settings} updateSettings={updateSettings} cdmName={cdmName} onListUploaded={clearTierMismatchIgnores} />}
        {subtab === 'recaclients' && <RECAClientsView prospects={prospects} onSelectProspect={onSelectProspect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} />}
        {subtab === 'ecoactclients' && <EcoActClientsView prospects={prospects} onSelectProspect={onSelectProspect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} />}
        {subtab === 'strategic' && (
          <UploadedListView
            storageKey="strategic-accounts-override"
            tableIdPrefix="strategic-accounts"
            title="Strategic Accounts"
            singular="account"
            plural="accounts"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'largest' && (
          <UploadedListView
            storageKey="largest-list-override"
            tableIdPrefix="largest-list"
            title="Largest"
            singular="company"
            plural="companies"
            accountSource="targetAccounts"
            accountLabel="Target Accounts"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'sites' && <SitesView settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} prospects={prospects} updateProspect={updateProspect} onSelectProspect={onSelectProspect} />}
        {subtab === 'mastersites' && <MasterSiteListView prospects={prospects} />}
        {subtab === 'csrd' && (
          <UploadedListView
            storageKey="csrd-list-override"
            tableIdPrefix="csrd-list"
            title="CSRD"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'cdp' && (
          <UploadedListView
            storageKey="cdp-list-override"
            tableIdPrefix="cdp-list"
            title="CDP"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'gresb' && (
          <UploadedListView
            storageKey="gresb-list-override"
            tableIdPrefix="gresb-list"
            title="GRESB"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'sbt' && (
          <UploadedListView
            storageKey="sbt-list-override"
            tableIdPrefix="sbt-list"
            title="SBT"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'casb' && (
          <UploadedListView
            storageKey="casb-list-override"
            tableIdPrefix="casb-list"
            title="CA SB"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'betterbuildings' && (
          <UploadedListView
            storageKey="better-buildings-override"
            tableIdPrefix="better-buildings"
            title="Better Buildings"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
        {subtab === 'bfoopps' && (
          <UploadedListView
            storageKey="bfo-opps-override"
            tableIdPrefix="bfo-opps"
            title="BFO Opps"
            singular="opportunity"
            plural="opportunities"
            shortDateColumns={['Close Date']}
            defaultHideWhere={{ column: 'Opportunity Leader', values: ['Daniel Baldauf'], label: 'Daniel Baldauf' }}
            prospectFieldFill={{ field: 'bfoCompanyName', label: 'BFO Company Name', fillFromColumn: 'Account Name' }}
            updateProspect={updateProspect}
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
          />
        )}
      </div>
    </div>
  );
}
