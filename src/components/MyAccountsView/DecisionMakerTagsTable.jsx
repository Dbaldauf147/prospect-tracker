// My Accounts > "DM Tags" subtab: the My Accounts list down the side, one
// column per contact tag, and in each cell the decision makers at that
// account who also carry that tag. Above each tag, how much of Tier 1, 2
// and 3 has at least one. The matching lives in
// utils/decisionMakerTagMatrix.js; this file lays it out.
//
// It is a DataTable, so the columns can be renamed, reordered, resized,
// hidden and starred from the Columns menu, and the layout persists under
// settings.tablePrefs['my-accounts-dm-tags'].
//
// Zoom Export by Tag mirrors the My Accounts tab's Zoom Export (same four
// columns, same Inside Sales rows on screen) cut to one tag: the accounts
// with no decision maker carrying it yet, i.e. the gaps behind that
// column's percentages, ready to take into ZoomInfo.
import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { Badge } from '../common/Badge';
import { statusColor } from '../../utils/formatters';
import { makeDecisionMakerLookup } from '../../utils/decisionMakerCoverage';
import { tagMatrixColumns, tagColumnKey, tagMatrixRows, tagMatrixCoverage } from '../../utils/decisionMakerTagMatrix';
import { TIERS } from '../../data/enums';

const TIER_INK = { 'Tier 1': '#DC2626', 'Tier 2': '#3B82F6', 'Tier 3': '#F59E0B' };

// Tier 1 first, then 2, 3, then anything else that was typed (Not on tier
// list); no tier at all sorts last. A number, because DataTable compares
// sort values numerically when it can.
const tierRank = (tier) => {
  const i = TIERS.indexOf(tier);
  if (i >= 0) return i + 1;
  return tier ? TIERS.length + 1 : null;
};

const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');
const namesOf = (list) => (list || []).map(nameOf).join(', ');

// The three tier percentages under a tag's name.
function TierCoverage({ coverage }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 3, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
      {TIERS.map(tier => {
        const c = coverage?.[tier];
        const pct = c?.pct;
        return (
          <span
            key={tier}
            title={c?.total ? `${tier}: ${c.mapped} of ${c.total} accounts have a decision maker with this tag` : `No ${tier} accounts on screen`}
            style={{ fontSize: '0.64rem', color: pct == null ? '#CBD5E1' : TIER_INK[tier], fontVariantNumeric: 'tabular-nums' }}
          >
            T{tier.slice(-1)} {pct == null ? '-' : `${pct}%`}
          </span>
        );
      })}
    </div>
  );
}

// The Inside Sales rows with nobody in `key`'s column: what one tag's Zoom
// export holds.
const zoomRowsFor = (rows, key) => rows.filter(r => r.status === 'Inside Sales' && !(r.byTag[key] || []).length);

