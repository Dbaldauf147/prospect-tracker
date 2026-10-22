// The "Opps deck" download on the company card: a PowerPoint in the SE
// Advisory Services template with one slide per open opportunity at the
// company, or at the companies it owns (a PE firm's deck is its portfolio's
// deals). Each slide carries who we are talking to, what is being sold,
// where it stands, and what happens next.
//
// The template is a cut-down copy of the SEAS master deck kept in
// src/assets/se-opps-template.pptx: the white wind-turbine cover (slide1,
// with {{COVER_TITLE}} / {{COVER_SUBTITLE}} tokens), the blank titled
// content frame (slide2: title placeholder, footer, page number, SE logo off
// the layout, and an <!--{{BODY}}--> marker where the shapes go) and the
// closing slide (slide3). Everything is written as plain OOXML strings and
// the package is edited with JSZip, so the theme, fonts and logos stay the
// template's own rather than an imitation of them.
//
// Two halves: picking the opps (pure) and writing the deck (needs the
// template bytes and JSZip). Both run under plain Node, so
// scripts/oppDeck.test.mjs can build a real file.

import { companiesMatch } from './listFlags.js';
import { splitPeOwners } from './peOwners.js';
import { isActiveOppStage, activeStageRank } from './oppStages.js';
import { textToBulletItems } from './nextSteps.js';

// ---- picking the opps ------------------------------------------------

const cell = (record, key) => {
  const value = String(record?.[key] ?? '').trim();
  return value === '-' ? '' : value;
};

/**
 * The open opps that belong in a company's deck, in slide order.
 *
 *   records   Opps 2 rows
 *   company   the card's company name
 *   owned     names of the companies it owns (divisions and holdings)
 *   prospects Table View records, for "whose PE owner is this company"
 *
 * An opp is in when its Account is the company or one it owns, or when the
 * company is its PE owner (named on the opp row, or on the Account's own
 * record). Only live stages count: Sold, Not Sold and broken cells are
 * history, not something to walk a client through.
 *
 * Returns [{ record, account, via, owner }] where via is 'direct', 'owned'
 * or 'pe', and owner is who to credit on the slide ("Owned by ...") for the
 * ones that aren't the company's own.
 * The company's own opps come first, then the owned companies' grouped by
 * company, each group furthest along first.
 */
export function selectDeckOpps(records, { company, owned = [], prospects = [] } = {}) {
  const self = String(company || '').trim();
  if (!self) return [];
  const ownedNames = (owned || []).map(o => String(o?.name ?? o ?? '').trim()).filter(Boolean);
  // Accounts whose Table View record names this company as PE owner.
  const ownedByPe = (prospects || [])
    .filter(p => p?.company && splitPeOwners(p.peOwner).some(o => companiesMatch(o, self)))
    .map(p => p.company);

  const out = [];
  for (const record of (records || [])) {
    if (!record || typeof record !== 'object') continue;
    const stage = cell(record, 'Stage');
    if (!isActiveOppStage(stage)) continue;
    const account = cell(record, 'Account');
    let via = '';
    if (account && companiesMatch(account, self)) via = 'direct';
    else if (account && ownedNames.some(n => companiesMatch(account, n))) via = 'owned';
    else if (splitPeOwners(cell(record, 'PE Owner')).some(o => companiesMatch(o, self))) via = 'pe';
    else if (account && ownedByPe.some(n => companiesMatch(account, n))) via = 'pe';
    if (!via) continue;
    const owner = via === 'direct' ? '' : (cell(record, 'PE Owner') || self);
    out.push({ record, account, via, owner, rank: activeStageRank(stage) });
  }
  return out
    .sort((a, b) => {
      const da = a.via === 'direct' ? 0 : 1;
      const db = b.via === 'direct' ? 0 : 1;
      if (da !== db) return da - db;
      const byAccount = a.account.localeCompare(b.account, undefined, { sensitivity: 'base' });
      if (byAccount) return byAccount;
      return b.rank - a.rank;
    })
    .map(({ record, account, via, owner }) => ({ record, account, via, owner }));
}

// ---- what one slide says ---------------------------------------------

// The pipeline drawn across the top of each slide, in the order the
// Days-in-Stage board uses. Repricing is a re-quote, so it lights Quoted.
export const DECK_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];

