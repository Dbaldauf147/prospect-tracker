import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadList as loadListFromIDB } from '../../utils/uploadedListStore';
import { UPLOADED_LISTS } from '../../utils/uploadedListsRegistry';
import { loadEffectiveRaClients, raClientName } from '../../utils/raClientsStore';
import { mapListRow, unmapListRow, writeListField, RA_CLIENTS_MAP_KEY } from '../../utils/listAccountMapping';
import { namesFromRows, buildItems } from '../../utils/listMatches';

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
    storageKey: RA_CLIENTS_MAP_KEY,
    loadNames: async () => (loadEffectiveRaClients().data || []).map(raClientName).filter(Boolean),
  },
];

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

  function markActed(storageKey, matchKey) {
    setActedKeys(prev => { const next = new Set(prev); next.add(`${storageKey}::${matchKey}`); return next; });
  }

  function accept(storageKey, matchKey) {
    // Confirming a mapping also clears any prior dismissal so the row
    // doesn't show a stale "dismissed" state on the lists page.
    mapListRow(settings, updateSettingsPath, storageKey, matchKey, prospectCompany);
    markActed(storageKey, matchKey);
  }

  function reject(storageKey, matchKey) {
    writeListField(settings, updateSettingsPath, storageKey, 'dismissed', (d) => { d[matchKey] = true; return d; });
    markActed(storageKey, matchKey);
  }

  function unmap(storageKey, matchKey) {
    unmapListRow(settings, updateSettingsPath, storageKey, matchKey);
    markActed(storageKey, matchKey);
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
