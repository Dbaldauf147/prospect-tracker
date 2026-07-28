import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadList as loadListFromIDB } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { loadEffectiveRaClients, raClientName } from '../../utils/raClientsStore';
import { userLsGet, userLsSet, userLsRemove } from '../../utils/userLs';

// Extract a company name per row using the same header-detection the
// uploaded-list scan uses. Kept separate so non-IDB sources (RA Clients)
// can reuse the mapping/scoring pipeline below with names they already hold.
function namesFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) {
    if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  const nameKey = pickNameKey(headers);
  return rows.map(r => (nameKey ? String(r[nameKey] || '') : ''));
}

// Every source the panel scans: the IDB-backed uploaded lists plus RA
// Clients (its own store, no IDB rows). Each yields a flat list of company
// names; the shared buildItems() pipeline handles fuzzy matching, the
// per-source mapping/dismissed state (settings.listMappings[storageKey]),
// and the Accept/Unmap actions — so RA Clients maps exactly like the rest,
// stored under its own key so it stays panel-scoped.
const MATCH_SOURCES = [
  ...UPLOADED_LISTS.map(def => ({
    label: def.label,
    storageKey: def.storageKey,
    loadNames: async () => namesFromRows(await loadListFromIDB(def.storageKey)),
  })),
  {
    label: 'RA Clients',
    storageKey: 'ra-clients-account-map',
    loadNames: async () => (loadEffectiveRaClients().data || []).map(raClientName).filter(Boolean),
  },
];

