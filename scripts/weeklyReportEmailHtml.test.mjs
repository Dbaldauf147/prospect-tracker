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
  kpiCards: [
    { label: 'Progress to target', value: '36.6%', status: 'behind', chip: 'Behind pace', lines: ['$484,616 sold of $1,325,000'] },
    { label: 'Coverage ratio', value: '1.73×', status: 'ahead', chip: 'At goal', lines: [] },
  ],
  funnel: {
    stages: [{ label: 'Stage 3', count: 3, amount: '$402,000', life: '120 days', closeRate: '25%' }],
    outcome: { soldLabel: 'Closed YTD', sold: '$485K', weighted: '$349K', total: '$833K' },
  },
  closeRateTrend: {
    months: ['Apr', 'May', 'Jun'],
    rows: [
      {
        label: 'Stage 5: Prepare & Bid', stage: 5,
        cells: [{ rate: '17%', count: '1/6' }, null, { rate: '100%', count: '2/2' }],
        overall: { rate: '44%', count: '7/16', ahead: 25 },
        rolling12: { rate: '19%', count: '9/47' },
      },
      {
        label: 'All closed opps', stage: null,
        cells: [{ rate: '8%', count: '1/13' }, null, { rate: '13%', count: '2/15' }],
        overall: { rate: '10%', count: '7/68', ahead: null },
        rolling12: { rate: '5%', count: '9/176' },
      },
    ],
  },
  trends: {
    emailsByWeek: [
      { key: '2026-08-03', label: 'Aug 3', value: 31, recorded: true },
      { key: '2026-08-10', label: 'Aug 10', value: null, recorded: false },
      { key: '2026-08-17', label: 'Aug 17', value: 44, recorded: true },
      { key: '2026-08-24', label: 'Aug 24', value: 18, recorded: true },
      { key: '2026-08-31', label: 'Aug 31', value: 27, recorded: false },
    ],
    newOppsByMonth: [
      { key: '2026-05', label: 'May', value: 4, recorded: false },
      { key: '2026-06', label: 'Jun', value: 2, recorded: false },
      { key: '2026-07', label: 'Jul', value: 6, recorded: false },
      { key: '2026-08', label: 'Aug', value: 3, recorded: false },
      { key: '2026-09', label: 'Sep', value: 1, recorded: false },
    ],
  },
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
  /class="hnote"[^>]*>Last 3 months/.test(html), true);
// The period the report covers reads beside the title, not under it, and so
// needs the same treatment.
check('the period label sits beside the title, in its own cell',
  /Weekly Report<\/td>\s*<td class="hnote"[^>]*>Mon, Aug 31/.test(html), true);

// Layout tables must be inert to a screen reader and must not inherit the
// cell spacing Word otherwise applies.
const tables = html.match(/<table[^>]*>/g) || [];
check('every table is a presentation table with no spacing',
  tables.every(t => t.includes('role="presentation"') && t.includes('cellspacing="0"') && t.includes('cellpadding="0"')),
  true);

// Bars are drawn as table cells with a bgcolor - never as a coloured div
// alone, and never as a picture, which a client can refuse to load.
//
// The tallest bar in a series is the scale: 44 emails is the max, so it is
// the 100% bar and 18 is scaled against it, not against a 0–50 axis that
// would render five near-identical stubs.
// Every width is a pixel count stated in an attribute as well as in CSS:
// Word will not resolve a percentage width on a table nested in a cell, so
// a bar sized that way collapses to its content and the series arrives in
// Outlook as a column of ticks rather than a row of bars.
check('a trend bar is a bgcolor cell sized both ways',
  /<td width="230" height="14" bgcolor="#7C8B9D"[^>]*width:230px/.test(html), true);
check('bars scale to the series max, not to a fixed axis',
  /<td width="94" height="14" bgcolor="#7C8B9D"/.test(html), true);
