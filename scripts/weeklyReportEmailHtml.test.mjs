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

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const html = renderWeeklyReportHtml({
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
  narrative: '## Summary\nTwo new opps landed.',
}, { message: 'Read the funnel first.' });

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
// alone, and never as an image, which Outlook blocks by default.
check('the report loads no images at all', /<img\b/.test(html), false);
check('a progress bar is a bgcolor cell sized both ways',
  /width="54%" bgcolor="#3B82F6"[^>]*width:54%/.test(html), true);
check('a funnel bar uses the chart’s own stage colour',
  html.includes('bgcolor="#104281"'), true);

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
