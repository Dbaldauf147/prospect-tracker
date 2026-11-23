// My Accounts > Strategic Accounts > Account MRI: the strategic accounts
// with the tracker's answer to each row of the Account MRI intake
// template's first tab (1 Profile & Background), and the button that hands
// the template back with those answers filled in for one company.
//
// Which tracker field answers which row is Dan's own mapping, column B of
// the template; it lives in utils/accountMri.js, where the workbook is
// filled too. The export needs the table narrowed to a single company (the
// search box or any column filter), since the template holds one account.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MRI_FILLED_FIELDS, MRI_PROFILE_SHEET_PATH, accountMriProfile, fillProfileSheet, mriFileName } from '../../utils/accountMri';
import { isPrimaryPoc } from '../../utils/attendeeRoles';
import { companyRosterContacts } from '../../utils/companyRoster';
import { contractsSummary, dealsForCompany } from '../../utils/clientContracts';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { DataTable } from '../common/DataTable';
import templateUrl from '../../assets/account-mri-intake-template.xlsx?url';

const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
// Account name is the Company column itself.
const FIELD_COLUMNS = MRI_FILLED_FIELDS.filter(f => f.key !== 'accountName');
const WIDE = new Set(['mainContact', 'competitors', 'background', 'services']);

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

  // Only the tagged contacts are ever read, so the roster rule runs over
  // those few rather than over every contact for every account.
  const pocContacts = useMemo(() => (hubspotContacts || []).filter(isPrimaryPoc), [hubspotContacts]);

  const mriRows = useMemo(() => rows.map(r => {
    const record = r.record || { company: r.company, status: r.status, cdm: r.cdm };
    const contacts = companyRosterContacts(pocContacts, record, {
      links: settings?.companyContactLinks,
      exclusions: settings?.companyContactExclusions,
    });
    const companyDeals = dealsForCompany(deals.list, deals.map, record.company, record.aliases);
    return {
      id: r.id,
      company: r.company,
      record: r.record,
      profile: accountMriProfile({
        record,
        tier: r.tier,
        contacts,
        contracts: companyDeals.length ? contractsSummary(companyDeals) : null,
      }),
    };
  }), [rows, pocContacts, deals, settings?.companyContactLinks, settings?.companyContactExclusions]);

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
      const sheet = zip.file(MRI_PROFILE_SHEET_PATH);
      if (!sheet) throw new Error('The template has no Profile & Background tab.');
      const { xml } = fillProfileSheet(await sheet.async('string'), one.profile);
      zip.file(MRI_PROFILE_SHEET_PATH, xml);
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
      ? `Download the Account MRI intake template with tab 1 filled in for ${one.company}.`
      : 'Filter the table to one company (the search box or any column filter) to export its Account MRI template.',
    disabled: !one || busy,
    onClick: exportOne,
  }], [one, busy, exportOne]);

  return (
    <>
      <div style={{ fontSize: '0.72rem', color: one ? '#047857' : '#64748B' }}>
        {one
          ? `Ready to export ${one.company}: Export Account MRI fills tab 1 of the intake template.`
          : 'Tab 1 of the Account MRI intake template (Profile & Background), one column per row the tracker fills. Filter to one company to export its template.'}
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
