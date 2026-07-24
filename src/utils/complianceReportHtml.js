// Builds the exportable "Building Benchmarking Services Applicability
// Screening" report as a self-contained HTML document (inline SVG charts,
// Schneider-branded), mirroring the example deliverable. Kept out of the app
// chrome so it prints/saves to a clean PDF from a new browser tab.
//
// Consumes the output of screenSites() + the aggregation helpers in
// complianceMandates.js.

import {
  CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
  eligibilityByOrdinance, totalEligible, deadlinesByDate,
  penaltyByOrdinance, totalPenalty, utilityFeedEligibility,
} from './complianceMandates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => n == null ? '$-' : '$' + Math.round(n).toLocaleString('en-US');
const mdY = (iso) => { const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

// Horizontal bar list (label · bar · value).
function svgHBars(items, { color, valueFmt = String, width = 540, labelW = 190 }) {
  if (!items.length) return '<div class="empty">No eligible sites</div>';
  const rowH = 24, gap = 9, valW = 78;
  const barMax = width - labelW - valW;
  const max = Math.max(1, ...items.map(i => i.value));
  const h = items.length * (rowH + gap);
  let g = '';
  items.forEach((it, i) => {
    const y = i * (rowH + gap);
    const w = it.value > 0 ? Math.max(2, (it.value / max) * barMax) : 0;
    g += `<text x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="#334155">${esc(it.label)}</text>`;
    g += `<rect x="${labelW}" y="${y + 2}" width="${w}" height="${rowH - 4}" rx="3" fill="${color}"/>`;
    g += `<text x="${labelW + w + 8}" y="${y + rowH / 2}" dominant-baseline="middle" font-size="12" font-weight="700" fill="#0F172A">${esc(valueFmt(it.value))}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 ${width} ${h}" preserveAspectRatio="xMinYMin meet">${g}</svg>`;
}

// Small line chart: sites per deadline.
function svgLine(points, { color, width = 460, height = 160 }) {
  if (!points.length) return '<div class="empty">No dated deadlines</div>';
  const padL = 20, padR = 24, padT = 24, padB = 28;
  const iw = width - padL - padR, ih = height - padT - padB;
  const max = Math.max(1, ...points.map(p => p.value));
  const x = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => padT + ih - (v / max) * ih;
  let path = '', marks = '';
  points.forEach((p, i) => {
    const px = x(i), py = y(p.value);
    path += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
    marks += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${color}"/>`;
    marks += `<text x="${px.toFixed(1)}" y="${(py - 9).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#0F172A">${p.value}</text>`;
    marks += `<text x="${px.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#64748B">${esc(mdY(p.date))}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`
    + `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${marks}</svg>`;
}

function categoryPanel(title, color, total, totalLabel, barsSvg) {
  return `<div class="panel">
    <div class="panelHead" style="background:${color}">${title}</div>
    <div class="kpiRow"><div class="kpi" style="border-color:${color};color:${color}">${esc(String(total))}</div><div class="kpiLabel">${esc(totalLabel)}</div></div>
    <div class="caption">Eligible sites by active ordinance</div>
    <div class="chart">${barsSvg}</div>
  </div>`;
}

const DISCLAIMER = `The information provided in this document is based on the location and square footage data supplied by the requestor. This assessment is a preliminary review to help identify properties that may be subject to compliance with benchmarking (BBS), energy audit, and building performance standards (BPS) ordinances. It does not account for all jurisdiction-specific eligibility criteria such as exemptions, official validation, or special classifications. Estimated annual penalties are illustrative worst-case figures and do not constitute legal or financial advice.`;

// results: output of screenSites(); meta: { generatedAt, siteCount }
export function buildComplianceReportHtml(results, meta = {}) {
  const eligible = results.filter(r => r.matched);
  const utilityEP = utilityFeedEligibility(results, 'electric');
  const utilityNG = utilityFeedEligibility(results, 'gas');

  // Group utility-feed rows by state for the "per State per Utility" look.
  const feedPanel = (feed, color, label) => {
    let body = '';
    let curState = null;
    for (const row of feed.rows) {
      if (row.state !== curState) { curState = row.state; body += `<div class="feedState">${esc(row.state || '—')}</div>`; }
    }
    const bars = svgHBars(feed.rows.map(r => ({ label: r.utility, value: r.count })), { color, width: 540, labelW: 210 });
    return `<div class="panel">
      <div class="panelHead" style="background:${color}">${esc(label)} Utility Feeds</div>
      <div class="kpiRow"><div class="kpi" style="border-color:${color};color:${color}">${feed.total}</div><div class="kpiLabel">Total eligible sites</div></div>
      <div class="caption">Eligible sites per utility (grouped by state)</div>
      <div class="chart">${bars}</div>
    </div>`;
  };

  const page = (inner) => `<section class="page">
    <div class="pageHeader"><h1>Building Benchmarking Services Applicability Screening</h1><div class="brand"><span class="lifeison">Life Is On</span><span class="sep">|</span><span class="se">Schneider Electric</span></div></div>
    <div class="disclaimerTitle">DISCLAIMER, PLEASE READ</div>
    <div class="disclaimer">${esc(DISCLAIMER)}</div>
    ${inner}
  </section>`;

  // Page 1 — timelines + eligibility overview.
  const timelines = CATEGORIES.map(c =>
    `<div class="tl"><div class="tlTitle" style="color:${CATEGORY_COLOR[c]}">${CATEGORY_LABEL[c]} sites per deadline</div>${svgLine(deadlinesByDate(results, c), { color: CATEGORY_COLOR[c] })}</div>`
  ).join('');
  const overview = CATEGORIES.map(c =>
    categoryPanel(`${CATEGORY_LABEL[c]} Eligibility Overview`, CATEGORY_COLOR[c], totalEligible(results, c), 'Total eligible sites',
      svgHBars(eligibilityByOrdinance(results, c).map(x => ({ label: x.government, value: x.count })), { color: CATEGORY_COLOR[c] }))
  ).join('');
  const page1 = page(
    `<div class="sectionTitle">Timelines for Eligible Sites</div><div class="grid3 tlGrid">${timelines}</div>
     <div class="sectionTitle">Total Eligible Sites by Requirement</div><div class="grid3">${overview}</div>`
  );

  // Page 2 — penalties.
  const penalties = CATEGORIES.map(c => {
    const label = c === 'bps' ? 'BPS Estimated Yearly Penalty (No Action)' : `${CATEGORY_LABEL[c]} Max Yearly Penalty`;
    return categoryPanel(label, CATEGORY_COLOR[c], usd(totalPenalty(results, c)), 'Total USD penalties',
      svgHBars(penaltyByOrdinance(results, c).map(x => ({ label: x.government, value: x.penalty })), { color: CATEGORY_COLOR[c], valueFmt: usd }));
  }).join('');
  const page2 = page(`<div class="sectionTitle">Total Max Yearly Penalties — BBS, Energy Audits &amp; BPS</div><div class="grid3">${penalties}</div>`);

  // Page 3 — utility feeds.
  const page3 = page(`<div class="sectionTitle">Eligibility per Data Stream for Utility Feeds</div>
    <div class="wbudc">The Whole Building Utility Data Collection (WBUDC) service supports BPS and BBS offerings via whole-building data collection; applicability depends on whether the site's utilities provide this option.</div>
    <div class="grid2">${feedPanel(utilityEP, '#F2B705', 'EP')}${feedPanel(utilityNG, '#B5179E', 'NG')}</div>`);

  const generatedAt = meta.generatedAt || '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Building Compliance Screening</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Nunito Sans', Arial, Helvetica, sans-serif; color: #0F172A; background: #F1F5F9; }
  .page { background: #fff; width: 1120px; margin: 16px auto; padding: 26px 30px 34px; box-shadow: 0 1px 6px rgba(15,23,42,.12); }
  .pageHeader { display: flex; align-items: center; justify-content: space-between; }
  .pageHeader h1 { font-size: 19px; margin: 0; color: #1E293B; }
  .brand { font-weight: 800; font-size: 15px; }
  .brand .lifeison { color: #3DAE2B; } .brand .sep { color: #CBD5E1; margin: 0 6px; } .brand .se { color: #3DAE2B; }
  .disclaimerTitle { color: #C0392B; font-weight: 800; font-size: 10px; margin: 14px 0 4px; }
  .disclaimer { font-size: 9.5px; color: #475569; line-height: 1.45; margin-bottom: 14px; }
  .sectionTitle { font-size: 17px; color: #334155; margin: 18px 0 10px; padding: 4px 14px; border: 1px solid #E2E8F0; border-radius: 20px; display: inline-block; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .tlGrid .tl { border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; }
  .tlTitle { font-size: 12px; font-weight: 800; font-style: italic; margin-bottom: 2px; }
  .panel { border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
  .panelHead { color: #fff; font-weight: 800; font-size: 13px; text-align: center; padding: 7px 6px; }
  .kpiRow { display: flex; align-items: center; gap: 10px; padding: 10px 12px 2px; }
  .kpi { border: 2px solid; border-radius: 6px; padding: 3px 12px; font-size: 20px; font-weight: 800; min-width: 60px; text-align: center; }
  .kpiLabel { font-weight: 700; color: #334155; font-size: 12px; }
  .caption { font-size: 10px; font-style: italic; color: #64748B; text-align: center; margin: 6px 0 2px; }
  .chart { padding: 4px 12px 12px; }
  .empty { font-size: 11px; color: #94A3B8; padding: 12px; text-align: center; }
  .feedState { font-size: 10px; font-weight: 800; color: #94A3B8; }
  .wbudc { font-size: 10px; color: #475569; margin: 4px 0 12px; }
  .footer { text-align: center; font-size: 9px; color: #94A3B8; margin-top: 10px; }
  @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; width: auto; page-break-after: always; } @page { size: landscape; margin: 8mm; } }
</style></head>
<body>
  ${page1}${page2}${page3}
  <div class="footer">Generated ${esc(generatedAt)} · ${eligible.length} of ${esc(String(meta.siteCount ?? results.length))} sites matched a jurisdiction · Public</div>
</body></html>`;
}