/**
 * One opp as the fields its slide shows. `contactInfo(name, account)`
 * returns { title } for a tagged contact when the caller knows one.
 */
export function oppSlideContent(entry, { contactInfo = () => null } = {}) {
  const r = entry.record || {};
  const account = entry.account || cell(r, 'Account');
  const scope = cell(r, 'Scope');

  const contacts = String(r.Contact ?? '')
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(s => s && s !== '-')
    .map((contactName, i) => ({
      name: contactName,
      title: String(contactInfo(contactName, account)?.title || '').trim(),
      primary: i === 0,
    }));

  // The steps and their Waiting On are index-aligned (see nextSteps.js);
  // textToBulletItems is the same split the Follow Up Notes popup reads
  // them with, so step i here is step i there.
  const waiting = Array.isArray(r._nextStepsWaiting) ? r._nextStepsWaiting : [];
  const hold = Array.isArray(r._nextStepsHold) ? r._nextStepsHold : [];
  const nextSteps = textToBulletItems(r['Next Steps']).map((text, i) => ({
    text: text.replace(/\n+/g, ' '),
    waitingOn: String(waiting[i] || '').trim(),
    onHold: !!hold[i],
  }));
  const legacyWaiting = cell(r, 'Waiting On');
  if (nextSteps.length === 0 && legacyWaiting) {
    nextSteps.push({ text: `Waiting on ${legacyWaiting}`, waitingOn: '', onHold: false });
  }

  // Deal size, type, sales partner and follow-up date are left off the
  // slide on purpose (asked for when the deck was first used).
  const facts = [
    ['Sites', cell(r, 'Sites')],
    ['Target close', cell(r, 'Close Date')],
  ].filter(([, v]) => v);

  return {
    // Titled by the company. The BFO opportunity name is an internal
    // label (business unit, offer codes) and doesn't go on the slide.
    title: account || scope || 'Unnamed opportunity',
    account,
    via: entry.via,
    owner: entry.owner || '',
    stage: cell(r, 'Stage'),
    scopeItems: scope.split(/[,;\n]/).map(s => s.trim()).filter(Boolean),
    contacts,
    nextSteps,
    facts,
  };
}

// ---- OOXML ------------------------------------------------------------

const EMU = 914400;
const emu = (inches) => Math.round(inches * EMU);

