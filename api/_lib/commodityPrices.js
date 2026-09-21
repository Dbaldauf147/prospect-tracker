// Rolling 90-day price series for the commodities the weekly email
// covers — WTI crude and Henry Hub natural gas — and the email built from
// them. Kept in _lib so the cron entry point stays a thin wrapper and the
// series/stat/HTML logic can be exercised on its own.
//
// (The route is still /api/oil-price-weekly: it is a cron path in
// vercel.json and the URL anyone tests by hand, so it kept its name when
// gas arrived. This module did not.)
//
// Three sources per commodity, tried in order, because none of them is
// guaranteed:
//
//   1. EIA (api.eia.gov) — the official US series: WTI spot at Cushing,
//      Henry Hub gas spot. Needs a free API key in EIA_API_KEY; skipped
//      when unset. Spot prices publish with a few days' lag, so the last
//      point is usually not yesterday.
//   2. Stooq — daily OHLC CSV for the front-month future, no key. This is
//      what runs out of the box.
//   3. Yahoo Finance's chart JSON, no key. Unofficial, and it rate-limits
//      datacenter IPs, so it sits last as a backstop.
//
// Whichever answers first wins, and the email names it: a number worth
// forwarding has to say where it came from.
//
// The two commodities are fetched independently and rendered as two
// sections of one mail. A commodity whose sources all fail costs the mail
// its section and says so — it does not cost the other commodity, and it
// does not cost the send.

import { renderLineChartPng } from './pngChart.js';

const WINDOW_DAYS = 90;

/**
 * What the email covers, and where each one comes from.
 *
 * `unit` is what the price is per — barrels for crude, million BTU for
 * gas. Two numbers in dollars that mean different things need it said out
 * loud, or $62 and $3 read as a collapse rather than as two commodities.
 *
 * Each chart is attached to the message and referenced by its own
 * Content-ID, so the images travel with the mail instead of being fetched
 * from a host that would then know when the reader opened it.
 */
export const COMMODITIES = [
  {
    key: 'wti',
    name: 'WTI crude',
    unit: 'bbl',
    chartCid: 'wti-90d-chart',
    chartFile: 'wti-90-day.png',
    line: '#009530',
    // EIA v2: daily WTI spot (series RWTC), in the petroleum spot dataset.
    eia: {
      dataset: 'petroleum/pri/spt',
      series: 'RWTC',
      source: 'EIA - WTI spot, Cushing OK',
      label: 'WTI crude (spot)',
    },
    stooq: {
      symbol: 'cl.f',
      source: 'Stooq - WTI front-month future (CL.F)',
      label: 'WTI crude (front-month)',
    },
    yahoo: {
      symbol: 'CL=F',
      source: 'Yahoo Finance - WTI front-month future (CL=F)',
      label: 'WTI crude (front-month)',
    },
  },
  {
    key: 'henryHub',
    name: 'Henry Hub natural gas',
    unit: 'MMBtu',
    chartCid: 'gas-90d-chart',
    chartFile: 'natural-gas-90-day.png',
    // The pipeline funnel's mid blue, so the two charts don't read as one
    // series in two colours.
    line: '#1c5cab',
    // EIA v2: daily Henry Hub spot (series RNGWHHD), in the natural gas
    // futures/spot dataset. Dollars per million BTU.
    eia: {
      dataset: 'natural-gas/pri/fut',
      series: 'RNGWHHD',
      source: 'EIA - Henry Hub spot',
      label: 'Henry Hub natural gas (spot)',
    },
    stooq: {
      symbol: 'ng.f',
      source: 'Stooq - Henry Hub front-month future (NG.F)',
      label: 'Henry Hub natural gas (front-month)',
    },
    yahoo: {
      symbol: 'NG=F',
      source: 'Yahoo Finance - Henry Hub front-month future (NG=F)',
      label: 'Henry Hub natural gas (front-month)',
    },
  },
];

export const commodityByKey = (key) => COMMODITIES.find(c => c.key === key) || null;

