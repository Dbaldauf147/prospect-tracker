// Site List Overview — combines the uploaded per-company site lists
// (settings.companySiteLists[slug], populated from each company's popup in
// the Table View) for every company that has a contact in a chosen email
// draft. Contacts carry a free-text `company` string; we normalise both
// sides (suffix-stripped, punctuation-folded) so "Acme Inc." lines up with
// "Acme". The result is one combined table tagged by company plus a small
// per-company summary.

import { useMemo, useState } from 'react';
import { userLsGet } from '../../utils/userLs';

const AUTOSAVE_KEY = 'prospect-draft-autosave';

// Fuzzy company-name compare — same logic the roster pages
// (KeyContactsView / KeyProspectsView / AllContactsView) use so a
// contact's HubSpot Company text doesn't have to exactly match the
// company a site list was saved under (handles suffix / extra-word drift
// like "Tishman Speyer" vs "Tishman Speyer Properties").
function companiesMatch(a, b) {
  const na = String(a || '').toLowerCase().trim();
  const nb = String(b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  return false;
}

function readComposeContacts() {
  try { return JSON.parse(userLsGet(AUTOSAVE_KEY))?.contacts || []; }
  catch { return []; }
}

export function SiteListOverview({ prospects, settings }) {
  const drafts = useMemo(() => settings?.emailDrafts || [], [settings?.emailDrafts]);
  const siteLists = useMemo(() => settings?.companySiteLists || {}, [settings?.companySiteLists]);

  // Which draft to build the overview from. The "compose" pseudo-draft is
  // the contacts currently in the composer (auto-saved to localStorage).
  const [draftKey, setDraftKey] = useState('__compose__');

  // Table filters: a global free-text search plus an optional per-column
  // contains-filter keyed by column label ("Company" + each site header).
  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState({});

  // Re-read the composer contacts whenever this tab renders so switching
  // back to it reflects the latest selection.
  const composeContacts = readComposeContacts();

  const activeContacts = useMemo(() => {
    if (draftKey === '__compose__') return composeContacts;
    const d = drafts.find(x => x.id === draftKey);
    return d?.contacts || [];
  }, [draftKey, composeContacts, drafts]);

  // Distinct company names present in the chosen draft (raw strings, deduped
  // case-insensitively so the same company isn't reported twice).
  const draftCompanies = useMemo(() => {
    const seen = new Map();
    for (const c of activeContacts) {
      const raw = String(c?.company || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!seen.has(key)) seen.set(key, raw);
    }
    return [...seen.values()];
  }, [activeContacts]);

  // For each stored site list, recover a display company name. The stored
  // object carries `company`; fall back to a prospect whose slug matches the
  // key for older lists saved before the name was stored.
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const prospectBySlug = useMemo(() => {
    const map = new Map();
    for (const p of (prospects || [])) {
      const slug = slugify(p?.company);
      if (slug && !map.has(slug)) map.set(slug, p.company);
    }
    return map;
  }, [prospects]);

  // Site lists whose owning company fuzzy-matches a company in the draft.
  const includedLists = useMemo(() => {
    const out = [];
    for (const [slug, list] of Object.entries(siteLists)) {
      if (!list || !Array.isArray(list.rows) || list.rows.length === 0) continue;
      const company = list.company || prospectBySlug.get(slug) || slug;
      const matched = draftCompanies.some(dc => companiesMatch(dc, company));
      if (matched) out.push({ slug, company, list });
    }
    return out.sort((a, b) => a.company.localeCompare(b.company));
  }, [siteLists, prospectBySlug, draftCompanies]);

  // Union of every included list's headers, preserving first-seen order. The
  // leading table column already shows the owning company, so a per-row
  // "Company" header is dropped to avoid a duplicate column.
  const combinedHeaders = useMemo(() => {
    const seen = new Set();
    const headers = [];
    for (const { list } of includedLists) {
      for (const h of (list.headers || [])) {
        if (h.toLowerCase() === 'company') continue;
        if (!seen.has(h)) { seen.add(h); headers.push(h); }
      }
    }
    return headers;
  }, [includedLists]);

  // Flattened rows, each tagged with its company.
  const combinedRows = useMemo(() => {
    const rows = [];
    for (const { company, list } of includedLists) {
      for (const r of list.rows) rows.push({ __company: company, row: r });
    }
    return rows;
  }, [includedLists]);

  // Columns the filters operate on: the leading Company tag column plus
  // every combined site header.
  const filterColumns = useMemo(() => ['Company', ...combinedHeaders], [combinedHeaders]);

  // Value lookup for a row/column, treating "Company" as the owner tag.
  const cellValue = (entry, col) => col === 'Company' ? entry.__company : entry.row[col];

  // Rows after applying the global search and any per-column filters.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(colFilters).filter(([, v]) => String(v || '').trim());
    if (!q && active.length === 0) return combinedRows;
    return combinedRows.filter(entry => {
      if (q) {
        const hit = filterColumns.some(col => String(cellValue(entry, col) ?? '').toLowerCase().includes(q));
        if (!hit) return false;
      }
      for (const [col, v] of active) {
        if (!String(cellValue(entry, col) ?? '').toLowerCase().includes(v.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [combinedRows, search, colFilters, filterColumns]);

  const filtersActive = search.trim() !== '' || Object.values(colFilters).some(v => String(v || '').trim());

  // Companies in the draft that have no matching uploaded site list —
  // surfaced so the user knows what's missing. Uses the same fuzzy match.
  const missingCompanies = useMemo(() => {
    return draftCompanies
      .filter(dc => !includedLists.some(l => companiesMatch(dc, l.company)))
      .sort((a, b) => a.localeCompare(b));
  }, [draftCompanies, includedLists]);

  function exportCsv() {
    const cols = ['Company', ...combinedHeaders];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map(esc).join(',')];
    for (const { __company, row } of filteredRows) {
      lines.push([esc(__company), ...combinedHeaders.map(h => esc(row[h]))].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-list-overview.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const wrap = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '1.25rem' };

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>Site List Overview</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0.2rem 0 0' }}>
            Combined site lists for every company with a contact in the selected draft.
          </p>
        </div>
        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Draft:
          <select
            value={draftKey}
            onChange={e => setDraftKey(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.8rem', fontFamily: 'inherit' }}
          >
            <option value="__compose__">Current draft (composing) — {composeContacts.length} contact{composeContacts.length === 1 ? '' : 's'}</option>
            {drafts.map(d => (
              <option key={d.id} value={d.id}>{d.name || '(untitled)'} — {(d.contacts || []).length} contact{(d.contacts || []).length === 1 ? '' : 's'}</option>
            ))}
          </select>
        </label>
        {combinedRows.length > 0 && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search all sites…"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--color-border)', fontFamily: 'inherit', minWidth: 200 }}
          />
        )}
        {filtersActive && (
          <button
            type="button"
            onClick={() => { setSearch(''); setColFilters({}); }}
            style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
          >
            Clear filters
          </button>
        )}
        {combinedRows.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
            title={filtersActive ? 'Exports the filtered rows shown below' : 'Exports all sites'}
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Per-company summary */}
      {includedLists.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
          {includedLists.map(({ slug, company, list }) => (
            <span key={slug} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: 999, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', fontWeight: 600 }}>
              {company} · {list.rows.length} site{list.rows.length === 1 ? '' : 's'}
            </span>
          ))}
          <span style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: 999, background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 600 }}>
            {filtersActive
              ? `${filteredRows.length} of ${combinedRows.length} site${combinedRows.length === 1 ? '' : 's'}`
              : `${combinedRows.length} total site${combinedRows.length === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      {missingCompanies.length > 0 && (
        <p style={{ fontSize: '0.74rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.5rem 0.7rem', margin: '0 0 0.75rem' }}>
          No site list uploaded for: {missingCompanies.join(', ')}. Open a company in Table View to add one.
        </p>
      )}

      {combinedRows.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', padding: '1.5rem', textAlign: 'center' }}>
          {activeContacts.length === 0
            ? 'This draft has no contacts yet. Add contacts on the Drafts tab to build a combined site list.'
            : 'None of this draft’s companies have an uploaded site list yet.'}
        </p>
      ) : (
        <div style={{ overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 8, maxHeight: 600 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.74rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#F1F5F9', textAlign: 'left', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border)', fontWeight: 700, whiteSpace: 'nowrap' }}>Company</th>
                {combinedHeaders.map(h => (
                  <th key={h} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#F8FAFC', textAlign: 'left', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
              <tr>
                {filterColumns.map((col, idx) => (
                  <th
                    key={col}
                    style={{ position: 'sticky', top: 30, left: idx === 0 ? 0 : undefined, zIndex: idx === 0 ? 3 : 1, background: idx === 0 ? '#F1F5F9' : '#F8FAFC', padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <input
                      type="text"
                      value={colFilters[col] || ''}
                      onChange={e => setColFilters(prev => ({ ...prev, [col]: e.target.value }))}
                      placeholder="Filter…"
                      style={{ width: '100%', minWidth: 80, boxSizing: 'border-box', fontSize: '0.68rem', padding: '0.2rem 0.35rem', borderRadius: 4, border: '1px solid var(--color-border)', fontFamily: 'inherit', fontWeight: 400 }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={filterColumns.length} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No sites match the current filters.
                  </td>
                </tr>
              ) : filteredRows.map(({ __company, row }, i) => (
                <tr key={i}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', padding: '0.35rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', fontWeight: 600, whiteSpace: 'nowrap' }}>{__company}</td>
                  {combinedHeaders.map(h => (
                    <td key={h} style={{ padding: '0.35rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap' }}>{String(row[h] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
