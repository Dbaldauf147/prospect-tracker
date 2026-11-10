import { useMemo, useState } from 'react';
import { applyCompanyOverride, contactDisplayName } from '../../utils/contactRosters';

// "Why isn't this contact here?" on Contacts > All. Type a name or email and
// each matching HubSpot contact says which rule keeps them off the page, or,
// when they do qualify, which of the page's own filters is hiding them. Reads
// the same saved HubSpot copy and the same roster gates the page runs on
// (gates.explain in utils/contactRosters), so the answer can't disagree with
// the table.

const MAX_MATCHES = 5;

function matchesQuery(c, q) {
  const name = `${c?.firstname || ''} ${c?.lastname || ''}`.toLowerCase();
  return name.includes(q) || String(c?.email || '').toLowerCase().includes(q);
}

export function WhyMissingLookup({ contacts, gates, localFields, combinedSelector, categoryFilter, activeTag }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (q.length < 2) return null;
    const hits = [];
    let total = 0;
    for (const base of contacts || []) {
      if (!matchesQuery(base, q)) continue;
      total += 1;
      if (hits.length >= MAX_MATCHES) continue;
      const c = localFields ? applyCompanyOverride(base, localFields) : base;
      const ex = gates.explain(c);
      let pageFilter = '';
      if (!ex.blocked && ex.on.length) {
        if (combinedSelector && !combinedSelector(c)) pageFilter = `the Tag dropdown is set to "${activeTag}" and this contact doesn't pass it. Clear the tag to see them.`;
        else if (categoryFilter?.size && !ex.on.some(l => categoryFilter.has(l))) pageFilter = `the lit Totals pills (${[...categoryFilter].join(', ')}) don't include ${ex.on.join(' or ')}. Click All to clear them.`;
      }
      hits.push({ c, ex, pageFilter });
    }
    return { hits, total };
  }, [q, contacts, gates, localFields, combinedSelector, categoryFilter, activeTag]);

  const linkBtn = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none',
    color: '#64748B', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  };

  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} style={linkBtn}
        title="Look up a contact and see exactly which rule or filter keeps them off this page">
        <span style={{ fontSize: '0.6rem' }}>{open ? '▾' : '▸'}</span>
        Why isn&apos;t someone here?
      </button>
      {open && (
        <div data-why-missing style={{ marginTop: 4, padding: '0.5rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#F8FAFC', maxWidth: 760 }}>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name or email, e.g. Dan Egan"
            style={{ width: '100%', maxWidth: 320, padding: '3px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
          />
          {results && results.hits.length === 0 && (
            <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#991B1B' }}>
              Nobody matching &quot;{query.trim()}&quot; in the saved HubSpot copy ({(contacts || []).length.toLocaleString()} contacts). If they are in HubSpot, hit Refresh HubSpot on the Contacts page to pull them in.
            </div>
          )}
          {results?.hits.map(({ c, ex, pageFilter }) => {
            const verdict = ex.blocked
              ? { text: ex.blocked, color: '#991B1B' }
              : !ex.on.length
                ? { text: 'On none of the four lists, so not on All. Each list says why below.', color: '#991B1B' }
                : pageFilter
                  ? { text: `Qualifies (via ${ex.on.join(', ')}), but ${pageFilter}`, color: '#92400E' }
                  : { text: `On All via ${ex.on.join(', ')}. If you still can't see them, check the search box, the column filters and the toggles above the table.`, color: '#166534' };
            return (
              <div key={String(c.id || c.vid || c.email)} data-why-row style={{ marginTop: 8, fontSize: '0.72rem', color: '#334155' }}>
                <div>
                  <strong>{contactDisplayName(c)}</strong>
                  <span style={{ color: '#64748B' }}>{c.company ? ` · ${c.company}` : ' · no Company'}{c.email ? ` · ${c.email}` : ''}</span>
                </div>
                <div data-why-verdict style={{ color: verdict.color, fontWeight: 600, marginTop: 2 }}>{verdict.text}</div>
                {!ex.blocked && (
                  <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                    {ex.rosters.map(r => (
                      <li key={r.label} style={{ color: r.ok ? '#166534' : '#64748B' }}>
                        <strong>{r.label}:</strong> {r.ok ? 'yes' : r.why}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {results && results.total > results.hits.length && (
            <div style={{ marginTop: 6, fontSize: '0.68rem', color: '#64748B' }}>
              {results.total - results.hits.length} more match. Type more of the name to narrow it.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
