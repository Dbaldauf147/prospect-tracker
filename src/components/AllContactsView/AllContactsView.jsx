// All Contacts page — same layout / interactions / popup flow as the
// Key / Active / Client tabs, surfacing every contact that would
// appear on at least one of those rosters. Implemented as a wrapper
// around KeyContactsView with a combined selector, so clicking a
// name opens the same Edit HubSpot Contact popup the dedicated tabs
// use, the Met In Person / Tags / Events columns work identically,
// the All Contacts ↔ By Company toggle is preserved, and column
// widths / sort / visibility prefs persist independently under the
// "all-contacts" storage prefix.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { useOppsRecords, useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isLocalTagVerdict, tagAnswerFrom, tagKey, findTagRecord } from '../../utils/contactTagReview';
import { makeRosterGates, rosterTagCoverage } from '../../utils/contactRosters';

// A contact's Dan's Tags as individual values. Stored as one ';'-joined
// string (the separator the tag picker and the bulk tag editor write), so
// the Tags column's own value filter can only match the whole combination —
// "Decision Maker;Met In Person" is a single distinct value there. Splitting
// is what lets the tag filter below match a contact by any one of its tags.
function contactTagList(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

// The five answers the contact popup records against a tag, in the order the
// filter offers them. Sold and Not sold sit together: they're the two ends of
// one question — has this account bought what this person owns? — so reading
// them side by side is the point.
const TAG_STATUSES = [
  { key: 'yes',     label: 'Yes',      bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Contacts carrying this tag with no sold / not sold answer recorded yet' },
  { key: 'sold',    label: 'Sold',     bg: '#CCFBF1', border: '#5EEAD4', color: '#115E59', tip: 'Contacts who own this area at a company that has bought it. They keep the tag, so a plain pull of it returns them too' },
  { key: 'notsold', label: 'Not sold', bg: '#EEF2FF', border: '#A5B4FC', color: '#3730A3', tip: 'Contacts who own this area but whose company hasn\'t bought it yet — held off in the contact popup, so they stay out of a plain pull of this tag. This is the list of accounts still to sell on it' },
  { key: 'unsure',  label: 'Not sure', bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Contacts answered "Not sure" for this tag in the contact popup' },
  { key: 'no',      label: 'No',       bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B', tip: 'Contacts answered "No" for this tag in the contact popup' },
];

// The statuses a freshly-picked tag starts on — the contacts carrying it and
// the ones still undecided, which together are the list there's work in. The
// other three are one click away on their own pills.
const DEFAULT_TAG_STATUSES = ['yes', 'unsure'];
const DEFAULT_TAG_STATUS_LABEL = DEFAULT_TAG_STATUSES
  .map(k => TAG_STATUSES.find(s => s.key === k)?.label)
  .filter(Boolean)
  .join(' + ');

// One contact's answer for one tag, resolved by the same helper the contact
// popup's table runs on, so the pill here and the row there can't disagree.
// The tag being present is the Yes — HubSpot only ever holds tags that apply
// — while the rest live in settings.contactTagReview, keyed by contact then
// by tag. No answer at all returns ''.
//
// Sold is the one recorded answer that keeps the tag on, so it's the one that
// still turns up in a plain pull of the tag; every other answer takes the tag
// off, which is why those contacts can only be reached through their status
// pill.
function contactTagStatus(c, tag, reviewMap) {
  if (!tag) return '';
  const key = tagKey(tag);
  const tagged = contactTagList(c).some(t => tagKey(t) === key);
  const cid = c?.id ?? c?.vid;
  const answers = cid == null ? null : reviewMap?.[cid];
  // Keyed by the tag as whoever recorded it spelled it — the popup writes the
  // vocabulary's spelling, the bulk editor HubSpot's — so it's matched the
  // same way the tag filter itself matches, on tagKey.
  const stored = findTagRecord(answers, tag);
  return tagAnswerFrom(tagged, isLocalTagVerdict(stored) ? stored : '');
}

export function AllContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);

  // ---- Rosters -----------------------------------------------------
  // The Key / Active / Client / Key Prospect gates, mirrored from the
  // dedicated tabs and shared with the Prospecting tab's Tagged readout
  // (see utils/contactRosters.js). The Clients-tab maps are read from that
  // tab's own stores and re-read on the events it fires, so a company
  // switched to "Cancelling for Sure" or ticked "Don't Track" drops off this
  // page without a reload.
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();

  // "Show hidden contacts" toggle. Same review-mode behaviour the
  // dedicated Active page exposes — when on, the page becomes a list
  // of every Hide-tagged contact that would otherwise have qualified
  // for Key / Active / Client, so the user can audit and un-hide via
  // the contact popup. Persisted in localStorage so the toggle
  // survives a refresh.
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem('all-contacts:show-hidden') === '1'; } catch { return false; }
  });

  // The "what this page is" blurb. Collapsed by default — it's reference
  // material you read once, and left open it pushes the pills and the table
  // down every visit. Persisted so opening it sticks until it's closed again.
  const [showAbout, setShowAbout] = useState(() => {
    try { return localStorage.getItem('all-contacts:show-about') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('all-contacts:show-about', showAbout ? '1' : '0'); } catch {}
  }, [showAbout]);

  // Clickable category filter driven by the Totals pills: the set of lit
  // labels ('Key' / 'Active' / 'Client' / 'Key Prospect'). Empty = show
  // all. Pills toggle independently and several can be lit at once —
  // clicking a lit one turns it back off, and "All" clears the lot. The
  // labels union rather than intersect (see KeyContactsView's
  // categoryFilter prop): the categories overlap heavily, so an
  // intersection would leave most pairs empty.
  const [categoryFilter, setCategoryFilter] = useState(() => new Set());
  const toggleCategory = useCallback((cat) => {
    if (cat === null) { setCategoryFilter(new Set()); return; }
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);
  // Chosen Dan's Tag, or '' for no tag gate. Transient like categoryFilter
  // (not persisted) — it's an exploration filter, not a page preference.
  const [tagFilter, setTagFilter] = useState('');
  // Which of the five tag answers to show, as a Set of TAG_STATUSES keys.
  // Empty means no status gate — the tag filter behaves as it always has,
  // showing the contacts that carry the tag. Transient, like the tag itself.
  const [tagStatusFilter, setTagStatusFilter] = useState(() => new Set());
  // Choosing a tag starts on the answers worth working: the people who carry
  // it and the ones nobody has decided about yet. Sold is settled business,
  // Not sold is deliberately held off and No is a decided no — all three are
  // one pill away, but none of them is what you opened the tag to see.
  // Clearing the tag drops the statuses with it, since an answer only means
  // anything against a tag.
  const pickTag = useCallback((tag) => {
    setTagFilter(tag);
    setTagStatusFilter(tag ? new Set(DEFAULT_TAG_STATUSES) : new Set());
  }, []);

  useEffect(() => {
    try { localStorage.setItem('all-contacts:show-hidden', showHidden ? '1' : '0'); } catch {}
  }, [showHidden]);

  // The gates the page runs on, and the inverted set behind the Show Hidden
  // badge. Two calls rather than two hand-written copies of the same logic:
  // the only thing that differs is which side of the Hide tag counts.
  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden],
  );
  const hiddenGates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden: true }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  // Visible-mode gates for the Totals pills: the counts should say what each
  // dedicated tab would surface today, not what the inverted review view is
  // showing. Reuses `gates` when Show Hidden is already off.
  const visibleGates = useMemo(
    () => (showHidden
      ? makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden: false })
      : gates),
    [showHidden, gates, prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  const { rosterSelector } = gates;

  // (combinedSelector — the roster gate plus the tag gate — is defined with
  // the tag list further down, since it needs the loaded HubSpot cache.)

  // Categorisation function for the Category column. Returns the
  // array of labels (Key / Active / Client / Key Prospect) the contact
  // qualifies for so KeyContactsView can render a colored pill per label.
  const categorizeContact = useCallback((c) => gates.categorize(c), [gates]);

  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache().then(c => { if (!cancelled) setHubspotContacts(c?.contacts || []); }).catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Count of hide-tagged contacts that WOULD qualify if not hidden, so the
  // toggle pill shows the user how many they'd uncover — the same gates with
  // the Hide check flipped. The cancelling exclusion applies here too, so the
  // badge doesn't promise contacts that Show Hidden wouldn't surface.
  const hiddenCount = useMemo(() => {
    if (!hubspotContacts.length) return 0;
    let n = 0;
    for (const c of hubspotContacts) if (hiddenGates.rosterSelector(c)) n += 1;
    return n;
  }, [hubspotContacts, hiddenGates]);

  // The tag review answers — the No / Not sure the contact popup records,
  // which HubSpot can't hold. Memoized: the `|| {}` fallback would otherwise
  // hand a fresh object to every memo and selector below on each render,
  // re-filtering and re-counting the whole page.
  const tagReviewMap = useMemo(() => settings?.contactTagReview || {}, [settings?.contactTagReview]);

  // Per-category totals across the loaded HubSpot cache, plus how far
  // through the tag vocabulary each group has been worked. Uses the
  // visible-mode gates (showHidden = false) so the numbers reflect what each
  // dedicated tab would surface today, not the inverted "review hidden"
  // view. Each category is counted independently and the total is the
  // de-duped union across all four.
  //
  // The Prospecting tab prints the same coverage under its market-updates
  // step, off this same function — the two read one number, not two.
  const coverage = useMemo(
    () => rosterTagCoverage({
      contacts: hubspotContacts,
      gates: visibleGates,
      tagReviewMap,
      localFields: settings?.contactLocalFields || null,
    }),
    [hubspotContacts, visibleGates, tagReviewMap, settings?.contactLocalFields],
  );
  const categoryCounts = useMemo(() => ({
    key: coverage.key.contacts,
    active: coverage.active.contacts,
    client: coverage.client.contacts,
    keyProspect: coverage.keyProspect.contacts,
    total: coverage.all.contacts,
    cancelling: coverage.cancelling,
    untracked: coverage.untracked,
    tags: {
      key: coverage.key, active: coverage.active, client: coverage.client,
      keyProspect: coverage.keyProspect, total: coverage.all,
    },
  }), [coverage]);

  // Every distinct tag worn by a contact on this page, with how many wear
  // it, most-used first. Derived from the roster gate rather than the full
  // HubSpot cache so the list only offers tags that actually return rows,
  // and counted before the tag gate so the numbers don't collapse to the
  // current selection.
  //
  // Tags that differ only in spelling — case or spacing, so "Efficiency /
  // Renewables" and "Efficiency/Renewables" — are one entry, shown in
  // whichever spelling the most contacts use (ties broken alphabetically, so
  // the label doesn't hinge on cache order). Matching collapses both either
  // way — the
  // spelling only decides what the dropdown reads.
  //
  // A tag someone has been answered No / Not sure / Not sold on is offered
  // too, even with nobody left carrying it. Every one of those answers takes
  // the tag off, so a list built from carriers alone would drop the tag out
  // of the dropdown at exactly the moment the answers become worth looking
  // at — you could hold a contact off Procurement and then have no way to
  // pick Procurement and see who you're holding. The count stays the number
  // of contacts CARRYING the tag, so it keeps meaning the same thing; the
  // status pills below break out the rest once a tag is chosen.
  const tagOptions = useMemo(() => {
    const byKey = new Map();
    const touch = (key) => {
      let hit = byKey.get(key);
      if (!hit) { hit = { count: 0, spellings: new Map() }; byKey.set(key, hit); }
      return hit;
    };
    for (const c of hubspotContacts) {
      if (!rosterSelector(c)) continue;
      const seenHere = new Set();
      for (const tag of contactTagList(c)) {
        const key = tagKey(tag);
        // A tag repeated within one contact still only counts once.
        if (seenHere.has(key)) continue;
        seenHere.add(key);
        const hit = touch(key);
        hit.count += 1;
        hit.spellings.set(tag, (hit.spellings.get(tag) || 0) + 1);
      }
      const cid = c?.id ?? c?.vid;
      const answers = cid == null ? null : tagReviewMap?.[cid];
      if (!answers || typeof answers !== 'object') continue;
      for (const [tag, v] of Object.entries(answers)) {
        if (!isLocalTagVerdict(v)) continue;
        const key = tagKey(tag);
        // Registers the spelling without a count — these contacts don't carry
        // the tag, and saying they do would contradict the table. The half
        // weight only breaks spelling ties: any contact actually wearing the
        // tag outvotes an answer for how the dropdown spells it.
        const hit = touch(key);
        hit.spellings.set(tag, (hit.spellings.get(tag) || 0) + 0.5);
      }
    }
    return [...byKey.values()]
      .map(({ count, spellings }) => ({
        count,
        tag: [...spellings.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [hubspotContacts, rosterSelector, tagReviewMap]);

  // The tag actually in force. A tag that stops existing — retagged from the
  // bulk editor, or the cache reloaded without it — falls back to no filter
  // rather than stranding the page on an empty list with nothing in the
  // dropdown to undo it. Derived, so the recovery needs no effect.
  const activeTag = useMemo(() => (
    tagFilter && tagOptions.some(o => tagKey(o.tag) === tagKey(tagFilter)) ? tagFilter : ''
  ), [tagFilter, tagOptions]);

  // The status gate actually in force. Statuses only mean anything against
  // one tag — an answer is per contact per tag — so with no tag chosen the
  // toggles are inert (and disabled in the UI).
  const activeStatuses = activeTag ? tagStatusFilter : null;
  const statusGateOn = !!activeStatuses && activeStatuses.size > 0;

  // How many contacts sit behind each status for the chosen tag. Counted off
  // the roster gate rather than the current selection, so the numbers on the
  // pills don't collapse as you toggle them — same reason the tag dropdown
  // counts before its own gate.
  const tagStatusCounts = useMemo(() => {
    const out = { yes: 0, sold: 0, notsold: 0, unsure: 0, no: 0 };
    if (!activeTag) return out;
    for (const c of hubspotContacts) {
      if (!rosterSelector(c)) continue;
      const s = contactTagStatus(c, activeTag, tagReviewMap);
      if (s) out[s] += 1;
    }
    return out;
  }, [hubspotContacts, rosterSelector, activeTag, tagReviewMap]);

  // Combined selector — the roster gate plus the chosen tag. Filtering here
  // rather than at the row level means the whole page follows the tag: the
  // flat table, the By Company rollup, Travel, and every column's filter
  // dropdown all see the narrowed set.
  const combinedSelector = useCallback((c) => {
    if (!rosterSelector(c)) return false;
    if (!activeTag) return true;
    // With statuses toggled on, the gate is the contact's answer for this
    // tag — which is the only way a No / Not sure contact can appear at all,
    // since neither carries the tag.
    if (statusGateOn) return activeStatuses.has(contactTagStatus(c, activeTag, tagReviewMap));
    // Whole-tag match, not substring — "Key" must not sweep in every
    // "Dan Key Target" contact — and on tagKey, so a contact carrying the
    // other spelling of the chosen tag isn't filtered out of its own tag.
    return contactTagList(c).some(t => tagKey(t) === tagKey(activeTag));
  }, [rosterSelector, activeTag, statusGateOn, activeStatuses, tagReviewMap]);

  // The Totals pills. Defined once and used by both the count row and the
  // Tagged row below it, so the two can't drift apart in order, colour or
  // wording — they're the same five groups read two ways. The counts are
  // each category's own total and stay put as pills are lit: they're what
  // the dedicated tabs hold, not a readout of the current selection (the
  // table's own row count says that).
  const categoryPills = [
    { cat: null,     bucket: 'total',       label: 'All',    count: categoryCounts.total,  bg: '#F1F5F9', border: '#CBD5E1', color: '#334155', tip: 'Show all contacts (clear every category pill)' },
    { cat: 'Key',    bucket: 'key',         label: 'Key',    count: categoryCounts.key,    bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Show contacts tagged Dan Key Target. Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Active', bucket: 'active',      label: 'Active', count: categoryCounts.active, bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Show contacts in the active window with an open opp (mirrors the Active Contacts page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Client', bucket: 'client',      label: 'Client', count: categoryCounts.client, bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A', tip: 'Show contacts whose company is a current Client on your CDM (mirrors the Client Contacts page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Key Prospect', bucket: 'keyProspect', label: 'Key Prospect', count: categoryCounts.keyProspect, bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6', tip: 'Show Decision Maker contacts at Tier 1 / Tier 2 accounts on your CDM whose company has no opps yet (mirrors the Key Prospects page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
  ];

  const subtitle = (
    <>
      <button
        type="button"
        onClick={() => setShowAbout(v => !v)}
        aria-expanded={showAbout}
        title={showAbout ? 'Hide the page description' : 'What this page shows and how to use it'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: 0, border: 'none', background: 'none',
          color: '#64748B', fontSize: '0.7rem', fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '0.6rem' }}>{showAbout ? '▾' : '▸'}</span>
        About this page
      </button>
      {showAbout && (
        <div style={{ marginTop: 4 }}>
          Every HubSpot contact that lands on at least one of the dedicated <strong>Key</strong>, <strong>Active</strong>, <strong>Client</strong>, or <strong>Key Prospect</strong> rosters: same selectors and filters those tabs run, rolled up into a single list. The <strong>Totals</strong> pills double as filters: click as many as you want and the list shows contacts on <em>any</em> of the lit ones, click a lit pill to turn it off, or hit <strong>All</strong> to clear them. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table, <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats, or <strong>Travel</strong> to pick a state/city and see everyone in that area. Contacts at accounts whose Status on the Clients tab is <strong>Cancelling for Sure</strong>, or that are ticked <strong>Don't Track</strong> there, are left out. Use the per-row <strong>Hide</strong> button to suppress contacts you don't want in the rosters. Tick the row checkboxes and hit <strong>Edit Tags</strong> (or open <strong>Mass Edit</strong> and pick the <strong>Tags</strong> field) to add, remove, or replace Dan's Tags across every selected contact at once. <strong>Tagged</strong> is how much of the tag vocabulary each group has been worked through — any answer against a scored tag counts, Yes, No, Not sure, Sold or Not sold. <strong>Sold</strong> and <strong>Not sold</strong> are the two ends of one question asked of anyone a tag is true of: has their company bought that area? Sold keeps the tag on, so those contacts still come back in a plain pull of it; Not sold is the hold-off, keeping the tag off so they don't. Pick the tag and hit either status to see each list.
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Totals:</span>
        {categoryPills.map(({ cat, label, count, bg, border, color, tip }) => {
          const selected = cat === null ? categoryFilter.size === 0 : categoryFilter.has(cat);
          return (
            <button
              key={label}
              data-category-pill={label}
              data-selected={selected ? '1' : '0'}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleCategory(cat)}
              title={tip}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: selected ? color : bg,
                border: `1px solid ${selected ? color : border}`,
                color: selected ? '#fff' : color,
                fontSize: '0.68rem', fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
                boxShadow: selected ? `0 0 0 2px ${border}` : 'none',
              }}
            >
              {label} <span style={{ fontWeight: 800 }}>{count}</span>
            </button>
          );
        })}
        {/* Said out loud rather than silently dropped: both flags live on the
            Clients tab, so each note names the one to change to get those
            people back. */}
        {[
          { attr: 'cancelling', count: categoryCounts.cancelling, label: 'at cancelling clients, left out',
            tip: 'Contacts at accounts whose Status on the Clients tab is "Cancelling for Sure". They\'d otherwise qualify for one of the rosters; change the account\'s Status there to bring them back.' },
          { attr: 'untracked', count: categoryCounts.untracked, label: "at Don't Track clients, left out",
            tip: 'Contacts at accounts ticked "Don\'t Track" on the Clients tab. They\'d otherwise qualify for one of the rosters; untick Don\'t Track there to bring them back.' },
        ].filter(n => n.count > 0).map(({ attr, count, label, tip }) => (
          <span
            key={attr}
            {...{ [`data-${attr}-note`]: true }}
            title={tip}
            style={{
              padding: '1px 8px', borderRadius: 999,
              background: '#F1F5F9', border: '1px dashed #CBD5E1', color: '#64748B',
              fontSize: '0.68rem', fontWeight: 700,
            }}
          >
            {count} {label}
          </span>
        ))}
      </div>
      {/* How far through the tags each roster is. Same groups, same colours
          as the row above, read as a share of the answers rather than a head
          count — it's the "how much of this list have I actually worked?"
          figure, so it sits directly under the totals it divides. */}
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Tagged:</span>
        {categoryPills.map(({ bucket, label, count, bg, border, color }) => {
          const t = categoryCounts.tags?.[bucket] || { answered: 0, slots: 0, done: 0 };
          const pct = t.slots > 0 ? Math.round((t.answered / t.slots) * 100) : 0;
          return (
            <span
              key={label}
              data-tagged-pill={label}
              title={count > 0
                ? `${t.answered} of ${t.slots} tag answers recorded across ${count} ${label === 'All' ? '' : label + ' '}contact${count === 1 ? '' : 's'} — ${t.done} fully tagged. A tag counts as answered when it's on the contact (Yes) or marked No / Not sure in the contact popup. Hide, Left, Test and Met In Person don't count.`
                : `No ${label === 'All' ? '' : label + ' '}contacts to score`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: bg, border: `1px dashed ${border}`, color,
                fontSize: '0.68rem', fontWeight: 700,
              }}
            >
              {label} <span style={{ fontWeight: 800 }}>{count > 0 ? `${pct}%` : '—'}</span>
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <label htmlFor="all-contacts-tag-filter" style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Tag:</label>
        <select
          id="all-contacts-tag-filter"
          value={activeTag}
          onChange={e => pickTag(e.target.value)}
          title={`Show only contacts carrying this tag. Picking one starts on ${DEFAULT_TAG_STATUS_LABEL} — toggle the status pills for the rest. Unlike the Tags column filter, this matches a contact by any one of its tags.`}
          style={{
            padding: '2px 6px', borderRadius: 4,
            border: '1px solid ' + (activeTag ? '#6366F1' : '#CBD5E1'),
            background: activeTag ? '#EEF2FF' : '#fff',
            color: activeTag ? '#3730A3' : '#334155',
            fontSize: '0.7rem', fontWeight: activeTag ? 700 : 400,
            fontFamily: 'inherit', maxWidth: 260,
          }}
        >
          <option value="">All tags</option>
          {tagOptions.map(({ tag, count }) => (
            <option key={tag} value={tag}>{tag} ({count})</option>
          ))}
        </select>
        {activeTag ? (
          <button
            type="button"
            onClick={() => pickTag('')}
            title="Clear the tag filter"
            style={{
              padding: '1px 8px', borderRadius: 999,
              border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#3730A3',
              fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >Clear</button>
        ) : null}
        {/* Tag statuses. The answers live per contact per tag, so they only
            mean anything once a tag is chosen — disabled until then rather
            than hidden, so the control doesn't appear out of nowhere. */}
        <span
          style={{ fontSize: '0.7rem', color: activeTag ? '#475569' : '#94A3B8', fontWeight: 700, marginLeft: 6 }}
          title={activeTag ? undefined : 'Pick a tag first — an answer is recorded per contact per tag'}
        >Tag statuses:</span>
        {TAG_STATUSES.map(({ key, label, bg, border, color, tip }) => {
          const on = activeTag && tagStatusFilter.has(key);
          const count = tagStatusCounts[key];
          return (
            <button
              key={key}
              type="button"
              disabled={!activeTag}
              aria-pressed={!!on}
              onClick={() => setTagStatusFilter((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              })}
              title={activeTag
                ? `${tip}. Toggle to show only the answers you pick; a tag opens on ${DEFAULT_TAG_STATUS_LABEL}, and with none picked the filter falls back to every contact carrying the tag.`
                : 'Pick a tag first — an answer is recorded per contact per tag'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: !activeTag ? '#F8FAFC' : on ? color : bg,
                border: `1px solid ${!activeTag ? '#E2E8F0' : on ? color : border}`,
                color: !activeTag ? '#CBD5E1' : on ? '#fff' : color,
                fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: activeTag ? 'pointer' : 'not-allowed',
                boxShadow: on ? `0 0 0 2px ${border}` : 'none',
              }}
            >
              {label}{activeTag ? <span style={{ fontWeight: 800 }}>{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 4 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          <span>Show hidden contacts</span>
          <span
            title="HubSpot contacts you've hidden via the Hide button that would otherwise qualify for Key / Active / Client. Toggle on to review and un-hide via the contact popup."
            style={{
              display: 'inline-block',
              padding: '0 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              borderRadius: 999,
              background: hiddenCount > 0 ? '#FEE2E2' : '#F1F5F9',
              color: hiddenCount > 0 ? '#991B1B' : '#94A3B8',
              border: '1px solid ' + (hiddenCount > 0 ? '#FCA5A5' : '#E2E8F0'),
              minWidth: 18,
              textAlign: 'center',
            }}
          >{hiddenCount}</span>
        </label>
      </div>
    </>
  );

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      updateSettingsPath={updateSettingsPath}
      cdmName={cdmName}
      storagePrefix="all-contacts"
      pageTitle="All Contacts"
      pageSubtitle={subtitle}
      emptyTitle="No contacts found"
      emptyDetail={
        <>Nothing matched. A contact appears on this page when it would also appear on Key, Active, Client, or Key Prospects. Try the dedicated tabs to see why a specific contact is being filtered out.</>
      }
      contactSelector={combinedSelector}
      categorizeContact={categorizeContact}
      categoryFilter={categoryFilter}
      linkCompanyToProspect
    />
  );
}
