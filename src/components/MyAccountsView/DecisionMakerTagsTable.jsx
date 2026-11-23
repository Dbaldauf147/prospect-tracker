// My Accounts > "DM Tags" subtab: the My Accounts list down the side, one
// column per contact tag, and in each cell the decision makers at that
// account who also carry that tag. Above each tag, how much of Tier 1, 2
// and 3 has at least one. After them, in amber, the "maybes": decision
// makers marked Not sure for the tag in the contact popup. They're shown,
// not counted - the percentages are confirmed tags only. The matching lives in
// utils/decisionMakerTagMatrix.js; this file lays it out.
//
// It is a DataTable, so the columns can be renamed, reordered, resized,
// hidden and starred from the Columns menu, and the layout persists under
// settings.tablePrefs['my-accounts-dm-tags'].
//
// Zoom Export by Tag mirrors the My Accounts tab's Zoom Export (same four
// columns, rows on screen) cut to one tag: every Inside Sales, Qualifying
// and Client account with no Decision Maker who is a Yes, Sold or Not sold
// for the tag, ready to take into ZoomInfo. A Not sure only pulls an account
// in when nobody there is covered. A tick in the picker also leaves out the accounts whose title
// search for that tag is already logged on Bulk Add > Zoom Search Log, and
// another leaves out the Qualifying accounts.
//
// A category tag (ESG, Procurement, Utilities, Climate Risk, Capital
// Planning) that is closed out at an account, its services all Not Sold or
// N/A or the category marked N/A on the company popup, says so in the cell
// in place of the dash, and that account is left out of the tag's export.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { Badge } from '../common/Badge';
import { statusColor } from '../../utils/formatters';
import { makeDecisionMakerLookup } from '../../utils/decisionMakerCoverage';
import { tagMatrixColumns, tagColumnKey, tagMatrixRows, tagMatrixCoverage, zoomExportRowsForTag, isQualifyingStatus } from '../../utils/decisionMakerTagMatrix';
import { TIERS } from '../../data/enums';
import { buildZoomExcludedMatcher, zoomExcludedLabel } from '../../utils/zoomExportExclude';
import { ZoomExcludedCell } from './ZoomExcludedCell';
import { ZOOM_SEARCH_LOG_KEY, readLog as readZoomSearchLog, buildTitleSearchedMatcher, titlesLoggedForTag, titlesNotLoggedForTag, titleKey } from '../../utils/zoomSearchLog';
import { resolveTitleSearches } from '../../data/contactTitleSearches';
import { readWorkKey, ZOOM_SEARCH_LOG_EVENT } from '../../utils/mirroredWorkKeys';
import { OWN_TARGET_TIER_LABEL } from '../../utils/tierSource';
import { companyClosedBucketReasons, serviceBucketContext } from '../../utils/bucketServices';
import { BUCKETS } from '../ProspectModal/contactTags';
import { tagKey } from '../../utils/contactTagReview';

const TIER_INK = { 'Tier 1': '#DC2626', 'Tier 2': '#3B82F6', [OWN_TARGET_TIER_LABEL]: '#7C3AED', 'Tier 3': '#F59E0B' };

// Tier 1 first, then 2, 3, then anything else that was typed (Not on tier
// list); no tier at all sorts last. A number, because DataTable compares
// sort values numerically when it can.
const tierRank = (tier) => {
  const i = TIERS.indexOf(tier);
  if (i >= 0) return i + 1;
  return tier ? TIERS.length + 1 : null;
};

const NO_TITLES = new Set();
const NO_PICKS = {};

// The fill of a tag cell that has at least one confirmed decision maker.
const HAS_DM_CELL = { background: '#DCFCE7' };

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

