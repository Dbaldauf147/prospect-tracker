// "Already in Schneider's HubSpot" on the Account move tab: Dan uploads the
// companies and contacts he exported from the corporate portal, and the
// import files then link to companies it already has instead of making
// duplicates, and leave out contacts a colleague owns there
// (utils/seHubspotExisting.js). The matches are listed so he can pick
// another candidate, or "create new", for any company.
import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { compactCompanies, compactContacts, companyMatcher, domainKey } from '../../utils/seHubspotExisting';
import { loadSeHubspot, saveSeHubspot, EMPTY_SE_HUBSPOT } from '../../utils/seHubspotStore';
import styles from './HubSpotMoveTab.module.css';

const fmt = (n) => Number(n || 0).toLocaleString();
const HOW = { domain: 'Website', name: 'Name', override: 'Your choice', none: '' };

async function readSheet(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

export function HubSpotExistingSection({ prospects = [], settings, updateSettings, ownerName = 'Dan Baldauf', ownerEmail = 'daniel.baldauf@se.com' }) {
  const [data, setData] = useState(EMPTY_SE_HUBSPOT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadSeHubspot().then(setData).catch(err => setError(err.message)).finally(() => setLoaded(true));
  }, []);

  const save = async (next) => {
    setData(next);
    try { await saveSeHubspot(next); }
    catch (err) { setError(`Couldn't save: ${err.message}`); }
  };

  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(kind); setError('');
    try {
      const rows = await readSheet(file);
      const at = new Date().toISOString();
      if (kind === 'companies') {
        const companies = compactCompanies(rows);
        if (!companies.length) throw new Error('No companies found. The export needs Record ID and Company name columns.');
        await save({ ...data, companies, meta: { ...data.meta, companiesFile: file.name, companiesAt: at } });
      } else {
        // Only the contacts at domains Dan's own contacts use matter.
        const cache = await getHubspotCache();
        const keep = new Set((cache?.contacts || []).map(c => domainKey(c.email)).filter(Boolean));
        const contacts = compactContacts(rows, keep);
        if (!rows.length) throw new Error('No rows found in the file.');
        await save({ ...data, contacts, meta: { ...data.meta, contactsFile: file.name, contactsAt: at, contactsInFile: rows.length } });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  // Every company of Dan's with a match in the portal, for review.
  const rows = useMemo(() => {
    if (!data.companies.length) return [];
    const match = companyMatcher(data.companies, { overrides: data.overrides, me: [ownerEmail, ownerName] });
    return prospects.map(p => ({ p, ...match(p) })).filter(r => r.candidates.length)
      .map(r => ({
        id: r.p.id,
        company: r.p.company,
        website: domainKey(r.p.website) || domainKey(r.p.emailDomain),
        choice: r.company ? String(r.company.id) : 'new',
        match: r.company,
        candidates: r.candidates,
        how: r.how,
      }));
  }, [data, prospects, ownerEmail, ownerName]);

  const choose = (prospectId, value) => save({ ...data, overrides: { ...data.overrides, [prospectId]: value } });

  const columns = useMemo(() => [
    { key: 'company', label: 'Your company', defaultWidth: 220, render: r => r.company },
    { key: 'website', label: 'Your website', defaultWidth: 160, render: r => r.website },
    {
      key: 'choice', label: "In Schneider's HubSpot", defaultWidth: 320, render: r => (
        <select className={styles.input} value={r.choice} onChange={e => choose(r.id, e.target.value)}>
          {r.candidates.map(c => (
            <option key={c.id} value={String(c.id)}>{c.name || c.domain}{c.domain ? ` (${c.domain})` : ''}{c.owner ? `, ${c.owner}` : ''}</option>
          ))}
          <option value="new">None of these: create a new company</option>
        </select>
      ),
    },
    { key: 'owner', label: 'Owner there', defaultWidth: 150, render: r => r.match?.owner || '' },
    { key: 'how', label: 'Matched by', defaultWidth: 110, render: r => HOW[r.how] },
  // choose closes over data; the table re-renders with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [data]);

  const m = data.meta || {};
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Already in Schneider&apos;s HubSpot</h3>
      </div>
      <p className={styles.muted}>
        Upload exports from Schneider&apos;s HubSpot so the import files link to companies it already has instead
        of creating duplicates, and leave out contacts a colleague owns there. In Schneider&apos;s HubSpot: Companies
        (or Contacts), All, Export, with Record ID, Company name, Company Domain Name, Website URL and Company owner
        (for contacts: Record ID, Email and Contact owner). Re-upload whenever you want them fresher.
      </p>
      <div className={styles.controls}>
        <label>Companies export (CSV or Excel)
          <input type="file" accept=".csv,.xlsx,.xls" disabled={!!busy} onChange={e => upload('companies', e.target.files?.[0])} />
        </label>
        <label>Contacts export (CSV or Excel)
          <input type="file" accept=".csv,.xlsx,.xls" disabled={!!busy} onChange={e => upload('contacts', e.target.files?.[0])} />
        </label>
      </div>
      {busy && <div className={styles.muted}>Reading the {busy} export...</div>}
      {error && <div className={styles.error}>{error}</div>}
      {loaded && (
        <ul className={styles.muted}>
          <li>{m.companiesAt ? `${fmt(data.companies.length)} companies, from ${m.companiesFile} (${new Date(m.companiesAt).toLocaleDateString()})` : 'No companies export yet.'}</li>
          <li>{m.contactsAt ? `${fmt(data.contacts.length)} contacts at your contacts' companies (of ${fmt(m.contactsInFile)} in ${m.contactsFile}, ${new Date(m.contactsAt).toLocaleDateString()})` : 'No contacts export yet.'}</li>
        </ul>
      )}
      {rows.length > 0 && (
        <>
          <p className={styles.muted}>
            {fmt(rows.length)} of your companies are already there. Check the matches: the import links your contacts
            to the company chosen here and doesn&apos;t create it again. Pick &quot;create a new company&quot; when a
            match is wrong.
          </p>
          {/* The table scrolls inside a box of fixed height: it fills its parent. */}
          <div className={styles.tableBox}>
          <DataTable
            tableId="se-hubspot-company-matches"
            exportFileName="Schneider HubSpot company matches"
            columns={columns}
            rows={rows}
            alwaysVisible={['company', 'choice']}
            emptyMessage="No matches"
            settings={settings}
            updateSettings={updateSettings}
          />
          </div>
        </>
      )}
    </section>
  );
}
