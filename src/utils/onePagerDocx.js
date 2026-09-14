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
], { rule: SE_GREEN, spaceBefore: 150, spaceAfter: 70 });

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

function contactsTable({ shown, hidden }) {
  if (!shown.length) return emptyNote('No contacts on file for this company yet.');
  const widths = [CONTENT_WIDTH * 0.26, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.18];
  const head = ['Name', 'Title', 'Email', 'Phone'].map((h, i) => cell(
    para([run(h.toUpperCase(), { bold: true, color: SE_MUTED, size: 14 })], { spaceAfter: 0 }),
    { width: widths[i], borders: { ...NO_BORDER, bottom: SE_BORDER } },
  ));
  // The day-to-day contact is the one the sheet exists to surface, so the
  // row is tinted rather than just labelled: on a page skimmed in a lift,
  // a marker among four columns of text is not found and a shaded band is.
  const rows = shown.map((c) => {
    const fill = c.dayToDay ? SE_SURFACE : '';
    const edges = { ...NO_BORDER, bottom: 'EEF2F6' };
    const nameLines = [
      para([
        run(c.name, { bold: true, size: 18 }),
        c.dayToDay ? run('  DAY TO DAY', { bold: true, color: SE_GREEN_DARK, size: 13 }) : '',
        c.decisionMaker ? run('  DM', { bold: true, color: SE_GREEN_DARK, size: 13 }) : '',
      ], { spaceAfter: 0 }),
      // Who they sit under, under their name rather than in a column of
      // its own: it is the answer to a question asked about one person,
      // not a field worth four columns of the page.
      c.reportsTo.length
        ? para([run(`reports to ${c.reportsTo.join(', ')}`, { color: SE_MUTED, size: 14, italic: true })], { spaceAfter: 0 })
        : '',
    ].join('');
    return [
      cell(nameLines, { width: widths[0], fill, borders: edges }),
      cell(para([run(c.title || '-', { color: SE_SLATE, size: 18 })], { spaceAfter: 0 }), { width: widths[1], fill, borders: edges }),
      cell(para([run(c.email || '-', { color: SE_SLATE, size: 16 })], { spaceAfter: 0 }), { width: widths[2], fill, borders: edges }),
      cell(para([run(c.phone || '-', { color: SE_SLATE, size: 16 })], { spaceAfter: 0 }), { width: widths[3], fill, borders: edges }),
    ];
  });
  const more = hidden
    ? para([run(`+ ${hidden} more on the company record.`, { color: SE_MUTED, size: 14 })], { spaceBefore: 40 })
    : '';
  return table(widths, [head, ...rows]) + more;
}

