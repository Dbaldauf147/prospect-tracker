// The Weekly Report email's HTML — the tab's page, rebuilt for mail clients.
//
// Pure string building, no Node or browser APIs, so both sides can use it:
// api/_lib/weeklyReportEmail.js mails it, and the tab's "Preview email"
// renders the very same markup in an iframe. One copy means the preview
// cannot quietly disagree with what lands in the inbox.
//
// Everything here is written for Outlook on Windows, which lays HTML out
// with Word's engine rather than a browser's. Word ignores `max-width`,
// negative margins, flex/grid, and margins on inline elements, and it
// paints a broken-image placeholder when it meets the `background:`
// shorthand. That is why the page's CSS is not simply reused:
//
//   * width comes from a fixed-width table inside an mso conditional,
//     not `max-width` (without it the report stretches to the window),
//   * every colour is `background-color:` or a `bgcolor` attribute,
//   * gutters are spacer cells, never negative margins,
//   * anything set apart from its neighbour — a status chip, the note
//     beside a heading — gets its own table cell, because padding and
//     margin on a <span> are dropped.
//
// Colours and type sizes are the app's own tokens (src/index.css), so the
// email reads as the same document as Charts → Weekly Report.

const INK = '#1E2A36';           // --color-text
const INK_SOFT = '#5A6B7E';      // --color-text-secondary
const MUTED = '#8896A6';         // --color-text-muted
const BORDER = '#E2E8F0';        // --color-border
const SURFACE = '#FFFFFF';
const SURFACE_ALT = '#F0F3F7';
const PAGE_BG = '#F4F6F9';       // --color-bg, the tab's own backdrop

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

// The content column. The tab measures 1100px; mail gets a narrower one so
// the two detail columns still read on a phone.
const WIDTH = 800;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Status colours match the on-screen chips and card rules: green when the
// number is where it should be, amber when it isn't, grey when there is
// nothing to judge.
const STATUS = {
  ahead: { chip: '#047857', chipBg: '#D1FAE5', rule: '#10B981' },
  behind: { chip: '#B45309', chipBg: '#FEF3C7', rule: '#F59E0B' },
  none: { chip: INK_SOFT, chipBg: SURFACE_ALT, rule: BORDER },
};
const statusOf = (s) => STATUS[s] || STATUS.none;

// The stage ramp the Pipeline funnel draws with, earliest stage darkest.
const STAGE_FILL = ['#104281', '#1c5cab', '#2a78d6', '#6da7ec'];

const table = (attrs, rows) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>${rows}</table>`;

// A white card with the page's 1px border, optionally carrying the coloured
// rule the tab draws on a KPI card's top edge or a stat tile's left edge.
function cardOpen({ top, left } = {}) {
  const rule = [
    top ? `border-top:3px solid ${top}` : '',
    left ? `border-left:3px solid ${left}` : '',
  ].filter(Boolean).join(';');
  // height:100% levels the cards in a row wherever it is honoured, so two
  // cards side by side end on the same line as they do on the tab.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border:1px solid ${BORDER};${rule ? `${rule};` : ''}background-color:${SURFACE};border-radius:6px;height:100%"><tr><td valign="top" style="padding:12px 14px 14px;font-family:${FONT}">`;
}
const CARD_CLOSE = '</td></tr></table>';

// Horizontal gutter between two cards in a row. A spacer cell, because
// Word drops the negative margins a CSS gutter would need.
const gutter = (w = 12) => `<td class="gut" width="${w}" style="width:${w}px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td>`;

// A section heading with the tab's note beside it. Two cells: padding on a
// <span> is ignored in Outlook, so the note would otherwise collide with
// the heading ("Where the year standsYear to date …").
export function headingHtml(title, note) {
  const noteCell = note
    ? `<td class="hnote" valign="bottom" style="padding:0 0 1px 10px;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.3;white-space:nowrap">${esc(note)}</td>`
    : '';
  // The trailing cell takes the slack, so the note sits against the
  // heading rather than drifting to the middle of an auto-width table.
  return table(
    `width="100%" style="border-collapse:collapse"`,
    `<tr><td valign="bottom" style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};line-height:1.3;white-space:nowrap">${esc(title)}</td>${noteCell}<td class="hpad" width="99%" style="width:99%"></td></tr>`,
  );
}

// Vertical space between blocks, as a row rather than a margin.
const spacer = (h) => `<div style="line-height:${h}px;mso-line-height-rule:exactly;font-size:0;height:${h}px">&nbsp;</div>`;

