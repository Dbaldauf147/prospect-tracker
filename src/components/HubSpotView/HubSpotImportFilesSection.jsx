// "Files for a HubSpot import" on the Account move tab: the site's companies,
// contacts and Opps as CSVs for HubSpot's own Import screen, for a portal the
// app has no API access to (utils/hubspotImportFiles.js builds them).
// Nothing is sent anywhere; the files are built and downloaded in the
// browser.
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { toCsv, downloadCsv } from '../../utils/csv';
import { buildImportFiles } from '../../utils/hubspotImportFiles';
import styles from './HubSpotMoveTab.module.css';

const FILES = [
  { key: 'companies', label: 'Companies', file: 'hubspot-import-1-companies.csv' },
  { key: 'contacts', label: 'Contacts', file: 'hubspot-import-2-contacts.csv' },
  { key: 'deals', label: 'Deals (from Opps)', file: 'hubspot-import-3-deals.csv' },
  { key: 'fields', label: 'Fields to create first', file: 'hubspot-import-0-fields-to-create.csv' },
];

const fmt = (n) => Number(n || 0).toLocaleString();

export function HubSpotImportFilesSection({ prospects = [], settings = {} }) {
  const { user } = useAuth();
  const [ownerEmail, setOwnerEmail] = useState('daniel.baldauf@se.com');
  const [pipeline, setPipeline] = useState('Sales Pipeline');
  const [allCompanies, setAllCompanies] = useState(false);
  const [built, setBuilt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const build = async () => {
    setBusy(true); setError('');
    try {
      const [cache, opps] = await Promise.all([getHubspotCache(), loadOpps2Newest(user?.uid)]);
      const deleted = new Set((opps?._deletedIds || []).map(String));
      const records = (opps?.records || []).filter(r => !deleted.has(String(r._id ?? r.id)));
      setBuilt(buildImportFiles({
        prospects, contacts: cache?.contacts || [], opps: records, settings,
        ownerEmail: ownerEmail.trim(), pipeline: pipeline.trim(), allCompanies,
      }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const download = (f) => downloadCsv(f.file, toCsv(built[f.key].headers, built[f.key].rows));
  const r = built?.report;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Files for a HubSpot import</h3>
      </div>
      <p className={styles.muted}>
        For a portal the site can&apos;t connect to. Builds your companies, contacts and Opps as CSV files for
        HubSpot&apos;s own Import screen (Data integration, Import a file). Nothing is sent anywhere: the files
        are built in this browser and downloaded.
      </p>
      <div className={styles.controls}>
        <label>Owner in the new portal
          <input className={styles.input} value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />
        </label>
        <label>Deal pipeline name
          <input className={styles.input} value={pipeline} onChange={e => setPipeline(e.target.value)} />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={allCompanies} onChange={e => setAllCompanies(e.target.checked)} />
          Include companies with no contacts or Opps
        </label>
        <button className={styles.btn} onClick={build} disabled={busy}>{busy ? 'Building...' : built ? 'Rebuild files' : 'Build files'}</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      {built && (
        <>
          <table className={styles.table}>
            <thead><tr><th>File</th><th className={styles.num}>Rows</th><th /></tr></thead>
            <tbody>
              {FILES.map(f => (
                <tr key={f.key}>
                  <td>{f.label} <span className={styles.mono}>{f.file}</span></td>
                  <td className={styles.num}>{fmt(built[f.key].rows.length)}</td>
                  <td><button className={styles.btnGhost} onClick={() => download(f)}>Download</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.muted}>
            <b>Left out or not linked</b>
            <ul>
              <li>{fmt(r.contactsNoEmail)} contacts with no email (HubSpot matches contacts by email, so these would duplicate on every import)</li>
              <li>{fmt(r.contactsHidden)} contacts tagged hide</li>
              {r.contactsDuplicateEmail > 0 && <li>{fmt(r.contactsDuplicateEmail)} repeat contacts sharing an email with another one</li>}
              <li>{fmt(r.contactsNoCompany)} contacts are included but not linked to a company (their company isn&apos;t one of your accounts)</li>
              {r.companiesNoDomain.length > 0 && (
                <li title={r.companiesNoDomain.slice(0, 50).join(', ')}>
                  {fmt(r.companiesNoDomain.length)} companies have no website, so HubSpot can&apos;t de-duplicate them or link contacts and deals to them. Add a website on the site and rebuild.
                </li>
              )}
              {r.dealsNoCompany.length > 0 && (
                <li title={r.dealsNoCompany.slice(0, 50).join(', ')}>{fmt(r.dealsNoCompany.length)} Opps whose Account isn&apos;t one of your companies (included, but not linked)</li>
              )}
            </ul>
          </div>

          <div className={styles.muted}>
            <b>Importing, in this order</b>
            <ol>
              <li>Send <span className={styles.mono}>fields-to-create</span> to whoever can create properties (or create them yourself during the import). Each deal stage listed there must exist in the pipeline.</li>
              <li>Import <b>Companies</b>, then <b>Contacts</b>, then <b>Deals</b>: one file, one object each time.</li>
              <li>When HubSpot asks, choose <b>Create new records only</b>, so records a colleague already owns are left alone.</li>
              <li>On the mapping screen, check that <b>Company Domain Name</b> and <b>Contact Email</b> are mapped as the links to companies and contacts.</li>
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
