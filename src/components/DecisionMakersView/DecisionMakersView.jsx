// DMs page - every HubSpot contact tagged Decision Maker, on the same table
// the All Contacts page uses.
//
// The tag is already the most consequential one in the vocabulary: it is
// what the Key Prospects roster is built on, what the account mapping counts
// and what the Prospecting ladder measures itself against. It had no list of
// its own, though - the only ways to see the decision makers were the Key
// Prospects tab (which is a decision maker AND an untouched Tier 1/2
// account, so a narrow slice) or picking the tag out of All Contacts' tag
// filter every time.
//
// So this is that list, and it is deliberately the All Contacts page with a
// different front gate rather than a new table: same popup on a name, same
// Met In Person / Tags / Events columns, same All Contacts / By Company /
// Travel / By Location toggles, same Mass Edit and Edit Tags. Column widths,
// sort and visibility persist separately under the "dm-contacts" prefix, so
// arranging this page does not rearrange All Contacts.
//
// What it does NOT do is gate on the four rosters. A decision maker at an
// account on none of Key / Active / Client / Key Prospect is still a
// decision maker, and this is the page where they should be findable. The
// roster pills are still here, and still filter, but they narrow the list
// rather than define it - which is why the All pill is counted over the
// page's own contacts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { useOppsRecords, useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isLocalTagVerdict, tagAnswerFrom, tagKey, findTagRecord } from '../../utils/contactTagReview';
import { makeRosterGates, rosterTagCoverage } from '../../utils/contactRosters';
import { isDecisionMakerContact, makeDecisionMakerGate } from '../../utils/decisionMakerCoverage';