function chipHtml(text, status) {
  const c = statusOf(status);
  return table(
    `style="border-collapse:collapse"`,
    `<tr><td bgcolor="${c.chipBg}" style="padding:2px 8px;border-radius:999px;font-family:${FONT};font-size:12px;font-weight:600;color:${c.chip};white-space:nowrap">${esc(text)}</td></tr>`,
  );
}

// One headline KPI — the tab's KpiTile: uppercase label, big number, the
// status chip beside it, then the arithmetic behind the figure.
function kpiCardHtml(card) {
  const c = statusOf(card.status);
  const lines = (card.lines || []).map(
    l => `<div style="margin-top:5px;font-family:${FONT};font-size:12px;line-height:1.35;color:${MUTED}">${esc(l)}</div>`,
  ).join('');
  const chipCell = card.chip
    ? `<td valign="bottom" style="padding:0 0 4px 8px">${chipHtml(card.chip, card.status)}</td>`
    : '';
  return `
      ${cardOpen({ top: c.rule })}
        <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:${MUTED}">${esc(card.label)}</div>
        ${table(`style="border-collapse:collapse;margin-top:4px"`, `<tr>
          <td valign="bottom" style="font-family:${FONT};font-size:32px;font-weight:700;line-height:1.05;color:${INK}">${esc(card.value)}</td>
          ${chipCell}
        </tr>`)}
        ${lines}
      ${CARD_CLOSE}`;
}

// A card row that keeps its columns side by side in Outlook and stacks
// everywhere that honours the media query in <head>.
function cardRow(cells) {
  if (!cells.length) return '';
  const width = Math.floor(100 / cells.length);
  const tds = cells.map((html, i) => (
    // height:1px on the cell lets the card inside resolve height:100% and
    // finish level with its neighbour; Word treats a cell height as a
    // minimum, so Outlook still grows the cell to fit its content.
    `${i ? gutter() : ''}<td class="col" width="${width}%" valign="top" style="width:${width}%;height:1px">${html}</td>`
  )).join('');
  return table(`width="100%" style="border-collapse:collapse"`, `<tr>${tds}</tr>`);
}

// A stat tile, with the same progress bar the tab draws under a tile that
// carries a weekly target. `sub` is the tile's provenance note ("recorded
// Sep 3") — a number the live feed can no longer answer for says where it
// came from here too.
function tileHtml(tile) {
  const value = Number(tile.value) || 0;
  const goal = Number(tile.goal) || 0;
  const accent = tile.accent === 'green' ? '#10B981' : '#3B82F6';
  let bar = '';
  if (goal > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
    const fill = value >= goal ? '#10B981' : '#3B82F6';
    // Bulletproof bar: nested tables with bgcolor, since a coloured <div>
    // of a given width is the one thing every client agrees on.
    const track = table(
      `width="100%" bgcolor="${BORDER}" style="border-collapse:collapse;border-radius:3px"`,
      `<tr><td height="5" style="height:5px;font-size:0;line-height:0;mso-line-height-rule:exactly">${pct > 0
        ? table(`width="${pct}%" bgcolor="${fill}" style="border-collapse:collapse;width:${pct}%;border-radius:3px"`, `<tr><td height="5" style="height:5px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td></tr>`)
        : '&nbsp;'}</td></tr>`,
    );
    bar = table(`width="100%" style="border-collapse:collapse;margin-top:8px"`, `<tr>
        <td valign="middle" style="padding-right:6px">${track}</td>
        <td valign="middle" width="34" style="font-family:${FONT};font-size:12px;font-weight:700;color:${MUTED};white-space:nowrap">/${goal}</td>
      </tr>`);
  }
  return `
      ${cardOpen({ left: accent })}
        <div style="font-family:${FONT};font-size:26px;font-weight:700;line-height:1.1;color:${INK}">${esc(value)}</div>
        <div style="margin-top:2px;font-family:${FONT};font-size:12px;font-weight:600;color:${MUTED}">${esc(tile.label)}</div>
        ${tile.sub ? `<div style="margin-top:2px;font-family:${FONT};font-size:12px;color:${MUTED}">${esc(tile.sub)}</div>` : ''}
        ${bar}
      ${CARD_CLOSE}`;
}

// A group of changes, as the tab lists them: uppercase title, a count pill,
// then the rows. The leading name is the bold part on screen, so the same
// split is made here — everything up to the first "→" or "(" is the who.
function changeGroupHtml(title, items, { max = 25 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = items.slice(0, max).map((raw) => {
    const text = String(raw ?? '');
    const cut = text.search(/\s(?:→|\()/);
    const who = cut > 0 ? text.slice(0, cut) : text;
    const rest = cut > 0 ? text.slice(cut) : '';
    // A goal carries its priority as "#3 …"; the tab draws that as a pill.
    const pri = who.match(/^#(\d+)\s+(.*)$/);
    const whoHtml = pri
      ? `<span style="background-color:#1E293B;color:#FFFFFF;border-radius:999px;padding:0 6px;font-size:11px;font-weight:700">#${esc(pri[1])}</span> ${esc(pri[2])}`
      : esc(who);
    return `<tr><td style="padding:2px 0;font-family:${FONT};font-size:13px;line-height:1.35;color:${INK}">
        <span style="font-weight:600">${whoHtml}</span><span style="color:${MUTED}">${esc(rest)}</span>
      </td></tr>`;
  }).join('');
  const more = items.length > max
    ? `<tr><td style="padding:2px 0;font-family:${FONT};font-size:12px;font-style:italic;color:${MUTED}">…and ${items.length - max} more</td></tr>`
    : '';
  const count = table(`style="border-collapse:collapse"`, `<tr>
      <td bgcolor="${SURFACE_ALT}" style="padding:0 7px;border-radius:999px;font-family:${FONT};font-size:12px;color:${INK}">${items.length}</td>
    </tr>`);
  return `
    <div style="margin-bottom:12px">
      ${table(`style="border-collapse:collapse;margin-bottom:3px"`, `<tr>
        <td style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:${MUTED}">${esc(title)}</td>
        <td style="padding-left:5px">${count}</td>
      </tr>`)}
      ${table(`width="100%" style="border-collapse:collapse"`, rows + more)}
    </div>`;
}

