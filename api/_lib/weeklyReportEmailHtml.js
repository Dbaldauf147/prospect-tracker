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
// What the funnel picture is drawn at: the column, less the funnel card's
// padding and borders. The PNG itself is rasterised at roughly twice this,
// so it stays sharp on a phone and on a high-density screen.
const IMG_WIDTH = WIDTH - 30;

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

// The two trend series' fills. `strong` is the accent the tab already gives
// that metric and marks the period this report covers; the history behind
// it is the de-emphasis grey, not a paler tint of the same hue - one bar
// carries the eye, the rest are context, and a second shade of the accent
// would read as a second thing being measured. Both greys and both accents
// clear 3:1 on white, so every bar is visible and no bar competes.
const TREND_HISTORY = '#7C8B9D';
// The chart column of a trend card, in pixels: the 800px content column,
// halved for the two cards side by side, less the card's border and
// padding and the label and value columns either side of the bar, with a
// little slack left so Outlook never has to choose what to drop.
const TREND_TRACK = 230;
const TREND_BLUE = { strong: '#2a78d6', soft: TREND_HISTORY };
const TREND_GREEN = { strong: '#0E9F6E', soft: TREND_HISTORY };

// The stage ramp the Pipeline funnel draws with, earliest stage darkest.
const STAGE_FILL = ['#104281', '#1c5cab', '#2a78d6', '#6da7ec'];
// The stage-bar column in the funnel table, drawn only when the chart
// itself could not be rasterised. Wider than a trend track because this
// card has the full content column to itself.
const FUNNEL_TRACK = 260;

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

// One horizontal bar: a fixed-width track of two cells, the fill sized in
// pixels and the rest holding the track open behind it.
//
// Pixels, not a percentage, because of Word. A table nested in a cell with
// `width="61%"` is the one construct Word will not resolve - it falls back
// to the table's content width, and a bar whose only content is a spacer is
// a few pixels wide. Five of those in a column, each still 14px tall, is
// what turned this row of horizontal bars into a column chart in Outlook.
// Two cells in one row avoids the nested table altogether, and every width
// is stated in an attribute as well as in CSS, which is what Word reads.
// A browser still compresses the whole track when the card is narrower
// than it, so the fill keeps its share of the bar on a phone.
function barHtml({ fillPx, trackPx, color, height = 14, radius = '0 3px 3px 0', trackBg = '' }) {
  const fill = Math.max(0, Math.min(trackPx, Math.round(fillPx) || 0));
  const rest = trackPx - fill;
  // A cell with no text still needs a character in Outlook, and the
  // character must not be allowed to set the cell's height.
  const blank = 'font-size:0;line-height:0;mso-line-height-rule:exactly';
  // A counts bar is drawn against empty space, because the axis it would
  // be drawn against is the tallest bar in the series and that is already
  // the full track. A percentage has a real 100% end, so its track is
  // painted: without it a 79% bar and a 100% bar are two lengths with
  // nothing behind them saying what length would be all of it.
  const restBg = trackBg ? ` bgcolor="${trackBg}"` : '';
  const restFill = trackBg ? `background-color:${trackBg};` : '';
  const cells = [
    fill > 0
      ? `<td width="${fill}" height="${height}" bgcolor="${color}" style="width:${fill}px;height:${height}px;border-radius:${radius};${blank}">&nbsp;</td>`
      : '',
    rest > 0
      ? `<td width="${rest}" height="${height}"${restBg} style="width:${rest}px;height:${height}px;${restFill}${blank}">&nbsp;</td>`
      : '',
  ].join('');
  return table(`width="${trackPx}" style="border-collapse:collapse;width:${trackPx}px"`, `<tr>${cells}</tr>`);
}

// A section heading with the tab's note beside it. Two cells: padding on a
// <span> is ignored in Outlook, so the note would otherwise collide with
// the heading ("Close rate trendLast 6 months …").
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

// One headline KPI - the tab's KpiTile: uppercase label, big number, the
// chip beside it (the tab's status verdict; in the email, the figure's
// share of its target), then the arithmetic behind the figure.
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

