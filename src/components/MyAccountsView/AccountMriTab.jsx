// My Accounts > Strategic Accounts > Account MRI: the strategic accounts
// with the tracker's answer to each row of the Account MRI intake
// template's first tab (1 Profile & Background), how many decision makers
// and saved sites each has, and the button that hands the template back
// filled in for one company: tab 1 from those answers, tab 3 (Buying
// Committee) with its decision makers, tab 5 (Sites & Utilities) with the
// site list saved on its company popup.
//
// Which tracker field answers which row is Dan's own mapping, column B of
// the template; it lives in utils/accountMri.js, where the workbook is
// filled too. The export needs the table narrowed to a single company (the
// search box or any column filter), since the template holds one account.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MRI_FILLED_FIELDS, accountMriProfile, buyingCommitteeRows, siteUtilityRows, fillAccountMriWorkbook, mriFileName } from '../../utils/accountMri';
import { isPrimaryPoc } from '../../utils/attendeeRoles';
import { isDecisionMakerContact } from '../../utils/decisionMakerCoverage';
import { companyRosterContacts } from '../../utils/companyRoster';
import { contractsSummary, dealsForCompany } from '../../utils/clientContracts';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { DataTable } from '../common/DataTable';
import templateUrl from '../../assets/account-mri-intake-template.xlsx?url';

const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
// Account name is the Company column itself.
const FIELD_COLUMNS = MRI_FILLED_FIELDS.filter(f => f.key !== 'accountName');
const WIDE = new Set(['mainContact', 'competitors', 'background', 'services', 'upsell']);
// The key a company's site list is saved under, as the company popup makes it.
const siteListSlug = company => String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

