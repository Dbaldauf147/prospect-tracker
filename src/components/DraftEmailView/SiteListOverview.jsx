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

// Suffix-stripped, punctuation-folded form so slightly different company
// spellings still line up. Mirrors the normaliser used elsewhere in
// DraftEmailView for {companyType} resolution.
function normCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|corp|co|lp|gmbh|plc|sa|ag)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  // Re-read the composer contacts whenever this tab renders so switching
  // back to it reflects the latest selection.
  const composeContacts = readComposeContacts();

  const activeContacts = useMemo(() => {
    if (draftKey === '__compose__') return composeContacts;
    const d = drafts.find(x => x.id === draftKey);
    return d?.contacts || [];
  }, [draftKey, composeContacts, drafts]);

  // Normalised set of company names present in the chosen draft.
  const draftCompanyNorms = useMemo(() => {
    const set = new Set();
    for (const c of activeContacts) {
      const n = normCompany(c?.company);
      if (n) set.add(n);
    }
    return set;
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

  // Site lists whose company has a contact in the draft.
  const includedLists = useMemo(() => {
    const out = [];
    for (const [slug, list] of Object.entries(siteLists)) {
      if (!list || !Array.isArray(list.rows) || list.rows.length === 0) continue;
      const company = list.company || prospectBySlug.get(slug) || slug;
      if (draftCompanyNorms.has(normCompany(company))) {
        out.push({ slug, company, list });
      }
    }
    return out.sort((a, b) => a.company.localeCompare(b.company));
  }, [siteLists, prospectBySlug, draftCompanyNorms]);

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

  // Companies in the draft that have no uploaded site list — surfaced so the
  // user knows what's missing.
  const missingCompanies = useMemo(() => {
    const haveNorms = new Set(includedLists.map(l => normCompany(l.company)));
    const names = new Map();
    for (const c of activeContacts) {
      const raw = String(c?.company || '').trim();
      if (!raw) continue;
      const n = normCompany(raw);
      if (!n || haveNorms.has(n) || names.has(n)) continue;
      names.set(n, raw);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [activeContacts, includedLists]);

  function exportCsv() {
    const cols = ['Company', ...combinedHeaders];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map(esc).join(',')];
    for (const { __company, row } of combinedRows) {
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
          <button
            type="button"
            onClick={exportCsv}
            style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
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
            {combinedRows.length} total site{combinedRows.length === 1 ? '' : 's'}
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
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 2, background: '#F1F5F9', textAlign: 'left', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border)', fontWeight: 700, whiteSpace: 'nowrap' }}>Company</th>
                {combinedHeaders.map(h => (
                  <th key={h} style={{ position: 'sticky', top: 0, background: '#F8FAFC', textAlign: 'left', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--color-border)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {combinedRows.map(({ __company, row }, i) => (
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