const mutedRow = (text) => `<div style="font-family:${FONT};font-size:13px;color:${MUTED}">${esc(text)}</div>`;

// The funnel.
//
// On the tab this is a drawn chart — band height for pipeline value,
// segment length for how long deals sit in a stage. An email can't carry
// that: inline SVG doesn't render in Outlook at all, and a rasterised
// chart would be blocked as a remote image. So each stage keeps its band
// as a bar sized by pipeline value in the stage's own colour from the
// chart's ramp, with the stage-by-stage figures beside it and the outcome
// block that hangs off the funnel's exit arrow underneath — closed, plus
// what the open pipeline weights to, and the projected total.
export function funnelHtml(funnel) {
  const stages = Array.isArray(funnel?.stages) ? funnel.stages : [];
  if (!stages.length) return '';

  // Bars are sized off the formatted amounts the tab already produced —
  // "$1,095,000", "$545K" — because the snapshot carries text, not
  // figures. A row whose amount can't be read just gets no bar.
  const amountOf = (s) => {
    const m = String(s?.amount ?? '').replace(/[^0-9.KMB]/gi, '');
    const n = parseFloat(m);
    if (!Number.isFinite(n)) return 0;
    if (/M/i.test(m)) return n * 1e6;
    if (/K/i.test(m)) return n * 1e3;
    if (/B/i.test(m)) return n * 1e9;
    return n;
  };
  const peak = Math.max(...stages.map(amountOf), 0);

  const th = (label, align = 'left', width = '') =>
    `<th ${width ? `width="${width}" ` : ''}style="padding:0 8px 5px 0;text-align:${align};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER}">${esc(label)}</th>`;
  const td = (v, align = 'left', strong = false) =>
    `<td style="padding:7px 8px 7px 0;text-align:${align};font-family:${FONT};font-size:13px;color:${strong ? INK : INK_SOFT};font-weight:${strong ? 600 : 400};border-bottom:1px solid ${SURFACE_ALT};white-space:nowrap">${esc(v ?? '—')}</td>`;

  const rows = stages.map((st, i) => {
    const amt = amountOf(st);
    const pct = peak > 0 ? Math.max(4, Math.round((amt / peak) * 100)) : 0;
    const fill = STAGE_FILL[Math.min(i, STAGE_FILL.length - 1)];
    const bar = pct > 0
      ? table(`width="100%" style="border-collapse:collapse"`, `<tr><td>${table(
        `width="${pct}%" bgcolor="${fill}" style="border-collapse:collapse;width:${pct}%;border-radius:2px"`,
        `<tr><td height="12" style="height:12px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td></tr>`,
      )}</td></tr>`)
      : '';
    return `<tr>
        ${td(st.label, 'left', true)}
        <td style="padding:7px 8px 7px 0;border-bottom:1px solid ${SURFACE_ALT}">${bar}</td>
        ${td(st.amount, 'right', true)}
        ${td(Number(st.count) || 0, 'right')}
        ${td(st.life, 'right')}
        ${td(st.closeRate, 'right')}
      </tr>`;
  }).join('');

  const o = funnel.outcome;
  const outRow = (label, value, strong) => `<tr>
        <td style="padding:3px 0;font-family:${FONT};font-size:13px;color:${strong ? INK : MUTED};font-weight:${strong ? 700 : 400}">${esc(label)}</td>
        <td style="padding:3px 0;text-align:right;font-family:${FONT};font-size:${strong ? 15 : 13}px;color:${INK};font-weight:${strong ? 700 : 600}">${esc(value ?? '—')}</td>
      </tr>`;
  const outcome = o ? `
      <div style="margin-top:12px">
        ${table(`width="300" style="border-collapse:collapse;width:300px"`, `
          ${outRow(o.soldLabel || 'Closed YTD', o.sold, true)}
          ${outRow('+ weighted pipeline', o.weighted, false)}
          <tr><td colspan="2" style="padding:0;border-top:1px solid ${BORDER};font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td></tr>
          ${outRow('= projected total', o.total, true)}
          ${o.note ? `<tr><td colspan="2" style="padding:2px 0 0;text-align:right;font-family:${FONT};font-size:12px;color:${MUTED}">${esc(o.note)}</td></tr>` : ''}
        `)}
      </div>` : '';

  return `
    ${cardOpen()}
      ${funnel.caption ? `<div style="margin-bottom:8px;font-family:${FONT};font-size:12px;line-height:1.4;color:${MUTED}">${esc(funnel.caption)}</div>` : ''}
      ${table(`width="100%" style="border-collapse:collapse"`, `
        <tr>${th('Stage')}${th('Pipeline', 'left', '34%')}${th('Value', 'right')}${th('Opps', 'right')}${th('Avg life', 'right')}${th('Close rate', 'right')}</tr>
        ${rows}
      `)}
      ${outcome}
    ${CARD_CLOSE}`;
}

// The narrative arrives as the Markdown Claude wrote for the on-screen
// recap. Only the subset that recap uses is rendered — ##/# headings,
// bullets, blank-line paragraphs and **bold** — and everything is escaped
// before any tag goes in, so nothing in the model's output can inject HTML.
export function narrativeHtml(md) {
  const text = String(md || '').trim();
  if (!text) return '';
  const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) {
      out.push(`<ul style="margin:5px 0 5px 18px;padding:0">${list.join('')}</ul>`);
      list = null;
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<div style="margin:14px 0 5px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK}">${bold(h[2])}</div>`);
      continue;
    }
    const b = line.match(/^[-*•]\s+(.*)$/);
    if (b) {
      if (!list) list = [];
      list.push(`<li style="margin:2px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${INK}">${bold(b[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="margin:5px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${INK}">${bold(line)}</p>`);
  }
  closeList();
  const body = out.join('');
  return body ? `${cardOpen()}${body}${CARD_CLOSE}` : '';
}