// Characters XML 1.0 can't carry at all are dropped rather than escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function xmlEscape(text) {
  return String(text ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// SEAS palette, off the template's colour page.
const C = {
  quartz: '00552E',     // SE Quartz Dark Green
  life: '3DCD58',       // SE Life Green
  quartzGreen: '007A27',
  body: '494B4F',       // the template's body copy
  grey: '626469',       // SE Dark Grey
  lightGrey: '9FA0A4',  // SE Light Grey
  mist: 'F2F2F2',
  mint: 'E3F6E7',
  white: 'FFFFFF',
};

function run(text, { sz = 1100, b = false, i = false, color = C.body } = {}) {
  return `<a:r><a:rPr lang="en-US" sz="${sz}" b="${b ? 1 : 0}" i="${i ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`;
}
const br = (sz = 1100) => `<a:br><a:rPr lang="en-US" sz="${sz}"/></a:br>`;

function para(runs, { bullet = false, algn = 'l', after = 400, sz = 1100 } = {}) {
  const bu = bullet
    ? `<a:buClr><a:srgbClr val="${C.life}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>`
    : '<a:buNone/>';
  const indent = bullet ? ' marL="171450" indent="-171450"' : ' marL="0" indent="0"';
  return `<a:p><a:pPr${indent} algn="${algn}"><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="${after}"/></a:spcAft>${bu}</a:pPr>${runs.join('')}<a:endParaRPr lang="en-US" sz="${sz}"/></a:p>`;
}

function shape(id, name, { x, y, w, h, geom = 'rect', fill = null, line = null, paras = null, anchor = 't', inset = 0, adj = null, textBox = false }) {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>';
  const lineXml = line ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const av = adj != null ? `<a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst>` : '<a:avLst/>';
  const ins = emu(inset);
  const body = paras && paras.length ? paras.join('') : '<a:p><a:endParaRPr lang="en-US"/></a:p>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr${textBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="${geom}">${av}</a:prstGeom>${fillXml}${lineXml}</p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function line(id, name, { x, y, h }) {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="0" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>`
    + `<a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
}

// Rough text-height estimate for picking a font size. Arial's average
// glyph is about half its point size wide; a line is 1.2x the point size.
function linesFor(text, widthIn, sizePt) {
  const perLine = Math.max(8, Math.floor((widthIn * 72) / (sizePt * 0.5)));
  return Math.max(1, Math.ceil(String(text || '').length / perLine));
}
function blockHeight(items, widthIn, sizePt, afterPt) {
  let pts = 0;
  for (const it of items) {
    const lines = it.reduce((n, piece) => n + linesFor(piece.text, widthIn, piece.sz ? piece.sz * sizePt : sizePt), 0);
    pts += lines * sizePt * 1.2 + afterPt;
  }
  return pts / 72;
}

// The largest size, and how many items, that fit a box. Items are arrays
// of { text, sz } pieces (sz a multiplier), each piece its own line.
function fitList(items, widthIn, heightIn, sizes = [11, 10, 9, 8]) {
  for (const sz of sizes) {
    if (blockHeight(items, widthIn, sz, 4) <= heightIn) return { sz, count: items.length };
  }
  const sz = sizes[sizes.length - 1];
  let count = items.length;
  // Leave room for the "+N more" line.
  while (count > 1 && blockHeight(items.slice(0, count), widthIn, sz, 4) > heightIn - 0.22) count -= 1;
  return { sz, count };
}

const TRUNC = 220;
const clip = (s, n = TRUNC) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

// Layout, in inches, on the template's 10 x 5.625 canvas.
const L = {
  left: 0.432,
  width: 9.135,
  subY: 0.80,
  trackY: 1.18,
  trackH: 0.34,
  colY: 1.78,
  pillH: 0.30,
  bodyY: 2.20,
  bodyH: 2.58,
};

function stageTrack(content, nextId) {
  const shapes = [];
  const stage = content.stage;
  const current = stage === 'Repricing' ? 'Quoted' : stage;
  const at = DECK_STAGES.indexOf(current);
  const n = DECK_STAGES.length;
  const overlap = 0.06;
  const w = (L.width + overlap * (n - 1)) / n;
  DECK_STAGES.forEach((s, i) => {
    const done = at >= 0 && i < at;
    const isNow = i === at;
    const fill = isNow ? C.quartz : done ? C.mint : C.mist;
    const color = isNow ? C.white : done ? C.quartz : C.lightGrey;
    const label = isNow && stage !== s ? stage : s;
    shapes.push(shape(nextId(), `Stage ${s}`, {
      x: L.left + i * (w - overlap), y: L.trackY, w, h: L.trackH,
      geom: i === 0 ? 'homePlate' : 'chevron', adj: 30000, fill, anchor: 'ctr',
      paras: [para([run(label, { sz: 850, b: isNow, color })], { algn: 'ctr', after: 0, sz: 850 })],
    }));
  });
  return shapes;
}

function columnPill(id, label, x, w) {
  return shape(id, `${label} header`, {
    x, y: L.colY, w, h: L.pillH, geom: 'roundRect', adj: 50000, fill: C.quartz, anchor: 'ctr',
    paras: [para([run(label, { sz: 1100, b: true, color: C.white })], { algn: 'ctr', after: 0 })],
  });
}

function bodyBox(id, name, x, w, paras) {
  return shape(id, name, { x, y: L.bodyY, w, h: L.bodyH, paras, textBox: true });
}

function moreLine(n, sz, what) {
  return para([run(`+${n} more ${what}`, { sz: sz * 100, i: true, color: C.grey })], { after: 0, sz: sz * 100 });
}

/** The <p:sp> shapes that make up one opp slide's body. */
export function oppSlideShapes(content) {
  let id = 10;
  const nextId = () => { id += 1; return id; };
  const shapes = [];

  // Under the title (the company): who owns it, for a portfolio company.
  if (content.via !== 'direct' && content.owner) {
    const sub = [run(`Owned by ${content.owner}`, { sz: 1200, color: C.grey })];
    shapes.push(shape(nextId(), 'Owner', { x: L.left, y: L.subY, w: L.width, h: 0.28, paras: [para(sub, { after: 0, sz: 1200 })], textBox: true }));
  }

  shapes.push(...stageTrack(content, nextId));
  if (content.stage && !DECK_STAGES.includes(content.stage) && content.stage !== 'Repricing') {
    shapes.push(shape(nextId(), 'Stage note', {
      x: L.left, y: L.trackY + L.trackH + 0.02, w: L.width, h: 0.2, textBox: true,
      paras: [para([run(`Stage: ${content.stage}`, { sz: 900, i: true, color: C.grey })], { after: 0, sz: 900 })],
    }));
  }

  const gap = 0.22;
  const wContacts = 2.55;
  const wScope = 2.55;
  const wNext = L.width - wContacts - wScope - gap * 2;
  const xContacts = L.left;
  const xScope = xContacts + wContacts + gap;
  const xNext = xScope + wScope + gap;
  const textW = (w) => w - 0.05;

  // Contacts: name, then title underneath; the first tagged is primary.
  shapes.push(columnPill(nextId(), 'Contacts', xContacts, wContacts));
  {
    const items = content.contacts.map(c => [{ text: c.name + (c.primary ? ' (primary)' : '') }, ...(c.title ? [{ text: c.title, sz: 0.85 }] : [])]);
    const { sz, count } = fitList(items, textW(wContacts), L.bodyH);
    const paras = content.contacts.slice(0, count).map(c => {
      const runs = [run(c.name, { sz: sz * 100, b: true, color: C.body })];
      if (c.primary && content.contacts.length > 1) runs.push(run('  Primary', { sz: Math.round(sz * 80), b: true, color: C.quartzGreen }));
      if (c.title) runs.push(br(sz * 100), run(clip(c.title, 90), { sz: Math.round(sz * 85), color: C.grey }));
      return para(runs, { after: 500, sz: sz * 100 });
    });
    if (count < content.contacts.length) paras.push(moreLine(content.contacts.length - count, sz, 'on the opp'));
    if (!paras.length) paras.push(para([run('No contacts tagged yet', { sz: 1100, i: true, color: C.lightGrey })]));
    shapes.push(bodyBox(nextId(), 'Contacts', xContacts, wContacts, paras));
  }
  shapes.push(line(nextId(), 'Divider 1', { x: xScope - gap / 2, y: L.colY, h: L.bodyY + L.bodyH - L.colY }));

  // Scope: what is being sold, then the deal's facts.
  shapes.push(columnPill(nextId(), 'Scope', xScope, wScope));
  {
    const scopeItems = content.scopeItems.map(s => clip(s, 120));
    const factItems = content.facts.map(([k, v]) => `${k}: ${clip(v, 80)}`);
    const items = [...scopeItems, ...factItems].map(t => [{ text: t }]);
    const { sz } = fitList(items.length ? items : [[{ text: 'x' }]], textW(wScope) - 0.2, L.bodyH - 0.15);
    const paras = scopeItems.map(s => para([run(s, { sz: sz * 100 })], { bullet: true, after: 300, sz: sz * 100 }));
    if (!paras.length) paras.push(para([run('Scope not set on the opp', { sz: sz * 100, i: true, color: C.lightGrey })]));
    content.facts.forEach(([k, v], i) => {
      paras.push(para([
        run(`${k}: `, { sz: sz * 100, b: true, color: C.quartz }),
        run(clip(v, 80), { sz: sz * 100 }),
      ], { after: 200, sz: sz * 100 }).replace('<a:spcBef><a:spcPts val="0"/>', `<a:spcBef><a:spcPts val="${i === 0 ? 900 : 0}"/>`));
    });
    shapes.push(bodyBox(nextId(), 'Scope', xScope, wScope, paras));
  }
  shapes.push(line(nextId(), 'Divider 2', { x: xNext - gap / 2, y: L.colY, h: L.bodyY + L.bodyH - L.colY }));

  // Next steps: the opp's checklist, each with what it is waiting on.
  shapes.push(columnPill(nextId(), 'Next Steps', xNext, wNext));
  {
    const steps = content.nextSteps.map(s => ({ ...s, text: clip(s.text) }));
    const items = steps.map(s => [{ text: s.text + (s.onHold ? ' (on hold)' : '') }, ...(s.waitingOn ? [{ text: `Waiting on: ${s.waitingOn}`, sz: 0.85 }] : [])]);
    const { sz, count } = fitList(items, textW(wNext) - 0.2, L.bodyH);
    const paras = steps.slice(0, count).map(s => {
      const runs = [run(s.text, { sz: sz * 100 })];
      if (s.onHold) runs.push(run(' (on hold)', { sz: sz * 100, i: true, color: C.grey }));
      if (s.waitingOn) runs.push(br(sz * 100), run(`Waiting on: ${clip(s.waitingOn, 80)}`, { sz: Math.round(sz * 85), i: true, color: C.grey }));
      return para(runs, { bullet: true, after: 400, sz: sz * 100 });
    });
    if (count < steps.length) paras.push(moreLine(steps.length - count, sz, 'in the tracker'));
    if (!paras.length) paras.push(para([run('No next steps recorded', { sz: 1100, i: true, color: C.lightGrey })]));
    shapes.push(bodyBox(nextId(), 'Next Steps', xNext, wNext, paras));
  }

  return shapes.join('');
}

// The at-a-glance table that opens a deck with more than one opp.
const OVERVIEW_ROWS = 9;
function overviewTable(entries) {
  // No Opportunity column: the BFO name is an internal label and stays
  // off the deck, as it does on the opp slides.
  const cols = [
    { label: 'Account', w: 2.4, get: c => c.account },
    { label: 'Stage', w: 1.35, get: c => c.stage },
    { label: 'Scope', w: 5.385, get: c => c.scopeItems.join(', ') },
  ];
  const rowH = 0.32;
  const tc = (text, { head = false, shade = false } = {}) => {
    const fill = head ? C.quartz : shade ? C.mist : C.white;
    const color = head ? C.white : C.body;
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/>${run(clip(String(text || ''), 70), { sz: head ? 1000 : 900, b: head, color })}</a:p></a:txBody>`
      + `<a:tcPr marL="${emu(0.08)}" marR="${emu(0.08)}" marT="${emu(0.04)}" marB="${emu(0.04)}" anchor="ctr">`
      + `<a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:lnB>`
      + `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
  };
  const head = `<a:tr h="${emu(rowH)}">${cols.map(c => tc(c.label, { head: true })).join('')}</a:tr>`;
  const body = entries.map((e, i) => `<a:tr h="${emu(rowH)}">${cols.map(c => tc(c.get(e), { shade: i % 2 === 1 })).join('')}</a:tr>`).join('');
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="20" name="Opportunities table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${emu(L.left)}" y="${emu(1.2)}"/><a:ext cx="${emu(totalW)}" cy="${emu(rowH * (entries.length + 1))}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>`
    + `<a:tblGrid>${cols.map(c => `<a:gridCol w="${emu(c.w)}"/>`).join('')}</a:tblGrid>${head}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function overviewShapes(entries, company, part, parts) {
  const runs = [run(company, { sz: 1200, b: true, color: C.quartz })];
  if (parts > 1) runs.push(run(`   (${part} of ${parts})`, { sz: 1100, color: C.grey }));
  return shape(11, 'Account', {
    x: L.left, y: L.subY, w: L.width, h: 0.28, textBox: true,
    paras: [para(runs, { after: 0, sz: 1200 })],
  }) + overviewTable(entries);
}

// ---- the package --------------------------------------------------------

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

// The cover's title slot is built for two lines at its own size; a longer
// company name steps the size down rather than running into the subtitle.
function coverTitleRun(text) {
  const n = text.length;
  const sz = n <= 14 ? null : n <= 22 ? 3200 : n <= 34 ? 2600 : 2200;
  return `<a:r><a:rPr lang="en-US"${sz ? ` sz="${sz}"` : ''}/><a:t>${xmlEscape(clip(text, 60))}</a:t></a:r>`;
}

function fillContentSlide(proto, title, bodyXml) {
  const sz = title.length > 70 ? 1600 : title.length > 55 ? 1800 : title.length > 42 ? 2000 : null;
  const titleRun = `<a:r><a:rPr lang="en-US"${sz ? ` sz="${sz}"` : ''}/><a:t>${xmlEscape(clip(title, 95))}</a:t></a:r>`;
  return proto
    .replace('<a:r><a:rPr lang="en-US"/><a:t>{{TITLE}}</a:t></a:r>', titleRun)
    .replace('<!--{{BODY}}-->', bodyXml);
}

/**
 * Builds the deck. Returns a Uint8Array of the .pptx.
 *
 *   JSZip       the jszip constructor (passed in so the browser can load it
 *               lazily and Node can hand in its own)
 *   template    the template's bytes
 *   company     shown on the cover
 *   entries     selectDeckOpps output
 *   contactInfo see oppSlideContent
 *   date        the date printed on the cover
 */
export async function buildOppDeck({ JSZip, template, company, entries, contactInfo, date = new Date() }) {
  const zip = await JSZip.loadAsync(template);
  const read = (p) => zip.file(p).async('string');

  const [pres, presRels, types, proto, protoRels, cover] = await Promise.all([
    read('ppt/presentation.xml'),
    read('ppt/_rels/presentation.xml.rels'),
    read('[Content_Types].xml'),
    read('ppt/slides/slide2.xml'),
    read('ppt/slides/_rels/slide2.xml.rels'),
    read('ppt/slides/slide1.xml'),
  ]);

  const contents = entries.map(e => oppSlideContent(e, { contactInfo }));
  const accounts = new Set(contents.map(c => c.account.toLowerCase()).filter(Boolean));
  const when = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const count = `${contents.length} open ${contents.length === 1 ? 'opp' : 'opps'}`;
  const across = accounts.size > 1 ? ` | ${accounts.size} companies` : '';
  zip.file('ppt/slides/slide1.xml', cover
    .replace('<a:r><a:rPr lang="en-US"/><a:t>{{COVER_TITLE}}</a:t></a:r>', coverTitleRun(company))
    .replace('{{COVER_SUBTITLE}}', xmlEscape(`${count}${across} | ${when}`.toUpperCase())));

  // The slides to write, in order: the overview (in pages) then one per opp.
  const slides = [];
  if (contents.length > 1) {
    const parts = Math.ceil(contents.length / OVERVIEW_ROWS);
    for (let p = 0; p < parts; p += 1) {
      const chunk = contents.slice(p * OVERVIEW_ROWS, (p + 1) * OVERVIEW_ROWS);
      slides.push({ title: 'Open opportunities at a glance', body: overviewShapes(chunk, company, p + 1, parts) });
    }
  }
  for (const c of contents) slides.push({ title: c.title, body: oppSlideShapes(c) });

  // Register each as slide4.xml onward; the prototype (slide2) goes.
  let maxRid = Math.max(0, ...[...presRels.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])));
  let maxSldId = Math.max(256, ...[...pres.matchAll(/<p:sldId id="(\d+)"/g)].map(m => Number(m[1])));
  const protoRid = presRels.match(/Id="(rId\d+)"[^>]*Target="slides\/slide2\.xml"/)?.[1]
    || presRels.match(/Target="slides\/slide2\.xml"[^>]*Id="(rId\d+)"/)?.[1];
  let newRels = '';
  let newTypes = '';
  let newIds = '';
  slides.forEach((s, i) => {
    const n = i + 4;
    zip.file(`ppt/slides/slide${n}.xml`, fillContentSlide(proto, s.title, s.body));
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, protoRels);
    maxRid += 1;
    maxSldId += 1;
    newRels += `<Relationship Id="rId${maxRid}" Type="${SLIDE_REL}" Target="slides/slide${n}.xml"/>`;
    newTypes += `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${SLIDE_CT}"/>`;
    newIds += `<p:sldId id="${maxSldId}" r:id="rId${maxRid}"/>`;
  });

  const protoIdRe = new RegExp(`<p:sldId id="\\d+" r:id="${protoRid}"/>`);
  zip.file('ppt/presentation.xml', pres.replace(protoIdRe, newIds));
  zip.file('ppt/_rels/presentation.xml.rels', presRels
    .replace(/<Relationship [^>]*Target="slides\/slide2\.xml"[^>]*\/>/, '')
    .replace('</Relationships>', `${newRels}</Relationships>`));
  zip.file('[Content_Types].xml', types
    .replace(/<Override PartName="\/ppt\/slides\/slide2\.xml"[^>]*\/>/, '')
    .replace('</Types>', `${newTypes}</Types>`));
  zip.remove('ppt/slides/slide2.xml');
  zip.remove('ppt/slides/_rels/slide2.xml.rels');

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** A filename for the deck: "Acme Corp - Opps 2026-10-22.pptx", made safe. */
export function oppDeckFilename(company, date = new Date()) {
  const safe = String(company || 'Company').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Company';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${safe} - Opps ${y}-${m}-${d}.pptx`;
}