// Pick a tag, get its Zoom CSV. Each tag shows how many accounts its file
// would hold, and a tag with none can't be picked.
function ZoomByTagPicker({ tags, rows, onPick, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '1rem 1.1rem', width: 380, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>Zoom Export by Tag</strong>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem', lineHeight: 1.4 }}>
          Downloads the Inside Sales accounts shown here that have no decision maker with the tag yet: Company, Zoom Company ID, Zoom Company Name, Zoom Website.
        </div>
        {tags.map(tag => {
          const n = zoomRowsFor(rows, tagColumnKey(tag)).length;
          return (
            <button
              key={tag}
              type="button"
              disabled={n === 0}
              onClick={() => onPick(tag)}
              style={{
                display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.45rem 0.6rem', marginBottom: 4,
                border: '1px solid #E2E8F0', borderRadius: 6, background: n ? '#fff' : '#F8FAFC', fontFamily: 'inherit',
                fontSize: '0.8rem', color: n ? '#1E293B' : '#94A3B8', cursor: n ? 'pointer' : 'default', textAlign: 'left',
              }}
            >
              <span>{tag}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', color: n ? '#3B82F6' : '#CBD5E1' }}>
                {n} account{n === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DecisionMakerTagsTable({ accounts, contacts, settings, updateSettings, onSelect, onZoomExport }) {
  // The rows the column filters leave on screen, so the export matches
  // Export Excel the way the My Accounts tab's Zoom Export does.
  const [onScreen, setOnScreen] = useState(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const dmLookup = useMemo(
    () => (contacts ? makeDecisionMakerLookup(contacts, { localFields, links, exclusions }) : null),
    [contacts, localFields, links, exclusions],
  );
  const tags = useMemo(() => tagMatrixColumns(contacts || []), [contacts]);
  // A-Z going in, so the tier sort (stable) keeps each tier alphabetical.
  const rows = useMemo(() => tagMatrixRows(
    [...(accounts || [])].sort((a, b) => String(a.company || '').localeCompare(String(b.company || ''))),
    dmLookup, tags,
  ), [accounts, dmLookup, tags]);
  const coverage = useMemo(() => tagMatrixCoverage(rows, tags), [rows, tags]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Account', defaultWidth: 220, sticky: true,
      render: r => (
        <span style={{ fontWeight: 600, color: '#1E293B' }}>
          {r.company}
          {r.status === 'Client' && <span style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 700, color: '#059669' }}>CLIENT</span>}
        </span>
      ),
    },
    {
      key: 'myTier', label: 'Tier', defaultWidth: 80,
      getSortValue: r => tierRank(r.myTier),
      render: r => <span style={{ fontWeight: 600, color: TIER_INK[r.myTier] || '#64748B' }}>{r.myTier || '-'}</span>,
    },
    {
      key: 'status', label: 'Status', defaultWidth: 130,
      render: r => (r.status ? <Badge label={r.status} color={statusColor(r.status)} /> : <span style={{ color: '#CBD5E1' }}>-</span>),
    },
    {
      key: 'type', label: 'Company Type', defaultWidth: 170,
      render: r => (r.type ? <span>{r.type}</span> : <span style={{ color: '#CBD5E1' }}>-</span>),
    },
    {
      key: 'dmCount', label: 'Decision Makers', defaultWidth: 110,
      headerTitle: 'Contacts at the account tagged Decision Maker, whatever else they are tagged',
      render: r => <span style={{ color: r.dmCount ? '#1E293B' : '#CBD5E1' }}>{r.dmCount || '-'}</span>,
    },
    ...tags.map(tag => {
      const key = tagColumnKey(tag);
      const value = r => namesOf(r.byTag[key]);
      return {
        key,
        label: tag,
        defaultWidth: 160,
        headerTitle: `Decision makers also tagged ${tag}`,
        renderHeader: label => (
          <div style={{ display: 'inline-block', verticalAlign: 'top' }}>
            <div>{label}</div>
            <TierCoverage coverage={coverage[key]} />
          </div>
        ),
        getFilterValue: value,
        exportValue: value,
        getSortValue: r => r.byTag[key].length || null,
        render: r => {
          const list = r.byTag[key];
          if (!list.length) return <span style={{ color: '#CBD5E1' }}>-</span>;
          return (
            <span title={list.map(c => [nameOf(c), c.jobtitle].filter(Boolean).join(', ')).join('\n')}>
              {namesOf(list)}
            </span>
          );
        },
      };
    }),
  ], [tags, coverage]);

  const zoomSource = onScreen || rows;
  function exportTag(tag) {
    const picked = zoomRowsFor(zoomSource, tagColumnKey(tag));
    setZoomOpen(false);
    if (picked.length === 0) {
      alert(`Every Inside Sales account shown here already has a decision maker tagged ${tag}.`);
      return;
    }
    const slug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    onZoomExport(picked, `my-accounts-dm-tags-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (!contacts) {
    return <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '1rem' }}>Loading contacts…</div>;
  }
  return (
    <>
    <DataTable
      tableId="my-accounts-dm-tags"
      exportFileName="My Accounts DM Tags"
      columns={columns}
      rows={rows}
      // Opens Tier 1 first, A-Z within each tier.
      defaultSort={{ key: 'myTier', direction: 'asc' }}
      alwaysVisible={['company']}
      enableColumnFilters
      onFilteredRowsChange={setOnScreen}
      toolbarActions={onZoomExport ? [{
        key: 'zoom-export-by-tag',
        label: 'Zoom Export by Tag',
        title: 'Pick a tag and download a CSV of the Inside Sales accounts shown here with no decision maker carrying it: Company, Zoom Company ID, Zoom Company Name, Zoom Website',
        onClick: () => setZoomOpen(true),
      }] : undefined}
      gridLines
      onRowClick={r => { if (!r._oppsOnly) onSelect(r); }}
      emptyMessage="No accounts match these filters"
      settings={settings}
      updateSettings={updateSettings}
    />
    {zoomOpen && <ZoomByTagPicker tags={tags} rows={zoomSource} onPick={exportTag} onClose={() => setZoomOpen(false)} />}
    </>
  );
}
