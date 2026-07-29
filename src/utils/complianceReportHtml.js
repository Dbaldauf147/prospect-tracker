// Builds the exportable "Building Compliance — Applicability Screening &
// Roadmap" report as a self-contained, Schneider-Electric-branded HTML
// document (inline SVG charts + styled tables). Kept out of the app chrome so
// it prints / saves to a clean PDF from a new browser tab.
//
// Consumes the output of screenSites() + the aggregation helpers in
// complianceMandates.js.

import {
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  eligibilityByOrdinance, totalEligible, deadlinesByDate,
  penaltyByOrdinance, totalPenalty, utilityFeedEligibility,
  bpsPrioritization,
} from './complianceMandates.js';
import { schneiderLogoSvg } from './schneiderLogo.js';

// --- Schneider Electric brand tokens ------------------------------------
const SE_GREEN = '#3DCD58';       // "Life Is On" green
const SE_GREEN_DARK = '#009530';  // deep green (headers / accents)
const SE_INK = '#0F172A';
const SE_SLATE = '#475569';
const SE_MUTE = '#94A3B8';
const SE_LINE = '#E2E8F0';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const usdShort = (n) => {
  if (n == null) return '$-';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const mdY = (iso) => { const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
const monthYr = (iso) => {
  const [y, m] = String(iso).split('-');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MON[Number(m) - 1] || '?'} ${y}`;
};

// Horizontal bar list (label · track · bar · value). Rounded data-ends, a
// faint full-width track for scale reference, values in ink beside each bar.
function svgHBars(items, { color, valueFmt = String, width = 540, labelW = 178 }) {
  if (!items.length) return '<div class="empty">No eligible sites</div>';
  const rowH = 22, gap = 10, valW = 84;
  const barMax = width - labelW - valW;
  const max = Math.max(1, ...items.map(i => i.value));
  const h = items.length * (rowH + gap);
  let g = '';
  items.forEach((it, i) => {
    const y = i * (rowH + gap);
    const w = it.value > 0 ? Math.max(3, (it.value / max) * barMax) : 0;
    g += `<text x="${labelW - 10}" y="${y + rowH / 2 + 1}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="${SE_SLATE}">${esc(it.label)}</text>`;
    g += `<rect x="${labelW}" y="${y + 1}" width="${barMax}" height="${rowH - 2}" rx="5" fill="${SE_LINE}" opacity="0.55"/>`;
    g += `<rect x="${labelW}" y="${y + 1}" width="${w}" height="${rowH - 2}" rx="5" fill="${color}"/>`;
    g += `<text x="${labelW + barMax + 10}" y="${y + rowH / 2 + 1}" dominant-baseline="middle" font-size="12.5" font-weight="800" fill="${SE_INK}">${esc(valueFmt(it.value))}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 ${width} ${h}" preserveAspectRatio="xMinYMin meet" role="img">${g}</svg>`;
}

// Vertical column chart: count per deadline. Baseline axis, rounded column
// tops, value above each column, month-year label below. Reads far better
// than a near-flat line when the per-date counts are small.
function svgColumns(points, { color, width = 460, height = 168 }) {
  if (!points.length) return '<div class="empty">No dated deadlines</div>';
  const padL = 14, padR = 14, padT = 22, padB = 34;
  const iw = width - padL - padR, ih = height - padT - padB;
  const n = points.length;
  const slot = iw / n;
  const bw = Math.min(46, slot * 0.6);
  const max = Math.max(1, ...points.map(p => p.value));
  const baseY = padT + ih;
  let g = `<line x1="${padL}" y1="${baseY}" x2="${width - padR}" y2="${baseY}" stroke="${SE_LINE}" stroke-width="1.5"/>`;
  points.forEach((p, i) => {
    const cx = padL + slot * (i + 0.5);
    const bh = Math.max(3, (p.value / max) * ih);
    const x = cx - bw / 2, y = baseY - bh;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${color}"/>`;
    g += `<text x="${cx.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="${SE_INK}">${p.value}</text>`;
    g += `<text x="${cx.toFixed(1)}" y="${baseY + 15}" text-anchor="middle" font-size="10" fill="${SE_SLATE}">${esc(monthYr(p.date))}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
}

function kpiTile(value, label, accent) {
  return `<div class="kpiTile"><div class="kpiTileTop" style="background:${accent}"></div>
    <div class="kpiTileVal">${esc(String(value))}</div><div class="kpiTileLbl">${esc(label)}</div></div>`;
}

function categoryPanel(title, color, total, totalLabel, barsSvg) {
  return `<div class="panel">
    <div class="panelHead" style="background:${color}">${esc(title)}</div>
    <div class="kpiRow"><div class="kpi" style="border-color:${color};color:${color}">${esc(String(total))}</div><div class="kpiLabel">${esc(totalLabel)}</div></div>
    <div class="caption">By active ordinance / jurisdiction</div>
    <div class="chart">${barsSvg}</div>
  </div>`;
}

// A category "chip" for the roadmap table cells.
function catChip(c, n) {
  if (!n) return '';
  return `<span class="rmChip" style="background:${CATEGORY_COLOR[c]}1A;color:${CATEGORY_COLOR[c]};border-color:${CATEGORY_COLOR[c]}66">${n}</span>`;
}

const DISCLAIMER = `The information provided in this document is based on the location and square footage data supplied by the requestor. This assessment is a preliminary review to help identify properties that may be subject to compliance with benchmarking (BBS), energy audit, and building performance standards (BPS) ordinances. It does not account for all jurisdiction-specific eligibility criteria such as exemptions, official validation, or special classifications. Estimated annual penalties are illustrative worst-case figures and do not constitute legal or financial advice.`;

// results: output of screenSites(); meta: { generatedAt, siteCount }
export function buildComplianceReportHtml(results, meta = {}) {
  const matched = results.filter(r => r.matched);
  const jurisdictions = new Set(matched.map(r => r.govId)).size;
  const withMandate = results.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length;
  const grandPenalty = CATEGORIES.reduce((s, c) => s + totalPenalty(results, c), 0);
  const utilityEP = utilityFeedEligibility(results, 'electric');
  const utilityNG = utilityFeedEligibility(results, 'gas');
  const generatedAt = meta.generatedAt || '';
  const siteCount = meta.siteCount ?? results.length;

  // Combined roadmap: one row per deadline date, counts per category.
  const roadmap = (() => {
    const map = new Map();
    for (const c of CATEGORIES) for (const { date, count } of deadlinesByDate(results, c)) {
      if (!map.has(date)) map.set(date, { bbs: 0, audits: 0, bps: 0 });
      map.get(date)[c] = count;
    }
    return [...map.entries()]
      .map(([date, v]) => ({ date, ...v, total: v.bbs + v.audits + v.bps }))
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  const brandbar = `<div class="brandbar">
    <div class="bbLeft"><span class="bbTitle">Building Compliance Applicability Screening &amp; Roadmap</span></div>
    <div class="bbLogo">${schneiderLogoSvg({ onDark: true, width: 176 })}</div>
  </div>`;

  const page = (inner, { first = false } = {}) => `<section class="page">
    ${brandbar}
    <div class="pagebody">
      ${first ? `<div class="metarow">
        <div class="metaLead">Preliminary benchmarking (BBS), energy-audit &amp; building-performance-standard (BPS) applicability across your portfolio.</div>
        <div class="metaRight"><div>Generated ${esc(generatedAt)}</div><div><strong>${esc(String(siteCount))}</strong> sites · <strong>${matched.length}</strong> matched · <strong>${jurisdictions}</strong> jurisdictions</div></div>
      </div>` : ''}
      <div class="disclaimerBox"><span class="disclaimerTitle">DISCLAIMER, PLEASE READ</span><span class="disclaimer">${esc(DISCLAIMER)}</span></div>
      ${inner}
    </div>
  </section>`;

  // Page 1 — KPIs, roadmap, eligibility overview.
  const kpis = `<div class="kpiStrip">
    ${kpiTile(siteCount, 'Sites screened', SE_GREEN_DARK)}
    ${kpiTile(withMandate, 'Sites with a mandate', SE_GREEN)}
    ${kpiTile(jurisdictions, 'Jurisdictions matched', '#29ABE2')}
    ${kpiTile(usdShort(grandPenalty), 'Est. max yearly exposure', '#F7941E')}
  </div>`;

  const roadmapTable = roadmap.length ? `<table class="rmTable">
    <thead><tr><th>Compliance deadline</th><th>BBS</th><th>Energy Audits</th><th>BPS</th><th>Total sites</th></tr></thead>
    <tbody>${roadmap.map(r => `<tr>
      <td class="rmDate">${esc(mdY(r.date))}</td>
      <td>${catChip('bbs', r.bbs)}</td>
      <td>${catChip('audits', r.audits)}</td>
      <td>${catChip('bps', r.bps)}</td>
      <td class="rmTotal">${r.total}</td>
    </tr>`).join('')}</tbody>
  </table>` : '<div class="empty">No dated deadlines across the screened portfolio.</div>';

  const timelines = CATEGORIES.map(c =>
    `<div class="tl"><div class="tlTitle" style="color:${CATEGORY_COLOR[c]}">${CATEGORY_LABEL[c]} sites per deadline</div>${svgColumns(deadlinesByDate(results, c).map(d => ({ date: d.date, value: d.count })), { color: CATEGORY_COLOR[c] })}</div>`
  ).join('');

  const overview = CATEGORIES.map(c =>
    categoryPanel(`${CATEGORY_LABEL[c]} Eligibility`, CATEGORY_COLOR[c], totalEligible(results, c), 'Total eligible sites',
      svgHBars(eligibilityByOrdinance(results, c).map(x => ({ label: x.government, value: x.count })), { color: CATEGORY_COLOR[c] }))
  ).join('');

  const page1 = page(
    `${kpis}
     <div class="sectionTitle">Compliance Roadmap Upcoming Deadlines</div>
     <div class="twoCol">
       <div class="rmWrap">${roadmapTable}</div>
       <div class="grid1 tlGrid">${timelines}</div>
     </div>
     <div class="sectionTitle">Total Eligible Sites by Requirement</div>
     <div class="grid3">${overview}</div>`,
    { first: true }
  );

  // Page 2 — penalties + penalty-by-jurisdiction table.
  const penalties = CATEGORIES.map(c => {
    const label = c === 'bps' ? 'BPS Est. Yearly Penalty (No Action)' : `${CATEGORY_LABEL[c]} Max Yearly Penalty`;
    return categoryPanel(label, CATEGORY_COLOR[c], usdShort(totalPenalty(results, c)), 'Total exposure',
      svgHBars(penaltyByOrdinance(results, c).map(x => ({ label: x.government, value: x.penalty })), { color: CATEGORY_COLOR[c], valueFmt: usdShort }));
  }).join('');

  // Merge per-jurisdiction penalties across categories for the table.
  const penTable = (() => {
    const map = new Map();
    for (const c of CATEGORIES) for (const { government, penalty } of penaltyByOrdinance(results, c)) {
      if (!map.has(government)) map.set(government, { bbs: 0, audits: 0, bps: 0 });
      map.get(government)[c] = penalty;
    }
    const rows = [...map.entries()]
      .map(([government, v]) => ({ government, ...v, total: v.bbs + v.audits + v.bps }))
      .sort((a, b) => b.total - a.total);
    if (!rows.length) return '<div class="empty">No penalties estimated.</div>';
    const tot = rows.reduce((s, r) => ({ bbs: s.bbs + r.bbs, audits: s.audits + r.audits, bps: s.bps + r.bps, total: s.total + r.total }), { bbs: 0, audits: 0, bps: 0, total: 0 });
    return `<table class="rmTable penTable">
      <thead><tr><th>Jurisdiction</th><th>BBS</th><th>Energy Audits</th><th>BPS</th><th>Total / yr</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="rmDate">${esc(r.government)}</td>
        <td>${r.bbs ? usd(r.bbs) : ''}</td>
        <td>${r.audits ? usd(r.audits) : ''}</td>
        <td>${r.bps ? usd(r.bps) : ''}</td>
        <td class="rmTotal">${usd(r.total)}</td>
      </tr>`).join('')}
      <tr class="rmSum"><td>All jurisdictions</td><td>${usd(tot.bbs)}</td><td>${usd(tot.audits)}</td><td>${usd(tot.bps)}</td><td class="rmTotal">${usd(tot.total)}</td></tr>
      </tbody>
    </table>`;
  })();

  // BPS prioritization: one row per (deadline, jurisdiction) over BPS-eligible
  // sites — the exceed-limit fine, eligible-site count, and summed estimated
  // non-reporting penalty. Mirrors the Master Analysis overview + Excel exports.
  const bpsRows = bpsPrioritization(results);
  const bpsTable = bpsRows.length ? `<table class="rmTable penTable bpsTable">
    <thead><tr>
      <th>Upcoming Deadline</th><th>Compliance Government</th>
      <th>BPS Fines for Exceeding Limits</th><th class="bpsNumH">Number of eligible sites</th>
      <th class="bpsNumH">Sum of Est. Penalty for non-reporting on BPS</th><th>Fee for exceeding limits</th>
    </tr></thead>
    <tbody>${bpsRows.map(g => `<tr>
      <td class="rmDate">${esc(g.deadline ? mdY(g.deadline) : '')}</td>
      <td class="rmDate">${esc(g.government || '')}</td>
      <td>${esc(g.fine)}</td>
      <td class="bpsNum">${g.sites.toLocaleString('en-US')}</td>
      <td class="bpsNum">${g.penaltyKnown ? usd(g.penalty) : ''}</td>
      <td class="bpsFee">${esc(g.feeExceeding)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '<div class="empty">No BPS-eligible sites across the screened portfolio.</div>';

  const page2 = page(
    `<div class="sectionTitle">Estimated Max Yearly Penalties: BBS, Energy Audits &amp; BPS</div>
     <div class="grid3">${penalties}</div>
     <div class="sectionTitle">Penalty Exposure by Jurisdiction</div>
     <div class="rmWrap wide">${penTable}</div>
     <div class="sectionTitle">BPS Prioritization</div>
     <div class="rmWrap wide">${bpsTable}</div>`
  );

  // Page 3 — utility feeds.
  const feedPanel = (feed, color, label) => {
    const bars = svgHBars(feed.rows.map(r => ({ label: r.utility, value: r.count })), { color, width: 540, labelW: 200 });
    return `<div class="panel">
      <div class="panelHead" style="background:${color}">${esc(label)} Utility Feeds</div>
      <div class="kpiRow"><div class="kpi" style="border-color:${color};color:${color}">${feed.total}</div><div class="kpiLabel">Total eligible sites</div></div>
      <div class="caption">Eligible sites per utility (grouped by state)</div>
      <div class="chart">${bars}</div>
    </div>`;
  };
  const page3 = page(`<div class="sectionTitle">Eligibility per Data Stream for Utility Feeds</div>
    <div class="wbudc">The Whole Building Utility Data Collection (WBUDC) service supports BPS and BBS offerings via whole-building data collection; applicability depends on whether the site's utilities provide this option.</div>
    <div class="grid2">${feedPanel(utilityEP, '#F2B705', 'Electric Power (EP)')}${feedPanel(utilityNG, '#B5179E', 'Natural Gas (NG)')}</div>`);

  // Page 4 — site-by-site mandate detail. One row per screened site with the
  // specific BBS / Energy Audits / BPS mandates that apply, each with its
  // deadline + estimated max yearly penalty. Ordered by how many mandates
  // apply (busiest sites first), then jurisdiction, then name.
  const siteCell = (r, c) => {
    const e = r[c];
    if (!e || !e.active || e.eligible !== true) return '';
    const dl = e.deadline ? mdY(e.deadline) : (e.deadlineRaw || '');
    const pen = e.penalty != null ? usd(e.penalty) + '/yr' : '';
    return `<span class="sdChip" style="background:${CATEGORY_COLOR[c]}1A;color:${CATEGORY_COLOR[c]};border-color:${CATEGORY_COLOR[c]}66">Applicable</span>`
      + (dl ? `<div class="sdMeta">Due ${esc(dl)}</div>` : '')
      + (pen ? `<div class="sdMeta">${esc(pen)}</div>` : '');
  };
  const appCount = (r) => CATEGORIES.filter(c => r[c]?.eligible === true).length;
  const siteRows = [...results].sort((a, b) =>
    appCount(b) - appCount(a)
    || String(a.government || '~').localeCompare(String(b.government || '~'))
    || String(a.siteName || '').localeCompare(String(b.siteName || '')));
  const siteTable = siteRows.length ? `<table class="sdTable">
    <thead><tr><th>Site</th><th>City / State</th><th>Jurisdiction</th><th class="sdNumH">Sq Ft</th><th>BBS</th><th>Energy Audits</th><th>BPS</th></tr></thead>
    <tbody>${siteRows.map(r => `<tr>
      <td class="sdName">${esc(r.siteName || '')}</td>
      <td>${esc([r.city, r.state].filter(Boolean).join(', ') || '')}</td>
      <td>${r.matched ? esc(r.government || '') + (r.govId ? ` <span class="sdGov">${esc(r.govId)}</span>` : '') : '<span class="rmZero">no match</span>'}</td>
      <td class="sdNum">${r.sqft != null && Number.isFinite(Number(r.sqft)) ? Number(r.sqft).toLocaleString('en-US') : ''}</td>
      <td>${siteCell(r, 'bbs')}</td>
      <td>${siteCell(r, 'audits')}</td>
      <td>${siteCell(r, 'bps')}</td>
    </tr>`).join('')}</tbody>
  </table>` : '<div class="empty">No sites screened.</div>';
  const page4 = page(
    `<div class="sectionTitle">Site-by-Site Mandate Detail</div>
     <div class="sdIntro">Every screened site and the specific BBS / Energy Audits / BPS mandates that apply to it, each with its compliance deadline and estimated max yearly penalty. Sites are ordered by how many mandates apply.</div>
     <div class="rmWrap wide">${siteTable}</div>`
  );

  return `<!doctype html><html><head><meta charset="utf-8"><title>Building Compliance Screening &amp; Roadmap</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Nunito Sans', 'Segoe UI', Arial, Helvetica, sans-serif; color: ${SE_INK}; background: #EEF2F6; }
  .page { background: #fff; width: 1120px; margin: 18px auto; box-shadow: 0 2px 12px rgba(15,23,42,.14); border-radius: 10px; overflow: hidden; }
  .pagebody { padding: 20px 30px 30px; }

  /* Brand bar */
  .brandbar { background: linear-gradient(90deg, ${SE_GREEN_DARK} 0%, ${SE_GREEN} 100%); color: #fff; padding: 12px 30px; display: flex; align-items: center; justify-content: space-between; }
  .bbLeft { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .bbTitle { font-size: 16px; font-weight: 800; letter-spacing: .1px; }
  .bbLogo { flex: 0 0 auto; display: flex; align-items: center; }
  .bbLogo svg { display: block; }

  .metarow { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin: 14px 0 10px; }
  .metaLead { font-size: 12.5px; color: ${SE_SLATE}; max-width: 640px; line-height: 1.5; }
  .metaRight { text-align: right; font-size: 11.5px; color: ${SE_SLATE}; line-height: 1.7; white-space: nowrap; }
  .metaRight strong { color: ${SE_INK}; }

  .disclaimerBox { border-left: 3px solid #F7941E; background: #FFF8EE; padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 16px; }
  .disclaimerTitle { color: #B45309; font-weight: 800; font-size: 9.5px; letter-spacing: .4px; display: block; margin-bottom: 2px; }
  .disclaimer { font-size: 9.5px; color: ${SE_SLATE}; line-height: 1.5; }

  /* KPI strip */
  .kpiStrip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 4px 0 6px; }
  .kpiTile { border: 1px solid ${SE_LINE}; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.05); }
  .kpiTileTop { height: 5px; }
  .kpiTileVal { font-size: 30px; font-weight: 900; padding: 12px 14px 0; color: ${SE_INK}; letter-spacing: -.5px; }
  .kpiTileLbl { font-size: 11.5px; font-weight: 700; color: ${SE_SLATE}; padding: 2px 14px 13px; text-transform: uppercase; letter-spacing: .4px; }

  /* Section title — green left accent */
  .sectionTitle { font-size: 15px; font-weight: 800; color: ${SE_INK}; margin: 20px 0 11px; padding-left: 11px; border-left: 4px solid ${SE_GREEN}; }

  .twoCol { display: grid; grid-template-columns: 1.05fr 1fr; gap: 18px; align-items: start; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid1 { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .tlGrid .tl { border: 1px solid ${SE_LINE}; border-radius: 9px; padding: 8px 12px; background: #fff; }
  .tlTitle { font-size: 12px; font-weight: 800; margin-bottom: 2px; }

  /* Panels */
  .panel { border: 1px solid ${SE_LINE}; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.05); }
  .panelHead { color: #fff; font-weight: 800; font-size: 12.5px; text-align: center; padding: 8px 6px; letter-spacing: .2px; }
  .kpiRow { display: flex; align-items: center; gap: 11px; padding: 12px 14px 2px; }
  .kpi { border: 2px solid; border-radius: 8px; padding: 3px 12px; font-size: 19px; font-weight: 900; min-width: 62px; text-align: center; }
  .kpiLabel { font-weight: 700; color: ${SE_SLATE}; font-size: 12px; }
  .caption { font-size: 10px; font-style: italic; color: ${SE_MUTE}; text-align: center; margin: 7px 0 2px; }
  .chart { padding: 4px 14px 14px; }
  .empty { font-size: 11px; color: ${SE_MUTE}; padding: 16px; text-align: center; }

  /* Tables */
  .rmWrap { border: 1px solid ${SE_LINE}; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.05); }
  .rmTable { width: 100%; border-collapse: collapse; font-size: 12px; }
  .rmTable thead th { background: ${SE_GREEN_DARK}; color: #fff; font-weight: 800; text-align: left; padding: 9px 12px; font-size: 11px; letter-spacing: .3px; }
  .rmTable thead th:not(:first-child) { text-align: center; }
  .rmTable tbody td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; text-align: center; color: ${SE_SLATE}; }
  .rmTable tbody tr:nth-child(even) td { background: #FAFCFB; }
  .rmTable td.rmDate { text-align: left; font-weight: 800; color: ${SE_INK}; white-space: nowrap; }
  .rmTable td.rmTotal { font-weight: 900; color: ${SE_INK}; }
  .rmChip { display: inline-block; min-width: 24px; padding: 1px 8px; border-radius: 999px; border: 1px solid; font-weight: 800; font-size: 11.5px; }
  .rmZero { color: #CBD5E1; }
  .rmSum td { background: #E6F7EC !important; font-weight: 900; color: ${SE_INK}; border-top: 2px solid ${SE_GREEN}; }
  .rmSum td:first-child { text-align: left; }
  .penTable tbody td:not(.rmDate) { font-variant-numeric: tabular-nums; }
  .bpsTable thead th.bpsNumH { text-align: right; }
  .bpsTable .bpsNum { text-align: right; font-variant-numeric: tabular-nums; color: ${SE_INK}; font-weight: 700; }
  .bpsTable .bpsFee { color: ${SE_MUTE}; font-style: italic; }
  .rmWrap.wide { margin-top: 2px; }

  .wbudc { font-size: 10.5px; color: ${SE_SLATE}; margin: 2px 0 14px; line-height: 1.5; }

  /* Site-by-site mandate detail table */
  .sdIntro { font-size: 11px; color: ${SE_SLATE}; margin: 2px 0 12px; line-height: 1.5; }
  .sdTable { width: 100%; border-collapse: collapse; font-size: 11px; }
  .sdTable thead th { background: ${SE_GREEN_DARK}; color: #fff; font-weight: 800; text-align: left; padding: 8px 10px; font-size: 10.5px; letter-spacing: .3px; }
  .sdTable thead th:nth-child(n+5) { text-align: center; }
  .sdTable thead th.sdNumH { text-align: right; }
  .sdTable tbody td { padding: 7px 10px; border-bottom: 1px solid #F1F5F9; color: ${SE_SLATE}; vertical-align: top; }
  .sdTable tbody td:nth-child(n+5) { text-align: center; }
  .sdTable tbody tr:nth-child(even) td { background: #FAFCFB; }
  .sdName { font-weight: 800; color: ${SE_INK}; }
  .sdNum { text-align: right; font-variant-numeric: tabular-nums; color: ${SE_INK}; font-weight: 700; }
  .sdGov { font-family: ui-monospace, Menlo, monospace; font-size: 9.5px; color: ${SE_MUTE}; }
  .sdChip { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid; font-weight: 800; font-size: 10.5px; }
  .sdMeta { font-size: 9.5px; color: ${SE_SLATE}; margin-top: 2px; white-space: nowrap; }

  .footer { text-align: center; font-size: 10px; color: ${SE_MUTE}; margin: 6px auto 22px; }
  .footer .fbrand { color: ${SE_GREEN_DARK}; font-weight: 800; }

  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; width: auto; border-radius: 0; page-break-after: always; }
    @page { size: landscape; margin: 8mm; }
  }
</style></head>
<body>
  ${page1}${page2}${page3}${page4}
  <div class="footer"><span class="fbrand">Schneider Electric</span> · Generated ${esc(generatedAt)} · ${matched.length} of ${esc(String(siteCount))} sites matched a jurisdiction · Public</div>
</body></html>`;
}
