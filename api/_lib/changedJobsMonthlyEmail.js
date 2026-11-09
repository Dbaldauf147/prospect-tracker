// The monthly Changed Jobs email's subject and HTML, from the report
// src/utils/changedJobsMonthly.js builds. Table-based, inline-styled markup
// like the other report emails so Outlook and Gmail draw it the same. No em
// dashes anywhere (CLAUDE.md).

const INK = '#1E2A36';
const MUTED = '#8896A6';
const BORDER = '#E2E8F0';
const PAGE_BG = '#F4F6F9';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export function changedJobsMonthlySubject(report) {
  const { total, notReachedOut } = report.totals;
  return `Changed Jobs, ${report.month.label}: ${total} contact${total === 1 ? '' : 's'}, ${notReachedOut} not reached out`;
}

export function renderChangedJobsMonthlyHtml(report, { appUrl = '' } = {}) {
  const { rows, totals } = report;
  const th = (l) => `<th style="padding:0 8px 6px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${BORDER};white-space:nowrap">${esc(l)}</th>`;
  const td = (h, extra = '') => `<td style="padding:6px 8px;vertical-align:top;border-bottom:1px solid #F0F3F7;${extra}">${h}</td>`;
  const body = rows.map(r => `<tr>${[
    td(`<strong>${esc(r.name)}</strong>${r.title ? `<div style="color:${MUTED};font-size:11px">${esc(r.title)}</div>` : ''}`),
    td(esc(r.previousCompany) || `<span style="color:${MUTED}">-</span>`),
    td(esc(r.newCompany) || `<span style="color:${MUTED}">Not mapped</span>`),
    td(r.email ? `<a href="mailto:${esc(r.email)}" style="color:#1D4ED8;text-decoration:none">${esc(r.email)}</a>` : `<span style="color:${MUTED}">-</span>`),
    td(r.linkedin ? `<a href="${esc(r.linkedin)}" style="color:#1D4ED8;text-decoration:none">LinkedIn</a>` : `<span style="color:${MUTED}">-</span>`),
    td(r.reachedOut
      ? `<span style="color:#047857;font-weight:700">Yes</span>${r.reachedOutAt ? `<div style="color:${MUTED};font-size:11px">${esc(fmtDate(r.reachedOutAt))}</div>` : ''}`
      : '<span style="color:#B45309;font-weight:700">Not yet</span>', 'white-space:nowrap'),
  ].join('')}</tr>`).join('');
  const table = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:${FONT};font-size:12px;color:${INK}"><tr>${['Name', 'Previous company', 'New company', 'Email', 'LinkedIn', 'Reached out'].map(th).join('')}</tr>${body}</table>`
    : `<div style="font-family:${FONT};font-size:13px;color:${MUTED}">Nobody outside Schneider Electric is on the Changed Jobs page right now.</div>`;
  const summary = `${totals.total} contact${totals.total === 1 ? '' : 's'} who left for an outside company: ${totals.notReachedOut} not reached out yet, ${totals.reachedOut} reached out.`
    + (totals.hidden ? ` ${totals.hidden} hidden from the page ${totals.hidden === 1 ? 'is' : 'are'} left out.` : '')
    + (totals.snoozed ? ` ${totals.snoozed} snoozed ${totals.snoozed === 1 ? 'contact is' : 'contacts are'} left out until ${totals.snoozed === 1 ? 'their snooze runs' : 'their snoozes run'} out.` : '');
  const link = appUrl ? `<div style="margin-top:12px;font-family:${FONT};font-size:12px"><a href="${esc(appUrl)}" style="color:#1D4ED8">Open the Changed Jobs page</a></div>` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${PAGE_BG}">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:960px;margin:0 auto;border-collapse:separate;background:#fff;border:1px solid ${BORDER};border-radius:8px"><tr><td style="padding:18px 20px">`
    + `<div style="font-family:${FONT};font-size:18px;font-weight:700;color:${INK}">Changed Jobs, ${esc(report.month.label)}</div>`
    + `<div style="margin:4px 0 14px;font-family:${FONT};font-size:12px;color:${MUTED}">${esc(summary)} Former Schneider Electric coworkers are on their own subtab and not included.</div>`
    + table + link
    + '</td></tr></table></body></html>';
}