// A trend series, as a row of horizontal bars - one period per row, oldest
// at the top, each bar direct-labelled with its own number.
//
// Horizontal rather than columns because the period labels ("Aug 11",
// "Sep") need room to sit beside their bar, and because a row of cells
// with set heights is the layout Word is least reliable about. Every bar
// carries its value in text next to it, so the series is legible even
// where the fills do not render at all - which is also the relief a
// low-contrast fill on white requires.
//
// Horizontal is also something the markup has to hold onto: see barHtml
// for why the width of a bar is a pixel count and not a percentage.
//
// A null value is NOT a zero. For the emails series it means the week has
// no recording and the feed cannot answer for it; drawing that as an empty
// bar would assert a quiet week that nobody actually measured.
function trendRowHtml(point, max, accent, isLast) {
  const known = point.value != null;
  const value = known ? point.value : 0;
  // Scale to the tallest bar in the series, never to the axis: five weeks
  // of 20-30 emails against a 0-50 axis is five stubs that all look alike.
  const fillPx = max > 0 && known ? Math.max(4, Math.round((value / max) * TREND_TRACK)) : 0;
  // The current period is the one the reader is being told about, so it
  // carries the full accent and the rest recede - emphasis, rather than
  // five bars competing for the same attention.
  const fill = isLast ? accent.strong : accent.soft;
  const labelInk = isLast ? INK : MUTED;

  // The track is drawn even where the bar is empty, so the numbers down
  // the right stay in a column of their own rather than sliding left on
  // the weeks nothing can be said about.
  const bar = barHtml({ fillPx, trackPx: TREND_TRACK, color: fill });

  // The slack cell at the end keeps the three fixed columns together on
  // the left instead of letting the table spread them across the card. It
  // carries `hpad` because a percentage cell beside fixed ones is what
  // forces a table wider than a phone's screen, and the media query drops
  // it there - Word, which never reads the query, keeps it.

  return `<tr>
      <td width="58" valign="middle" style="width:58px;padding:3px 8px 3px 0;font-family:${FONT};font-size:12px;font-weight:${isLast ? 700 : 600};color:${labelInk};white-space:nowrap">${esc(point.label)}</td>
      <td width="${TREND_TRACK}" valign="middle" style="width:${TREND_TRACK}px;padding:3px 0">${bar}</td>
      <td width="42" valign="middle" style="width:42px;padding:3px 0 3px 8px;font-family:${FONT};font-size:13px;font-weight:700;color:${known ? INK : MUTED};white-space:nowrap;text-align:right">${known ? esc(point.value) : '-'}</td>
      <td class="hpad" width="99%" style="width:99%"></td>
    </tr>`;
}

// One trend card: heading, the bars, then the footnotes the series needs.
function trendCardHtml({ title, note, points, accent, emptyNote }) {
  if (!Array.isArray(points) || points.length === 0) {
    return `${cardOpen({ left: accent.strong })}
        <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${INK}">${esc(title)}</div>
        ${mutedRow(emptyNote)}
      ${CARD_CLOSE}`;
  }

  const max = points.reduce((m, p) => (p.value != null && p.value > m ? p.value : m), 0);
  const rows = points.map((p, i) => trendRowHtml(p, max, accent, i === points.length - 1)).join('');
  // Say once, under the series, what the two things a bar can't show mean -
  // rather than a per-bar asterisk that has to be hunted for.
  const unknown = points.some(p => p.value == null);
  const recorded = points.some(p => p.recorded);
  const feet = [
    recorded ? 'Weeks the live feed no longer covers are the totals banked on the Activity tab.' : '',
    unknown ? '- marks a week with no recording and no feed to count.' : '',
  ].filter(Boolean).join(' ');

  return `${cardOpen({ left: accent.strong })}
      ${table(`width="100%" style="border-collapse:collapse"`, `<tr>
        <td valign="bottom" style="font-family:${FONT};font-size:13px;font-weight:700;color:${INK};white-space:nowrap">${esc(title)}</td>
        <td valign="bottom" style="padding-left:8px;font-family:${FONT};font-size:12px;color:${MUTED};white-space:nowrap">${esc(note)}</td>
        <td width="99%" style="width:99%"></td>
      </tr>`)}
      ${table(`width="100%" style="border-collapse:collapse;margin-top:8px"`, rows)}
      ${feet ? `<div style="margin-top:7px;font-family:${FONT};font-size:11px;line-height:1.4;color:${MUTED}">${esc(feet)}</div>` : ''}
    ${CARD_CLOSE}`;
}

// ---- Account coverage ---------------------------------------------------
//
// The Progress tab's two coverage charts, as the email can draw them. On
// the tab they are lines: a point a week per tier, running back to April.
// A line needs an image or an SVG and mail gets neither, so the same
// series arrives as five weekly rows of paired bars - which is the length
// the "Emails sent" card beside it already runs to, so the two sections
// line up rather than one dwarfing the other.
//
// Both series are percentages, so both are drawn against a painted 0-100%
// track and read straight across: a Tier 2 bar three-quarters of the way
// along IS three quarters of Tier 2.
const COVERAGE_T1 = '#DC2626';   // the Progress chart's Tier 1 red
const COVERAGE_T2 = '#3B82F6';   // and its Tier 2 blue
const COVERAGE_TRACK_BG = '#EDF1F6';
// Half the content column, less the card's border and padding, the week
// label and the two percentage columns, split between the two tracks.
const COVERAGE_TRACK = 84;

