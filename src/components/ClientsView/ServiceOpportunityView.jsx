// Service Opportunity — what the whole book of clients is worth, one service
// at a time.
//
// Deal Sizing asks the question client-first: pick a scope for Prologis, see
// what Prologis is worth. This is the transpose, and it is the one that
// decides where a quarter goes — which SERVICE is this book worth most on,
// and who has already been offered it.
//
// You could work it out on the sizing page: bulk-add a service to all 33
// clients, read the tile, clear it, repeat. A hundred and fifty times. Nobody
// has ever done that, which is why the ranking has never existed.
//
// The arithmetic is Deal Sizing's, run through serviceOpportunity.js, which
// runs it through the same estimateScope every other page prices with. A rate
// edited on Services Pricing moves these numbers and there is no second
// engine to keep in step. The clients are scoped identically too — this CDM's
// clients, Don't Track excluded by default — so a figure here and a figure
// there are about the same book.
//
// The headline is the OPEN clients only: the ones whose card says nothing
// about the service. That is Deal Sizing's not-sized rule applied per service
// rather than per scope, and it is what "as if I ran this on the sizing page"
// actually produces. The rest of the book is not hidden — it is the Whole
// Book column — because "small because they already buy it" and "small
// because it prices to nothing" are different answers and a single total
// would flatten them into one.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { matchesCdm } from '../../utils/cdmMatch';
import { normClientName } from '../../utils/clientIssues';
import { useClientFlagMaps } from '../../utils/rosterHooks';
import { pricedServiceRows } from '../../utils/serviceRows';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { buildOppStagesByClient } from '../../utils/serviceCoverage';
import { loadClientScopeMap, CLIENT_SCOPE_EVENT } from '../../utils/clientManagerStore';
import { serviceStatusColor, serviceBucket } from '../../utils/serviceStatusColors';
import {
  formatMoneyRange,
  getServicePricing,
  resolvePricingBases,
} from '../../utils/servicePricing';
import {
  rollUpServiceOpportunity,
  rollUpOpportunityTotals,
  exploredSummary,
} from '../../utils/serviceOpportunity';

const TABLE_ID = 'clients-service-opportunity';

const tile = {
  flex: '1 1 150px', minWidth: 140, background: '#fff', border: '1px solid #E2E8F0',
  borderRadius: 10, padding: '0.55rem 0.75rem',
};
const tileNum = { fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.15 };
const tileLabel = { fontSize: '0.68rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' };

// DataTable's cells are `max-width: 0; overflow: hidden` with inline-block
// children, which is right for the grid and wrong inside an expansion row —
// the panel shrinks to fit and every figure clips. Same reset the sizing page
// uses, for the same reason.
const panelReset = { display: 'block', width: '100%', maxWidth: '100%', whiteSpace: 'normal', overflow: 'visible' };
const cellReset = { maxWidth: 'none', overflow: 'visible', textOverflow: 'clip' };

const NO_UPSIDE = 'No open client prices above zero on this service — either nobody is open to it, or the clients who are have no count for it to multiply.';

// A money figure that may be a range. A service nothing prices on shows a
// dash rather than $0: "no rate on the card" and "priced, worth nothing" are
// different answers, and a zero would read as the second when it is the first.
function Money({ low, high, muted, bold, title }) {
  if (!(low > 0 || high > 0)) {
    return <span style={{ color: '#CBD5E1' }} title={title}>—</span>;
  }
  return (
    <span style={{ fontWeight: bold ? 700 : 600, color: muted ? '#64748B' : '#0F172A', whiteSpace: 'nowrap' }}>
      {formatMoneyRange(low, high)}
    </span>
  );
}

// One status, painted the colour the rest of the app paints it.
function StatusPill({ status }) {
  const { bg, color } = serviceStatusColor(status);
  return (
    <span style={{
      fontSize: '0.66rem', fontWeight: 700, padding: '0.05rem 0.4rem', borderRadius: 999,
      background: bg || '#F1F5F9', color: color || '#64748B', whiteSpace: 'nowrap',
    }}>{status || 'Open'}</span>
  );
}