// "as of" line. A snapshot captured before the period it covers had ended
// is called out rather than quietly presented as complete, since the tab
// simply wasn't open for the rest of it.
export function freshnessNote(snapshot, now = Date.now()) {
  const at = Number(snapshot?.capturedAt);
  if (!Number.isFinite(at)) return { text: 'Captured at an unknown time.', stale: true };
  const when = new Date(at).toUTCString().replace(' GMT', ' UTC');
  const end = Number(snapshot?.periodEnd);
  const stale = Number.isFinite(end) && at < end;
  if (stale) {
    return {
      text: `Captured ${when}, before this period ended — anything after that isn't counted. Open Charts → Weekly Report to refresh it.`,
      stale: true,
    };
  }
  const age = now - at;
  return { text: `Captured ${when}.`, stale: age > 8 * 24 * 3600 * 1000 };
}

export function renderWeeklyReportHtml(snapshot, { message = '' } = {}) {
  const s = snapshot || {};
  const fresh = freshnessNote(s);
  const cards = Array.isArray(s.kpiCards) ? s.kpiCards : [];
  const tiles = Array.isArray(s.tiles) ? s.tiles : [];
  const oc = s.oppChanges || {};
  const gl = s.goals || {};
  // "this week" / "this day", so the goal headings read the way they do on
  // the tab for whichever period the snapshot covers.
  const periodWord = s.scope === 'day' ? 'day' : 'week';

  const intro = String(message || '').trim()
    ? `${cardOpen()}<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${INK};white-space:pre-wrap">${esc(message)}</div>${CARD_CLOSE}${spacer(14)}`
    : '';

  const kpiRow = cards.length
    ? cardRow(cards.map(kpiCardHtml))
    : `<div style="font-family:${FONT};font-size:13px;color:${MUTED};padding:12px 14px;border:1px dashed ${BORDER};background-color:${SURFACE_ALT};border-radius:6px">No chart data was cached when this snapshot was taken. Open Charts → Pipeline (and paste BFO Activity) to seed the target, pipeline and run rate.</div>`;

  const tileRow = tiles.length ? cardRow(tiles.map(tileHtml)) : '';
  const funnel = funnelHtml(s.funnel);
  const narrative = narrativeHtml(s.narrative);

  const changeGroups = [
    changeGroupHtml('Deals closed', oc.closed),
    changeGroupHtml('New opps', oc.newOpps),
    changeGroupHtml('Stage changes', oc.stageChanges),
    changeGroupHtml('Close-date moves', oc.closeDateMoves),
    changeGroupHtml('Amount updates', oc.amountUpdates),
    changeGroupHtml('BFO Opportunity Names tagged', oc.bfoTags),
  ].join('');

  const goalGroups = [
    changeGroupHtml(`Set this ${periodWord}`, gl.created),
    changeGroupHtml('Completed / closed', gl.completed),
    changeGroupHtml('Active goals', gl.active, { max: 12 }),
  ].join('');

  // The two detail cards the tab shows side by side. Each keeps the page's
  // own empty state, so a quiet week reads as a quiet week rather than as
  // a section that failed to render.
  const changesCard = `
      ${cardOpen()}
        <div style="margin-bottom:9px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK}">Opportunity changes</div>
        ${changeGroups || mutedRow(`No opp changes recorded this ${periodWord}.`)}
        ${changeGroups ? `<div style="margin-top:6px;font-family:${FONT};font-size:12px;font-style:italic;line-height:1.4;color:${MUTED}">“New opps” is a best-effort estimate: opps first edited in the tool this period may appear here even if created earlier, since the data carries no dedicated creation date.</div>` : ''}
      ${CARD_CLOSE}`;
  const goalsCard = `
      ${cardOpen()}
        <div style="margin-bottom:9px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK}">Goals</div>
        ${goalGroups || mutedRow('No goals recorded for this period.')}
      ${CARD_CLOSE}`;

  return `<!doctype html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>Weekly Report</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; }
  /* Outlook keeps the two-column layout (it ignores media queries), which
     is what a desktop reader wants; narrow clients stack instead. */
  @media only screen and (max-width:620px) {
    .col { display:block !important; width:100% !important; height:auto !important; }
    .col + .col { padding-top:12px !important; }
    td.gut { display:none !important; width:0 !important; }
    /* Narrow enough and the note wraps beside its heading instead of
       being squeezed against the slack cell, which goes away. */
    .hnote { white-space:normal !important; }
    .hpad { display:none !important; width:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG}">
${table(`width="100%" bgcolor="${PAGE_BG}" style="border-collapse:collapse;background-color:${PAGE_BG}"`, `<tr><td align="center" style="padding:20px 12px 28px">
  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}"><tr><td><![endif]-->
  <div style="max-width:${WIDTH}px;margin:0 auto;text-align:left">

    ${table(`width="100%" style="border-collapse:collapse"`, `<tr><td style="font-family:${FONT}">
      <div style="font-size:22px;font-weight:700;color:${INK};line-height:1.25">Weekly Report</div>
      <div style="margin-top:3px;font-size:13px;color:${MUTED}">${esc(s.periodLabel || '')}</div>
      <div style="margin-top:5px;font-size:12px;line-height:1.4;color:${fresh.stale ? '#B45309' : MUTED}">${esc(fresh.text)}</div>
    </td></tr>`)}

    ${spacer(16)}
    ${intro}

    ${headingHtml('Where the year stands', s.kpiNote)}
    ${spacer(8)}
    ${kpiRow}

    ${funnel ? `${spacer(20)}${headingHtml('Pipeline funnel', 'The Charts → Pipeline funnel, off the same cached numbers')}${spacer(8)}${funnel}` : ''}

    ${tileRow ? `${spacer(16)}${tileRow}` : ''}

    ${narrative ? `${spacer(16)}${narrative}` : ''}

    ${spacer(16)}
    ${cardRow([changesCard, goalsCard])}

    ${spacer(18)}
    <div style="font-family:${FONT};font-size:12px;color:${MUTED};text-align:center">Sent from Prospect Tracker · Charts → Weekly Report</div>
  </div>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>`)}
</body></html>`;
}
