// The ownership-scope controls: the segmented Exclude-leased / All-sites
// bar shared by the two building-compliance subtabs, and the savings-scope
// button on the Utility Lookup toolbar. Both live here so the pure scoping
// helpers in ./ownershipScope.js stay component-free.
import { ownershipScopeStats } from './ownershipScope.js';

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
  margin: '0 0 0.75rem',
  padding: '0.45rem 0.7rem',
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
};

const segBase = {
  padding: '0.25rem 0.7rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#475569',
  cursor: 'pointer',
};

const segOn = { ...segBase, background: '#009530', borderColor: '#009530', color: '#FFFFFF' };

// Segmented control plus a line saying exactly what the current scope
// leaves out. Rendered at the top of both compliance subtabs so the counts
// below it are never a mystery.
//
// The left segment is "Exclude leased", not "Owned only": it drops the
// buildings known to be leased and screens everything else, unknown
// ownership included. Labelling it by what it removes is the honest
// framing — "Owned only" read as a promise that every screened site was
// confirmed owned, which it never was.
export function OwnershipScopeBar({ sites = [], excludeLeased, onChange }) {
  const stats = ownershipScopeStats(sites);
  // Nothing leased means the scope has nothing to drop.
  const unavailable = stats.leased === 0;
  const scoping = excludeLeased && !unavailable;
  const hint = unavailable
    ? `No leased sites in the loaded list: all ${stats.total.toLocaleString()} are screened.${
        stats.known === 0
          ? ' Map an Ownership column on the Utility Lookup tab to leave leased buildings out.'
          : ''
      }`
    : scoping
      ? `Screening ${stats.screened.toLocaleString()} site${stats.screened === 1 ? '' : 's'}`
        + ` · excluding ${stats.leased.toLocaleString()} leased`
        + (stats.unspecified
          ? ` · ${stats.unspecified.toLocaleString()} with no ownership status ${stats.unspecified === 1 ? 'is' : 'are'} screened, not dropped`
          : '')
      : `Screening all ${stats.total.toLocaleString()} site${stats.total === 1 ? '' : 's'} · ${stats.owned.toLocaleString()} owned, ${stats.leased.toLocaleString()} leased${stats.unspecified ? `, ${stats.unspecified.toLocaleString()} unspecified` : ''}.`;
  return (
    <div style={barStyle}>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Ownership scope
      </span>
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden' }}>
        <button
          type="button"
          style={{ ...(scoping ? segOn : segBase), borderTopLeftRadius: 6, borderBottomLeftRadius: 6, opacity: unavailable ? 0.5 : 1, cursor: unavailable ? 'not-allowed' : 'pointer' }}
          disabled={unavailable}
          onClick={() => onChange(true)}
          title={unavailable
            ? 'No site in the loaded list is marked Leased, so there is nothing to exclude.'
            : 'Leave out the buildings the portfolio leases: these obligations fall on the owner. Sites with no ownership status are still screened.'}
        >Exclude leased{unavailable ? '' : ` (${stats.screened.toLocaleString()})`}</button>
        <button
          type="button"
          style={{ ...(scoping ? segBase : segOn), borderLeft: 'none', borderTopRightRadius: 6, borderBottomRightRadius: 6 }}
          onClick={() => onChange(false)}
          title="Screen every loaded site, owned or leased."
        >All sites ({stats.total.toLocaleString()})</button>
      </div>
      <span style={{ fontSize: '0.72rem', color: '#64748B', flex: 1, minWidth: 200 }}>{hint}</span>
    </div>
  );
}

// Toolbar button that decides whether leased locations carry procurement
// savings in the Master Analysis and the Overview exports.
//
// The default is that they don't: the savings are a motion on the supply
// contract behind the meter, and on a leased building that contract is
// usually the landlord's. But "usually" isn't "always" — a triple-net lease
// often leaves the tenant holding the supply contract, and a portfolio that
// knows it does shouldn't have to unmap its Ownership column to say so. One
// click puts those sites back in.
//
// Rendered only when the loaded list actually has leased sites: with none,
// the button decides nothing, and a disabled control in a busy toolbar is
// noise. `count` is that number of leased sites.
export function SavingsScopeToggle({ count, included, onChange }) {
  const label = `Leased ${included ? 'included in' : 'excluded from'} savings (${count.toLocaleString()})`;
  return (
    <button
      type="button"
      onClick={() => onChange(!included)}
      title={included
        ? `The ${count.toLocaleString()} leased site${count === 1 ? '' : 's'} in this list carry indicative savings like any other site, and the exports say so. Click to leave them out — the default, since a leased building's supply contract is usually the landlord's to re-source.`
        : `Indicative savings are projected on the rest of the portfolio: the ${count.toLocaleString()} leased site${count === 1 ? '' : 's'} in this list carry $0, because a leased building's supply contract is usually the landlord's to re-source. Click to include them — e.g. a triple-net portfolio that holds its own supply contracts.`}
      style={{
        padding: '0.4rem 0.8rem',
        borderRadius: 6,
        fontSize: '0.8rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        border: `1px solid ${included ? '#009530' : 'var(--color-border)'}`,
        background: included ? '#009530' : '#fff',
        color: included ? '#fff' : '#475569',
      }}
    >
      {included ? '☑' : '☐'} {label}
    </button>
  );
}

