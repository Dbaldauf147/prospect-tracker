// Prospecting > DMs Without Activity: the decision makers at your accounts
// that nothing has reached. Never-reached by default; a chip widens it to
// "none in the last N days". The people are the History chart's Decision
// Makers roster (tagged Decision Maker at an account with you as its CDM,
// less Hide / Left / Schneider and the clients every roster leaves out),
// and "activity" is the same per-contact outreach that chart counts: a
// HubSpot email or call from the Activity tab's index, or HubSpot's Last
// Contacted date (utils/tieredAccountActivity, decisionMakersWithoutActivity).
import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { useDmsNoActivity, DMS_WINDOWS as WINDOWS, readDmsWindow as readWindow, writeDmsWindow, dmsWindowLabel as windowLabel } from '../../hooks/useDmsNoActivity';
import { daysSince, accountStatusOf } from '../../utils/tieredAccountActivity';
import { reportingTier } from '../../utils/tierSource.js';
import { formatDateDisplay } from '../../utils/isoDate';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.65rem', borderRadius: 999, border: `1px solid ${active ? '#0A66C2' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#0A66C2' : '#475569', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const linkBtn = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#2563EB', cursor: 'pointer', textAlign: 'left' };
const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');
const linkedinOf = (c) => c?.hs_linkedin_url || c?.linkedin_url || c?.hs_linkedinid || '';
const toIso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ProspectingDmsNoActivity({ prospects, settings, updateSettings, cdmName = '', onSelectProspect, onOpenContact = null }) {
  const { lists, accountOf, noIndex } = useDmsNoActivity({ prospects, settings, cdmName });

  const [windowDays, setWindowState] = useState(readWindow);
  const setWindow = (w) => {
    setWindowState(w);
    writeDmsWindow(w);
  };

  const rows = useMemo(() => (lists?.get(windowDays) || []).map(({ contact, lastMs }) => {
    const account = accountOf(contact);
    return {
      id: String(contact.id || contact.vid || contact.email),
      contact, lastMs, account,
      name: nameOf(contact),
      tier: account ? reportingTier(account) : '',
      status: accountStatusOf(account),
    };
  }), [lists, windowDays, accountOf]);

  const columns = useMemo(() => [
    {
      key: 'name', label: 'Name', defaultWidth: 180,
      getSortValue: r => r.name.toLowerCase() || null, getFilterValue: r => r.name, exportValue: r => r.name,
      render: r => (onOpenContact
        ? <button type="button" style={linkBtn} title="Open contact" onClick={() => onOpenContact(r.contact)}>{r.name}</button>
        : r.name),
    },
    {
      key: 'jobtitle', label: 'Job Title', defaultWidth: 240,
      getSortValue: r => String(r.contact.jobtitle || '').toLowerCase() || null,
      getFilterValue: r => r.contact.jobtitle || '', exportValue: r => r.contact.jobtitle || '',
      render: r => r.contact.jobtitle || blank,
    },
    {
      key: 'account', label: 'Account', defaultWidth: 220,
      getSortValue: r => String(r.account?.company || r.contact.company || '').toLowerCase() || null,
      getFilterValue: r => r.account?.company || r.contact.company || '', exportValue: r => r.account?.company || r.contact.company || '',
      render: r => (r.account && onSelectProspect
        ? <button type="button" style={{ ...linkBtn, fontWeight: 600 }} title="Open the company" onClick={() => onSelectProspect(r.account)}>{r.account.company}</button>
        : (r.account?.company || r.contact.company || blank)),
    },
    {
      key: 'bfoCompanyName', label: 'BFO Company Name', defaultWidth: 200,
      headerTitle: 'The account\'s name as it appears in BFO (the company record\'s BFO Company Name).',
      getSortValue: r => String(r.account?.bfoCompanyName || '').trim().toLowerCase() || null,
      getFilterValue: r => String(r.account?.bfoCompanyName || '').trim(), exportValue: r => String(r.account?.bfoCompanyName || '').trim(),
      render: r => String(r.account?.bfoCompanyName || '').trim() || blank,
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 100,
      getSortValue: r => r.tier || null, getFilterValue: r => r.tier, exportValue: r => r.tier,
      render: r => r.tier || blank,
    },
    {
      key: 'vertical', label: 'Vertical', defaultWidth: 150,
      getSortValue: r => String(r.account?.vertical || '').trim().toLowerCase() || null,
      getFilterValue: r => String(r.account?.vertical || '').trim(), exportValue: r => String(r.account?.vertical || '').trim(),
      render: r => String(r.account?.vertical || '').trim() || blank,
    },
    {
      key: 'subVertical', label: 'Sub Vertical', defaultWidth: 160,
      getSortValue: r => String(r.account?.subVertical || '').trim().toLowerCase() || null,
      getFilterValue: r => String(r.account?.subVertical || '').trim(), exportValue: r => String(r.account?.subVertical || '').trim(),
      render: r => String(r.account?.subVertical || '').trim() || blank,
    },
    {
      key: 'status', label: 'Status', defaultWidth: 130,
      getSortValue: r => r.status || null, getFilterValue: r => r.status, exportValue: r => r.status,
      render: r => r.status || blank,
    },
    {
      key: 'lastActivity', label: 'Last Activity', defaultWidth: 140,
      headerTitle: 'The newest HubSpot email or call to this contact (from the Activity tab\'s feed), or HubSpot\'s Last Contacted date.',
      getSortValue: r => r.lastMs ?? null,
      getFilterValue: r => (r.lastMs == null ? 'Never' : formatDateDisplay(toIso(r.lastMs))),
      exportValue: r => (r.lastMs == null ? 'Never' : toIso(r.lastMs)),
      render: r => (r.lastMs == null
        ? <span style={{ color: '#B91C1C', fontWeight: 600 }}>Never</span>
        : formatDateDisplay(toIso(r.lastMs))),
    },
    {
      key: 'daysSince', label: 'Days Since', defaultWidth: 110,
      getSortValue: r => (r.lastMs == null ? Number.MAX_SAFE_INTEGER : daysSince(r.lastMs)),
      getFilterValue: r => (r.lastMs == null ? 'Never' : String(daysSince(r.lastMs))),
      exportValue: r => (r.lastMs == null ? '' : daysSince(r.lastMs)),
      render: r => (r.lastMs == null ? blank : fmt(daysSince(r.lastMs))),
    },
    {
      key: 'email', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.contact.email || null, getFilterValue: r => r.contact.email || '', exportValue: r => r.contact.email || '',
      render: r => (r.contact.email ? <a href={`mailto:${r.contact.email}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{r.contact.email}</a> : blank),
    },
    {
      key: 'phone', label: 'Phone', defaultWidth: 140,
      getSortValue: r => r.contact.phone || r.contact.mobilephone || null,
      getFilterValue: r => r.contact.phone || r.contact.mobilephone || '', exportValue: r => r.contact.phone || r.contact.mobilephone || '',
      render: r => r.contact.phone || r.contact.mobilephone || blank,
    },
    {
      key: 'linkedin', label: 'LinkedIn', defaultWidth: 100,
      getSortValue: r => linkedinOf(r.contact) || null, getFilterValue: r => (linkedinOf(r.contact) ? 'LinkedIn' : ''), exportValue: r => linkedinOf(r.contact),
      render: r => {
        const url = linkedinOf(r.contact);
        if (!url) return blank;
        return <a href={url.startsWith('http') ? url : `https://linkedin.com/in/${url}`} target="_blank" rel="noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>Profile</a>;
      },
    },
    {
      key: 'company', label: 'HubSpot Company', defaultWidth: 200,
      getSortValue: r => String(r.contact.company || '').toLowerCase() || null,
      getFilterValue: r => r.contact.company || '', exportValue: r => r.contact.company || '',
      render: r => r.contact.company || blank,
    },
  ], [onOpenContact, onSelectProspect]);

  const loading = !lists;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0, padding: '0 1.25rem 1.25rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        Decision makers at your accounts that nothing has reached: no HubSpot email or call to them, and no Last Contacted date.
        {' '}The History chart's Decision Makers (tagged Decision Maker, less Hide, Left and the clients every roster leaves out), without the Hold Off, Lost - Not Sold, Old Client and Client accounts. A company with a Substatus counts as Hold Off.
        {noIndex && <span style={{ color: '#B45309' }}> HubSpot emails and calls count once the Activity tab has loaded its feed, so until then this list may hold people who were emailed.</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        {WINDOWS.map(w => (
          <button key={w ?? 'never'} type="button" onClick={() => setWindow(w)} style={chipStyle(windowDays === w)}>
            {windowLabel(w)}{lists ? ` (${fmt(lists.get(w).length)})` : ''}
          </button>
        ))}
      </div>
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: '#64748B' }}>Loading...</div>
      ) : (
        <div style={{ height: '70vh', display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="prospecting-dms-no-activity"
            exportFileName="Decision Makers Without Activity"
            columns={columns}
            rows={rows}
            alwaysVisible={['name']}
            defaultHidden={['company', 'status']}
            emptyMessage={windowDays == null ? 'Every decision maker at your accounts has had some activity.' : `Every decision maker at your accounts has had activity in the last ${windowDays} days.`}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