// The row of cells a week is drawn in, in order: the week label, then each
// tier's bar and the figure beside it, then the slack that keeps all five
// together on the left of the card.
const COVERAGE_LABEL = 46;
// Wide enough for "100%" and for the "Tier 1" that heads the column.
const COVERAGE_FIGURE = 40;
// The slack is not `hpad`, the class the trend cards drop on a phone: with
// the bar columns already gone there, dropping it too leaves the table
// nothing to spend its width on, and the columns drift apart across an
// empty card. Nothing in this card has to wrap, so the slack can stay.
const COVERAGE_SLACK = '<td width="99%" style="width:99%"></td>';

// A tier names its own column rather than sitting in a legend above the
// card: on a phone the bars go (see `.cbar`) and two columns of bare
// percentages are left, which a swatch off to one side cannot label.
//
// The heading takes exactly the cells a week's row takes - the swatch over
// the bar, the name over the figure - so the two line up without a
// colspan, which in a table this narrow takes the slack for itself and
// drags "Tier 2" away from the numbers under it. It also means the swatch
// leaves with the bars on a phone, which is right: a colour is a key only
// while something is painted in it.
const coverageHeadCell = (color, name) => `<td class="cbar" width="${COVERAGE_TRACK}" valign="bottom" style="width:${COVERAGE_TRACK}px;padding:0 0 5px 4px">${table(`align="right" style="border-collapse:collapse"`, `<tr>
        <td width="8" height="8" bgcolor="${color}" style="width:8px;height:8px;border-radius:2px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td>
      </tr>`)}</td>
      <td width="${COVERAGE_FIGURE}" valign="bottom" style="width:${COVERAGE_FIGURE}px;padding:0 0 5px 5px;font-family:${FONT};font-size:11px;font-weight:600;color:${MUTED};white-space:nowrap;text-align:right">${esc(name)}</td>`;

const coverageHeadRow = () => `<tr>
      <td width="${COVERAGE_LABEL}" style="width:${COVERAGE_LABEL}px"></td>
      ${coverageHeadCell(COVERAGE_T1, 'Tier 1')}
      ${coverageHeadCell(COVERAGE_T2, 'Tier 2')}
      ${COVERAGE_SLACK}
    </tr>`;

// One week: the label, then each tier's bar with its own figure beside it.
//
// A null is not a zero here either. It means the Progress tab recorded no
// snapshot that week, so the row shows "-" against an empty track rather
// than a bar on the floor, which would read as the week every contact
// vanished.
function coverageRowHtml(point, isLast) {
  const tier = (value, color) => {
    const known = value != null;
    // A percentage that rounds below one track pixel still gets a sliver,
    // so "3%" has something beside it; a true 0% gets nothing, which is
    // the honest picture of nothing.
    const fillPx = known && value > 0
      ? Math.max(2, Math.round((value / 100) * COVERAGE_TRACK))
      : 0;
    const bar = barHtml({
      fillPx, trackPx: COVERAGE_TRACK, color, height: 9,
      radius: '2px', trackBg: COVERAGE_TRACK_BG,
    });
    // The bar column carries `cbar` so a phone drops it: two fixed tracks
    // and their figures are wider than a 320px screen, and there the
    // percentages are the whole story - the same trade the funnel's stage
    // bars make.
    return `<td class="cbar" width="${COVERAGE_TRACK}" valign="middle" style="width:${COVERAGE_TRACK}px;padding:3px 0 3px 4px">${bar}</td>
      <td width="${COVERAGE_FIGURE}" valign="middle" style="width:${COVERAGE_FIGURE}px;padding:3px 0 3px 5px;font-family:${FONT};font-size:12px;font-weight:${isLast ? 700 : 600};color:${known ? INK : MUTED};white-space:nowrap;text-align:right">${known ? `${value}%` : '-'}</td>`;
  };
  return `<tr>
      <td width="${COVERAGE_LABEL}" valign="middle" style="width:${COVERAGE_LABEL}px;padding:3px 0;font-family:${FONT};font-size:12px;font-weight:${isLast ? 700 : 600};color:${isLast ? INK : MUTED};white-space:nowrap">${esc(point.label)}</td>
      ${tier(point.t1, COVERAGE_T1)}
      ${tier(point.t2, COVERAGE_T2)}
      ${COVERAGE_SLACK}
    </tr>`;
}

// How many weeks the fallback table shows. The chart behind it runs to
// half a year; a table that long would be the tallest thing in the report,
// so where there is no picture it shows the recent end of the series.
const COVERAGE_TABLE_ROWS = 5;

