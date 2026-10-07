// The Prospecting page's "Prospects" and "PCs" subtabs: one DataTable per
// list (resizable, filterable columns, starred defaults in the Columns
// menu), with the sites, utility accounts and total energy behind each
// company and a totals strip for whatever the filters leave on screen. The
// rows and where each figure comes from are worked out in
// utils/prospectingPortfolio.js; this file only lays them out.
//
// Beside the figures: whether a Master Analysis is saved against the
// company, and the biggest service still open on it with what that service
// is. The deal is the company card's own Biggest Deal reading, run per row
// (utils/prospectingDeals.js), so the two never disagree.
//
// And who the decision makers are for that deal: the contacts tagged
// Decision Maker at each company, matched the way the ladder's DM mapping
// matches them (utils/decisionMakerCoverage.js), narrowed to the ones who
// also carry one of the Biggest Deal service's contact tags (set in the
// Services popup). A service with no contact tags narrows nothing.
//
// And where that service stands, settable from the row: the Service Status
// column writes the company card's Services Explored map, the same field
// the card's own grid writes. Only open services are ever the biggest deal,
// so marking one Not Sold or N/A takes it off the row and the next biggest
// open service takes its place.
//
// And only the ones nobody has started on: a row whose biggest deal already
// carries a status (Exploring, Quoted, ...) is being worked, not prospected,
// so it is left off the list. Picking a status from the row therefore takes
// the row away; "- (auto)" on the company card brings it back.
//
// Many rows at once, too: tick companies (or every one on screen) and set
// one status on each of their listed services in a single go, with Undo.
// See utils/prospectingBulkStatus.js.
//
// And with some services left out of the analysis entirely: the Services
// picker beside the search box takes a service off the rate card both lists
// price against, so the next biggest open service leads instead. Saved in
// settings, shared by the two subtabs.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATUS_COLORS, SERVICE_STATUSES } from '../../data/enums.js';
import { serviceStatusColor } from '../../utils/serviceStatusColors.js';
import { withServiceStatus } from '../../utils/clientDealSizing.js';
import { planProspectingBulkStatus } from '../../utils/prospectingBulkStatus.js';
import { allPcRows, myProspectRows, sumFigures, rowTypeLabel, typesOnRows, withoutTypes } from '../../utils/prospectingPortfolio.js';
import { biggestDealFor, dealHasStatus, excludedServiceSet, withoutExcludedServices, PROSPECTING_EXCLUDED_KEY } from '../../utils/prospectingDeals.js';
import { useSavedAnalyses, formatAnalysisDate } from '../../hooks/useSavedAnalyses';
import { pricedServiceRows } from '../../utils/serviceRows';
import { formatMoneyRange, getServicePricing, resolvePricingBases } from '../../utils/servicePricing';
import { buildOppStagesByClient } from '../../utils/serviceCoverage';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { decisionMakersWithTags, makeDecisionMakerLookup } from '../../utils/decisionMakerCoverage';
import { getEffectiveServiceMetadata, parseServiceContactTags } from '../../data/serviceCatalog';


// Where a figure came from, for the tooltip and for whether it reads as
// measured or estimated.
const SOURCE_NOTE = {
  analysis: 'From the company record (written by its Master Analysis save, or typed on its popup).',
  siteList: 'Counted off the site list saved on the company popup. Save a Master Analysis to replace it with the active-site count.',
  electric: 'Electric MWh typed on the company popup: electricity only, no gas. Save a Master Analysis to get the electric + gas total.',
  estimate: 'Estimate from the PE firm Portfolio Companies table. Add the company to the tracker and save a Master Analysis for the real figure.',
};

// A decision maker as the cell names them.
const dmLabel = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');

function Figure({ value, from, unit = '' }) {
  if (value == null) return <span style={{ color: '#CBD5E1' }}>-</span>;
  const soft = from === 'estimate' || from === 'electric';
  return (
    <span
      title={SOURCE_NOTE[from] || undefined}
      style={{ fontVariantNumeric: 'tabular-nums', color: soft ? '#94A3B8' : '#1E293B', fontStyle: soft ? 'italic' : 'normal' }}
    >
      {Math.round(value).toLocaleString()}{unit}
      {from === 'estimate' && <span style={{ fontSize: '0.62rem' }}> est.</span>}
      {from === 'electric' && <span style={{ fontSize: '0.62rem' }}> elec.</span>}
    </span>
  );
}


