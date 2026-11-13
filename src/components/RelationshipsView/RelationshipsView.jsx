// Contacts > Relationships: Relationship Strength across your contacts, now
// and over the last year.
//
// "Your contacts" are the HubSpot contacts with any activity on record in
// the last two years (HubSpot or logged here): anyone with nothing at all
// would sit at 0 and drown the chart. The history is worked out, not
// recorded: a score on a past date is the same formula run as of that date
// (utils/relationshipStrength scores only what had happened by then), so
// the chart has a full year behind it from the first visit.
//
// The tables use the shared DataTable, so they come with Dan's column
// formatting, and both sort by score. Ticking a contact draws its own line
// on the chart next to the average.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isSchneiderContact } from '../../utils/contactRosters';
import { isKeyContact } from '../../utils/decisionMakerCoverage';
import { useAuth } from '../../contexts/AuthContext';
import { useRelationshipData } from '../../hooks/useRelationshipStrength';
import {
  RELATIONSHIP_CONFIG, DAY_MS, scoreContact, scoreAccount, oppsForContact, tierFor, contactKey, contactName, daysLabel, ageLabel,
} from '../../utils/relationshipStrength';
import { RelationshipBadge, ScorePill, TrendArrow } from '../Relationship/RelationshipBadge';
import { LogActivityModal } from '../Relationship/LogActivityModal';
import { reviewContact, reviewAccount, reviewCounts, reviewPriority, reviewStatus } from '../../utils/relationshipReview';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { companyPopupTarget } from '../../utils/companyLookup';

// The contact popup, the same one every other contacts page opens. Loaded on
// the first name click: most visits here never open one.
const ContactEditModal = lazy(() =>
  import('../ProspectModal/ProspectModal').then(m => ({ default: m.ContactEditModal })),
);

// A contact's name as a link that opens their popup. It stops the click so
// the row's own click (drawing the contact on the chart) doesn't fire too.
function ContactNameLink({ contact, onOpen }) {
  const label = contactName(contact) || contact.email;
  return (
    <button
      type="button"
      title="Open contact"
      onClick={(e) => { e.stopPropagation(); onOpen(contact); }}
      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', color: '#2563EB', textAlign: 'left' }}
      onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
    >{label}</button>
  );
}

const POINTS = 27; // one a fortnight, a year back
const STEP_DAYS = 14;
const MAX_LINES = 4;
// Categorical slots for the ticked contacts' lines, in fixed order; the
// average is the neutral ink line they are read against.
const LINE_COLORS = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100'];
const AVERAGE_COLOR = '#475569';

const AXIS_TICK = { fontSize: 11, fill: '#64748B' };
const CARD = { border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff', padding: '0.85rem 1rem 0.5rem' };
const TIERS = RELATIONSHIP_CONFIG.tiers;

const fmtShort = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const companyOf = (c) => String(c?.company || '').trim();
const fmtDayLong = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// The Date Added column, for contacts (r.result.added) and accounts.
const ADDED_COLUMN = {
  key: 'added', label: 'Added', defaultWidth: 130,
  getSortValue: r => r.result.ageDays ?? -1,
  getFilterValue: r => (r.result.isNew ? 'New' : ageLabel(r.result.ageDays)),
  exportValue: r => (r.result.added?.day || ''),
  render: r => (r.result.ageDays == null ? <span style={{ color: '#CBD5E1' }}>-</span> : (
    <span title={r.result.added ? `Added ${fmtDayLong(r.result.added.ms)}` : ''} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {ageLabel(r.result.ageDays)}
      {r.result.isNew && <span style={{ padding: '0 6px', borderRadius: 999, background: '#F5F3FF', color: '#6D28D9', border: '1px solid #C4B5FD', fontWeight: 700, fontSize: '0.6rem' }}>New</span>}
    </span>
  )),
};
const usable = (c) => c && !isSchneiderContact(c) && !/(^|;)\s*hide\s*(;|$)/i.test(String(c.dans_tags || c.dan_s_tags || ''));

function useHubspotContacts(uid) {
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [uid]);
  return contacts;
}

