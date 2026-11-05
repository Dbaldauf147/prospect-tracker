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

import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isSchneiderContact } from '../../utils/contactRosters';
import { useAuth } from '../../contexts/AuthContext';
import { useRelationshipData } from '../../hooks/useRelationshipStrength';
import {
  RELATIONSHIP_CONFIG, DAY_MS, scoreContact, scoreAccount, oppsForContact, tierFor, contactKey, contactName, daysLabel,
} from '../../utils/relationshipStrength';
import { RelationshipBadge, ScorePill, TrendArrow } from '../Relationship/RelationshipBadge';
import { LogActivityModal } from '../Relationship/LogActivityModal';

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
  const { touchesFor, oppsRecords, hasFeed, log } = useRelationshipData();
  const [view, setView] = useState('contacts');
  const [picked, setPicked] = useState([]); // contact keys drawn on the chart
  const [logging, setLogging] = useState(false);
  // The day the page was opened. Fixed for the visit, so the scores are a
  // pure function of the data (a logged activity still re-scores at once).
  const [nowMs] = useState(() => Date.now());

  // Everyone with activity, their touches and today's score.
  const scored = useMemo(() => {
    if (!contacts) return null;
    const out = [];
    for (const c of contacts) {
      if (!usable(c)) continue;
      const touches = touchesFor(c);
      if (!touches.length) continue;
      const result = scoreContact(touches, { opps: oppsForContact(c, oppsRecords, { nowMs }), nowMs });
      out.push({ key: contactKey(c) || c.email, contact: c, touches, result });
    }
    return out;
  }, [contacts, touchesFor, oppsRecords, nowMs]);

  // Each contact's score a fortnight at a time over the year.
  const dates = useMemo(() => Array.from({ length: POINTS }, (_, i) => nowMs - (POINTS - 1 - i) * STEP_DAYS * DAY_MS), [nowMs]);
  const histories = useMemo(() => {
    if (!scored) return null;
    const map = new Map();
    for (const s of scored) {
      map.set(s.key, dates.map(at => scoreContact(s.touches, { opps: oppsForContact(s.contact, oppsRecords, { nowMs: at }), nowMs: at }).score));
    }
    return map;
  }, [scored, dates, oppsRecords]);

  const rows = useMemo(() => (scored || []).map(s => {
    const h = histories?.get(s.key) || [];
    const ago90 = h[Math.max(0, h.length - 1 - Math.round(90 / STEP_DAYS))];
    return { ...s, id: s.key, change90: h.length ? s.result.score - ago90 : null };
  }), [scored, histories]);

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
    { key: 'average', label: 'Average, all contacts', color: AVERAGE_COLOR },
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
      if (!groups.has(k)) groups.set(k, { company: name, entries: [] });
      groups.get(k).entries.push({ contact: r.contact, result: r.result });
    }
    return [...groups.entries()].map(([k, g]) => ({ id: k, company: g.company, count: g.entries.length, prospect: prospectByName.get(k) || null, result: scoreAccount(g.entries) }))
      .filter(a => a.result);
  }, [rows, prospectByName]);

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
    { key: 'name', label: 'Name', defaultWidth: 170, getSortValue: r => contactName(r.contact).toLowerCase(), getFilterValue: r => contactName(r.contact), exportValue: r => contactName(r.contact), render: r => <span style={{ fontWeight: 600 }}>{contactName(r.contact) || r.contact.email}</span> },
    { key: 'company', label: 'Company', defaultWidth: 170, getSortValue: r => companyOf(r.contact).toLowerCase(), getFilterValue: r => companyOf(r.contact), exportValue: r => companyOf(r.contact), render: r => companyOf(r.contact) || <span style={{ color: '#CBD5E1' }}>-</span> },
    { key: 'score', label: 'Score', defaultWidth: 190, getSortValue: r => r.result.score, getFilterValue: r => r.result.tier.label, exportValue: r => r.result.score, render: r => <RelationshipBadge result={r.result} /> },
    { key: 'tier', label: 'Tier', defaultWidth: 90, getSortValue: r => r.result.score, getFilterValue: r => r.result.tier.label, exportValue: r => r.result.tier.label, render: r => r.result.tier.label },
    { key: 'trend', label: 'Trend', defaultWidth: 70, getSortValue: r => ({ up: 2, flat: 1, down: 0 })[r.result.trend], getFilterValue: r => r.result.trend, exportValue: r => r.result.trend, render: r => <TrendArrow trend={r.result.trend} /> },
    { key: 'change90', label: 'Change 90d', defaultWidth: 90, getSortValue: r => r.change90 ?? -999, getFilterValue: r => String(r.change90 ?? ''), exportValue: r => r.change90 ?? '', render: r => (r.change90 == null ? '-' : `${r.change90 > 0 ? '+' : ''}${r.change90}`) },
    { key: 'lastTwoWay', label: 'Last two-way', defaultWidth: 110, getSortValue: r => r.result.daysSinceTwoWay ?? 99999, getFilterValue: r => daysLabel(r.result.daysSinceTwoWay), exportValue: r => r.result.daysSinceTwoWay ?? '', render: r => daysLabel(r.result.daysSinceTwoWay) },
    { key: 'engagement', label: 'Engagement', defaultWidth: 90, getSortValue: r => r.result.components.engagement, exportValue: r => r.result.components.engagement, render: r => r.result.components.engagement },
    { key: 'reciprocity', label: 'Reciprocity', defaultWidth: 90, getSortValue: r => r.result.components.reciprocity, exportValue: r => r.result.components.reciprocity, render: r => r.result.components.reciprocity },
    { key: 'consistency', label: 'Consistency', defaultWidth: 90, getSortValue: r => r.result.components.consistency, exportValue: r => r.result.components.consistency, render: r => r.result.components.consistency },
    { key: 'opportunity', label: 'Opps', defaultWidth: 70, getSortValue: r => r.result.components.opportunity, exportValue: r => r.result.components.opportunity, render: r => r.result.components.opportunity },
    { key: 'touches', label: 'Activities (12 mo)', defaultWidth: 110, getSortValue: r => r.result.touchCount, exportValue: r => r.result.touchCount, render: r => r.result.touchCount },
  ], [picked]);

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
          Relationship Strength for every contact with activity on record: engagement (35%), reciprocity (25%),
          consistency (15%) and opportunity history (10%). An account adds a breadth bonus (15%) for engaged
          contacts and buying roles covered. Strong is 75+, Warm 50-74, Developing 25-49, Cold under 25.
          The arrow compares the last 30 days with the 60 before. Tick up to {MAX_LINES} contacts to draw them on the chart.
        </div>
        <button type="button" onClick={() => setLogging(true)} style={pillBtn(true)}>+ Log activity</button>
      </div>

      {!hasFeed && (
        <div style={{ padding: '0.6rem 0.9rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.74rem', color: '#64748B' }}>
          No HubSpot activity loaded yet. Open the Activity tab once to pull it; until then the scores only see the
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
              No contact has any activity on record yet. Log one with + Log activity, or open the Activity tab to pull HubSpot&apos;s.
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
                <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>How many of your {scored.length} contacts sat in each tier on that day.</div>
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

          <div style={{ height: 560, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', flex: 'none' }}>
            {view === 'contacts' ? (
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
    </div>
  );
}
