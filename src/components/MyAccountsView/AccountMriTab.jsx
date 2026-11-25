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
import { MRI_FILLED_FIELDS, accountMriProfile, accountServiceStatuses, accountTryingAgainServices, accountLiveOpps, isPortfolioCompanyContact, buyingCommitteeRows, siteUtilityRows } from '../../utils/accountMri';
import { accountIsCompany } from '../../utils/companyAliases';
import { buildServiceBoard } from '../../utils/serviceCategoriesStore';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { mergeProfile, committeeRows, mriFormExport, mriSlug, tabProgress, mriStageProgress, profileDisplayValue, trackerSignals, trackerSignalReasons, trackerNotes, trackerFootprint, withTrackerSignals, withOpportunityDefault } from '../../utils/accountMriForm';
import { downloadAccountMri } from '../../utils/accountMriDownload';
import { AccountMriModal } from './AccountMriModal';
import { targetEntryDates, entryDateFor } from '../../utils/targetEntryDate';
import { mappedTargetNames } from '../../utils/targetAccountMatch';
import { isPrimaryPoc } from '../../utils/attendeeRoles';
import { isDecisionMakerContact } from '../../utils/decisionMakerCoverage';
import { companyRosterContacts } from '../../utils/companyRoster';
import { recordOwnedCompanies, ownedCompanyFor } from '../../utils/ownedCompanyContacts';
import { dealsForCompany } from '../../utils/clientContracts';
import { loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import { DataTable } from '../common/DataTable';
import { computeListFlags } from '../../utils/listFlags';
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
export function AccountMriTab({ rows, prospects = [], isListed, hubspotContacts, oppsRecords, targetAccountsData, settings, updateSettings, updateSettingsPath, onSelect, onUpdate }) {
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

  // The frameworks each company is flagged with (its own list plus the
  // confirmed Lists-page mappings, the My Accounts Frameworks column), for
  // the Immune System signs that read them. Redone when a mapping changes.
  const [flagVersion, setFlagVersion] = useState(0);
  useEffect(() => {
    const bump = () => setFlagVersion(v => v + 1);
    window.addEventListener('my-accounts-coverage-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('my-accounts-coverage-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  const [frameworkFlags, setFrameworkFlags] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const records = rows.map(r => r.record || { company: r.company });
    computeListFlags(rows.map(r => r.company), { prospects: records }).then((flags) => {
      if (!cancelled) setFrameworkFlags(flags);
    });
    return () => { cancelled = true; };
  }, [rows, flagVersion]);

  // What the Services and UBM rows read: each service's status as the
  // company card's Services board shows it, the manual status else the
  // stage of an opp on the account naming it. The opps are grouped by
  // Account once, so each company matches against the account names rather
  // than every opp.
  const serviceNames = useMemo(() => {
    const solutions = getEffectiveDropdownLists(settings || {}).find(l => l.key === 'solutions')?.options || [];
    return [...new Set(buildServiceBoard(settings || {}, solutions).flatMap(c => c.items || []))];
  }, [settings]);
  const serviceOverrides = settings?.serviceOverrides;
  const hiddenServices = settings?.hiddenServices;
  const serviceRenames = settings?.serviceRenames;
  // The services each Diagnosis body system is about, for its footprint.
  const systemServices = settings?.mriSystemServices;
  // The services as the board names them (renamed, hidden ones left out):
  // what the popup offers to assign to a body system.
  const serviceOptions = useMemo(() => {
    const hide = new Set((hiddenServices || []).map(n => String(n).trim().toLowerCase()));
    const out = [];
    for (const n of serviceNames) {
      if (hide.has(String(n).trim().toLowerCase())) continue;
      const shown = String(serviceRenames?.[n] || n).trim();
      if (shown && !out.includes(shown)) out.push(shown);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [serviceNames, hiddenServices, serviceRenames]);
  const oppsByAccount = useMemo(() => {
    const map = new Map();
    for (const o of oppsRecords || []) {
      const account = String(o?.Account || '').trim();
      if (!account || !String(o?.Scope || '').trim()) continue;
      if (!map.has(account)) map.set(account, []);
      map.get(account).push(o);
    }
    return map;
  }, [oppsRecords]);

  // Each company record by name, so a portfolio company's opps are matched
  // on the names merged into it as well.
  const prospectByName = useMemo(() => {
    const map = new Map();
    for (const p of prospects || []) {
      const k = String(p?.company || '').trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, p);
    }
    return map;
  }, [prospects]);

  const mriRows = useMemo(() => rows.map(r => {
    const record = r.record || { company: r.company, status: r.status, cdm: r.cdm };
    // The account's own people only: anyone the company card lists under
    // Owned Company Contacts (a division's or portfolio company's person the
    // roster pulled in) is left out, the same rule the card uses.
    const owned = recordOwnedCompanies(record, settings || {}, prospects);
    const ownNames = [record.aliases, record.hubspotCompanyNames]
      .flatMap(v => String(v || '').split(/[\n;,]+/)).map(n => n.trim()).filter(Boolean);
    const contacts = companyRosterContacts(taggedContacts, record, {
      links: settings?.companyContactLinks,
      exclusions: settings?.companyContactExclusions,
    }).filter(c => !ownedCompanyFor(c, owned, { self: record.company, ownNames, links: settings?.companyContactLinks || {} }));
    // The account's own opps: Account is the record's name, a name merged
    // into it, or the name this row shows, as the company card's Services
    // board reads them. A related account sharing a word of the name
    // ("Brookfield (Core Retail)") is its own company and doesn't count.
    const self = { company: record.company, companyAliases: [...(record.companyAliases || []), r.company] };
    const companyOpps = [];
    for (const [account, list] of oppsByAccount) {
      if (accountIsCompany(account, self)) companyOpps.push(...list);
    }
    // Already matched above, so each is handed over under the one name the
    // status reader matches on again.
    const oppAccount = String(record.company || r.company || '').trim();
    const serviceArgs = {
      company: oppAccount,
      servicesExplored: record.servicesExplored,
      oppRows: companyOpps.map(o => ({ ...o, Account: oppAccount })),
      services: serviceNames,
      serviceOverrides: serviceOverrides || {},
      hidden: hiddenServices,
      renames: serviceRenames,
    };
    const serviceStatuses = accountServiceStatuses(serviceArgs);
    const companyDeals = dealsForCompany(deals.list, deals.map, record.company, record.aliases);
    // What the tracker says, then what the popup has saved over it.
    const trackerProfile = accountMriProfile({
      record,
      tier: r.tier,
      contacts,
      serviceStatuses,
      tryingAgain: accountTryingAgainServices(serviceArgs),
      deals: companyDeals,
      dealsKnown: deals.list.length > 0,
      entryDate: entryDateFor(entryDates, {
        targetNames: r.targetNames?.length ? r.targetNames : mappedTargetNames({ targetMap }, r.record?.id),
        company: record.company,
      }),
    });
    // People at the account's portfolio companies sit on their own company's
    // committee, not this one (the roster's fuzzy name match can bring them in).
    // The Primary Point of Contact sits on it too, as the relationship owner.
    const trackerCommittee = buyingCommitteeRows(
      contacts.filter(c => (isDecisionMakerContact(c) || isPrimaryPoc(c)) && !isPortfolioCompanyContact(c, record)),
      { sentiment: settings?.contactSentiment },
    );
    const form = (savedForms || {})[mriSlug(r.company)] || null;
    // Live opps on the company and its portfolio companies, for the
    // Opportunity tab; null until the opps have loaded, so nothing is
    // ticked "No active opportunity" for want of them.
    const holdings = owned.filter(o => o.kind === 'holding')
      .map(o => prospectByName.get(o.name.toLowerCase()) || o.name);
    const liveOpps = (oppsRecords || []).length ? accountLiveOpps(oppsRecords, self, holdings) : null;
    const footprint = trackerFootprint(systemServices, serviceStatuses);
    const profile = mergeProfile(trackerProfile, form?.profile).values;
    const siteList = (siteLists || {})[siteListSlug(record.company)];
    const sites = siteUtilityRows(siteList);
    const frameworks = frameworkFlags.get(String(r.company || '').toLowerCase().trim());
    const signalInputs = { siteList, frameworks };
    const signals = trackerSignals(record, signalInputs);
    const notes = trackerNotes(record, { frameworks, profile, siteList });
    // The same per-tab progress the popup's tab strip shows, so this column
    // and the popup always agree.
    const stage = mriStageProgress(tabProgress({
      form: withOpportunityDefault(withTrackerSignals(form, signals, notes, footprint), liveOpps),
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
      trackerSignals: signals,
      trackerReasons: trackerSignalReasons(record, signalInputs),
      trackerNotes: notes,
      trackerFootprint: footprint,
      serviceStatuses,
      liveOpps,
      committee: committeeRows(form?.committee, trackerCommittee).filter(c => c.name || c.email),
      sites,
      profile,
      stage,
    };
  }), [rows, isListed, taggedContacts, siteLists, savedForms, deals, entryDates, targetMap, oppsByAccount, serviceNames, serviceOverrides, hiddenServices, serviceRenames, systemServices, settings, prospects, frameworkFlags, oppsRecords, prospectByName]);

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
        if (typeof v === 'number') return v;
        // A dollar row or count typed in the popup is kept as "$1,630"; sort it as the number.
        const n = f.kind === 'number' ? Number(String(v).replace(/[$,\s]/g, '')) : NaN;
        return Number.isFinite(n) ? n : String(v).toLowerCase();
      },
      getFilterValue: r => String(r.profile[f.key] ?? ''),
      exportValue: r => r.profile[f.key] ?? '',
      render: r => {
        const v = r.profile[f.key];
        if (v == null || v === '') return blank;
        const shown = profileDisplayValue(f.key, v);
        return <span title={shown} style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{shown}</span>;
      },
    })),
    {
      key: 'decisionMakers', label: 'Decision Makers', defaultWidth: 150,
      headerTitle: 'The buying committee: the contacts tagged Decision Maker or Primary Point of Contact, or the list kept in the Account MRI popup once it has been edited. The export lists them on tab 3.',
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
        // The tracker's ratings and notes, and the defaults, go out even for
        // a company nothing has been saved for yet.
        extra: mriFormExport(withOpportunityDefault(withTrackerSignals(one.form, one.trackerSignals, one.trackerNotes, one.trackerFootprint), one.liveOpps)),
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
          // Furthest along first: highest tab, then most of it filled.
          // Ties keep the rows' alphabetical order (the sort is stable).
          defaultSort={{ key: 'mriProgress', direction: 'desc' }}
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
          row={{ company: openRow.company, record: openRow.record, profile: openRow.trackerProfile, committee: openRow.trackerCommittee, sites: openRow.sites, trackerSignals: openRow.trackerSignals, trackerReasons: openRow.trackerReasons, trackerNotes: openRow.trackerNotes, trackerFootprint: openRow.trackerFootprint, serviceStatuses: openRow.serviceStatuses, liveOpps: openRow.liveOpps }}
          serviceOptions={serviceOptions}
          form={openRow.form}
          onSave={next => saveForm(openRow.company, next)}
          onClose={() => setOpenId(null)}
          onOpenCompany={openRow.record && onSelect ? () => onSelect(openRow.record) : null}
          onUpdateRecord={openRow.record?.id && onUpdate ? patch => onUpdate(openRow.record.id, patch) : null}
          settings={settings}
          updateSettings={updateSettings}
          hubspotContacts={hubspotContacts}
          prospects={prospects}
        />
      )}
    </>
  );
}