export function AccountMriTab({ rows, hubspotContacts, settings, updateSettings, onSelect }) {
  // The Deals subtab's agreements and its client-name mapping, which the
  // Fee, Set-up and Contract term rows read. Re-read when either changes.
  const [deals, setDeals] = useState(() => ({ list: loadDealsList().data || [], map: loadDealClientMap() }));
  useEffect(() => {
    const refresh = () => setDeals({ list: loadDealsList().data || [], map: loadDealClientMap() });
    window.addEventListener(DEALS_LIST_EVENT, refresh);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, refresh);
    return () => {
      window.removeEventListener(DEALS_LIST_EVENT, refresh);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, refresh);
    };
  }, []);

  // Only the tagged contacts are ever read (decision makers for tab 3, the
  // Primary Point of Contact for tab 1), so the roster rule runs over those
  // rather than over every contact for every account.
  const taggedContacts = useMemo(
    () => (hubspotContacts || []).filter(c => isPrimaryPoc(c) || isDecisionMakerContact(c)),
    [hubspotContacts],
  );
  const siteLists = settings?.companySiteLists;

  const mriRows = useMemo(() => rows.map(r => {
    const record = r.record || { company: r.company, status: r.status, cdm: r.cdm };
    const contacts = companyRosterContacts(taggedContacts, record, {
      links: settings?.companyContactLinks,
      exclusions: settings?.companyContactExclusions,
    });
    const companyDeals = dealsForCompany(deals.list, deals.map, record.company, record.aliases);
    return {
      id: r.id,
      company: r.company,
      record: r.record,
      committee: buyingCommitteeRows(contacts.filter(isDecisionMakerContact)),
      sites: siteUtilityRows((siteLists || {})[siteListSlug(record.company)]),
      profile: accountMriProfile({
        record,
        tier: r.tier,
        contacts,
        contracts: companyDeals.length ? contractsSummary(companyDeals) : null,
      }),
    };
  }), [rows, taggedContacts, siteLists, deals, settings?.companyContactLinks, settings?.companyContactExclusions]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 240, sticky: true,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => (r.record && onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(r.record)}
          title="Open the company"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
        >{r.company}</button>
      ) : <span style={{ fontWeight: 600 }}>{r.company}</span>),
    },
    ...FIELD_COLUMNS.map(f => ({
      key: f.key,
      label: f.label,
      defaultWidth: WIDE.has(f.key) ? 260 : 150,
      headerTitle: `Template row "${f.label}", filled from the tracker's ${f.source}.`,
      getSortValue: r => {
        const v = r.profile[f.key];
        if (v == null || v === '') return null;
        return typeof v === 'number' ? v : String(v).toLowerCase();
      },
      getFilterValue: r => String(r.profile[f.key] ?? ''),
      exportValue: r => r.profile[f.key] ?? '',
      render: r => {
        const v = r.profile[f.key];
        if (v == null || v === '') return blank;
        return <span title={String(v)} style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{typeof v === 'number' ? v.toLocaleString() : v}</span>;
      },
    })),
    {
      key: 'decisionMakers', label: 'Decision Makers', defaultWidth: 150,
      headerTitle: 'Contacts at the company tagged Decision Maker. The export lists them on tab 3, Buying Committee.',
      getSortValue: r => r.committee.length,
      getFilterValue: r => r.committee.map(c => c.name).join(', '),
      exportValue: r => r.committee.map(c => c.name).join(', '),
      render: r => (r.committee.length
        ? <span title={r.committee.map(c => (c.title ? `${c.name}, ${c.title}` : c.name)).join('\n')} style={{ color: '#475569' }}>{r.committee.length}</span>
        : blank),
    },
    {
      key: 'siteList', label: 'Site List', defaultWidth: 120,
      headerTitle: 'Sites still open on the site list saved on the company popup. The export lists them on tab 5, Sites & Utilities.',
      getSortValue: r => r.sites.length,
      getFilterValue: r => (r.sites.length ? `${r.sites.length} sites` : 'None saved'),
      exportValue: r => r.sites.length || '',
      render: r => (r.sites.length ? <span style={{ color: '#475569' }}>{r.sites.length.toLocaleString()}</span> : blank),
    },
  ], [onSelect]);

  // What the table is showing after its own column filters: the export is
  // offered once that is exactly one company.
  const [shown, setShown] = useState(mriRows);
  const one = shown.length === 1 ? (mriRows.find(r => r.id === shown[0].id) || null) : null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exportOne = useCallback(async () => {
    if (!one) return;
    setBusy(true);
    setError('');
    try {
      const [{ default: JSZip }, res] = await Promise.all([import('jszip'), fetch(templateUrl)]);
      if (!res.ok) throw new Error(`The template could not be loaded (${res.status}).`);
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      await fillAccountMriWorkbook(zip, { profile: one.profile, committee: one.committee, sites: one.sites });
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mriFileName(one.company);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err?.message || 'The export failed.');
    } finally {
      setBusy(false);
    }
  }, [one]);

  const toolbarActions = useMemo(() => [{
    key: 'mri-export',
    label: busy ? 'Exporting...' : 'Export Account MRI',
    title: one
      ? `Download the Account MRI intake template filled in for ${one.company}: tab 1, its decision makers on tab 3 and its site list on tab 5.`
      : 'Filter the table to one company (the search box or any column filter) to export its Account MRI template.',
    disabled: !one || busy,
    onClick: exportOne,
  }], [one, busy, exportOne]);

  return (
    <>
      <div style={{ fontSize: '0.72rem', color: one ? '#047857' : '#64748B' }}>
        {one
          ? `Ready to export ${one.company}: tab 1, ${one.committee.length} decision maker${one.committee.length === 1 ? '' : 's'} on tab 3 and ${one.sites.length.toLocaleString()} site${one.sites.length === 1 ? '' : 's'} on tab 5.`
          : 'The Account MRI intake template: tab 1 (Profile & Background) one column per row the tracker fills, plus the decision makers for tab 3 and the saved site list for tab 5. Filter to one company to export its template.'}
        {error && <span style={{ color: '#B91C1C', marginLeft: 8 }}>{error}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-strategic-account-mri"
          exportFileName="My Accounts Account MRI"
          columns={columns}
          rows={mriRows}
          defaultSort={{ key: 'company', direction: 'asc' }}
          alwaysVisible={['company']}
          emptyMessage="No accounts match"
          settings={settings}
          updateSettings={updateSettings}
          toolbarActions={toolbarActions}
          onFilteredRowsChange={setShown}
        />
      </div>
    </>
  );
}
