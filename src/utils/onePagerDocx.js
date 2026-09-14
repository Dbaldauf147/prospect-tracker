// A real Word document, written as WordprocessingML.
//
// The one-pager used to go out through html-docx-js, which does not build
// a Word document at all: it wraps the HTML in an `altChunk`, leaves it as
// an .mht inside the zip, and relies on Word converting it on open. Word
// does. Nothing else reliably does - Google Docs, Quick Look, the preview
// pane in Outlook and most phone viewers show a blank or a stack of
// unstyled text, which is a poor thing to hand somebody five minutes
// before a meeting.
//
// So the paragraphs and tables below are the actual document. No
// conversion step, no second interpretation of the layout, and the same
// bytes in every reader.
//
// Written by hand rather than with a library because the whole vocabulary
// needed here is paragraphs, runs, shaded cells and borders - and because
// jszip is already a dependency, which is the only other half of a .docx.
// (pngChart.js hand-rolls a PNG encoder in this repo for the same reason.)
//
// Units, since none of them are pixels:
//   * page and table widths are TWIPS, 1/1440 inch. Letter is 12240, and
//     one-inch margins leave 9360 for content.
//   * font sizes are HALF-POINTS: w:sz 20 is 10pt.
//   * colours are RRGGBB with no leading hash.

import {
  SE_GREEN, SE_GREEN_DARK, SE_GRAPHITE, SE_SLATE, SE_MUTED, SE_SURFACE, SE_BORDER,
} from './schneiderBrand.js';
import { MAX_ORG_INDENT } from './companyOnePager.js';

const hex = (c) => String(c || '').replace('#', '').toUpperCase();

// The C0 controls Word refuses, minus tab / newline / carriage return,
// which it carries through their own elements. Built from code points so
// this file stays pure ASCII: a literal control character is invisible in
// an editor and in a diff, which is how one gets lost or duplicated.
const CONTROL_CHARS = new RegExp(
  `[${[[0x00, 0x08], [0x0B, 0x0C], [0x0E, 0x1F]]
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`,
  'g',
);

// XML text escaping. Word is stricter than a browser: an unescaped & in a
// company name does not render as an ampersand, it makes the file
// unopenable ("unreadable content").
export const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(CONTROL_CHARS, '');

const CONTENT_WIDTH = 9360;
const FONT = 'Segoe UI';

/** One run of text: the inline bits Word styles as a unit. */
export function run(text, { bold = false, color = SE_GRAPHITE, size = 20, italic = false } = {}) {
  const props = [
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/>`,
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    `<w:color w:val="${hex(color)}"/>`,
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
  ].join('');
  // xml:space preserve or Word eats the spaces between runs, which is how
  // "Priya Raman · DM" becomes "Priya Raman·DM".
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

/**
 * A paragraph.
 *
 * `shading` fills the whole line, which is how the green title band is
 * drawn - Word has no div to colour. `rule` puts a coloured line under it,
 * which is how a section heading is marked.
 */
export function para(runs, { shading = '', spaceBefore = 0, spaceAfter = 40, rule = '', align = '', indent = null } = {}) {
  const body = Array.isArray(runs) ? runs.join('') : runs;
  // ORDER MATTERS. The children of w:pPr are a schema SEQUENCE, not a set:
  // pBdr, then shd, then spacing, then ind, then jc. Word does not sort
  // them for you - an out-of-order child is "unreadable content" and a
  // refusal to open the file, which is a failure that shows up on somebody
  // else's laptop rather than here.
  const props = [
    rule ? `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="${hex(rule)}"/></w:pBdr>` : '',
    shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(shading)}"/>` : '',
    `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>`,
    indent ? `<w:ind w:left="${Math.round(indent.left || 0)}" w:hanging="${Math.round(indent.hanging || 0)}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${body}</w:p>`;
}

/** One cell. Width is twips; `fill` shades it; `borders` draws its edges. */
export function cell(content, { width, fill = '', borders = null, valign = 'top' } = {}) {
  const b = borders ? `<w:tcBorders>${Object.entries(borders).map(([side, colour]) => (
    colour
      ? `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="${hex(colour)}"/>`
      : `<w:${side} w:val="nil"/>`
  )).join('')}</w:tcBorders>` : '';
  // Same sequence rule as w:pPr, with its own order: tcW, tcBorders, shd,
  // tcMar, vAlign.
  const props = [
    `<w:tcW w:w="${Math.round(width)}" w:type="dxa"/>`,
    b,
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(fill)}"/>` : '',
    '<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
      + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>',
    `<w:vAlign w:val="${valign}"/>`,
  ].join('');
  // A cell with no paragraph in it makes the file unreadable, so an empty
  // one still carries an empty paragraph.
  return `<w:tc><w:tcPr>${props}</w:tcPr>${content || para([run('')], { spaceAfter: 0 })}</w:tc>`;
}

