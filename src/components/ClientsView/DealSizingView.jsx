// Deal Sizing — what each existing client would be worth, service by service.
//
// The rate card and the estimator have both existed for a while on
// Dropdowns › Services Pricing, and between them they answer "what would this
// scope cost someone". They answer it once, for a hypothetical account you
// type counts into. The question a CDM actually works from is the other way
// round: given the book of clients I already have, which ones are worth what,
// and for which services?
//
// So this is the same estimator run per client, with the client's own numbers
// filled in. Ticking a service against Prologis prices it against Prologis's
// 6,176 sites without anyone typing 6,176, because the company record already
// knows. That is the whole point of putting it here rather than leaving people
// to re-key an account into the standalone estimator one at a time.
//
// Three things it deliberately does NOT do:
//
//   • It does not price anything itself. Every figure comes from
//     estimateScope (src/utils/servicePricing.js) via clientDealSizing.js, so
//     a rate edited on the pricing page moves these numbers and there is no
//     second engine to keep in step.
//   • It does not touch the company record. A scope is a what-if — it is not
//     a Service Explored status, and writing one would put speculative work
//     into the field the rest of the app reads as history. Scopes live in
//     their own per-client map beside the Client Manager and Status the
//     Clients tab already stores.
//   • It does not claim to be a forecast. Nothing here knows whether the
//     client wants the service. It is a sizing exercise, and the header says
//     so, because a column of large numbers is very easy to start believing.
//
// The service picker is the same board Opps 2 uses for Scope, which means a
// service is ticked here with its status for that account already visible —
// you can see that Bill Pay is already Sold before you size it again.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { ScopeServicesModal } from '../OppsView2/ScopeServicesPicker';
import { parseMulti } from '../common/columnLinks';
import { matchesCdm } from '../../utils/cdmMatch';
import { normClientName } from '../../utils/clientIssues';
import { useClientFlagMaps } from '../../utils/rosterHooks';
import { pricedServiceRows } from '../../utils/serviceRows';
import {
  loadClientScopeMap, setClientScope, setClientScopes, CLIENT_SCOPE_EVENT,
} from '../../utils/clientManagerStore';
import { serviceStatusColor, serviceBucket } from '../../utils/serviceStatusColors';
import {
  CLIENT_COUNT_FIELDS,
  emptyClientScope,
  estimateClient,
  exploredStatus,
  missingCounts,
  needsDealSize,
  normalizeClientScope,
  planBulkAdd,
  planBulkRemove,
  rollUpDealSizing,
  scopeIsEmpty,
  scopeStatusCounts,
  withService,
  withoutService,
} from '../../utils/clientDealSizing';
import {
  feeBasisLabel,
  formatMoney,
  formatMoneyRange,
  getServicePricing,
  resolvePricingBases,
} from '../../utils/servicePricing';

const TABLE_ID = 'clients-deal-sizing';

// A money figure that may be a range, rendered as one cell. A blank scope
// shows a dash rather than $0: "nothing picked" and "picked, worth nothing"
// are different answers and a zero would flatten them into one.
function Money({ low, high, scoped, bold }) {
  if (!scoped) return <span style={{ color: '#CBD5E1' }}>—</span>;
  return (
    <span style={{ fontWeight: bold ? 700 : 600, color: low > 0 ? '#0F172A' : '#94A3B8', whiteSpace: 'nowrap' }}>
      {formatMoneyRange(low, high)}
    </span>
  );
}

// A number typed against one client — a unit count or the deal size.
// Commits on blur / Enter, cancels on Escape, and only writes when the value
// actually changed, so clicking in and back out can't blank a count.
function CountInput({ value, placeholder, onCommit, width = 96 }) {
  const [draft, setDraft] = useState(null);
  const shown = draft === null ? (value === null || value === undefined ? '' : String(value)) : draft;
  function commit() {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    const before = value === null || value === undefined ? '' : String(value);
    if (typed !== before) onCommit(typed);
  }
  return (
    <input
      value={shown}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      onClick={e => e.stopPropagation()}
      style={{
        width, padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 5,
        fontSize: '0.76rem', fontFamily: 'inherit',
      }}
    />
  );
}

// DataTable's own cells are styled `max-width: 0; overflow: hidden;
// text-overflow: ellipsis` and its direct children `display: inline-block`,
// which is right for the grid and wrong for anything rendered inside an
// expansion row: the panel shrinks to fit and every figure in it clips. The
// rules are a stylesheet, so an inline style beats them — these opt the panel
// and its own table cells back out. Same problem the Clients tab's contract
// table solves by sizing to max-content.
const panelReset = { display: 'block', width: '100%', maxWidth: '100%', whiteSpace: 'normal', overflow: 'visible' };
const cellReset = { maxWidth: 'none', overflow: 'visible', textOverflow: 'clip' };

// What the company card says about a service, as a chip. Same palette the
// card's own Services Explored grid and the Opps Scope picker use, so a
// service reads the same colour wherever it is shown.
function StatusPill({ status, title }) {
  if (!status) return null;
  const { bg, color } = serviceStatusColor(status);
  return (
    <span
      title={title}
      style={{
        display: 'inline-block', fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap',
        padding: '0.05rem 0.4rem', borderRadius: 999,
        background: bg || '#F1F5F9', color: color || '#475569',
      }}
    >{status}</span>
  );
}