// Where a tier stands now, under the picture: the swatch that keys the
// line, the tier's name, and its latest figure. This is what the bars
// would have said, for a reader who has the chart above it.
function coverageStandingHtml(points, isT1) {
  const key = isT1 ? 't1' : 't2';
  const last = [...points].reverse().find(p => p[key] != null);
  const colour = isT1 ? COVERAGE_T1 : COVERAGE_T2;
  return `<td valign="middle" style="padding:0 14px 0 0">${table(`style="border-collapse:collapse"`, `<tr>
        <td width="8" height="8" bgcolor="${colour}" style="width:8px;height:8px;border-radius:2px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td>
        <td style="padding-left:5px;font-family:${FONT};font-size:11px;color:${MUTED};white-space:nowrap">${isT1 ? 'Tier 1' : 'Tier 2'}</td>
        <td style="padding-left:5px;font-family:${FONT};font-size:13px;font-weight:700;color:${INK};white-space:nowrap">${last ? `${last[key]}%` : '-'}</td>
      </tr>`)}</td>`;
}

function coverageCardHtml(chart, src) {
  const points = Array.isArray(chart?.points) ? chart.points : [];
  const img = src && chart?.image
    ? `<img src="${esc(src)}" width="${chart.image.width}" height="${chart.image.height}" alt="${esc(chart.image.alt || chart.title || '')}" style="display:block;width:100%;max-width:${chart.image.width}px;height:auto;border:0;outline:none;text-decoration:none">`
    : '';

  // With the chart drawn, the weekly figures beside every bar would be the
  // same series told twice, so the card carries where each tier stands and
  // leaves the shape to the picture. Without it, the bars ARE the chart -
  // the same arrangement the funnel makes with its stage table.
  const body = img
    ? `<div style="margin-top:8px">${img}</div>
      ${table(`style="border-collapse:collapse;margin-top:9px"`, `<tr>
        ${coverageStandingHtml(points, true)}
        ${coverageStandingHtml(points, false)}
      </tr>`)}`
    : table(
      `width="100%" style="border-collapse:collapse;margin-top:8px"`,
      coverageHeadRow() + points.slice(-COVERAGE_TABLE_ROWS)
        .map((p, i, shown) => coverageRowHtml(p, i === shown.length - 1)).join(''),
    );

  return `${cardOpen()}
      <div style="font-family:${FONT};font-size:13px;font-weight:700;line-height:1.3;color:${INK}">${esc(chart.title)}</div>
      ${body}
      ${chart.note ? `<div style="margin-top:7px;font-family:${FONT};font-size:11px;line-height:1.4;color:${MUTED}">${esc(chart.note)}</div>` : ''}
    ${CARD_CLOSE}`;
}

// The pair, side by side, as they sit on the Progress tab. Nothing at all
// when the snapshot carries no coverage: an empty card would say the
// coverage is missing, when what is missing is the recording of it.
//
// `srcs` maps a chart's id to where its picture is to be fetched from - a
// `cid:` reference into the message's own attachments when this is being
// mailed, the data URL the snapshot carries when the tab is previewing it.
// A chart with no entry falls back to the bars.
export function coverageHtml(coverage, srcs = {}) {
  const charts = (Array.isArray(coverage?.charts) ? coverage.charts : [])
    .filter(c => c && c.title && Array.isArray(c.points) && c.points.length);
  return charts.length ? cardRow(charts.map(c => coverageCardHtml(c, srcs[c.id] || ''))) : '';
}

