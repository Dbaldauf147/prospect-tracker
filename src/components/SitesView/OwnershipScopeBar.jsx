// Segmented Exclude-leased / All-sites control shared by the two
// building-compliance subtabs. Lives in its own file so the pure
// scoping helpers in ./ownershipScope.js stay component-free.
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
