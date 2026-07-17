import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { buildCompanyIndex, hasMatchInIndex } from '../../utils/companyIndex';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { userLsGet } from '../../utils/userLs';
import { getOppsSheetCsvUrl } from '../../utils/oppsSheetUrl';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { matchesCdm } from '../../utils/cdmMatch';

function EditableCell({ value, onCommit, color, suffix = '', bold = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = value == null || value === '' ? '—' : `${value}${suffix}`;
  const tdStyle = { padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: bold ? 600 : 400, color: color || 'inherit', cursor: 'pointer' };
  if (editing) {
    return (
      <td style={{ ...tdStyle, padding: '0.25rem 0.4rem' }}>
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onCommit(draft); }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{ width: '100%', padding: '2px 4px', fontSize: '0.75rem', fontWeight: bold ? 600 : 400, color: color || 'inherit', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'var(--color-surface)', textAlign: 'center', fontFamily: 'inherit' }}
        />
      </td>
    );
  }
  return (
    <td style={tdStyle} title="Click to edit" onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true); }}>
      {display}
    </td>
  );
}

const CHART_VIEW_OPTIONS = [
  { key: 'line', label: 'Line' },
  { key: 'stackedLine', label: 'Stacked Line' },
  { key: 'bar', label: 'Bar' },
  { key: 'stackedBar', label: 'Stacked Bar' },
  { key: 'area', label: 'Area' },
  { key: 'stackedArea', label: 'Stacked Area' },
];

// When a line-chart data point hits 100%, paint its dot dark green so a
// maxed-out metric jumps out at a glance.
const DARK_GREEN = '#15803D';
function makeDot(color, baseR) {
  function Dot(props) {
    const { cx, cy, value, index } = props;
    if (cx == null || cy == null) return null;
    const hit = value === 100;
    return (
      <circle
        key={`dot-${index}`}
        cx={cx}
        cy={cy}
        r={hit ? baseR + 1 : baseR}
        fill={hit ? DARK_GREEN : color}
        stroke={hit ? DARK_GREEN : color}
        strokeWidth={1}
      />
    );
  }
  return Dot;
}

// Build a derived dataset that adds, for each percent series, a parallel
// `${key}__green` key holding the value only where the point belongs to a
// dark-green segment (it, or a neighbor, hits 100%) and null elsewhere.
// A second Line drawn from this key with connectNulls=false overlays solid
// dark green exactly on the maxed-out stretches — far more reliable than an
// SVG stroke gradient, which renders inconsistently on near-flat lines.
function withGreenKeys(data, series) {
  return data.map((d, i) => {
    const row = { ...d };
    for (const s of series) {
      const v = d[s.key];
      const prev = i > 0 ? data[i - 1][s.key] : undefined;
      const next = i < data.length - 1 ? data[i + 1][s.key] : undefined;
      row[`${s.key}__green`] = (v === 100 || prev === 100 || next === 100) ? v : null;
    }
    return row;
  });
}