// Open opportunities. A table rather than chips: every column here is a
// question somebody asks out loud - what stage, how much, when does it
// land - and a chip can only carry the name.
function oppsTable({ shown, hidden }) {
  if (!shown.length) return emptyNote('Nothing open on this account right now.');
  const widths = [CONTENT_WIDTH * 0.40, CONTENT_WIDTH * 0.24, CONTENT_WIDTH * 0.18, CONTENT_WIDTH * 0.18];
  const head = ['Opportunity', 'Stage', 'Amount', 'Close'].map((h, i) => cell(
    para([run(h.toUpperCase(), { bold: true, color: SE_MUTED, size: 14 })], { spaceAfter: 0 }),
    { width: widths[i], borders: { ...NO_BORDER, bottom: SE_BORDER } },
  ));
  const rows = shown.map(o => [
    cell(para([run(o.name, { bold: true, size: 18 })], { spaceAfter: 0 }), { width: widths[0], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
    cell(para([run(o.stage || '-', { color: SE_SLATE, size: 17 })], { spaceAfter: 0 }), { width: widths[1], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
    cell(para([run(o.amount || '-', { bold: true, color: SE_GRAPHITE, size: 17 })], { spaceAfter: 0 }), { width: widths[2], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
    cell(para([run(o.closeDate || '-', { color: SE_SLATE, size: 17 })], { spaceAfter: 0 }), { width: widths[3], borders: { ...NO_BORDER, bottom: 'EEF2F6' } }),
  ]);
  const more = hidden
    ? para([run(`+ ${hidden} more open.`, { color: SE_MUTED, size: 14 })], { spaceBefore: 40 })
    : '';
  return table(widths, [head, ...rows]) + more;
}

// What the account already buys, grouped under the bucket it belongs to
// and bulleted. A flat list of twelve reads as twelve unrelated things;
// three buckets of four says what this account actually buys from us.
//
// The bullet is a glyph and a hanging indent rather than a Word list.
// A real list means a numbering.xml part, a relationship to it, and an
// abstract definition per level - three more parts to get subtly wrong,
// for a document that never needs the numbering to continue across
// anything. It prints identically.
function servicesBullets({ groups, hidden }) {
  if (!groups.length) return emptyNote('Nothing sold on this account yet.');
  const block = (g, first) => [
    para([run(g.bucket, { bold: true, color: SE_SLATE, size: 17 })], {
      spaceBefore: first ? 0 : 90, spaceAfter: 10,
    }),
    ...g.items.map(name => para([
      run('\u2022   ', { color: SE_GREEN_DARK, size: 18, bold: true }),
      run(name, { color: SE_GRAPHITE, size: 18 }),
    ], { spaceAfter: 0, indent: { left: 340, hanging: 180 } })),
  ].join('');

  // Two columns. A bucket heading costs a line whatever is under it, so a
  // book filed into six buckets spends six lines on headings alone - which
  // is what pushed this page over onto a second one when the bullets were
  // a single column. Split by the LINES each group takes (heading plus
  // items) rather than by group count, or five one-item buckets end up
  // beside one bucket of seven.
  const lines = groups.map(g => g.items.length + 1);
  const total = lines.reduce((a, b) => a + b, 0);
  let run1 = 0;
  let cut = groups.length;
  for (let i = 0; i < groups.length; i += 1) {
    if (run1 >= Math.ceil(total / 2)) { cut = i; break; }
    run1 += lines[i];
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
  { spaceBefore: 150, rule: SE_BORDER },
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

/** The document body, as WordprocessingML. */
export function onePagerDocumentXml(model) {
  const body = [
    headerBand(model),
    para([run('')], { spaceAfter: 80 }),
    ownersBand(model.owners, model.clientSince),
    heading('Key contacts', 'shaded = day to day    DM = decision maker'),
    contactsTable(model.contacts),
    heading('Open opportunities', plural(model.opps.total, 'open')),
    oppsTable(model.opps),
    heading('In scope today', `${plural(model.services.total, 'service')} sold`),
    servicesBullets(model.services),
    model.notes ? heading('Notes') : '',
    model.notes ? para([run(model.notes, { color: SE_SLATE, size: 18 })]) : '',
    // Page one closes with its own footer rule whether or not a second
    // page follows, so page one is the same document it was before the
    // chart existed. The chart then starts a page and closes with the same
    // line: this is a plain paragraph rather than a real Word footer part,
    // so a page that does not carry one has none, and an internal sheet
    // that loses its "internal use" marker halfway through is worse than
    // one line repeated.
    footerRule(),
    orgChartPage(model.orgChart),
    model.orgChart ? footerRule() : '',
    // Letter, one-inch margins. The section properties close the body and
    // are what make the widths above mean what they say.
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
      + '<w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

// The three files besides document.xml that make a zip a .docx. Minimal on
// purpose: Word fills in every default this leaves out, and each extra
// part is another thing to get subtly wrong.
export const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

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
  zip.folder('word').file('document.xml', onePagerDocumentXml(model));
  const inBrowser = typeof Blob !== 'undefined' && typeof window !== 'undefined';
  return zip.generateAsync({
    type: inBrowser ? 'blob' : 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}
