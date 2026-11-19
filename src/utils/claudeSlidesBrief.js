// What Claude is told about a timeline when it builds the deck: the same
// placement the app's own chart draws (month columns after dependencies and
// the contract run-up, the window, where today and contract signature
// fall), written out as plain text, so Claude can rebuild that chart as
// native, editable slide shapes. Pure, so it is tested under plain Node
// (scripts/claudeSlides.test.mjs).
import {
  formatStepDuration, resolveMonthWindow, placeStages, placementBaseMonth,
  applyRunUpShift, stagesOutsideWindow, anchorPlus, todayMonthOffset,
} from './timelineDates.js';

const line = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The three workstreams the slide colours by.
export const WORKSTREAM_OF = { Client: 'Client', 'Schneider Electric': 'SE', Both: 'Both' };

export function buildTimelineBrief(template, { now = new Date() } = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const out = [`Title: ${line(template?.name) || 'Timeline'}`];
  if (line(template?.subtitle)) out.push(`Subtitle: ${line(template.subtitle)}`);
  const services = (template?.services || []).map(line).filter(Boolean);
  if (services.length) out.push(`Services: ${services.join(', ')}`);
  const clientName = line(template?.clientName);
  out.push(`Client workstream label: ${clientName ? `${clientName} workstream` : 'Client workstream'}`);
  if (!stages.length) { out.push('', '(no stages yet)'); return out.join('\n'); }

  // Placement, step for step as buildPhasedSvg does it.
  const mode = template?.positionMode === 'months' ? 'months' : 'dates';
  const baseMonth = placementBaseMonth(template, stages);
  const raw = placeStages(stages, baseMonth, mode).map((pos, i) => ({ stage: stages[i], ...pos }));
  const statedSignature = Math.floor(Number(template?.signatureMonth) || 0);
  const { preSpan, placed } = applyRunUpShift(raw, statedSignature, mode);
  const needed = Math.max(...placed.map(p => p.month + p.span - 1), 1);
  const signatureCol = statedSignature > 0 ? statedSignature : (preSpan > 0 ? preSpan + 1 : null);
  const win = resolveMonthWindow(template, needed);
  const monthCount = win.monthCount;
  const calendar = (win.calendar || win.fromRange) && !!win.anchor;
  const hidden = new Set(stagesOutsideWindow(template, { baseMonth, mode, monthCount }));

  // Column n's heading: the calendar month, the year on the first column
  // and on each January, else "Month n".
  const colLabel = (n, withYear = false) => {
    if (!calendar) return `Month ${n}`;
    const d = anchorPlus(win.anchor, n - 1);
    if (!d) return `Month ${n}`;
    return `${MONTHS[d.m - 1]}${withYear || n === 1 || d.m === 1 ? ` ${d.y}` : ''}`;
  };
  const short = (n) => (calendar ? colLabel(n).split(' ')[0] : `Month ${n}`);
  const heads = Array.from({ length: monthCount }, (_, i) => colLabel(i + 1));
  out.push(`Month columns (${monthCount}, left to right): ${heads.join(' | ')}`);
  if (calendar) out.push(`Window: ${colLabel(1, true)} to ${colLabel(monthCount, true)}`);

  if (signatureCol && signatureCol <= monthCount) {
    const label = line(template?.signatureLabel) || 'Contract signature';
    out.push(`Marker "${label}": a dashed vertical line at the start of column ${signatureCol} (${colLabel(signatureCol, true)}).`);
  }
  if (calendar) {
    const offset = todayMonthOffset(win.anchor, monthCount);
    if (offset != null) {
      const col = Math.floor(offset) + 1;
      const pct = Math.round((offset - Math.floor(offset)) * 100);
      out.push(`Marker "Today, ${MONTHS[now.getMonth()]} ${now.getDate()}": a vertical line ${pct}% of the way through column ${col} (${colLabel(col, true)}).`);
    }
  }

  out.push('', 'Steps, numbered in this order (row order on the chart):');
  let n = 0;
  let lastPhase = '';
  for (const p of placed) {
    const st = p.stage;
    if (hidden.has(st)) continue;
    n += 1;
    const phase = line(st.phase);
    if (phase && phase !== lastPhase) out.push(`Phase: ${phase}`);
    lastPhase = phase;
    const end = p.month + p.span - 1;
    const where = p.span > 1 ? `columns ${p.month} to ${end}` : `column ${p.month}`;
    const auto = p.span > 1 ? `${short(p.month)} to ${short(end)}` : short(p.month);
    const bits = [
      `${n}. ${line(st.name) || 'Untitled step'}`,
      `workstream: ${WORKSTREAM_OF[st.owner] || 'SE'}`,
      `bar: ${where}`,
      `bar label: "${line(st.timing) || auto}"`,
    ];
    if (st.kind === 'milestone') bits.push('milestone (a diamond, not a bar)');
    const dur = formatStepDuration(st.duration, st.durationUnit);
    if (dur) bits.push(`duration: ${dur}`);
    if (st.preKickoff) bits.push('before contract signature');
    out.push(bits.join(' | '));
    if (line(st.description)) out.push(`   Detail: ${line(st.description)}`);
  }
  if (hidden.size) out.push(`(${hidden.size} step${hidden.size === 1 ? '' : 's'} outside the window left off, as on the app's chart.)`);
  return out.join('\n');
}