const tile = {
  flex: '1 1 150px', minWidth: 140, background: '#fff', border: '1px solid #E2E8F0',
  borderRadius: 10, padding: '0.55rem 0.75rem',
};
const tileNum = { fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.15 };
const tileLabel = { fontSize: '0.68rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' };

export function DealSizingView({
  prospects = [], cdmName, settings, updateSettings, updateProspect, onSelectProspect,
}) {
  const [scopeMap, setScopeMap] = useState(() => loadClientScopeMap());
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [picking, setPicking] = useState(null); // the client whose board is open
  const [query, setQuery] = useState('');
  const [onlyScoped, setOnlyScoped] = useState(false);
  // The bulk bar: which service to put in front of the book, whether to leave
  // the clients who already buy it alone, and what the last bulk edit changed
  // so it can be put back.
  const [bulkService, setBulkService] = useState('');
  const [bulkSkipSold, setBulkSkipSold] = useState(true);
  const [bulkUndo, setBulkUndo] = useState(null);
  // A client the Clients tab ticks "Don't Track" isn't being worked at all,
  // so pricing one inflates the book with money nobody is going after. They
  // come out by default — the same call the rosters, the issues list and
  // service coverage already make — but the tick is a working decision that
  // gets taken back, so they stay one checkbox away rather than gone.
  const [showUntracked, setShowUntracked] = useState(false);

  // The map is written through the same mirrored store the Clients tab's
  // other per-client fields use, so a scope set in one window (or on another
  // device, once the mirror pulls) shows up here.
  useEffect(() => {
    const refresh = () => setScopeMap(loadClientScopeMap());
    window.addEventListener(CLIENT_SCOPE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CLIENT_SCOPE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // This user's clients. Scoped the same way the Clients subtab scopes them —
  // CDM matches and Status is Client — rather than taking that tab's filtered
  // list, so the "include old clients" toggle over there can't quietly change
  // what is being sized here.
  const allClients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => String(p?.status || '').trim().toLowerCase() === 'client')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, cdmName]);

  // "Don't Track" lives on the Clients tab, in its own map keyed by company
  // name — read here through the shared hook so a tick made on that tab (or
  // in another window) drops the client out of these totals without a reload.
  const { clientUntrackedMap } = useClientFlagMaps();
  const isUntracked = useCallback(
    (client) => !!clientUntrackedMap[normClientName(client?.company)],
    [clientUntrackedMap],
  );
  const untrackedCount = useMemo(
    () => allClients.filter(isUntracked).length,
    [allClients, isUntracked],
  );
  const clients = useMemo(
    () => (showUntracked ? allClients : allClients.filter(c => !isUntracked(c))),
    [allClients, showUntracked, isUntracked],
  );

  // All three key off `settings` as a whole rather than the handful of fields
  // they actually read. Narrowing the deps is what the pricing page does, but
  // it trips the React Compiler's memoization check here, and the work is a
  // map over ~150 catalog entries — cheap enough that recomputing it when an
  // unrelated setting changes costs less than the exception would.
  const bases = useMemo(() => resolvePricingBases(settings), [settings]);
  const pricing = useMemo(() => getServicePricing(settings), [settings]);
  // The catalog minus retired services: a hidden service is out of the Scope
  // picker everywhere else, so it cannot be in a deal here either.
  const serviceRows = useMemo(() => pricedServiceRows(settings), [settings]);
  const serviceNames = useMemo(() => serviceRows.map(r => r.name), [serviceRows]);
  // The same rows grouped by their board box, for the bulk picker's optgroups.
  // A flat list of 150-odd services is unpickable; grouped, it reads the way
  // the services board does everywhere else.
  const serviceBuckets = useMemo(() => {
    const byBucket = new Map();
    for (const row of serviceRows) {
      if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, []);
      byBucket.get(row.bucket).push(row.name);
    }
    return [...byBucket.entries()]
      .map(([name, services]) => ({ name, services }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [serviceRows]);

  const scopeFor = useCallback(
    (company) => normalizeClientScope(scopeMap[normClientName(company)]) || emptyClientScope(),
    [scopeMap],
  );

  // Write a client's scope through the store, and mirror it into local state
  // straight away rather than waiting for the event — the event fires, but a
  // round trip through storage between keystroke and render is a visible lag
  // on a table this size.
  const saveScope = useCallback((company, next) => {
    const key = normClientName(company);
    if (!key) return;
    const normalized = normalizeClientScope(next);
    const store = scopeIsEmpty(normalized) ? null : normalized;
    setClientScope(company, store);
    setScopeMap(prev => {
      const copy = { ...prev };
      if (store) copy[key] = store;
      else delete copy[key];
      return copy;
    });
  }, []);

  // Apply an edit to many clients as one write, and keep what was there
  // before so it can be undone. A bulk add touches every client on screen and
  // there is no way to eyeball forty rows to see what it did, so "undo" is
  // part of the feature rather than a nicety.
  const applyScopes = useCallback((entries, message) => {
    if (!entries.length) return;
    const previous = entries.map(([company]) => {
      const key = normClientName(company);
      const before = scopeMap[key];
      return [company, before ? normalizeClientScope(before) : null];
    });
    const stored = entries.map(([company, scope]) => {
      const normalized = normalizeClientScope(scope);
      return [company, scopeIsEmpty(normalized) ? null : normalized];
    });
    setClientScopes(stored);
    setScopeMap(prev => {
      const copy = { ...prev };
      for (const [company, scope] of stored) {
        const key = normClientName(company);
        if (!key) continue;
        if (scope) copy[key] = scope;
        else delete copy[key];
      }
      return copy;
    });
    setBulkUndo({ entries: previous, message });
  }, [scopeMap]);

  const undoBulk = useCallback(() => {
    if (!bulkUndo) return;
    setClientScopes(bulkUndo.entries);
    setScopeMap(prev => {
      const copy = { ...prev };
      for (const [company, scope] of bulkUndo.entries) {
        const key = normClientName(company);
        if (!key) continue;
        if (scope) copy[key] = scope;
        else delete copy[key];
      }
      return copy;
    });
    setBulkUndo(null);
  }, [bulkUndo]);

  const patchScope = useCallback((company, patch) => {
    const current = normalizeClientScope(scopeMap[normClientName(company)]);
    saveScope(company, { ...current, ...patch });
  }, [scopeMap, saveScope]);

  // Every client, priced. One pass — the table, the tiles and the expansion
  // all read the same estimate, so a figure can't disagree with itself.
  const rows = useMemo(() => clients.map(c => {
    const scope = scopeFor(c.company);
    const estimate = estimateClient({ client: c, scope, serviceRows, pricing, bases });
    return {
      id: c.id != null ? String(c.id) : `name:${normClientName(c.company)}`,
      company: c.company || '',
      client: c,
      untracked: isUntracked(c),
      scope,
      estimate,
      serviceCount: estimate.services.length,
      // What the company card already says about the services in this scope.
      // Sizing a client for work they demonstrably already buy is the quiet
      // way this page overstates a book, so the count is on the row rather
      // than one expand away.
      statusCounts: scopeStatusCounts(c, scope),
      year1: estimate.services.length ? estimate.year1Total : null,
      contractValue: estimate.services.length ? estimate.contractValue : null,
      recurringAnnual: estimate.services.length ? estimate.recurringAnnual : null,
      setup: estimate.services.length ? estimate.setup : null,
      needs: [
        ...missingCounts(estimate, bases).map(m => `No ${m.label.toLowerCase()} count`),
        ...(needsDealSize({ services: estimate.services, pricing, bases }) && !estimate.scope.dealSize
          ? ['No deal size'] : []),
        ...(estimate.unpriced.length ? [`${estimate.unpriced.length} unpriced`] : []),
        ...(estimate.missing.length ? [`${estimate.missing.length} not in catalog`] : []),
      ],
    };
  }), [clients, scopeFor, serviceRows, pricing, bases, isUntracked]);

  const visible = useMemo(() => {
    let list = rows;
    if (onlyScoped) list = list.filter(r => r.serviceCount > 0);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(r => (
        r.company.toLowerCase().includes(q)
        || r.scope.services.some(s => s.toLowerCase().includes(q))
      ));
    }
    return list;
  }, [rows, onlyScoped, query]);

  // Totals over what's on screen, so narrowing to one bucket of clients
  // re-totals to that bucket rather than always reporting the whole book.
  const totals = useMemo(() => rollUpDealSizing(visible.map(r => r.estimate)), [visible]);

  // What the bulk bar would do, worked out from the clients actually listed
  // below it. Recomputed as the pick changes so the button can say what it is
  // about to do rather than reporting it afterwards.
  const bulkPlan = useMemo(() => {
    if (!bulkService) return null;
    const clients2 = visible.map(r => r.client);
    const scopeOf = (c) => scopeFor(c.company);
    return {
      ...planBulkAdd({ clients: clients2, service: bulkService, scopeOf, skipSold: bulkSkipSold }),
      have: planBulkRemove({ clients: clients2, service: bulkService, scopeOf }),
    };
  }, [bulkService, bulkSkipSold, visible, scopeFor]);

  const addToAll = useCallback(() => {
    if (!bulkPlan?.add.length) return;
    applyScopes(
      bulkPlan.add.map(c => [c.company, withService(scopeFor(c.company), bulkService)]),
      `Added ${bulkService} to ${bulkPlan.add.length} client${bulkPlan.add.length === 1 ? '' : 's'}.`,
    );
  }, [bulkPlan, bulkService, scopeFor, applyScopes]);

  const removeFromAll = useCallback(() => {
    if (!bulkPlan?.have.length) return;
    applyScopes(
      bulkPlan.have.map(c => [c.company, withoutService(scopeFor(c.company), bulkService)]),
      `Removed ${bulkService} from ${bulkPlan.have.length} client${bulkPlan.have.length === 1 ? '' : 's'}.`,
    );
  }, [bulkPlan, bulkService, scopeFor, applyScopes]);

  const toggleRow = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo(() => [
    {
      key: 'expander', label: '', defaultWidth: 34,
      render: (row) => (
        <span style={{ color: '#94A3B8' }}>{expandedIds.has(row.id) ? '▾' : '▸'}</span>
      ),
    },
    {
      key: 'company', label: 'Company', defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelectProspect?.(row.client); }}
            disabled={!onSelectProspect}
            style={{
              background: 'none', border: 'none', padding: 0, textAlign: 'left',
              color: '#1D4ED8', fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit',
              textDecoration: 'underline', cursor: onSelectProspect ? 'pointer' : 'default',
            }}
          >{row.company || '-'}</button>
          {/* Only ever on screen when the Don't Track clients have been
              switched back on, so the row says why it is here and the
              totals above can be read as including it. */}
          {row.untracked && (
            <span
              title={"The Clients tab marks this client Don't Track. It is only listed because \u201cShow Don't Track clients\u201d is ticked, and its figures are in the totals above."}
              style={{
                fontSize: '0.66rem', fontWeight: 700, padding: '0.05rem 0.4rem', borderRadius: 999,
                background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', whiteSpace: 'nowrap',
              }}
            >Don&rsquo;t Track</span>
          )}
        </span>
      ),
    },
    {
      key: 'serviceCount', label: 'Services', defaultWidth: 190,
      getFilterValue: (row) => (row.serviceCount ? String(row.serviceCount) : 'None'),
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setPicking(row); }}
            title={row.scope.services.length
              ? `${row.scope.services.join('\n')}\n\nClick to change.`
              : 'Pick the services you would put in front of this client.'}
            style={{
              padding: '0.15rem 0.5rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.72rem', fontWeight: 700,
              border: `1px solid ${row.serviceCount ? '#BFDBFE' : '#CBD5E1'}`,
              background: row.serviceCount ? '#EFF6FF' : '#fff',
              color: row.serviceCount ? '#1E40AF' : '#64748B',
            }}
          >{row.serviceCount ? `${row.serviceCount} service${row.serviceCount === 1 ? '' : 's'}` : '+ Add services'}</button>
        </span>
      ),
    },
    {
      // What the estimate ran on, and where each figure came from. A count off
      // the company record reads differently from one typed for this deal,
      // because the first is the whole portfolio and the second is the scope.
      key: 'counts', label: 'Counts used', defaultWidth: 210,
      getFilterValue: (row) => Object.keys(row.estimate.counts).join(', '),
      render: (row) => {
        const entries = Object.entries(row.estimate.counts);
        if (!entries.length) return <span style={{ color: '#CBD5E1' }}>—</span>;
        return (
          <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {entries.map(([unit, n]) => {
              const typed = row.estimate.countSources[unit] === 'typed';
              const label = bases.find(b => b.unit === unit)?.unitLabel || unit;
              return (
                <span
                  key={unit}
                  title={typed
                    ? `${label}: typed for this client's scope.`
                    : `${label}: from the company record. Type a number in the expanded row to size a smaller rollout.`}
                  style={{
                    fontSize: '0.7rem', padding: '0.05rem 0.4rem', borderRadius: 999,
                    background: typed ? '#EFF6FF' : '#F1F5F9',
                    color: typed ? '#1E40AF' : '#475569',
                    border: `1px solid ${typed ? '#BFDBFE' : '#E2E8F0'}`,
                  }}
                >{n.toLocaleString()} {label.toLowerCase()}</span>
              );
            })}
          </span>
        );
      },
    },
    {
      // History against the what-if. A scope is a proposal; the company card
      // is the record of what has actually been sold, quoted or ruled out.
      // Shown side by side because a large number next to "3 sold" means
      // something very different from the same number next to nothing.
      key: 'explored', label: 'On the card', defaultWidth: 210,
      getSortValue: (row) => row.statusCounts.sold,
      getFilterValue: (row) => {
        if (!row.serviceCount) return '';
        const parts = [];
        if (row.statusCounts.sold) parts.push('Sold');
        if (row.statusCounts.inProgress) parts.push('In progress');
        if (row.statusCounts.notSold) parts.push('Not sold');
        return parts.length ? parts.join(', ') : 'Not explored';
      },
      exportValue: (row) => {
        if (!row.serviceCount) return '';
        const c = row.statusCounts;
        return [
          c.sold ? `${c.sold} sold` : '',
          c.inProgress ? `${c.inProgress} in progress` : '',
          c.notSold ? `${c.notSold} not sold` : '',
          c.none ? `${c.none} not explored` : '',
        ].filter(Boolean).join(', ');
      },
      render: (row) => {
        if (!row.serviceCount) return <span style={{ color: '#CBD5E1' }}>—</span>;
        const counts = row.statusCounts;
        const chips = [
          ['sold', counts.sold, 'already buy this — sizing it as new business counts revenue you already have'],
          ['inProgress', counts.inProgress, 'are already in flight for this client'],
          ['notSold', counts.notSold, 'have been put to this client and turned down'],
        ].filter(([, n]) => n > 0);
        if (!chips.length) {
          return <span style={{ fontSize: '0.7rem', color: '#94A3B8' }} title="None of the services in this scope has a status on the company card — all new ground.">Not explored</span>;
        }
        return (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {chips.map(([key, n, why]) => {
              const bucket = serviceBucket(key);
              return (
                <span
                  key={key}
                  title={`${n} of the ${row.serviceCount} service${row.serviceCount === 1 ? '' : 's'} in this scope ${why}. Expand the row to see which.`}
                  style={{
                    fontSize: '0.68rem', fontWeight: 700, padding: '0.05rem 0.4rem', borderRadius: 999,
                    whiteSpace: 'nowrap', background: bucket?.bg, color: bucket?.color,
                    border: '1px solid #E2E8F0',
                  }}
                >{n} {bucket?.label.toLowerCase()}</span>
              );
            })}
          </span>
        );
      },
    },
    {
      // Wide enough for a range on an eight-figure portfolio: these hold
      // "$12,345,678 – $16,543,210" once a service is quoted on two rates, and
      // a clipped figure is a wrong figure. Measured rather than guessed — the
      // cell loses ~20px to DataTable's own padding. A saved width still wins;
      // this is only the default.
      key: 'year1', label: 'Year 1', defaultWidth: 265,
      getSortValue: (row) => row.year1 ?? -1,
      exportValue: (row) => row.year1 ?? '',
      render: (row) => (
        <Money low={row.estimate.year1Total} high={row.estimate.year1TotalHigh} scoped={row.serviceCount > 0} bold />
      ),
    },
    {
      key: 'contractValue', label: 'Est. Deal Value', defaultWidth: 265,
      getSortValue: (row) => row.contractValue ?? -1,
      exportValue: (row) => row.contractValue ?? '',
      render: (row) => (
        <Money low={row.estimate.contractValue} high={row.estimate.contractValueHigh} scoped={row.serviceCount > 0} />
      ),
    },
    {
      key: 'recurringAnnual', label: 'Recurring / yr', defaultWidth: 240,
      getSortValue: (row) => row.recurringAnnual ?? -1,
      exportValue: (row) => row.recurringAnnual ?? '',
      render: (row) => (
        <Money low={row.estimate.recurringAnnual} high={row.estimate.recurringAnnualHigh} scoped={row.serviceCount > 0} />
      ),
    },
    {
      key: 'setup', label: 'Setup', defaultWidth: 130,
      getSortValue: (row) => row.setup ?? -1,
      exportValue: (row) => row.setup ?? '',
      render: (row) => (
        row.serviceCount && row.estimate.setup
          ? <span style={{ color: '#475569' }}>{formatMoney(row.estimate.setup)}</span>
          : <span style={{ color: '#CBD5E1' }}>—</span>
      ),
    },
    {
      // Why a row's figure is lower than it looks like it should be. Every one
      // of these is a number the estimate could not find, and saying so beats
      // quietly contributing zero.
      key: 'needs', label: 'Needs', defaultWidth: 230,
      getFilterValue: (row) => (row.needs.length ? row.needs.join(', ') : 'Nothing'),
      exportValue: (row) => row.needs.join(', '),
      render: (row) => (
        row.needs.length === 0
          ? <span style={{ color: '#CBD5E1' }}>—</span>
          : (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {row.needs.map(n => (
                <span
                  key={n}
                  title="Until this is filled in, the services that depend on it contribute nothing to the figures on the left. Expand the row to enter it."
                  style={{
                    fontSize: '0.68rem', fontWeight: 600, padding: '0.05rem 0.4rem', borderRadius: 999,
                    background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap',
                  }}
                >{n}</span>
              ))}
            </span>
          )
      ),
    },
  ], [expandedIds, onSelectProspect, bases]);

  const renderExpansion = useCallback((row) => {
    const { estimate, scope, client, company } = row;
    const missing = missingCounts(estimate, bases);
    const wantsDeal = needsDealSize({ services: estimate.services, pricing, bases });
    return (
      <div style={{ ...panelReset, padding: '0.75rem 1rem 1rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', boxSizing: 'border-box' }}>
        {estimate.services.length === 0 ? (
          <div style={{ display: 'block', whiteSpace: 'normal', fontSize: '0.8rem', color: '#64748B' }}>
            Nothing scoped for {company || 'this client'} yet.{' '}
            <button
              type="button"
              onClick={() => setPicking(row)}
              style={{ background: 'none', border: 'none', padding: 0, color: '#1D4ED8', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline' }}
            >Pick some services</button>{' '}
            and the estimate builds itself from this client&rsquo;s own counts.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {/* Every line, and how its fee was arrived at. A number that moves
                when a count changes has the reason for it on the row, which is
                what makes a total arguable rather than magic. */}
            <div style={{ flex: '2 1 0', minWidth: 0, overflowX: 'auto' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                Services in scope ({estimate.services.length})
              </div>
              <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ color: '#64748B', textAlign: 'left' }}>
                    <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem 0', minWidth: 220 }}>Service</th>
                    <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 110 }} title="Overrides the count this service would otherwise price against — for a rollout that covers part of the portfolio.">Units</th>
                    <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 190, textAlign: 'right' }}>Year 1 fee</th>
                    <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0 0.35rem', minWidth: 190, textAlign: 'right' }}>Deal value</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.lines.map(line => (
                    <tr key={line.name} style={{ borderTop: '1px solid #E2E8F0' }}>
                      <td style={{ ...cellReset, padding: '0.35rem 0.4rem 0.35rem 0', verticalAlign: 'top' }}>
                        <div style={{ display: 'block', fontWeight: 600, color: '#0F172A', whiteSpace: 'normal' }}>
                          {line.name}{' '}
                          <StatusPill
                            status={exploredStatus(client, line.name)}
                            title={`The company card says this service is "${exploredStatus(client, line.name)}" for ${company}. That is history, not part of this estimate — but a service they already buy is not new business.`}
                          />
                        </div>
                        <div style={{ display: 'block', fontSize: '0.7rem', whiteSpace: 'normal', color: line.priced ? '#64748B' : '#B45309' }}>
                          {line.priced ? (line.note || feeBasisLabel(line, bases)) : (line.note || 'No rate set')}
                          {line.priced && line.recurring ? ` · ${line.years} yr${line.years === 1 ? '' : 's'}` : ''}
                        </div>
                      </td>
                      <td style={{ ...cellReset, padding: '0.35rem 0.4rem', verticalAlign: 'top' }}>
                        {line.unit ? (
                          <CountInput
                            width={92}
                            value={scope.serviceUnits[line.name] ?? ''}
                            placeholder={estimate.counts[line.unit] != null ? String(estimate.counts[line.unit]) : '—'}
                            onCommit={(typed) => {
                              const next = { ...scope.serviceUnits };
                              if (typed === '') delete next[line.name];
                              else next[line.name] = typed;
                              patchScope(company, { serviceUnits: next });
                            }}
                          />
                        ) : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>
                      <td style={{ ...cellReset, padding: '0.35rem 0.4rem', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {line.priced ? formatMoneyRange(line.fee, line.feeHigh) : <span style={{ color: '#CBD5E1' }}>—</span>}
                        {line.setup > 0 && (
                          <div style={{ display: 'block', fontSize: '0.7rem', color: '#64748B' }} title="Setup fee, billed once. Included in Year 1 and in the deal value, never multiplied by the term.">
                            + {formatMoney(line.setup)} setup
                          </div>
                        )}
                      </td>
                      <td style={{ ...cellReset, padding: '0.35rem 0 0.35rem 0.4rem', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {line.priced ? formatMoneyRange(line.value, line.valueHigh) : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setPicking(row)}
                  style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#1E293B', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Change services</button>
                <button
                  type="button"
                  onClick={() => saveScope(company, emptyClientScope())}
                  style={{ padding: '0.3rem 0.7rem', border: '1px solid #FECACA', borderRadius: 6, background: '#fff', color: '#B91C1C', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Clear this client</button>
              </div>
            </div>

            <div style={{ flex: '1 1 0', minWidth: 240, maxWidth: 460, whiteSpace: 'normal' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                Counts
              </div>
              {/* One box per unit the scope actually prices against — the
                  estimate reports which units its lines consulted, so ticking
                  a per-meter service is what makes a Meters box appear. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.9rem' }}>
                {[...estimate.unitsUsed].map(unit => {
                  const basis = bases.find(b => b.unit === unit);
                  const label = basis?.unitLabel || unit;
                  const fromRecord = CLIENT_COUNT_FIELDS.find(f => f.unit === unit);
                  const recordValue = fromRecord ? client?.[fromRecord.field] : null;
                  return (
                    <label key={unit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', color: '#475569' }}>
                      <span style={{ flex: '0 0 96px' }}>{label}</span>
                      <CountInput
                        value={scope.counts[unit] ?? ''}
                        placeholder={recordValue ? String(recordValue) : '—'}
                        onCommit={(typed) => {
                          const next = { ...scope.counts };
                          if (typed === '') delete next[unit];
                          else next[unit] = typed;
                          patchScope(company, { counts: next });
                        }}
                      />
                      {scope.counts[unit] === undefined && recordValue ? (
                        <span style={{ fontSize: '0.68rem', color: '#94A3B8' }} title="From the company record. Type a number to size a smaller rollout without touching the record.">from record</span>
                      ) : null}
                    </label>
                  );
                })}
                {estimate.unitsUsed.size === 0 && (
                  <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>No per-unit service in scope.</div>
                )}
              </div>

              {wantsDeal && (
                <>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                    Deal size
                  </div>
                  <div style={{ marginBottom: '0.9rem' }}>
                    <CountInput
                      width={140}
                      value={scope.dealSize}
                      placeholder="e.g. 500000"
                      onCommit={(typed) => patchScope(company, { dealSize: typed })}
                    />
                    <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: 2 }}>
                      What a percentage-based service takes its cut of.
                    </div>
                  </div>
                </>
              )}

              {missing.length > 0 && (
                <div style={{ display: 'block', whiteSpace: 'normal', fontSize: '0.72rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.4rem 0.55rem', marginBottom: '0.6rem' }}>
                  Waiting on {missing.map(m => m.label.toLowerCase()).join(', ')}. Services priced on {missing.length === 1 ? 'it' : 'them'} contribute nothing until there is a number.
                </div>
              )}
              {estimate.unpriced.length > 0 && (
                <div style={{ display: 'block', whiteSpace: 'normal', fontSize: '0.72rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.4rem 0.55rem', marginBottom: '0.6rem' }}>
                  No rate set for {estimate.unpriced.join(', ')}. Price {estimate.unpriced.length === 1 ? 'it' : 'them'} on <strong>Dropdowns › Services Pricing</strong> and this total picks it up.
                </div>
              )}
              {estimate.missing.length > 0 && (
                <div style={{ display: 'block', whiteSpace: 'normal', fontSize: '0.72rem', color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '0.4rem 0.55rem' }}>
                  {estimate.missing.join(', ')} {estimate.missing.length === 1 ? 'is' : 'are'} no longer in the service catalog — renamed or retired since this scope was set. Re-pick to replace {estimate.missing.length === 1 ? 'it' : 'them'}.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }, [bases, pricing, patchScope, saveScope]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '0.9rem 1.25rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1E293B' }}>Deal Sizing</h2>
        <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
          What each of your clients would be worth if you sold them a set of services.
        </span>
      </div>
      <div style={{ fontSize: '0.74rem', color: '#64748B', margin: '0.35rem 0 0.75rem', maxWidth: 900, lineHeight: 1.5 }}>
        Pick services against a client and the estimate builds itself from that client&rsquo;s own Sites and Accounts —
        no re-keying. Rates come from <strong>Dropdowns › Services Pricing</strong>, so a rate edited there moves every
        figure here. This is a sizing exercise, not a forecast: nothing here knows whether the client wants the service.
        Scopes are saved per client and never write to the company record&rsquo;s Services Explored &mdash; but what that
        record already says is shown beside them, on the row and against each service, so you can see what a client
        already buys before you size it again. Clients ticked <strong>Don&rsquo;t Track</strong> on the Clients tab are
        left out, here as everywhere else &mdash; nobody is working them, so their money does not belong in these totals.
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div style={tile} title="Clients with at least one service picked, out of the clients shown.">
          <div style={tileNum}>{totals.scoped}<span style={{ fontSize: '0.9rem', color: '#94A3B8', fontWeight: 600 }}> / {totals.clients}</span></div>
          <div style={tileLabel}>Clients scoped</div>
        </div>
        <div style={tile} title="Every scoped client's first year added up: annual fees on recurring services, the whole job on projects, plus setup fees billed once.">
          <div style={tileNum}>{formatMoneyRange(totals.year1, totals.year1High)}</div>
          <div style={tileLabel}>Year 1</div>
        </div>
        <div style={tile} title="The same scopes across their contract terms — a recurring fee multiplied by its years, a project once, setup once.">
          <div style={tileNum}>{formatMoneyRange(totals.contractValue, totals.contractValueHigh)}</div>
          <div style={tileLabel}>Est. deal value</div>
        </div>
        <div style={tile} title="The recurring half only, per year. This is the figure that keeps arriving after year one.">
          <div style={tileNum}>{formatMoneyRange(totals.recurringAnnual, totals.recurringAnnualHigh)}</div>
          <div style={tileLabel}>Recurring / yr</div>
        </div>
        {totals.unpriced > 0 && (
          <div style={{ ...tile, borderColor: '#FDE68A', background: '#FFFBEB' }} title="Services picked against a client that have no rate on the pricing page. They contribute nothing to the totals — price them and these figures go up.">
            <div style={{ ...tileNum, color: '#92400E' }}>{totals.unpriced}</div>
            <div style={{ ...tileLabel, color: '#92400E' }}>Unpriced picks</div>
          </div>
        )}
      </div>

      {/* One service across the whole book. This is the only control on the
          page that writes to every client at once, so it says what it will do
          before it does it, and what it did afterwards — with a way back. */}
      <div style={{ border: '1px solid #E2E8F0', background: '#fff', borderRadius: 10, padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>Add one service to every client listed</span>
          <select
            value={bulkService}
            onChange={e => { setBulkService(e.target.value); setBulkUndo(null); }}
            style={{ flex: '1 1 260px', maxWidth: 380, padding: '0.35rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
          >
            <option value="">Pick a service…</option>
            {serviceBuckets.map(group => (
              <optgroup key={group.name} label={group.name}>
                {group.services.map(name => <option key={name} value={name}>{name}</option>)}
              </optgroup>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: '#475569' }}>
            <input type="checkbox" checked={bulkSkipSold} onChange={e => setBulkSkipSold(e.target.checked)} />
            <span title="A client whose company card says they already buy this is not new business. Sizing it as if it were counts revenue you already have — twice, if it is also under contract.">
              Skip clients who already buy it
            </span>
          </label>
          <button
            type="button"
            onClick={addToAll}
            disabled={!bulkPlan?.add.length}
            style={{
              padding: '0.35rem 0.8rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
              border: '1px solid ' + (bulkPlan?.add.length ? '#1D4ED8' : '#CBD5E1'),
              background: bulkPlan?.add.length ? '#1D4ED8' : '#F8FAFC',
              color: bulkPlan?.add.length ? '#fff' : '#94A3B8',
              cursor: bulkPlan?.add.length ? 'pointer' : 'default',
            }}
          >{bulkPlan?.add.length ? `Add to ${bulkPlan.add.length} client${bulkPlan.add.length === 1 ? '' : 's'}` : 'Add to all'}</button>
          {bulkPlan?.have.length > 0 && (
            <button
              type="button"
              onClick={removeFromAll}
              style={{ padding: '0.35rem 0.7rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#fff', color: '#B91C1C', cursor: 'pointer' }}
            >Remove from {bulkPlan.have.length}</button>
          )}
        </div>

        {/* The breakdown. Every client the pick would NOT change is accounted
            for by name of reason, so "Add to 31" out of 44 listed is never a
            number the reader has to explain to themselves. */}
        {bulkPlan && (
          <div style={{ fontSize: '0.73rem', color: '#64748B', marginTop: '0.45rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span><strong style={{ color: '#0F172A' }}>{bulkPlan.add.length}</strong> will get it</span>
            {bulkPlan.scoped.length > 0 && (
              <span title="Already in this client's scope — adding it again changes nothing.">
                <strong style={{ color: '#334155' }}>{bulkPlan.scoped.length}</strong> already scoped
              </span>
            )}
            {bulkPlan.sold.length > 0 && (
              <span title={bulkSkipSold
                ? 'The company card says these clients already buy it, so they are being left out. Untick the box to size them anyway — a renewal is a real thing to want.'
                : 'The company card says these clients already buy it, and they are being included. Their figures are a renewal, not new business.'}>
                <strong style={{ color: bulkSkipSold ? '#166534' : '#B45309' }}>{bulkPlan.sold.length}</strong>
                {bulkSkipSold ? ' already buy it — skipped' : ' already buy it — included'}
              </span>
            )}
            {bulkPlan.add.length === 0 && (
              <span style={{ color: '#94A3B8' }}>Nothing to do for the clients listed below.</span>
            )}
          </div>
        )}

        {bulkUndo && (
          <div style={{ fontSize: '0.73rem', color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '0.35rem 0.55rem', marginTop: '0.45rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{bulkUndo.message}</span>
            <button
              type="button"
              onClick={undoBulk}
              style={{ background: 'none', border: 'none', padding: 0, color: '#1D4ED8', fontWeight: 700, fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
            >Undo</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search client or service…"
          style={{ flex: '1 1 240px', maxWidth: 320, padding: '0.4rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: '#475569' }}>
          <input type="checkbox" checked={onlyScoped} onChange={e => setOnlyScoped(e.target.checked)} />
          Only clients with a scope
        </label>
        {untrackedCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: '#475569' }}>
            <input type="checkbox" checked={showUntracked} onChange={e => setShowUntracked(e.target.checked)} />
            <span title={`${untrackedCount} client${untrackedCount === 1 ? ' is' : 's are'} ticked Don't Track on the Clients tab. They are left out of this page and its totals — tick this to size them anyway.`}>
              Show Don&rsquo;t Track clients <span style={{ color: '#94A3B8' }}>({untrackedCount})</span>
            </span>
          </label>
        )}
        <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
          {visible.length} of {rows.length} clients
          {!showUntracked && untrackedCount > 0 && (
            <span title="Ticked Don't Track on the Clients tab, so they are not sized here.">
              {' '}· {untrackedCount} Don&rsquo;t Track left out
            </span>
          )}
        </span>
      </div>

      <DataTable
        tableId={TABLE_ID}
        exportFileName="Client deal sizing"
        columns={columns}
        rows={visible}
        alwaysVisible={['company']}
        defaultSort={{ key: 'contractValue', direction: 'desc' }}
        onRowClick={(row) => toggleRow(row.id)}
        expandedRowIds={expandedIds}
        renderExpansion={renderExpansion}
        settings={settings}
        updateSettings={updateSettings}
        emptyMessage={rows.length === 0
          ? (untrackedCount > 0
            ? `No clients found for your CDM beyond the ${untrackedCount} ticked Don't Track. Tick "Show Don't Track clients" to size them anyway.`
            : 'No clients found for your CDM. The Clients subtab shows the same list.')
          : 'No clients match this filter.'}
      />

      {picking && (
        <ScopeServicesModal
          value={picking.scope.services.join(', ')}
          options={serviceNames}
          account={picking.company}
          prospects={prospects}
          updateProspect={updateProspect}
          settings={settings}
          onChange={(next) => {
            saveScope(picking.company, { ...picking.scope, services: parseMulti(next) });
            // The board stays open while several services are ticked, so it
            // re-reads its own value from the row it was opened with — kept in
            // step here rather than left showing the selection it opened on.
            setPicking(prev => (prev ? { ...prev, scope: { ...prev.scope, services: parseMulti(next) } } : prev));
          }}
          onClose={() => setPicking(null)}
          note={`Sizing a deal for ${picking.company || 'this client'}. Picking here doesn't change the company's Services Explored — it only sets what this estimate prices.`}
        />
      )}
    </div>
  );
}
