// Renders a Weekly Report snapshot into an HTML email and sends it.
//
// The report's numbers are computed in the browser, off caches that only
// exist there (the HubSpot activity cache, the Opps 2 and pipeline
// IndexedDB stores, the YOY pins). Rather than reimplement all of that
// server-side — a second copy of the same arithmetic, free to drift from
// what the user actually sees — the Weekly Report tab publishes a snapshot
// of what it rendered, and this module mails that back.
//
// The trade is freshness: a snapshot is only as current as the last time
// the tab was open, so every email states when it was captured and says so
// plainly when that predates the end of the period it covers.

import { sendEmail } from './mailer.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Status colours match the on-screen chips: green when the number is where
// it should be, amber when it isn't, grey when there is nothing to judge.
const STATUS = {
  ahead: { chip: '#065F46', chipBg: '#D1FAE5', rule: '#10B981' },
  behind: { chip: '#92400E', chipBg: '#FEF3C7', rule: '#F59E0B' },
  none: { chip: '#475569', chipBg: '#F1F5F9', rule: '#CBD5E1' },
};
const statusOf = (s) => STATUS[s] || STATUS.none;

function kpiCardHtml(card) {
  const c = statusOf(card.status);
  const lines = (card.lines || []).map(
    l => `<div style="color:#64748B;font-size:12px;line-height:1.5">${esc(l)}</div>`
  ).join('');
  const chip = card.chip
    ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;background:${c.chipBg};color:${c.chip};font-size:11px;font-weight:700;vertical-align:middle">${esc(card.chip)}</span>`
    : '';
  return `
    <td style="padding:0 6px;vertical-align:top;width:33.3%">
      <div style="border:1px solid #E2E8F0;border-top:3px solid ${c.rule};border-radius:8px;padding:12px 14px">
        <div style="color:#64748B;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(card.label)}</div>
        <div style="margin:4px 0 6px">
          <span style="font-size:26px;font-weight:800;color:#0F172A;vertical-align:middle">${esc(card.value)}</span>${chip}
        </div>
        ${lines}
      </div>
    </td>`;
}

// A tile with a weekly target draws the same bar the app does; one without
// just states the count. `sub` is the tab's provenance note ("recorded
// Sep 3") — a number the live feed can no longer answer for says where it
// came from here too, or the reader is left to wonder why it disagrees
// with what they did this morning.
function tileHtml(tile) {
  const value = Number(tile.value) || 0;
  const goal = Number(tile.goal) || 0;
  let bar = '';
  if (goal > 0) {
    const pct = Math.min(100, Math.round((value / goal) * 100));
    const fill = value >= goal ? '#10B981' : '#3B82F6';
    bar = `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px">
        <tr>
          <td style="width:100%;padding-right:6px">
            <div style="height:5px;border-radius:3px;background:#E2E8F0">
              <div style="height:5px;width:${pct}%;border-radius:3px;background:${fill}"></div>
            </div>
          </td>
          <td style="white-space:nowrap;color:#64748B;font-size:11px;font-weight:700">/${goal}</td>
        </tr>
      </table>`;
  }
  return `
    <td style="padding:0 6px;vertical-align:top;width:50%">
      <div style="border:1px solid #E2E8F0;border-left:3px solid ${tile.accent === 'green' ? '#10B981' : '#3B82F6'};border-radius:8px;padding:12px 14px">
        <div style="font-size:24px;font-weight:800;color:#0F172A;line-height:1.1">${esc(value)}</div>
        <div style="margin-top:2px;color:#64748B;font-size:11px;font-weight:700">${esc(tile.label)}</div>
        ${tile.sub ? `<div style="margin-top:2px;color:#94A3B8;font-size:11px">${esc(tile.sub)}</div>` : ''}
        ${bar}
      </div>
    </td>`;
}