// A group of changes, as the tab lists them: uppercase title, a count pill,
// then the rows. The leading name is the bold part on screen, so the same
// split is made here - everything up to the first "→" or "(" is the who.
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
// On the tab this is a drawn chart - band height for pipeline value,
// segment length for how long deals sit in a stage. An email can't carry
// that: inline SVG doesn't render in Outlook at all, and a rasterised
// chart would be blocked as a remote image. So each stage keeps its band
// as a bar sized by pipeline value in the stage's own colour from the
// chart's ramp, with the stage-by-stage figures beside it and the outcome
// block that hangs off the funnel's exit arrow underneath - closed, plus
// what the open pipeline weights to, and the projected total.
export function funnelHtml(funnel, image = null) {
  const stages = Array.isArray(funnel?.stages) ? funnel.stages : [];
  if (!stages.length) return '';

  // The chart itself, when the tab managed to rasterise it. It is sized in
  // a width attribute as well as CSS - Word reads the attribute - and the
  // alt text is the chart's own screen-reader label, so a client that
  // hides pictures still says what the picture was. The stage rows below
  // it stay either way: they are the figures, and they are what a reader
  // with images off is left with.
  const picture = image?.src ? `
      <div style="margin-bottom:10px">
        <img src="${esc(image.src)}" width="${IMG_WIDTH}" alt="${esc(image.alt || 'Pipeline funnel')}" style="display:block;width:100%;max-width:${IMG_WIDTH}px;height:auto;border:0;outline:none;text-decoration:none">
      </div>` : '';

  // Bars are sized off the formatted amounts the tab already produced -
  // "$1,095,000", "$545K" - because the snapshot carries text, not
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

  const th = (label, align = 'left', width = '', cls = '') =>
    `<th ${cls ? `class="${cls}" ` : ''}${width ? `width="${width}" ` : ''}style="padding:0 8px 5px 0;text-align:${align};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER}">${esc(label)}</th>`;
  const td = (v, align = 'left', strong = false) =>
    `<td style="padding:7px 8px 7px 0;text-align:${align};font-family:${FONT};font-size:13px;color:${strong ? INK : INK_SOFT};font-weight:${strong ? 600 : 400};border-bottom:1px solid ${SURFACE_ALT};white-space:nowrap">${esc(v ?? '-')}</td>`;

  // With the chart above them the rows are the figures, plainly; without
  // it they are also the picture, so each stage keeps a bar sized by
  // pipeline value in its own colour from the chart's ramp.
  const rows = stages.map((st, i) => {
    const amt = amountOf(st);
    const fillPx = peak > 0 ? Math.max(4, Math.round((amt / peak) * FUNNEL_TRACK)) : 0;
    const fill = STAGE_FILL[Math.min(i, STAGE_FILL.length - 1)];
    // Same pixel track as the trend bars, and for the same reason: this
    // column is the picture when there is no picture, and a percentage
    // width would leave Outlook drawing five vertical ticks instead.
    const bar = picture || fillPx <= 0 ? '' : `<td class="sbar" width="${FUNNEL_TRACK}" style="width:${FUNNEL_TRACK}px;padding:7px 8px 7px 0;border-bottom:1px solid ${SURFACE_ALT}">${barHtml({
      fillPx, trackPx: FUNNEL_TRACK, color: fill, height: 12, radius: '2px',
    })}</td>`;
    return `<tr>
        ${td(st.label, 'left', true)}
        ${bar}
        ${td(st.amount, 'right', true)}
        ${td(Number(st.count) || 0, 'right')}
        ${td(st.life, 'right')}
        ${td(st.closeRate, 'right')}
      </tr>`;
  }).join('');

  // The outcome block stays in text even under the picture, which draws
  // its own. It is the projected total - the figure the KPI row no longer
  // carries - and a reader whose client hides the image would otherwise be
  // left without it. In the picture it is six pixels tall; here it is
  // readable.
  const o = funnel.outcome;
  const outRow = (label, value, strong) => `<tr>
        <td style="padding:3px 0;font-family:${FONT};font-size:13px;color:${strong ? INK : MUTED};font-weight:${strong ? 700 : 400}">${esc(label)}</td>
        <td style="padding:3px 0;text-align:right;font-family:${FONT};font-size:${strong ? 15 : 13}px;color:${INK};font-weight:${strong ? 700 : 600}">${esc(value ?? '-')}</td>
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
      ${picture}
      ${table(`width="100%" style="border-collapse:collapse"`, `
        <tr>${th('Stage')}${picture ? '' : th('Pipeline', 'left', String(FUNNEL_TRACK + 8), 'sbar')}${th('Value', 'right')}${th('Opps', 'right')}${th('Avg life', 'right')}${th('Close rate', 'right')}</tr>
        ${rows}
      `)}
      ${outcome}
    ${CARD_CLOSE}`;
}

// The close rate trend - the funnel's close-rate column with the time axis
// put back, as it sits directly under the funnel on the tab.
//
// On screen this is a grid with a sparkline per row and a hover panel behind
// every figure. Neither travels: no mail client renders an inline <svg>, and
// there is nothing to hover in an inbox. So the Trend column is dropped -
// the month columns ARE the trend, read left to right - and the figures keep
// what makes them weighable, the count under every rate. A rate here is
// three or four deals as often as not, and "17%" with no denominator is a
// number nobody can act on.
//
// The two right-hand columns are the point of the table: the months shown
// added up, and the rolling year behind them. A six-month figure running
// above the year is drawn as the tab draws it - the app's "good" green with
// a ▲ beside it, so the cue never rests on hue alone for a reader whose
// client has stripped the colour or who can't separate it from the ink.
const TREND_GOOD = '#166534';
const TREND_GOOD_BG = '#DCFCE7';

// A row's swatch, from the funnel's own ramp above it, so a stage is the
// same blue in both pictures. The total row isn't a stage and sits outside
// the ramp.
const trendSwatch = (stage) => (Number.isInteger(stage) && stage >= 3 && stage <= 6
  ? STAGE_FILL[stage - 3]
  : '#64748B');

