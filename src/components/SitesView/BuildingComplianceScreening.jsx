import { useState, useEffect, useMemo, useRef } from 'react';
import { parseBestSheet } from '../../utils/xlsxParse';
import {
  buildScreeningDataset,
  screenCityState,
} from '../../utils/buildingComplianceScreening';
import {
  saveScreeningSource,
  loadScreeningSource,
  clearScreeningSource,
} from '../../utils/screeningSourceStore';
import styles from './BuildingComplianceScreening.module.css';

const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());

// Renders the applicable requirement columns for a matched place as
// "Column: value" lines, linking any URL values.
function RequirementList({ applied }) {
  return (
    <div className={styles.reqList}>
      {applied.map(({ col, value }) => (
        <div key={col} className={styles.reqItem}>
          <span className={styles.reqCol}>{col}:</span>{' '}
          {isUrl(value)
            ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a>
            : <span>{String(value)}</span>}
        </div>
      ))}
    </div>
  );
}

// Screen cities/states against the building-compliance workbook. It matches
// the "city + state" identifier against column A of the source and surfaces
// whichever requirement columns carry a value. Two modes: screen every site
// from the Utility Lookup site list (default), or a single manual lookup.
// The source workbook can be the bundled default or a user-uploaded replacement.
export function BuildingComplianceScreening({ sites = [] }) {
  const [dataset, setDataset] = useState(null);
  const [sourceName, setSourceName] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState('sites'); // 'sites' | 'manual'
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [onlyWithReq, setOnlyWithReq] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  async function loadDefault() {
    const mod = await import('../../data/buildingComplianceScreening.json');
    const d = mod.default || mod;
    setDataset({ compCols: d.compCols, profiles: d.profiles, index: d.index });
    setSourceName('Built-in compliance list');
    setIsCustom(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const custom = await loadScreeningSource();
      if (cancelled) return;
      if (custom?.dataset?.index) {
        setDataset(custom.dataset);
        setSourceName(custom.name || 'Uploaded workbook');
        setIsCustom(true);
      } else {
        await loadDefault();
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const placeCount = useMemo(
    () => (dataset ? Object.keys(dataset.index).length : 0),
    [dataset],
  );

  // Single-lookup result.
  const trimmedCity = city.trim();
  const result = useMemo(
    () => screenCityState(dataset, city, state),
    [dataset, city, state],
  );
  const searched = trimmedCity.length > 0;

  // Bulk site-list results.
  const siteResults = useMemo(() => {
    if (!dataset) return [];
    return sites.map((s, i) => ({
      id: s.id ?? i,
      siteName: s.siteName || '',
      city: s.city || '',
      state: s.state || '',
      applied: screenCityState(dataset, s.city, s.state),
    }));
  }, [dataset, sites]);
  const siteMatchedCount = useMemo(
    () => siteResults.filter(r => r.applied && r.applied.length).length,
    [siteResults],
  );
  const filteredSiteResults = useMemo(() => {
    let out = siteResults;
    if (onlyWithReq) out = out.filter(r => r.applied && r.applied.length);
    const q = siteSearch.trim().toLowerCase();
    if (q) out = out.filter(r => `${r.siteName} ${r.city} ${r.state}`.toLowerCase().includes(q));
    return out;
  }, [siteResults, onlyWithReq, siteSearch]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers } = parseBestSheet(new Uint8Array(buf));
      if (!rows?.length || !headers?.length) {
        throw new Error('No data rows found in that file.');
      }
      const built = buildScreeningDataset(rows, headers);
      if (Object.keys(built.index).length === 0) {
        throw new Error('No usable rows found. Column A should hold the city + state identifier, with requirement columns alongside it.');
      }
      await saveScreeningSource({ name: file.name, dataset: built, rowCount: rows.length });
      setDataset(built);
      setSourceName(file.name);
      setIsCustom(true);
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload exceeded the browser storage quota. Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  async function handleRevert() {
    if (!window.confirm('Revert to the built-in compliance list?')) return;
    setUploadError('');
    await clearScreeningSource();
    await loadDefault();
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Building Compliance Screening</h1>
          <div className={styles.subtitle}>
            Screens a city + state against the compliance list — matching the identifier against
            column A of the source and showing which requirements apply.
            {loaded && dataset && (
              <> {' '}· Source: <strong>{sourceName}</strong>
                {' '}({placeCount.toLocaleString()} places)</>
            )}
          </div>
        </div>
        <div className={styles.actions}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className={styles.btn}
            onClick={() => fileInputRef.current?.click()}
            title="Upload an Excel/CSV whose column A holds the city + state identifier. Stored locally and used only for this screening."
          >
            {isCustom ? 'Replace source file' : 'Upload source file'}
          </button>
          {isCustom && (
            <button
              type="button"
              className={styles.btnDanger}
              onClick={handleRevert}
              title="Remove the uploaded workbook and use the built-in list"
            >
              Revert to built-in
            </button>
          )}
        </div>
      </div>

      {uploadError && (
        <div className={styles.error}>{uploadError}</div>
      )}

      <div className={styles.modeToggle}>
        <button
          type="button"
          className={mode === 'sites' ? styles.modeActive : styles.mode}
          onClick={() => setMode('sites')}
        >Site list{sites.length > 0 ? ` (${sites.length})` : ''}</button>
        <button
          type="button"
          className={mode === 'manual' ? styles.modeActive : styles.mode}
          onClick={() => setMode('manual')}
        >Single lookup</button>
      </div>

      {!loaded ? (
        <div className={styles.muted}>Loading compliance list…</div>
      ) : mode === 'sites' ? (
        sites.length === 0 ? (
          <div className={styles.noMatch}>
            <strong>No site list loaded.</strong>
            <div className={styles.noMatchSub}>
              Upload a site list on the <strong>Utility Lookup</strong> subtab (it needs a City and
              State/Province column), and every site will be screened here automatically. Or use
              <button type="button" className={styles.linkBtn} onClick={() => setMode('manual')}>Single lookup</button>
              to check one city at a time.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.siteToolbar}>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Search sites, cities, states…"
                value={siteSearch}
                onChange={e => setSiteSearch(e.target.value)}
              />
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={onlyWithReq}
                  onChange={e => setOnlyWithReq(e.target.checked)}
                />
                Only sites with requirements
              </label>
              <span className={styles.siteStat}>
                <strong>{siteMatchedCount}</strong> of {siteResults.length} sites have requirements
                {' · '}{filteredSiteResults.length} shown
              </span>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.siteTable}>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>City</th>
                    <th>State</th>
                    <th>Compliance</th>
                    <th>Requirements</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSiteResults.map(r => {
                    const has = r.applied && r.applied.length > 0;
                    return (
                      <tr key={r.id}>
                        <td className={styles.siteCell}>{r.siteName || <span className={styles.dash}>—</span>}</td>
                        <td>{r.city || <span className={styles.dash}>—</span>}</td>
                        <td>{r.state || <span className={styles.dash}>—</span>}</td>
                        <td>
                          {has
                            ? <span className={styles.pillYes}>✓ Required ({r.applied.length})</span>
                            : <span className={styles.pillNo}>None</span>}
                        </td>
                        <td>
                          {has
                            ? <RequirementList applied={r.applied} />
                            : <span className={styles.dash}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSiteResults.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.emptyRow}>No sites match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <>
          <div className={styles.lookupCard}>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>City</span>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. Chicago"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  autoFocus
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>State / Province</span>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. IL or Illinois"
                  value={state}
                  onChange={e => setState(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.hint}>
              State can be the abbreviation (IL, AB) or full name. Matching ignores spacing and punctuation.
            </div>
          </div>

          {!searched ? (
            <div className={styles.muted}>Enter a city above to run the screening.</div>
          ) : result == null ? (
            <div className={styles.noMatch}>
              <strong>No building-compliance requirements found</strong> for{' '}
              “{trimmedCity}{state.trim() ? `, ${state.trim()}` : ''}”.
              <div className={styles.noMatchSub}>
                The city + state identifier isn’t in the current source list, or it carries no
                requirements. Check the spelling, or try the state abbreviation.
              </div>
            </div>
          ) : (
            <div className={styles.resultCard}>
              <div className={styles.resultHeading}>
                Requirements for “{trimmedCity}{state.trim() ? `, ${state.trim()}` : ''}”
                <span className={styles.resultCount}>{result.length} {result.length === 1 ? 'column' : 'columns'} apply</span>
              </div>
              <div className={styles.resultTable}>
                {result.map(({ col, value }) => (
                  <div key={col} className={styles.resultRow}>
                    <div className={styles.resultCol}>{col}</div>
                    <div className={styles.resultVal}>
                      {isUrl(value)
                        ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a>
                        : String(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
