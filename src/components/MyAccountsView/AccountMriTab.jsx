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
//
// Clicking a company opens its Account MRI popup (AccountMriModal): the
// template's seven tabs as a form, saved per company under
// settings.accountMri. What is saved there is laid over the tracker's
// answers in this table and in the export.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MRI_FILLED_FIELDS, accountMriProfile, buyingCommitteeRows, siteUtilityRows } from '../../utils/accountMri';
import { mergeProfile, committeeRows, mriFormExport, mriSlug, tabProgress, mriStageProgress } from '../../utils/accountMriForm';
import { downloadAccountMri } from '../../utils/accountMriDownload';
import { AccountMriModal } from './AccountMriModal';
import { targetEntryDates, entryDateFor } from '../../utils/targetEntryDate';
import { mappedTargetNames } from '../../utils/targetAccountMatch';
import { isPrimaryPoc } from '../../utils/attendeeRoles';
import { isDecisionMakerContact } from '../../utils/decisionMakerCoverage';
import { companyRosterContacts } from '../../utils/companyRoster';
import { dealsForCompany } from '../../utils/clientContracts';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { DataTable } from '../common/DataTable';
import { LISTED_ROW_STYLE, LISTED_COMPANY_CELL, LISTED_NAME_INK } from './strategicListedStyle';

const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
// Company is pinned here, and a pinned cell's own edge shadow would be lost
// to the red bar's, so the listed cell carries both.
const LISTED_PINNED_COMPANY_CELL = { boxShadow: `${LISTED_COMPANY_CELL.boxShadow}, 2px 0 4px rgba(0,0,0,0.06)` };
// Account name is the Company column itself.
const FIELD_COLUMNS = MRI_FILLED_FIELDS.filter(f => f.key !== 'accountName');
const WIDE = new Set(['mainContact', 'competitors', 'background', 'services', 'upsell']);
// The key a company's site list is saved under, as the company popup makes it.
const siteListSlug = company => String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