export function closeRateTrendHtml(trend) {
  const months = Array.isArray(trend?.months) ? trend.months : [];
  const rows = Array.isArray(trend?.rows) ? trend.rows : [];
  if (!months.length || !rows.length) return '';

  const head = (label, { left = false, ruled = false, title = '' } = {}) =>
    `<th ${title ? `title="${esc(title)}" ` : ''}style="padding:0 6px 5px ${ruled ? 8 : 6}px;text-align:${left ? 'left' : 'right'};font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER};${ruled ? `border-left:1px solid ${BORDER};` : ''}white-space:nowrap">${esc(label)}</th>`;

  // A rate with its count underneath, or the em dash that says this stage
  // closed nothing in the month - blank, not 0%, because no evidence is not
  // a 0% close rate and a zero would put a cliff in the row that nothing in
  // the pipeline did.
  const figure = (cell, { strong = false, good = false } = {}) => {
    if (!cell) return `<div style="font-family:${FONT};font-size:12px;color:${MUTED}">-</div>`;
    const ink = good ? TREND_GOOD : INK;
    const sub = good ? '#3F8B5C' : MUTED;
    const rate = `<div style="font-family:${FONT};font-size:${strong ? 13 : 12}px;font-weight:700;line-height:1.15;color:${ink};white-space:nowrap">${good ? '&#9650; ' : ''}${esc(cell.rate)}</div>`;
    const count = cell.count
      ? `<div style="font-family:${FONT};font-size:10px;font-weight:500;line-height:1.2;color:${sub};white-space:nowrap">${esc(cell.count)}</div>`
      : '';
    // The green lives on a cell of its own inside the column rather than on
    // the column's cell: several green rows stacking would otherwise merge
    // into one tall block, and the row rules belong to the outer cell.
    const body = `${rate}${count}`;
    return good
      ? table(`align="right" style="border-collapse:collapse"`, `<tr><td bgcolor="${TREND_GOOD_BG}" style="padding:1px 4px;border-radius:4px;text-align:right">${body}</td></tr>`)
      : body;
  };

  const cell = (html, { ruled = false } = {}) =>
    `<td valign="top" style="padding:6px 6px 6px ${ruled ? 8 : 6}px;text-align:right;border-bottom:1px solid ${SURFACE_ALT};${ruled ? `border-left:1px solid ${BORDER};` : ''}">${html}</td>`;

  const body = rows.map((row) => {
    const ahead = Number(row?.overall?.ahead) > 0;
    // The swatch is a cell, not a bullet on the label: Word drops the
    // padding and margins that would keep an inline block off the text.
    const label = table(`style="border-collapse:collapse"`, `<tr>
        <td width="8" bgcolor="${trendSwatch(row.stage)}" style="width:8px;font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td>
        <td style="padding-left:6px;font-family:${FONT};font-size:12px;font-weight:600;color:${INK};white-space:nowrap">${esc(row.label)}</td>
      </tr>`);
    return `<tr>
        <td valign="top" style="padding:6px 6px 6px 0;border-bottom:1px solid ${SURFACE_ALT}">${label}</td>
        ${(row.cells || []).map(c => cell(figure(c))).join('')}
        ${cell(figure(row.overall, { good: ahead }))}
        ${cell(figure(row.rolling12, { strong: true }), { ruled: true })}
      </tr>`;
  }).join('');

  const span = months.length;
  const note = `A deal counts toward every stage it reached, so Stage 3’s denominator is the widest and `
    + `Stage 6’s the narrowest, and the rates aren’t meant to add up. Pull-through opps are left out. `
    + `Each month is the deals whose Close Date falls in it; a month a stage closed nothing is blank, not 0%. `
    + `${span} mo adds up the months shown; 12 mo is a rolling 365 days, the same window the funnel above `
    + `uses, so it reaches back past the first column. A ${span} mo figure in green with a ▲ is running `
    + `above the rolling year - the recent months are better than the run rate behind them.`;

  return `
    ${cardOpen()}
      ${table(`width="100%" style="border-collapse:collapse"`, `
        <tr>
          ${head('Stage reached', { left: true })}
          ${months.map(m => head(m)).join('')}
          ${head(`${span} mo`, { title: `The ${span} months shown, added together.` })}
          ${head('12 mo', { ruled: true, title: 'A rolling 365 days to today - the same window the pipeline funnel uses.' })}
        </tr>
        ${body}
      `)}
      <div style="margin-top:8px;font-family:${FONT};font-size:11px;line-height:1.45;color:${MUTED}">${esc(note)}</div>
    ${CARD_CLOSE}`;
}

// The narrative arrives as the Markdown Claude wrote for the on-screen
// recap. Only the subset that recap uses is rendered - ##/# headings,
// bullets, blank-line paragraphs and **bold** - and everything is escaped
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
//
// Four fields, because a stale report has to say two different things in
// two different places:
//
//   text      the original one-liner, kept for callers that want the whole
//             story on a single line;
//   stamp     just when it was taken - the line under the period label,
//             with a banner carrying the rest by then;
//   headline  what is wrong with these numbers, in one short sentence;
//   detail    when they were taken, and how to get current ones.
//
// The last two feed the banner at the top of the email. They exist because
// the warning used to be 12px grey text under the heading, which is where
// an eleven-day-old report went out looking exactly like a fresh one.
const DAY_MS = 24 * 3600 * 1000;
const STALE_AGE_MS = 8 * DAY_MS;
// A snapshot this much behind the period it reports is still current
// enough to send unremarked: the cron runs hourly, so anything inside an
// hour is as fresh as the schedule can deliver.
const GRACE_MS = 60 * 60 * 1000;
const REFRESH_HINT = 'Open Charts → Weekly Report - the numbers republish on every visit, and the next send will carry them.';

