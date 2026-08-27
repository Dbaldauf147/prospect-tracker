import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { DEFAULT_EMAIL_SIGNATURE } from '../../data/emailSignature';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { saveTagReview } from '../../utils/contactTagReview';
import { useDraftCampaignQueue, clearQueuedContacts, setQueuedContactIds } from '../../utils/draftCampaignQueue';
import { useDraftLeadsQueue, clearQueuedLeads, removeQueuedLead, leadQueueKey } from '../../utils/draftLeadsQueue';
import { useDraftRecipientsQueue, clearQueuedRecipients, removeQueuedRecipient, recipientQueueKey } from '../../utils/draftRecipientsQueue';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { htmlSectionLines } from '../../utils/inlineImages.js';
import { downscaleInlineImage, needsDownscale } from '../../utils/downscaleInlineImage.js';
import { withCompanyOverride } from '../../utils/contactCompanyOverride';
import styles from './DraftEmailView.module.css';

// Register an <hr> divider blot once so the editor can hold a horizontal
// page-break line (inserted from the Insert menu). Quill drops any tag that
// isn't a registered format, so the embed plus the 'divider' entry in the
// editor's `formats` whitelist are both required for the rule to survive.
const BlockEmbed = Quill.import('blots/block/embed');
class DividerBlot extends BlockEmbed {}
DividerBlot.blotName = 'divider';
DividerBlot.tagName = 'hr';
Quill.register(DividerBlot, true);

// Quill emits one <p> per line and <p><br></p> for an intentionally blank
// line. The trap: every <p> is its own Word paragraph, and when Outlook
// re-serialises the message on *Send* it re-applies its compose-time "space
// after paragraph" setting to each one — re-inflating the gaps no matter how
// aggressively we zero the <p> margins inline or via a <style> block. That's
// why the body looks tight while composing but the gaps double once it's sent.
//
// The fix is to stop using paragraph blocks at all: collapse the whole body
// into a SINGLE block whose lines are separated by <br>. Inside one paragraph
// a <br> is just a line break, not a paragraph boundary, so Word has no
// inter-paragraph spacing to add — two <br>s render exactly one blank line, in
// the draft AND in the sent message. Lists are kept as real lists (with their
// stock Word margins zeroed) since they can't be expressed with <br>s.
//
// Shared by the .eml export and the clipboard-paste paths so both
// render identically.
// Core of the body transform, shared by the sent-email builder and the
// on-screen preview. Collapses Quill's <p> paragraphs into a single block
// separated by <br>, keeps lists as lists, and strips the breaks Word would
// otherwise re-inflate (leading/trailing blank lines + blanks touching a
// list). In `preview` mode those stripped breaks are kept as \x00DROP\x00
// sentinels instead of being deleted, so the preview can show the user
// exactly which line breaks won't survive in the sent message.
function collapseBodyToBreaks(pBodyHtml, { preview = false } = {}) {
  const DROP = '\x00DROP\x00';
  const dropMarks = (s) => DROP.repeat((s.match(/<br>/gi) || []).length);
  const html = pBodyHtml
    // Replace non-breaking spaces with regular spaces — pasted text often has
    // &nbsp; for every space which prevents wrapping. First mark double spaces
    // (e.g. after periods) to preserve them.
    .replace(/&nbsp;&nbsp;/g, '\x00DOUBLE\x00')
    .replace(/&nbsp;/g, ' ')
    .replace(/\x00DOUBLE\x00/g, '&nbsp;&nbsp;')
    // Empty paragraphs (Quill's <p><br></p> blank-line markers) → a single
    // sentinel so they survive the paragraph-stripping below as one <br>.
    .replace(/<p[^>]*>\s*(?:<br\s*\/?>\s*)*<\/p>/gi, '\x00BR\x00')
    // Every remaining paragraph: drop the opening tag and turn the close into a
    // single <br>, so consecutive lines sit directly underneath one another
    // (single Enter = tight line break, double Enter = one blank line).
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\x00BR\x00')
    // Keep lists as lists, but zero the stock Word margins so they sit flush
    // with the surrounding lines instead of gaining auto spacing on Send.
    .replace(/<(ul|ol)([^>]*)>/gi, (_, tag, a = '') => `<${tag}${a} style="margin:0;padding-left:1.5em;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;">`)
    .replace(/<li([^>]*)>/gi, (_, a = '') => `<li${a} style="margin:0;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;">`)
    // The divider/page-break rule: give it explicit borders + margin so it
    // renders as a thin grey line and Outlook doesn't re-inflate the spacing.
    .replace(/<hr\s*\/?>/gi, '<hr style="border:none;border-top:1px solid #CBD5E1;margin:12px 0;" />')
    // Materialise the sentinels as real <br>s now that all <p> tags are gone.
    .replace(/\x00BR\x00/g, '<br>\n');

  // A list or divider is already block-level, so a <br> butting straight up
  // against it would add a phantom blank line; and a message shouldn't open or
  // close on a blank line. The sent email deletes these; the preview keeps
  // them as DROP sentinels so they can be surfaced as struck-through markers.
  return html
    .replace(/((?:<br>\s*)+)(<(?:ul|ol)\b)/gi, (_, brs, list) => (preview ? dropMarks(brs) : '') + list)
    // Blank lines *after* a list collapse to a single break instead of being
    // deleted outright, so one intentional gap (e.g. a Page break between the
    // bullets and the next line) survives on Send while Outlook still can't
    // re-inflate a whole stack of them. In preview the surviving break shows as
    // a faint ↵ and any collapsed extras as struck-through DROP markers.
    .replace(/(<\/(?:ul|ol)>)\s*((?:<br>\s*)+)/gi, (_, end, brs) => {
      if (!preview) return end + '<br>\n';
      const n = (brs.match(/<br>/gi) || []).length;
      return end + '<br>' + DROP.repeat(Math.max(0, n - 1));
    })
    .replace(/((?:<br>\s*)+)(<hr\b)/gi, (_, brs, hr) => (preview ? dropMarks(brs) : '') + hr)
    .replace(/(<hr[^>]*>)\s*((?:<br>\s*)+)/gi, (_, hr, brs) => hr + (preview ? dropMarks(brs) : ''))
    .replace(/^((?:\s*<br>\s*)+)/i, (_, brs) => (preview ? dropMarks(brs) : ''))
    .replace(/((?:\s*<br>\s*)+)$/i, (_, brs) => (preview ? dropMarks(brs) : ''));
}

// Build the preview body HTML. It always reflects the sent email accurately
// (same collapse/trim as buildStyledBodyHtml). When showBreaks is on, every
// surviving line break gets a faint ↵ marker and every break that the sent
// email strips gets a struck-through red ↵, so the user can see which breaks
// won't appear.
function buildPreviewBodyHtml(pBodyHtml, { showBreaks = false } = {}) {
  let html = collapseBodyToBreaks(pBodyHtml, { preview: showBreaks });
  if (showBreaks) {
    html = html
      .replace(/\x00DROP\x00/g, `<span class="${styles.lbDrop}" title="This line break is removed in the sent email">↵</span>`)
      .replace(/<br>/gi, `<span class="${styles.lbKeep}" title="Line break in the sent email">↵</span><br>`);
  }
  return html;
}

