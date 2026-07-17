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

// Screen a city + state against the building-compliance workbook: it
// matches the "city + state" identifier against column A of the source and
// surfaces whichever requirement columns carry a value. The source can be
// the bundled default list or a workbook the user uploads to replace it.
export function BuildingComplianceScreening() {
  const [dataset, setDataset] = useState(null);
  const [sourceName, setSourceName] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
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

  const trimmedCity = city.trim();
  const result = useMemo(
    () => screenCityState(dataset, city, state),
    [dataset, city, state],
  );
  const searched = trimmedCity.length > 0;

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
            Enter a city and state to screen it against the compliance list. We match the
            city + state identifier against column A and show which requirements apply.
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

      {!loaded ? (
        <div className={styles.muted}>Loading compliance list…</div>
      ) : !searched ? (
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
    </div>
  );
}
