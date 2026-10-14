import { useMemo, useState } from 'react';
import { resolveTargetAccountVertical } from '../../utils/targetTier';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import styles from './TargetAccountsView.module.css';

// Target Accounts > Vertical names. The list spells verticals its own way
// ("Food & Bev", "CPG - Food"); this maps each one to the name the user
// uses, saved to settings.targetVerticalNames as { list vertical lower-cased:
// my name }. The company popup's Target Accounts box and its Vertical import
// read through renameTargetVertical, so a mapped vertical shows (and is
// applied) under the user's name. Blank means use the list's own spelling.

export function VerticalNamesTab({ data, settings, updateSettings }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState({});
  const saved = useMemo(() => settings?.targetVerticalNames || {}, [settings?.targetVerticalNames]);

  // Every vertical on the list, once each (ignoring case), with how many
  // companies carry it.
  const rows = useMemo(() => {
    const col = settings?.targetVerticalColumn;
    const byKey = new Map();
    for (const sheetName of data?.sheetNames || []) {
      for (const r of data?.sheets?.[sheetName]?.records || []) {
        const v = resolveTargetAccountVertical(r, col);
        if (!v) continue;
        const k = v.toLowerCase();
        const row = byKey.get(k) || { key: k, vertical: v, count: 0 };
        row.count++;
        byKey.set(k, row);
      }
    }
    return [...byKey.values()].sort((a, b) => a.vertical.localeCompare(b.vertical));
  }, [data, settings?.targetVerticalColumn]);

  const options = useMemo(
    () => getEffectiveDropdownLists(settings).find(l => l.key === 'vertical')?.options || [],
    [settings],
  );

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? rows.filter(r => r.vertical.toLowerCase().includes(needle) || String(saved[r.key] || '').toLowerCase().includes(needle))
    : rows;
  const mappedCount = rows.filter(r => String(saved[r.key] || '').trim()).length;

  const valueOf = (k) => (k in draft ? draft[k] : (saved[k] || ''));

  function save(k) {
    if (!(k in draft)) return;
    const v = String(draft[k] || '').trim();
    const next = { ...saved };
    if (v) next[k] = v; else delete next[k];
    setDraft(d => { const n = { ...d }; delete n[k]; return n; });
    if ((saved[k] || '') !== v) updateSettings({ targetVerticalNames: next });
  }

  if (!data) {
    return <div className={styles.vnEmpty}>Upload a Target Accounts list first. Its verticals are listed here to rename.</div>;
  }

  return (
    <div className={styles.vnWrap}>
      <div className={styles.vnIntro}>
        Give each vertical on the Target Accounts list the name you use. The company popup then shows
        and imports your name instead of the list's. Leave a row blank to keep the list's spelling.
      </div>
      <div className={styles.vnToolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Find a vertical..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.vnCount}>
          {rows.length} vertical{rows.length === 1 ? '' : 's'} on the list, {mappedCount} renamed
        </span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.vnEmpty}>No verticals found on the list. Check the Vertical column picked on Current List.</div>
      ) : (
        <table className={styles.vnTable}>
          <thead>
            <tr>
              <th>Target list vertical</th>
              <th className={styles.vnNum}>Companies</th>
              <th>My name</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const v = valueOf(r.key);
              const offList = v.trim() && options.length > 0
                && !options.some(o => String(o).trim().toLowerCase() === v.trim().toLowerCase());
              return (
                <tr key={r.key}>
                  <td>{r.vertical}</td>
                  <td className={styles.vnNum}>{r.count}</td>
                  <td>
                    <input
                      type="text"
                      list="vn-vertical-options"
                      className={styles.vnInput}
                      value={v}
                      placeholder={r.vertical}
                      aria-label={`My name for ${r.vertical}`}
                      onChange={e => setDraft(d => ({ ...d, [r.key]: e.target.value }))}
                      onBlur={() => save(r.key)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    {offList && <span className={styles.vnWarn} title="Not on your Dropdowns > Vertical list">not on Dropdowns list</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <datalist id="vn-vertical-options">
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}