function ChartTooltip({ active, payload, label, lines }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 9px', fontSize: '0.72rem', color: '#1E293B', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      {lines.map(l => (
        <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: l.color, display: 'inline-block' }} />
          <span style={{ color: '#475569' }}>{l.label}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, paddingLeft: 12 }}>{row[l.key] ?? '-'}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ ...CARD, padding: '0.6rem 0.9rem', minWidth: 140, flex: '1 1 140px', borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1E293B', lineHeight: 1.3 }}>{value}</div>
      <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{sub}</div>
    </div>
  );
}

const changeText = (delta, days = 90) => (delta == null ? 'No history yet' : delta === 0 ? `No change in ${days} days` : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} in ${days} days`);

function pillBtn(on) {
  return {
    padding: '0.3rem 0.85rem', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: on ? 'var(--color-accent)' : 'var(--color-surface)',
    color: on ? '#fff' : 'var(--color-text-muted)',
  };
}

export function RelationshipsView({ prospects = [], onSelectProspect, settings, updateSettings }) {
  const { user } = useAuth() || {};
  const contacts = useHubspotContacts(user?.uid || '');
  const { touchesFor, dateAddedFor, oppsRecords, hasFeed, indexLoaded, log } = useRelationshipData();
  // Review first: it is the one that says what to do.
  const [view, setView] = useState('review');
  // Whose relationships the page covers. Key Contacts (tagged Dan Key
  // Target, the Key Contacts tab's roster) by default; All widens it to
  // everyone with activity. Cards, charts and tables all follow it.
  const [scope, setScope] = useState('key'); // 'key' | 'all'
  const [reviewFilter, setReviewFilter] = useState(null); // a status key, or null for all
  const [reviewOf, setReviewOf] = useState('contacts'); // what Review lists: 'contacts' | 'accounts'
  const [picked, setPicked] = useState([]); // contact keys drawn on the chart
  const [logging, setLogging] = useState(false);
  // The day the page was opened. Fixed for the visit, so the scores are a
  // pure function of the data (a logged activity still re-scores at once).
  const [nowMs] = useState(() => Date.now());

  // The contact whose popup is open, straight off the clicked row: the rows
  // carry the HubSpot record, so there is nothing to look up.
  const [editingContact, setEditingContact] = useState(null);
  const openContact = useCallback((c) => { if (c) setEditingContact(c); }, []);
  const closeContact = useCallback(() => setEditingContact(null), []);
  // A `silent` save is the popup's tag autosave, which must not close it.
  const saveContact = useCallback((_u, opts) => { if (!opts?.silent) setEditingContact(null); }, []);
  // "Company ↗" in the popup: close the contact, open its company.
  const openCompanyFromContact = useCallback((name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingContact(null);
    onSelectProspect(target);
  }, [prospects, onSelectProspect]);
  const contactEditSettings = useContactEditSettings({ settings, updateSettings });
  // Colleagues at the open contact's company (for Reports To) and the
  // account's email domains: the same lookups the other pages hand the popup.
  const editCompanyKey = String(editingContact?.company || '').trim().toLowerCase();
  const editCompanyContacts = useMemo(() => (
    editCompanyKey ? (contacts || []).filter(c => String(c?.company || '').trim().toLowerCase() === editCompanyKey) : []
  ), [editCompanyKey, contacts]);
  const editEmailDomains = useMemo(() => {
    if (!editCompanyKey) return [];
    const matched = (prospects || []).find(p => String(p.company || '').trim().toLowerCase() === editCompanyKey);
    return matched?.emailDomain ? String(matched.emailDomain).split(/[\n;,]+/).map(x => x.trim()).filter(Boolean) : [];
  }, [editCompanyKey, prospects]);
  const editCompanyNames = useMemo(() => (prospects || []).map(p => p.company).filter(Boolean), [prospects]);

  // Everyone with activity, their touches and today's score.
  const scored = useMemo(() => {
    if (!contacts || !indexLoaded) return null;
    const out = [];
    for (const c of contacts) {
      if (!usable(c)) continue;
      if (scope === 'key' && !isKeyContact(c)) continue;
      const touches = touchesFor(c);
      if (!touches.length) continue;
      const added = dateAddedFor(c, touches);
      const result = { ...scoreContact(touches, { opps: oppsForContact(c, oppsRecords, { nowMs }), nowMs, addedMs: added?.ms ?? null }), added };
      out.push({ key: contactKey(c) || c.email, contact: c, touches, result, added });
    }
    return out;
  }, [contacts, indexLoaded, touchesFor, dateAddedFor, oppsRecords, nowMs, scope]);

  // Each contact's score a fortnight at a time over the year.
  const dates = useMemo(() => Array.from({ length: POINTS }, (_, i) => nowMs - (POINTS - 1 - i) * STEP_DAYS * DAY_MS), [nowMs]);
  const histories = useMemo(() => {
    if (!scored) return null;
    const map = new Map();
    for (const s of scored) {
      map.set(s.key, dates.map(at => scoreContact(s.touches, { opps: oppsForContact(s.contact, oppsRecords, { nowMs: at }), nowMs: at, addedMs: s.added?.ms ?? null }).score));
    }
    return map;
  }, [scored, dates, oppsRecords]);

  const rows = useMemo(() => (scored || []).map(s => {
    const h = histories?.get(s.key) || [];
    const ago90 = h[Math.max(0, h.length - 1 - Math.round(90 / STEP_DAYS))];
    // Where they stand against their own year: off their peak, out of
    // their usual rhythm, climbing, or at their best (utils/relationshipReview).
    const review = reviewContact({ result: s.result, history: h, touches: s.touches, nowMs, stepDays: STEP_DAYS });
    return { ...s, id: s.key, change90: h.length ? s.result.score - ago90 : null, review, priority: reviewPriority(review, s.result) };
  }), [scored, histories, nowMs]);


  const series = useMemo(() => {
    if (!histories || !scored?.length) return [];
    return dates.map((ms, i) => {
      const row = { ms, label: fmtShort(ms) };
      let sum = 0;
      const counts = Object.fromEntries(TIERS.map(t => [t.key, 0]));
      for (const s of scored) {
        const v = histories.get(s.key)[i];
        sum += v;
        counts[tierFor(v).key] += 1;
      }
      row.average = Math.round(sum / scored.length);
      Object.assign(row, counts);
      for (const k of picked) {
        const h = histories.get(k);
        if (h) row[`c:${k}`] = h[i];
      }
      return row;
    });
  }, [histories, scored, dates, picked]);

  const pickedRows = picked.map(k => rows.find(r => r.key === k)).filter(Boolean);
  const lines = [
    { key: 'average', label: scope === 'key' ? 'Average, key contacts' : 'Average, all contacts', color: AVERAGE_COLOR },
    ...pickedRows.map((r, i) => ({ key: `c:${r.key}`, label: contactName(r.contact) || r.contact.email, color: LINE_COLORS[i] })),
  ];

  const togglePick = (key) => setPicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : prev.length >= MAX_LINES ? prev : [...prev, key]));

  // Accounts: contacts grouped by their company.
  const prospectByName = useMemo(() => new Map((prospects || []).map(p => [String(p.company || '').toLowerCase().trim(), p])), [prospects]);
  const accounts = useMemo(() => {
    const groups = new Map();
    for (const r of rows) {
      const name = companyOf(r.contact);
      if (!name) continue;
      const k = name.toLowerCase();
      if (!groups.has(k)) groups.set(k, { company: name, members: [] });
      groups.get(k).members.push(r);
    }
    return [...groups.entries()].map(([k, g]) => ({
      id: k, company: g.company, count: g.members.length, members: g.members,
      prospect: prospectByName.get(k) || null, result: scoreAccount(g.members),
    })).filter(a => a.result);
  }, [rows, prospectByName]);

  // The same review for accounts: the account score on each history date,
  // and the rhythm of two-way touches with anyone there.
  const accountReviews = useMemo(() => accounts.map(a => {
    const review = reviewAccount({
      account: a.result,
      members: a.members.map(r => ({ contact: r.contact, result: r.result, history: histories?.get(r.key) || [], touches: r.touches, review: r.review })),
      nowMs,
      stepDays: STEP_DAYS,
    });
    return { ...a, review, priority: reviewPriority(review, a.result) };
  }), [accounts, histories, nowMs]);

  const reviewList = reviewOf === 'accounts' ? accountReviews : rows;
  const statusCounts = useMemo(() => reviewCounts(reviewList.map(r => r.review)), [reviewList]);
  const reviewRows = useMemo(() => (reviewFilter ? reviewList.filter(r => r.review.status === reviewFilter) : reviewList), [reviewList, reviewFilter]);

  const latest = series[series.length - 1];
  const prior = series[Math.max(0, series.length - 1 - Math.round(90 / STEP_DAYS))];

  const contactColumns = useMemo(() => [
    {
      key: 'chart', label: 'Chart', defaultWidth: 52, exportValue: () => '',
      render: (r) => (
        <input
          type="checkbox"
          checked={picked.includes(r.key)}
          disabled={!picked.includes(r.key) && picked.length >= MAX_LINES}
          onClick={e => e.stopPropagation()}
          onChange={() => togglePick(r.key)}
          aria-label={`Draw ${contactName(r.contact)} on the chart`}
          title={picked.length >= MAX_LINES && !picked.includes(r.key) ? `Up to ${MAX_LINES} contacts at a time` : 'Draw this contact on the chart'}
        />
      ),
    },
    { key: 'name', label: 'Name', defaultWidth: 170, getSortValue: r => contactName(r.contact).toLowerCase(), getFilterValue: r => contactName(r.contact), exportValue: r => contactName(r.contact), render: r => <ContactNameLink contact={r.contact} onOpen={openContact} /> },
    { key: 'company', label: 'Company', defaultWidth: 170, getSortValue: r => companyOf(r.contact).toLowerCase(), getFilterValue: r => companyOf(r.contact), exportValue: r => companyOf(r.contact), render: r => companyOf(r.contact) || <span style={{ color: '#CBD5E1' }}>-</span> },
    { key: 'score', label: 'Score', defaultWidth: 190, getSortValue: r => r.result.score, getFilterValue: r => r.result.tier.label, exportValue: r => r.result.score, render: r => <RelationshipBadge result={r.result} /> },
    { key: 'tier', label: 'Tier', defaultWidth: 90, getSortValue: r => r.result.score, getFilterValue: r => r.result.tier.label, exportValue: r => r.result.tier.label, render: r => r.result.tier.label },
    ADDED_COLUMN,
    { key: 'trend', label: 'Trend', defaultWidth: 70, getSortValue: r => ({ up: 2, flat: 1, down: 0 })[r.result.trend], getFilterValue: r => r.result.trend, exportValue: r => r.result.trend, render: r => <TrendArrow trend={r.result.trend} /> },
    { key: 'change90', label: 'Change 90d', defaultWidth: 90, getSortValue: r => r.change90 ?? -999, getFilterValue: r => String(r.change90 ?? ''), exportValue: r => r.change90 ?? '', render: r => (r.change90 == null ? '-' : `${r.change90 > 0 ? '+' : ''}${r.change90}`) },
    { key: 'lastTwoWay', label: 'Last two-way', defaultWidth: 110, getSortValue: r => r.result.daysSinceTwoWay ?? 99999, getFilterValue: r => daysLabel(r.result.daysSinceTwoWay), exportValue: r => r.result.daysSinceTwoWay ?? '', render: r => daysLabel(r.result.daysSinceTwoWay) },
    { key: 'engagement', label: 'Engagement', defaultWidth: 90, getSortValue: r => r.result.components.engagement, exportValue: r => r.result.components.engagement, render: r => r.result.components.engagement },
    { key: 'reciprocity', label: 'Reciprocity', defaultWidth: 90, getSortValue: r => r.result.components.reciprocity, exportValue: r => r.result.components.reciprocity, render: r => r.result.components.reciprocity },
    { key: 'consistency', label: 'Consistency', defaultWidth: 90, getSortValue: r => r.result.components.consistency, exportValue: r => r.result.components.consistency, render: r => r.result.components.consistency },
    { key: 'opportunity', label: 'Opps', defaultWidth: 70, getSortValue: r => r.result.components.opportunity, exportValue: r => r.result.components.opportunity, render: r => r.result.components.opportunity },
    { key: 'touches', label: 'Activities (12 mo)', defaultWidth: 110, getSortValue: r => r.result.touchCount, exportValue: r => r.result.touchCount, render: r => r.result.touchCount },
  ], [picked, openContact]);

  const reviewColumns = useMemo(() => [
    {
      key: 'status', label: 'Status', defaultWidth: 130,
      // Sorted by priority: status order, then the most pressing in each.
      getSortValue: r => r.priority, getFilterValue: r => reviewStatus(r.review.status).label, exportValue: r => reviewStatus(r.review.status).label,
      render: r => {
        const st = reviewStatus(r.review.status);
        return (
          <span title={st.tip} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}`, whiteSpace: 'nowrap' }}>{st.label}</span>
        );
      },
    },
    { key: 'name', label: 'Name', defaultWidth: 160, getSortValue: r => contactName(r.contact).toLowerCase(), getFilterValue: r => contactName(r.contact), exportValue: r => contactName(r.contact), render: r => <ContactNameLink contact={r.contact} onOpen={openContact} /> },
    { key: 'company', label: 'Company', defaultWidth: 150, getSortValue: r => companyOf(r.contact).toLowerCase(), getFilterValue: r => companyOf(r.contact), exportValue: r => companyOf(r.contact), render: r => companyOf(r.contact) || <span style={{ color: '#CBD5E1' }}>-</span> },
    { key: 'score', label: 'Now', defaultWidth: 170, getSortValue: r => r.result.score, getFilterValue: r => r.result.tier.label, exportValue: r => r.result.score, render: r => <RelationshipBadge result={r.result} compact /> },
    ADDED_COLUMN,
    {
      key: 'peak', label: 'Year peak', defaultWidth: 120, getSortValue: r => r.review.peak, exportValue: r => r.review.peak,
      render: r => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ScorePill score={r.review.peak} tier={tierFor(r.review.peak)} showLabel={false} />
          <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>{r.review.peakAgoDays === 0 ? 'now' : `${Math.round(r.review.peakAgoDays / 7)}w ago`}</span>
        </span>
      ),
    },
    { key: 'offPeak', label: 'Off peak', defaultWidth: 80, getSortValue: r => r.review.offPeak, exportValue: r => r.review.offPeak, render: r => (r.review.offPeak ? `-${r.review.offPeak}` : '0') },
    { key: 'change90', label: 'Change 90d', defaultWidth: 90, getSortValue: r => r.review.change90, exportValue: r => r.review.change90, render: r => `${r.review.change90 > 0 ? '+' : ''}${r.review.change90}` },
    { key: 'usualGap', label: 'Usual gap', defaultWidth: 90, getSortValue: r => r.review.usualGapDays ?? 99999, exportValue: r => r.review.usualGapDays ?? '', render: r => (r.review.usualGapDays == null ? '-' : `${r.review.usualGapDays}d`) },
    {
      key: 'since', label: 'Since two-way', defaultWidth: 110, getSortValue: r => r.result.daysSinceTwoWay ?? 99999, exportValue: r => r.result.daysSinceTwoWay ?? '',
      render: r => {
        const ratio = r.review.overdueRatio;
        const late = ratio != null && ratio >= 1.5;
        return (
          <span title={ratio != null ? `${ratio.toFixed(1)}x their usual gap` : ''} style={{ fontWeight: late ? 700 : 400, color: late ? '#92400E' : undefined }}>
            {daysLabel(r.result.daysSinceTwoWay)}
          </span>
        );
      },
    },
    { key: 'nextStep', label: 'Next step', defaultWidth: 340, getFilterValue: r => r.review.nextStep, exportValue: r => r.review.nextStep, render: r => <span style={{ fontSize: '0.72rem', color: '#334155', whiteSpace: 'normal' }}>{r.review.nextStep}</span> },
  ], [openContact]);

  // The account review: the contact review's columns, with the account's
  // name, size and the contact the status hangs on in place of the person.
  const accountReviewColumns = useMemo(() => {
    const byKey = Object.fromEntries(reviewColumns.map(c => [c.key, c]));
    return [
      byKey.status,
      { key: 'company', label: 'Company', defaultWidth: 180, getSortValue: a => a.company.toLowerCase(), getFilterValue: a => a.company, exportValue: a => a.company, render: a => <span style={{ fontWeight: 600, color: a.prospect ? 'var(--color-accent)' : undefined }}>{a.company}</span> },
      { ...byKey.score, render: a => <RelationshipBadge result={a.result} compact extraTitle={`Best contact ${a.result.bestScore} + breadth ${a.result.breadth} x ${RELATIONSHIP_CONFIG.weights.breadth}`} /> },
      { ...ADDED_COLUMN, label: 'Since' },
      byKey.peak, byKey.offPeak, byKey.change90, byKey.usualGap, byKey.since,
      { key: 'driver', label: 'Hangs on', defaultWidth: 140, getSortValue: a => contactName(a.review.driver).toLowerCase(), getFilterValue: a => contactName(a.review.driver), exportValue: a => contactName(a.review.driver), render: a => contactName(a.review.driver) || a.review.driver?.email || '-' },
      { key: 'contacts', label: 'Engaged', defaultWidth: 80, getSortValue: a => a.result.engagedContacts, exportValue: a => `${a.result.engagedContacts} of ${a.count}`, render: a => <span title={`${a.result.engagedContacts} of ${a.count} contacts at Developing or better`}>{`${a.result.engagedContacts} of ${a.count}`}</span> },
      byKey.nextStep,
    ];
  }, [reviewColumns]);

  const accountColumns = useMemo(() => [
    { key: 'company', label: 'Company', defaultWidth: 200, getSortValue: a => a.company.toLowerCase(), getFilterValue: a => a.company, exportValue: a => a.company, render: a => <span style={{ fontWeight: 600, color: a.prospect ? 'var(--color-accent)' : undefined }}>{a.company}</span> },
    { key: 'score', label: 'Score', defaultWidth: 190, getSortValue: a => a.result.score, getFilterValue: a => a.result.tier.label, exportValue: a => a.result.score, render: a => <RelationshipBadge result={a.result} extraTitle={`Best contact ${a.result.bestScore} + breadth ${a.result.breadth} x ${RELATIONSHIP_CONFIG.weights.breadth}`} /> },
    { key: 'tier', label: 'Tier', defaultWidth: 90, getSortValue: a => a.result.score, getFilterValue: a => a.result.tier.label, exportValue: a => a.result.tier.label, render: a => a.result.tier.label },
    { key: 'best', label: 'Best contact', defaultWidth: 170, getSortValue: a => a.result.bestScore, getFilterValue: a => contactName(a.result.best), exportValue: a => contactName(a.result.best), render: a => `${contactName(a.result.best) || a.result.best?.email || '-'} (${a.result.bestScore})` },
    { key: 'breadth', label: 'Breadth', defaultWidth: 80, getSortValue: a => a.result.breadth, exportValue: a => a.result.breadth, render: a => a.result.breadth },
    { key: 'engaged', label: 'Engaged contacts', defaultWidth: 110, getSortValue: a => a.result.engagedContacts, exportValue: a => a.result.engagedContacts, render: a => `${a.result.engagedContacts} of ${a.count}` },
    { key: 'roles', label: 'Buying roles', defaultWidth: 200, getSortValue: a => a.result.rolesCovered.length, getFilterValue: a => a.result.rolesCovered.join(', '), exportValue: a => a.result.rolesCovered.join(', '), render: a => a.result.rolesCovered.join(', ') || <span style={{ color: '#CBD5E1' }}>-</span> },
    { key: 'lastTwoWay', label: 'Last two-way', defaultWidth: 110, getSortValue: a => a.result.daysSinceTwoWay ?? 99999, exportValue: a => a.result.daysSinceTwoWay ?? '', render: a => daysLabel(a.result.daysSinceTwoWay) },
  ], []);

  const loggedCount = Object.values(log?.activities || {}).filter(a => !a.deleted).length;

  return (
    <div style={{ padding: '0.75rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 300px', maxWidth: 820 }}>
          Relationship Strength for every contact with activity on record: engagement (30%), reciprocity (20%),
          consistency (15%), opportunity history (10%) and relationship age (10%, full at 3 years, counted back to the
          oldest opp they are on). An account adds a breadth bonus (15%) for engaged
          contacts and buying roles covered. Strong is 75+, Warm 50-74, Developing 25-49, Cold under 25.
          The arrow compares the last 30 days with the 60 before. Tick up to {MAX_LINES} contacts to draw them on the chart.
        </div>
        <div style={{ display: 'inline-flex', gap: '0.35rem' }} role="group" aria-label="Which contacts">
          <button type="button" aria-pressed={scope === 'key'} onClick={() => setScope('key')} style={pillBtn(scope === 'key')}>Key Contacts</button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} style={pillBtn(scope === 'all')}>All contacts</button>
        </div>
        <button type="button" onClick={() => setLogging(true)} style={pillBtn(true)}>+ Log activity</button>
      </div>

      {indexLoaded && !hasFeed && (
        <div style={{ padding: '0.6rem 0.9rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.74rem', color: '#64748B' }}>
          No HubSpot, Granola or Outlook activity loaded yet. Open the Activity tab once to load it; until then the scores only see the
          {` ${loggedCount}`} activit{loggedCount === 1 ? 'y' : 'ies'} logged here.
        </div>
      )}

      {scored == null ? (
        <div className="loading">Loading contacts…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Stat label="Average score" value={latest?.average ?? '-'} sub={changeText(latest && prior ? latest.average - prior.average : null)} accent={AVERAGE_COLOR} />
            {TIERS.map(t => (
              <Stat key={t.key} label={t.label} value={latest?.[t.key] ?? 0} sub={changeText(latest && prior ? latest[t.key] - prior[t.key] : null)} accent={t.fill} />
            ))}
          </div>

          {scored.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
              {scope === 'key' ? 'No key contact has any activity on record yet. Switch to All contacts to see everyone.' : 'No contact has any activity on record yet.'} Log one with + Log activity, or open the Activity tab to pull HubSpot&apos;s.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: '0.75rem' }}>
              <div style={CARD}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Score over the last year</div>
                <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>One point a fortnight, each the score as of that day.</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EEF2F6" />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip lines={lines} />} cursor={{ stroke: '#CBD5E1' }} />
                    {lines.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }} itemSorter={null} />}
                    {lines.map(l => (
                      <Line
                        key={l.key}
                        type="monotone"
                        dataKey={l.key}
                        name={l.label}
                        stroke={l.color}
                        strokeWidth={2}
                        strokeDasharray={l.key === 'average' && lines.length > 1 ? '5 4' : undefined}
                        dot={false}
                        activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={CARD}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Contacts in each tier</div>
                <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>How many of your {scored.length} {scope === 'key' ? 'key ' : ''}contacts sat in each tier on that day.</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EEF2F6" />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip lines={TIERS.map(t => ({ key: t.key, label: t.label, color: t.fill }))} />} cursor={{ fill: '#F1F5F9' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }} itemSorter={null} />
                    {[...TIERS].reverse().map((t, i) => (
                      <Bar key={t.key} dataKey={t.key} name={t.label} stackId="tiers" fill={t.fill} stroke="#fff" strokeWidth={1} radius={i === TIERS.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }} role="tablist" aria-label="Relationships views">
            <button type="button" role="tab" aria-selected={view === 'review'} onClick={() => setView('review')} style={pillBtn(view === 'review')}>Review</button>
            <button type="button" role="tab" aria-selected={view === 'contacts'} onClick={() => setView('contacts')} style={pillBtn(view === 'contacts')}>Contacts ({rows.length})</button>
            <button type="button" role="tab" aria-selected={view === 'accounts'} onClick={() => setView('accounts')} style={pillBtn(view === 'accounts')}>Accounts ({accounts.length})</button>
            {pickedRows.length > 0 && (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8, fontSize: '0.7rem', color: '#475569' }}>
                On the chart:
                {pickedRows.map((r, i) => (
                  <span key={r.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: LINE_COLORS[i] }} />
                    {contactName(r.contact)}
                    <ScorePill score={r.result.score} tier={r.result.tier} showLabel={false} />
                  </span>
                ))}
                <button type="button" onClick={() => setPicked([])} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}>Clear</button>
              </span>
            )}
          </div>

          {view === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: '0.72rem', color: '#64748B', maxWidth: 820 }}>
                {reviewOf === 'accounts'
                  ? 'Each account against its own last year: how far its account score sits below its peak, and how long since a two-way touch with anyone there compared with the usual gap. Most pressing first. Click a row to open the company.'
                  : 'Each contact against their own last year: how far they sit below their peak score, and how long it has been since a two-way touch compared with the usual gap between them. Most pressing first. Click a row to draw that contact on the chart above.'}
              </div>
              <div role="group" aria-label="Review contacts or accounts" style={{ display: 'flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
                {[['contacts', `Contacts (${rows.length})`], ['accounts', `Accounts (${accountReviews.length})`]].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={reviewOf === k}
                    onClick={() => { setReviewOf(k); setReviewFilter(null); }}
                    style={{
                      padding: '0.3rem 0.8rem', border: 'none', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
                      background: reviewOf === k ? '#1E293B' : '#fff', color: reviewOf === k ? '#fff' : '#475569',
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter by status">
                <button type="button" aria-pressed={!reviewFilter} onClick={() => setReviewFilter(null)} style={{ ...pillBtn(!reviewFilter), fontSize: '0.72rem' }}>All {reviewList.length}</button>
                {statusCounts.map(st => {
                  const on = reviewFilter === st.key;
                  return (
                    <button
                      key={st.key}
                      type="button"
                      aria-pressed={on}
                      title={st.tip}
                      disabled={!st.count}
                      onClick={() => setReviewFilter(on ? null : st.key)}
                      style={{
                        padding: '0.28rem 0.75rem', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700,
                        cursor: st.count ? 'pointer' : 'default', opacity: st.count ? 1 : 0.5,
                        background: st.bg, color: st.color, border: `${on ? 2 : 1}px solid ${on ? st.color : st.border}`,
                      }}
                    >{st.label} {st.count}</button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ height: 560, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', flex: 'none' }}>
            {view === 'review' && reviewOf === 'accounts' ? (
              <DataTable
                key="account-review"
                tableId="relationship-account-review"
                columns={accountReviewColumns}
                rows={reviewRows}
                alwaysVisible={['status', 'company']}
                defaultSort={{ key: 'status', direction: 'asc' }}
                onRowClick={(a) => { if (a.prospect && onSelectProspect) onSelectProspect(a.prospect); }}
                exportFileName="relationship-account-review"
                settings={settings}
                updateSettings={updateSettings}
                emptyMessage="No accounts with this status"
              />
            ) : view === 'review' ? (
              <DataTable
                key="review"
                tableId="relationship-review"
                columns={reviewColumns}
                rows={reviewRows}
                alwaysVisible={['status', 'name']}
                defaultSort={{ key: 'status', direction: 'asc' }}
                onRowClick={(r) => togglePick(r.key)}
                exportFileName="relationship-review"
                settings={settings}
                updateSettings={updateSettings}
                emptyMessage="No contacts with this status"
              />
            ) : view === 'contacts' ? (
              <DataTable
                key="contacts"
                tableId="relationship-contacts"
                columns={contactColumns}
                rows={rows}
                alwaysVisible={['chart', 'name', 'score']}
                defaultSort={{ key: 'score', direction: 'desc' }}
                onRowClick={(r) => togglePick(r.key)}
                exportFileName="relationship-strength-contacts"
                settings={settings}
                updateSettings={updateSettings}
                emptyMessage="No contacts with activity"
              />
            ) : (
              <DataTable
                key="accounts"
                tableId="relationship-accounts"
                columns={accountColumns}
                rows={accounts}
                alwaysVisible={['company', 'score']}
                defaultSort={{ key: 'score', direction: 'desc' }}
                onRowClick={(a) => { if (a.prospect && onSelectProspect) onSelectProspect(a.prospect); }}
                exportFileName="relationship-strength-accounts"
                settings={settings}
                updateSettings={updateSettings}
                emptyMessage="No accounts with activity"
              />
            )}
          </div>
        </>
      )}

      {logging && <LogActivityModal contacts={contacts || []} onClose={() => setLogging(false)} />}

      {editingContact && (
        <Suspense fallback={null}>
          <ContactEditModal
            prospects={prospects}
            contact={editingContact}
            onSave={saveContact}
            onClose={closeContact}
            onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
            {...contactEditSettings}
            companyContacts={editCompanyContacts}
            allContacts={contacts || []}
            emailDomains={editEmailDomains}
            companyNames={editCompanyNames}
          />
        </Suspense>
      )}
    </div>
  );
}