// The missing-tenure warning on the Utility Lookup page.
//
// Tenure — the Ownership (Owned / Leased) column — is an optional mapping
// that two analyses read as though it were always there: the compliance
// subtabs leave leased buildings out of an owner's obligations, and the
// Master Analysis leaves them out of the procurement savings. Both work off
// "is this row Leased", so a list that never carried the column looks
// exactly like a portfolio that owns every building: nothing is dropped,
// nothing says why, and a portfolio that leases half its estate reads as
// twice the savings opportunity it can act on. The gap is invisible in
// every figure it moves, so it gets its own line on the page.
//
// Two shapes, because they need different answers: no tenure at all is a
// mapping to fix (or a column the file never had), while a partial column
// is a data gap in rows that are otherwise fine. Neither blocks anything —
// an unmapped Ownership column is a legitimate way to run the page — so
// this is a warning with a dismiss, not a wall.
export function TenureWarningBanner({ coverage, mapped, onFixMapping, onDismiss }) {
  const { total, missing, owned, leased, unplaceable } = coverage;
  if (!total || missing <= 0) return null;
  const none = missing === total;
  const pct = Math.round((missing / total) * 100);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        margin: '0.5rem 1.25rem',
        padding: '0.55rem 0.75rem',
        background: '#FFFBEB',
        border: `1px solid ${none ? '#F59E0B' : '#FDE68A'}`,
        borderRadius: 6,
        color: '#92400E',
        fontSize: '0.78rem',
        lineHeight: 1.45,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {none ? (
          <>
            <strong>No Tenure (Owned / Leased) data on this upload.</strong>{' '}
            {mapped
              ? <>An <strong>Ownership</strong> column is mapped, but every one of the {total.toLocaleString()} loaded site{total === 1 ? '' : 's'} is blank in it.</>
              : <>Nothing is mapped to <strong>Ownership (Owned / Leased)</strong>, so none of the {total.toLocaleString()} loaded site{total === 1 ? '' : 's'} carries a tenure status.</>}
            {' '}Without it the portfolio is treated as if it owned everything: the compliance
            subtabs screen every building for obligations that fall on the owner, and the Master
            Analysis projects procurement savings on the full deregulated spend. On a portfolio
            that leases, both read high.
          </>
        ) : (
          <>
            <strong>Tenure (Owned / Leased) is missing on {missing.toLocaleString()} of {total.toLocaleString()} sites ({pct}%).</strong>{' '}
            {[
              owned ? `${owned.toLocaleString()} owned` : null,
              leased ? `${leased.toLocaleString()} leased` : null,
              unplaceable ? `${unplaceable.toLocaleString()} with a status we couldn't place` : null,
            ].filter(Boolean).join(', ') || 'No site has a recognized status'}.
            {' '}A site with no tenure status is screened for compliance and keeps its projected
            savings — the safer reading of a gap, but a leased building hiding in there inflates
            both.
          </>
        )}
      </div>
      {onFixMapping && (
        <button
          type="button"
          onClick={onFixMapping}
          style={{
            flexShrink: 0,
            padding: '0.25rem 0.6rem',
            border: '1px solid #F59E0B',
            background: '#FFFFFF',
            color: '#92400E',
            borderRadius: 6,
            fontSize: '0.72rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="Re-open the column mapping against the loaded sites and point Ownership (Owned / Leased) at a column from the file."
        >Map Tenure column</button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the tenure warning"
          title="Hide this warning until the loaded sites change."
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: '#B45309',
            fontSize: '1rem',
            lineHeight: 1,
            padding: '0.1rem 0.2rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >×</button>
      )}
    </div>
  );
}