check('no bar is sized as a share of the cell it sits in',
  /width="\d+%"[^>]*bgcolor="(#7C8B9D|#2a78d6|#0E9F6E|#104281|#1c5cab)"/.test(html), false);
// Emphasis: the period this report covers wears the accent, the history
// behind it wears the de-emphasis grey.
check('the current period carries the accent colour',
  /<td width="141" height="14" bgcolor="#2a78d6"/.test(html), true);
check('the current month carries the opps accent',
  /bgcolor="#0E9F6E"/.test(html), true);
check('a funnel bar uses the chart’s own stage colour',
  html.includes('bgcolor="#104281"'), true);
// The stage bars are a fixed column too, and the one column in the report
// that is decoration rather than figures - so it is also the one a phone
// drops, rather than carrying a 260px column no phone has room for.
check('a funnel bar is sized in pixels like the trend bars',
  /<td width="\d+" height="12" bgcolor="#104281"/.test(html), true);
check('the stage-bar column is droppable on a narrow client',
  /\.sbar \{ display:none/.test(html) && /<td class="sbar"/.test(html), true);

// ---- The close rate trend -------------------------------------------------
// The grid under the funnel. Its two colour cues are the stage swatch beside
// each row's name and the green behind a six-month figure running ahead of
// its rolling year - both of which have to be cells with a bgcolor, since a
// coloured span is padding Word drops and a background shorthand is the
// broken-image placeholder.
check('a trend row’s swatch is a bgcolor cell, sized in both places',
  /<td width="8" bgcolor="#2a78d6"[^>]*width:8px/.test(html), true);
check('the total row sits outside the stage ramp',
  html.includes('bgcolor="#64748B"'), true);
check('the "ahead of the year" green is its own cell inside the column',
  /<td bgcolor="#DCFCE7"/.test(html), true);
// The arrow is what carries the cue where the colour doesn't - a client that
// strips backgrounds, a reader who can't separate the green from the ink.
check('and it ships with the arrow, not the colour alone',
  html.includes('&#9650; 44%'), true);

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

// The stale banner. Its whole job is to be read before the figures are, so
// what is pinned is that it renders above the heading and that a current
// report carries no such thing. Word paints a broken-image placeholder for
// the `background:` shorthand and drops padding on a <span>, so the banner
// is a bgcolor table with padding on its cell like every other block here.
{
  const stale = renderWeeklyReportHtml({
    capturedAt: Date.parse('2026-09-03T16:00:00Z'),
    periodEnd: Date.parse('2026-09-06T23:59:59Z'),
    scope: 'week',
    periodLabel: 'Mon, Aug 31 - Sun, Sep 6, 2026',
    trends: { emailsByWeek: [{ key: '2026-08-31', label: 'Aug 31', value: 0, recorded: true }], newOppsByMonth: [] },
  }, {});
  const banner = stale.indexOf('These numbers are');
  check('a stale report carries a banner', banner > -1, true);
  check('the banner is above the report heading',
    banner > -1 && banner < stale.indexOf('>Weekly Report</td>'), true);
  check('it states the age and the missing days',
    stale.includes('days old and were captured before the week ended'), true);
  check('it says which tab republishes the numbers',
    stale.includes('Charts → Weekly Report'), true);
  check('it is painted with bgcolor, not the background shorthand',
    stale.includes('bgcolor="#FEF3C7"'), true);
  check('the heading keeps only the bare capture stamp',
    stale.includes('Captured Thu, 03 Sep 2026 16:00:00 UTC.'), true);
  check('the long grey one-liner no longer runs under the heading',
    stale.includes('before this period ended'), false);

  const current = renderWeeklyReportHtml({
    capturedAt: Date.parse('2026-09-07T05:00:00Z'),
    periodEnd: Date.parse('2026-09-06T23:59:59Z'),
    periodLabel: 'Mon, Aug 31 - Sun, Sep 6, 2026',
  }, {});
  check('a current report carries no banner',
    current.includes('These numbers are'), false);
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
