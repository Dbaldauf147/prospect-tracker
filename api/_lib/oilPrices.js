// Rolling 90-day crude oil price series, and the weekly email built from
// it. Kept in _lib so the cron entry point stays a thin wrapper and the
// series/stat/HTML logic can be exercised on its own.
//
// Three sources, tried in order, because none of them is guaranteed:
//
//   1. EIA (api.eia.gov) — the official US series, WTI spot at Cushing.
//      Needs a free API key in EIA_API_KEY; skipped when unset. Spot
//      prices publish with a few days' lag, so the last point is usually
//      not yesterday.
//   2. Stooq — daily OHLC CSV for the WTI front-month future, no key.
//      This is what runs out of the box.
//   3. Yahoo Finance's chart JSON for CL=F, no key. Unofficial, and it
//      rate-limits datacenter IPs, so it sits last as a backstop.
//
// Whichever answers first wins, and the email names it: a number worth
// forwarding has to say where it came from.

import { renderLineChartPng } from './pngChart.js';

const WINDOW_DAYS = 90;

// The daily line chart is attached to the message and referenced by this
// Content-ID, so the image travels with the mail instead of being fetched
// from a host that would then know when the reader opened it.
const CHART_CID = 'oil-90d-chart';

// ---- sources ----------------------------------------------------------

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// A fetch that can't hang the whole function. Vercel's cron invocation
// has a budget; a source that stops responding must fail over to the
// next one rather than spend it.
async function fetchWithTimeout(url, { timeoutMs = 12000, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

// EIA v2: daily WTI spot (series RWTC), newest first. The key is free
// but has to be asked for, so this is the opt-in source rather than the
// default one.
async function fetchEia(sinceIso) {
  const key = String(process.env.EIA_API_KEY || '').trim();
  if (!key) return null;
  const url = 'https://api.eia.gov/v2/petroleum/pri/spt/data/'
    + `?api_key=${encodeURIComponent(key)}`
    + '&frequency=daily&data[0]=value&facets[series][]=RWTC'
    + `&start=${sinceIso}&sort[0][column]=period&sort[0][direction]=asc&length=5000`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`EIA responded ${res.status}`);
  const body = await res.json();
  const rows = body?.response?.data || [];
  const points = rows
    .map(r => ({ date: String(r?.period || '').slice(0, 10), close: Number(r?.value) }))
    .filter(p => p.date && Number.isFinite(p.close));
  if (points.length === 0) throw new Error('EIA returned no usable rows');
  return { points, source: 'EIA — WTI spot, Cushing OK', label: 'WTI crude (spot)' };
}

// Stooq daily CSV: Date,Open,High,Low,Close,Volume, oldest first. cl.f is
// the WTI front-month future.
async function fetchStooq(sinceIso) {
  const d1 = sinceIso.replace(/-/g, '');
  const d2 = isoDay(Date.now()).replace(/-/g, '');
  const url = `https://stooq.com/q/d/l/?s=cl.f&i=d&d1=${d1}&d2=${d2}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Stooq responded ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date,/i.test(lines[0])) {
    // Stooq answers a bad symbol or a throttled request with a plain
    // "No data" body and a 200, so an unparseable body is a failure to
    // fail over from, not an empty week.
    throw new Error(`Stooq returned no CSV (${text.slice(0, 60)})`);
  }
  const cols = lines[0].toLowerCase().split(',');
  const dateAt = cols.indexOf('date');
  const closeAt = cols.indexOf('close');
  if (dateAt < 0 || closeAt < 0) throw new Error('Stooq CSV missing Date/Close');
  const points = lines.slice(1)
    .map(line => line.split(','))
    .map(cells => ({ date: String(cells[dateAt] || '').slice(0, 10), close: Number(cells[closeAt]) }))
    .filter(p => p.date && Number.isFinite(p.close));
  if (points.length === 0) throw new Error('Stooq returned no usable rows');
  return { points, source: 'Stooq — WTI front-month future (CL.F)', label: 'WTI crude (front-month)' };
}

// Yahoo's chart JSON: parallel arrays of epoch seconds and closes, with
// nulls on non-trading days.
async function fetchYahoo() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/CL=F?range=3mo&interval=1d';
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'prospect-tracker/1.0' } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const body = await res.json();
  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = stamps
    .map((t, i) => ({ date: isoDay(Number(t) * 1000), close: Number(closes[i]) }))
    .filter(p => p.date && Number.isFinite(p.close));
  if (points.length === 0) throw new Error('Yahoo returned no usable rows');
  return { points, source: 'Yahoo Finance — WTI front-month future (CL=F)', label: 'WTI crude (front-month)' };
}

/**
 * The last WINDOW_DAYS of daily closes, oldest first, deduped by date.
 *
 * Returns { points, source, label, attempts } — `attempts` records what
 * each source did, so a run that fell through to the backstop can say why
 * in its own logs rather than looking like a clean success.
 */
export async function fetchOilSeries({ now = Date.now() } = {}) {
  const sinceMs = now - WINDOW_DAYS * 86400000;
  const sinceIso = isoDay(sinceMs);
  const attempts = [];
  const sources = [
    ['EIA', () => fetchEia(sinceIso)],
    ['Stooq', () => fetchStooq(sinceIso)],
    ['Yahoo', () => fetchYahoo()],
  ];
  for (const [name, run] of sources) {
    try {
      const hit = await run();
      if (!hit) { attempts.push({ name, status: 'skipped' }); continue; }
      // Every source is asked for roughly the window, but none of them is
      // asked precisely enough to trust: EIA pads, Yahoo has no start
      // param at all. Trim here so "90-day high" means 90 days.
      const points = hit.points
        .filter(p => Date.parse(`${p.date}T00:00:00Z`) >= sinceMs)
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((p, i, arr) => i === 0 || p.date !== arr[i - 1].date);
      if (points.length < 2) throw new Error('fewer than two closes in the window');
      attempts.push({ name, status: 'ok', points: points.length });
      return { ...hit, points, attempts, windowDays: WINDOW_DAYS };
    } catch (err) {
      attempts.push({ name, status: 'error', error: String(err?.message || err) });
    }
  }
  const why = attempts.map(a => `${a.name}: ${a.status}${a.error ? ` (${a.error})` : ''}`).join('; ');
  throw new Error(`No oil price source answered — ${why}`);
}

// ---- stats ------------------------------------------------------------

// The close on or before `date`, so "30 days ago" lands on the last
// trading day rather than nothing when it falls on a weekend.
function closeOnOrBefore(points, iso) {
  let hit = null;
  for (const p of points) {
    if (p.date <= iso) hit = p; else break;
  }
  return hit;
}

function pctChange(from, to) {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/**
 * Everything the email states, computed once: latest close, the changes
 * over a week / month / the whole window, and the window's high, low and
 * mean.
 */
export function summarizeOilSeries(points, { now = Date.now() } = {}) {
  const latest = points[points.length - 1];
  const first = points[0];
  const closes = points.map(p => p.close);
  const high = points.reduce((a, b) => (b.close > a.close ? b : a));
  const low = points.reduce((a, b) => (b.close < a.close ? b : a));
  const avg = closes.reduce((t, c) => t + c, 0) / closes.length;
  const ago = (days) => closeOnOrBefore(points, isoDay(now - days * 86400000));
  const week = ago(7);
  const month = ago(30);
  return {
    latest,
    first,
    high,
    low,
    avg,
    days: points.length,
    changeWeek: week && week.date !== latest.date
      ? { from: week, abs: latest.close - week.close, pct: pctChange(week.close, latest.close) } : null,
    changeMonth: month && month.date !== latest.date
      ? { from: month, abs: latest.close - month.close, pct: pctChange(month.close, latest.close) } : null,
    changeWindow: first.date !== latest.date
      ? { from: first, abs: latest.close - first.close, pct: pctChange(first.close, latest.close) } : null,
  };
}

// Collapse the daily series into one close per calendar week (the last
// trading day of each), which is what the chart and the table show: 90
// daily bars is a wall, 13 weekly ones is a shape.
export function weeklyCloses(points) {
  const byWeek = new Map();
  for (const p of points) {
    const d = new Date(`${p.date}T00:00:00Z`);
    // Monday-anchored week key, so a week reads Mon–Sun however the
    // trading days fall inside it.
    const dow = (d.getUTCDay() + 6) % 7;
    const monday = isoDay(d.getTime() - dow * 86400000);
    byWeek.set(monday, { weekOf: monday, ...p });
  }
  return [...byWeek.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

// ---- email ------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function money(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '-';
}

function signed(n, digits = 2) {
  if (!Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
}

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : iso;
}

const UP = '#047857';
const DOWN = '#B91C1C';
const FLAT = '#475569';

function changeCell(label, change) {
  if (!change) {
    return `<td style="padding:0 14px 0 0;vertical-align:top">
      <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
      <div style="font-size:15px;color:#94A3B8">not enough history</div>
    </td>`;
  }
  const color = change.abs > 0 ? UP : change.abs < 0 ? DOWN : FLAT;
  return `<td style="padding:0 14px 0 0;vertical-align:top">
    <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
    <div style="font-size:15px;font-weight:700;color:${color}">${esc(signed(change.abs))} (${esc(signed(change.pct, 1))}%)</div>
    <div style="font-size:11px;color:#94A3B8">from ${esc(money(change.from.close))} on ${esc(fmtDay(change.from.date))}</div>
  </td>`;
}

// The daily line chart: 90 closes drawn as an image (see pngChart.js for
// why an image and not markup), with its axis labels as real text around
// the plot so the scale survives a client that blocks pictures. `src` is
// a cid: reference in a sent mail and a data: URI in the ?dry=1 preview,
// which no mail client ever sees.
function lineChartHtml({ chart, stats, src, windowDays }) {
  if (!chart) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 4px">
    <tr>
      <td style="width:46px;padding:0 6px 0 0;vertical-align:top">
        <div style="height:${chart.height}px;position:relative">
          <div style="font-size:10px;color:#94A3B8;text-align:right">${esc(money(chart.axisMax))}</div>
        </div>
      </td>
      <td style="padding:0">
        <img src="${esc(src)}" width="${chart.width}" height="${chart.height}"
             alt="Daily closes over the last ${windowDays} days: ${esc(money(stats.low.close))} to ${esc(money(stats.high.close))}, latest ${esc(money(stats.latest.close))}"
             style="display:block;width:${chart.width}px;height:${chart.height}px;border:0;outline:none;text-decoration:none">
      </td>
    </tr>
    <tr>
      <td style="padding:0 6px 0 0;text-align:right;font-size:10px;color:#94A3B8;vertical-align:top">${esc(money(chart.axisMin))}</td>
      <td style="padding:2px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
          <tr>
            <td style="font-size:10px;color:#94A3B8;text-align:left">${esc(fmtDay(stats.first.date))}</td>
            <td style="font-size:10px;color:#94A3B8;text-align:right">${esc(fmtDay(stats.latest.date))}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="font-size:11px;color:#94A3B8;margin:0 0 18px">Daily closes, ${esc(stats.days)} trading days. The axis is scaled to the window, not to $0.</div>`;
}

function weeklyTableHtml(weeks) {
  const rows = weeks.slice().reverse().map((w, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? w.close - prev.close : null;
    const color = delta == null ? FLAT : delta > 0 ? UP : delta < 0 ? DOWN : FLAT;
    return `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #F1F5F9;font-size:13px">Week of ${esc(fmtDay(w.weekOf))}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #F1F5F9;font-size:13px;text-align:right">${esc(fmtDay(w.date))}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #F1F5F9;font-size:13px;text-align:right;font-weight:700">${esc(money(w.close))}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #F1F5F9;font-size:13px;text-align:right;color:${color}">${delta == null ? '-' : esc(signed(delta))}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:6px">
    <tr style="background:#F8FAFC">
      <th style="padding:6px 10px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.04em">Week</th>
      <th style="padding:6px 10px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.04em">Close date</th>
      <th style="padding:6px 10px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.04em">Close</th>
      <th style="padding:6px 10px;text-align:right;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.04em">vs prior</th>
    </tr>
    ${rows}
  </table>`;
}

/** Subject line: the number worth knowing, before the mail is opened. */
export function oilEmailSubject(stats, label) {
  const wk = stats.changeWeek;
  const move = wk ? ` (${signed(wk.pct, 1)}% on the week)` : '';
  return `${label}: ${money(stats.latest.close)}${move} — 90-day recap`;
}

export function oilEmailHtml({ stats, weeks, source, label, windowDays, chart, chartSrc }) {
  const wk = stats.changeWeek;
  const headlineColor = !wk ? FLAT : wk.abs > 0 ? UP : wk.abs < 0 ? DOWN : FLAT;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#334155">
    <h2 style="color:#009530;margin:0 0 2px;font-size:20px">${esc(label)} — last ${windowDays} days</h2>
    <div style="font-size:12px;color:#94A3B8;margin:0 0 16px">${esc(stats.days)} trading days, ${esc(fmtDay(stats.first.date))} to ${esc(fmtDay(stats.latest.date))}</div>

    <div style="font-size:34px;font-weight:700;color:${headlineColor};line-height:1.1">${esc(money(stats.latest.close))}</div>
    <div style="font-size:12px;color:#94A3B8;margin:0 0 14px">close on ${esc(fmtDay(stats.latest.date))}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
      <tr>
        ${changeCell('Week', stats.changeWeek)}
        ${changeCell('30 days', stats.changeMonth)}
        ${changeCell(`${windowDays} days`, stats.changeWindow)}
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;margin:0 0 18px">
      <tr>
        <td style="padding:10px 14px;font-size:13px">${windowDays}-day high<br><strong style="font-size:16px">${esc(money(stats.high.close))}</strong> <span style="color:#94A3B8">${esc(fmtDay(stats.high.date))}</span></td>
        <td style="padding:10px 14px;font-size:13px">${windowDays}-day low<br><strong style="font-size:16px">${esc(money(stats.low.close))}</strong> <span style="color:#94A3B8">${esc(fmtDay(stats.low.date))}</span></td>
        <td style="padding:10px 14px;font-size:13px">${windowDays}-day average<br><strong style="font-size:16px">${esc(money(stats.avg))}</strong></td>
      </tr>
    </table>

    ${lineChartHtml({ chart, stats, src: chartSrc, windowDays })}
    ${weeklyTableHtml(weeks)}

    <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">
      Source: ${esc(source)}. Sent weekly by Prospect Tracker.
    </p>
  </div>`;
}

/**
 * The whole email, from a fetched series.
 *
 * `inlineImage: true` embeds the chart as a data: URI instead of an
 * attachment, for the ?dry=1 preview that renders in a browser rather
 * than a mail client. Returns `attachments` ready for the mailer, empty
 * when the chart couldn't be drawn — a chart that fails to render must
 * cost the email its picture, not its numbers.
 */
export function buildOilEmail(series, { now = Date.now(), inlineImage = false } = {}) {
  const stats = summarizeOilSeries(series.points, { now });
  const weeks = weeklyCloses(series.points);
  const windowDays = series.windowDays || WINDOW_DAYS;

  let chart = null;
  let chartError = null;
  try {
    chart = renderLineChartPng({ values: series.points.map(p => p.close) });
  } catch (err) {
    chartError = String(err?.message || err);
  }

  const chartSrc = !chart ? ''
    : inlineImage ? `data:image/png;base64,${chart.buffer.toString('base64')}`
    : `cid:${CHART_CID}`;

  return {
    subject: oilEmailSubject(stats, series.label),
    html: oilEmailHtml({ stats, weeks, source: series.source, label: series.label, windowDays, chart, chartSrc }),
    attachments: chart && !inlineImage
      ? [{ filename: 'oil-90-day.png', content: chart.buffer, cid: CHART_CID, contentType: 'image/png' }]
      : [],
    chartError,
    stats,
    weeks,
  };
}
