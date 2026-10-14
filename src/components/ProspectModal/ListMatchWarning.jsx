// A warning strip at the top of the company modal for one uploaded list
// (Lists → SBT, Lists → CA SB): this company looks like a row on that list.
// Same strip, colours and buttons as the RA Client warning beside it.
//
// The rows are the ones the "Search lists..." panel would offer
// (utils/listMatches.js): mapped here, or a fuzzy name match nobody has
// mapped to another company or dismissed on the list page.
//
//   Map     writes the same mapping the list page and "Search lists..."
//           keep (settings.listMappings[storageKey].mapping), so the row
//           reads as this company everywhere, list flags included.
//   Ignore  is per company, like the RA Client one: it hides that row's
//           match on this company only (settings.ignoredListMatches), so
//           the same row still flags on the company it really is.
//
// A mapped row is always shown, green, with an x to unmap it; Ignore never
// hides it.
import { useEffect, useMemo, useState } from 'react';
import { loadList as loadUploadedList } from '../../utils/uploadedListStore';
import { mapListRow, unmapListRow } from '../../utils/listAccountMapping';
import { buildItems, namesFromRows } from '../../utils/listMatches';

const MAX_SHOWN = 5;

export function ListMatchWarning({ label, storageKey, company, settings, updateSettings, updateSettingsPath }) {
  // The list's rows live in IndexedDB (with a Firestore fallback), so they
  // load once per modal open, like the Strategic Accounts strip.
  const [names, setNames] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadUploadedList(storageKey)
      .then(rows => { if (!cancelled) setNames(namesFromRows(Array.isArray(rows) ? rows : [])); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storageKey]);

  const name = String(company || '').trim();
  const ignoreKey = name.toLowerCase();
  const ignored = settings?.ignoredListMatches?.[storageKey]?.[ignoreKey];
  const matches = useMemo(() => {
    if (!name) return [];
    const items = buildItems(storageKey, names, name, settings);
    return items
      .filter(m => m.state === 'mapped' || !(ignored || {})[m.matchKey])
      .slice(0, MAX_SHOWN);
  }, [storageKey, names, name, settings, ignored]);

  if (matches.length === 0) return null;

  const allMapped = matches.every(m => m.state === 'mapped');
  const anyExact = matches.some(m => m.score === 1);
  const unmapped = matches.filter(m => m.state !== 'mapped');

  function ignore() {
    if (!ignoreKey || unmapped.length === 0) return;
    const keys = unmapped.map(m => m.matchKey);
    updateSettings(prev => {
      const all = prev?.ignoredListMatches || {};
      const forList = all[storageKey] || {};
      const forCompany = { ...(forList[ignoreKey] || {}) };
      for (const k of keys) forCompany[k] = true;
      return { ignoredListMatches: { ...all, [storageKey]: { ...forList, [ignoreKey]: forCompany } } };
    });
  }

  return (
    <div
      data-list-match={storageKey}
      style={{
        marginBottom: '0.8rem',
        padding: '0.4rem 0.8rem',
        background: allMapped ? '#F0FDF4' : '#FFFBEB',
        border: `1px solid ${allMapped ? '#BBF7D0' : '#FDE68A'}`,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.35rem 0.7rem',
      }}
    >
      <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>{allMapped ? '✅' : '⚠️'}</span>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: allMapped ? '#166534' : '#92400E', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
        {allMapped ? `Mapped to the ${label} list` : anyExact ? `Matches the ${label} list` : `Possible ${label} list match`}
      </span>
      <span style={{ fontSize: '0.75rem', color: allMapped ? '#14532D' : '#78350F', minWidth: 0 }}>
        {allMapped
          ? `This company is mapped to the Lists → ${label} tab.`
          : `This company looks like ${unmapped.length === 1 ? 'a company' : 'companies'} on the Lists → ${label} tab. Map it if it is this company, or ignore it.`}
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
        {matches.map(m => {
          const mapped = m.state === 'mapped';
          return (
            <span
              key={m.matchKey}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.15rem 0.2rem 0.15rem 0.5rem',
                background: mapped ? '#DCFCE7' : '#FEF3C7',
                border: `1px solid ${mapped ? '#86EFAC' : '#FDE68A'}`,
                borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                color: mapped ? '#166534' : '#92400E',
                whiteSpace: 'nowrap',
              }}
            >
              {m.rawName}
              {mapped
                ? <span style={{ fontWeight: 700 }}>mapped</span>
                : <span style={{ fontWeight: 700, color: '#B45309' }}>{m.score === 1 ? 'exact' : `${Math.round(m.score * 100)}%`}</span>}
              {mapped ? (
                <button
                  type="button"
                  onClick={() => unmapListRow(settings, updateSettingsPath, storageKey, m.matchKey)}
                  title={`Unmap ${m.rawName} on the ${label} list from ${name}`}
                  aria-label={`Unmap ${m.rawName}`}
                  style={{
                    border: 'none', background: 'transparent', color: '#166534', cursor: 'pointer',
                    fontSize: '0.85rem', lineHeight: 1, padding: '0 0.25rem', fontFamily: 'inherit',
                  }}
                >×</button>
              ) : (
                <button
                  type="button"
                  onClick={() => mapListRow(settings, updateSettingsPath, storageKey, m.matchKey, name)}
                  title={`Map ${m.rawName} on the ${label} list to ${name}`}
                  style={{
                    padding: '0.05rem 0.45rem', background: '#DCFCE7', border: '1px solid #86EFAC',
                    borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, color: '#166534',
                    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                >Map</button>
              )}
            </span>
          );
        })}
        {!allMapped && (
          <button
            type="button"
            onClick={ignore}
            title={`Stop flagging ${unmapped.map(m => m.rawName).join(', ')} as a ${label} list match for this company`}
            style={{
              padding: '0.15rem 0.55rem', background: '#fff', border: '1px solid #FCD34D',
              borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, color: '#92400E',
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >Ignore</button>
        )}
      </span>
    </div>
  );
}
