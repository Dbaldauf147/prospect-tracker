// The "ZoomInfo" column on the My Accounts Company Data and DM Tags tables:
// whether the company is kept out of ZoomInfo exports (the Exclude from
// ZoomInfo button on its company popup).

export function ZoomExcludedCell({ excluded }) {
  if (!excluded) return <span style={{ color: '#CBD5E1' }}>-</span>;
  return (
    <span
      title="Excluded from ZoomInfo exports. Turn it off with the Exclude from ZoomInfo button on the company popup."
      style={{ fontSize: '0.68rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}
    >Excluded</span>
  );
}