// The explored half of a row, as one count per bucket. A service the whole
// book has been asked about looks completely different from one nobody has
// been shown, and that is the difference between "the upside is small" and
// "the upside is small because we already sold it".
function ExploredCell({ statuses }) {
  const shown = ['sold', 'inProgress', 'notSold', 'na']
    .map(key => ({ key, n: statuses?.[key] || 0, meta: serviceBucket(key) }))
    .filter(b => b.n > 0);
  if (!shown.length) return <span style={{ color: '#CBD5E1' }} title="No client's card says anything about this service.">—</span>;
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {shown.map(b => (
        <span
          key={b.key}
          title={`${b.n} client${b.n === 1 ? '' : 's'}: ${b.meta?.label || b.key}`}
          style={{
            fontSize: '0.66rem', fontWeight: 700, padding: '0.05rem 0.4rem', borderRadius: 999,
            background: b.meta?.bg || '#F1F5F9', color: b.meta?.color || '#64748B', whiteSpace: 'nowrap',
          }}
        >{b.n} {b.meta?.label || b.key}</span>
      ))}
    </span>
  );
}

export function ServiceOpportunityView({
  prospects = [], cdmName, settings, updateSettings, onSelectProspect,
}) {
  const [scopeMap, setScopeMap] = useState(() => loadClientScopeMap());
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [onlyUpside, setOnlyUpside] = useState(false);
  const [showUntracked, setShowUntracked] = useState(false);

  // The per-client counts and typed deal sizes come out of the same mirrored
  // store the sizing page writes, so a count typed over there moves these
  // figures without a reload.
  useEffect(() => {
    const refresh = () => setScopeMap(loadClientScopeMap());
    window.addEventListener(CLIENT_SCOPE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CLIENT_SCOPE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Scoped exactly as Deal Sizing scopes it — this CDM, Status = Client —
  // rather than off the Clients subtab's filtered list, so the two pages are
  // always talking about the same book.
  const allClients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => String(p?.status || '').trim().toLowerCase() === 'client')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, cdmName]);

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

  // Half of what the company card says about a service comes from an
  // opportunity whose Scope names it, not from a hand-set dropdown. Reading
  // only the manual map would call a client open to a service they were sold
  // through an opp — which is the overstatement this page exists to avoid.
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache()
        .then(o => { if (!cancelled) setOppsRecords(o?.records || []); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);
  const oppStagesByClient = useMemo(
    () => buildOppStagesByClient(clients, oppsRecords),
    [clients, oppsRecords],
  );

  const bases = useMemo(() => resolvePricingBases(settings), [settings]);
  const pricing = useMemo(() => getServicePricing(settings), [settings]);
  const serviceRows = useMemo(() => pricedServiceRows(settings), [settings]);

  const scopeFor = useCallback(
    (client) => scopeMap[normClientName(client?.company)],
    [scopeMap],
  );

  // The whole grid: every service priced against every client. ~150 × ~35
  // single-service estimates, rebuilt when a rate, a scope or the book
  // changes — cheap enough to do outright rather than cache, and caching it
  // is how a rate edit would stop moving the numbers.
  const rows = useMemo(() => rollUpServiceOpportunity({
    clients,
    serviceRows,
    pricing,
    bases,
    scopeOf: scopeFor,
    oppStagesByClient,
  }).map(row => ({ ...row, id: row.name })), [clients, serviceRows, pricing, bases, scopeFor, oppStagesByClient]);

  const visible = useMemo(() => {
    let list = rows;
    if (onlyUpside) list = list.filter(r => r.contractValue > 0 || r.contractValueHigh > 0);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(r => r.name.toLowerCase().includes(q)
        || String(r.bucket || '').toLowerCase().includes(q));
    }
    return list;
  }, [rows, onlyUpside, query]);

  // Totals over what's on screen, so narrowing to one box of the services
  // board re-totals to that box rather than always reporting the catalog.
  const totals = useMemo(() => rollUpOpportunityTotals(visible), [visible]);

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
      key: 'name', label: 'Service', defaultWidth: 310,
      getSortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontWeight: 600, color: '#0F172A' }}>{row.name}</span>
          {/* A service with no rate contributes nothing here however much of
              the book is open to it, so the reason is beside the name rather
              than left to be inferred from a column of dashes. */}
          {!row.priced && (
            <span
              title="No rate on this service on Dropdowns › Services Pricing. It prices to nothing here until one is set."
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '0.05rem 0.35rem', borderRadius: 999,
                background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap',
              }}
            >No rate</span>
          )}
        </span>
      ),
    },
    {
      key: 'bucket', label: 'Service Bucket', defaultWidth: 180,
      getFilterValue: (row) => row.bucket || '',
    },
    {
      // What the rate card charges this on — the column that answers "where
      // does this number come from" without opening the pricing page.
      // Holds a label and a two-ended rate — "Flat fee · $40,000 – $65,000"
      // — and a clipped rate is the one thing on this row a reader would
      // otherwise have to open the pricing page to check.
      key: 'basisLabel', label: 'Priced On', defaultWidth: 245,
      getFilterValue: (row) => row.basisLabel || 'No basis',
      render: (row) => (
        row.basisLabel
          ? (
            <span style={{ color: '#475569' }}>
              {row.basisLabel}
              {(row.rate !== null || row.rateHigh !== null) && (
                <span style={{ color: '#94A3B8' }}>
                  {' · '}{formatMoneyRange(row.rate, row.rateHigh)}
                </span>
              )}
            </span>
          )
          : <span style={{ color: '#CBD5E1' }}>—</span>
      ),
    },
    {
      // Wide enough for a range on a book this size: these hold
      // "$12,345,678 – $16,543,210" once a service is quoted on two rates,
      // and a clipped figure is a wrong figure.
      key: 'contractValue', label: 'Est. Deal Value', defaultWidth: 265,
      getSortValue: (row) => row.contractValue,
      exportValue: (row) => row.contractValue,
      render: (row) => <Money low={row.contractValue} high={row.contractValueHigh} bold title={NO_UPSIDE} />,
    },
    {
      key: 'year1', label: 'Year 1', defaultWidth: 250,
      getSortValue: (row) => row.year1,
      exportValue: (row) => row.year1,
      render: (row) => <Money low={row.year1} high={row.year1High} title={NO_UPSIDE} />,
    },
    {
      key: 'recurringAnnual', label: 'Recurring / yr', defaultWidth: 230,
      getSortValue: (row) => row.recurringAnnual,
      exportValue: (row) => row.recurringAnnual,
      render: (row) => <Money low={row.recurringAnnual} high={row.recurringAnnualHigh} title="Nothing recurring in this service's price — a project bills once." />,
    },
    {
      // How much of the book this figure is actually built on. "3 of 21 open"
      // is the difference between a service worth £4m across the book and one
      // worth £4m because a single client has 6,000 sites.
      key: 'openClients', label: 'Open Clients', defaultWidth: 180,
      getSortValue: (row) => row.openClients,
      exportValue: (row) => row.openClients,
      render: (row) => (
        <span
          title={`${row.openClients} of ${clients.length} client${clients.length === 1 ? '' : 's'} have no status against this service. ${row.pricedClients} of them price above zero.`}
          style={{ color: row.openClients ? '#0F172A' : '#94A3B8', fontWeight: 600 }}
        >
          {row.openClients}
          <span style={{ color: '#94A3B8', fontWeight: 600 }}> / {clients.length}</span>
          {row.openClients > row.pricedClients && (
            <span style={{ color: '#94A3B8', fontWeight: 500 }}>{` · ${row.pricedClients} priced`}</span>
          )}
        </span>
      ),
    },
    {
      key: 'explored', label: 'Explored', defaultWidth: 260,
      getSortValue: (row) => (row.statuses.sold + row.statuses.inProgress + row.statuses.notSold + row.statuses.na),
      getFilterValue: (row) => exploredSummary(row.statuses) || 'Nobody',
      exportValue: (row) => exploredSummary(row.statuses),
      render: (row) => <ExploredCell statuses={row.statuses} />,
    },
    {
      // Every client, whatever the card says — what the service would be
      // worth if nothing had been ruled on. Reported beside the upside so a
      // service the book already buys reads as sold rather than as worthless.
      key: 'bookValue', label: 'Whole Book', defaultWidth: 250,
      getSortValue: (row) => row.bookValue,
      exportValue: (row) => row.bookValue,
      render: (row) => (
        <Money
          low={row.bookValue}
          high={row.bookValueHigh}
          muted
          title="Nothing in the book prices on this service."
        />
      ),
    },
  ], [expandedIds, clients.length]);

  // The clients behind one service's number: who is open, what each is worth,
  // and why a client priced at nothing. This is the half the ranking can't
  // show — a number is a reason to look, the list is who to call.
  const renderExpansion = useCallback((row) => (
    <div style={{ ...panelReset, padding: '0.5rem 0.75rem 0.85rem', background: '#F8FAFC' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.45rem' }}>
        Every client priced against <strong>{row.name}</strong>, biggest first. The ones with a
        status are already ruled on — their money is in Whole Book and never in Est. Deal Value.
      </div>
      <table style={{ ...panelReset, borderCollapse: 'collapse', fontSize: '0.74rem' }}>
        <thead>
          <tr style={{ color: '#64748B', textAlign: 'left' }}>
            <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 200 }}>Client</th>
            <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 110 }}>Status</th>
            <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 190, textAlign: 'right' }}>Est. deal value</th>
            <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 170, textAlign: 'right' }}>Year 1</th>
            <th style={{ ...cellReset, fontWeight: 600, padding: '0.2rem 0.4rem 0.35rem', minWidth: 180 }}>Needs</th>
          </tr>
        </thead>
        <tbody>
          {row.clients.map(c => (
            <tr key={c.company || c.client?.id} style={{ borderTop: '1px solid #E2E8F0' }}>
              <td style={{ ...cellReset, padding: '0.25rem 0.4rem' }}>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onSelectProspect?.(c.client); }}
                  disabled={!onSelectProspect}
                  style={{
                    background: 'none', border: 'none', padding: 0, textAlign: 'left',
                    color: '#1D4ED8', fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit',
                    textDecoration: 'underline', cursor: onSelectProspect ? 'pointer' : 'default',
                  }}
                >{c.company || '-'}</button>
              </td>
              <td style={{ ...cellReset, padding: '0.25rem 0.4rem' }}>
                <StatusPill status={c.status} />
              </td>
              {/* A ruled-on client's money is real arithmetic, it just isn't
                  upside — shown greyed so the column reads as the two
                  populations it is, rather than as one total nobody can
                  reconcile against the row above. */}
              <td style={{ ...cellReset, padding: '0.25rem 0.4rem', textAlign: 'right', color: c.open ? '#0F172A' : '#94A3B8', fontWeight: c.open ? 700 : 500 }}>
                {c.contractValue > 0 || c.contractValueHigh > 0
                  ? formatMoneyRange(c.contractValue, c.contractValueHigh)
                  : '—'}
              </td>
              <td style={{ ...cellReset, padding: '0.25rem 0.4rem', textAlign: 'right', color: c.open ? '#475569' : '#94A3B8' }}>
                {c.year1 > 0 || c.year1High > 0 ? formatMoneyRange(c.year1, c.year1High) : '—'}
              </td>
              <td style={{ ...cellReset, padding: '0.25rem 0.4rem', color: '#B45309' }}>
                {c.missingUnits.length
                  ? (
                    <span title={`This client has no ${c.missingUnits.join(' / ')} count, so the service prices at nothing for them. Enter it on the Deal Sizing subtab, or on the company card.`}>
                      {`No ${c.missingUnits.join(' / ')} count`}
                    </span>
                  )
                  : <span style={{ color: '#CBD5E1' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ), [onSelectProspect]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '0.9rem 1.25rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1E293B' }}>Service Opportunity</h2>
        <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
          Every service priced against every client, ranked by what is still open. Same rates as
          Dropdowns › Services Pricing, same clients and arithmetic as Deal Sizing.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <div style={tile} title="Services where at least one open client prices above zero, out of the services listed. The rest are either priced at nothing or have no open client left.">
          <div style={tileNum}>
            {totals.withValue}
            <span style={{ fontSize: '0.9rem', color: '#94A3B8', fontWeight: 600 }}> / {totals.services}</span>
          </div>
          <div style={tileLabel}>Services with upside</div>
        </div>
        <div style={tile} title="Every listed service's open clients across their contract terms, added up — a recurring fee multiplied by its years, a project once, setup once. Sizing the same client on two services counts both, because they are two deals.">
          <div style={tileNum}>{formatMoneyRange(totals.contractValue, totals.contractValueHigh)}</div>
          <div style={tileLabel}>Est. deal value</div>
        </div>
        <div style={tile} title="The same open clients' first year: annual fees on recurring services, the whole job on projects, plus setup billed once.">
          <div style={tileNum}>{formatMoneyRange(totals.year1, totals.year1High)}</div>
          <div style={tileLabel}>Year 1</div>
        </div>
        <div style={tile} title="The recurring half only, per year. This is the figure that keeps arriving after year one.">
          <div style={tileNum}>{formatMoneyRange(totals.recurringAnnual, totals.recurringAnnualHigh)}</div>
          <div style={tileLabel}>Recurring / yr</div>
        </div>
        <div style={tile} title="Every client on every listed service, whatever the card says — what the book would be worth if nothing had been ruled on yet. Always at least the figure beside it; the gap is the work already sold, lost or in flight.">
          <div style={{ ...tileNum, color: '#475569' }}>{formatMoneyRange(totals.bookValue, totals.bookValueHigh)}</div>
          <div style={tileLabel}>Whole book</div>
        </div>
        {totals.unpriced > 0 && (
          <div style={{ ...tile, borderColor: '#FDE68A', background: '#FFFBEB' }} title="Listed services with no rate on Dropdowns › Services Pricing. They contribute nothing to these totals — price them and the figures go up.">
            <div style={{ ...tileNum, color: '#92400E' }}>{totals.unpriced}</div>
            <div style={{ ...tileLabel, color: '#92400E' }}>Services with no rate</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search service or bucket…"
          style={{ flex: '1 1 240px', maxWidth: 320, padding: '0.4rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: '#475569' }}>
          <input type="checkbox" checked={onlyUpside} onChange={e => setOnlyUpside(e.target.checked)} />
          <span title="Hide the services that price to nothing — no rate on the card, no open client, or no count to multiply.">
            Only services with upside
          </span>
        </label>
        {untrackedCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: '#475569' }}>
            <input type="checkbox" checked={showUntracked} onChange={e => setShowUntracked(e.target.checked)} />
            <span title={`${untrackedCount} client${untrackedCount === 1 ? ' is' : 's are'} ticked Don't Track on the Clients tab. They are left out of these figures — tick this to price them anyway.`}>
              Show Don&rsquo;t Track clients <span style={{ color: '#94A3B8' }}>({untrackedCount})</span>
            </span>
          </label>
        )}
        <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
          {visible.length} of {rows.length} services · {clients.length} client{clients.length === 1 ? '' : 's'}
          {!showUntracked && untrackedCount > 0 && (
            <span title="Ticked Don't Track on the Clients tab, so they are not priced here.">
              {' '}· {untrackedCount} Don&rsquo;t Track left out
            </span>
          )}
        </span>
      </div>


      {/* The one thing a page of large numbers has to say about itself, said
          before the numbers rather than under 158 rows of them. Nothing here
          knows whether a client wants a service; the ranking is what the book
          WOULD be worth, not what it will be. */}
      <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.6rem', maxWidth: 860 }}>
        A sizing exercise, not a forecast: nothing here knows whether a client wants the service.
        Est. Deal Value counts only clients whose card says nothing about it — the ones already
        sold, lost, in flight or marked N/A are in Whole Book instead. Expand a service to see
        which is which.
      </div>
      <DataTable
        tableId={TABLE_ID}
        exportFileName="Service opportunity"
        columns={columns}
        rows={visible}
        alwaysVisible={['name']}
        defaultSort={{ key: 'contractValue', direction: 'desc' }}
        onRowClick={(row) => toggleRow(row.id)}
        expandedRowIds={expandedIds}
        renderExpansion={renderExpansion}
        settings={settings}
        updateSettings={updateSettings}
        emptyMessage={clients.length === 0
          ? (untrackedCount > 0
            ? `No clients found for your CDM beyond the ${untrackedCount} ticked Don't Track. Tick "Show Don't Track clients" to price them anyway.`
            : 'No clients found for your CDM. The Clients subtab shows the same list.')
          : (rows.length === 0
            ? 'No services in the catalog. Add them on Dropdowns › Services.'
            : 'No services match this filter.')}
      />
    </div>
  );
}

export default ServiceOpportunityView;
