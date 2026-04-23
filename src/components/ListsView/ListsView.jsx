import { useState, useEffect, useMemo } from 'react';
import { RAClientsView } from '../RAClientsView/RAClientsView';
import { TargetAccountsView } from '../TargetAccountsView/TargetAccountsView';
import { RECAClientsView } from '../RECAClientsView/RECAClientsView';
import { SitesView } from '../SitesView/SitesView';
import { UploadedListView } from '../UploadedListView/UploadedListView';
import { loadList as loadListFromIDB } from '../../utils/uploadedListStore';
import styles from './ListsView.module.css';

const SUBTABS = [
  { key: 'raclients', label: 'RA Clients' },
  { key: 'targets', label: 'Target Accounts' },
  { key: 'sites', label: 'Utility Lookup' },
  { key: 'recaclients', label: 'RECA Clients', storageKey: 'reca-clients-override' },
  { key: 'csrd', label: 'CSRD', storageKey: 'csrd-list-override' },
  { key: 'cdp', label: 'CDP', storageKey: 'cdp-list-override' },
  { key: 'gresb', label: 'GRESB', storageKey: 'gresb-list-override' },
  { key: 'sbt', label: 'SBT', storageKey: 'sbt-list-override' },
  { key: 'ecovadis', label: 'Ecovadis', storageKey: 'ecovadis-list-override' },
  { key: 'unpri', label: 'UN PRI', storageKey: 'unpri-list-override' },
  { key: 'casb', label: 'CA SB', storageKey: 'casb-list-override' },
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
  return headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k)) || headers[0];
}
function safeReadMap(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function DataSourceLink({ storageKey }) {
  const saved = (() => { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } })();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);

  function save() {
    const url = draft.trim();
    try {
      if (url) localStorage.setItem(storageKey, url);
      else localStorage.removeItem(storageKey);
    } catch {}
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          placeholder="Paste data source URL..."
          style={{ flex: 1, minWidth: 200, padding: '0.25rem 0.5rem', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
        />
        <button
          onClick={save}
          style={{ padding: '0.25rem 0.5rem', border: 'none', borderRadius: 4, background: 'var(--color-accent)', color: '#fff', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >Save</button>
        <button
          onClick={() => setEditing(false)}
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
            href={saved}
            target="_blank"
            rel="noopener noreferrer"
            title={saved}
            style={{ fontSize: '0.72rem', color: 'var(--color-accent)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >
            Data source
          </a>
          <button
            onClick={() => { setDraft(saved); setEditing(true); }}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
          >Edit</button>
          <button
            onClick={() => { try { localStorage.removeItem(storageKey); } catch {} setDraft(''); setEditing(false); window.location.reload(); }}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
            onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
          >×</button>
        </>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditing(true); }}
          style={{ fontSize: '0.72rem', color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
        >+ Add data source link</button>
      )}
    </div>
  );
}

export function ListsView({ onTargetAccountsLoaded, prospects = [], onSelectProspect }) {
  const [subtab, setSubtab] = useState('raclients');
  // { [subtabKey]: { mapped, touched, pct } } — green subtab when pct===100.
  const [coverageByKey, setCoverageByKey] = useState({});
  // Bumped on subtab change, custom coverage-changed events, and
  // cross-tab storage events so every way the mappings can change
  // triggers a recompute.
  const [coverageVersion, setCoverageVersion] = useState(0);
  useEffect(() => { setCoverageVersion(v => v + 1); }, [subtab]);
  useEffect(() => {
    const bump = () => setCoverageVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  const listDefinitions = useMemo(
    () => SUBTABS.filter(t => t.storageKey),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve the "My Accounts" set: prefer MyAccountsView's published
      // list (exact ~132), fall back to Baldauf-CDM prospects so we
      // still have a signal before My Accounts is opened.
      let myAccountNames = null;
      try {
        const raw = localStorage.getItem('my-accounts:active-names');
        myAccountNames = raw ? JSON.parse(raw) : null;
      } catch {}
      const accountSet = new Set();
      if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
        for (const n of myAccountNames) {
          const k = String(n || '').toLowerCase().trim();
          if (k) accountSet.add(k);
        }
      } else {
        for (const p of prospects) {
          if (!(p.cdm || '').toLowerCase().includes('baldauf')) continue;
          const k = (p.company || '').toLowerCase().trim();
          if (k) accountSet.add(k);
        }
      }

      const accountNorms = [...accountSet].map(k => ({ key: k, norm: normalizeListCompany(k) })).filter(a => a.norm);
      const exactByNorm = new Map(accountNorms.map(a => [a.norm, a.key]));

      const result = {};
      for (const def of listDefinitions) {
        const mapping = safeReadMap(`${def.storageKey}:my-accounts-mapping`);
        const dismissed = safeReadMap(`${def.storageKey}:my-accounts-dismissed`);
        let listRows = null;
        try {
          listRows = await loadListFromIDB(def.storageKey);
        } catch {}
        if (cancelled) return;
        if (!Array.isArray(listRows) || listRows.length === 0) {
          result[def.key] = { mapped: 0, touched: 0, pct: 0 };
          continue;
        }
        const headers = Object.keys(listRows[0] || {});
        const nameKey = pickListNameKey(headers);
        if (!nameKey) {
          result[def.key] = { mapped: 0, touched: 0, pct: 0 };
          continue;
        }
        const confirmed = new Set();
        const suggested = new Set();
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
            if (accountSet.has(key)) confirmed.add(key);
            continue;
          }
          // Exact normalized match first — fast path for the common case.
          const exact = exactByNorm.get(norm);
          if (exact) { suggested.add(exact); continue; }
          // Substring fallback — mirrors UploadedListView's suggestFrom.
          let best = null;
          for (const a of accountNorms) {
            if (a.norm.length < 3) continue;
            if (norm.includes(a.norm) || a.norm.includes(norm)) {
              if (!best || a.norm.length < best.norm.length) best = a;
            }
          }
          if (best) suggested.add(best.key);
        }
        const pending = [...suggested].filter(k => !confirmed.has(k)).length;
        const touched = confirmed.size + pending;
        const pct = touched > 0 ? Math.round((confirmed.size / touched) * 100) : 0;
        result[def.key] = { mapped: confirmed.size, touched, pct };
      }
      if (!cancelled) setCoverageByKey(result);
    })();
    return () => { cancelled = true; };
  }, [prospects, coverageVersion, listDefinitions]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabBar}>
        <div className={styles.subtabs}>
          {SUBTABS.map(t => {
            const cov = coverageByKey[t.key];
            const complete = cov && cov.touched > 0 && cov.pct === 100;
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
                title={complete ? `${t.label}: all ${cov.touched} My Accounts suggestions resolved` : undefined}
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
        {subtab === 'raclients' && <RAClientsView />}
        {subtab === 'targets' && <TargetAccountsView onDataLoaded={onTargetAccountsLoaded} />}
        {subtab === 'recaclients' && <RECAClientsView prospects={prospects} onSelectProspect={onSelectProspect} />}
        {subtab === 'sites' && <SitesView />}
        {subtab === 'csrd' && (
          <UploadedListView
            storageKey="csrd-list-override"
            tableIdPrefix="csrd-list"
            title="CSRD"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
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
          />
        )}
        {subtab === 'ecovadis' && (
          <UploadedListView
            storageKey="ecovadis-list-override"
            tableIdPrefix="ecovadis-list"
            title="Ecovadis"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'unpri' && (
          <UploadedListView
            storageKey="unpri-list-override"
            tableIdPrefix="unpri-list"
            title="UN PRI"
            singular="signatory"
            plural="signatories"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
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
          />
        )}
      </div>
    </div>
  );
}