function ProgressChart({ title, data, series, isPct, defaultView = 'line', secondarySeries, onHide, onRename, onViewChange }) {
  const [viewType, setViewType] = useState(defaultView);
  // Persist the picked view so it becomes this chart's default next visit.
  const changeView = (v) => { setViewType(v); if (onViewChange) onViewChange(v); };
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // For percent line charts, augment the data with the green-overlay keys.
  const lineData = useMemo(() => (isPct ? withGreenKeys(data, series) : data), [data, series, isPct]);
  // Legend payload with explicit flat colors (the green overlay lines opt
  // out of the legend, and secondary series keep their own color).
  const lineLegendPayload = [
    ...series.map(s => ({ value: s.name, type: 'line', id: s.key, color: s.color })),
    ...(Array.isArray(secondarySeries) ? secondarySeries : []).map(s => ({ value: s.name, type: 'line', id: s.key, color: s.color })),
  ];
  const yProps = isPct
    ? { domain: [0, 100], tickFormatter: v => `${v}%` }
    : { allowDecimals: false };
  const tooltipFmt = isPct ? (v => `${v}%`) : undefined;
  const stacked = viewType === 'stackedBar' || viewType === 'stackedArea' || viewType === 'stackedLine';
  const hasSecondary = Array.isArray(secondarySeries) && secondarySeries.length > 0;
  function commitTitle() {
    setEditingTitle(false);
    if (onRename) onRename(titleDraft);
  }
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            autoFocus
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', padding: '2px 6px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-surface)', fontFamily: 'inherit', width: '100%', maxWidth: 400 }}
          />
        ) : (
          <h3
            onClick={onRename ? () => { setTitleDraft(title); setEditingTitle(true); } : undefined}
            title={onRename ? 'Click to rename' : undefined}
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, cursor: onRename ? 'text' : 'default' }}
          >{title}</h3>
        )}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <select
            value={viewType}
            onChange={e => changeView(e.target.value)}
            title="Chart view — your selection is saved as this chart's default"
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {CHART_VIEW_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              title="Hide this chart"
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, color: 'var(--color-text-secondary)', cursor: 'pointer', padding: '0.1rem 0.45rem', fontSize: '0.8rem', lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >×</button>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        {viewType === 'bar' || viewType === 'stackedBar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </BarChart>
        ) : viewType === 'area' || viewType === 'stackedArea' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Area key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.3} stackId={stacked ? 'a' : undefined} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </AreaChart>
        ) : viewType === 'stackedLine' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Area key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill="none" stackId="a" dot={isPct ? makeDot(s.color, 3) : { r: 3, fill: s.color }} activeDot={{ r: 5 }} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} payloadUniqBy={isPct ? (o => o.name) : undefined} />
            <Legend payload={isPct ? lineLegendPayload : undefined} />
            {series.map(s => (
              <Line key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={isPct ? makeDot(s.color, 4) : { r: 4 }} />
            ))}
            {isPct && series.map(s => (
              // Solid dark-green overlay on the maxed-out (100%) stretches.
              <Line key={`${s.key}__green`} yAxisId="left" type="monotone" dataKey={`${s.key}__green`} name={s.name} stroke={DARK_GREEN} strokeWidth={2.5} dot={false} activeDot={false} connectNulls={false} legendType="none" isAnimationActive={false} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

async function loadOppsFromIndexedDB() {
  try {
    const data = await loadOppsFromCache();
    return data?.records || [];
  } catch { return []; }
}

function getWeekKey(date) {
  let d;
  if (typeof date === 'string') {
    const [y, m, day] = date.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(date);
  }
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  // Acronym / single-token match — "TIAA" vs "(TIAA) Teachers
  // Insurance and Annuity Association of America". Parens act as
  // word separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

const HIDDEN_CHARTS_KEY = 'progress:hidden-charts';
const CHART_TITLES_KEY = 'progress:chart-titles';
const CHART_VIEWS_KEY = 'progress:chart-views';
const PROGRESS_CHART_DEFS = [
  { id: 'contactPct',     label: '% of Accounts with HubSpot Contacts' },
  { id: 'dmPct',          label: '% of Accounts with Decision Maker Identified' },
  { id: 'connectedPct',   label: '% of Accounts Connected (Had Opportunity)' },
  { id: 'inactivePct',    label: '% of Accounts Inactive (Lost / Hold Off / Old Client)' },
  { id: 'tierTotals',     label: 'My Accounts by Tier' },
  { id: 'noOppsActivity', label: 'Activity on Accounts with No Opportunities (30d)' },
  { id: 'peStages',       label: 'PE Firms by PE Stage' },
];

// PE Stage → snapshot field + chart color. Mirrors the four PE_STAGES on
// the PE Portfolio page so this chart tracks the same buckets. The snapshot
// stores one count per stage plus a rollup total.
const PE_STAGE_SERIES = [
  { stage: 'Discovery',            key: 'peDiscovery',           color: '#3B82F6' },
  { stage: 'Piloting',             key: 'pePiloting',            color: '#F59E0B' },
  { stage: 'Existing Partnership', key: 'peExistingPartnership', color: '#10B981' },
  { stage: 'Not Sold',             key: 'peNotSold',             color: '#DC2626' },
];
function loadHiddenCharts() {
  try {
    const raw = localStorage.getItem(HIDDEN_CHARTS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}
function persistHiddenCharts(set) {
  try { localStorage.setItem(HIDDEN_CHARTS_KEY, JSON.stringify([...set])); } catch {}
}

function loadChartTitles() {
  try {
    const raw = localStorage.getItem(CHART_TITLES_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
function persistChartTitles(map) {
  try { localStorage.setItem(CHART_TITLES_KEY, JSON.stringify(map)); } catch {}
}

// Per-chart default view (line / bar / area / …). Whatever view the user
// picks from a chart's dropdown is saved here keyed by chart id, so it
// becomes that chart's default on the next visit.
function loadChartViews() {
  try {
    const raw = localStorage.getItem(CHART_VIEWS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
function persistChartViews(map) {
  try { localStorage.setItem(CHART_VIEWS_KEY, JSON.stringify(map)); } catch {}
}

export function ProgressView({ prospects, settings, cdmName }) {
  const { user, isAdmin } = useAuth();
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [oppsRecordsState, setOppsRecordsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCard, setExpandedCard] = useState(null);
  const [editingWeek, setEditingWeek] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [hubspotContactsState, setHubspotContactsState] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setHubspotContactsState(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);
  const [hiddenCharts, setHiddenCharts] = useState(() => loadHiddenCharts());
  const [showChartsMenu, setShowChartsMenu] = useState(false);
  const [chartTitles, setChartTitles] = useState(() => loadChartTitles());
  const [chartViews, setChartViews] = useState(() => loadChartViews());
  const setChartView = (id, view) => {
    setChartViews(prev => {
      const next = { ...prev, [id]: view };
      persistChartViews(next);
      return next;
    });
  };
  const toggleChartHidden = (id) => {
    setHiddenCharts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistHiddenCharts(next);
      return next;
    });
  };
  const renameChart = (id, nextTitle) => {
    setChartTitles(prev => {
      const next = { ...prev };
      const trimmed = (nextTitle || '').trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      persistChartTitles(next);
      return next;
    });
  };
  const titleFor = (id, fallback) => chartTitles[id] || fallback;
  const viewFor = (id, fallback = 'line') => chartViews[id] || fallback;

  // Load history from Firestore + opps data
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'progressHistory', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const weeks = snap.data().weeks || [];
          console.log('[ProgressView] Firestore progressHistory loaded:', weeks.length, 'weeks:', weeks.map(w => w.week));
          setHistory(weeks);
          setHistoryLoaded(true);
        } else {
          console.log('[ProgressView] Firestore progressHistory doc does NOT exist for user', user.uid);
          setHistoryLoaded(true);
        }
      } catch (err) {
        console.error('[ProgressView] Failed to load progress — auto-save disabled to avoid overwrite:', err);
      }

      // Load opps: try the user's configured Opps sheet first, then
      // Firestore, then IndexedDB, then localStorage. When the user
      // hasn't configured a sheet (and isn't admin), skip the network
      // fetch entirely so we don't pull another user's data.
      let records = [];
      try {
        const oppsSheetUrl = getOppsSheetCsvUrl({ isAdmin, settings });
        const sheetRes = oppsSheetUrl ? await fetch(oppsSheetUrl) : null;
        if (sheetRes && sheetRes.ok) {
          const csvText = await sheetRes.text();
          const lines = csvText.split('\n');
          if (lines.length > 1) {
            // Parse CSV
            function parseLine(line) {
              const fields = []; let current = ''; let inQ = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { inQ = !inQ; continue; }
                if (ch === ',' && !inQ) { fields.push(current.trim()); current = ''; continue; }
                current += ch;
              }
              fields.push(current.trim());
              return fields;
            }
            const headers = parseLine(lines[0]);
            for (let i = 1; i < lines.length; i++) {
              if (!lines[i].trim()) continue;
              const vals = parseLine(lines[i]);
              const obj = {};
              let hasData = false;
              headers.forEach((h, j) => {
                const val = (vals[j] || '').trim();
                // For duplicate headers, keep the first non-empty value
                if (obj[h] !== undefined && obj[h] !== '' && obj[h] !== '-' && obj[h] !== '#N/A') return;
                obj[h] = val;
                if (val && val !== '-' && val !== '#N/A') hasData = true;
              });
              // Use first Stage column (skip duplicate)
              if (hasData && obj['Account']) records.push(obj);
            }
          }
        }
      } catch {}
      if (records.length === 0) {
        // Opps 2 is the canonical store. Fall back to the Opps 2
        // Firestore doc when the local IDB cache is empty (e.g. fresh
        // browser, never opened Opps 2 here yet).
        try {
          const oppsRef = doc(db, 'opps2Data', user.uid);
          const oppsSnap = await getDoc(oppsRef);
          if (oppsSnap.exists()) {
            const raw = oppsSnap.data();
            const parsed = raw.json ? JSON.parse(raw.json) : raw;
            records = parsed?.records || [];
          }
        } catch { /* ignore */ }
      }
      if (records.length === 0) {
        records = await loadOppsFromIndexedDB();
      }
      console.log(`Progress: loaded ${records.length} opps records`);
      setOppsRecordsState(records);
      setLoading(false);
    })();
  }, [user]);

  // Compute current week's snapshot
  const currentSnapshot = useMemo(() => {
    const targetMap = settings?.targetMap || {};
    // Only count the configured user's accounts (same filter as My Accounts)
    const myProspects = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const t1 = myProspects.filter(p => p.tier === 'Tier 1');
    const t2 = myProspects.filter(p => p.tier === 'Tier 2');
    const t3 = myProspects.filter(p => p.tier === 'Tier 3');

    // Load HubSpot cache for contact data (loaded async into hubspotContactsState)
    const hubspotContacts = hubspotContactsState;

    const contactCompanies = new Set();
    const contactDomains = new Set();
    const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);
    for (const c of hubspotContacts) {
      const co = (c.company || '').toLowerCase();
      if (co) contactCompanies.add(co);
      if (c.email) {
        const at = c.email.lastIndexOf('@');
        if (at >= 0) {
          const d = c.email.slice(at + 1).toLowerCase().trim();
          if (d && !FREE_MAIL.has(d)) contactDomains.add(d);
        }
      }
    }

    // Use opps data loaded from Firestore/IndexedDB/localStorage
    // Build totalOppsByAccount the same way as My Accounts
    const oppsRecords = oppsRecordsState;
    const invalidStages = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    const totalOppsByAccount = {};
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      const stage = (r['Stage'] || '').trim();
      if (!account || invalidStages.has(stage)) continue;
      totalOppsByAccount[account] = (totalOppsByAccount[account] || 0) + 1;
    }

    // Match the My Accounts contact-count rule: a prospect has contacts
    // if any HubSpot contact's Company text matches OR if its email
    // domain matches one of the prospect's registered email-domain or
    // website domains. Without the domain fallback, accounts like TIAA —
    // where contacts share "@tiaa.org" but their Company text varies —
    // get undercounted vs the My Accounts table.
    function prospectDomains(p) {
      const out = new Set();
      if (p?.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
          if (d) out.add(d);
        }
      }
      if (p?.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
        if (d) out.add(d);
      }
      return out;
    }
    const contactCompaniesIndex = buildCompanyIndex([...contactCompanies]);
    function hasContact(p) {
      const lower = (p?.company || '').toLowerCase();
      if (hasMatchInIndex(contactCompaniesIndex, lower)) return true;
      for (const d of prospectDomains(p)) {
        if (contactDomains.has(d)) return true;
      }
      return false;
    }

    // Match the Opps column logic: account has opps if totalOppsByAccount > 0 (fuzzy match)
    const oppsKeysWithCount = Object.keys(totalOppsByAccount).filter(k => totalOppsByAccount[k] > 0);
    const oppsIndex = buildCompanyIndex(oppsKeysWithCount);
    function hasOpp(company) {
      const lower = (company || '').toLowerCase().trim();
      if (totalOppsByAccount[lower] > 0) return true;
      if (hasMatchInIndex(oppsIndex, lower)) return true;
      // First-word parent fallback (e.g. "Brookfield Asset Management" matches "Brookfield (X)")
      const firstWord = lower.split(/\s/)[0];
      if (firstWord.length >= 4) {
        for (const oppsCompany of oppsKeysWithCount) {
          if (oppsCompany.startsWith(firstWord)) return true;
        }
      }
      return false;
    }

    // Build DM companies set — companies with at least one contact tagged as Decision Maker
    const dmCompanies = new Set();
    for (const c of hubspotContacts) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('decision maker')) {
        const co = (c.company || '').toLowerCase();
        if (co) dmCompanies.add(co);
      }
    }

    // Build per-company activity counts from the local activity cache —
    // 30-day window, same rule MyAccountsView uses. Powers the "No-Opps
    // Activity" chart (sum of activity events on accounts with zero
    // opps, so we can watch outreach stay alive on cold accounts).
    const activityByCompany = (() => {
      const counts = {};
      let cache = null;
      try { cache = JSON.parse(userLsGet('hubspot-activity-cache')); } catch {}
      if (!cache) return counts;
      const domainMap = new Map();
      const contactMap = new Map();
      for (const c of hubspotContacts) {
        if (c.email && c.company) contactMap.set(c.email.toLowerCase(), c.company.toLowerCase());
      }
      for (const p of myProspects) {
        if (p.emailDomain) {
          const entries = p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
          for (const entry of entries) {
            const atIdx = entry.lastIndexOf('@');
            const domain = atIdx >= 0 ? entry.slice(atIdx + 1).toLowerCase() : entry.toLowerCase();
            if (domain && p.company) domainMap.set(domain, p.company.toLowerCase());
          }
        }
        if (p.website) {
          const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
          if (d && p.company) domainMap.set(d, p.company.toLowerCase());
        }
      }
      const matchCompany = (email) => {
        if (!email) return null;
        const parts = email.split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const e of parts) {
          if (e.endsWith('@se.com')) continue;
          if (contactMap.has(e)) return contactMap.get(e);
          const atIdx = e.lastIndexOf('@');
          if (atIdx >= 0) {
            const domain = e.slice(atIdx + 1);
            if (domainMap.has(domain)) return domainMap.get(domain);
          }
        }
        return null;
      };
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const e of (cache.emails || [])) {
        if (e.hs_timestamp && new Date(e.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(e.hs_email_to_email) || matchCompany(e.hs_email_from_email);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
      for (const c of (cache.calls || [])) {
        if (c.hs_timestamp && new Date(c.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(c.hs_call_to_number) || matchCompany(c.hs_call_from_number);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
      return counts;
    })();

    const dmCompaniesIndex = buildCompanyIndex([...dmCompanies]);
    function hasDM(company) {
      const lower = (company || '').toLowerCase();
      if (hasMatchInIndex(dmCompaniesIndex, lower)) return true;
      // Also check first-word match for parent companies
      const firstWord = lower.split(/\s/)[0];
      if (firstWord.length >= 4) {
        for (const co of dmCompanies) {
          if (co.startsWith(firstWord)) return true;
        }
      }
      return false;
    }

    const inactiveStatuses = new Set(['Lost - Not Sold', 'Hold Off', 'Old Client']);

    const t1Total = t1.length;
    const t2Total = t2.length;
    const t1WithContactsList = t1.filter(p => hasContact(p));
    const t2WithContactsList = t2.filter(p => hasContact(p));
    const t1WithDMList = t1.filter(p => hasDM(p.company));
    const t2WithDMList = t2.filter(p => hasDM(p.company));
    const t1ConnectedList = t1.filter(p => hasOpp(p.company));
    const t2ConnectedList = t2.filter(p => hasOpp(p.company));
    const t1InactiveList = t1.filter(p => inactiveStatuses.has(p.status));
    const t2InactiveList = t2.filter(p => inactiveStatuses.has(p.status));
    const t1WithContacts = t1WithContactsList.length;
    const t2WithContacts = t2WithContactsList.length;
    const t1WithDM = t1WithDMList.length;
    const t2WithDM = t2WithDMList.length;
    const t1Connected = t1ConnectedList.length;
    const t2Connected = t2ConnectedList.length;
    const t1Inactive = t1InactiveList.length;
    const t2Inactive = t2InactiveList.length;

    // Also build "not" lists
    const t1NoContacts = t1.filter(p => !hasContact(p));
    const t2NoContacts = t2.filter(p => !hasContact(p));
    const t1NoDM = t1.filter(p => !hasDM(p.company));
    const t2NoDM = t2.filter(p => !hasDM(p.company));
    const t1NotConnected = t1.filter(p => !hasOpp(p.company));
    const t2NotConnected = t2.filter(p => !hasOpp(p.company));

    // No-opps activity: sum 30-day activity event count across My
    // Accounts that DON'T have any opps — track outreach to cold
    // accounts. Also break out by tier so the chart can layer them.
    const sumActivity = (list) => list.reduce((s, p) => {
      const c = activityByCompany[(p.company || '').toLowerCase()] || 0;
      return s + c;
    }, 0);
    const noOppsActivityT1 = sumActivity(t1NotConnected);
    const noOppsActivityT2 = sumActivity(t2NotConnected);
    const noOppsActivityT3 = sumActivity(t3.filter(p => !hasOpp(p.company)));
    const noOppsActivityTotal = noOppsActivityT1 + noOppsActivityT2 + noOppsActivityT3;
    const noOppsAccountCount = t1NotConnected.length + t2NotConnected.length + t3.filter(p => !hasOpp(p.company)).length;

    // PE firms by PE Stage — mirrors the PE Portfolio page, which lists
    // every prospect typed "Private Equity" and buckets it by the peStage
    // set in its company popup (Discovery / Piloting / Existing Partnership
    // / Not Sold). No CDM filter here, to match that page's total.
    const peFirms = prospects.filter(p => p.type === 'Private Equity');
    const peStageCounts = {};
    const peStageDetails = {};
    for (const s of PE_STAGE_SERIES) { peStageCounts[s.key] = 0; peStageDetails[s.key] = []; }
    for (const p of peFirms) {
      const s = PE_STAGE_SERIES.find(x => x.stage === String(p.peStage || '').trim());
      if (!s) continue;
      peStageCounts[s.key]++;
      peStageDetails[s.key].push(p.company);
    }
    const peTotal = peFirms.length;

    return {
      week: getWeekKey(new Date()),
      t1Total, t2Total, t3Total: t3.length,
      tierCounts: { t1: t1.length, t2: t2.length, t3: t3.length },
      t1WithContacts, t2WithContacts,
      t1WithDM, t2WithDM,
      t1Connected, t2Connected,
      t1Inactive, t2Inactive,
      noOppsActivityT1,
      noOppsActivityT2,
      noOppsActivityT3,
      noOppsActivityTotal,
      noOppsAccountCount,
      ...peStageCounts,
      peTotal,
      t1ContactPct: t1Total > 0 ? Math.round((t1WithContacts / t1Total) * 100) : 0,
      t2ContactPct: t2Total > 0 ? Math.round((t2WithContacts / t2Total) * 100) : 0,
      t1DMPct: t1Total > 0 ? Math.round((t1WithDM / t1Total) * 100) : 0,
      t2DMPct: t2Total > 0 ? Math.round((t2WithDM / t2Total) * 100) : 0,
      t1ConnectedPct: t1Total > 0 ? Math.round((t1Connected / t1Total) * 100) : 0,
      t2ConnectedPct: t2Total > 0 ? Math.round((t2Connected / t2Total) * 100) : 0,
      t1InactivePct: t1Total > 0 ? Math.round((t1Inactive / t1Total) * 100) : 0,
      t2InactivePct: t2Total > 0 ? Math.round((t2Inactive / t2Total) * 100) : 0,
      // Detail lists for drill-down
      details: {
        t1WithContacts: t1WithContactsList.map(p => p.company),
        t1NoContacts: t1NoContacts.map(p => p.company),
        t2WithContacts: t2WithContactsList.map(p => p.company),
        t2NoContacts: t2NoContacts.map(p => p.company),
        t1WithDM: t1WithDMList.map(p => p.company),
        t1NoDM: t1NoDM.map(p => p.company),
        t2WithDM: t2WithDMList.map(p => p.company),
        t2NoDM: t2NoDM.map(p => p.company),
        t1Connected: t1ConnectedList.map(p => p.company),
        t1NotConnected: t1NotConnected.map(p => p.company),
        t2Connected: t2ConnectedList.map(p => p.company),
        t2NotConnected: t2NotConnected.map(p => p.company),
        t1Inactive: t1InactiveList.map(p => ({ company: p.company, status: p.status })),
        t2Inactive: t2InactiveList.map(p => ({ company: p.company, status: p.status })),
        ...peStageDetails,
      },
    };
  }, [prospects, settings, oppsRecordsState, hubspotContactsState, cdmName]);

  // Auto-save the current week whenever the snapshot numbers settle.
  // Re-fires on any snapshot-number change (not just mount) so the last
  // visit of the week "locks in" the final state even if the user never
  // clicks Save. Debounced so a single mount with streaming data doesn't
  // hammer Firestore.
  useEffect(() => {
    if (!user?.uid || loading || !historyLoaded) return;
    if (!currentSnapshot.t1Total) return; // prospects still loading
    const t = setTimeout(() => { saveSnapshot(); }, 800);
    return () => clearTimeout(t);
  }, [
    user?.uid, loading, historyLoaded,
    currentSnapshot.week,
    currentSnapshot.t1Total, currentSnapshot.t2Total, currentSnapshot.t3Total,
    currentSnapshot.t1WithContacts, currentSnapshot.t2WithContacts,
    currentSnapshot.t1WithDM, currentSnapshot.t2WithDM,
    currentSnapshot.t1Connected, currentSnapshot.t2Connected,
    currentSnapshot.t1Inactive, currentSnapshot.t2Inactive,
    currentSnapshot.noOppsActivityTotal, currentSnapshot.noOppsAccountCount,
    currentSnapshot.peTotal,
    currentSnapshot.peDiscovery, currentSnapshot.pePiloting,
    currentSnapshot.peExistingPartnership, currentSnapshot.peNotSold,
  ]);

  // Save current week snapshot — re-reads Firestore first to avoid overwriting
  // entries saved from another device or missed by a failed load.
  async function saveSnapshot() {
    if (!user?.uid) {
      console.warn('[ProgressView] saveSnapshot: no user uid, bailing');
      setSaveStatus('Not signed in');
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }
    console.log('[ProgressView] saveSnapshot: starting for week', currentSnapshot.week);
    setSaveStatus('Saving…');
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      const snap = await getDoc(ref);
      const remoteWeeks = snap.exists() ? (snap.data().weeks || []) : [];
      const merged = [...remoteWeeks];
      for (const h of history) {
        if (!merged.find(m => m.week === h.week)) merged.push(h);
      }
      const idx = merged.findIndex(h => h.week === currentSnapshot.week);
      // Strip undefined values (Firestore rejects them)
      const clean = JSON.parse(JSON.stringify(currentSnapshot));
      if (idx >= 0) merged[idx] = clean;
      else merged.push(clean);
      merged.sort((a, b) => a.week.localeCompare(b.week));
      setHistory(merged);
      await setDoc(ref, { weeks: merged, updatedAt: new Date().toISOString() });
      console.log('[ProgressView] saveSnapshot: saved', merged.length, 'weeks');
      setSaveStatus(`Saved ✓ (${merged.length} week${merged.length === 1 ? '' : 's'})`);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('[ProgressView] Failed to save progress:', err);
      setSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setSaveStatus(''), 5000);
    }
  }

  // Edit a single numeric field on a historical week (or promote the current-week row into history)
  async function updateWeekField(weekKey, field, rawValue) {
    if (!user?.uid) return;
    const parsed = rawValue === '' || rawValue == null ? null : Number(rawValue);
    if (rawValue !== '' && Number.isNaN(parsed)) return;
    const inHistory = history.find(h => h.week === weekKey);
    const existingValue = inHistory ? inHistory[field] : currentSnapshot[field];
    if (parsed === existingValue) return;
    let updated;
    if (inHistory) {
      updated = history.map(h => h.week === weekKey ? { ...h, [field]: parsed } : h);
    } else {
      const clean = JSON.parse(JSON.stringify(currentSnapshot));
      updated = [...history, { ...clean, week: weekKey, [field]: parsed }];
    }
    updated.sort((a, b) => a.week.localeCompare(b.week));
    setHistory(updated);
    setSaveStatus('Saving…');
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('[ProgressView] Failed to save cell edit:', err);
      setSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setSaveStatus(''), 5000);
    }
  }

  const chartData = useMemo(() => {
    const data = [...history];
    // Add current week if not already saved
    if (!data.find(h => h.week === currentSnapshot.week)) {
      data.push(currentSnapshot);
    } else {
      // Update current week with live data
      const idx = data.findIndex(h => h.week === currentSnapshot.week);
      data[idx] = currentSnapshot;
    }
    return data.map(d => ({
      ...d,
      weekLabel: new Date(d.week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      totalAccounts: (d.t1Total || 0) + (d.t2Total || 0) + (d.t3Total || 0),
    }));
  }, [history, currentSnapshot]);

  function fmtWeek(w) {
    return new Date(w + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Weekly Progress</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {saveStatus && (
            <span style={{ fontSize: '0.75rem', color: saveStatus.startsWith('Saved') ? '#10B981' : saveStatus.startsWith('Sav') ? 'var(--color-text-secondary)' : '#DC2626', fontWeight: 600 }}>
              {saveStatus}
            </span>
          )}
          <button
            onClick={saveSnapshot}
            style={{
              padding: '0.4rem 0.8rem', border: 'none', borderRadius: '6px',
              background: 'var(--color-accent)', color: '#fff', fontSize: '0.8rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            Save This Week's Snapshot
          </button>
        </div>
      </div>

      {/* Current stats */}
      {(() => {
        const cards = [
          { key: 'contacts', label: 'Accounts with Contacts', color: '#3B82F6', t1: currentSnapshot.t1WithContacts, t2: currentSnapshot.t2WithContacts, t1Pct: currentSnapshot.t1ContactPct, t2Pct: currentSnapshot.t2ContactPct,
            t1Yes: currentSnapshot.details?.t1WithContacts || [], t1No: currentSnapshot.details?.t1NoContacts || [],
            t2Yes: currentSnapshot.details?.t2WithContacts || [], t2No: currentSnapshot.details?.t2NoContacts || [] },
          { key: 'dm', label: 'Decision Maker Identified', color: '#7C3AED', t1: currentSnapshot.t1WithDM || 0, t2: currentSnapshot.t2WithDM || 0, t1Pct: currentSnapshot.t1DMPct || 0, t2Pct: currentSnapshot.t2DMPct || 0,
            t1Yes: currentSnapshot.details?.t1WithDM || [], t1No: currentSnapshot.details?.t1NoDM || [],
            t2Yes: currentSnapshot.details?.t2WithDM || [], t2No: currentSnapshot.details?.t2NoDM || [] },
          { key: 'connected', label: 'Connected (Had Opp)', color: '#10B981', t1: currentSnapshot.t1Connected, t2: currentSnapshot.t2Connected, t1Pct: currentSnapshot.t1ConnectedPct, t2Pct: currentSnapshot.t2ConnectedPct,
            t1Yes: currentSnapshot.details?.t1Connected || [], t1No: currentSnapshot.details?.t1NotConnected || [],
            t2Yes: currentSnapshot.details?.t2Connected || [], t2No: currentSnapshot.details?.t2NotConnected || [] },
          { key: 'inactive', label: 'Inactive (Lost/Hold/Old)', color: '#F59E0B', t1: currentSnapshot.t1Inactive, t2: currentSnapshot.t2Inactive, t1Pct: currentSnapshot.t1InactivePct, t2Pct: currentSnapshot.t2InactivePct,
            t1Yes: (currentSnapshot.details?.t1Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`),
            t1No: [], t2Yes: (currentSnapshot.details?.t2Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`), t2No: [] },
        ];
        return (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', flex: expandedCard ? '0 0 55%' : '1' }}>
              {cards.map(card => (
                <div key={card.key} onClick={() => setExpandedCard(expandedCard === card.key ? null : card.key)}
                  style={{ padding: '0.75rem', background: expandedCard === card.key ? '#F0F9FF' : 'var(--color-surface)', border: expandedCard === card.key ? '2px solid ' + card.color : '1px solid var(--color-border)', borderRadius: '8px', borderLeft: `3px solid ${card.color}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{card.t1Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({card.t1}/{currentSnapshot.t1Total})</span></div>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{card.t2Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({card.t2}/{currentSnapshot.t2Total})</span></div>
                  </div>
                </div>
              ))}
            </div>
            {expandedCard && (() => {
              const card = cards.find(c => c.key === expandedCard);
              if (!card) return null;
              return (
                <div style={{ flex: '0 0 50%', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{card.label}</h4>
                    <button onClick={e => { e.stopPropagation(); setExpandedCard(null); }} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer' }}>&times;</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 1 — Yes ({card.t1Yes.length})</div>
                      {card.t1Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t1No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 1 — No ({card.t1No.length})</div>
                          {card.t1No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#3B82F6', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 2 — Yes ({card.t2Yes.length})</div>
                      {card.t2Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t2No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 2 — No ({card.t2No.length})</div>
                          {card.t2No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Charts */}
      {chartData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowChartsMenu(v => !v)}
              title="Show / hide individual charts"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              Charts <span style={{ opacity: 0.7 }}>({PROGRESS_CHART_DEFS.length - hiddenCharts.size}/{PROGRESS_CHART_DEFS.length})</span>
            </button>
            {showChartsMenu && (
              <div
                style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 280, padding: '0.4rem 0.5rem' }}
                onClick={e => e.stopPropagation()}
              >
                {PROGRESS_CHART_DEFS.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', cursor: 'pointer', fontSize: '0.72rem' }}>
                    <input type="checkbox" checked={!hiddenCharts.has(c.id)} onChange={() => toggleChartHidden(c.id)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            {!hiddenCharts.has('contactPct') && (
              <ProgressChart
                title={titleFor('contactPct', '% of Accounts with HubSpot Contacts')}
                data={chartData}
                series={[{ key: 't1ContactPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ContactPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('contactPct')}
                onViewChange={(v) => setChartView('contactPct', v)}
                onHide={() => toggleChartHidden('contactPct')}
                onRename={(t) => renameChart('contactPct', t)}
              />
            )}
            {!hiddenCharts.has('dmPct') && (
              <ProgressChart
                title={titleFor('dmPct', '% of Accounts with Decision Maker Identified')}
                data={chartData}
                series={[{ key: 't1DMPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2DMPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('dmPct')}
                onViewChange={(v) => setChartView('dmPct', v)}
                onHide={() => toggleChartHidden('dmPct')}
                onRename={(t) => renameChart('dmPct', t)}
              />
            )}
            {!hiddenCharts.has('connectedPct') && (
              <ProgressChart
                title={titleFor('connectedPct', '% of Accounts Connected (Had Opportunity)')}
                data={chartData}
                series={[{ key: 't1ConnectedPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ConnectedPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('connectedPct')}
                onViewChange={(v) => setChartView('connectedPct', v)}
                onHide={() => toggleChartHidden('connectedPct')}
                onRename={(t) => renameChart('connectedPct', t)}
              />
            )}
            {!hiddenCharts.has('inactivePct') && (
              <ProgressChart
                title={titleFor('inactivePct', '% of Accounts Inactive (Lost / Hold Off / Old Client)')}
                data={chartData}
                series={[{ key: 't1InactivePct', name: 'Tier 1', color: '#DC2626' }, { key: 't2InactivePct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('inactivePct')}
                onViewChange={(v) => setChartView('inactivePct', v)}
                onHide={() => toggleChartHidden('inactivePct')}
                onRename={(t) => renameChart('inactivePct', t)}
              />
            )}
            {!hiddenCharts.has('tierTotals') && (
              <ProgressChart
                title={titleFor('tierTotals', 'My Accounts by Tier')}
                data={chartData}
                series={[
                  { key: 't1Total', name: 'Tier 1', color: '#DC2626' },
                  { key: 't2Total', name: 'Tier 2', color: '#3B82F6' },
                  { key: 't3Total', name: 'Tier 3', color: '#F59E0B' },
                ]}
                secondarySeries={[
                  { key: 'totalAccounts', name: 'Total Accounts', color: '#111827' },
                ]}
                defaultView={viewFor('tierTotals')}
                onViewChange={(v) => setChartView('tierTotals', v)}
                onHide={() => toggleChartHidden('tierTotals')}
                onRename={(t) => renameChart('tierTotals', t)}
              />
            )}
            {!hiddenCharts.has('noOppsActivity') && (
              <ProgressChart
                title={titleFor('noOppsActivity', 'Activity on Accounts with No Opportunities (30d)')}
                data={chartData}
                series={[
                  { key: 'noOppsActivityT1', name: 'Tier 1', color: '#DC2626' },
                  { key: 'noOppsActivityT2', name: 'Tier 2', color: '#3B82F6' },
                  { key: 'noOppsActivityT3', name: 'Tier 3', color: '#F59E0B' },
                ]}
                secondarySeries={[
                  { key: 'noOppsAccountCount', name: 'No-Opps Accounts', color: '#111827' },
                ]}
                defaultView={viewFor('noOppsActivity')}
                onViewChange={(v) => setChartView('noOppsActivity', v)}
                onHide={() => toggleChartHidden('noOppsActivity')}
                onRename={(t) => renameChart('noOppsActivity', t)}
              />
            )}
            {!hiddenCharts.has('peStages') && (
              <ProgressChart
                title={titleFor('peStages', 'PE Firms by PE Stage')}
                data={chartData}
                series={PE_STAGE_SERIES.map(s => ({ key: s.key, name: s.stage, color: s.color }))}
                secondarySeries={[
                  { key: 'peTotal', name: 'Total PE Firms', color: '#111827' },
                ]}
                defaultView={viewFor('peStages', 'stackedBar')}
                onViewChange={(v) => setChartView('peStages', v)}
                onHide={() => toggleChartHidden('peStages')}
                onRename={(t) => renameChart('peStages', t)}
              />
            )}
          </div>

          {/* History table */}
          {chartData.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>Weekly History</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)' }}>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>Week</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#F59E0B', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T3</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', width: '36px', borderBottom: '1px solid var(--color-border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((h, i) => (
                    <tr key={h.week} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>
                        {editingWeek === h.week ? (
                          <input
                            type="date"
                            defaultValue={h.week}
                            autoFocus
                            style={{ fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 4px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                            onBlur={async (e) => {
                              const newDate = e.target.value;
                              setEditingWeek(null);
                              if (!newDate || newDate === h.week) return;
                              const newWeek = getWeekKey(newDate);
                              if (newWeek === h.week) return;
                              if (history.find(x => x.week === newWeek)) {
                                alert('A snapshot for that week already exists.');
                                return;
                              }
                              const inHistory = history.find(x => x.week === h.week);
                              let updated;
                              if (inHistory) {
                                updated = history.map(x => x.week === h.week ? { ...x, week: newWeek } : x);
                              } else {
                                // Editing the not-yet-saved current-week row: create a new history entry
                                const clean = JSON.parse(JSON.stringify(currentSnapshot));
                                updated = [...history, { ...clean, week: newWeek }];
                              }
                              updated.sort((a, b) => a.week.localeCompare(b.week));
                              setHistory(updated);
                              setSaveStatus('Saving…');
                              try {
                                const ref = doc(db, 'progressHistory', user.uid);
                                await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                                setSaveStatus('Saved ✓');
                                setTimeout(() => setSaveStatus(''), 3000);
                              } catch (err) {
                                console.error('[ProgressView] Failed to save week edit:', err);
                                setSaveStatus('Save failed: ' + (err?.message || err));
                                setTimeout(() => setSaveStatus(''), 5000);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.target.blur();
                              if (e.key === 'Escape') setEditingWeek(null);
                            }}
                          />
                        ) : (
                          <span
                            style={{ cursor: 'pointer', borderBottom: '1px dashed var(--color-border)' }}
                            onClick={() => setEditingWeek(h.week)}
                            title="Click to change week"
                          >
                            {fmtWeek(h.week)}
                          </span>
                        )}
                      </td>
                      <EditableCell value={h.t1Total} onCommit={v => updateWeekField(h.week, 't1Total', v)} color="#DC2626" bold />
                      <EditableCell value={h.t2Total} onCommit={v => updateWeekField(h.week, 't2Total', v)} color="#3B82F6" bold />
                      <EditableCell value={h.t3Total} onCommit={v => updateWeekField(h.week, 't3Total', v)} color="#F59E0B" bold />
                      <EditableCell value={h.t1ContactPct} onCommit={v => updateWeekField(h.week, 't1ContactPct', v)} suffix="%" />
                      <EditableCell value={h.t2ContactPct} onCommit={v => updateWeekField(h.week, 't2ContactPct', v)} suffix="%" />
                      <EditableCell value={h.t1ConnectedPct} onCommit={v => updateWeekField(h.week, 't1ConnectedPct', v)} suffix="%" />
                      <EditableCell value={h.t2ConnectedPct} onCommit={v => updateWeekField(h.week, 't2ConnectedPct', v)} suffix="%" />
                      <EditableCell value={h.t1InactivePct} onCommit={v => updateWeekField(h.week, 't1InactivePct', v)} suffix="%" />
                      <EditableCell value={h.t2InactivePct} onCommit={v => updateWeekField(h.week, 't2InactivePct', v)} suffix="%" />
                      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            const updated = history.filter((_, j) => j !== history.length - 1 - i);
                            setHistory(updated);
                            const ref = doc(db, 'progressHistory', user.uid);
                            setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                          }}
                          style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                        >&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