/** A table. `widths` is per column, in twips, and has to total CONTENT_WIDTH. */
export function table(widths, rows) {
  const grid = widths.map(w => `<w:gridCol w:w="${Math.round(w)}"/>`).join('');
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${Math.round(widths.reduce((a, b) => a + b, 0))}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>${grid}</w:tblGrid>
    ${rows.map(cells => `<w:tr>${cells.join('')}</w:tr>`).join('')}
  </w:tbl>`;
}

// ---- the page ----------------------------------------------------------

const NO_BORDER = { top: '', left: '', bottom: '', right: '' };
const heading = (label, note) => para([
  run(label.toUpperCase(), { bold: true, color: SE_GREEN_DARK, size: 20 }),
  note ? run(`   ${note}`, { color: SE_MUTED, size: 16 }) : '',
], { rule: SE_GREEN, spaceBefore: 110, spaceAfter: 60 });

const emptyNote = (text) => para([run(text, { color: SE_MUTED, size: 18, italic: true })]);

function headerBand(model) {
  const left = [
    para([run(model.company || 'Company', { bold: true, color: 'FFFFFF', size: 32 })], { spaceAfter: 0 }),
    para([run(`ACCOUNT SUMMARY${model.dateLabel ? `   ${model.dateLabel}` : ''}`, { color: 'DCFCE7', size: 15 })], { spaceAfter: 0 }),
  ].join('');
  const right = [
    para([run('Schneider Electric', { bold: true, color: 'FFFFFF', size: 22 })], { spaceAfter: 0, align: 'right' }),
    // A light tint, not SE_GREEN: brand green on the dark green band is the
    // one pairing in the kit that cannot be read, and the lockup renders
    // white on dark everywhere else.
    para([run('LIFE IS ON', { color: 'A7F3D0', size: 14 })], { spaceAfter: 0, align: 'right' }),
  ].join('');
  return table([CONTENT_WIDTH * 0.62, CONTENT_WIDTH * 0.38], [[
    cell(left, { width: CONTENT_WIDTH * 0.62, fill: SE_GREEN_DARK, borders: NO_BORDER }),
    cell(right, { width: CONTENT_WIDTH * 0.38, fill: SE_GREEN_DARK, borders: NO_BORDER, valign: 'bottom' }),
  ]]);
}

// The two names that answer "who do I ask about this account". A blank one
// says "Not assigned" rather than leaving a gap, so the reader can tell an
// unowned account from a field the export dropped.
function ownersBand({ cdm, clientManager }, clientSince) {
  // Three across once Client since joined them. It belongs up here with
  // the owners rather than in a section of its own: all three answer
  // "what is our standing with this account", and one date does not earn
  // a heading and a rule.
  const third = CONTENT_WIDTH / 3;
  const box = (label, value, missing) => cell([
    para([run(label.toUpperCase(), { bold: true, color: SE_MUTED, size: 15 })], { spaceAfter: 20 }),
    para([run(value || missing, { bold: true, color: value ? SE_GRAPHITE : SE_MUTED, size: 24 })], { spaceAfter: 0 }),
  ].join(''), {
    width: third,
    fill: SE_SURFACE,
    borders: { top: SE_BORDER, left: SE_BORDER, bottom: SE_BORDER, right: SE_BORDER },
  });
  return table([third, third, third], [[
    box('CDM', cdm, 'Not assigned'),
    box('Client Manager', clientManager, 'Not assigned'),
    // "No contract on file" rather than "Not assigned": a missing date here
    // means the Deals tab has nothing for this client, which is a different
    // gap from an unowned account and sends the reader somewhere else.
    box('Client since', clientSince?.label || '', 'No contract on file'),
  ]]);
}

// How far one reporting level moves a name to the right, in twips. Enough
// that a column of names reads as a shape rather than as a ragged edge,
// and small enough that four levels deep still leaves room for a name.
const REPORT_INDENT = 200;

function contactsTable({ shown, hidden }) {
  if (!shown.length) return emptyNote('No contacts on file for this company yet.');
  const widths = [CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.26, CONTENT_WIDTH * 0.18];
  const head = ['Name', 'Title', 'Email', 'Team'].map((h, i) => cell(
    para([run(h.toUpperCase(), { bold: true, color: SE_MUTED, size: 14 })], { spaceAfter: 0 }),
    { width: widths[i], borders: { ...NO_BORDER, bottom: SE_BORDER } },
  ));
  // The day-to-day contact is the one the sheet exists to surface, so the
  // row is tinted rather than just labelled: on a page skimmed in a lift,
  // a marker among four columns of text is not found and a shaded band is.
  const rows = shown.map((c) => {
    const fill = c.dayToDay ? SE_SURFACE : '';
    const edges = { ...NO_BORDER, bottom: 'EEF2F6' };
    const depth = Math.max(0, Number(c.depth) || 0);
    const nameLines = [
      para([
        // The arrow turns down out of the manager's row and points at the
        // person: on a page of names it is the one mark that says "these
        // are theirs" without a word. Only on a row that IS drawn under
        // somebody - an indent with no arrow would be a name that looks
        // misaligned.
        depth > 0 ? run('\u21B3 ', { color: SE_GREEN_DARK, bold: true, size: 18 }) : '',
        run(c.name, { bold: true, size: 18 }),
        c.dayToDay ? run('  DAY TO DAY', { bold: true, color: SE_GREEN_DARK, size: 13 }) : '',
      ], { spaceAfter: 0, indent: depth > 0 ? { left: depth * REPORT_INDENT, hanging: 120 } : null }),
      // The manager, in words, ONLY when the table could not draw them:
      // somebody off this list, or above the cap. Where the arrow above
      // already says it, saying it again is a line of the page spent on
      // what the shape of the column has just shown.
      c.reportsTo.length && !c.managerShown
        ? para([run(`reports to ${c.reportsTo.join(', ')}`, { color: SE_MUTED, size: 14, italic: true })],
          { spaceAfter: 0, indent: depth > 0 ? { left: depth * REPORT_INDENT } : null })
        : '',
    ].join('');
    return [
      cell(nameLines, { width: widths[0], fill, borders: edges }),
      cell(para([run(c.title || '-', { color: SE_SLATE, size: 18 })], { spaceAfter: 0 }), { width: widths[1], fill, borders: edges }),
      cell(para([run(c.email || '-', { color: SE_SLATE, size: 16 })], { spaceAfter: 0 }), { width: widths[2], fill, borders: edges }),
      // No team set reads as a dash, like every other blank on the page:
      // the reader can tell "nobody has filed them" from a column the
      // export dropped.
      cell(para([run(c.team || '-', { color: SE_SLATE, size: 16 })], { spaceAfter: 0 }), { width: widths[3], fill, borders: edges }),
    ];
  });
  const more = hidden
    ? para([run(`+ ${hidden} more on the company record.`, { color: SE_MUTED, size: 14 })], { spaceBefore: 40 })
    : '';
  return table(widths, [head, ...rows]) + more;
}

// Open opportunities. A table rather than chips: what is being sold, what
// stage it is at and what it is worth are all questions somebody asks out
// loud, and a chip can only carry the name.
function oppsTable({ shown, hidden }) {
  if (!shown.length) return emptyNote('Nothing open on this account right now.');
  // The opportunity column takes the width, because it is the only one
  // whose contents wrap. Amount holds six characters and was sized as if
  // it held a sentence.
  const widths = [CONTENT_WIDTH * 0.62, CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.16];
  const head = ['Opportunity', 'Stage', 'Amount'].map((h, i) => cell(
    para([run(h.toUpperCase(), { bold: true, color: SE_MUTED, size: 14 })], { spaceAfter: 0 }),
    { width: widths[i], borders: { ...NO_BORDER, bottom: SE_BORDER } },
  ));
  const rows = shown.map((o) => {
    // The scope of services, not the opp's own name.
    //
    // A BFO opportunity name is a coded string - "SB - SUSUP - New -
    // Project - NAM - YEAR1 - Bill payment-Blackrock, Inc." - built for a
    // CRM's uniqueness rules rather than for reading. The one part of it
    // anybody wants, what work is being sold, is buried in the middle, and
    // the Scope field says exactly that on its own. So the coded name is
    // not printed at all: somebody looking an opp up again has BFO open
    // anyway, and on a sheet read in five minutes it was a line of noise
    // under every row.
    //
    // The name is still the fallback, for an opp with no Scope recorded -
    // a row naming nothing would be worse than a coded row.
    const scope = o.scope && o.scope !== o.name ? o.scope : '';
    return [
      cell(para([run(scope || o.name, { bold: true, size: 18 })], { spaceAfter: 0 }), { width: widths[0], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
      cell(para([run(o.stage || '-', { color: SE_SLATE, size: 17 })], { spaceAfter: 0 }), { width: widths[1], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
      cell(para([run(o.amount || '-', { bold: true, color: SE_GRAPHITE, size: 17 })], { spaceAfter: 0 }), { width: widths[2], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
    ];
  });
  const more = hidden
    ? para([run(`+ ${hidden} more open.`, { color: SE_MUTED, size: 14 })], { spaceBefore: 40 })
    : '';
  return table(widths, [head, ...rows]) + more;
}

// What the account already buys, grouped under the bucket it belongs to.
//
// Two shapes, chosen by the model rather than here: bullets while they
// fit, and the same services run together with commas when they do not.
// The comma set reads slightly worse and holds two or three times as much,
// which on a book of fifteen services is the difference between the page
// listing all of them and the page listing eight and counting the rest.
//
// The bullet is a glyph and a hanging indent rather than a Word list.
// A real list means a numbering.xml part, a relationship to it, and an
// abstract definition per level - three more parts to get subtly wrong,
// for a document that never needs the numbering to continue across
// anything. It prints identically.
function servicesBullets({ groups, hidden, mode }) {
  if (!groups.length) return emptyNote('Nothing sold on this account yet.');
  const bucketLine = (g, first) => para([run(g.bucket, { bold: true, color: SE_SLATE, size: 17 })], {
    spaceBefore: first ? 0 : 90, spaceAfter: 10,
  });
  const block = (g, first) => [
    bucketLine(g, first),
    ...(mode === 'commas'
      // One paragraph that wraps, rather than one per service: the wrap is
      // what buys the space, so the services have to share a paragraph for
      // Word to be able to set three of them on a line.
      ? [para([run(g.items.join(', '), { color: SE_GRAPHITE, size: 18 })], {
        spaceAfter: 0, indent: { left: 120, hanging: 0 },
      })]
      : g.items.map(name => para([
        run('\u2022   ', { color: SE_GREEN_DARK, size: 18, bold: true }),
        run(name, { color: SE_GRAPHITE, size: 18 }),
      ], { spaceAfter: 0, indent: { left: 340, hanging: 180 } }))),
  ].join('');

  // Two columns. A bucket heading costs a line whatever is under it, so a
  // book filed into six buckets spends six lines on headings alone - which
  // is what pushed this page over onto a second one when the bullets were
  // a single column. Split by the LINES each group takes, which the model
  // worked out when it budgeted them: doing that sum again here would be a
  // second opinion about how tall a bucket is, and in comma mode the two
  // would not even agree, since a group of four can be one line or three.
  //
  // The cut is the one that leaves the two columns closest in height,
  // rather than the first that passes half. Those differ whenever a bucket
  // straddles the middle - filling until half is reached hands that whole
  // bucket to the left column, which is how six lines ended up beside
  // three. Buckets stay in order either way; only where the break falls
  // changes.
  const lines = groups.map(g => g.lines || (g.items.length + 1));
  const total = lines.reduce((a, b) => a + b, 0);
  let cut = groups.length;
  let best = Infinity;
  let left = 0;
  for (let i = 1; i <= groups.length; i += 1) {
    left += lines[i - 1];
    const gap = Math.abs(left - (total - left));
    if (gap < best) { best = gap; cut = i; }
  }
  const half = CONTENT_WIDTH / 2;
  const column = (list) => list.map((g, i) => block(g, i === 0)).join('') || para([run('')], { spaceAfter: 0 });
  const grid = table([half, half], [[
    cell(column(groups.slice(0, cut)), { width: half, borders: NO_BORDER }),
    cell(column(groups.slice(cut)), { width: half, borders: NO_BORDER }),
  ]]);
  const more = hidden
    ? para([run(`+ ${hidden} more sold.`, { color: SE_MUTED, size: 14 })], { spaceBefore: 60 })
    : '';
  return grid + more;
}

// ---- page two: the org chart ----------------------------------------------

// A page break. Word has no "start a new page" property on a paragraph
// worth using here - w:pageBreakBefore hangs off the NEXT paragraph and
// moves with it when anything above is reordered. An explicit break run is
// a thing in the document at the point the break happens, which is what
// makes the second page survive an edit to the first.
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const footerRule = () => para(
  [run('Schneider Electric - generated from Prospect Tracker. Internal use.', { color: SE_MUTED, size: 13 })],
  { spaceBefore: 110, rule: SE_BORDER },
);

// How far one level of nesting moves right, in twips. 200 is about 0.14",
// which is enough to read as a step without walking a six-deep chart off
// the page - and MAX_ORG_INDENT stops it stepping past that anyway.
const ORG_STEP = 200;

// The chart, as a column of indented lines.
//
// Indentation rather than boxes and connectors. Word can draw the boxes -
// a nested table per level - but a table cannot break across a page the
// way a column of paragraphs does, and a chart that needs one more row
// than the page holds would silently lose its last division rather than
// its last person. A line per person also means the cap can count what it
// is capping.
function orgChartPage(chart) {
  if (!chart) return '';
  const indent = (depth) => ({ left: Math.min(depth, MAX_ORG_INDENT) * ORG_STEP, hanging: 0 });

  const line = (row) => {
    if (row.kind === 'division') {
      // The root is the company itself and is already named in the band at
      // the top of page one, so it is set as a plain heading; a division
      // under it carries the guide rule that says it hangs off something.
      const label = row.root
        ? [run(row.name, { bold: true, color: SE_GRAPHITE, size: 22 })]
        : [
          run('── ', { color: SE_BORDER, size: 18 }),
          run(row.name, { bold: true, color: SE_GREEN_DARK, size: 19 }),
          // A company the tracker no longer carries still belongs on the
          // chart - it is where these people sit - but the reader has to
          // know the record behind it is gone.
          row.missing ? run('   (no record)', { color: SE_MUTED, size: 14, italic: true }) : '',
        ];
      return para(label, {
        spaceBefore: row.root ? 0 : 100, spaceAfter: 30, indent: indent(row.depth),
      });
    }
    if (row.kind === 'team') {
      return para([run(row.name.toUpperCase(), { bold: true, color: SE_MUTED, size: 14 })], {
        spaceBefore: 50, spaceAfter: 20, indent: indent(row.depth),
      });
    }
    // Somebody. Nesting is the reporting line, so the row says only what
    // nesting cannot: who they are, what they do, and the two standings
    // page one marks as well. A leaver is greyed rather than dropped.
    const tone = row.left ? SE_MUTED : SE_GRAPHITE;
    return para([
      // An elbow only where there is a reporting line to draw: the person
      // at the top of a box is indented because the box is, not because
      // they answer to the heading above them.
      run(row.reportsUnder ? '└ ' : '• ', { color: row.left ? SE_BORDER : SE_GREEN_DARK, size: 16 }),
      run(row.name, { bold: true, color: tone, size: 18 }),
      row.title ? run(`  ${row.title}`, { color: row.left ? SE_MUTED : SE_SLATE, size: 17 }) : '',
      row.dayToDay ? run('  DAY TO DAY', { bold: true, color: SE_GREEN_DARK, size: 13 }) : '',
      row.decisionMaker ? run('  DM', { bold: true, color: SE_GREEN_DARK, size: 13 }) : '',
      row.left ? run('  LEFT', { bold: true, color: SE_MUTED, size: 13 }) : '',
      // A manager the chart could not draw above them: on another box, or
      // in another team. Without this the reporting line the user mapped
      // would simply be missing from the page.
      row.managers.length
        ? run(`   ↑ ${row.managers.join(', ')}`, { color: SE_MUTED, size: 14, italic: true })
        : '',
    ], { spaceAfter: 0, indent: indent(row.depth) });
  };

  const parents = chart.parents.length
    ? para([
      run('Part of  ', { color: SE_MUTED, size: 15 }),
      run(chart.parents.join(', '), { bold: true, color: SE_SLATE, size: 17 }),
    ], { spaceAfter: 80 })
    : '';
  const more = chart.hidden
    ? para([run(`+ ${chart.hidden} more on the company record.`, { color: SE_MUTED, size: 14 })],
      { spaceBefore: 100 })
    : '';
  const note = [
    chart.divisions ? plural(chart.divisions, 'division') : '',
    'nesting = reports to',
  ].filter(Boolean).join('    ');
  return [
    pageBreak(),
    heading('Org chart', note),
    parents,
    chart.rows.map(line).join(''),
    more,
  ].join('');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The running head: the green band, as its own document part.
 *
 * In the page header rather than at the top of the body, which is where a
 * letterhead belongs and what the band has always been. Three things fall
 * out of the move: it sits at the top of the PAGE instead of below the top
 * margin, so there is no white strip above it; it repeats if the page ever
 * runs to two; and it cannot be pushed down the page by whatever the body
 * grows into.
 */
export function onePagerHeaderXml(model) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${headerBand(model)}${
    // A header part must end in a paragraph: a bare table leaves Word
    // joining the band to the first thing in the body, and an empty one
    // with no spacing is the thinnest legal way to close it.
    para([run('', { size: 2 })], { spaceAfter: 0 })
  }</w:hdr>`;
}

