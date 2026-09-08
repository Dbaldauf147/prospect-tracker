// The rules that make the Weekly Report email render in Outlook. Plain Node
// — no test framework (the project has none). Run:
//   node scripts/weeklyReportEmailHtml.test.mjs
//
// What the email *says* is pinned in weeklyReportSchedule.test.mjs, next to
// the snapshot builder that feeds it. This file pins how it is built, which
// is a separate question with a separate failure mode: Outlook on Windows
// lays HTML out with Word's engine, and Word ignores `max-width` (the report
// stretched the width of the reading pane), drops margins on inline elements
// (the status chip collided with its number — "36.6%Behind pace"), knows
// nothing of flex or grid, and paints a broken-image placeholder when it
// meets the `background:` shorthand.
//
// None of that shows up in a browser, so a change that reintroduces one
// looks right in the tab's "Preview email" and only breaks in the inbox.
// These assertions are what stands between that and a Monday-morning send.

import { renderWeeklyReportHtml } from '../api/_lib/weeklyReportEmailHtml.js';
import { funnelAttachment } from '../api/_lib/weeklyReportEmail.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const PNG = `data:image/png;base64,${'iVBORw0KGgo='.repeat(4)}`;

const snapshot = {
  capturedAt: Date.parse('2026-09-07T05:02:00Z'),
  scope: 'week',
  periodLabel: 'Mon, Aug 31 – Sun, Sep 6, 2026',
  kpiNote: 'Year to date — not scoped to the week picker',
  kpiCards: [
    { label: 'Progress to target', value: '36.6%', status: 'behind', chip: 'Behind pace', lines: ['$484,616 sold of $1,325,000'] },
    { label: 'Coverage ratio', value: '1.73×', status: 'ahead', chip: 'At goal', lines: [] },
  ],
  funnel: {
    caption: 'Band height = pipeline value.',
    stages: [{ label: 'Stage 3', count: 3, amount: '$402,000', life: '120 days', closeRate: '25%' }],
    outcome: { soldLabel: 'Closed YTD', sold: '$485K', weighted: '$349K', total: '$833K' },
  },
  tiles: [{ label: 'Emails sent', value: 27, goal: 50, accent: 'blue' }],
  oppChanges: { newOpps: ['Acme: HQ retrofit (Discovery)'] },
  goals: { active: ['#1 Close Berkshire'] },
  funnelImage: { src: PNG, width: 1600, height: 349, alt: 'Pipeline funnel: bands by stage' },
  narrative: '## Summary\nTwo new opps landed.',
};

const html = renderWeeklyReportHtml(snapshot, { message: 'Read the funnel first.' });

// Word ignores max-width, so the content column has to be a real fixed-width
// table inside an mso conditional. Without it the report is as wide as the
// window, which is how this looked in Outlook before.
check('the column width comes from an mso conditional table',
  /<!--\[if mso\]>\s*<table[^>]*width="800"/.test(html), true);
check('the mso conditional is closed',
  html.includes('<!--[if mso]></td></tr></table><![endif]-->'), true);

// The shorthand is what makes Outlook paint a broken-image placeholder where
// a plain colour was meant.
check('no background shorthand anywhere', /background:\s*(?!none)/.test(html), false);

// Word drops negative margins, and flex and grid do not exist for it at all.
check('no negative margins', /margin:[^";]*-\d/.test(html), false);
check('no flex or grid layout', /display:\s*(flex|grid)/.test(html), false);

// Padding and margin on a <span> are dropped, so anything that has to stand
// apart from its neighbour gets its own cell. The chip beside a KPI value and
// the note beside a section heading are the two that broke before.
check('the status chip sits in its own cell',
  /<td[^>]*bgcolor="#FEF3C7"[^>]*>Behind pace<\/td>/.test(html), true);
check('the heading note sits in its own cell',
  /class="hnote"[^>]*>Year to date/.test(html), true);

// Layout tables must be inert to a screen reader and must not inherit the
// cell spacing Word otherwise applies.
const tables = html.match(/<table[^>]*>/g) || [];
check('every table is a presentation table with no spacing',
  tables.every(t => t.includes('role="presentation"') && t.includes('cellspacing="0"') && t.includes('cellpadding="0"')),
  true);

// Bars are drawn as table cells with a bgcolor — never as a coloured div
// alone, and never as a picture, which a client can refuse to load.
check('a progress bar is a bgcolor cell sized both ways',
  /width="54%" bgcolor="#3B82F6"[^>]*width:54%/.test(html), true);
check('a funnel bar uses the chart’s own stage colour',
  html.includes('bgcolor="#104281"'), true);

// ---- The funnel picture ---------------------------------------------------
// The one image in the report, and it is never fetched from anywhere: a
// sent message points it at its own attachment, and the tab's preview at
// the data URL in the snapshot. A remote image would be blocked by default
// in both Outlook and Gmail, which is the whole reason for the attachment.
check('no picture asked for → no img at all', /<img\b/.test(html), false);
check('no picture → the stage rows keep their bars',
  html.includes('bgcolor="#104281"'), true);

const withPicture = renderWeeklyReportHtml(snapshot, { funnelImageSrc: 'cid:funnel@x' });
check('the funnel img points at the attachment',
  /<img src="cid:funnel@x" width="770"/.test(withPicture), true);
check('the img is sized in CSS as well, for everything that is not Word',
  /max-width:770px;height:auto/.test(withPicture), true);
check('the img carries the chart’s own screen-reader label',
  withPicture.includes('alt="Pipeline funnel: bands by stage"'), true);
check('it is still the only image', (withPicture.match(/<img\b/g) || []).length, 1);
check('nothing is loaded over the network', /src="https?:/.test(withPicture), false);

// The picture draws the bands, so the rows beside it are figures, not a
// second chart. The outcome block stays in text either way: it is the
// projected total, and a reader whose client hides the picture needs it.
check('a drawn funnel drops the duplicate bar column',
  withPicture.includes('bgcolor="#104281"'), false);
check('a drawn funnel keeps the stage figures', withPicture.includes('$402,000'), true);
check('the projected total is readable text under the picture',
  withPicture.includes('= projected total') && withPicture.includes('$833K'), true);

// The bytes the message carries. Only base64 PNG makes it this far — the
// snapshot builder rejects anything else — and the mailer turns it back
// into an attachment rather than leaving a data: URL in the markup, which
// most clients strip.
{
  const att = funnelAttachment(snapshot);
  check('the picture becomes a cid attachment', att.cid, 'weekly-report-funnel@prospect-tracker');
  check('it is attached as a PNG', att.contentType, 'image/png');
  check('it is decoded, not left as a data URL', Buffer.isBuffer(att.content), true);
  check('no picture in the snapshot → nothing to attach',
    funnelAttachment({ ...snapshot, funnelImage: null }), null);
}

// Percentage column widths are set as attributes as well as CSS: Word reads
// the attribute and ignores the declaration.
check('card columns carry a width attribute', /<td class="col" width="50%"/.test(html), true);

// Gutters and stacking are the two things the phone layout needs, and both
// hang off classes in the <head> block.
check('a stacking rule exists for narrow clients',
  /@media only screen and \(max-width:620px\)/.test(html), true);
check('gutter cells are addressable by that rule', html.includes('class="gut"'), true);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