// `isListed(row)` says whether the Strategic Accounts list names the row's
// company; those rows are drawn in the list's red, as on the Accounts view.
export function AccountMriTab({ rows, isListed, hubspotContacts, targetAccountsData, settings, updateSettings, updateSettingsPath, onSelect }) {
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
  // Each company's entry date on the Target Accounts List, for "Assigned since".
  const entryDates = useMemo(() => targetEntryDates(targetAccountsData), [targetAccountsData]);
  const targetMap = settings?.targetMap;
  const siteLists = settings?.companySiteLists;
  const savedForms = settings?.accountMri;

  const mriRows = useMemo(() => rows.map(r => {
    const record = r.record || { company: r.company, status: r.status, cdm: r.cdm };
    const contacts = companyRosterContacts(taggedContacts, record, {
      links: settings?.companyContactLinks,
      exclusions: settings?.companyContactExclusions,
    });
    const companyDeals = dealsForCompany(deals.list, deals.map, record.company, record.aliases);
    // What the tracker says, then what the popup has saved over it.
    const trackerProfile = accountMriProfile({
      record,
      tier: r.tier,
      contacts,
      deals: companyDeals,
      dealsKnown: deals.list.length > 0,
      entryDate: entryDateFor(entryDates, {
        targetNames: r.targetNames?.length ? r.targetNames : mappedTargetNames({ targetMap }, r.record?.id),
        company: record.company,
      }),
    });
    const trackerCommittee = buyingCommitteeRows(contacts.filter(isDecisionMakerContact));
    const form = (savedForms || {})[mriSlug(r.company)] || null;
    const profile = mergeProfile(trackerProfile, form?.profile).values;
    const sites = siteUtilityRows((siteLists || {})[siteListSlug(record.company)]);
    // The same per-tab progress the popup's tab strip shows, so this column
    // and the popup always agree.
    const stage = mriStageProgress(tabProgress({
      form: form || {},
      profile,
      committee: committeeRows(form?.committee, trackerCommittee),
      sites,
    }));
    return {
      id: r.id,
      company: r.company,
      record: r.record,
      listed: !!isListed?.(r),
      form,
      trackerProfile,
      trackerCommittee,
      committee: committeeRows(form?.committee, trackerCommittee).filter(c => c.name || c.email),
      sites,
      profile,
      stage,
    };
  }), [rows, isListed, taggedContacts, siteLists, savedForms, deals, entryDates, targetMap, settings?.companyContactLinks, settings?.companyContactExclusions]);

  // The company whose Account MRI popup is open.
  const [openId, setOpenId] = useState(null);
  const openRow = openId == null ? null : (mriRows.find(r => r.id === openId) || null);
  const saveForm = useCallback((company, next) => {
    const slug = mriSlug(company);
    if (!slug) return;
    if (updateSettingsPath) updateSettingsPath({ [`accountMri.${slug}`]: next });
    else updateSettings?.({ accountMri: { ...(settings?.accountMri || {}), [slug]: next } });
  }, [updateSettingsPath, updateSettings, settings?.accountMri]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 240, sticky: true,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      cellStyle: r => (r.listed ? LISTED_PINNED_COMPANY_CELL : undefined),
      render: r => (
        <button
          type="button"
          onClick={() => setOpenId(r.id)}
          title="Open the Account MRI for this company"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: r.listed ? 700 : 600, color: r.listed ? LISTED_NAME_INK : '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
        >{r.company}</button>
      ),
    },
    {
      key: 'mriProgress', label: 'MRI Progress', defaultWidth: 160,
      headerTitle: 'How far the Account MRI has got: the first of its seven tabs that is not complete yet, and how much of that tab is filled. 7 - 100% is every tab done.',
      getSortValue: r => r.stage.stage * 1000 + r.stage.pct,
      getFilterValue: r => r.stage.text,
      exportValue: r => r.stage.text,
      render: (r) => {
        const done = r.stage.stage === 7 && r.stage.pct >= 100;
        return (
          <span title={`Tab ${r.stage.stage}, ${r.stage.label}: ${r.stage.pct}% filled`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: done ? '#047857' : '#334155', whiteSpace: 'nowrap' }}>{r.stage.text}</span>
            <span style={{ flex: 1, minWidth: 24, height: 5, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${((r.stage.stage - 1) * 100 + r.stage.pct) / 7}%`, background: done ? '#059669' : '#64748B' }} />
            </span>
          </span>
        );
      },
    },
    ...FIELD_COLUMNS.map(f => ({
      key: f.key,
      label: f.label,
      defaultWidth: WIDE.has(f.key) ? 260 : 150,
      headerTitle: `Template row "${f.label}", filled from the tracker's ${f.source} unless the Account MRI popup has its own value.`,
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
      headerTitle: 'The buying committee: the contacts tagged Decision Maker, or the list kept in the Account MRI popup once it has been edited. The export lists them on tab 3.',
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
  ], []);

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
      await downloadAccountMri({
        company: one.company,
        profile: one.profile,
        committee: one.committee,
        sites: one.sites,
        extra: one.form ? mriFormExport(one.form) : null,
      });
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
      ? `Download the Account MRI intake template filled in for ${one.company}: tab 1, its buying committee on tab 3, its site list on tab 5, and whatever its Account MRI popup holds for the other tabs.`
      : 'Filter the table to one company (the search box or any column filter) to export its Account MRI template.',
    disabled: !one || busy,
    onClick: exportOne,
  }], [one, busy, exportOne]);

  return (
    <>
      <div style={{ fontSize: '0.72rem', color: one ? '#047857' : '#64748B' }}>
        {one
          ? `Ready to export ${one.company}: tab 1, ${one.committee.length} decision maker${one.committee.length === 1 ? '' : 's'} on tab 3 and ${one.sites.length.toLocaleString()} site${one.sites.length === 1 ? '' : 's'} on tab 5.`
          : 'The Account MRI intake template: tab 1 (Profile & Background) one column per row the tracker fills, plus the decision makers for tab 3 and the saved site list for tab 5. Click a company to open its Account MRI and work all seven tabs; filter to one company to export its template.'}
        {error && <span style={{ color: '#B91C1C', marginLeft: 8 }}>{error}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-strategic-account-mri"
          exportFileName="My Accounts Account MRI"
          columns={columns}
          rows={mriRows}
          rowStyle={r => (r.listed ? LISTED_ROW_STYLE : undefined)}
          defaultSort={{ key: 'company', direction: 'asc' }}
          alwaysVisible={['company']}
          emptyMessage="No accounts match"
          settings={settings}
          updateSettings={updateSettings}
          toolbarActions={toolbarActions}
          onFilteredRowsChange={setShown}
        />
      </div>
      {openRow && (
        <AccountMriModal
          key={openRow.id}
          row={{ company: openRow.company, record: openRow.record, profile: openRow.trackerProfile, committee: openRow.trackerCommittee, sites: openRow.sites }}
          form={openRow.form}
          onSave={next => saveForm(openRow.company, next)}
          onClose={() => setOpenId(null)}
          onOpenCompany={openRow.record && onSelect ? () => onSelect(openRow.record) : null}
          settings={settings}
          updateSettings={updateSettings}
        />
      )}
    </>
  );
}