// The biggest deal service's status, set from the row. Painted the colour of
// the status it shows, like the pills elsewhere, with the company card's
// own vocabulary and "- (auto)": no override, so the service reads whatever
// a matching opp says. A blue border means the status is typed on the card
// rather than coming from an opp.
function DealStatusSelect({ deal, disabled, onPick }) {
  const value = deal.status || '-';
  const manual = !!deal.status && !deal.fromOpp;
  const { bg, color } = serviceStatusColor(deal.status);
  const title = disabled
    ? 'Open the company to change this status'
    : `Set the status of ${deal.name} on this company. This list only shows services with no status yet, so picking one takes the company off it until the status is set back to "-" on the company card.`;
  return (
    <select
      value={value}
      disabled={disabled}
      title={title.replace(/\s+/g, ' ').trim()}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onPick(e.target.value); }}
      style={{
        maxWidth: '100%', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit',
        padding: '2px 3px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${manual ? '#3B82F6' : '#CBD5E1'}`,
        background: bg || '#fff',
        color: color || '#475569',
      }}
    >
      {/* A status off the opp list the card doesn't offer still shows. */}
      {!SERVICE_STATUSES.includes(value) && <option value={value}>{value}</option>}
      {SERVICE_STATUSES.map(st => (
        <option key={st} value={st}>{st === '-' ? '- (auto)' : st}</option>
      ))}
    </select>
  );
}

