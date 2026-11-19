// What Claude is told about a timeline when it builds the deck: a plain-text
// brief of the same stages the graphic draws. Pure, so it is tested under
// plain Node (scripts/claudeSlides.test.mjs).
import { getStageRange, formatStepDuration, resolveMonthWindow, describeMonthWindow } from './timelineDates.js';

const line = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function buildTimelineBrief(template) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const out = [`Title: ${line(template?.name) || 'Timeline'}`];
  if (line(template?.subtitle)) out.push(`Subtitle: ${line(template.subtitle)}`);
  const services = (template?.services || []).map(line).filter(Boolean);
  if (services.length) out.push(`Services: ${services.join(', ')}`);
  let span = '';
  try {
    const w = resolveMonthWindow(template, null);
    span = describeMonthWindow(w.anchor, w.monthCount);
  } catch { span = ''; }
  if (span) out.push(`Timeline window: ${line(span)}`);
  out.push('', 'Stages, in order:');
  stages.forEach((st, i) => {
    const bits = [`${i + 1}. ${line(st.name) || 'Untitled stage'}`];
    if (st.owner) bits.push(`owner: ${line(st.owner)}`);
    if (st.kind === 'milestone') bits.push('milestone');
    const range = getStageRange(st);
    if (range) bits.push(range.milestone ? `date: ${range.start}` : `dates: ${range.start} to ${range.end}`);
    else if (st.timing) bits.push(`timing: ${line(st.timing)}`);
    const dur = formatStepDuration(st.duration, st.durationUnit);
    if (dur) bits.push(`duration: ${dur}`);
    if (st.preKickoff) bits.push('before kickoff');
    out.push(bits.join(' | '));
    if (st.description) out.push(`   ${line(st.description)}`);
  });
  if (!stages.length) out.push('(no stages yet)');
  return out.join('\n');
}