/** The document body, as WordprocessingML. */
export function onePagerDocumentXml(model) {
  const body = [
    ownersBand(model.owners, model.clientSince),
    heading('Key contacts', 'shaded = day to day    indented = reports to the name above'),
    contactsTable(model.contacts),
    heading('Open opportunities'),
    oppsTable(model.opps),
    heading('Current services'),
    servicesBullets(model.services),
    model.notes ? heading('Notes') : '',
    model.notes ? para([run(model.notes, { color: SE_SLATE, size: 18 })]) : '',
    // Page one closes with its own footer rule whether or not a second
    // page follows, so page one is the same document it was before the
    // chart existed. The chart then starts a page and closes with the same
    // line: unlike the green band above, this is a plain paragraph rather
    // than a real Word part, so a page that does not carry one has none,
    // and an internal sheet that loses its "internal use" marker halfway
    // through is worse than one line repeated.
    footerRule(),
    orgChartPage(model.orgChart),
    model.orgChart ? footerRule() : '',
    // Letter, one-inch margins. The section properties close the body and
    // are what make the widths above mean what they say.
    //
    // `w:header` is how far down the page the band starts, and the top
    // margin is where the body starts under it: 360 twips (a quarter inch)
    // clears what a printer cannot reach without leaving the white strip
    // the band used to sit below, and 1440 leaves the band its half inch
    // plus a little air before the first row of the page.
    '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:pgSz w:w="12240" w:h="15840"/>'
      + '<w:pgMar w:top="1440" w:right="1440" w:bottom="900" w:left="1440" w:header="360" w:footer="720" w:gutter="0"/></w:sectPr>',
  ].join('');
  // The `r` namespace is not optional here: r:id on the header reference
  // is in it, and an undeclared prefix is "unreadable content" rather than
  // a header Word quietly ignores.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
}

// The three files besides document.xml that make a zip a .docx. Minimal on
// purpose: Word fills in every default this leaves out, and each extra
// part is another thing to get subtly wrong.
export const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

// The document's own relationships. There were none until the band moved
// into the header: a part Word is told to use by r:id has to be findable
// by that id, and a header referenced from nowhere is a header nobody
// draws.
export const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

export const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * The .docx itself.
 *
 * Returns a Blob in the browser and a Uint8Array in Node, which is what
 * jszip hands back for each - so the tests can unzip what the button
 * downloads without a DOM.
 */
export async function buildOnePagerDocx(model) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.folder('_rels').file('.rels', ROOT_RELS_XML);
  const word = zip.folder('word');
  word.file('document.xml', onePagerDocumentXml(model));
  word.file('header1.xml', onePagerHeaderXml(model));
  word.folder('_rels').file('document.xml.rels', DOCUMENT_RELS_XML);
  const inBrowser = typeof Blob !== 'undefined' && typeof window !== 'undefined';
  return zip.generateAsync({
    type: inBrowser ? 'blob' : 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}