export function freshnessNote(snapshot, now = Date.now()) {
  const at = Number(snapshot?.capturedAt);
  if (!Number.isFinite(at)) {
    const text = 'Captured at an unknown time.';
    return {
      text,
      stamp: text,
      stale: true,
      headline: 'These numbers have no capture time.',
      detail: `Nothing recorded when this report was taken, so there is no telling what it covers. ${REFRESH_HINT}`,
    };
  }
  const when = new Date(at).toUTCString().replace(' GMT', ' UTC');
  const stamp = `Captured ${when}.`;
  const end = Number(snapshot?.periodEnd);
  // How much of the period the snapshot cannot account for.
  //
  // Not simply "captured before the period ended": a report of a week
  // still running is captured mid-week by definition, and a preview taken
  // this second is missing nothing at all. What makes a mid-period capture
  // stale is time that has passed since it EM the report could have reached
  // `now`, or the end of the period if that came first, and it stopped at
  // `at` instead. An hour of that is the cron's own cadence and not worth
  // a banner; three days is the whole back half of a week.
  const missed = Number.isFinite(end) ? Math.min(end, now) - at : 0;
  const early = missed > GRACE_MS;
  // Rounded, not floored: a snapshot 10 days and 20 hours old is eleven
  // days old to the person reading it, and the age only ever appears once
  // it is past a week anyway.
  const days = Math.round((now - at) / DAY_MS);
  const old = (now - at) > STALE_AGE_MS;
  if (!early && !old) return { text: stamp, stamp, stale: false, headline: '', detail: '' };

  const periodWord = snapshot?.scope === 'day' ? 'day' : 'week';
  const age = `${days} day${days === 1 ? '' : 's'} old`;
  const headline = early
    ? (old
      ? `These numbers are ${age} and were captured before the ${periodWord} ended.`
      : `These numbers were captured before the ${periodWord} ended.`)
    : `These numbers are ${age}.`;
  return {
    text: early
      ? `Captured ${when}, before this period ended - anything after that isn't counted. Open Charts → Weekly Report to refresh it.`
      : stamp,
    stamp,
    stale: true,
    headline,
    detail: `Captured ${when}. Nothing that happened after that is counted here. ${REFRESH_HINT}`,
  };
}

// The banner a stale report leads with: full width, above the heading, in
// the same amber the cards use for a figure that is off its mark. The
// first thing read is then that the figures below are not current, rather
// than the figures.
export function staleBannerHtml(fresh) {
  if (!fresh?.stale || !fresh.headline) return '';
  const c = STATUS.behind;
  return `${table(`width="100%" bgcolor="${c.chipBg}" style="border-collapse:separate;background-color:${c.chipBg};border:1px solid ${c.rule};border-radius:6px"`, `<tr>
      <td style="padding:11px 14px;font-family:${FONT}">
        <div style="font-size:14px;font-weight:700;line-height:1.35;color:${c.chip}">${esc(fresh.headline)}</div>
        <div style="margin-top:4px;font-size:12px;line-height:1.45;color:${c.chip}">${esc(fresh.detail)}</div>
      </td>
    </tr>`)}${spacer(14)}`;
}

/**
 * @param {object} snapshot  what the tab published
 * @param {object} opts
 * @param {string} opts.message  the schedule's intro note, if any
 * @param {string} opts.funnelImageSrc  what the funnel <img> should point
 *   at. A sent email passes a `cid:` reference to its own attachment,
 *   since a remote image is blocked by default in Outlook and Gmail; the
 *   tab's preview passes the data URL straight through. Omit it and the
 *   email is the stage table alone, which is also what happens when the
 *   snapshot carries no picture.
 */
