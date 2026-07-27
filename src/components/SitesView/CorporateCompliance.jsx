import { useMemo } from 'react';

// Corporate Compliance — placeholder scaffold.
//
// This subtab is where company-specific research will live: revenue
// lookup and California site operations per company/portfolio. For now
// it groups the uploaded sites by company and previews how many sit in
// California, so the real research (revenue figures, CA-operation
// screening) can be dropped into the per-company cards below.

const isCalifornia = (state) => {
  const s = String(state || '').trim().toLowerCase();
  return s === 'ca' || s === 'california';
};

export default function CorporateCompliance({ sites = [] }) {
  const companies = useMemo(() => {
    const byCompany = new Map();
    for (const site of sites) {
      const name = String(site.company || '').trim() || '(Unnamed company)';
      if (!byCompany.has(name)) {
        byCompany.set(name, { name, total: 0, california: 0, caSites: [] });
      }
      const entry = byCompany.get(name);
      entry.total += 1;
      if (isCalifornia(site.state)) {
        entry.california += 1;
        if (site.siteName || site.city) {
          entry.caSites.push([site.siteName, site.city].filter(Boolean).join(' — '));
        }
      }
    }
    return [...byCompany.values()].sort(
      (a, b) => b.california - a.california || b.total - a.total || a.name.localeCompare(b.name)
    );
  }, [sites]);

  const totalCA = companies.reduce((sum, c) => sum + c.california, 0);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Corporate Compliance
        </h1>
        <span style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--color-accent)', background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 999, padding: '0.15rem 0.6rem',
        }}>
          Coming soon
        </span>
      </div>
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', maxWidth: 620, marginTop: '0.35rem' }}>
        Company-specific research lives here: <strong>annual revenue</strong> and{' '}
        <strong>California site operations</strong> per company. The cards below group the
        uploaded sites by company and flag their California footprint — a starting point for
        the revenue and CA-operations research to come.
      </p>

      {companies.length === 0 ? (
        <div style={{
          marginTop: '1.5rem', padding: '2rem', textAlign: 'center',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)',
          border: '1px dashed var(--color-border)', borderRadius: 8,
        }}>
          No sites loaded yet. Upload sites on the Utility Lookup tab to preview companies here.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: '1rem 0 0.5rem' }}>
            {companies.length} {companies.length === 1 ? 'company' : 'companies'} ·{' '}
            <strong style={{ color: '#166534' }}>{totalCA}</strong> California{' '}
            {totalCA === 1 ? 'site' : 'sites'}
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {companies.map((c) => (
              <div key={c.name} style={{
                border: '1px solid var(--color-border)', borderRadius: 8,
                background: 'var(--color-surface)', padding: '0.75rem 0.9rem',
              }}>
                <div style={{ fontWeight: 700, color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  {c.total} {c.total === 1 ? 'site' : 'sites'}
                  {c.california > 0 && (
                    <>
                      {' · '}
                      <strong style={{ color: '#166534' }}>{c.california} in CA</strong>
                    </>
                  )}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>
                  <span style={{ fontStyle: 'italic' }}>Revenue: pending research</span>
                </div>
                {c.caSites.length > 0 && (
                  <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>
                    {c.caSites.slice(0, 5).map((label, i) => (
                      <li key={i}>{label}</li>
                    ))}
                    {c.caSites.length > 5 && (
                      <li style={{ color: 'var(--color-text-muted)', listStyle: 'none', marginLeft: '-1.1rem' }}>
                        +{c.caSites.length - 5} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
