// "Files for a HubSpot import" on the Account move tab: the site's companies,
// contacts and company information as CSVs for HubSpot's own Import screen,
// for a portal the app has no API access to (utils/hubspotImportFiles.js
// builds them). The contacts' activity history is read, one saved file at a
// time, from the newest complete HubSpot backup (api/hubspot-backup.js
// activity-digest). Nothing is sent to HubSpot; the files are built in the
// browser and downloaded.
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiFetch';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { toCsv, downloadCsv } from '../../utils/csv';
import { buildImportFiles, liveOpps } from '../../utils/hubspotImportFiles';
import { loadSeHubspot } from '../../utils/seHubspotStore';
import styles from './HubSpotMoveTab.module.css';

const FILES = [
  { key: 'companies', label: 'Companies', file: 'hubspot-import-1-companies.csv' },
  { key: 'contacts', label: 'Contacts', file: 'hubspot-import-2-contacts.csv' },
  { key: 'fields', label: 'Fields to create first', file: 'hubspot-import-0-fields-to-create.csv' },
];

const fmt = (n) => Number(n || 0).toLocaleString();

// A digest request that fails is tried this many more times before the
// build stops: a history missing one file's worth of emails would look
// complete and isn't.
const DIGEST_RETRIES = 2;

async function getJson(url) {
  const res = await apiFetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// { [contactId]: [[whenMs, kind, subject], ...] } from the newest complete
// backup, plus which backup it came from.
async function loadActivity(onProgress) {
  const { runId, files } = await getJson('/api/hubspot-backup?action=activity-files');
  const activity = {};
  for (let i = 0; i < files.length; i += 1) {
    onProgress(`Reading activity history from the backup: file ${i + 1} of ${files.length}...`);
    let json;
    for (let attempt = 0; ; attempt += 1) {
      try { json = await getJson(`/api/hubspot-backup?action=activity-digest&name=${encodeURIComponent(files[i])}`); break; }
      catch (err) { if (attempt >= DIGEST_RETRIES) throw err; }
    }
    for (const [id, when, kind, subject] of json.entries || []) {
      (activity[id] || (activity[id] = [])).push([when, kind, subject]);
    }
  }
  return { activity, runId };
}

const fmtRun = (runId) => {
  const d = new Date(String(runId).replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z'));
  return Number.isNaN(d.getTime()) ? runId : d.toLocaleString();
};

// The weekly email of the same files (api/hubspot-weekly-export.js): when
// it goes, where, how the last one went, and a button to send it now.
function WeeklyEmail() {
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    try { setStatus(await getJson('/api/hubspot-weekly-export?action=status')); }
    catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);
  const send = async () => {
    setSending(true); setError('');
    try {
      const res = await apiFetch('/api/hubspot-weekly-export?action=send', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      load();
    }
  };
  const last = status?.last;
  return (
    <div className={styles.card}>
      <div className={styles.sectionHead}>
        <div className={styles.cardTitle}>Weekly email</div>
        <button className={styles.btnGhost} onClick={send} disabled={sending}>{sending ? 'Building and sending (a minute or two)...' : 'Send it now'}</button>
      </div>
      <p className={styles.muted}>
        {status ? <>{status.schedule}, the two import files (companies, contacts) are built from your current HubSpot account and emailed to <b>{status.to.join(', ')}</b>, owned by <b>{status.owner}</b>, with the import option for each.</> : 'Loading...'}
      </p>
      {last && (
        <p className={last.ok ? styles.ok : styles.errText}>
          {last.ok
            ? `Last sent ${new Date(last.finishedAt).toLocaleString()}: ${fmt(last.counts?.companies)} companies, ${fmt(last.counts?.contacts)} contacts.`
            : `Last run ${new Date(last.finishedAt).toLocaleString()} failed: ${last.error}`}
        </p>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

export function HubSpotImportFilesSection({ prospects = [], settings = {} }) {
  const { user } = useAuth();
  const [ownerEmail, setOwnerEmail] = useState('daniel.baldauf@se.com');
  const [allCompanies, setAllCompanies] = useState(false);
  const [withHistory, setWithHistory] = useState(true);
  const [includeNoDomain, setIncludeNoDomain] = useState(false);
  const [includeColleagues, setIncludeColleagues] = useState(false);
  const [step, setStep] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [built, setBuilt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const build = async () => {
    setBusy(true); setError(''); setBuilt(null); setHistoryFrom('');
    try {
      setStep('Reading contacts, companies and Opps...');
      const [cache, opps, existing] = await Promise.all([
        getHubspotCache(), loadOpps2Newest(user?.uid),
        // What Schneider's HubSpot already holds, from the uploads above.
        loadSeHubspot().catch(() => null),
      ]);
      let activity = null;
      if (withHistory) {
        const got = await loadActivity(setStep);
        activity = got.activity;
        setHistoryFrom(got.runId);
      }
      setBuilt(buildImportFiles({
        prospects, contacts: Array.isArray(cache?.contacts) ? cache.contacts : [], opps: liveOpps(opps), settings,
        ownerEmail: ownerEmail.trim(), allCompanies, activity, includeNoDomain, includeColleagues, existing,
      }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setStep('');
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
        For a portal the site can&apos;t connect to. Builds your companies and contacts as CSV files for
        HubSpot&apos;s own Import screen (Data integration, Import a file). Nothing is sent to that portal: the
        weekly email brings you the files, and Build files makes them here to download.
      </p>
      <WeeklyEmail />
      <div className={styles.controls}>
        <label>Owner in the new portal
          <input className={styles.input} value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={allCompanies} onChange={e => setAllCompanies(e.target.checked)} />
          Include companies with no contacts or Opps
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}
          title="Adds Activity History, Last Activity Date and Activity Count to each contact, from the newest complete backup of the current portal. Takes a few minutes.">
          <input type="checkbox" checked={withHistory} onChange={e => setWithHistory(e.target.checked)} />
          Include activity history
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}
          title="HubSpot can only match a company by its domain, so one with no website could duplicate a colleague's record of the same name. No contact can link to it either.">
          <input type="checkbox" checked={includeNoDomain} onChange={e => setIncludeNoDomain(e.target.checked)} />
          Include companies with no website
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}
          title="Contacts at your own email domain are colleagues in the company's portal, and their history is internal mail.">
          <input type="checkbox" checked={includeColleagues} onChange={e => setIncludeColleagues(e.target.checked)} />
          Include colleagues ({ownerEmail.split('@')[1] || 'your domain'})
        </label>
        <button className={styles.btn} onClick={build} disabled={busy}>{busy ? 'Building...' : built ? 'Rebuild files' : 'Build files'}</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {step && <div className={styles.muted}>{step}</div>}

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
            {historyFrom
              ? <div>{fmt(r.contactsWithHistory)} contacts have activity history, from the backup taken {fmtRun(historyFrom)}. Run a new backup first if you want the newest emails in it.</div>
              : <div>Activity history not included.</div>}
            <b>Left out or not linked</b>
            <ul>
              {r.contactsColleagues > 0 && <li>{fmt(r.contactsColleagues)} colleagues at your own email domain</li>}
              {r.contactsColleagueOwned.length > 0 && (
                <li title={r.contactsColleagueOwned.slice(0, 50).map(c => `${c.email}: ${c.owner}`).join('\n')}>
                  {fmt(r.contactsColleagueOwned.length)} contacts a colleague already owns in Schneider&apos;s HubSpot (left alone; hover for who)
                </li>
              )}
              {r.companiesExisting.length > 0 && (
                <li title={r.companiesExisting.slice(0, 50).map(c => `${c.name} -> ${c.existing}`).join('\n')}>
                  {fmt(r.companiesExisting.length)} companies already in Schneider&apos;s HubSpot: not created again, their contacts link to the existing record
                </li>
              )}
              {(r.contactsExistingMine + r.contactsExistingUnowned) > 0 && (
                <li>{fmt(r.contactsExistingMine + r.contactsExistingUnowned)} contacts already there and yours or unowned: included, so the import updates them</li>
              )}
              <li>{fmt(r.contactsNoEmail)} contacts with no email (HubSpot matches contacts by email, so these would duplicate on every import)</li>
              <li>{fmt(r.contactsHidden)} contacts tagged hide</li>
              {r.contactsDuplicateEmail > 0 && <li>{fmt(r.contactsDuplicateEmail)} repeat contacts sharing an email with another one</li>}
              <li>{fmt(r.contactsNoCompany)} contacts are included but not linked to a company (their company isn&apos;t one of your accounts, or has no website)</li>
              {r.companiesNoDomain.length > 0 && (
                <li title={r.companiesNoDomain.slice(0, 50).join(', ')}>
                  {fmt(r.companiesNoDomain.length)} companies have no website{includeNoDomain ? ' (included, but' : ' (left out:'} HubSpot can&apos;t de-duplicate them or link contacts to them). Add a website on the site and rebuild.
                </li>
              )}
              {r.companiesMerged.length > 0 && (
                <li title={r.companiesMerged.slice(0, 50).map(m => `${m.domain}: kept ${m.kept}, merged ${m.merged.join(', ')}`).join('\n')}>
                  {fmt(r.companiesMerged.reduce((n, m) => n + m.merged.length, 0))} companies share a website with another one ({fmt(r.companiesMerged.length)} domains). HubSpot keeps one company per domain, so each domain is one row: the one with the most contacts. Hover for the list.
                </li>
              )}
            </ul>
          </div>

          <div className={styles.muted}>
            <b>Importing, in this order</b>
            <ol>
              <li>Send <span className={styles.mono}>fields-to-create</span> to whoever can create properties (or create them yourself during the import).</li>
              <li>Import <b>Companies</b> first (one object: Companies), then <b>Contacts</b> (one file, multiple objects: Contacts and Companies).</li>
              <li>When HubSpot asks, choose <b>Create new records only</b>, so records a colleague already owns are left alone.</li>
              <li>On the contacts mapping screen, map <b>Company Name</b> and <b>Company Domain Name</b> to Company properties, and <b>Company Record ID</b> to the Company&apos;s <b>Record ID</b>: that links contacts to companies already in Schneider&apos;s HubSpot.</li>
              <li>Leave <b>Set contacts as marketing contacts</b> unticked. Every contact carries the legal basis &quot;Legitimate interest, prospect/lead&quot;.</li>
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