export function renderWeeklyReportHtml(snapshot, {
  message = '', funnelImageSrc = '', coverageImageSrcs = {},
} = {}) {
  const s = snapshot || {};
  const fresh = freshnessNote(s);
  const cards = Array.isArray(s.kpiCards) ? s.kpiCards : [];
  const tr = s.trends || {};
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

  // The two series that replaced the "Emails sent" and "New opps" tiles.
  // Each is its own chart on its own scale: one axis per chart, because a
  // week of ~30 emails and a month of ~2 opps share no axis worth drawing.
  // Colours are the accents the tab already gives these two metrics, so the
  // same number is the same colour in both places.
  const trendRow = (s.trends && (tr.emailsByWeek?.length || tr.newOppsByMonth?.length))
    ? cardRow([
      trendCardHtml({
        title: 'Emails sent',
        note: `last ${(tr.emailsByWeek || []).length} weeks`,
        points: tr.emailsByWeek,
        accent: TREND_BLUE,
        emptyNote: 'No weekly email history recorded yet.',
      }),
      trendCardHtml({
        title: 'New opps',
        note: `last ${(tr.newOppsByMonth || []).length} months`,
        points: tr.newOppsByMonth,
        accent: TREND_GREEN,
        emptyNote: 'No monthly opp history in the cache yet.',
      }),
    ])
    : `<div style="font-family:${FONT};font-size:13px;color:${MUTED};padding:12px 14px;border:1px dashed ${BORDER};background-color:${SURFACE_ALT};border-radius:6px">The email history series were not in this snapshot. Open Charts \u2192 Weekly Report once and the next send will carry them.</div>`;
  const shot = s.funnelImage;
  const funnel = funnelHtml(s.funnel, funnelImageSrc && shot
    ? { ...shot, src: funnelImageSrc }
    : null);
  // Straight under the funnel, as on the tab: the funnel says where each
  // stage's close rate stands, this says which way it is going.
  const trend = closeRateTrendHtml(s.closeRateTrend);
  // The Progress tab's two coverage charts. They sit under the activity
  // series rather than up with the pipeline figures because they answer a
  // different question: not what the year is worth, but whether the
  // accounts it rests on have anybody in them to call.
  const coverage = coverageHtml(s.coverage, coverageImageSrcs);
  // The heading counts what the cards actually show. With the charts drawn
  // that is the whole series; falling back to the bars it is the tail of
  // it, and a heading claiming half a year over five rows of bars would be
  // the report miscounting itself.
  const coverageDrawn = (s.coverage?.charts || []).some(c => c.image && coverageImageSrcs[c.id]);
  const coverageSpan = Number(s.coverage?.weeks) || (s.coverage?.charts?.[0]?.points || []).length;
  const coverageWeeks = coverageDrawn ? coverageSpan : Math.min(coverageSpan, COVERAGE_TABLE_ROWS);
  const trendMonths = (Array.isArray(s.closeRateTrend?.months) ? s.closeRateTrend.months : []).length;
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
    /* General sibling, not adjacent: the gutter cell still sits between the
       two columns in the markup, so an adjacent-sibling rule never matched
       and every
       stacked pair rendered flush against its neighbour on a phone. */
    .col ~ .col { padding-top:12px !important; }
    td.gut { display:none !important; width:0 !important; }
    /* Narrow enough and the note wraps beside its heading instead of
       being squeezed against the slack cell, which goes away. */
    .hnote { white-space:normal !important; }
    .hpad { display:none !important; width:0 !important; }
    /* The funnel's stage bars are a fixed column, which is 260px a phone
       does not have: there the figures beside them are the whole story,
       as they are for a reader whose client hides the chart image. */
    .sbar { display:none !important; width:0 !important; }
    /* Same trade for the coverage cards: two fixed tracks and their
       figures are wider than a phone, and the percentages beside them
       carry the series on their own. */
    .cbar { display:none !important; width:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG}">
${table(`width="100%" bgcolor="${PAGE_BG}" style="border-collapse:collapse;background-color:${PAGE_BG}"`, `<tr><td align="center" style="padding:20px 12px 28px">
  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}"><tr><td><![endif]-->
  <div style="max-width:${WIDTH}px;margin:0 auto;text-align:left">

    ${staleBannerHtml(fresh)}
    ${table(`width="100%" style="border-collapse:collapse"`, `<tr><td style="font-family:${FONT}">
      ${table(`width="100%" style="border-collapse:collapse"`, `<tr>
        <td valign="bottom" style="font-family:${FONT};font-size:22px;font-weight:700;color:${INK};line-height:1.25;white-space:nowrap">Weekly Report</td>
        ${s.periodLabel ? `<td class="hnote" valign="bottom" style="padding:0 0 3px 10px;font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.3;white-space:nowrap">${esc(s.periodLabel)}</td>` : ''}
        <td class="hpad" width="99%" style="width:99%"></td>
      </tr>`)}
      <div style="margin-top:5px;font-size:12px;line-height:1.4;color:${fresh.stale ? STATUS.behind.chip : MUTED}">${esc(fresh.stamp)}</div>
    </td></tr>`)}

    ${spacer(16)}
    ${intro}

    ${headingHtml('Where the year stands')}
    ${spacer(8)}
    ${kpiRow}

    ${funnel ? `${spacer(20)}${headingHtml('Pipeline funnel')}${spacer(8)}${funnel}` : ''}

    ${trend ? `${spacer(20)}${headingHtml('Close rate trend', `Last ${trendMonths} months, by the stage each closed deal reached`)}${spacer(8)}${trend}` : ''}

    ${spacer(16)}${trendRow}

    ${coverage ? `${spacer(20)}${headingHtml('Account coverage', `Last ${coverageWeeks} weeks, from the Progress tab`)}${spacer(8)}${coverage}` : ''}

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