function changeListHtml(title, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lis = items.slice(0, 25).map(
    it => `<li style="margin:2px 0;color:#334155;font-size:13px">${esc(it)}</li>`
  ).join('');
  const more = items.length > 25
    ? `<li style="margin:2px 0;color:#94A3B8;font-size:12px">…and ${items.length - 25} more</li>`
    : '';
  return `
    <div style="margin-top:14px">
      <div style="color:#0F172A;font-size:12px;font-weight:700">
        ${esc(title)} <span style="color:#94A3B8;font-weight:600">${items.length}</span>
      </div>
      <ul style="margin:4px 0 0;padding-left:18px">${lis}${more}</ul>
    </div>`;
}

// A section heading, with the tab's note beside it where there is one.
function headingHtml(title, note, margin = '22px 0 8px') {
  const hint = note
    ? `<span style="color:#94A3B8;font-size:11px;font-weight:600;padding-left:8px">${esc(note)}</span>`
    : '';
  return `<div style="margin:${margin};color:#0F172A;font-size:14px;font-weight:700">${esc(title)}${hint}</div>`;
}

// The funnel, as a table.
//
// On the tab this is a drawn chart — band height for pipeline value,
// segment length for how long deals sit in a stage. An email can't carry
// that: inline SVG doesn't render in Outlook at all, and a rasterised
// chart would be blocked as a remote image. So the same stage-by-stage
// figures are laid out as rows, followed by the outcome block that hangs
// off the funnel's exit arrow — closed, plus what the open pipeline
// weights to, and the projected total those add up to.
function funnelHtml(funnel) {
  const stages = Array.isArray(funnel?.stages) ? funnel.stages : [];
  if (!stages.length) return '';
  const th = (label, align = 'left') =>
    `<th style="padding:4px 8px;text-align:${align};color:#64748B;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid #E2E8F0">${esc(label)}</th>`;
  const td = (v, align = 'left', strong = false) =>
    `<td style="padding:6px 8px;text-align:${align};color:${strong ? '#0F172A' : '#334155'};font-size:12px;font-weight:${strong ? 700 : 400};border-bottom:1px solid #F1F5F9">${esc(v ?? '-')}</td>`;

  const rows = stages.map(st => `<tr>
        ${td(st.label, 'left', true)}
        ${td(Number(st.count) || 0, 'right')}
        ${td(st.amount, 'right')}
        ${td(st.life, 'right')}
        ${td(st.closeRate, 'right')}
      </tr>`).join('');

  const o = funnel.outcome;
  const outRow = (label, value, strong) => `<tr>
        <td style="padding:3px 0;color:${strong ? '#0F172A' : '#64748B'};font-size:12px;font-weight:${strong ? 700 : 400}">${esc(label)}</td>
        <td style="padding:3px 0;text-align:right;color:#0F172A;font-size:${strong ? 14 : 12.5}px;font-weight:${strong ? 700 : 600}">${esc(value ?? '-')}</td>
      </tr>`;
  const outcome = o ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:320px;margin:12px 0 0">
      ${outRow(o.soldLabel || 'Closed YTD', o.sold, true)}
      ${outRow('+ weighted pipeline', o.weighted, false)}
      <tr><td colspan="2" style="padding:0"><div style="border-top:1px solid #E2E8F0;height:1px;font-size:0">&nbsp;</div></td></tr>
      ${outRow('= projected total', o.total, true)}
      ${o.note ? `<tr><td colspan="2" style="padding:2px 0 0;text-align:right;color:#94A3B8;font-size:11px">${esc(o.note)}</td></tr>` : ''}
    </table>` : '';

  return `
    <div style="border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px">
      ${funnel.caption ? `<div style="color:#64748B;font-size:11px;line-height:1.5;margin-bottom:8px">${esc(funnel.caption)}</div>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        <tr>${th('Stage')}${th('Opps', 'right')}${th('Pipeline', 'right')}${th('Avg life', 'right')}${th('Close rate', 'right')}</tr>
        ${rows}
      </table>
      ${outcome}
    </div>`;
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
  const closeList = () => { if (list) { out.push(`<ul style="margin:4px 0 0;padding-left:18px">${list.join('')}</ul>`); list = null; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<div style="margin:12px 0 2px;color:#0F172A;font-size:13px;font-weight:700">${bold(h[2])}</div>`);
      continue;
    }
    const b = line.match(/^[-*•]\s+(.*)$/);
    if (b) {
      if (!list) list = [];
      list.push(`<li style="margin:2px 0;color:#334155;font-size:13px;line-height:1.55">${bold(b[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="margin:6px 0;color:#334155;font-size:13px;line-height:1.55">${bold(line)}</p>`);
  }
  closeList();
  return out.join('');
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
    ? `<p style="margin:0 0 14px;color:#334155;font-size:13px;line-height:1.55;white-space:pre-wrap">${esc(message)}</p>`
    : '';

  const kpiRow = cards.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 -6px 4px"><tr>${cards.map(kpiCardHtml).join('')}</tr></table>`
    : `<div style="color:#94A3B8;font-size:13px">No chart data was cached when this snapshot was taken.</div>`;

  const tileRow = tiles.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 -6px"><tr>${tiles.map(tileHtml).join('')}</tr></table>`
    : '';

  const funnel = funnelHtml(s.funnel);

  const goals = [
    changeListHtml(`Goals set this ${periodWord}`, gl.created),
    changeListHtml('Goals completed / closed', gl.completed),
    changeListHtml('Active goals', gl.active),
  ].join('');

  const changes = [
    changeListHtml('Deals closed', oc.closed),
    changeListHtml('New opps', oc.newOpps),
    changeListHtml('Stage changes', oc.stageChanges),
    changeListHtml('Close-date moves', oc.closeDateMoves),
    changeListHtml('Amount updates', oc.amountUpdates),
    changeListHtml('BFO Opportunity Names tagged', oc.bfoTags),
  ].join('');

  const narrative = narrativeHtml(s.narrative);

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8FAFC">
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px">
  <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:20px 22px">
    <div style="font-size:20px;font-weight:800;color:#0F172A">Weekly Report</div>
    <div style="margin-top:2px;color:#64748B;font-size:13px">${esc(s.periodLabel || '')}</div>
    <div style="margin-top:6px;color:${fresh.stale ? '#92400E' : '#94A3B8'};font-size:11px">${esc(fresh.text)}</div>

    <div style="margin-top:18px">${intro}</div>

    ${headingHtml('Where the year stands', s.kpiNote, '0 0 8px')}
    ${kpiRow}

    ${funnel ? `${headingHtml('Pipeline funnel', 'The Charts → Pipeline funnel, off the same cached numbers')}${funnel}` : ''}

    ${tileRow ? `<div style="color:#0F172A;font-size:14px;font-weight:700;margin:20px 0 8px">This period</div>${tileRow}` : ''}

    ${changes ? `<div style="color:#0F172A;font-size:14px;font-weight:700;margin:22px 0 0">Opportunity changes</div>${changes}` : ''}

    ${goals ? `<div style="color:#0F172A;font-size:14px;font-weight:700;margin:22px 0 0">Goals</div>${goals}` : ''}

    ${narrative ? `<div style="margin:22px 0 0;padding-top:14px;border-top:1px solid #E2E8F0">${narrative}</div>` : ''}

    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px">
      Sent from Prospect Tracker · Charts → Weekly Report
    </div>
  </div>
</div>
</body></html>`;
}

export async function sendWeeklyReportEmail({ to, subject, message, snapshot, replyTo }) {
  const html = renderWeeklyReportHtml(snapshot, { message });
  const label = snapshot?.periodLabel ? ` — ${snapshot.periodLabel}` : '';
  return sendEmail({
    to,
    subject: String(subject || `Weekly Report${label}`).slice(0, 300),
    html,
    replyTo,
  });
}
