// Dan's standing Outlook drafts, transcribed from the .oft templates he keeps
// in Outlook (New Opportunities, PTO, Margin Approval, Commission Request,
// COA Approval). The Draft Emails page renders these on a "Dan's Drafts" tab
// so each one can be downloaded as an Outlook draft — .eml for the mails,
// .ics for the meeting — or edited first.
//
// Body HTML is stored inline rather than being generated from a form: these
// are Word tables Dan fills in by hand, and keeping the exact markup means the
// downloaded draft opens in Outlook looking like the .oft it came from. The
// signature is NOT baked in — the download path appends the user's saved
// signature the same way every other draft on this page does.

// Shared cell styling for the Margin Request table. Word emits this as a
// fixed-width 966px table; the widths are kept so the columns line up the way
// they do in the original template.
const MR_FONT = 'font-family:Calibri,sans-serif;font-size:11pt;';
const MR_CELL = `border:1px solid #BFBFBF;padding:2px 6px;vertical-align:top;${MR_FONT}`;
const MR_BANNER = `border:1px solid #BFBFBF;padding:2px 6px;background:#00B050;color:#FFFFFF;font-weight:bold;${MR_FONT}`;
const MR_OPTION = `border:1px solid #BFBFBF;padding:2px 6px;background:#E7E6E6;${MR_FONT}`;
const MR_HINT = `border:1px solid #BFBFBF;padding:2px 6px;text-align:center;color:#A5A5A5;font-style:italic;${MR_FONT}`;

// One "Option N" block: the grey banner row plus the Services/Fee Structure/
// Margin row and the Term/Escalator row. Labels sit in the same columns for
// every option so the table reads as a grid (the source .oft drifts between
// options; this is the shape it is drifting towards).
function marginOption(n, { services = '', fee = '', margin = '', term = '', escalator = '' } = {}) {
  return `
    <tr>
      <td width="58" style="${MR_OPTION}text-align:center;font-weight:bold;">Option ${n}</td>
      <td width="200" style="${MR_OPTION}">&nbsp;</td>
      <td width="84" style="${MR_OPTION}">&nbsp;</td>
      <td width="486" style="${MR_OPTION}">&nbsp;</td>
      <td width="84" style="${MR_OPTION}">&nbsp;</td>
      <td width="54" style="${MR_OPTION}">&nbsp;</td>
    </tr>
    <tr>
      <td width="58" style="${MR_CELL}font-weight:bold;">Services</td>
      <td width="200" style="${MR_CELL}">${services || '&nbsp;'}</td>
      <td width="84" style="${MR_CELL}font-weight:bold;">Fee Structure</td>
      <td width="486" style="${MR_CELL}">${fee || '&nbsp;'}</td>
      <td width="84" style="${MR_CELL}font-weight:bold;">Margin</td>
      <td width="54" style="${MR_CELL}">${margin || '&nbsp;'}</td>
    </tr>
    <tr>
      <td width="58" style="${MR_CELL}font-weight:bold;">Term</td>
      <td width="200" style="${MR_CELL}">${term || '&nbsp;'}</td>
      <td width="84" style="${MR_CELL}">&nbsp;</td>
      <td width="486" style="${MR_CELL}">&nbsp;</td>
      <td width="84" style="${MR_CELL}font-weight:bold;">Escalator</td>
      <td width="54" style="${MR_CELL}">${escalator || '&nbsp;'}</td>
    </tr>`;
}

const MARGIN_REQUEST_TABLE = `
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:966px;${MR_FONT}">
  <tr><td colspan="6" style="${MR_BANNER}">Margin Request Template</td></tr>
  <tr>
    <td colspan="2" style="${MR_CELL}font-weight:bold;">Customer Name</td>
    <td colspan="4" style="${MR_CELL}">&nbsp;</td>
  </tr>
  <tr>
    <td colspan="2" style="${MR_CELL}font-weight:bold;">Sales Investment Analyzer (SIA) Link</td>
    <td colspan="4" style="${MR_CELL}">&nbsp;</td>
  </tr>
  <tr>
    <td colspan="2" style="${MR_CELL}font-weight:bold;">Is this an RFP?</td>
    <td width="84" style="${MR_HINT}">Yes/No</td>
    <td width="486" style="${MR_CELL}">No</td>
    <td width="84" style="${MR_HINT}">Due Date</td>
    <td width="54" style="${MR_CELL}">N/A</td>
  </tr>
  <tr><td colspan="6" style="${MR_BANNER}">SIA Options Seeking Approval</td></tr>
  ${marginOption(1, {
    services: 'BECS/BECS Screening<br>CDP biodiversity<br>SBT AV App',
    margin: '62%',
    term: 'Recurring 3 year term',
    escalator: 'N/A',
  })}
  ${marginOption(2, { services: 'BECS/BECS Screening', term: 'Recurring 3 year term' })}
  ${marginOption(3, { services: 'BECS/BECS Screening', term: 'Recurring 3 year term' })}
  ${marginOption(4)}
  ${marginOption(5)}
</table>`;

// The new-opportunity table Keith reviews. One example row is kept in place so
// the columns are self-documenting — overwrite it with the real deal.
const NEW_OPPS_FONT = 'font-family:Arial,sans-serif;font-size:10pt;color:#000000;';
const NO_TH = `border:1px solid #000000;padding:3px 6px;font-weight:bold;white-space:nowrap;${NEW_OPPS_FONT}`;
const NO_TD = `border:1px solid #000000;padding:3px 6px;vertical-align:top;${NEW_OPPS_FONT}`;