// ---- sources ----------------------------------------------------------

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// A fetch that can't hang the whole function. Vercel's cron invocation
// has a budget; a source that stops responding must fail over to the
// next one rather than spend it. `fetchImpl` is injectable so the sources
// can be tested without a network.
async function fetchWithTimeout(url, { timeoutMs = 12000, headers, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

// The key is free but has to be asked for, so EIA is the opt-in source
// rather than the default one.
async function fetchEia(spec, sinceIso, opts) {
  const key = String(process.env.EIA_API_KEY || '').trim();
  if (!key) return null;
  const url = `https://api.eia.gov/v2/${spec.eia.dataset}/data/`
    + `?api_key=${encodeURIComponent(key)}`
    + `&frequency=daily&data[0]=value&facets[series][]=${encodeURIComponent(spec.eia.series)}`
    + `&start=${sinceIso}&sort[0][column]=period&sort[0][direction]=asc&length=5000`;
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`EIA responded ${res.status}`);
  const body = await res.json();
  const rows = body?.response?.data || [];
  const points = rows
    .map(r => ({ date: String(r?.period || '').slice(0, 10), close: Number(r?.value) }))
    .filter(p => p.date && Number.isFinite(p.close));
  if (points.length === 0) throw new Error('EIA returned no usable rows');
  return { points, source: spec.eia.source, label: spec.eia.label };
}

// Stooq daily CSV: Date,Open,High,Low,Close,Volume, oldest first.
async function fetchStooq(spec, sinceIso, opts) {
  const d1 = sinceIso.replace(/-/g, '');
  const d2 = isoDay(opts?.now ?? Date.now()).replace(/-/g, '');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(spec.stooq.symbol)}&i=d&d1=${d1}&d2=${d2}`;
  const res = await fetchWithTimeout(url, opts);
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
  return { points, source: spec.stooq.source, label: spec.stooq.label };
}

// Yahoo's chart JSON: parallel arrays of epoch seconds and closes, with
// nulls on non-trading days.
async function fetchYahoo(spec, opts) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahoo.symbol)}`
    + '?range=3mo&interval=1d';
  const res = await fetchWithTimeout(url, { ...opts, headers: { 'User-Agent': 'prospect-tracker/1.0' } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const body = await res.json();
  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = stamps
    .map((t, i) => ({ date: isoDay(Number(t) * 1000), close: Number(closes[i]) }))
    .filter(p => p.date && Number.isFinite(p.close));
  if (points.length === 0) throw new Error('Yahoo returned no usable rows');
  return { points, source: spec.yahoo.source, label: spec.yahoo.label };
}

/**
 * The last WINDOW_DAYS of daily closes for one commodity, oldest first,
 * deduped by date.
 *
 * Returns { spec, points, source, label, attempts } — `attempts` records
 * what each source did, so a run that fell through to the backstop can
 * say why in its own logs rather than looking like a clean success.
 */
export async function fetchCommoditySeries(spec, { now = Date.now(), fetchImpl } = {}) {
  const sinceMs = now - WINDOW_DAYS * 86400000;
  const sinceIso = isoDay(sinceMs);
  const opts = { now, ...(fetchImpl ? { fetchImpl } : {}) };
  const attempts = [];
  const sources = [
    ['EIA', () => fetchEia(spec, sinceIso, opts)],
    ['Stooq', () => fetchStooq(spec, sinceIso, opts)],
    ['Yahoo', () => fetchYahoo(spec, opts)],
  ];
  for (const [name, run] of sources) {
    try {
      // Sequential on purpose: the later sources exist to cover the
      // earlier ones failing, and are not worth the call otherwise.
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
      return { spec, ...hit, points, attempts, windowDays: WINDOW_DAYS };
    } catch (err) {
      attempts.push({ name, status: 'error', error: String(err?.message || err) });
    }
  }
  const why = attempts.map(a => `${a.name}: ${a.status}${a.error ? ` (${a.error})` : ''}`).join('; ');
  throw new Error(`No price source answered for ${spec.name} - ${why}`);
}

/**
 * Every commodity, fetched together. One that fails all three sources is
 * reported in `failures` rather than thrown: a crude price the reader
 * came for must not be lost to a gas feed being down.
 *
 * Throws only when nothing at all came back, which is the one case where
 * there is no email worth sending.
 */
export async function fetchAllSeries({ now = Date.now(), fetchImpl, commodities = COMMODITIES } = {}) {
  const settled = await Promise.all(commodities.map(async (spec) => {
    try {
      return { ok: true, series: await fetchCommoditySeries(spec, { now, fetchImpl }) };
    } catch (err) {
      return { ok: false, spec, error: String(err?.message || err) };
    }
  }));
  const series = settled.filter(r => r.ok).map(r => r.series);
  const failures = settled.filter(r => !r.ok).map(r => ({ name: r.spec.name, error: r.error }));
  if (series.length === 0) {
    throw new Error(failures.map(f => `${f.name} - ${f.error}`).join(' | ') || 'No commodities configured');
  }
  return { series, failures };
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
 * Everything a section states, computed once: latest close, the changes
 * over a week / month / the whole window, and the window's high, low and
 * mean.
 */
export function summarizeSeries(points, { now = Date.now() } = {}) {
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

// ---- email ------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Gas trades near $3 and crude near $60, so a fixed two decimals reads
// the same for both. What tells them apart is the unit, which every
// headline figure carries.
function money(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '-';
}

const perUnit = (n, unit) => `${money(n)}/${unit}`;

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
function lineChartHtml({ chart, stats, src, windowDays, name, unit }) {
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
             alt="${esc(name)} daily closes over the last ${windowDays} days: ${esc(perUnit(stats.low.close, unit))} to ${esc(perUnit(stats.high.close, unit))}, latest ${esc(perUnit(stats.latest.close, unit))}"
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
  <div style="font-size:11px;color:#94A3B8;margin:0">Daily closes, ${esc(stats.days)} trading days. The axis is scaled to the window, not to $0.</div>`;
}

/**
 * Subject line: the numbers worth knowing, before the mail is opened.
 *
 * Both commodities, each with its week move, because the whole point of a
 * commodity mail on a phone is not having to open it. A commodity that
 * failed simply isn't named - the section inside says what happened.
 */
export function commodityEmailSubject(sections, { windowDays = WINDOW_DAYS } = {}) {
  const parts = sections.map(({ spec, stats }) => {
    const wk = stats.changeWeek;
    return `${spec.name} ${perUnit(stats.latest.close, spec.unit)}${wk ? ` (${signed(wk.pct, 1)}%)` : ''}`;
  });
  return `${parts.join(' · ')} - ${windowDays}-day recap`;
}

// One commodity's block: headline, the three changes, the window's
// high/low/average, and the chart.
export function commoditySectionHtml({ spec, stats, source, label, windowDays, chart, chartSrc }) {
  const wk = stats.changeWeek;
  const headlineColor = !wk ? FLAT : wk.abs > 0 ? UP : wk.abs < 0 ? DOWN : FLAT;
  return `
    <h2 style="color:#009530;margin:0 0 2px;font-size:20px">${esc(label)} - last ${windowDays} days</h2>
    <div style="font-size:12px;color:#94A3B8;margin:0 0 16px">${esc(stats.days)} trading days, ${esc(fmtDay(stats.first.date))} to ${esc(fmtDay(stats.latest.date))}</div>

    <div style="font-size:34px;font-weight:700;color:${headlineColor};line-height:1.1">${esc(money(stats.latest.close))}<span style="font-size:15px;font-weight:400;color:#94A3B8"> /${esc(spec.unit)}</span></div>
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

    ${lineChartHtml({ chart, stats, src: chartSrc, windowDays, name: spec.name, unit: spec.unit })}

    <p style="font-size:11px;color:#94A3B8;margin:10px 0 0">Source: ${esc(source)}. Prices in dollars per ${esc(spec.unit)}.</p>`;
}

// A commodity whose sources all failed. Named rather than dropped: a mail
// that quietly arrives with one section reads as "we only track crude".
function failureHtml(failures) {
  if (!failures.length) return '';
  const rows = failures.map(f => `<li style="margin:2px 0">${esc(f.name)}: ${esc(f.error)}</li>`).join('');
  return `<div style="margin:22px 0 0;padding:10px 14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px">
    <div style="font-size:13px;font-weight:700;color:#B45309">Not in this week's mail</div>
    <ul style="margin:4px 0 0;padding-left:18px;font-size:12px;color:#B45309">${rows}</ul>
  </div>`;
}

export function commodityEmailHtml({ sections, failures = [], windowDays = WINDOW_DAYS }) {
  const blocks = sections.map(s => commoditySectionHtml({ ...s, windowDays }))
    .join('<div style="height:1px;background:#E2E8F0;margin:26px 0"></div>');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#334155">
    ${blocks}
    ${failureHtml(failures)}
    <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">Sent weekly by Prospect Tracker.</p>
  </div>`;
}

/**
 * The whole email, from the fetched series.
 *
 * `inlineImage: true` embeds each chart as a data: URI instead of an
 * attachment, for the ?dry=1 preview that renders in a browser rather
 * than a mail client. Returns `attachments` ready for the mailer, with
 * nothing for a chart that couldn't be drawn — a chart that fails to
 * render must cost its section the picture, not the numbers.
 */
export function buildCommodityEmail(seriesList, { now = Date.now(), inlineImage = false, failures = [] } = {}) {
  const list = Array.isArray(seriesList) ? seriesList : [seriesList];
  const attachments = [];
  const chartErrors = [];

  const sections = list.map((series) => {
    const spec = series.spec;
    const stats = summarizeSeries(series.points, { now });

    let chart = null;
    try {
      chart = renderLineChartPng({ values: series.points.map(p => p.close), line: spec.line, fill: spec.line });
    } catch (err) {
      chartErrors.push(`${spec.name}: ${String(err?.message || err)}`);
    }

    if (chart && !inlineImage) {
      attachments.push({
        filename: spec.chartFile,
        content: chart.buffer,
        cid: spec.chartCid,
        contentType: 'image/png',
      });
    }

    return {
      spec,
      stats,
      source: series.source,
      label: series.label,
      chart,
      chartSrc: !chart ? ''
        : inlineImage ? `data:image/png;base64,${chart.buffer.toString('base64')}`
        : `cid:${spec.chartCid}`,
    };
  });

  const windowDays = list[0]?.windowDays || WINDOW_DAYS;
  return {
    subject: commodityEmailSubject(sections, { windowDays }),
    html: commodityEmailHtml({ sections, failures, windowDays }),
    attachments,
    chartError: chartErrors.length ? chartErrors.join('; ') : null,
    sections,
  };
}