// A contact's Dan's Tags as individual values. Same reading the All Contacts
// page does: they are stored as one ';'-joined string, so the Tags column's
// own value filter can only match the whole combination.
function contactTagList(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

// The five answers the contact popup records against a tag, in the order the
// filter offers them. Same set, same colours and same wording as All
// Contacts: this is the same control over a narrower list, and two pages
// explaining the same five pills differently would be two vocabularies.
const TAG_STATUSES = [
  { key: 'yes',     label: 'Yes',      bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Contacts carrying this tag with no sold / not sold answer recorded yet' },
  { key: 'sold',    label: 'Sold',     bg: '#CCFBF1', border: '#5EEAD4', color: '#115E59', tip: 'Contacts who own this area at a company that has bought it. They keep the tag, so a plain pull of it returns them too' },
  { key: 'notsold', label: 'Not sold', bg: '#EEF2FF', border: '#A5B4FC', color: '#3730A3', tip: 'Contacts who own this area but whose company hasn\'t bought it yet - held off in the contact popup, so they stay out of a plain pull of this tag. This is the list of accounts still to sell on it' },
  { key: 'unsure',  label: 'Not sure', bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Contacts answered "Not sure" for this tag in the contact popup' },
  { key: 'no',      label: 'No',       bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B', tip: 'Contacts answered "No" for this tag in the contact popup' },
];

const DEFAULT_TAG_STATUSES = ['yes', 'unsure'];
const DEFAULT_TAG_STATUS_LABEL = DEFAULT_TAG_STATUSES
  .map(k => TAG_STATUSES.find(s => s.key === k)?.label)
  .filter(Boolean)
  .join(' + ');

// One contact's answer for one tag, resolved by the same helper the contact
// popup's table runs on, so the pill here and the row there cannot disagree.
function contactTagStatus(c, tag, reviewMap) {
  if (!tag) return '';
  const key = tagKey(tag);
  const tagged = contactTagList(c).some(t => tagKey(t) === key);
  const cid = c?.id ?? c?.vid;
  const answers = cid == null ? null : reviewMap?.[cid];
  const stored = findTagRecord(answers, tag);
  return tagAnswerFrom(tagged, isLocalTagVerdict(stored) ? stored : '');
}

export function DecisionMakersView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();

  // Review mode: the decision makers somebody has hidden. Worth having here
  // more than anywhere, because a hidden decision maker is invisible on every
  // page that counts them and is exactly the kind of thing that leaves an
  // account reading as unmapped.
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem('dm-contacts:show-hidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('dm-contacts:show-hidden', showHidden ? '1' : '0'); } catch {}
  }, [showHidden]);

  const [showAbout, setShowAbout] = useState(() => {
    try { return localStorage.getItem('dm-contacts:show-about') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('dm-contacts:show-about', showAbout ? '1' : '0'); } catch {}
  }, [showAbout]);

  const [categoryFilter, setCategoryFilter] = useState(() => new Set());
  const toggleCategory = useCallback((cat) => {
    if (cat === null) { setCategoryFilter(new Set()); return; }
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);
  const [tagFilter, setTagFilter] = useState('');
  const [tagStatusFilter, setTagStatusFilter] = useState(() => new Set());
  const pickTag = useCallback((tag) => {
    setTagFilter(tag);
    setTagStatusFilter(tag ? new Set(DEFAULT_TAG_STATUSES) : new Set());
  }, []);

  // The roster gates, for the Category column and the pills. They are not the
  // page's gate: what gets a contact onto this page is the Decision Maker tag
  // alone. What the gates supply is the account exclusions (a contact at a
  // cancelling or Don't Track client is off this page for the same reason it
  // is off the others) and the categorisation.
  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden],
  );
  const visibleGates = useMemo(
    () => (showHidden
      ? makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden: false })
      : gates),
    [showHidden, gates, prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  const categorizeContact = useCallback((c) => gates.categorize(c), [gates]);

  // The page's own gate: tagged Decision Maker, minus the people every
  // contacts page leaves out, minus the accounts the Clients tab flags.
  const dmGate = useMemo(() => makeDecisionMakerGate({ showHidden }), [showHidden]);
  const hiddenDmGate = useMemo(() => makeDecisionMakerGate({ showHidden: true }), []);
  const dmSelector = useCallback(
    (c) => dmGate(c) && !gates.clientExclusionOf(c),
    [dmGate, gates],
  );
  // Visible-mode gate for the counts, so the pills say what the page holds
  // when it is not in hidden-review mode.
  const visibleDmSelector = useCallback(
    (c) => isDecisionMakerContact(c) && !visibleGates.clientExclusionOf(c),
    [visibleGates],
  );

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

  // How many hidden decision makers the toggle would uncover.
  const hiddenCount = useMemo(() => {
    if (!hubspotContacts.length) return 0;
    let n = 0;
    for (const c of hubspotContacts) {
      if (hiddenDmGate(c) && !visibleGates.clientExclusionOf(c)) n += 1;
    }
    return n;
  }, [hubspotContacts, hiddenDmGate, visibleGates]);

  const tagReviewMap = useMemo(() => settings?.contactTagReview || {}, [settings?.contactTagReview]);

  // Counts and tag coverage over the DECISION MAKERS, not over the rosters:
  // the contacts handed in are already this page's list, and `countAll` is
  // what makes the All pill the page's own total rather than the share of it
  // that also lands on a roster. The four roster buckets still mean what they
  // mean everywhere else - a decision maker who is also on Key, and so on.
  const decisionMakers = useMemo(
    () => hubspotContacts.filter(isDecisionMakerContact),
    [hubspotContacts],
  );
  const coverage = useMemo(
    () => rosterTagCoverage({
      contacts: decisionMakers,
      gates: visibleGates,
      tagReviewMap,
      localFields: settings?.contactLocalFields || null,
      countAll: true,
    }),
    [decisionMakers, visibleGates, tagReviewMap, settings?.contactLocalFields],
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

  // Every other tag these decision makers wear, with how many wear it, most
  // used first. Counted off this page's gate rather than the whole cache, so
  // the dropdown only offers tags that return rows here - which on this page
  // is the useful question: of the decision makers, who also owns Efficiency?
  const tagOptions = useMemo(() => {
    const byKey = new Map();
    const touch = (key) => {
      let hit = byKey.get(key);
      if (!hit) { hit = { count: 0, spellings: new Map() }; byKey.set(key, hit); }
      return hit;
    };
    for (const c of hubspotContacts) {
      if (!dmSelector(c)) continue;
      const seenHere = new Set();
      for (const tag of contactTagList(c)) {
        const key = tagKey(tag);
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
        const hit = touch(tagKey(tag));
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
  }, [hubspotContacts, dmSelector, tagReviewMap]);

  const activeTag = useMemo(() => (
    tagFilter && tagOptions.some(o => tagKey(o.tag) === tagKey(tagFilter)) ? tagFilter : ''
  ), [tagFilter, tagOptions]);
  const activeStatuses = activeTag ? tagStatusFilter : null;
  const statusGateOn = !!activeStatuses && activeStatuses.size > 0;

  const tagStatusCounts = useMemo(() => {
    const out = { yes: 0, sold: 0, notsold: 0, unsure: 0, no: 0 };
    if (!activeTag) return out;
    for (const c of hubspotContacts) {
      if (!dmSelector(c)) continue;
      const s = contactTagStatus(c, activeTag, tagReviewMap);
      if (s) out[s] += 1;
    }
    return out;
  }, [hubspotContacts, dmSelector, activeTag, tagReviewMap]);

  // The page's gate plus the chosen tag, so the flat table, the By Company
  // rollup, Travel and every column filter all see the same narrowed set.
  const combinedSelector = useCallback((c) => {
    if (!dmSelector(c)) return false;
    if (!activeTag) return true;
    if (statusGateOn) return activeStatuses.has(contactTagStatus(c, activeTag, tagReviewMap));
    return contactTagList(c).some(t => tagKey(t) === tagKey(activeTag));
  }, [dmSelector, activeTag, statusGateOn, activeStatuses, tagReviewMap]);

  // The Totals pills. All is this page's own count; the other four are how
  // many of those decision makers also sit on each roster, so they say
  // something this page could not otherwise tell you - how many of the people
  // who can sign are on an account anybody is working.
  const categoryPills = [
    { cat: null,     bucket: 'total',       label: 'All',    count: categoryCounts.total,  bg: '#F1F5F9', border: '#CBD5E1', color: '#334155', tip: 'Show every contact tagged Decision Maker (clear every category pill)' },
    { cat: 'Key',    bucket: 'key',         label: 'Key',    count: categoryCounts.key,    bg: '#FEF3C7', border: '#FCD34D', color: '#92400E', tip: 'Show the decision makers who are also tagged Dan Key Target. Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Active', bucket: 'active',      label: 'Active', count: categoryCounts.active, bg: '#DCFCE7', border: '#86EFAC', color: '#166534', tip: 'Show the decision makers in the active window with an open opp (mirrors the Active Contacts page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Client', bucket: 'client',      label: 'Client', count: categoryCounts.client, bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A', tip: 'Show the decision makers whose company is a current Client on your CDM (mirrors the Client Contacts page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
    { cat: 'Key Prospect', bucket: 'keyProspect', label: 'Key Prospect', count: categoryCounts.keyProspect, bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6', tip: 'Show the decision makers at Tier 1 / Tier 2 accounts on your CDM whose company has no opps yet (mirrors the Key Prospects page). Click again to turn it off; light more than one pill to see contacts on any of them.' },
  ];

  // How many of these decision makers land on no roster at all. Counted
  // rather than subtracted: the four pills overlap heavily, so total minus
  // their sum is not this number. Said out loud because they are the people
  // who can sign at accounts nobody is working today, and this page is the
  // only one they appear on.
  const offRoster = useMemo(() => {
    let n = 0;
    for (const c of hubspotContacts) {
      if (!visibleDmSelector(c)) continue;
      if (visibleGates.categorize(c).length === 0) n += 1;
    }
    return n;
  }, [hubspotContacts, visibleDmSelector, visibleGates]);

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
          Every HubSpot contact tagged <strong>Decision Maker</strong>, on the same table the <strong>All</strong> tab uses. Unlike that page this one is not gated on the rosters: a decision maker at an account on none of Key, Active, Client or Key Prospect still belongs here, which is what makes this the list of everyone who can sign. The <strong>Totals</strong> pills are how many of them also sit on each roster, and they double as filters: click as many as you want and the list shows contacts on <em>any</em> of the lit ones, click a lit pill to turn it off, or hit <strong>All</strong> to clear them. Click a name to open <strong>Edit HubSpot Contact</strong>. Toggle <strong>All Contacts</strong> for a flat name-by-name table, <strong>By Company</strong> to roll them up by account, or <strong>Travel</strong> to pick a state/city and see who is nearby. Contacts tagged <strong>Hide</strong> or <strong>Left</strong> are out, as are coworkers and accounts whose Status on the Clients tab is <strong>Cancelling for Sure</strong> or that are ticked <strong>Don't Track</strong> there. Tick the row checkboxes and hit <strong>Edit Tags</strong> (or open <strong>Mass Edit</strong>) to retag several at once - including taking the Decision Maker tag off somebody who should not have it, which drops them off this page. <strong>Tagged</strong> is how much of the tag vocabulary each group has been worked through.
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
        {offRoster > 0 && (
          <span
            data-off-roster-note
            title="Decision makers who land on none of the four rosters - nobody is working their account today. They are on this page and on no other."
            style={{
              padding: '1px 8px', borderRadius: 999,
              background: '#FFF7ED', border: '1px dashed #FED7AA', color: '#9A3412',
              fontSize: '0.68rem', fontWeight: 700,
            }}
          >
            {offRoster} on no roster
          </span>
        )}
        {[
          { attr: 'cancelling', count: categoryCounts.cancelling, label: 'at cancelling clients, left out',
            tip: 'Decision makers at accounts whose Status on the Clients tab is "Cancelling for Sure". Change the account\'s Status there to bring them back.' },
          { attr: 'untracked', count: categoryCounts.untracked, label: "at Don't Track clients, left out",
            tip: 'Decision makers at accounts ticked "Don\'t Track" on the Clients tab. Untick Don\'t Track there to bring them back.' },
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
                ? `${t.answered} of ${t.slots} tag answers recorded across ${count} ${label === 'All' ? '' : label + ' '}decision maker${count === 1 ? '' : 's'} - ${t.done} fully tagged. A tag counts as answered when it's on the contact (Yes) or marked No / Not sure in the contact popup. Hide, Left, Test and Met In Person don't count.`
                : `No ${label === 'All' ? '' : label + ' '}decision makers to score`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999,
                background: bg, border: `1px dashed ${border}`, color,
                fontSize: '0.68rem', fontWeight: 700,
              }}
            >
              {label} <span style={{ fontWeight: 800 }}>{count > 0 ? `${pct}%` : '-'}</span>
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <label htmlFor="dm-contacts-tag-filter" style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Tag:</label>
        <select
          id="dm-contacts-tag-filter"
          value={activeTag}
          onChange={e => pickTag(e.target.value)}
          title={`Show only the decision makers carrying this tag as well. Picking one starts on ${DEFAULT_TAG_STATUS_LABEL} - toggle the status pills for the rest. Unlike the Tags column filter, this matches a contact by any one of its tags.`}
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
        <span
          style={{ fontSize: '0.7rem', color: activeTag ? '#475569' : '#94A3B8', fontWeight: 700, marginLeft: 6 }}
          title={activeTag ? undefined : 'Pick a tag first - an answer is recorded per contact per tag'}
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
                : 'Pick a tag first - an answer is recorded per contact per tag'}
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
          <span>Show hidden decision makers</span>
          <span
            title="Contacts tagged Decision Maker that you've hidden via the Hide button. They're counted on no page while hidden, so an account can read as unmapped because of one. Toggle on to review and un-hide via the contact popup."
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
      storagePrefix="dm-contacts"
      pageTitle="Decision Makers"
      pageSubtitle={subtitle}
      emptyTitle="No decision makers found"
      emptyDetail={
        <>Nothing matched. A contact appears here when it carries the Decision Maker tag and isn't tagged Hide or Left. Tag somebody from the contact popup, or from another contacts tab with Edit Tags, and they'll show up here.</>
      }
      contactSelector={combinedSelector}
      categorizeContact={categorizeContact}
      categoryFilter={categoryFilter}
      linkCompanyToProspect
    />
  );
}

export default DecisionMakersView;