const NEW_OPPS_TABLE = `
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;${NEW_OPPS_FONT}">
  <tr>
    <td style="${NO_TH}">Account</td>
    <td style="${NO_TH}">Stage</td>
    <td style="${NO_TH}">Scope</td>
    <td style="${NO_TH}">Source</td>
    <td style="${NO_TH}">Start Date</td>
    <td style="${NO_TH}text-align:right;">Deal Size</td>
    <td style="${NO_TH}">Notes</td>
    <td style="${NO_TH}">BFO Link</td>
  </tr>
  <tr>
    <td style="${NO_TD}">Kenco Logistics</td>
    <td style="${NO_TD}">Lead</td>
    <td style="${NO_TD}">Strategic sourcing</td>
    <td style="${NO_TD}">Existing Customer</td>
    <td style="${NO_TD}">7/8/2026</td>
    <td style="${NO_TD}text-align:right;">$75,000</td>
    <td style="${NO_TD}">Current client who wants to explore sourcing</td>
    <td style="${NO_TD}"><a href="https://se.lightning.force.com">BFO Link</a></td>
  </tr>
</table>`;

const KEITH = { name: 'Keith McHugh', email: 'keith.mchugh@se.com' };
// The HubSpot BCC drop-box address that logs the sent mail against the deal.
const HUBSPOT_BCC = { name: 'HubSpot logging', email: '244957983@bcc.na2.hubspot.com' };

export const DANS_DRAFTS = [
  {
    id: 'dan-new-opportunities',
    type: 'email',
    name: 'Dan B New Opportunities',
    blurb: 'Flags a new early-stage opp to Keith, with the pipeline table. BCCs HubSpot.',
    subject: 'Dan B New Opportunities',
    to: [KEITH],
    cc: [],
    bcc: [HUBSPOT_BCC],
    bodyHtml: `<p>Hi Keith,</p>
<p>&nbsp;</p>
<p>Per our plan to review early-stage deals coming into the pipeline, I wanted to flag the new opp for your review/feedback.</p>
<p>&nbsp;</p>
${NEW_OPPS_TABLE}
<p>&nbsp;</p>`,
  },
  {
    id: 'dan-pto',
    type: 'meeting',
    name: 'Dan B PTO',
    blurb: 'All-day out-of-office hold sent to the S&S out-of-office list and Keith.',
    subject: 'Dan B PTO',
    to: [
      { name: 'SM NAM SB S&S Sales - Out of Office', email: 'sm.nam.sb.sales.outofoffice@se.com' },
      KEITH,
    ],
    cc: [{ name: 'Dan Baldauf', email: 'baldaufdan@gmail.com' }],
    bcc: [],
    bodyHtml: '',
    // Matches the .oft: all-day, shown as Free, reminder 18 hours ahead
    // (i.e. 6am the day before). Dates default to today in the UI.
    meeting: { allDay: true, showAs: 'FREE', reminderMinutes: 1080 },
  },
  {
    id: 'dan-margin-approval',
    type: 'email',
    name: 'MARGIN APPROVAL: Client Name Scope',
    blurb: 'Margin Request Template table for Keith, CC Gabe. Fill in the SIA options.',
    subject: 'MARGIN APPROVAL: Client Name Scope',
    to: [KEITH],
    cc: [{ name: 'Gabe Smith', email: 'gabe.smith@se.com' }],
    bcc: [],
    bodyHtml: `<p>Hi Keith,</p>
<p>&nbsp;</p>
<p>Please let me know if you need any additional information on this opportunity.</p>
<p>&nbsp;</p>
${MARGIN_REQUEST_TABLE}
<p>&nbsp;</p>
<p>Thanks,</p>`,
  },
  {
    id: 'dan-commission-request',
    type: 'email',
    name: 'New Deal Commission Request - Client',
    blurb: 'Closed-won handoff to Keith with the Box link and intranet flag. BCCs HubSpot.',
    subject: 'New Deal Commission Request - Client',
    to: [KEITH],
    cc: [],
    bcc: [HUBSPOT_BCC],
    bodyHtml: `<p>Hi Keith,</p>
<p>&nbsp;</p>
<p>Below is the closed-won folder for this new win. Please let me know if you need any additional information from me on this one.</p>
<p>&nbsp;</p>
<p>Closed-Won Box:</p>
<p>&nbsp;</p>
<p>Status:&nbsp; New client/Current client</p>
<p>&nbsp;</p>
<p>Intranet Announcement Needed:&nbsp; Yes/No</p>`,
  },
  {
    id: 'dan-coa-approval',
    type: 'email',
    name: 'COA Approval Request - (Insert Client Name)',
    blurb: 'Asks Keith for COA approval. Attach the agreement, amendment and SIA before sending.',
    subject: 'COA Approval Request - (Insert Client Name)',
    to: [KEITH],
    cc: [],
    bcc: [],
    bodyHtml: `<p>Hi Keith,</p>
<p>&nbsp;</p>
<p>Requesting COA approval for this new deal.&nbsp; I have attached:</p>
<ul>
  <li>The original agreement</li>
  <li>The amendment final draft</li>
  <li>The SIA with the completed COA checklist</li>
</ul>
<p>&nbsp;</p>
<p>Please let me know if you have any other questions on this one.</p>`,
  },
];

// "Name <addr>" for display and for the To:/Cc:/Bcc: headers.
export function formatRecipient(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  return r.name ? `${r.name} <${r.email}>` : r.email;
}

// Parse a "Name <a@b>, c@d" line back into recipient objects, so the edit
// form can be a single text input per header rather than a chip editor.
export function parseRecipients(line) {
  return String(line || '')
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)\s*<([^>]+)>$/);
      if (m) return { name: m[1].replace(/^["']|["']$/g, '').trim(), email: m[2].trim() };
      return { name: '', email: s };
    });
}