function buildStyledBodyHtml(pBodyHtml, { signature = '' } = {}) {
  const htmlContent = collapseBodyToBreaks(pBodyHtml);

  // Signature sits a real blank line below the body, indented slightly from
  // the left so it isn't flush against the body text (matches the look of
  // an Outlook-inserted signature). Two <br>s make that blank line — the same
  // "double break = one blank line" rule the body uses — since a single <br>
  // would drop the signature onto the very next line with no gap. Plain <br>s
  // (not <p> paragraphs) so Outlook's Word renderer can't re-inflate them.
  const sigBlock = signature ? `<br>\n<br>\n<div style="margin-left:24px;">\n${signature}\n</div>` : '';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n<head>\n<!--[if gte mso 9]><xml><w:WordDocument><w:DontHyphenate/><w:DoNotHyphenateCaps/></w:WordDocument></xml><![endif]-->\n<style>\np{margin:0pt;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\nul,ol{margin:0pt;padding-left:1.5em;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\nli{margin:0pt;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\ndiv{mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\n</style>\n</head>\n<body style="margin:0;padding:0;">\n<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">\n${htmlContent}\n</div>${sigBlock}\n</body>\n</html>`;
}

// Pulls contacts whose notes (HubSpot's `notes` / `hs_content_membership_notes`
// / `message` fields, plus the local-only override stored at
// settings.contactNotes[contactId]) contain the typed text. Same UX
// shape as TagContactPicker — typed query → list of matches with
// per-row checkboxes + bulk Select / Deselect — so the user can pick
// people by note keyword exactly the way they pick by tag.
function NoteContactPicker({ contactNotes, selectedContacts, onAdd, onRemove, onBulkAdd, onBulkRemove }) {
  const [query, setQuery] = useState('');
  const [rawContacts, setRawContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setRawContacts(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    if (trimmed.length < 2) return [];
    const needle = trimmed.toLowerCase();
    const out = [];
    for (const c of rawContacts) {
      if (!c?.email) continue;
      const local = (c.id && contactNotes?.[c.id]) || '';
      const haystack = [
        local,
        c.notes,
        c.hs_content_membership_notes,
        c.message,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack) continue;
      if (haystack.includes(needle)) {
        // Capture a small snippet around the first hit so the user can
        // see what matched without having to open the contact.
        const idx = haystack.indexOf(needle);
        const start = Math.max(0, idx - 30);
        const end = Math.min(haystack.length, idx + needle.length + 30);
        const snippet = (start > 0 ? '…' : '') + haystack.slice(start, end) + (end < haystack.length ? '…' : '');
        out.push({
          id: c.id,
          name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
          firstName: c.firstname || '',
          lastName: c.lastname || '',
          email: c.email,
          company: c.company || '',
          title: c.jobtitle || '',
          phone: c.phone || '',
          city: c.city || '',
          state: c.state || '',
          _noteSnippet: snippet,
        });
      }
    }
    return out;
  }, [trimmed, rawContacts, contactNotes]);

  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const allSelected = matches.length > 0 && matches.every(c => selectedIds.has(c.id));

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search notes (e.g. NACE, ESG, prior conversation…)"
        style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: '0.5rem' }}
      />
      {trimmed.length === 0 && (
        <p style={{ fontSize: '0.7rem', color: '#9CA3AF', margin: 0 }}>
          Type at least 2 characters. Searches HubSpot's notes columns and any in-app contact notes you've saved.
        </p>
      )}
      {trimmed.length > 0 && trimmed.length < 2 && (
        <p style={{ fontSize: '0.7rem', color: '#9CA3AF', margin: 0 }}>Keep typing: at least 2 characters.</p>
      )}
      {trimmed.length >= 2 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              "{trimmed}" ({matches.length})
            </span>
            {matches.length > 0 && (
              <button
                onClick={() => {
                  if (allSelected) onBulkRemove(matches.map(c => c.id));
                  else onBulkAdd(matches);
                }}
                style={{ background: 'none', border: 'none', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          {matches.length > 0 ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {matches.map(c => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', background: isSelected ? '#EFF6FF' : 'transparent' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => isSelected ? onRemove(c.id) : onAdd(c)} style={{ accentColor: '#0078D4', marginTop: 3 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: '0.65rem', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}{c.company ? ` · ${c.company}` : ''}</div>
                      <div style={{ fontSize: '0.65rem', color: '#64748B', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c._noteSnippet}>
                        {c._noteSnippet}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', textAlign: 'center' }}>No contacts have that text in their notes</p>
          )}
        </>
      )}
    </div>
  );
}

// Result panel shown after Claude reviews the email draft.
// Score band + verdict line at the top, strengths / fixes lists below,
// suggested rewrite at the bottom with a one-click "Use rewrite"
// button that swaps the subject + body in the composer.
export function CritiquePanel({ critique, onClose, onUseRewrite }) {
  const { score, verdict, strengths, fixes, rewriteSubject, rewriteBody } = critique;
  const tier = score == null ? 'unknown' : score >= 80 ? 'good' : score >= 55 ? 'mid' : 'bad';
  const bandStyle = {
    good: { bg: '#DCFCE7', border: '#86EFAC', color: '#166534' },
    mid:  { bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
    bad:  { bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B' },
    unknown: { bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' },
  }[tier];
  return (
    <div style={{ marginBottom: '0.6rem', border: `1px solid ${bandStyle.border}`, background: bandStyle.bg, borderRadius: 6, padding: '0.6rem 0.7rem', fontSize: '0.78rem', color: bandStyle.color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{score == null ? '-' : `${score}/100`}</span>
          {verdict && <span style={{ fontWeight: 600 }}>{verdict}</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: bandStyle.color, fontSize: '1rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
          title="Close critique"
        >×</button>
      </div>
      {strengths && strengths.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Working</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {strengths.map((s, i) => <li key={i} style={{ marginBottom: 1 }}>{s}</li>)}
          </ul>
        </div>
      )}
      {fixes && fixes.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Fixes</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {fixes.map((f, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                {f.issue && <span style={{ fontWeight: 700 }}>{f.issue}</span>}
                {f.issue && f.fix && <span>: </span>}
                {f.fix && <span>{f.fix}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(rewriteSubject || rewriteBody) && (
        <div style={{ marginTop: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, padding: '0.4rem 0.55rem', color: '#1E293B' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#475569' }}>Suggested rewrite</div>
            <button
              type="button"
              onClick={onUseRewrite}
              style={{ padding: '0.2rem 0.55rem', border: 'none', background: '#7C3AED', color: '#fff', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              title="Replace the current subject + body with Claude's rewrite. Variable tokens are preserved."
            >Use rewrite</button>
          </div>
          {rewriteSubject && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: '0.7rem' }}>Subject:</span> <span style={{ fontSize: '0.78rem' }}>{rewriteSubject}</span>
            </div>
          )}
          {rewriteBody && (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: '0.78rem', lineHeight: 1.45 }}>{rewriteBody}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// The variables the composer can insert. Module scope, not per-render:
// the coverage memo below keys off this array, and rebuilding it every
// render would make that memo re-run on every keystroke.
const INSERT_VARIABLES = [
  { token: '{firstName}', label: 'First Name', example: 'John' },
  { token: '{goesBy}', label: 'Goes By', example: 'Bob' },
  { token: '{lastName}', label: 'Last Name', example: 'Smith' },
  { token: '{fullName}', label: 'Full Name', example: 'John Smith' },
  { token: '{email}', label: 'Email', example: 'john@company.com' },
  { token: '{company}', label: 'Company', example: 'Acme Corp' },
  { token: '{companyType}', label: 'Company Type', example: 'Private Equity' },
  { token: '{title}', label: 'Job Title', example: 'VP of Sales' },
  { token: '{phone}', label: 'Phone', example: '555-0100' },
  { token: '{city}', label: 'City', example: 'Denver' },
  { token: '{state}', label: 'State', example: 'CO' },
  { token: '{custom}', label: 'Custom', example: 'great meeting you at the conference' },
];

// Variable-coverage cells the user can edit inline. Maps each variable
// token to its underlying field: `hubspot` writes through to HubSpot via
// the update-contact endpoint (with the matching property name and the
// local key on the flattened contact object); `custom` is the app-side
// {custom} value persisted in settings.customField. Tokens not listed
// here (fullName, company, companyType) stay read-only — they're either
// composite or derived from other fields.
const COVERAGE_EDITABLE = {
  '{firstName}': { kind: 'hubspot', prop: 'firstname', local: 'firstName' },
  '{lastName}':  { kind: 'hubspot', prop: 'lastname',  local: 'lastName' },
  '{title}':     { kind: 'hubspot', prop: 'jobtitle',  local: 'title' },
  '{phone}':     { kind: 'hubspot', prop: 'phone',     local: 'phone' },
  '{city}':      { kind: 'hubspot', prop: 'city',      local: 'city' },
  '{state}':     { kind: 'hubspot', prop: 'state',     local: 'state' },
  '{email}':     { kind: 'hubspot', prop: 'email',     local: 'email' },
  // {goesBy} is the app-side "Goes By" nickname stored in
  // settings.contactNicknames, keyed by HubSpot contact id.
  '{goesBy}':    { kind: 'nickname' },
  '{custom}':    { kind: 'custom' },
};

// One editable coverage cell — click to edit, commit on blur / Enter,
// cancel on Escape. Read-only tokens just render the value (or the red
// missing dash) without the click affordance.
function CoverageEditCell({ value, editable, missingTitle, cellStyle, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const has = String(value || '').trim().length > 0;
  if (editing) {
    return (
      <td style={{ ...cellStyle, padding: 0, maxWidth: 180 }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', fontSize: '0.74rem', border: '1px solid #2563EB', borderRadius: 3, fontFamily: 'inherit', outline: 'none' }}
        />
      </td>
    );
  }
  if (has) {
    return (
      <td
        style={{ ...cellStyle, color: '#1E293B', cursor: editable ? 'pointer' : 'default' }}
        title={editable ? `${value} · click to edit` : value}
        onClick={editable ? () => setEditing(true) : undefined}
      >{value}</td>
    );
  }
  return (
    <td
      style={{ ...cellStyle, color: '#B91C1C', fontStyle: 'italic', fontWeight: 700, cursor: editable ? 'pointer' : 'default' }}
      title={editable ? 'Click to add a value' : missingTitle}
      onClick={editable ? () => setEditing(true) : undefined}
    >-</td>
  );
}

// Which variables the draft actually uses, how well each is covered
// across the recipients, and which gaps are worth warning about.
//
// Pure, and run in exactly one place: the page computes it once and hands
// the result to both the warning banner at the top and the table below,
// so the two can't disagree about how many recipients are short.
//
//   usedTokens — the intersection of "tokens INSERT_VARIABLES knows
//                about" and "tokens that appear in the draft", so unused
//                variables don't pollute the table
//   coverage   — filled/total per token, behind the column headers
//   gaps       — the variables that will render blank for someone, worst
//                first: the one landing blank most often is the one worth
//                fixing before the send
//   affected   — recipients who'd get at least one blank. This is the
//                number that actually matters — one variable missing on
//                12 people and three missing on the same person are very
//                different sends, and the per-column counts can't tell
//                them apart.
function computeVariableCoverage({ subject, body, contacts, insertVariables, resolve }) {
  const list = Array.isArray(contacts) ? contacts : [];
  const haystack = `${subject || ''}\n${body || ''}`;
  const usedTokens = [];
  for (const v of (insertVariables || [])) {
    // Same tolerance as personalizeForContact's case-insensitive replace.
    const pat = new RegExp(v.token.replace(/[{}]/g, m => '\\' + m), 'i');
    if (pat.test(haystack)) usedTokens.push(v);
  }

  const coverage = {};
  for (const v of usedTokens) {
    let filled = 0;
    for (const c of list) {
      if (String(resolve(c, v.token) || '').trim()) filled += 1;
    }
    coverage[v.token] = { filled, total: list.length };
  }

  const gaps = usedTokens
    .map(v => ({ ...v, ...coverage[v.token] }))
    .filter(g => g.filled < g.total)
    .sort((a, b) => (b.total - b.filled) - (a.total - a.filled));

  let affected = 0;
  if (gaps.length) {
    for (const c of list) {
      if (gaps.some(g => !String(resolve(c, g.token) || '').trim())) affected += 1;
    }
  }
  return { usedTokens, coverage, gaps, affected, total: list.length };
}

// The "your personalization will land blank" banner. Sits at the top of
// the page rather than on the coverage card: the card is the last thing
// in the right-hand column, well below the Send controls, and a warning
// you have to scroll to find is one you send past. The red dashes in the
// table say which cells; this says whether to send at all.
function CoverageWarning({ gaps, affected, total }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <div className={styles.coverageAlert} role="alert">
      <span className={styles.coverageAlertIcon} aria-hidden="true">&#9888;</span>
      <div className={styles.coverageAlertBody}>
        <p className={styles.coverageAlertTitle}>
          {gaps.length === 1 ? '1 variable is' : `${gaps.length} variables are`} not fully covered
        </p>
        <p className={styles.coverageAlertText}>
          {affected} of {total} recipient{total === 1 ? '' : 's'} will get at least one blank where a
          variable should be. Fill the gaps in under Variable Coverage below — most red <strong>-</strong> cells
          are editable in place — or drop those recipients before sending.
        </p>
        <div className={styles.coverageAlertList}>
          {gaps.map(g => (
            <span key={g.token} className={styles.coverageAlertChip}>
              {g.label}: {g.total - g.filled} missing ({g.filled}/{g.total})
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Variable coverage table — one row per selected contact, one column
// per variable token that's actually used in the current subject /
// body. Helps spot gaps in the data BEFORE sending: missing values
// render as a red dash so the user can either fill them in upstream or
// remove the contact from the campaign. The columns and their
// filled/total counts come from computeVariableCoverage, run once on the
// page and passed in.
function VariableCoverageTable({ contacts, usedTokens, coverage, resolve, isEditable, onEditField }) {
  if (contacts.length === 0) {
    return (
      <>
        <h3 className={styles.cardTitle}>Variable Coverage</h3>
        <p className={styles.emptyDrafts}>Add contacts above to see how each variable resolves per recipient.</p>
      </>
    );
  }

  if (usedTokens.length === 0) {
    return (
      <>
        <h3 className={styles.cardTitle}>Variable Coverage</h3>
        <p className={styles.emptyDrafts}>
          No variable tokens detected in the subject or body: nothing to check.
        </p>
      </>
    );
  }

  const cellStyle = { padding: '0.3rem 0.5rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 };
  const headStyle = { ...cellStyle, position: 'sticky', top: 0, background: '#F8FAFC', fontWeight: 700, color: '#475569', borderBottom: '1px solid var(--color-border)', textAlign: 'left', zIndex: 1 };

  return (
    <>
      <h3 className={styles.cardTitle}>Variable Coverage ({contacts.length})</h3>
      <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: '-0.25rem 0 0.5rem 0' }}>
        Each row is a recipient; each column is a variable used in the draft. Red <strong>-</strong> = the source data has no value to substitute, so that personalization will land blank.
      </p>
      <div style={{
        // Grow with the viewport — leaves enough room for the page
        // chrome / header / Saved Drafts above, but uses the rest of
        // the screen so a 50-row campaign doesn't need a tiny inner
        // scroll. Sticky header keeps the column labels visible as
        // the user scrolls within the card.
        maxHeight: 'calc(100vh - 220px)',
        minHeight: 320,
        overflow: 'auto',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
      }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.74rem', tableLayout: 'auto', width: '100%' }}>
          <thead>
            <tr>
              <th style={headStyle}>Recipient</th>
              {usedTokens.map(v => {
                const cov = coverage[v.token] || { filled: 0, total: contacts.length };
                const partial = cov.filled < cov.total;
                return (
                  <th key={v.token} style={headStyle} title={`${v.label} · ${cov.filled}/${cov.total} populated`}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                      <span>{v.label}</span>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: partial ? '#B91C1C' : '#16A34A' }}>
                        {cov.filled}/{cov.total}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id || c.email}>
                <td style={{ ...cellStyle, fontWeight: 600, color: '#1E293B' }} title={`${c.name || ''}${c.email ? ` · ${c.email}` : ''}${c.company ? ` · ${c.company}` : ''}`}>
                  {c.name || c.email || '(unnamed)'}
                </td>
                {usedTokens.map(v => {
                  const val = String(resolve(c, v.token) || '').trim();
                  const editable = !!(isEditable && isEditable(v.token));
                  return (
                    <CoverageEditCell
                      key={v.token}
                      value={val}
                      editable={editable}
                      missingTitle={`Missing: ${v.label} will render blank for this recipient`}
                      cellStyle={cellStyle}
                      onCommit={nv => onEditField && onEditField(c, v.token, nv)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TagContactPicker({ allContacts, selectedContacts, onAdd, onRemove, onBulkAdd, onBulkRemove }) {
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [rawContacts, setRawContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setRawContacts(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set();
    rawContacts.forEach(c => {
      const t = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
      t.split(';').map(s => s.trim()).filter(Boolean).forEach(tag => tags.add(tag));
    });
    return [...tags].sort();
  }, [rawContacts]);

  // Contacts matching ALL selected tags (AND logic)
  const tagContacts = useMemo(() => {
    if (selectedTags.size === 0) return [];
    return rawContacts.filter(c => {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').split(';').map(s => s.trim());
      return [...selectedTags].every(tag => tags.includes(tag)) && c.email;
    }).map(c => ({
      id: c.id,
      name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
      firstName: c.firstname || '',
      lastName: c.lastname || '',
      email: c.email,
      company: c.company || '',
      title: c.jobtitle || '',
      phone: c.phone || '',
      city: c.city || '',
      state: c.state || '',
    }));
  }, [selectedTags, rawContacts]);

  function toggleTag(tag) {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const filteredTags = tagSearch.trim() ? allTags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase())) : allTags;
  const allTagContactsSelected = tagContacts.length > 0 && tagContacts.every(c => selectedIds.has(c.id));

  return (
    <div>
      <input
        type="text"
        value={tagSearch}
        onChange={e => setTagSearch(e.target.value)}
        placeholder="Search tags..."
        style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: '0.4rem' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.75rem', maxHeight: '120px', overflowY: 'auto' }}>
        {filteredTags.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            style={{
              padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: 'none',
              background: selectedTags.has(tag) ? '#0078D4' : '#F1F5F9',
              color: selectedTags.has(tag) ? '#fff' : '#475569',
            }}
          >
            {tag}
          </button>
        ))}
        {filteredTags.length === 0 && <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>No tags found</span>}
      </div>

      {selectedTags.size > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              {[...selectedTags].join(' + ')} ({tagContacts.length})
            </span>
            <button
              onClick={() => {
                if (allTagContactsSelected) onBulkRemove(tagContacts.map(c => c.id));
                else onBulkAdd(tagContacts);
              }}
              style={{ background: 'none', border: 'none', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {allTagContactsSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {tagContacts.length > 0 ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {tagContacts.map(c => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', background: isSelected ? '#EFF6FF' : 'transparent' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => isSelected ? onRemove(c.id) : onAdd(c)} style={{ accentColor: '#0078D4' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: '0.65rem', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', textAlign: 'center' }}>No contacts match all selected tags</p>
          )}
        </>
      )}
    </div>
  );
}

// Renders the "queued for campaign" section inside the Custom Email
// Campaign card. Reads contact ids the user checked on the Active /
// Client / Key Contacts pages (via useDraftCampaignQueue), resolves
// them against the loaded HubSpot cache, and offers Add / Clear.
function CampaignQueueSection({ allContacts, selectedContacts, setSelectedContacts }) {
  const queuedIds = useDraftCampaignQueue();
  const idSet = new Set(queuedIds);
  const queuedContacts = allContacts.filter(c => idSet.has(String(c.id)));
  const missingIds = queuedIds.filter(id => !allContacts.some(c => String(c.id) === id));
  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const allInDraft = queuedContacts.length > 0 && queuedContacts.every(c => selectedIds.has(c.id));
  const addAll = () => {
    setSelectedContacts(prev => {
      const ids = new Set(prev.map(c => c.id));
      return [...prev, ...queuedContacts.filter(c => !ids.has(c.id))];
    });
  };
  const removeOne = (id) => {
    const next = queuedIds.filter(x => x !== String(id));
    setQueuedContactIds(next);
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.74rem', color: '#475569' }}>
          <strong>{queuedContacts.length}</strong> contact{queuedContacts.length === 1 ? '' : 's'} queued from Active / Client / Key Contacts
          {missingIds.length > 0 && (
            <span style={{ marginLeft: 6, color: '#92400E' }}>· {missingIds.length} not in HubSpot cache</span>
          )}
        </div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            onClick={addAll}
            disabled={queuedContacts.length === 0 || allInDraft}
            title={allInDraft ? 'All queued contacts are already in the draft' : 'Add every queued contact to the current draft'}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #1D4ED8', background: queuedContacts.length === 0 || allInDraft ? '#F1F5F9' : '#1D4ED8', color: queuedContacts.length === 0 || allInDraft ? '#94A3B8' : '#fff', borderRadius: 4, cursor: queuedContacts.length === 0 || allInDraft ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >Add all to draft</button>
          <button
            type="button"
            onClick={() => clearQueuedContacts()}
            disabled={queuedIds.length === 0}
            title="Empty the campaign queue (does not affect the draft)"
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #CBD5E1', background: '#fff', color: queuedIds.length === 0 ? '#CBD5E1' : '#475569', borderRadius: 4, cursor: queuedIds.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >Clear queue</button>
        </div>
      </div>
      {queuedContacts.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 4, background: '#F8FAFC' }}>
          {queuedContacts.map(c => {
            const inDraft = selectedIds.has(c.id);
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0.5rem', borderTop: '1px solid #E2E8F0', fontSize: '0.72rem' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${c.name}${c.company ? ` · ${c.company}` : ''}${c.email ? ` · ${c.email}` : ''}`}>
                  <span style={{ fontWeight: 600, color: '#1E293B' }}>{c.name}</span>
                  {c.company && <span style={{ color: '#64748B' }}> · {c.company}</span>}
                </span>
                {inDraft ? (
                  <span style={{ fontSize: '0.62rem', color: '#16A34A', fontWeight: 700 }}>in draft</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeOne(c.id)}
                  title="Remove from queue"
                  style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 3, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 5px', lineHeight: 1.4 }}
                >×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Renders the "queued from Marketing Leads" section inside the Custom
// Email Campaign card. Reads the full contact objects the Marketing Leads
// page pushed via useDraftLeadsQueue (Marketing Leads aren't necessarily
// HubSpot contacts, so they carry their own name / email / company rather
// than an id resolved against the HubSpot cache) and offers Add / Clear.
// Hidden entirely until at least one lead has been sent over.
function MarketingLeadsQueueSection({ selectedContacts, setSelectedContacts }) {
  const queuedLeads = useDraftLeadsQueue();
  if (queuedLeads.length === 0) return null;

  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const selectedEmails = new Set(selectedContacts.map(c => String(c.email || '').trim().toLowerCase()).filter(Boolean));
  const inDraft = (c) => selectedIds.has(c.id) || (c.email && selectedEmails.has(c.email.toLowerCase()));
  const allInDraft = queuedLeads.every(inDraft);

  const addAll = () => {
    setSelectedContacts(prev => {
      const ids = new Set(prev.map(c => c.id));
      const emails = new Set(prev.map(c => String(c.email || '').trim().toLowerCase()).filter(Boolean));
      const toAdd = queuedLeads.filter(c => c.email && !ids.has(c.id) && !emails.has(c.email.toLowerCase()));
      return [...prev, ...toAdd];
    });
  };

  return (
    <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>From Marketing Leads</h4>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.74rem', color: '#475569' }}>
          <strong>{queuedLeads.length}</strong> lead{queuedLeads.length === 1 ? '' : 's'} sent from the Marketing Leads page
        </div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            onClick={addAll}
            disabled={allInDraft}
            title={allInDraft ? 'All queued leads are already in the draft' : 'Add every queued lead to the current draft'}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #7C3AED', background: allInDraft ? '#F1F5F9' : '#7C3AED', color: allInDraft ? '#94A3B8' : '#fff', borderRadius: 4, cursor: allInDraft ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >Add all to draft</button>
          <button
            type="button"
            onClick={() => clearQueuedLeads()}
            title="Empty the Marketing Leads queue (does not affect the draft)"
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
          >Clear queue</button>
        </div>
      </div>
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 4, background: '#F8FAFC' }}>
        {queuedLeads.map(c => {
          const isIn = inDraft(c);
          return (
            <div key={leadQueueKey(c)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0.5rem', borderTop: '1px solid #E2E8F0', fontSize: '0.72rem' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${c.name}${c.company ? ` · ${c.company}` : ''}${c.email ? ` · ${c.email}` : ''}`}>
                <span style={{ fontWeight: 600, color: '#1E293B' }}>{c.name || c.email}</span>
                {c.company && <span style={{ color: '#64748B' }}> · {c.company}</span>}
              </span>
              {isIn ? <span style={{ fontSize: '0.62rem', color: '#16A34A', fontWeight: 700 }}>in draft</span> : null}
              <button
                type="button"
                onClick={() => removeQueuedLead(leadQueueKey(c))}
                title="Remove from queue"
                style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 3, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 5px', lineHeight: 1.4 }}
              >×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Renders the "From Email Campaigns" section inside the Custom Email Campaign
// card. Reads recipients pushed from the Email Campaign tracker's "Add unsent
// to Draft" button (full contact objects, since campaign rosters hold raw
// emails, not HubSpot ids) and offers Add / Clear. Hidden until at least one
// recipient has been queued. Mirrors MarketingLeadsQueueSection.
function CampaignRecipientsQueueSection({ selectedContacts, setSelectedContacts }) {
  const queued = useDraftRecipientsQueue();
  if (queued.length === 0) return null;

  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const selectedEmails = new Set(selectedContacts.map(c => String(c.email || '').trim().toLowerCase()).filter(Boolean));
  const inDraft = (c) => selectedIds.has(c.id) || (c.email && selectedEmails.has(c.email.toLowerCase()));
  const allInDraft = queued.every(inDraft);

  const addAll = () => {
    setSelectedContacts(prev => {
      const ids = new Set(prev.map(c => c.id));
      const emails = new Set(prev.map(c => String(c.email || '').trim().toLowerCase()).filter(Boolean));
      const toAdd = queued.filter(c => c.email && !ids.has(c.id) && !emails.has(c.email.toLowerCase()));
      return [...prev, ...toAdd];
    });
  };

  return (
    <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>From Email Campaigns</h4>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.74rem', color: '#475569' }}>
          <strong>{queued.length}</strong> unsent recipient{queued.length === 1 ? '' : 's'} sent from the Email Campaigns page
        </div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            onClick={addAll}
            disabled={allInDraft}
            title={allInDraft ? 'All queued recipients are already in the draft' : 'Add every queued recipient to the current draft'}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #1D4ED8', background: allInDraft ? '#F1F5F9' : '#1D4ED8', color: allInDraft ? '#94A3B8' : '#fff', borderRadius: 4, cursor: allInDraft ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >Add all to draft</button>
          <button
            type="button"
            onClick={() => clearQueuedRecipients()}
            title="Empty the Email Campaigns queue (does not affect the draft)"
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
          >Clear queue</button>
        </div>
      </div>
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 4, background: '#F8FAFC' }}>
        {queued.map(c => {
          const isIn = inDraft(c);
          return (
            <div key={recipientQueueKey(c)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0.5rem', borderTop: '1px solid #E2E8F0', fontSize: '0.72rem' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${c.name || ''}${c.company ? ` · ${c.company}` : ''}${c.email ? ` · ${c.email}` : ''}`}>
                <span style={{ fontWeight: 600, color: '#1E293B' }}>{c.name || c.email}</span>
                {c.company && <span style={{ color: '#64748B' }}> · {c.company}</span>}
              </span>
              {isIn ? <span style={{ fontSize: '0.62rem', color: '#16A34A', fontWeight: 700 }}>in draft</span> : null}
              <button
                type="button"
                onClick={() => removeQueuedRecipient(recipientQueueKey(c))}
                title="Remove from queue"
                style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 3, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 5px', lineHeight: 1.4 }}
              >×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewTabs({ contacts, subject, body, personalizeForContact, draftCc, ccMap, toAlsoMap }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showBreaks, setShowBreaks] = useState(true);
  const c = contacts[activeIdx] || contacts[0];
  if (!c) return null;

  const toAlso = (toAlsoMap || {})[c.email] || [];
  const contactCc = (ccMap || {})[c.email] || [];
  const allCc = [...new Set([...contactCc, ...(draftCc || [])])];

  return (
    <div className={styles.previewSection}>
      <div className={styles.previewHeader}>
        <h4 className={styles.previewTitle}>Preview</h4>
        <button
          type="button"
          onClick={() => setShowBreaks(v => !v)}
          className={showBreaks ? styles.breakToggleOn : styles.breakToggle}
          title="Show line-break markers. ↵ marks each break in the sent email; a struck-through red ↵ marks a break you typed that the email will drop (leading/trailing blank lines and blanks next to bullet lists)."
        >¶ {showBreaks ? 'Hide breaks' : 'Show breaks'}</button>
        <div className={styles.previewTabs}>
          {contacts.map((ct, i) => (
            <button
              key={ct.id}
              className={i === activeIdx ? styles.previewTabActive : styles.previewTab}
              onClick={() => setActiveIdx(i)}
            >
              {ct.firstName || ct.name.split(' ')[0] || ct.email}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.previewBox}>
        <div className={styles.previewTo}>
          <strong>To:</strong> {c.email}{toAlso.length > 0 && <>, {toAlso.join(', ')}</>}
        </div>
        {allCc.length > 0 && (
          <div className={styles.previewTo}>
            <strong>CC:</strong> {allCc.join(', ')}
          </div>
        )}
        <div className={styles.previewSubject}>{personalizeForContact(subject, c)}</div>
        <div className={styles.previewBody} dangerouslySetInnerHTML={{ __html: buildPreviewBodyHtml(personalizeForContact(body, c), { showBreaks }) }} />
      </div>
    </div>
  );
}

const AUTOSAVE_KEY = 'prospect-draft-autosave';

// The body "Clear all" resets to — a personalized greeting kept as a real
// {goesBy} token so it still resolves per recipient on send/preview, followed
// by two blank lines so the cursor starts a couple of returns below the
// greeting. The signature lives in its own field, so it's untouched by a
// compose clear.
const GREETING_BODY = '<p>Hi {goesBy},</p><p><br></p><p><br></p>';

// "Clear all" leaves the user's own address in the To line rather than an
// empty recipient list, so a freshly-cleared compose is ready to send a test
// to self. Shaped like a contact record (id/name/email) so it flows through
// the To rendering and {goesBy}/{firstName} token resolution unchanged.
const SELF_RECIPIENT = Object.freeze({
  id: 'self:daniel.baldauf@se.com',
  name: 'Daniel Baldauf',
  firstName: 'Daniel',
  lastName: 'Baldauf',
  email: 'daniel.baldauf@se.com',
  company: '',
});

export function DraftEmailView({ prospects, settings, updateSettings, updateSettingsPath }) {
  const { isAdmin, user } = useAuth();
  // Restore auto-saved compose state
  const [subject, setSubject] = useState(() => {
    try { return JSON.parse(userLsGet(AUTOSAVE_KEY))?.subject || ''; } catch { return ''; }
  });
  const [body, setBody] = useState(() => {
    try { return JSON.parse(userLsGet(AUTOSAVE_KEY))?.body || ''; } catch { return ''; }
  });
  const [selectedContacts, setSelectedContacts] = useState(() => {
    try { return JSON.parse(userLsGet(AUTOSAVE_KEY))?.contacts || []; } catch { return []; }
  });
  const [contactSearch, setContactSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [result, setResult] = useState(null);
  // Opt-in open/click tracking for the drafts this batch produces.
  // Persisted so the choice sticks between sessions; defaults on.
  const [trackEmails, setTrackEmails] = useState(settings?.trackEmails !== false);
  const drafts = settings?.emailDrafts || [];
  function setDrafts(updater) {
    const next = typeof updater === 'function' ? updater(drafts) : updater;
    updateSettings({ emailDrafts: next });
  }
  const [draftQueue, setDraftQueue] = useState([]); // contacts waiting to be opened
  const [draftsSent, setDraftsSent] = useState(0);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  // Claude email critique — null when no review has run, busy flag
  // while the request is in flight, otherwise the parsed { score,
  // verdict, strengths, fixes, rewriteSubject, rewriteBody } payload.
  const [critique, setCritique] = useState(null);
  const [critiqueBusy, setCritiqueBusy] = useState(false);

  async function runCritique() {
    if (critiqueBusy) return;
    setCritique(null);
    setCritiqueBusy(true);
    try {
      const res = await apiFetch('/api/critique-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Claude couldn\'t review the draft: ' + (data?.error || res.statusText));
        return;
      }
      setCritique(data);
    } catch (err) {
      alert('Network error talking to Claude: ' + (err?.message || 'unknown'));
    } finally {
      setCritiqueBusy(false);
    }
  }
  const [lastFocused, setLastFocused] = useState('body'); // 'subject' or 'body'
  const [attachments, setAttachments] = useState([]);
  const [draftCc, setDraftCc] = useState(() => {
    try { return JSON.parse(userLsGet(AUTOSAVE_KEY))?.cc || []; } catch { return []; }
  });
  const [draftCcInput, setDraftCcInput] = useState('');
  const [showDraftCcSuggestions, setShowDraftCcSuggestions] = useState(false);
  // The bundled DEFAULT_EMAIL_SIGNATURE is Dan's personal signature
  // (name, phone, address). Only auto-apply it for the admin account —
  // every other user starts with no signature until they save one in
  // the editor below.
  const DEFAULT_SIGNATURE = isAdmin ? DEFAULT_EMAIL_SIGNATURE : '';
  const [signature, setSignature] = useState(() => DEFAULT_SIGNATURE);
  // Sync signature from Firestore when settings load
  useEffect(() => {
    if (settings?.emailSignature) setSignature(settings.emailSignature);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.emailSignature]);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const draftCcRef = useRef(null);
  const fileInputRef = useRef(null);
  const searchRef = useRef(null);
  const insertRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);

  // Auto-save compose state so it's never lost. Inline images make the body
  // big enough to hit the localStorage quota, and userLsSet rethrows when it
  // does — so the failure is caught and said out loud. Silently losing the
  // autosave is the one outcome worth avoiding here: the user carries on
  // typing believing the draft is safe.
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        userLsSet(AUTOSAVE_KEY, JSON.stringify({ subject, body, contacts: selectedContacts, cc: draftCc }));
        setAutosaveFailed(false);
      } catch (err) {
        console.warn('Draft autosave failed (likely storage quota):', err?.message || err);
        setAutosaveFailed(true);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [subject, body, selectedContacts, draftCc]);

  // Shrink oversized pasted images. Quill hands a pasted screenshot straight
  // into the body at its full capture size; redrawing it at email width keeps
  // the draft (and the autosave above) to a sane size. Done here rather than
  // in a paste handler because it covers every route an image can arrive by —
  // clipboard, the toolbar's file picker, a drag-and-drop — and because the
  // resize is async, which a Quill clipboard matcher can't be.
  const downscalingRef = useRef(false);
  useEffect(() => {
    if (downscalingRef.current) return;
    const uris = [...String(body).matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(data:image\/[^"']+)\1/gi)]
      .map(m => m[2])
      .filter(needsDownscale);
    if (!uris.length) return;
    let cancelled = false;
    downscalingRef.current = true;
    (async () => {
      try {
        const shrunk = new Map();
        for (const uri of new Set(uris)) {
          const next = await downscaleInlineImage(uri);
          if (next && next !== uri) shrunk.set(uri, next);
        }
        if (cancelled || shrunk.size === 0) return;
        setBody(prev => {
          let out = prev;
          for (const [from, to] of shrunk) out = out.split(from).join(to);
          return out;
        });
      } finally {
        downscalingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [body]);

  // Quill config for the body. Memoized because a fresh `modules` object on
  // every render makes react-quill tear the editor down and rebuild it, which
  // loses the caret mid-typing.
  const bodyQuillModules = useMemo(() => ({
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link', 'image'],
      ['clean'],
    ],
    clipboard: { matchVisual: false },
  }), []);

  // Load HubSpot contacts from cache. We keep BOTH the flattened list the
  // composer works with (allContacts) and the raw HubSpot records
  // (rawContacts) — the contact popup (ContactEditModal) edits raw HubSpot
  // fields (firstname / lastname / jobtitle / tags…), so clicking a
  // recipient name resolves back to its raw record here.
  const [allContacts, setAllContacts] = useState([]);
  const [rawContacts, setRawContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(contacts => {
        if (cancelled) return;
        setRawContacts(contacts);
        setAllContacts(contacts.filter(c => c.email).map(c => ({
          id: c.id,
          name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
          firstName: c.firstname || '',
          lastName: c.lastname || '',
          email: c.email,
          company: c.company || '',
          title: c.jobtitle || '',
          phone: c.phone || '',
          city: c.city || '',
          state: c.state || '',
          linkedinUrl: c.hs_linkedin_url || c.linkedin_url || '',
        })));
      }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Contact popup (same ContactEditModal used on the Contacts pages),
  // opened by clicking a recipient's name. Holds the RAW HubSpot record —
  // the modal edits raw fields (firstname / lastname / jobtitle / tags…),
  // not the flattened { name, title } shape the composer carries.
  const [editingContact, setEditingContact] = useState(null);
  const rawById = useMemo(() => {
    const m = new Map();
    for (const c of rawContacts) {
      const id = c?.id ?? c?.vid;
      if (id != null) m.set(String(id), c);
    }
    return m;
  }, [rawContacts]);

  // Resolve a clicked recipient (a flattened composer contact) to the raw
  // HubSpot record. When it isn't in the cache — e.g. a Marketing Lead added
  // to the draft that was never a HubSpot contact — synthesize a raw-shaped
  // object from the flattened fields so the popup still opens and can create
  // the contact in HubSpot on save (mirrors MarketingLeadsView.buildLeadContact).
  function openContact(flat) {
    if (!flat) return;
    const raw = flat.id != null ? rawById.get(String(flat.id)) : null;
    if (raw) { setEditingContact(raw); return; }
    const parts = String(flat.name || '').trim().split(/\s+/).filter(Boolean);
    setEditingContact({
      id: flat.id,
      firstname: flat.firstName || parts[0] || '',
      lastname: flat.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : ''),
      email: flat.email || '',
      jobtitle: flat.title || '',
      company: flat.company || '',
      phone: flat.phone || '',
      city: flat.city || '',
      state: flat.state || '',
      hs_linkedin_url: flat.linkedinUrl || '',
    });
  }

  // Per-contact metadata handlers for the popup — thin settings-map updaters,
  // identical in shape to the Key Contacts / Marketing Leads pages so notes,
  // nicknames, tags, etc. written from here land in the same Firestore settings.
  const handleContactSaved = (_updated, opts) => { if (!opts?.silent) setEditingContact(null); };
  const saveSettingsMap = (mapKey, cid, value) => {
    if (cid == null) return;
    const cur = settings?.[mapKey] || {};
    const next = { ...cur };
    if (value && String(value).trim()) next[cid] = value; else delete next[cid];
    updateSettings({ [mapKey]: next });
  };

  // Pin the Company name typed in the Edit HubSpot Contact popup, so the
  // next HubSpot refresh doesn't rewrite it back from the Company record
  // the contact is associated with. See utils/contactCompanyOverride.js.
  const saveCompanyOverride = (contactId, value) => {
    const nextLocal = withCompanyOverride(settings?.contactLocalFields, contactId, value);
    if (nextLocal) updateSettings({ contactLocalFields: nextLocal });
  };

  // Same-company HubSpot contacts + company-name autocomplete for the popup's
  // Reports-To / company fields, mirroring the Key Contacts wiring.
  const editCompanyContacts = useMemo(() => {
    if (!editingContact) return [];
    const k = String(editingContact.company || '').trim().toLowerCase();
    if (!k) return [];
    return rawContacts.filter(c => String(c?.company || '').trim().toLowerCase() === k);
  }, [editingContact, rawContacts]);
  const editEmailDomains = useMemo(() => {
    if (!editingContact) return [];
    const k = String(editingContact.company || '').trim().toLowerCase();
    const matched = (prospects || []).find(p => String(p.company || '').trim().toLowerCase() === k);
    return matched?.emailDomain
      ? String(matched.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
      : [];
  }, [editingContact, prospects]);
  const editCompanyNames = useMemo(() => (prospects || []).map(p => p.company).filter(Boolean), [prospects]);

  // Inline edits from the Variable Coverage table. `{custom}` writes the
  // app-side value (settings.customField); HubSpot-backed variables push
  // through to HubSpot and optimistically update the selected-contact row
  // so the cell (and the live preview) reflect the change immediately.
  const handleCoverageEdit = async (contact, token, rawValue) => {
    const meta = COVERAGE_EDITABLE[token];
    if (!meta || !contact?.id) return;
    const value = String(rawValue ?? '').trim();
    if (meta.kind === 'custom') {
      const cur = settings?.customField || {};
      const next = { ...cur };
      if (value) next[contact.id] = value; else delete next[contact.id];
      updateSettings({ customField: next });
      return;
    }
    if (meta.kind === 'nickname') {
      const cur = settings?.contactNicknames || {};
      const next = { ...cur };
      if (value) next[contact.id] = value; else delete next[contact.id];
      updateSettings({ contactNicknames: next });
      return;
    }
    if (String(contact[meta.local] ?? '').trim() === value) return;
    const recomputeName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.name;
    setSelectedContacts(prev => prev.map(c => {
      if (c.id !== contact.id) return c;
      const nc = { ...c, [meta.local]: value };
      if (meta.local === 'firstName' || meta.local === 'lastName') nc.name = recomputeName(nc);
      return nc;
    }));
    try {
      const res = await apiFetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contact.id, properties: { [meta.prop]: value } }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
    } catch (err) {
      // Revert the optimistic change and surface the failure.
      setSelectedContacts(prev => prev.map(c => (
        c.id === contact.id ? { ...c, [meta.local]: contact[meta.local] || '', name: contact.name } : c
      )));
      alert(`Couldn't save ${meta.prop} to HubSpot: ${err?.message || err}`);
    }
  };


  // Close search dropdown on outside click
  useEffect(() => {
    if (!showSearch) return;
    const h = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showSearch]);

  // Close insert menu on outside click
  useEffect(() => {
    if (!showInsertMenu) return;
    const h = (e) => { if (insertRef.current && !insertRef.current.contains(e.target)) setShowInsertMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showInsertMenu]);

  useEffect(() => {
    if (!showDraftCcSuggestions) return;
    const h = (e) => { if (draftCcRef.current && !draftCcRef.current.contains(e.target)) setShowDraftCcSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showDraftCcSuggestions]);

  const draftCcSuggestions = draftCcInput.trim()
    ? allContacts.filter(c => !draftCc.includes(c.email) && (c.email.toLowerCase().includes(draftCcInput.toLowerCase()) || c.name.toLowerCase().includes(draftCcInput.toLowerCase()))).slice(0, 6)
    : [];


  // Lookup map: lower-cased company name → matched prospect's `type`
  // (e.g. "Private Equity"). Built from the Table View prospects list
  // so {companyType} substitution can land the right value per
  // recipient. We index by both the raw company string and a
  // suffix-stripped form ("acme inc" → "acme") so contacts with
  // slightly different company names still resolve.
  const companyTypeIndex = useMemo(() => {
    const strip = (s) => String(s || '').toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\b(inc|llc|ltd|corp|co|lp|gmbh|plc|sa|ag)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    const map = new Map();
    for (const p of (prospects || [])) {
      const t = (p?.type || '').trim();
      if (!t) continue;
      const k1 = String(p.company || '').toLowerCase().trim();
      if (k1 && !map.has(k1)) map.set(k1, t);
      const k2 = strip(p.company);
      if (k2 && !map.has(k2)) map.set(k2, t);
    }
    return { map, strip };
  }, [prospects]);

  function companyTypeFor(company) {
    if (!company) return '';
    const direct = companyTypeIndex.map.get(String(company).toLowerCase().trim());
    if (direct) return direct;
    const norm = companyTypeIndex.strip(company);
    return norm ? (companyTypeIndex.map.get(norm) || '') : '';
  }

  // What personalizeForContact would substitute for `token` on this
  // contact, unwrapped per-token so empties can be counted and coloured.
  // Hoisted out of the coverage table's props (where it used to be an
  // inline arrow) so the warning banner at the top of the page and the
  // table below both run the same resolution, and so the memo below
  // doesn't re-run on every render.
  const resolveVariable = useCallback((c, token) => {
    switch (token) {
      case '{firstName}': return c.firstName || (c.name || '').split(' ')[0] || '';
      case '{goesBy}':    return (settings?.contactNicknames || {})[c.id] || c.firstName || (c.name || '').split(' ')[0] || '';
      case '{lastName}':  return c.lastName || '';
      case '{fullName}':  return c.name || '';
      case '{email}':     return c.email || '';
      case '{company}':   return c.company || '';
      case '{companyType}': return companyTypeFor(c.company);
      case '{title}':     return c.title || '';
      case '{phone}':     return c.phone || '';
      case '{city}':      return c.city || '';
      case '{state}':     return c.state || '';
      case '{custom}':    return (settings?.customField || {})[c.id] || '';
      default:            return '';
    }
    // companyTypeFor is redeclared each render but only reads
    // companyTypeIndex, so that memo is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.contactNicknames, settings?.customField, companyTypeIndex]);

  function insertVariable(token) {
    if (lastFocused === 'subject') {
      const ref = subjectRef.current;
      if (ref) {
        const start = ref.selectionStart || subject.length;
        const end = ref.selectionEnd || subject.length;
        setSubject(subject.slice(0, start) + token + subject.slice(end));
        setShowInsertMenu(false);
        setTimeout(() => { ref.focus(); ref.selectionStart = ref.selectionEnd = start + token.length; }, 0);
      } else {
        setSubject(prev => prev + token);
        setShowInsertMenu(false);
      }
    } else {
      // Insert into Quill editor
      const quill = bodyRef.current?.getEditor?.();
      if (quill) {
        const range = quill.getSelection();
        const idx = range ? range.index : quill.getLength();
        quill.insertText(idx, token);
        quill.setSelection(idx + token.length);
      } else {
        setBody(prev => prev + token);
      }
      setShowInsertMenu(false);
    }
  }

  // Insert a blank line (extra spacing) into the body — same effect as
  // pressing Enter, no horizontal rule. Always targets the Quill editor;
  // a spacer makes no sense in the subject line.
  function insertDivider() {
    const quill = bodyRef.current?.getEditor?.();
    if (quill) {
      const range = quill.getSelection(true);
      const idx = range ? range.index : quill.getLength();
      quill.insertText(idx, '\n', 'user');
      quill.setSelection(idx + 1, 0);
      quill.focus();
    }
    setShowInsertMenu(false);
  }

  const filteredContacts = contactSearch.trim()
    ? allContacts.filter(c =>
        !selectedContacts.some(s => s.id === c.id) &&
        (c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
         c.email.toLowerCase().includes(contactSearch.toLowerCase()) ||
         c.company.toLowerCase().includes(contactSearch.toLowerCase()))
      ).slice(0, 10)
    : [];

  function addContact(contact) {
    setSelectedContacts(prev => [...prev, contact]);
    setContactSearch('');
    setShowSearch(false);
  }

  function removeContact(id) {
    setSelectedContacts(prev => prev.filter(c => c.id !== id));
  }

  // "Clear all" — reset the composer to a fresh email: drop the CC list, the
  // subject, the attachments, and the message body, and reset the To line to
  // just the user's own address (SELF_RECIPIENT). The body resets to the
  // "Hi {goesBy}," greeting rather than going fully blank, and the saved
  // signature (a separate field) is left untouched.
  function clearCompose() {
    const ok = window.confirm('Clear the CC, subject, message, and attachments? The To line is reset to your own address (daniel.baldauf@se.com), and the "Hi {goesBy}," greeting and your signature are kept.');
    if (!ok) return;
    setSelectedContacts([SELF_RECIPIENT]);
    setDraftCc([]);
    setSubject('');
    setBody(GREETING_BODY);
    setAttachments([]);
    setCritique(null);
  }

  // The saved-draft list is capped so it never grows unbounded, but that cap
  // applies to UNPINNED drafts only: every pinned draft is kept, plus at most
  // the 5 most recent unpinned ones (the list is newest-first). Pinning a
  // draft therefore protects it from being auto-removed.
  const UNPINNED_DRAFT_LIMIT = 5;
  function capUnpinnedDrafts(list) {
    let unpinned = 0;
    return list.filter(d => {
      if (d.pinned) return true;
      unpinned += 1;
      return unpinned <= UNPINNED_DRAFT_LIMIT;
    });
  }

  // `silent` archives the compose without touching the result banner —
  // used by the send paths, which have a more specific outcome to report
  // ("N .eml files downloading…") and would otherwise have it
  // immediately overwritten by "Draft saved".
  function saveDraft({ silent = false } = {}) {
    // Quill wraps empty content in <p><br></p> — check for actual content
    const bodyText = body.replace(/<[^>]*>/g, '').trim();
    if (!subject.trim() && !bodyText) return;
    const draft = {
      id: Date.now().toString(),
      subject: subject.trim(),
      body,
      contacts: selectedContacts,
      cc: draftCc,
      createdAt: new Date().toISOString(),
      pinned: false,
    };
    const updated = capUnpinnedDrafts([draft, ...drafts]);
    setDrafts(updated);
    if (silent) return;
    setResult({ type: 'success', message: 'Draft saved' });
    setTimeout(() => setResult(null), 3000);
  }

  // Pin / unpin a saved draft. Pinned drafts are exempt from the auto-drop
  // cap in saveDraft, so they stick around until deleted by hand.
  function togglePin(id) {
    setDrafts(drafts.map(d => (d.id === id ? { ...d, pinned: !d.pinned } : d)));
  }

  function loadDraft(draft) {
    setSubject(draft.subject || '');
    setBody(draft.body || '');
    setSelectedContacts(draft.contacts || []);
    setDraftCc(draft.cc || []);
  }

  function deleteDraft(id) {
    setDrafts(drafts.filter(d => d.id !== id));
  }

  function clearAllDrafts() {
    if (drafts.length === 0) return;
    const ok = window.confirm(`Delete all ${drafts.length} saved draft${drafts.length === 1 ? '' : 's'}? This cannot be undone.`);
    if (!ok) return;
    setDrafts([]);
    setResult({ type: 'success', message: 'All drafts cleared' });
  }

  // "Move to Email Campaign": save the current recipients as a named campaign
  // in Firestore (emailCampaigns/{uid}) — the same collection the Email
  // Campaigns subtab reads and the All Contacts "Email Campaigns" column
  // matches against (by lowercased email). The contacts stay in the draft
  // (copy, not a destructive move). Campaign shape mirrors
  // EmailCampaignView.handleSave so both places render it consistently; the
  // send/reply counters start at zero since nothing's been sent yet, and a
  // later real subject-search Save in the campaign tracker overwrites this
  // placeholder by subject.
  const [namingCampaign, setNamingCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [savingCampaign, setSavingCampaign] = useState(false);
  // Existing campaigns offered in the "Add to existing campaign" picker,
  // loaded fresh from Firestore each time the panel opens so the list is
  // current. `targetCampaign` is the chosen campaign's subject.
  const [existingCampaigns, setExistingCampaigns] = useState([]);
  const [targetCampaign, setTargetCampaign] = useState('');
  // Preview shown before merging into an existing campaign: which selected
  // contacts are new (will be added) and which are already on that campaign's
  // roster (will be skipped), so duplicates can't be added blind.
  const [campaignPreview, setCampaignPreview] = useState(null);

  // Open the campaign panel and pull the current campaign list so the user
  // can either name a new campaign or add to one that already exists.
  async function openCampaignPanel() {
    setCampaignName(subject.trim() || '');
    setTargetCampaign('');
    setNamingCampaign(true);
    if (!user?.uid) { setExistingCampaigns([]); return; }
    try {
      const snap = await getDoc(doc(db, 'emailCampaigns', user.uid));
      const list = snap.exists() ? (snap.data().campaigns || []) : [];
      setExistingCampaigns(list);
    } catch { setExistingCampaigns([]); }
  }

  // Build campaign contact rows from the current selection, deduped by
  // lowercased email and skipping any email already present in `skipEmails`
  // (used when merging into an existing campaign's roster).
  function buildCampaignContacts(skipEmails = []) {
    const seen = new Set(skipEmails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean));
    const contacts = [];
    for (const c of selectedContacts) {
      const email = String(c.email || '').trim();
      const key = email.toLowerCase();
      if (!email || seen.has(key)) continue;
      seen.add(key);
      contacts.push({ email, name: c.name || '', company: c.company || '', sentDate: '', replied: false, repliedBy: '', replyDate: '', recipientCount: 1, eventStatus: '' });
    }
    return contacts;
  }

  // Recompute the campaign summary counts from its roster after a merge,
  // mirroring EmailCampaignView.deriveCounts so both places agree. totalEmails
  // (real emails found by subject search) is left untouched.
  function deriveCampaignCounts(contacts) {
    const list = contacts || [];
    const sent = list.filter(c => !!c.sentDate).length;
    const replies = list.filter(c => c.replied).length;
    const responseRate = sent > 0 ? parseFloat(((replies / sent) * 100).toFixed(1)) : 0;
    return { totalContacts: list.length, sent, replies, uniqueRecipients: sent, uniqueRepliers: replies, responseRate };
  }

  // Split the current selection against a target campaign's roster (deduped by
  // lowercased email): which contacts are new (toAdd), which are already on the
  // roster or repeated within the selection (duplicates), and which can't be
  // added because they have no email (noEmail). Drives the confirmation popup.
  function splitSelectionForCampaign(target) {
    const rosterEmails = new Set(
      (Array.isArray(target?.contacts) ? target.contacts : [])
        .map(c => String(c.email || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const seen = new Set();
    const toAdd = [];
    const duplicates = [];
    const noEmail = [];
    for (const c of selectedContacts) {
      const email = String(c.email || '').trim();
      const key = email.toLowerCase();
      if (!email) { noEmail.push(c); continue; }
      if (rosterEmails.has(key) || seen.has(key)) { duplicates.push(c); continue; }
      seen.add(key);
      toAdd.push(c);
    }
    return { toAdd, duplicates, noEmail };
  }

  // Build the "which will be added / skipped" preview for the chosen campaign
  // and open the confirmation popup, rather than merging blind. Uses the
  // campaign list already loaded into the panel.
  function previewAddToExistingCampaign() {
    const name = targetCampaign.trim();
    if (!name) return;
    if (selectedContacts.length === 0) {
      setResult({ type: 'error', message: 'Add at least one contact before adding to a campaign' });
      return;
    }
    const target = existingCampaigns.find(c => String(c.subject || '').trim().toLowerCase() === name.toLowerCase());
    if (!target) {
      setResult({ type: 'error', message: `Campaign "${name}" no longer exists: refresh and try again.` });
      return;
    }
    setCampaignPreview({ name, ...splitSelectionForCampaign(target) });
  }

  // Commit the preview: add the current selection to the already-saved
  // campaign, deduped by email against a FRESH copy of its roster (so a
  // concurrent edit can't reintroduce a duplicate). Preserves tracking data.
  async function confirmAddToExistingCampaign() {
    const name = (campaignPreview?.name || targetCampaign).trim();
    if (!name) return;
    if (selectedContacts.length === 0) {
      setResult({ type: 'error', message: 'Add at least one contact before adding to a campaign' });
      return;
    }
    if (!user?.uid) {
      setResult({ type: 'error', message: 'You must be signed in to update a campaign' });
      return;
    }
    setSavingCampaign(true);
    try {
      const ref = doc(db, 'emailCampaigns', user.uid);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data().campaigns || []) : [];
      const idx = existing.findIndex(c => String(c.subject || '').trim().toLowerCase() === name.toLowerCase());
      if (idx === -1) {
        setResult({ type: 'error', message: `Campaign "${name}" no longer exists: refresh and try again.` });
        setCampaignPreview(null);
        setSavingCampaign(false);
        return;
      }
      const target = existing[idx];
      const currentContacts = Array.isArray(target.contacts) ? target.contacts : [];
      const added = buildCampaignContacts(currentContacts.map(c => c.email));
      if (added.length === 0) {
        setResult({ type: 'error', message: 'Every selected contact with an email is already in that campaign.' });
        setCampaignPreview(null);
        setSavingCampaign(false);
        return;
      }
      const mergedContacts = [...currentContacts, ...added];
      const nowISO = new Date().toISOString();
      const updated = { ...target, contacts: mergedContacts, ...deriveCampaignCounts(mergedContacts) };
      const nextCampaigns = existing.map((c, i) => (i === idx ? updated : c));
      await setDoc(ref, { campaigns: nextCampaigns, updatedAt: nowISO });
      // Keep the in-panel campaign list current so the dropdown count and any
      // follow-up preview reflect the just-added contacts.
      setExistingCampaigns(nextCampaigns);
      setResult({ type: 'success', message: `Added ${added.length} contact${added.length === 1 ? '' : 's'} to Email Campaign "${name}".` });
      setCampaignPreview(null);
      setNamingCampaign(false);
      setTargetCampaign('');
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setResult({ type: 'error', message: 'Failed to add to campaign: ' + (err?.message || 'unknown error') });
    } finally {
      setSavingCampaign(false);
    }
  }

  async function saveAsCampaign() {
    const name = campaignName.trim();
    if (!name) return;
    if (selectedContacts.length === 0) {
      setResult({ type: 'error', message: 'Add at least one contact before moving to a campaign' });
      return;
    }
    if (!user?.uid) {
      setResult({ type: 'error', message: 'You must be signed in to save a campaign' });
      return;
    }
    setSavingCampaign(true);
    try {
      const ref = doc(db, 'emailCampaigns', user.uid);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data().campaigns || []) : [];
      // Don't clobber an existing campaign (which may hold real tracking
      // data) that happens to share this name — ask for a unique one.
      if (existing.some(c => String(c.subject || '').trim().toLowerCase() === name.toLowerCase())) {
        setResult({ type: 'error', message: `A campaign named "${name}" already exists: choose a different name or add to it instead.` });
        setSavingCampaign(false);
        return;
      }
      // Recipients, deduped by lowercased email.
      const contacts = buildCampaignContacts();
      if (contacts.length === 0) {
        setResult({ type: 'error', message: 'None of the selected contacts have an email address' });
        setSavingCampaign(false);
        return;
      }
      const nowISO = new Date().toISOString();
      // Nothing has been emailed yet, so the send/reply counters start at zero;
      // the roster is tracked separately as totalContacts. Opening the campaign
      // in the Email Campaigns tab folds in real send/reply activity by subject.
      const campaign = {
        subject: name,
        savedAt: nowISO,
        source: 'draft-emails',
        uniqueRecipients: 0,
        uniqueRepliers: 0,
        responseRate: 0,
        totalEmails: contacts.length,
        totalContacts: contacts.length,
        sent: 0,
        replies: 0,
        autoRepliesSuppressed: 0,
        removedEmails: [],
        contacts,
      };
      await setDoc(ref, { campaigns: [campaign, ...existing], updatedAt: nowISO });
      setResult({ type: 'success', message: `Saved ${contacts.length} contact${contacts.length === 1 ? '' : 's'} to Email Campaign "${name}": find it under the Email Campaigns tab.` });
      setNamingCampaign(false);
      setCampaignName('');
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setResult({ type: 'error', message: 'Failed to save campaign: ' + (err?.message || 'unknown error') });
    } finally {
      setSavingCampaign(false);
    }
  }

  function htmlToPlainText(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr[^>]*>/gi, '\n----------------------\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<\/li>\s*/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/?(ol|ul)[^>]*>/gi, '\n')
      .replace(/<\/?(strong|b)[^>]*>/gi, '')
      .replace(/<\/?(em|i)[^>]*>/gi, '')
      .replace(/<\/?(u)[^>]*>/gi, '')
      .replace(/<\/?(s|strike|del)[^>]*>/gi, '')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function personalizeForContact(text, c) {
    const toAlsoMap = settings?.toAlsoMap || {};
    const hasToAlso = (toAlsoMap[c.email] || []).length > 0;
    // {custom} pulls from settings.customField — a per-contact value
    // typed manually in the "Custom" column on the Contacts page,
    // keyed by HubSpot contact id.
    const customField = (settings?.customField || {})[c.id] || '';
    // {goesBy} uses the saved nickname when present, otherwise falls back to
    // the first name so a greeting never renders blank.
    const goesBy = (settings?.contactNicknames || {})[c.id] || '';
    return text
      .replace(/\{firstName\}/gi, hasToAlso ? 'Team' : (c.firstName || c.name.split(' ')[0] || ''))
      .replace(/\{goesBy\}/gi, hasToAlso ? 'Team' : (goesBy || c.firstName || c.name.split(' ')[0] || ''))
      .replace(/\{lastName\}/gi, hasToAlso ? '' : (c.lastName || ''))
      .replace(/\{fullName\}/gi, hasToAlso ? 'Team' : (c.name || ''))
      .replace(/\{email\}/gi, c.email || '')
      .replace(/\{company\}/gi, c.company || '')
      .replace(/\{companyType\}/gi, companyTypeFor(c.company))
      .replace(/\{title\}/gi, c.title || '')
      .replace(/\{phone\}/gi, c.phone || '')
      .replace(/\{city\}/gi, c.city || '')
      .replace(/\{state\}/gi, c.state || '')
      .replace(/\{custom\}/gi, customField);
  }

  function openDraftForContact(c) {
    const personalBodyHtml = personalizeForContact(body, c);
    const styledHtml = buildStyledBodyHtml(personalBodyHtml);
    const personalBodyPlain = htmlToPlainText(personalBodyHtml);
    const personalSubject = personalizeForContact(subject, c);
    let trimmedBody = personalBodyPlain;
    const baseUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(c.email)}&subject=${encodeURIComponent(personalSubject)}&body=`;
    if (baseUrl.length + encodeURIComponent(personalBodyPlain).length > 1900) {
      trimmedBody = personalBodyPlain.slice(0, 800) + '\n\n[Paste full message from clipboard: Ctrl+A then Ctrl+V]';
    }
    // Copy formatted HTML to clipboard so user can paste with Ctrl+V in Outlook
    try {
      const htmlBlob = new Blob([styledHtml], { type: 'text/html' });
      const textBlob = new Blob([personalBodyPlain], { type: 'text/plain' });
      navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
    } catch {
      navigator.clipboard.writeText(personalBodyPlain).catch(() => {});
    }
    window.open(baseUrl + encodeURIComponent(trimmedBody), '_blank');
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        setResult({ type: 'error', message: `${file.name} is too large (max 10MB)` });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: reader.result,
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function removeAttachment(idx) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function toQuotedPrintable(str) {
    // Encode each byte that needs encoding
    const encoded = str.replace(/[^\t\n\r\x20-\x3C\x3E-\x7E]/g, (ch) => {
      // This regex excludes = (0x3D) from the "safe" range, so = gets encoded
      const bytes = new TextEncoder().encode(ch);
      return Array.from(bytes).map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    });
    // Soft-wrap lines longer than 76 chars
    return encoded.split('\n').map(line => {
      const parts = [];
      while (line.length > 75) {
        let cut = 75;
        // Don't break in the middle of an encoded sequence (=XX)
        if (line[cut - 1] === '=') cut -= 1;
        else if (cut >= 2 && line[cut - 2] === '=') cut -= 2;
        parts.push(line.slice(0, cut) + '=');
        line = line.slice(cut);
      }
      parts.push(line);
      return parts.join('\r\n');
    }).join('\r\n');
  }

  async function generateEmlFiles({ onlyFirst = false } = {}) {
    if (selectedContacts.length === 0 || !subject.trim()) return;

    const ccMap = settings?.ccMap || {};
    const toAlsoMap = settings?.toAlsoMap || {};
    // Optionally limit to just the first selected contact — useful
    // when you want to spot-check a single .eml before unleashing
    // drafts for the whole list.
    const contactsToProcess = onlyFirst ? selectedContacts.slice(0, 1) : selectedContacts;

    // Assemble each recipient's headers + HTML body first.
    const prepared = contactsToProcess.map((c) => {
      const pBodyHtml = personalizeForContact(body, c);
      const pSubject = personalizeForContact(subject, c);
      const contactCc = ccMap[c.email] || [];
      const allCc = [...new Set([...contactCc, ...draftCc])];
      const toAlso = toAlsoMap[c.email] || [];
      const allTo = [c.email, ...toAlso];

      const toHeader = allTo.map((addr, j) => j === 0 ? `${c.name} <${addr}>` : `<${addr}>`).join(', ');
      const ccHeader = allCc.length > 0 ? `Cc: ${allCc.join(', ')}\r\n` : '';

      // Same paragraph-spacing fix as the Outlook draft path, plus the
      // signature block (the .eml is opened/sent as-is, so it carries its own
      // signature rather than relying on Outlook to add one).
      const htmlContent = buildStyledBodyHtml(pBodyHtml, { signature });
      return { c, pSubject, toHeader, ccHeader, htmlContent };
    });

    // When tracking is on, hand each body to the server to inject the
    // open pixel + rewrite links and register the tracking docs. The
    // returned HTML replaces the plain body. A failure here is
    // non-fatal — we fall back to the untracked body so the send still
    // goes out.
    if (trackEmails) {
      try {
        const res = await apiFetch('/api/track-prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: prepared.map(p => ({
              to: p.c.email,
              name: p.c.name,
              subject: p.pSubject,
              html: p.htmlContent,
            })),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          (data.items || []).forEach((it, i) => {
            if (it && typeof it.html === 'string' && prepared[i]) prepared[i].htmlContent = it.html;
          });
        } else {
          console.error('track-prepare failed:', res.status);
        }
      } catch (err) {
        console.error('track-prepare error:', err?.message || err);
      }
    }

    // Build every recipient's .eml in memory.
    //
    // The body's section is whatever the content needs: a plain text/html
    // part, or a multipart/related carrying the HTML plus every inline image
    // as its own part with a Content-ID. This runs AFTER the tracking pass
    // above on purpose — the open pixel is an <img> with an http src, which
    // stays a real URL; only `data:` sources become cid: references.
    const built = prepared.map(({ c, pSubject, toHeader, ccHeader, htmlContent }) => {
      const { lines: htmlLines } = htmlSectionLines(htmlContent);
      let eml;
      if (attachments.length > 0) {
        const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'MIME-Version: 1.0',
          `Subject: ${pSubject}`,
          `To: ${toHeader}`,
          ccHeader ? ccHeader.trim() : null,
          'X-Unsent: 1',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          ...htmlLines,
        ].filter(line => line !== null);

        const attachParts = attachments.map(att => {
          const base64Data = att.dataUrl.split(',')[1] || '';
          return [
            `--${boundary}`,
            `Content-Type: ${att.type || 'application/octet-stream'}; name="${att.name}"`,
            `Content-Disposition: attachment; filename="${att.name}"`,
            'Content-Transfer-Encoding: base64',
            '',
            base64Data,
          ].join('\r\n');
        });

        eml = headers.join('\r\n') + '\r\n' + attachParts.join('\r\n') + `\r\n--${boundary}--`;
      } else {
        eml = [
          'MIME-Version: 1.0',
          `Subject: ${pSubject}`,
          `To: ${toHeader}`,
          ccHeader ? ccHeader.trim() : null,
          'X-Unsent: 1',
          ...htmlLines,
        ].filter(line => line !== null).join('\r\n');
      }

      const safeName = (c.name || c.email).replace(/[^a-zA-Z0-9]/g, '_');
      return { fileName: `draft_${safeName}.eml`, eml };
    });

    // Always download each draft as its own .eml — no .zip wrapping.
    // Filenames are deduped so two contacts whose names normalise the
    // same don't clobber each other in the Downloads folder.
    const seen = new Map();
    built.forEach((b, i) => {
      let name = b.fileName;
      const count = (seen.get(name) || 0) + 1;
      seen.set(name, count);
      if (count > 1) {
        const dot = name.lastIndexOf('.');
        name = dot >= 0 ? `${name.slice(0, dot)}_${count}${name.slice(dot)}` : `${name}_${count}`;
      }
      const blob = new Blob([b.eml], { type: 'message/rfc822' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      setTimeout(() => { a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }, i * 300);
    });

    setResult({ type: 'success', message: `${built.length} .eml file${built.length !== 1 ? 's' : ''} downloading to your Downloads folder: double-click each to open in Outlook.` });
    saveDraft({ silent: true });
  }

  // Duplicate detection for the To section. An address that would actually be
  // delivered more than once from THIS section is a double-send, so we tally
  // every address the section sends to — each primary recipient plus each
  // contact's folded-in "To Also" and "CC" extras — and flag any address whose
  // total count is 2+. Only real duplicates within this section are flagged: a
  // contact's own address isn't counted against itself, and the separate
  // draft-level CC field is intentionally left out of the tally.
  const sectionEmailCounts = (() => {
    const counts = new Map();
    const bump = (addr) => {
      const a = (addr || '').trim().toLowerCase();
      if (!a) return;
      counts.set(a, (counts.get(a) || 0) + 1);
    };
    for (const c of selectedContacts) {
      const self = (c.email || '').trim().toLowerCase();
      bump(self);
      for (const addr of ((settings?.toAlsoMap || {})[c.email] || [])) {
        const a = (addr || '').trim().toLowerCase();
        if (a && a !== self) bump(a);
      }
      for (const addr of ((settings?.ccMap || {})[c.email] || [])) {
        const a = (addr || '').trim().toLowerCase();
        if (a && a !== self) bump(a);
      }
    }
    return counts;
  })();
  const isSectionDuplicate = (addr) => (sectionEmailCounts.get((addr || '').trim().toLowerCase()) || 0) >= 2;

  // Computed once for the whole page: the warning banner at the top and
  // the Variable Coverage table below both read it, so the headline count
  // and the per-column counts are the same numbers by construction.
  const varCoverage = useMemo(
    () => computeVariableCoverage({
      subject, body, contacts: selectedContacts,
      insertVariables: INSERT_VARIABLES, resolve: resolveVariable,
    }),
    [subject, body, selectedContacts, resolveVariable],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Draft Emails</h2>
        <p className={styles.desc}>Compose an email, tag contacts, and download drafts for Outlook.</p>
      </div>

      {/* Above everything, because it's the one thing that should stop a
          send. On the coverage card it sat below the fold in the right
          column, which is a warning you scroll past. */}
      <CoverageWarning
        gaps={varCoverage.gaps}
        affected={varCoverage.affected}
        total={varCoverage.total}
      />

      <div className={styles.layout}>
        {/* Compose area */}
        <div className={styles.composeCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '1rem' }}>
            <h3 className={styles.cardTitle} style={{ marginBottom: 0 }}>Compose</h3>
            <button
              type="button"
              onClick={clearCompose}
              title={'Clear recipients, subject, message, and attachments. Keeps the "Hi {goesBy}," greeting and your signature.'}
              style={{ padding: '0.25rem 0.6rem', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', color: '#B91C1C', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >Clear all</button>
          </div>

          {/* Tagged contacts */}
          <div className={styles.field}>
            <label className={styles.label}>To {selectedContacts.length > 0 && <button onClick={() => setSelectedContacts([])} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 400, textTransform: 'none', letterSpacing: 0, padding: 0, marginLeft: '0.3rem' }}>Clear all</button>}</label>
            <div className={styles.contactsBox}>
              {selectedContacts.map(c => {
                // Surface the per-contact extra recipients configured in the
                // contact popup so they're visible right in the To box, not
                // just on hover. "To Also" addresses (amber) get folded into
                // this contact's To line on send; "CC" addresses (blue) get
                // CC'd. A CC address that is ALSO a primary To recipient in
                // this draft would double-send, so it's flagged red.
                const toAlso = (settings?.toAlsoMap || {})[c.email] || [];
                const contactCc = (settings?.ccMap || {})[c.email] || [];
                const selfDup = isSectionDuplicate(c.email);
                const hasExtras = toAlso.length > 0 || contactCc.length > 0;
                const extraPill = {
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  maxWidth: '100%', padding: '0 6px', borderRadius: 999,
                  fontSize: '0.62rem', lineHeight: 1.7, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                };
                const pillLabel = { fontWeight: 800, fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.03em' };
                return (
                  <span
                    key={c.id}
                    className={styles.contactTag}
                    title={selfDup ? 'Duplicate recipient: this address also appears elsewhere in the To section (double-send)' : undefined}
                    style={{
                      ...(hasExtras ? { flexDirection: 'column', alignItems: 'flex-start', whiteSpace: 'normal', gap: '0.2rem' } : {}),
                      ...(selfDup ? { background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' } : {}),
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', maxWidth: '100%' }}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => openContact(c)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContact(c); } }}
                        title={`Open ${c.name}`}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      >{c.name}</span> <span className={styles.contactEmail}>({c.email})</span>
                      {selfDup && <span title="Double-send: this address appears more than once in the To section" style={{ fontWeight: 800, color: '#991B1B' }}>⚑</span>}
                      <button className={styles.removeTag} onClick={() => removeContact(c.id)}>&times;</button>
                    </span>
                    {hasExtras && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', maxWidth: '100%' }}>
                        {toAlso.map(email => {
                          const dup = isSectionDuplicate(email);
                          return (
                          <span
                            key={`to|${email}`}
                            title={dup ? `Appears more than once in the To section: would receive two copies` : `Added to the To line alongside ${c.name}`}
                            style={{ ...extraPill, ...(dup
                              ? { background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }
                              : { background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }) }}
                          >
                            <span style={pillLabel}>To</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
                            {dup && <span title="Double-send" style={{ fontWeight: 800 }}>⚑</span>}
                          </span>
                          );
                        })}
                        {contactCc.map(email => {
                          const dup = isSectionDuplicate(email);
                          return (
                            <span
                              key={`cc|${email}`}
                              title={dup ? `Appears more than once in the To section: would receive two copies (once on To, once on CC)` : `CC'd on the email to ${c.name}`}
                              style={{ ...extraPill, ...(dup
                                ? { background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }
                                : { background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }) }}
                            >
                              <span style={pillLabel}>CC</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
                              {dup && <span title="Double-send" style={{ fontWeight: 800 }}>⚑</span>}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                );
              })}
              <div style={{ position: 'relative', flex: 1, minWidth: '150px' }} ref={searchRef}>
                <input
                  className={styles.contactSearchInput}
                  type="text"
                  value={contactSearch}
                  onChange={e => { setContactSearch(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  placeholder={selectedContacts.length === 0 ? "Search contacts by name, email, or company..." : "Add more..."}
                />
                {showSearch && filteredContacts.length > 0 && (
                  <div className={styles.searchDropdown}>
                    {filteredContacts.map(c => (
                      <button key={c.id} className={styles.searchResult} onClick={() => addContact(c)}>
                        <span className={styles.searchName}>{c.name}</span>
                        <span className={styles.searchMeta}>{c.email} {c.company && `· ${c.company}`}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Draft-level CC */}
          <div className={styles.field}>
            <label className={styles.label}>CC</label>
            <div className={styles.contactsBox}>
              {draftCc.map(email => (
                <span key={email} className={styles.contactTag} style={{ background: '#FEF3C7', borderColor: '#FDE68A', color: '#92400E' }}>
                  {email}
                  <button className={styles.removeTag} style={{ color: '#FCD34D' }} onClick={() => setDraftCc(prev => prev.filter(e => e !== email))}>&times;</button>
                </span>
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: '120px' }} ref={draftCcRef}>
                <input
                  className={styles.contactSearchInput}
                  value={draftCcInput}
                  onChange={e => { setDraftCcInput(e.target.value); setShowDraftCcSuggestions(true); }}
                  onFocus={() => setShowDraftCcSuggestions(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draftCcInput.includes('@')) { e.preventDefault(); setDraftCc(prev => [...prev, draftCcInput.trim()]); setDraftCcInput(''); }
                    if (e.key === 'Backspace' && !draftCcInput && draftCc.length > 0) setDraftCc(prev => prev.slice(0, -1));
                  }}
                  placeholder={draftCc.length === 0 ? 'Add CC recipients...' : 'Add more...'}
                />
                {showDraftCcSuggestions && draftCcSuggestions.length > 0 && (
                  <div className={styles.searchDropdown}>
                    {draftCcSuggestions.map(c => (
                      <button key={c.id} className={styles.searchResult} onClick={() => { setDraftCc(prev => [...prev, c.email]); setDraftCcInput(''); setShowDraftCcSuggestions(false); }}>
                        <span className={styles.searchName}>{c.name}</span>
                        <span className={styles.searchMeta}>{c.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Subject</label>
            <input
              ref={subjectRef}
              className={styles.input}
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onFocus={() => setLastFocused('subject')}
              placeholder="Email subject line..."
            />
          </div>

          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem', gap: 8, flexWrap: 'wrap' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>Body</label>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={runCritique}
                  disabled={critiqueBusy}
                  title="Send the current subject + body to Claude for a sales-coach critique. Returns a score, what's working, what to cut, and a tighter rewrite."
                  style={{
                    padding: '0.3rem 0.7rem',
                    border: '1px solid #7C3AED',
                    background: critiqueBusy ? '#EDE9FE' : '#7C3AED',
                    color: critiqueBusy ? '#5B21B6' : '#fff',
                    borderRadius: 4,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: critiqueBusy ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >{critiqueBusy ? 'Reviewing…' : '✨ Critique with Claude'}</button>
                <div style={{ position: 'relative' }} ref={insertRef}>
                  <button
                    className={styles.insertBtn}
                    onClick={() => setShowInsertMenu(p => !p)}
                    type="button"
                  >
                    + Insert Variable
                  </button>
                  {showInsertMenu && (
                    <div className={styles.insertDropdown}>
                      {INSERT_VARIABLES.map(v => (
                        <button
                          key={v.token}
                          className={styles.insertOption}
                          onClick={() => insertVariable(v.token)}
                        >
                          <span className={styles.insertToken}>{v.token}</span>
                          <span className={styles.insertLabel}>{v.label}</span>
                          <span className={styles.insertExample}>e.g. {v.example}</span>
                        </button>
                      ))}
                      <div className={styles.insertDivLine} />
                      <button
                        className={styles.insertOption}
                        onClick={insertDivider}
                        type="button"
                      >
                        <span className={styles.insertToken}>↵</span>
                        <span className={styles.insertLabel}>Page break</span>
                        <span className={styles.insertExample}>blank line, like pressing Enter</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {critique && (
              <CritiquePanel
                critique={critique}
                onClose={() => setCritique(null)}
                onUseRewrite={() => {
                  if (critique.rewriteSubject) setSubject(critique.rewriteSubject);
                  if (critique.rewriteBody) setBody(critique.rewriteBody.replace(/\n/g, '<br>'));
                  setCritique(null);
                }}
              />
            )}
            {autosaveFailed && (
              <div style={{
                margin: '0 0 0.4rem', padding: '0.4rem 0.6rem',
                background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6,
                fontSize: '0.74rem', color: '#92400E', lineHeight: 1.4,
              }}>
                <strong>This draft is too big to auto-save.</strong> Usually a large pasted
                image. The draft is still fine to send — but it won't be restored if you
                close the tab, so download it before you navigate away (or remove the image).
              </div>
            )}
            <div className={styles.editorWrap} onClick={() => setLastFocused('body')}>
              <ReactQuill
                ref={bodyRef}
                theme="snow"
                value={body}
                onChange={setBody}
                placeholder="Hi {firstName}, I hope this message finds you well..."
                modules={bodyQuillModules}
                formats={['bold', 'italic', 'underline', 'strike', 'list', 'link', 'divider', 'image']}
              />
            </div>
          </div>

          {/* Attachments */}
          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>Attachments</label>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
              <button onClick={() => fileInputRef.current?.click()} style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}>
                + Add Files
              </button>
            </div>
            {attachments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.6rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                    <span style={{ fontSize: '0.82rem' }}>📎</span>
                    <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatFileSize(a.size)}</span>
                    <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.9rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>No attachments. Files will be noted in the draft for manual attachment in Outlook.</p>
            )}
          </div>

          {/* Signature */}
          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>
                Signature
                {signature && !showSignatureEditor && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#22C55E', marginLeft: '0.4rem' }}>✓ Saved</span>}
              </label>
              <button
                onClick={() => setShowSignatureEditor(p => !p)}
                style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
              >
                {showSignatureEditor ? 'Done' : signature ? 'Edit' : '+ Add Signature'}
              </button>
            </div>
            {showSignatureEditor && (
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0 0 0.4rem' }}>
                  Paste your Outlook signature below. Tip: copy it from an existing email to keep formatting.
                </p>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={e => {
                    const html = e.currentTarget.innerHTML;
                    setSignature(html);
                    updateSettings({ emailSignature: html });
                  }}
                  dangerouslySetInnerHTML={{ __html: signature }}
                  style={{ minHeight: '80px', padding: '0.6rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text)', outline: 'none', background: '#FAFAFA' }}
                />
              </div>
            )}
            {!showSignatureEditor && signature && (
              <div
                dangerouslySetInnerHTML={{ __html: signature }}
                style={{ padding: '0.5rem 0.75rem', background: '#FAFAFA', border: '1px solid #E5E5E5', borderRadius: '6px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--color-text)', maxHeight: '120px', overflow: 'hidden' }}
              />
            )}
          </div>

          {result && (
            <div className={`${styles.result} ${styles[`result_${result.type}`]}`}>
              {result.message}
            </div>
          )}

          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.6rem', fontSize: '0.76rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
            title="Adds an invisible open pixel and rewrites links so you can see opens & clicks in the Email Tracking tab. Note: opens are approximate: Apple Mail & Gmail can pre-load or block the pixel."
          >
            <input
              type="checkbox"
              checked={trackEmails}
              onChange={e => { setTrackEmails(e.target.checked); updateSettings({ trackEmails: e.target.checked }); }}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span>Track opens &amp; clicks <span style={{ color: 'var(--color-text-muted)' }}>(view in the Email Tracking tab)</span></span>
          </label>

          <div className={styles.actions}>
            <button className={styles.primaryBtn} onClick={() => generateEmlFiles()} disabled={selectedContacts.length === 0 || !subject.trim()}>
              Download {selectedContacts.length || ''} Draft{selectedContacts.length !== 1 ? 's' : ''} for Outlook
            </button>
            {selectedContacts.length > 1 && (
              <button
                className={styles.secondaryBtn}
                onClick={() => generateEmlFiles({ onlyFirst: true })}
                disabled={!subject.trim()}
                title={`Generate just the first draft (${selectedContacts[0]?.name || selectedContacts[0]?.email || ''})`}
              >
                Download first only
              </button>
            )}
            <button className={styles.secondaryBtn} onClick={() => saveDraft()} disabled={!subject.trim() && !body.trim()}>
              Save Draft
            </button>
          </div>

          {/* Preview — all contacts with tabs */}
          {selectedContacts.length > 0 && (subject.trim() || body.trim()) && (
            <PreviewTabs contacts={selectedContacts} subject={subject} body={body} personalizeForContact={personalizeForContact} draftCc={draftCc} ccMap={settings?.ccMap || {}} toAlsoMap={settings?.toAlsoMap || {}} />
          )}
        </div>

        {/* Right sidebar: Tag import + Saved drafts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* All three right-column cards (Custom Email Campaign,
              Saved Drafts, Variable Coverage) share the .coverageCard
              widener so their visual widths match. The grid track is
              still 320 px — only the cards extend rightward, so the
              Compose column on the left doesn't move. */}
          {/* Custom Email Campaign — pulls contacts in two ways:
              (1) checkboxes ticked on the Active / Client / Key
              Contacts pages (see useDraftCampaignQueue), and
              (2) the existing tag-based importer below. Both sources
              feed the same draft, deduped by contact id. */}
          <div className={`${styles.draftsCard} ${styles.coverageCard}`}>
            <h3 className={styles.cardTitle}>Custom Email Campaign</h3>
            {/* Save the assembled recipients as a named campaign (Email
                Campaigns tab). Contacts stay in the draft. */}
            <div style={{ marginBottom: '0.6rem' }}>
              {!namingCampaign ? (
                <button
                  type="button"
                  onClick={openCampaignPanel}
                  disabled={selectedContacts.length === 0}
                  title={selectedContacts.length === 0 ? 'Add contacts first' : 'Add these contacts to a new or existing campaign under the Email Campaigns tab'}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #1D4ED8', borderRadius: 6, background: selectedContacts.length === 0 ? '#F1F5F9' : '#1D4ED8', color: selectedContacts.length === 0 ? '#94A3B8' : '#fff', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', cursor: selectedContacts.length === 0 ? 'default' : 'pointer' }}
                >Add to Email Campaign{selectedContacts.length > 0 ? ` (${selectedContacts.length})` : ''}</button>
              ) : (
                <div style={{ border: '1px solid #BFDBFE', background: '#EFF6FF', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                  {/* Add to an existing campaign — only shown when the user has
                      saved campaigns to add to. Merges into that roster. */}
                  {existingCampaigns.length > 0 && (
                    <div style={{ marginBottom: '0.6rem' }}>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#1E3A8A', marginBottom: 4 }}>Add to existing campaign</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          value={targetCampaign}
                          onChange={e => setTargetCampaign(e.target.value)}
                          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '0.35rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.74rem', fontFamily: 'inherit', background: '#fff' }}
                        >
                          <option value="">Choose a campaign…</option>
                          {existingCampaigns.map((c, i) => {
                            const subj = String(c.subject || '').trim();
                            const count = c.totalContacts ?? c.contacts?.length ?? 0;
                            return <option key={i} value={subj}>{subj || '(untitled)'}: {count}</option>;
                          })}
                        </select>
                        <button
                          type="button"
                          onClick={previewAddToExistingCampaign}
                          disabled={savingCampaign || !targetCampaign}
                          style={{ padding: '0.25rem 0.7rem', border: 'none', background: (savingCampaign || !targetCampaign) ? '#93C5FD' : '#1D4ED8', color: '#fff', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: (savingCampaign || !targetCampaign) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                        >{savingCampaign ? 'Adding…' : 'Review & add'}</button>
                      </div>
                      <div style={{ textAlign: 'center', fontSize: '0.66rem', fontWeight: 700, color: '#93A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0.55rem 0 0.2rem' }}>or create new</div>
                    </div>
                  )}
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#1E3A8A', marginBottom: 4 }}>Name this campaign</label>
                  <input
                    autoFocus
                    type="text"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); saveAsCampaign(); }
                      else if (e.key === 'Escape') { setNamingCampaign(false); setCampaignName(''); setTargetCampaign(''); }
                    }}
                    placeholder="e.g. Q3 PE Outreach"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.35rem 0.5rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.76rem', fontFamily: 'inherit', marginBottom: '0.45rem' }}
                  />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => { setNamingCampaign(false); setCampaignName(''); setTargetCampaign(''); }}
                      disabled={savingCampaign}
                      style={{ padding: '0.25rem 0.6rem', border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={saveAsCampaign}
                      disabled={savingCampaign || !campaignName.trim()}
                      style={{ padding: '0.25rem 0.7rem', border: 'none', background: (savingCampaign || !campaignName.trim()) ? '#93C5FD' : '#1D4ED8', color: '#fff', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: (savingCampaign || !campaignName.trim()) ? 'default' : 'pointer' }}
                    >{savingCampaign ? 'Saving…' : `Save ${selectedContacts.length} contact${selectedContacts.length === 1 ? '' : 's'}`}</button>
                  </div>
                </div>
              )}
            </div>
            <CampaignQueueSection
              allContacts={allContacts}
              selectedContacts={selectedContacts}
              setSelectedContacts={setSelectedContacts}
            />
            <MarketingLeadsQueueSection
              selectedContacts={selectedContacts}
              setSelectedContacts={setSelectedContacts}
            />
            <CampaignRecipientsQueueSection
              selectedContacts={selectedContacts}
              setSelectedContacts={setSelectedContacts}
            />
            <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>Import by Tag</h4>
              <TagContactPicker
                allContacts={allContacts}
                selectedContacts={selectedContacts}
                onAdd={addContact}
                onRemove={removeContact}
                onBulkAdd={(contacts) => setSelectedContacts(prev => {
                  const ids = new Set(prev.map(c => c.id));
                  return [...prev, ...contacts.filter(c => !ids.has(c.id))];
                })}
                onBulkRemove={(ids) => setSelectedContacts(prev => prev.filter(c => !ids.includes(c.id)))}
              />
            </div>
            <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>Import by Notes</h4>
              <NoteContactPicker
                contactNotes={settings?.contactNotes || {}}
                selectedContacts={selectedContacts}
                onAdd={addContact}
                onRemove={removeContact}
                onBulkAdd={(contacts) => setSelectedContacts(prev => {
                  const ids = new Set(prev.map(c => c.id));
                  return [...prev, ...contacts.filter(c => !ids.has(c.id))];
                })}
                onBulkRemove={(ids) => setSelectedContacts(prev => prev.filter(c => !ids.includes(c.id)))}
              />
            </div>
          </div>

          {/* Variable Coverage — table view of every selected contact
              and the resolved value for every variable token used in
              the current subject + body. Empty cells render in red so
              gaps in the personalization data are obvious before the
              user fires off the campaign. The .coverageCard class
              widens this single card past the 320 px right column so
              the table has room for many variable columns; nothing
              else on the page moves. */}
          <div className={`${styles.draftsCard} ${styles.coverageCard}`}>
            <VariableCoverageTable
              contacts={selectedContacts}
              usedTokens={varCoverage.usedTokens}
              coverage={varCoverage.coverage}
              resolve={resolveVariable}
              isEditable={token => !!COVERAGE_EDITABLE[token]}
              onEditField={handleCoverageEdit}
            />
          </div>

          {/* Saved drafts — sits below Variable Coverage. Unpinned drafts are
              capped at the 5 most recent (older ones drop automatically when a
              new draft is saved); pinned drafts (📌) are exempt and kept until
              deleted by hand. */}
          <div className={`${styles.draftsCard} ${styles.coverageCard}`}>
            <div className={styles.draftsHeader}>
              <h3 className={styles.cardTitle}>Saved Drafts ({drafts.length})</h3>
              {drafts.length > 0 && (
                <button className={styles.clearAllDrafts} onClick={clearAllDrafts} title="Delete all saved drafts">
                  Clear all
                </button>
              )}
            </div>
            {drafts.length === 0 ? (
              <p className={styles.emptyDrafts}>No saved drafts yet</p>
            ) : (
              <>
                <p className={styles.draftsHint}>
                  Only the 5 most recent drafts are kept automatically. Pin a draft (📌) to keep it from being removed.
                </p>
                <div className={styles.draftsList}>
                  {[...drafts]
                    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                    .map(d => (
                      <div key={d.id} className={`${styles.draftItem} ${d.pinned ? styles.draftItemPinned : ''}`}>
                        <button
                          className={`${styles.draftPin} ${d.pinned ? styles.draftPinActive : ''}`}
                          onClick={() => togglePin(d.id)}
                          aria-pressed={d.pinned}
                          title={d.pinned ? 'Pinned: kept from auto-removal. Click to unpin.' : 'Pin to keep this draft from being auto-removed.'}
                        >📌</button>
                        <button className={styles.draftLoad} onClick={() => loadDraft(d)}>
                          <span className={styles.draftSubject}>{d.subject || '(No subject)'}</span>
                          <span className={styles.draftMeta}>
                            {d.contacts?.length || 0} contact{(d.contacts?.length || 0) !== 1 ? 's' : ''} · {new Date(d.createdAt).toLocaleDateString()}
                          </span>
                        </button>
                        <button className={styles.draftDelete} onClick={() => deleteDraft(d.id)}>&times;</button>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {campaignPreview && createPortal(
        (() => {
          const { name, toAdd = [], duplicates = [], noEmail = [] } = campaignPreview;
          const label = (c) => `${c.name || c.email || '-'}${c.company ? ` · ${c.company}` : ''}`;
          const listBox = { maxHeight: 200, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.35rem 0.5rem', background: '#fff' };
          const rowStyle = { fontSize: '0.74rem', padding: '0.12rem 0', color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
          const headStyle = { fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 0.3rem' };
          return (
            <div
              onClick={() => { if (!savingCampaign) setCampaignPreview(null); }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{ width: 'min(560px, 100%)', maxHeight: '85vh', overflowY: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 20px 50px rgba(15,23,42,0.3)', padding: '1.1rem 1.25rem' }}
              >
                <h3 style={{ margin: '0 0 0.2rem', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
                  Add contacts to “{name}”
                </h3>
                <p style={{ margin: '0 0 0.85rem', fontSize: '0.76rem', color: '#475569' }}>
                  <strong style={{ color: '#166534' }}>{toAdd.length} new</strong> will be added
                  {duplicates.length > 0 && <> · <strong style={{ color: '#92400E' }}>{duplicates.length} already in the campaign</strong> (skipped)</>}
                  {noEmail.length > 0 && <> · <strong style={{ color: '#991B1B' }}>{noEmail.length} without an email</strong> (skipped)</>}
                </p>

                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ ...headStyle, color: '#166534' }}>Will be added ({toAdd.length})</div>
                  <div style={listBox}>
                    {toAdd.length ? toAdd.map((c, i) => <div key={c.id ?? c.email ?? i} style={rowStyle}>{label(c)}</div>)
                      : <div style={{ ...rowStyle, color: '#94A3B8', fontStyle: 'italic' }}>Nothing new: every selected contact is already in this campaign.</div>}
                  </div>
                </div>

                {duplicates.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ ...headStyle, color: '#92400E' }}>Already in campaign: skipped ({duplicates.length})</div>
                    <div style={{ ...listBox, background: '#FFFBEB' }}>
                      {duplicates.map((c, i) => <div key={c.id ?? c.email ?? i} style={{ ...rowStyle, color: '#78716C' }}>{label(c)}</div>)}
                    </div>
                  </div>
                )}

                {noEmail.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ ...headStyle, color: '#991B1B' }}>No email: can’t be added ({noEmail.length})</div>
                    <div style={{ ...listBox, background: '#FEF2F2' }}>
                      {noEmail.map((c, i) => <div key={c.id ?? i} style={{ ...rowStyle, color: '#B91C1C' }}>{label(c)}</div>)}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setCampaignPreview(null)}
                    disabled={savingCampaign}
                    style={{ padding: '0.4rem 0.85rem', border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600, fontFamily: 'inherit', cursor: savingCampaign ? 'default' : 'pointer' }}
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={confirmAddToExistingCampaign}
                    disabled={savingCampaign || toAdd.length === 0}
                    style={{ padding: '0.4rem 0.95rem', border: 'none', background: (savingCampaign || toAdd.length === 0) ? '#93C5FD' : '#1D4ED8', color: '#fff', borderRadius: 6, fontSize: '0.76rem', fontWeight: 700, fontFamily: 'inherit', cursor: (savingCampaign || toAdd.length === 0) ? 'default' : 'pointer' }}
                  >{savingCampaign ? 'Adding…' : `Add ${toAdd.length} contact${toAdd.length === 1 ? '' : 's'}`}</button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body,
      )}

      {editingContact && createPortal(
        <ContactEditModal
          contact={editingContact}
          onSave={handleContactSaved}
          onClose={() => setEditingContact(null)}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={(cid, v) => saveSettingsMap('contactNotes', cid, v)}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={(cid, v) => saveSettingsMap('contactOldEmails', cid, v)}
          contactOldCompany={settings?.contactOldCompany || {}}
          onSaveOldCompany={(cid, v) => saveSettingsMap('contactOldCompany', cid, v)}
          onSaveCompanyOverride={saveCompanyOverride}
          contactNicknames={settings?.contactNicknames || {}}
          onSaveNickname={(cid, v) => saveSettingsMap('contactNicknames', cid, v)}
          contactTeamNames={settings?.contactTeamNames || {}}
          onSaveTeamName={(cid, v) => saveSettingsMap('contactTeamNames', cid, v && v.trim())}
          contactReportsTo={settings?.contactReportsTo || {}}
          onSaveReportsTo={(cid, managerIds) => {
            if (cid == null) return;
            const cur = settings?.contactReportsTo || {};
            const next = { ...cur };
            const arr = Array.isArray(managerIds) ? managerIds.filter(Boolean).map(String) : (managerIds ? [String(managerIds)] : []);
            if (arr.length) next[cid] = arr; else delete next[cid];
            updateSettings({ contactReportsTo: next });
          }}
          ccMap={settings?.ccMap || {}}
          onSaveCcMap={m => updateSettings({ ccMap: m })}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveToAlsoMap={m => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings?.contactFamilies || {}}
          onSaveFamily={(cid, info) => {
            if (cid == null) return;
            const cur = settings?.contactFamilies || {};
            const next = { ...cur };
            const partner = String(info?.partner || '').trim();
            const kids = String(info?.kids || '').trim();
            if (!partner && !kids) delete next[cid]; else next[cid] = { partner, kids };
            updateSettings({ contactFamilies: next });
          }}
          contactMetInPerson={settings?.contactMetInPerson || {}}
          onSaveMetInPerson={(cid, met) => {
            if (cid == null) return;
            updateSettings({ contactMetInPerson: { ...(settings?.contactMetInPerson || {}), [cid]: !!met } });
          }}
          contactInvitedToLouisville={settings?.contactInvitedToLouisville || {}}
          onSaveInvitedToLouisville={(cid, invited) => {
            if (cid == null) return;
            updateSettings({ contactInvitedToLouisville: { ...(settings?.contactInvitedToLouisville || {}), [cid]: !!invited } });
          }}
          contactTagReview={settings?.contactTagReview || {}}
          onSaveTagReview={(cid, map) => saveTagReview({ cid, map, settings, updateSettings, updateSettingsPath })}
          companyContacts={editCompanyContacts}
          emailDomains={editEmailDomains}
          companyNames={editCompanyNames}
        />,
        document.body,
      )}
    </div>
  );
}