// The Services picker: which services this page's analysis leaves out. A
// checklist of every service on the rate card, ticked = included, with a
// search box for a long card. Every change saves straight away.
function ExcludedServicesPicker({ names, excluded, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('[data-excluded-services]')) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const sorted = useMemo(() => [...new Set(names)].sort((a, b) => a.localeCompare(b)), [names]);
  const shownNames = q.trim() ? sorted.filter(n => n.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  // Only names still on the card count: an exclusion for a service since
  // removed changes nothing, so it isn't reported as one.
  const count = sorted.filter(n => excluded.has(n)).length;
  const toggle = (name) => {
    if (!onChange) return;
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  return (
    <div data-excluded-services style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Leave services out of this page's analysis. An excluded service is never a row's Biggest Deal and is never bundled in with one, so the next biggest open service leads instead. Applies to both the Prospects and PCs subtabs."
        style={{
          padding: '0.35rem 0.7rem', borderRadius: 6, fontSize: '0.74rem', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${count ? '#F59E0B' : '#CBD5E1'}`, background: count ? '#FFFBEB' : '#fff', color: count ? '#92400E' : '#475569',
        }}
      >{count ? `Services: ${count} excluded` : 'Services: all included'}</button>
      {open && (
        <div
          role="dialog"
          aria-label="Services in the analysis"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, width: 300, maxHeight: 380,
            display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.15)', fontSize: '0.74rem', color: '#334155',
          }}
        >
          <div style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#64748B', fontSize: '0.68rem' }}>Untick a service to leave it out of Biggest Deal on both subtabs.{onChange ? '' : ' (Read-only here.)'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Find a service"
                style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'inherit' }}
              />
              {count > 0 && onChange && (
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontSize: '0.68rem', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >Include all</button>
              )}
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: '0.25rem 0' }}>
            {shownNames.map(name => (
              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0.75rem', cursor: onChange ? 'pointer' : 'default', color: excluded.has(name) ? '#94A3B8' : '#1E293B' }}>
                <input type="checkbox" checked={!excluded.has(name)} disabled={!onChange} onChange={() => toggle(name)} style={{ margin: 0 }} />
                <span style={{ textDecoration: excluded.has(name) ? 'line-through' : 'none' }}>{name}</span>
              </label>
            ))}
            {shownNames.length === 0 && <div style={{ padding: '0.5rem 0.75rem', color: '#94A3B8' }}>No services match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Each record's biggest deal, remembered against the rate card and opps it
// was priced with, so an edit to one company re-prices that company rather
// than the whole list. Keyed by the record object, so a record that is
// replaced (edited) or dropped lets go of its entry.
const DEAL_CACHE = new WeakMap();
function cachedDeal(prospect, ctx, oppRecords) {
  const hit = DEAL_CACHE.get(prospect);
  if (hit && hit.ctx === ctx && hit.opps === oppRecords) return hit.deal;
  // What this company's opportunities say about each service, matched the
  // way Dropdowns > Account Potential matches them.
  const oppStages = Array.isArray(oppRecords) && oppRecords.length
    ? (buildOppStagesByClient([prospect], oppRecords, ctx.serviceRows.map(r => r.name)).get(prospect) || null)
    : null;
  const deal = biggestDealFor(prospect, { ...ctx, oppStages });
  DEAL_CACHE.set(prospect, { ctx, opps: oppRecords, deal });
  return deal;
}

export function ProspectingCompanies({ mode, prospects, settings, updateSettings = null, updateProspect = null, cdmName = '', onSelectProspect, maxWidth }) {
  const siteLists = settings?.companySiteLists || null;
  const baseRows = useMemo(() => (
    mode === 'pcs'
      ? allPcRows(prospects, siteLists)
      : myProspectRows(prospects, cdmName, siteLists)
  ), [mode, prospects, siteLists, cdmName]);

  // The tracker records behind the rows. A PC with no record of its own has
  // nothing saved against it and no services to price.
  const tracked = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of baseRows) {
      if (r.prospect?.id && !seen.has(r.prospect.id)) { seen.add(r.prospect.id); out.push(r.prospect); }
    }
    return out;
  }, [baseRows]);
  // The hook hands back a fresh Map every render. Pin it to what it holds,
  // or the rows rebuild every render and the table's report of the rows on
  // screen (which sets state here) never settles.
  const freshAnalyses = useSavedAnalyses(tracked);
  const analysesKey = tracked.map((p) => {
    const a = freshAnalyses.get(p.id);
    return a ? `${p.id}:${a.savedAt || ''}:${a.fileName || ''}` : '';
  }).join('|');
  const savedAnalyses = useMemo(() => freshAnalyses, [analysesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // This user's opportunities, read once: an opp whose Scope names a
  // service has explored it, which the company card counts when it picks
  // the biggest deal, so this list has to as well. Until they arrive the
  // deals are priced off the service statuses alone.
  const auth = useAuth();
  const uid = auth?.user?.uid;
  const [oppRecords, setOppRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadOpps2Newest(uid)
      .then(data => { if (!cancelled) setOppRecords(Array.isArray(data?.records) ? data.records : []); })
      .catch(() => { if (!cancelled) setOppRecords([]); });
    return () => { cancelled = true; };
  }, [uid]);

  // Keyed on the settings that actually feed the rate card rather than the
  // whole settings object: pricing every row costs a few milliseconds each,
  // and an unrelated save elsewhere must not re-price the whole list.
  const pricingSettings = useMemo(() => ({
    servicePricing: settings?.servicePricing,
    pricingBases: settings?.pricingBases,
    serviceOverrides: settings?.serviceOverrides,
    hiddenServices: settings?.hiddenServices,
    customServiceCategories: settings?.customServiceCategories,
    dropdownCustomLists: settings?.dropdownCustomLists,
    dropdownListLabels: settings?.dropdownListLabels,
    dropdownLists: settings?.dropdownLists,
    dropdownListsHidden: settings?.dropdownListsHidden,
  }), [settings?.servicePricing, settings?.pricingBases, settings?.serviceOverrides,
    settings?.hiddenServices, settings?.customServiceCategories, settings?.dropdownCustomLists,
    settings?.dropdownListLabels, settings?.dropdownLists, settings?.dropdownListsHidden]);
  const serviceRows = useMemo(() => pricedServiceRows(pricingSettings), [pricingSettings]);
  // Services left out of this page's analysis (see the header).
  const excludedRaw = settings?.[PROSPECTING_EXCLUDED_KEY];
  const excluded = useMemo(() => excludedServiceSet({ [PROSPECTING_EXCLUDED_KEY]: excludedRaw }), [excludedRaw]);
  const analysisRows = useMemo(() => withoutExcludedServices(serviceRows, excluded), [serviceRows, excluded]);
  const dealCtx = useMemo(() => ({
    serviceRows: analysisRows,
    pricing: getServicePricing(pricingSettings),
    bases: resolvePricingBases(pricingSettings),
    overrides: pricingSettings.serviceOverrides || null,
  }), [analysisRows, pricingSettings]);
  // The HubSpot contacts, for the decision makers. Read from the shared
  // cache and re-read when a sync lands, so tagging someone Decision Maker
  // fills their row without a reload. Keyed on the uid: the cache is
  // scoped per user, and a read before auth resolves comes back empty.
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [uid]);
  const localFields = settings?.contactLocalFields || null;
  const contactLinks = settings?.companyContactLinks || null;
  const contactExclusions = settings?.companyContactExclusions || null;
  const dmLookup = useMemo(
    () => (contacts ? makeDecisionMakerLookup(contacts, { localFields, links: contactLinks, exclusions: contactExclusions }) : null),
    [contacts, localFields, contactLinks, contactExclusions],
  );

  const dealById = useMemo(() => {
    const m = new Map();
    for (const p of tracked) m.set(p.id, cachedDeal(p, dealCtx, oppRecords));
    return m;
  }, [tracked, dealCtx, oppRecords]);

  const serviceOverrides = settings?.serviceOverrides || null;
  const rows = useMemo(() => baseRows.map(r => {
    const deal = r.prospect?.id ? (dealById.get(r.prospect.id) || null) : null;
    // Null while the contacts load, so the cell can say so rather than
    // claim nobody is there. A PC with no record matches on its name.
    const dmsAll = dmLookup ? dmLookup.forAccount(r.prospect || { company: r.company }) : null;
    // The contact tags of the service the biggest deal is for: the
    // decision makers shown are the ones that service is sold to.
    const dmTags = deal?.name ? parseServiceContactTags(getEffectiveServiceMetadata(deal.name, serviceOverrides).contactTags) : [];
    return {
      ...r,
      analysis: r.prospect?.id ? (savedAnalyses.get(r.prospect.id) || null) : null,
      deal,
      dmsAll,
      dmTags,
      dms: dmsAll ? decisionMakersWithTags(dmsAll, dmTags) : null,
    };
  }), [baseRows, savedAnalyses, dealById, dmLookup, serviceOverrides]);

  // Rows whose biggest deal already has a status are left out (see the
  // header). Counted so the page can say how many.
  const unworked = useMemo(() => rows.filter(r => !dealHasStatus(r.deal)), [rows]);
  const hiddenWorked = rows.length - unworked.length;

  // Prospects only: company Types to leave off the list (PE firms, say).
  // Saved to settings so the choice sticks across visits and devices;
  // held locally too so a page with no updateSettings still filters.
  const isPcsList = mode === 'pcs';
  const savedHiddenTypes = settings?.prospectingHiddenTypes;
  const [hiddenTypes, setHiddenTypesLocal] = useState(() => (Array.isArray(savedHiddenTypes) ? savedHiddenTypes : []));
  useEffect(() => {
    if (Array.isArray(savedHiddenTypes)) setHiddenTypesLocal(savedHiddenTypes);
  }, [savedHiddenTypes]);
  const setHiddenTypes = (next) => {
    setHiddenTypesLocal(next);
    if (typeof updateSettings === 'function') updateSettings({ prospectingHiddenTypes: next });
  };
  const typeOptions = useMemo(() => (isPcsList ? [] : typesOnRows(unworked)), [isPcsList, unworked]);
  const typed = useMemo(() => (isPcsList ? unworked : withoutTypes(unworked, hiddenTypes)), [isPcsList, unworked, hiddenTypes]);
  const hiddenByType = unworked.length - typed.length;

  const [query, setQuery] = useState('');
  // The search box narrows the rows before the table sees them; the
  // table's own column filters narrow them again, and it reports back
  // what is left so the totals add up what is on screen.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? typed.filter(r => r.company.toLowerCase().includes(q)
        || r.peFirms.some(f => f.toLowerCase().includes(q))
        || r.status.toLowerCase().includes(q))
      : typed;
  }, [typed, query]);
  // Null until the table first reports, which it does on every change of
  // rows or filters.
  const [onScreen, setOnScreen] = useState(null);
  const shown = onScreen || searched;
  const totals = useMemo(() => {
    const t = sumFigures(shown);
    t.dealLow = 0; t.dealHigh = 0; t.analyses = 0;
    for (const r of shown) {
      if (r.deal) { t.dealLow += r.deal.fee; t.dealHigh += r.deal.feeHigh; }
      if (r.analysis) t.analyses += 1;
    }
    return t;
  }, [shown]);

  const isPcs = mode === 'pcs';
  const loading = prospects == null;
  const intro = isPcs
    ? 'Every portfolio company mapped on a PE firm Portfolio Companies table, once each, except Old Client, Lost - Not Sold and Hold Off.'
    : `Every company in the tracker with ${cdmName || 'you'} as its CDM, except Old Client, Lost - Not Sold and Hold Off.`;

  // Writes the one field the card's Services Explored grid writes. The
  // record comes back replaced, so its deal is re-priced on the next render.
  const setDealStatus = useMemo(() => (typeof updateProspect === 'function'
    ? (prospect, name, status) => {
      if (!prospect?.id || !name) return;
      updateProspect(prospect.id, { servicesExplored: withServiceStatus(prospect.servicesExplored, [name], status) });
    }
    : null), [updateProspect]);

  // Bulk status. `picked` holds row keys; a row only counts while it is
  // still listed and has a service and a record to write to, so rows that
  // leave the list once they carry a status drop out of the pick on their
  // own.
  const [picked, setPicked] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkUndo, setBulkUndo] = useState(null);
  useEffect(() => { setPicked(new Set()); setBulkUndo(null); }, [mode]);
  const pickable = useCallback((r) => !!(setDealStatus && r?.prospect?.id && r?.deal?.name), [setDealStatus]);
  const togglePick = useCallback((key) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const pickedRows = useMemo(() => searched.filter(r => picked.has(r.key) && pickable(r)), [searched, picked, pickable]);
  const pickableOnScreen = useMemo(() => shown.filter(pickable), [shown, pickable]);
  const allOnScreenPicked = pickableOnScreen.length > 0 && pickableOnScreen.every(r => picked.has(r.key));
  const toggleAllOnScreen = () => setPicked((prev) => {
    const next = new Set(prev);
    if (allOnScreenPicked) for (const r of pickableOnScreen) next.delete(r.key);
    else for (const r of pickableOnScreen) next.add(r.key);
    return next;
  });
  const bulkPlan = useMemo(() => planProspectingBulkStatus(pickedRows, bulkStatus), [pickedRows, bulkStatus]);
  // One write per company, all at once, the way Deal Sizing's bulk bar does
  // it. Undo puts each Services Explored map back exactly as it was.
  const applyBulkStatus = async () => {
    if (!bulkPlan.change.length || typeof updateProspect !== 'function') return;
    const entries = bulkPlan.change;
    const before = entries.map(e => [e.client.id, { ...(e.client.servicesExplored || {}) }]);
    setBulkBusy(true);
    try {
      await Promise.all(entries.map(e => updateProspect(e.client.id, { servicesExplored: e.servicesExplored })));
    } finally {
      setBulkBusy(false);
    }
    setPicked(new Set());
    setBulkUndo({
      before,
      message: `Set ${bulkStatus} on ${entries.length} ${entries.length === 1 ? 'company' : 'companies'}. ${entries.length === 1 ? 'It leaves' : 'They leave'} this list now that ${entries.length === 1 ? 'its service has' : 'their services have'} a status.`,
    });
  };
  const undoBulkStatus = async () => {
    if (!bulkUndo || typeof updateProspect !== 'function') return;
    setBulkBusy(true);
    try {
      await Promise.all(bulkUndo.before.map(([id, map]) => updateProspect(id, { servicesExplored: map })));
    } finally {
      setBulkBusy(false);
    }
    setBulkUndo(null);
  };

  const columns = useMemo(() => {
    const num = (key, fromKey) => ({
      render: r => <div style={{ textAlign: 'left', width: '100%' }}><Figure value={r[key]} from={r[fromKey]} /></div>,
      getSortValue: r => r[key] ?? null,
      getFilterValue: r => (r[key] == null ? '' : Math.round(r[key]).toLocaleString()),
      exportValue: r => (r[key] == null ? '' : Math.round(r[key])),
    });
    return [
      {
        key: 'company', label: 'Company', defaultWidth: 230,
        getSortValue: r => r.company.toLowerCase(),
        getFilterValue: r => r.company,
        exportValue: r => r.company,
        render: r => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {setDealStatus && (
              <input
                type="checkbox"
                checked={picked.has(r.key) && pickable(r)}
                disabled={!pickable(r)}
                onClick={e => e.stopPropagation()}
                onChange={() => togglePick(r.key)}
                aria-label={`Pick ${r.company} for a bulk status`}
                title={pickable(r) ? 'Pick for a bulk status' : (r.prospect ? 'No open service to set a status on' : 'Not in the tracker yet')}
                style={{ margin: 0, flexShrink: 0, cursor: pickable(r) ? 'pointer' : 'default' }}
              />
            )}
            {r.prospect && onSelectProspect ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectProspect(r.prospect); }}
            title={`Open ${r.company}`}
            style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#0A66C2', cursor: 'pointer', textAlign: 'left' }}
          >{r.company}</button>
        ) : (
          <span style={{ fontWeight: 600 }} title={isPcs ? 'Not in the tracker yet' : undefined}>{r.company}</span>
            )}
          </span>
        ),
      },
      {
        key: 'status', label: 'Status', defaultWidth: 110,
        getSortValue: r => (r.status ? r.status.toLowerCase() : null),
        getFilterValue: r => r.status || '',
        exportValue: r => r.status || '',
        render: (r) => {
          if (!r.status) return <span style={{ color: '#CBD5E1' }}>-</span>;
          const color = STATUS_COLORS[r.status] || '#64748B';
          return <span style={{ fontSize: '0.68rem', fontWeight: 700, color, background: `${color}1A`, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.status}</span>;
        },
      },
      ...(!isPcs ? [{
        key: 'type', label: 'Type', defaultWidth: 140,
        getSortValue: r => (r.type ? r.type.toLowerCase() : null),
        getFilterValue: r => r.type || '',
        exportValue: r => r.type || '',
        render: r => (r.type ? <span style={{ color: '#475569' }}>{r.type}</span> : <span style={{ color: '#CBD5E1' }}>-</span>),
      }] : []),
      ...(isPcs ? [{
        key: 'peFirms', label: 'PE Firm', defaultWidth: 170,
        getSortValue: r => (r.peFirms[0] ? r.peFirms[0].toLowerCase() : null),
        getFilterValue: r => r.peFirms.join(', '),
        exportValue: r => r.peFirms.join(', '),
        render: r => (
          <span style={{ color: '#475569' }} title={r.peFirms.join('\n')}>
            {r.peFirms.length === 0 ? '-' : r.peFirms.length === 1 ? r.peFirms[0] : `${r.peFirms[0]} +${r.peFirms.length - 1}`}
          </span>
        ),
      }] : []),
      {
        key: 'dms', label: 'Decision Makers', defaultWidth: 190,
        headerTitle: 'Contacts at the company tagged Decision Maker in HubSpot who also carry one of the Biggest Deal service\'s contact tags (set in the Services popup), so the people that deal is sold to. A service with no contact tags shows every decision maker. Hide, Left and Schneider contacts are left out, and contacts are matched the way the ladder maps decision makers: by company name, plus anyone the company popup links by email domain or by hand.',
        getSortValue: r => (r.dms ? r.dms.length : null),
        getFilterValue: r => (r.dms ? r.dms.map(dmLabel).join(', ') : ''),
        exportValue: r => (r.dms ? r.dms.map(dmLabel).join(', ') : ''),
        render: (r) => {
          if (!r.dms) return <span title="Loading contacts" style={{ color: '#CBD5E1' }}>…</span>;
          const tagNote = r.dmTags.length ? `Decision Maker and ${r.dmTags.join(' or ')}, for ${r.deal.name}` : '';
          if (r.dms.length === 0) {
            const why = !r.dmTags.length || r.dmsAll.length === 0
              ? 'Nobody at this company is tagged Decision Maker'
              : `Nobody at this company is tagged ${tagNote}. ${r.dmsAll.length} other decision ${r.dmsAll.length === 1 ? 'maker' : 'makers'}: ${r.dmsAll.map(dmLabel).join(', ')}`;
            return <span title={why} style={{ color: '#CBD5E1' }}>-</span>;
          }
          const tip = [
            tagNote ? `Tagged ${tagNote}:` : '',
            ...r.dms.map(c => [dmLabel(c), c.jobtitle].filter(Boolean).join(' - ')),
          ].filter(Boolean).join('\n');
          return (
            <span title={tip} style={{ color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              {dmLabel(r.dms[0])}
              {r.dms.length > 1 && <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}> +{r.dms.length - 1}</span>}
            </span>
          );
        },
      },
      { key: 'sites', label: 'Sites', defaultWidth: 80, headerTitle: 'Number of sites: from the company record, else counted off its saved site list.', ...num('sites', 'sitesFrom') },
      { key: 'accounts', label: 'Accounts', defaultWidth: 100, headerTitle: 'Number of utility accounts, written onto the company by its Master Analysis save.', ...num('accounts', 'accountsFrom') },
      { key: 'energyMwh', label: 'Total Energy (MWh)', defaultWidth: 160, headerTitle: 'Electric + gas use per year in MWh, written onto the company by its Master Analysis save.', ...num('energyMwh', 'energyFrom') },
      {
        key: 'analysis', label: 'Master Analysis', defaultWidth: 140,
        headerTitle: 'Whether a Master Analysis is saved against the company from the Utility Lookup page, and when.',
        getSortValue: r => (r.analysis ? (Date.parse(r.analysis.savedAt) || 1) : null),
        getFilterValue: r => (r.analysis ? formatAnalysisDate(r.analysis.savedAt) : ''),
        exportValue: r => (r.analysis ? formatAnalysisDate(r.analysis.savedAt) : ''),
        render: r => (r.analysis ? (
          <span
            title={[
              `Master Analysis saved${r.analysis.savedAt ? ` ${new Date(r.analysis.savedAt).toLocaleString()}` : ''}.`,
              r.analysis.fileName || '',
            ].filter(Boolean).join('\n')}
            style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}
          >✓ {formatAnalysisDate(r.analysis.savedAt)}</span>
        ) : (
          <span title={r.prospect ? 'No Master Analysis saved yet' : 'Not in the tracker yet'} style={{ color: '#CBD5E1' }}>-</span>
        )),
      },
      {
        key: 'deal', label: 'Biggest Deal', defaultWidth: 190,
        headerTitle: 'The biggest service still open on the company, first-year fee, priced off its Sites, Accounts and other Scale figures through the Services Pricing rate card. The same figure as Biggest Deal on the company card.',
        // Ranked by the top of the range: the most this company could be
        // worth, which is what the list is opened to find.
        getSortValue: r => (r.deal ? r.deal.feeHigh : null),
        getFilterValue: r => (r.deal ? formatMoneyRange(r.deal.fee, r.deal.feeHigh) : ''),
        exportValue: r => (r.deal ? formatMoneyRange(r.deal.fee, r.deal.feeHigh) : ''),
        render: r => (
          <div style={{ textAlign: 'left', width: '100%', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {r.deal
              ? formatMoneyRange(r.deal.fee, r.deal.feeHigh)
              : <span title={r.prospect ? 'Nothing still open on this company can be priced' : 'Not in the tracker yet'} style={{ color: '#CBD5E1' }}>-</span>}
          </div>
        ),
      },
      {
        key: 'dealService', label: 'Biggest Deal Service', defaultWidth: 200,
        headerTitle: 'The service that biggest deal is for, plus any services its Auto-add cell sells with it.',
        getSortValue: r => (r.deal?.name ? r.deal.name.toLowerCase() : null),
        getFilterValue: r => r.deal?.name || '',
        exportValue: r => (r.deal ? [r.deal.name, ...r.deal.adds].join(', ') : ''),
        render: r => (r.deal ? (
          <span style={{ color: '#475569' }} title={r.deal.adds.length ? `Sold with ${r.deal.adds.join(', ')}` : undefined}>
            {r.deal.name}
            {r.deal.adds.length > 0 && <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}> +{r.deal.adds.length} with it</span>}
          </span>
        ) : <span style={{ color: '#CBD5E1' }}>-</span>),
      },
      {
        key: 'dealStatus', label: 'Service Status', defaultWidth: 130,
        headerTitle: 'Where the Biggest Deal Service stands on this company: the status on the company card, else what a matching opportunity says. Pick one to set it on the card. Not Sold and N/A are answers, so the service leaves the row and the next biggest open service takes its place.',
        getSortValue: r => (r.deal ? (r.deal.status || '').toLowerCase() : null),
        getFilterValue: r => r.deal?.status || '',
        exportValue: r => r.deal?.status || '',
        render: r => (r.deal ? (
          <DealStatusSelect
            deal={r.deal}
            disabled={!setDealStatus || !r.prospect?.id}
            onPick={status => setDealStatus(r.prospect, r.deal.name, status)}
          />
        ) : <span style={{ color: '#CBD5E1' }}>-</span>),
      },
    ];
  }, [isPcs, onSelectProspect, setDealStatus, picked, pickable, togglePick]);

  // DataTable keys its rows on `id`.
  const tableRows = useMemo(() => searched.map(r => ({ ...r, id: r.key })), [searched]);
  const tableId = isPcs ? 'prospecting-pcs' : 'prospecting-prospects';

  const totalCell = { fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#1E293B' };

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 320px' }}>
          {intro} Sites, accounts and energy come from each company Master Analysis save, Biggest Deal is the same figure as on the company card, and Decision Makers lists who is tagged Decision Maker there and also carries a contact tag of the Biggest Deal service (hover for titles). Service Status is that service's status on the company card: only services with no status yet are listed, so picking one here takes the row off the list{hiddenWorked > 0 ? ` (${hiddenWorked.toLocaleString()} ${hiddenWorked === 1 ? 'company is' : 'companies are'} hidden now for having one)` : ''}. Grey italic figures are stand-ins until one is saved: hover them for where they came from. Drag a header edge to resize a column, type under a header to filter it, and star your standard columns in the Columns menu.
        </div>
        <ExcludedServicesPicker
          names={serviceRows.map(r => r.name)}
          excluded={excluded}
          onChange={typeof updateSettings === 'function'
            ? (next) => updateSettings({ [PROSPECTING_EXCLUDED_KEY]: [...next].sort((a, b) => a.localeCompare(b)) })
            : null}
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={isPcs ? 'Search companies or PE firms' : 'Search companies'}
          style={{ padding: '0.35rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit', width: 240 }}
        />
        {!isPcs && typeOptions.length > 0 && (
          <details style={{ position: 'relative' }}>
            <summary
              title="Leave companies of these Types off the list - PE firms, for example. Your choice is saved."
              style={{
                listStyle: 'none', cursor: 'pointer', padding: '0.35rem 0.6rem', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600,
                border: `1px solid ${hiddenTypes.length ? '#F59E0B' : '#CBD5E1'}`,
                background: hiddenTypes.length ? '#FFFBEB' : '#fff',
                color: hiddenTypes.length ? '#92400E' : '#475569',
                whiteSpace: 'nowrap',
              }}
            >
              {hiddenTypes.length ? `Hiding ${hiddenTypes.length} type${hiddenTypes.length === 1 ? '' : 's'} (${hiddenByType.toLocaleString()})` : 'Hide types'} ▾
            </summary>
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 1000, minWidth: 220, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', padding: '0.4rem 0' }}>
              <div style={{ padding: '0.2rem 0.75rem 0.4rem', fontSize: '0.66rem', color: '#64748B' }}>Tick a type to hide it</div>
              {typeOptions.map(t => {
                const count = unworked.filter(r => rowTypeLabel(r) === t).length;
                const on = hiddenTypes.includes(t);
                return (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0.75rem', fontSize: '0.74rem', color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setHiddenTypes(on ? hiddenTypes.filter(x => x !== t) : [...hiddenTypes, t])}
                    />
                    <span style={{ flex: 1 }}>{t}</span>
                    <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString()}</span>
                  </label>
                );
              })}
              {hiddenTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenTypes([])}
                  style={{ margin: '0.3rem 0.75rem 0', border: 'none', background: 'none', padding: 0, fontSize: '0.7rem', color: '#0A66C2', cursor: 'pointer' }}
                >Show all types</button>
              )}
            </div>
          </details>
        )}
      </div>
      {setDealStatus && !loading && rows.length > 0 && (
        <div
          data-bulk-status-bar
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.75rem', padding: '0.45rem 0.75rem', marginBottom: '0.6rem', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC', fontSize: '0.74rem', color: '#475569' }}
        >
          <span style={{ fontWeight: 700, color: '#1E293B' }}>Bulk status</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: pickableOnScreen.length ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={allOnScreenPicked} disabled={!pickableOnScreen.length} onChange={toggleAllOnScreen} style={{ margin: 0 }} />
            Pick all {pickableOnScreen.length.toLocaleString()} on screen
          </label>
          <span style={{ fontWeight: 600, color: pickedRows.length ? '#1D4ED8' : '#94A3B8' }}>
            {pickedRows.length.toLocaleString()} picked
          </span>
          <span>Set</span>
          <select
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
            aria-label="Status to set"
            style={{ fontSize: '0.72rem', fontFamily: 'inherit', padding: '2px 4px', borderRadius: 4, border: '1px solid #CBD5E1', fontWeight: 600, ...(bulkStatus ? { background: serviceStatusColor(bulkStatus).bg || '#fff', color: serviceStatusColor(bulkStatus).color || '#475569' } : {}) }}
          >
            <option value="">Pick a status</option>
            {SERVICE_STATUSES.filter(st => st !== '-').map(st => <option key={st} value={st}>{st}</option>)}
          </select>
          <span>on each one&apos;s Biggest Deal Service</span>
          <button
            type="button"
            onClick={applyBulkStatus}
            disabled={bulkBusy || !bulkStatus || !bulkPlan.change.length}
            title={!pickedRows.length ? 'Tick companies first, or pick all on screen' : !bulkStatus ? 'Pick a status first' : !bulkPlan.change.length ? 'Every picked company already has that status' : undefined}
            style={{ padding: '3px 10px', borderRadius: 6, border: 'none', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: bulkBusy || !bulkStatus || !bulkPlan.change.length ? '#CBD5E1' : '#0A66C2', color: '#fff', cursor: bulkBusy || !bulkStatus || !bulkPlan.change.length ? 'default' : 'pointer' }}
          >{bulkBusy ? 'Saving...' : `Apply to ${bulkPlan.change.length.toLocaleString()} ${bulkPlan.change.length === 1 ? 'company' : 'companies'}`}</button>
          {pickedRows.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontFamily: 'inherit', fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}
            >Clear picks</button>
          )}
          {pickedRows.length > 0 && bulkStatus && (
            <span
              style={{ flexBasis: '100%', fontSize: '0.7rem', color: '#64748B' }}
              title={bulkPlan.services.join('\n')}
            >
              Sets {bulkStatus} on {bulkPlan.services.length === 1 ? bulkPlan.services[0] : `${bulkPlan.services.length} different services (hover to list them)`} across {bulkPlan.companies.toLocaleString()} {bulkPlan.companies === 1 ? 'company' : 'companies'}
              {bulkPlan.same.length > 0 ? `, ${bulkPlan.same.length.toLocaleString()} already ${bulkStatus} and left alone` : ''}. Each company leaves this list once its service has a status.
            </span>
          )}
          {bulkUndo && (
            <span style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem', color: '#166534' }}>
              {bulkUndo.message}
              <button
                type="button"
                onClick={undoBulkStatus}
                disabled={bulkBusy}
                style={{ padding: '1px 8px', borderRadius: 6, border: '1px solid #86EFAC', background: '#F0FDF4', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 700, color: '#166534', cursor: 'pointer' }}
              >Undo</button>
            </span>
          )}
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '1rem 0' }}>Loading companies…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          {isPcs
            ? 'No portfolio companies are mapped yet. Add them on a PE firm popup, under Portfolio.'
            : `No companies in the tracker list ${cdmName || 'you'} as their CDM.`}
        </div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: setDealStatus ? 'calc(100vh - 280px)' : 'calc(100vh - 230px)', minHeight: 320 }}>
          <DataTable
            key={tableId}
            tableId={tableId}
            exportFileName={isPcs ? 'Prospecting PCs' : 'Prospecting Prospects'}
            columns={columns}
            rows={tableRows}
            defaultSort={{ key: 'deal', direction: 'desc' }}
            fitWidth
            alwaysVisible={['company']}
            enableColumnFilters
            onFilteredRowsChange={setOnScreen}
            emptyMessage="No companies match these filters"
            settings={settings}
            updateSettings={updateSettings}
          />
          <div
            title="Sums every figure on screen, grey stand-ins included."
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem', padding: '0.5rem 0.75rem', fontSize: '0.76rem', color: '#64748B', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}
          >
            <span style={totalCell}>Total ({totals.count.toLocaleString()} {totals.count === 1 ? 'company' : 'companies'})</span>
            <span>Sites <span style={totalCell}>{totals.sites > 0 ? Math.round(totals.sites).toLocaleString() : '-'}</span></span>
            <span>Accounts <span style={totalCell}>{totals.accounts > 0 ? Math.round(totals.accounts).toLocaleString() : '-'}</span></span>
            <span>Energy <span style={totalCell}>{totals.energyMwh > 0 ? `${Math.round(totals.energyMwh).toLocaleString()} MWh` : '-'}</span></span>
            <span>Master Analysis <span style={totalCell}>{totals.analyses.toLocaleString()} saved</span></span>
            <span>Biggest Deal <span style={totalCell}>{totals.dealHigh > 0 ? formatMoneyRange(totals.dealLow, totals.dealHigh) : '-'}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