function loadMapping(key) {
  if (!key) return {};
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function fuzzyScore(rowNorm, prospectNorm) {
  if (!rowNorm || !prospectNorm) return 0;
  if (rowNorm === prospectNorm) return 1;
  if (rowNorm.length < 3 || prospectNorm.length < 3) return 0;
  if (!rowNorm.includes(prospectNorm) && !prospectNorm.includes(rowNorm)) return 0;
  const shorter = Math.min(rowNorm.length, prospectNorm.length);
  const longer = Math.max(rowNorm.length, prospectNorm.length);
  return longer > 0 ? shorter / longer : 0;
}

// For one source: given its flat list of company names, read
// mapping/dismissed state and return the entries that either already map to
// this prospect or fuzzy match its company name. We dedupe by matchKey so a
// re-upload with row reordering doesn't double-count.
function buildItems(storageKey, names, prospectCompany, settings) {
  const prospectNorm = normalizeCompany(prospectCompany || '');
  if (!prospectNorm || !Array.isArray(names) || names.length === 0) return [];

  const remoteMappings = settings?.listMappings?.[storageKey] || {};
  const mapping = remoteMappings.mapping && typeof remoteMappings.mapping === 'object'
    ? remoteMappings.mapping
    : loadMapping(`${storageKey}:account-mapping`);
  const dismissed = remoteMappings.dismissed && typeof remoteMappings.dismissed === 'object'
    ? remoteMappings.dismissed
    : loadMapping(`${storageKey}:account-dismissed`);

  const seenKeys = new Set();
  const items = [];
  names.forEach((rawName, i) => {
    const norm = normalizeCompany(rawName);
    const matchKey = norm ? `name::${norm}` : `row::${i}`;
    if (seenKeys.has(matchKey)) return;
    seenKeys.add(matchKey);

    const mappedTo = mapping[matchKey] || '';
    const mappedNorm = normalizeCompany(mappedTo);
    const alreadyMapped = mappedNorm && mappedNorm === prospectNorm;
    const score = fuzzyScore(norm, prospectNorm);

    if (alreadyMapped) {
      items.push({ matchKey, rawName, mappedTo, score: 1, state: 'mapped' });
      return;
    }
    if (dismissed[matchKey]) return;
    if (mappedTo) return; // mapped to a different prospect — leave alone
    if (score >= 0.5) {
      items.push({ matchKey, rawName, mappedTo: '', score, state: 'suggested' });
    }
  });
  items.sort((a, b) => b.score - a.score || (a.rawName || '').localeCompare(b.rawName || ''));
  return items;
}

// Load a source's names then run them through buildItems.
async function scanSource(source, prospectCompany, settings) {
  const names = await source.loadNames();
  return { storageKey: source.storageKey, label: source.label, items: buildItems(source.storageKey, names, prospectCompany, settings) };
}

export function ListsMatchPanel({ anchorRef, prospectCompany, settings, updateSettingsPath, onClose }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actedKeys, setActedKeys] = useState(() => new Set());
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const r = anchorRef?.current?.getBoundingClientRect?.();
    if (!r) { setPos({ top: 80, left: 80 }); return; }
    const width = 420;
    setPos({
      top: Math.min(r.bottom + 6, window.innerHeight - 480),
      left: Math.min(r.right - width, window.innerWidth - width - 8),
      width,
    });
  }, [anchorRef]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all(MATCH_SOURCES.map(src => scanSource(src, prospectCompany, settings)));
      if (cancelled) return;
      setGroups(results.filter(g => g.items.length > 0));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // Re-scan when the prospect name changes or remote settings change.
    // settings._lastWriteAt updates on every Firestore write so the
    // dependency catches background syncs without churning on every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectCompany, settings?._lastWriteAt]);

  useEffect(() => {
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [anchorRef, onClose]);

  function writeListField(storageKey, field, mutate) {
    const lsKey = `${storageKey}:${field === 'mapping' ? 'account-mapping' : 'account-dismissed'}`;
    const current = (() => {
      const remote = settings?.listMappings?.[storageKey]?.[field];
      if (remote && typeof remote === 'object') return { ...remote };
      return loadMapping(lsKey);
    })();
    const next = mutate({ ...current });
    try {
      if (Object.keys(next).length === 0) userLsRemove(lsKey);
      else userLsSet(lsKey, JSON.stringify(next));
    } catch {}
    updateSettingsPath?.({ [`listMappings.${storageKey}.${field}`]: next });
    return next;
  }

  function accept(storageKey, matchKey) {
    writeListField(storageKey, 'mapping', (m) => { m[matchKey] = prospectCompany; return m; });
    // Confirming a mapping should clear any prior dismissal so the row
    // doesn't show a stale "dismissed" state on the lists page.
    writeListField(storageKey, 'dismissed', (d) => { delete d[matchKey]; return d; });
    setActedKeys(prev => { const next = new Set(prev); next.add(`${storageKey}::${matchKey}`); return next; });
  }

  function reject(storageKey, matchKey) {
    writeListField(storageKey, 'dismissed', (d) => { d[matchKey] = true; return d; });
    setActedKeys(prev => { const next = new Set(prev); next.add(`${storageKey}::${matchKey}`); return next; });
  }

  function unmap(storageKey, matchKey) {
    writeListField(storageKey, 'mapping', (m) => { delete m[matchKey]; return m; });
    setActedKeys(prev => { const next = new Set(prev); next.add(`${storageKey}::${matchKey}`); return next; });
  }

  const totalShown = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 460, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 10000, display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>Matches across Lists</div>
          <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
            {loading ? 'Scanning…' : (totalShown === 0 ? 'No matches found' : `${totalShown} row${totalShown === 1 ? '' : 's'} across ${groups.length} list${groups.length === 1 ? '' : 's'}`)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.25rem' }}
        >×</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '0.4rem 0.6rem' }}>
        {!loading && groups.length === 0 && (
          <div style={{ padding: '1rem', fontSize: '0.75rem', color: '#64748B', textAlign: 'center' }}>
            Nothing matched <strong>{prospectCompany}</strong> on any of the {MATCH_SOURCES.length} lists.
          </div>
        )}
        {groups.map(({ storageKey, label, items }) => (
          <div key={storageKey} style={{ marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.2rem 0' }}>
              {label} ({items.length})
            </div>
            {items.map(item => {
              const acted = actedKeys.has(`${storageKey}::${item.matchKey}`);
              const pct = Math.round((item.score || 0) * 100);
              return (
                <div
                  key={`${storageKey}::${item.matchKey}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 6, marginBottom: 4, background: acted ? '#F8FAFC' : '#fff', opacity: acted ? 0.6 : 1 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.rawName}>
                      {item.rawName || <em style={{ color: '#94A3B8' }}>(unnamed row)</em>}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: '#64748B' }}>
                      {item.state === 'mapped'
                        ? `Currently mapped to "${item.mappedTo}"`
                        : `Suggested · ${pct}% match`}
                    </div>
                  </div>
                  {item.state === 'mapped' ? (
                    <button
                      type="button"
                      onClick={() => unmap(storageKey, item.matchKey)}
                      disabled={acted}
                      style={{ padding: '0.2rem 0.55rem', border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: '0.68rem', fontWeight: 600, cursor: acted ? 'default' : 'pointer', fontFamily: 'inherit' }}
                    >Unmap</button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => accept(storageKey, item.matchKey)}
                        disabled={acted}
                        style={{ padding: '0.2rem 0.55rem', border: '1px solid #86EFAC', background: '#DCFCE7', color: '#166534', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700, cursor: acted ? 'default' : 'pointer', fontFamily: 'inherit' }}
                        title={`Map this list row to ${prospectCompany}`}
                      >Accept</button>
                      <button
                        type="button"
                        onClick={() => reject(storageKey, item.matchKey)}
                        disabled={acted}
                        style={{ padding: '0.2rem 0.55rem', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', borderRadius: 6, fontSize: '0.68rem', fontWeight: 600, cursor: acted ? 'default' : 'pointer', fontFamily: 'inherit' }}
                        title="Dismiss this suggestion on the Lists page"
                      >Reject</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