// Pick a tag, get its Zoom CSV. Each tag shows how many accounts its file
// would hold, and a tag with none can't be picked. `rowsFor(tag)` is the
// file for a tag, already cut by the skip-searched and skip-Qualifying ticks.
//
// "Show the titles searched" opens, under each tag, the job titles typed into
// that tag's logged title searches. Ticking some cuts the tag's file by
// those titles instead of by "any search logged": to the companies where
// none of them has been searched yet, or to the ones where one has.
// After the logged titles come the tag's titles from Contacts > Titles that
// no logged search has used yet, marked "not searched yet".
export function ZoomByTagPicker({ tags, rowsFor, skippedFor, skipSearched, onSkipSearched, skipQualifying, onSkipQualifying, onPick, onClose,
  showTitles, onShowTitles, titlesFor, pickedTitles, onToggleTitle, onClearTitles, titleMode, onTitleMode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '1rem 1.1rem', width: showTitles ? 460 : 380, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>Zoom Export by Tag</strong>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem', lineHeight: 1.4 }}>
          Downloads the Inside Sales, Qualifying and Client accounts shown here that have no Decision Maker who is a Yes, Sold or Not sold for the tag. Columns: Company, Zoom Company ID, Zoom Company Name, Company URL.
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.75rem', color: '#334155', marginBottom: '0.6rem', cursor: 'pointer', lineHeight: 1.35 }}>
          <input type="checkbox" checked={skipSearched} onChange={e => onSkipSearched(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Leave out companies whose title search for the tag is already logged (Bulk Add &gt; Zoom Search Log)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.75rem', color: '#334155', marginBottom: '0.6rem', cursor: 'pointer', lineHeight: 1.35 }}>
          <input type="checkbox" checked={skipQualifying} onChange={e => onSkipQualifying(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Leave out companies with a Qualifying status</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.75rem', color: '#334155', marginBottom: '0.6rem', cursor: 'pointer', lineHeight: 1.35 }}>
          <input type="checkbox" checked={showTitles} onChange={e => onShowTitles(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Show the titles searched under each tag, plus the Contacts &gt; Titles ones not searched yet, and filter companies by them</span>
        </label>
        {showTitles && (
          <div style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 0.6rem 1.25rem', lineHeight: 1.5 }}>
            Tick titles under a tag, then keep the companies where
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <input type="radio" name="zoom-title-mode" checked={titleMode === 'without'} onChange={() => onTitleMode('without')} /> none of the ticked titles has been searched
            </label>
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <input type="radio" name="zoom-title-mode" checked={titleMode === 'with'} onChange={() => onTitleMode('with')} /> at least one ticked title has been searched
            </label>
          </div>
        )}
        {tags.map(tag => {
          const n = rowsFor(tag).length;
          const titles = showTitles ? titlesFor(tag) : [];
          const picked = pickedTitles[tag] || NO_TITLES;
          const byTitle = showTitles && picked.size > 0;
          const skipped = !byTitle && skipSearched ? skippedFor(tag) : 0;
          return (
            <div key={tag} style={{ marginBottom: 4 }}>
            <button
              type="button"
              disabled={n === 0}
              onClick={() => onPick(tag)}
              style={{
                display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.45rem 0.6rem',
                border: '1px solid #E2E8F0', borderRadius: 6, background: n ? '#fff' : '#F8FAFC', fontFamily: 'inherit',
                fontSize: '0.8rem', color: n ? '#1E293B' : '#94A3B8', cursor: n ? 'pointer' : 'default', textAlign: 'left',
              }}
            >
              <span>{tag}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', color: n ? '#3B82F6' : '#CBD5E1' }}>
                {n} account{n === 1 ? '' : 's'}
                {skipped > 0 && <span style={{ color: '#94A3B8' }}> ({skipped} already searched)</span>}
                {byTitle && <span style={{ color: '#94A3B8' }}> ({titleMode === 'with' ? 'searched for' : 'not searched for'} {picked.size} title{picked.size === 1 ? '' : 's'})</span>}
              </span>
            </button>
            {/* A tag nobody has run a title search for has nothing to list,
                and a box saying so under each of them buried the ones that do. */}
            {showTitles && titles.length > 0 && (
              <div style={{ padding: '0.3rem 0.6rem 0.4rem', border: '1px solid #E2E8F0', borderTop: 'none', borderRadius: '0 0 6px 6px', background: '#F8FAFC' }}>
                {(
                  <>
                    {titles.map(t => (
                      <label
                        key={t.title}
                        title={t.unlogged
                          ? `On Contacts > Titles under ${t.bucket}, and not in any logged search for this tag yet`
                          : `Typed into ${t.searches} logged search${t.searches === 1 ? '' : 'es'} covering ${t.companies} compan${t.companies === 1 ? 'y' : 'ies'}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#334155', cursor: 'pointer', lineHeight: 1.6 }}
                      >
                        <input type="checkbox" checked={picked.has(titleKey(t.title))} onChange={() => onToggleTitle(tag, t.title)} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        {t.unlogged
                          ? <span style={{ color: '#B45309', fontWeight: 600 }}>not searched yet</span>
                          : <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{t.companies} compan{t.companies === 1 ? 'y' : 'ies'}</span>}
                      </label>
                    ))}
                    {picked.size > 0 && (
                      <button type="button" onClick={() => onClearTitles(tag)} style={{ marginTop: 2, padding: 0, border: 'none', background: 'none', color: '#3B82F6', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear ticked titles</button>
                    )}
                  </>
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DecisionMakerTagsTable({ accounts, contacts, prospects, settings, updateSettings, onSelect, onZoomExport }) {
  // The rows the column filters leave on screen, so the export matches
  // Export Excel the way the My Accounts tab's Zoom Export does.
  const [onScreen, setOnScreen] = useState(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [skipSearched, setSkipSearched] = useState(true);
  const [skipQualifying, setSkipQualifying] = useState(true);
  // The picker's title filter: whether the titles are showing, which are
  // ticked under each tag (by titleKey), and which side of them to keep.
  const [showTitles, setShowTitles] = useState(false);
  const [pickedTitles, setPickedTitles] = useState({});
  const [titleMode, setTitleMode] = useState('without');
  // The Zoom Search Log, re-read when it changes elsewhere.
  const [zoomLog, setZoomLog] = useState(() => readZoomSearchLog(readWorkKey(ZOOM_SEARCH_LOG_KEY)));
  useEffect(() => {
    const reload = () => setZoomLog(readZoomSearchLog(readWorkKey(ZOOM_SEARCH_LOG_KEY)));
    window.addEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
    return () => window.removeEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
  }, []);
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const dmLookup = useMemo(
    () => (contacts ? makeDecisionMakerLookup(contacts, { localFields, links, exclusions }) : null),
    [contacts, localFields, links, exclusions],
  );
  const tags = useMemo(() => tagMatrixColumns(contacts || []), [contacts]);
  const review = settings?.contactTagReview || null;
  // A-Z going in, so the tier sort (stable) keeps each tier alphabetical.
  const matrixRows = useMemo(() => tagMatrixRows(
    [...(accounts || [])].sort((a, b) => String(a.company || '').localeCompare(String(b.company || ''))),
    dmLookup, tags, review,
  ), [accounts, dmLookup, tags, review]);
  // Per row, the tags whose category is closed out at the company: every
  // service tagged to it Not Sold or N/A, or the category marked N/A. The
  // rule the company popup's By Category table and Company Data use
  // (bucketServices), so the three can't disagree. Only the tags that are a
  // category (BUCKETS) can be closed this way.
  const bucketCtx = useMemo(() => serviceBucketContext(settings), [settings]);
  const prospectById = useMemo(() => new Map((prospects || []).map(p => [p.id, p])), [prospects]);
  const rows = useMemo(() => {
    const bucketKeyToColumn = new Map();
    for (const b of BUCKETS) {
      const tag = tags.find(t => tagKey(t) === tagKey(b.label));
      if (tag) bucketKeyToColumn.set(b.key, tagColumnKey(tag));
    }
    return matrixRows.map((r) => {
      const record = prospectById.get(r.id) || r;
      const reasons = companyClosedBucketReasons(record, bucketCtx, BUCKETS, {
        contacts: dmLookup ? dmLookup.forAccount(record) : [], tagReview: review || {},
      });
      const closedByTag = {};
      for (const [bucketKey, reason] of reasons) {
        const col = bucketKeyToColumn.get(bucketKey);
        if (col) closedByTag[col] = reason;
      }
      return { ...r, closedByTag };
    });
  }, [matrixRows, tags, prospectById, bucketCtx, dmLookup, review]);
  const coverage = useMemo(() => tagMatrixCoverage(rows, tags), [rows, tags]);
  // Same match the Zoom CSV download drops rows by, so the column says
  // exactly which accounts the export will leave out.
  const isZoomExcluded = useMemo(() => buildZoomExcludedMatcher(prospects || accounts), [prospects, accounts]);
  const zoomExcludedOf = useCallback((r) => isZoomExcluded({ id: r.id, company: r.company, zoomId: r.zoomCompanyId }), [isZoomExcluded]);

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
      // Shows tierLabel (Strategic Target for a "Not on tier list, but Dan
      // target" company), which sorts between Tier 2 and Tier 3.
      key: 'myTier', label: 'Tier', defaultWidth: 110,
      getSortValue: r => (r.tierLabel === OWN_TARGET_TIER_LABEL ? 2.5 : tierRank(r.myTier)),
      getFilterValue: r => r.tierLabel || r.myTier || '',
      render: r => {
        const label = r.tierLabel || r.myTier;
        return <span style={{ fontWeight: 600, color: TIER_INK[label] || '#64748B', whiteSpace: 'nowrap' }}>{label || '-'}</span>;
      },
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
      key: 'zoomExcluded', label: 'ZoomInfo', defaultWidth: 110,
      headerTitle: 'Whether the company is excluded from ZoomInfo exports (the Exclude from ZoomInfo button on its company popup). Excluded accounts are left out of Zoom Export by Tag.',
      getSortValue: r => (zoomExcludedOf(r) ? 1 : 0),
      getFilterValue: r => zoomExcludedLabel(zoomExcludedOf(r)),
      exportValue: r => zoomExcludedLabel(zoomExcludedOf(r)),
      render: r => <ZoomExcludedCell excluded={zoomExcludedOf(r)} />,
    },
    {
      key: 'dmCount', label: 'Decision Makers', defaultWidth: 110,
      headerTitle: 'Contacts at the account tagged Decision Maker, whatever else they are tagged',
      render: r => <span style={{ color: r.dmCount ? '#1E293B' : '#CBD5E1' }}>{r.dmCount || '-'}</span>,
    },
    ...tags.map(tag => {
      const key = tagColumnKey(tag);
      const maybes = r => r.maybeByTag?.[key] || [];
      const closed = r => r.closedByTag?.[key] || null;
      // A closed-out cell with nobody in it reads as its reason (N/A, Not
      // Sold), so it filters and exports as that rather than as a blank.
      const value = r => [
        namesOf(r.byTag[key]),
        ...maybes(r).map(c => `${nameOf(c)} (maybe)`),
      ].filter(Boolean).join(', ') || closed(r)?.label || '';
      return {
        key,
        label: tag,
        defaultWidth: 160,
        headerTitle: `Decision makers also tagged ${tag} (the cell turns green when there is one), then in amber the ones marked Not sure for it (shown, not counted in the percentages). N/A or Not Sold means ${tag} is closed out at the company, so there is nobody to look for`,
        renderHeader: label => (
          <div style={{ display: 'inline-block', verticalAlign: 'top' }}>
            <div>{label}</div>
            <TierCoverage coverage={coverage[key]} />
          </div>
        ),
        getFilterValue: value,
        exportValue: value,
        // Confirmed first; a maybe-only cell sorts just above an empty one.
        getSortValue: r => (r.byTag[key].length + maybes(r).length / 100) || null,
        // Green once the account has a confirmed decision maker for the
        // tag. A maybe-only cell stays plain: it isn't counted as mapped.
        cellStyle: r => (r.byTag[key].length ? HAS_DM_CELL : undefined),
        render: r => {
          const list = r.byTag[key];
          const maybe = maybes(r);
          if (!list.length && !maybe.length) {
            const why = closed(r);
            if (!why) return <span style={{ color: '#CBD5E1' }}>-</span>;
            return (
              <span
                title={`${why.why} No contact search needed.`}
                style={{ padding: '1px 7px', borderRadius: 999, background: '#F1F5F9', color: '#64748B', fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}
              >{why.label}</span>
            );
          }
          const line = (c) => [nameOf(c), c.jobtitle].filter(Boolean).join(', ');
          return (
            <span title={[...list.map(line), ...maybe.map(c => `${line(c)} (maybe: marked Not sure)`)].join('\n')}>
              {namesOf(list)}
              {maybe.length > 0 && (
                <span style={{ color: '#B45309', fontStyle: 'italic' }}>
                  {list.length ? ', ' : ''}{maybe.map(c => `${nameOf(c)} (maybe)`).join(', ')}
                </span>
              )}
            </span>
          );
        },
      };
    }),
  ], [tags, coverage, zoomExcludedOf]);

  const zoomSource = onScreen || rows;
  // Per tag: the accounts the file would hold before the skip-searched tick
  // (Qualifying already dropped when that box is ticked), and how many of
  // them have that tag's title search logged.
  const zoomByTag = useMemo(() => {
    const out = new Map();
    for (const tag of tags) {
      const all = zoomExportRowsForTag(zoomSource, tagColumnKey(tag))
        .filter(r => !skipQualifying || !isQualifyingStatus(r.status));
      const searched = buildTitleSearchedMatcher(zoomLog.searches, tag);
      const fresh = all.filter(r => {
        const p = prospectById.get(r.id);
        return !searched({
          company: p?.company || r.company,
          zoomCompanyId: p?.zoomCompanyId || r.zoomCompanyId,
          zoomCompanyName: p?.zoomCompanyName || r.zoomCompanyName,
        });
      });
      // With titles ticked under the tag, the cut is by those titles
      // instead: the accounts where one of them has been searched, and the
      // accounts where none has.
      const picked = showTitles ? pickedTitles[tag] : null;
      let withTitle = null;
      let withoutTitle = null;
      if (picked?.size) {
        const titleSearched = buildTitleSearchedMatcher(zoomLog.searches, tag, picked);
        withTitle = [];
        withoutTitle = [];
        for (const r of all) {
          const p = prospectById.get(r.id);
          (titleSearched({
            company: p?.company || r.company,
            zoomCompanyId: p?.zoomCompanyId || r.zoomCompanyId,
            zoomCompanyName: p?.zoomCompanyName || r.zoomCompanyName,
          }) ? withTitle : withoutTitle).push(r);
        }
      }
      out.set(tag, { all, fresh, withTitle, withoutTitle });
    }
    return out;
  }, [tags, zoomSource, zoomLog, prospectById, skipQualifying, showTitles, pickedTitles]);
  // The Contacts > Titles searches: their titles not yet in any logged
  // search for a tag are listed after the logged ones.
  const titleBuckets = useMemo(() => resolveTitleSearches(settings), [settings]);
  const titlesByTag = useMemo(
    () => new Map(tags.map(tag => [tag, [
      ...titlesLoggedForTag(zoomLog.searches, tag),
      ...titlesNotLoggedForTag(zoomLog.searches, tag, titleBuckets, tags),
    ]])),
    [tags, zoomLog, titleBuckets],
  );
  const filteredByTitle = (tag) => !!zoomByTag.get(tag)?.withTitle;
  const rowsFor = (tag) => {
    const e = zoomByTag.get(tag);
    if (e?.withTitle) return titleMode === 'with' ? e.withTitle : e.withoutTitle;
    return (skipSearched ? e?.fresh : e?.all) || [];
  };
  const toggleTitle = (tag, title) => setPickedTitles(prev => {
    const next = new Set(prev[tag] || []);
    const k = titleKey(title);
    if (next.has(k)) next.delete(k); else next.add(k);
    return { ...prev, [tag]: next };
  });
  const skippedFor = (tag) => {
    const e = zoomByTag.get(tag);
    return e ? e.all.length - e.fresh.length : 0;
  };
  function exportTag(tag) {
    const picked = rowsFor(tag);
    setZoomOpen(false);
    if (picked.length === 0) {
      alert(filteredByTitle(tag)
        ? (titleMode === 'with'
          ? `None of the accounts left for ${tag} has had the ticked titles searched.`
          : `Every account left for ${tag} has already had one of the ticked titles searched.`)
        : skipSearched && skippedFor(tag)
        ? `Every account left for ${tag} already has its ${tag} title search logged. Untick the box to include them.`
        : skipQualifying
        ? `Every Inside Sales and Client account shown here already has a Decision Maker who is a Yes, Sold or Not sold for ${tag}. Untick the Qualifying box to include Qualifying accounts.`
        : `Every Inside Sales, Qualifying and Client account shown here already has a Decision Maker who is a Yes, Sold or Not sold for ${tag}.`);
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
        title: 'Pick a tag and download a CSV of the Inside Sales, Qualifying and Client accounts shown here with no Decision Maker who is a Yes, Sold or Not sold for it: Company, Zoom Company ID, Zoom Company Name, Company URL',
        onClick: () => setZoomOpen(true),
      }] : undefined}
      gridLines
      onRowClick={r => { if (!r._oppsOnly) onSelect(r); }}
      emptyMessage="No accounts match these filters"
      settings={settings}
      updateSettings={updateSettings}
    />
    {zoomOpen && (
      <ZoomByTagPicker
        tags={tags}
        rowsFor={rowsFor}
        skippedFor={skippedFor}
        skipSearched={skipSearched}
        onSkipSearched={setSkipSearched}
        skipQualifying={skipQualifying}
        onSkipQualifying={setSkipQualifying}
        onPick={exportTag}
        onClose={() => setZoomOpen(false)}
        showTitles={showTitles}
        onShowTitles={setShowTitles}
        titlesFor={(tag) => titlesByTag.get(tag) || []}
        pickedTitles={showTitles ? pickedTitles : NO_PICKS}
        onToggleTitle={toggleTitle}
        onClearTitles={(tag) => setPickedTitles(prev => ({ ...prev, [tag]: new Set() }))}
        titleMode={titleMode}
        onTitleMode={setTitleMode}
      />
    )}
    </>
  );
}
