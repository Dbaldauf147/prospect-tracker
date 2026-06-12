import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';
import { setOppField } from '../../utils/opps2Store';
import { dbGet, dbPut } from '../../utils/db';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { getOppsSheetCsvUrl } from '../../utils/oppsSheetUrl';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import { getEffectiveServiceMetadata } from '../../data/serviceCatalog';
import { OppInfoModal } from '../OppsView2/OppsView2';
import styles from './AgentsView.module.css';

// Manual BFO Opportunity tags the user picked for an email recipient
// (or meeting contact) that didn't auto-match an Opps-tab row. Keyed
// by lower-cased email (or meeting id when no contact email exists)
// so the next email to the same recipient re-uses the same tag.
const OVERRIDE_STORAGE_KEY = 'agents-bfo-overrides';
const IGNORED_EMAILS_STORAGE_KEY = 'agents-ignored-emails';
const IGNORED_MEETINGS_STORAGE_KEY = 'agents-ignored-meetings';
const HIDE_ACTIVITY_ON_DATE_STORAGE_KEY = 'agents-hide-activity-on-date';
// External recipient addresses the user has chosen to permanently
// exclude from the Sent emails table. Unlike IGNORED_EMAILS (one
// message at a time), this hides every current and future email sent
// to that recipient.
const EXCLUDED_RECIPIENTS_STORAGE_KEY = 'agents-excluded-recipients';
const AI_PROMPT_STORAGE_KEY = 'agents-ai-prompt';
const NEW_BFO_OPP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-new-bfo-opp';
const CLOSE_DATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-dates';
const AMOUNT_UPDATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-amount-updates';
const STAGE_CHANGE_PROMPT_STORAGE_KEY = 'agents-ai-prompt-stage-change';
const CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-not-solds';
const UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY = 'agents-ai-prompt-update-bfo-activity';
const BFO_PREP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-bfo-prep';

// IndexedDB store + key the BFO Activity tab persists its pasted rows
// into. The Close Dates + Amount Updates prompts read it so each row's
// BFO Sales Stage + Amount can be joined to the Opps tab data.
const BFO_ACTIVITY_STORE = 'bfo-activity';
const BFO_ACTIVITY_KEY = 'current';

const DEFAULT_AI_PROMPT = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Choose the New Tast (green button) under the Activity menu on the righthand side of the screen.
3.  In the Subject box type in email or call based on the second column of data (under Type) in this prompt.
4.  In the Due Date box enter todays date in the MM/DD/YYYY format.
5.  In the the Status box select completed.  IMPORTANT - THIS MUST NOT BE LISTED AS NOT STARTED.
6.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7.  Select the blue Save button without asking for my confirmation.
8.  Make sure this update does not save in the Up Comning & Overdue list.  If you see that Today this update shows there, go back in and update this to the Completed Status.
9.  Complete  these steps for the next BFO Address until all have been completed.
10.  Run through the whole list automatically and then report back the success of each one until they're all done.
11.  When that's completed, go further below to take the next steps. `;

const DEFAULT_AI_PROMPT_NEW_BFO_OPP = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Search the top BFO Account Name.  Click on that account name to open up the account page.
3. Click the New Guided Opportunity button.
4. Enter in the Project Name into the Project Name field.  DO NOT include the Project Line name into this field or the Local Project Name field.
5.  Then paste in the Local Project Name into the Local Project Name box and then click Next.  DO NOT include the Product Line in this box.
6. Select Sustainability on the menu list.
7. Click the + sign next to the relevant Product Line assocaited with this BFO Opportuntiy and enter in 80000 and then click Next.
8 . Answer this question as no "*1. Does the opportunity scope ONLY include Carbon Credit?
9. Next make the close date 150 days from today and then click Next.
10.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
11. On the next page click Create.  When you get to this step, dont ask me for permission to Create.  Just click create and continue until this process is done.
12. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_CLOSE_DATES = `1.  I am logged into BFO.  Open up this BFO page https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the Opportunity Names below, and then go to their corresponding CloseDateSorted or CloseDate column.  This should be the 5th column of the table.
3.  Then click the pencil button next to the close date and input the New Close Date value and press Enter.
4.  At the bottom of the screen you will then click the Save button.
5.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_AMOUNT_UPDATES = `1. Open up the BFO Address below.
2. Select Opportunity Lines which will open up a new tab.
3. On the new tab select the link below the Opportunity Line ID which should open a new tab.
4. Select the pencil icon next to the Unit Amount.
5. Enter in the Quoted Amount from this list provided below that corresponds with the BFO Address.
6. You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7. On the next page click Save.  When you get to this step, dont ask me for permission to Save.  Just click Save and continue until this process is done.
8. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_STAGE_CHANGE = `1.  Reference the BFO links below, and then update the opportunity to the New Stage listed.
2.  After selecting the new stage, click save to ensure the new stage is selected.
3.  Make sure to save the new stage status before proceeding with the next item.
4.  Repeat this process for all Opportunities listed below.`;

// Appended to the end of every prompt copy (and the Copy-all bundle) so
// the assistant finishes by re-pulling the BFO list into the BFO
// Activity tab. Editable + reset like the others.
const DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY = `1.  When you are on this page click the Printable View https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  A new tab will pop up, go to that tab and change the number of records to 250
3.  Copy all data in the table on that page starting with Account Name going all the way down to the bottom righthand corner of that table in the final row of data in the final column.
4.  Navigate to this website https://prospect-tracker-ashen.vercel.app/ and then paste the data from the previous page into the BFO Activity tab .`;

// Opps 2 Stage → expected BFO Sales Stage. When the BFO Activity tab's
// Sales Stage value for an opp doesn't match the expected stage for the
// Opps 2 stage on its joined row, the Stage Change prompt surfaces it
// with the expected BFO stage as the value the user should set BFO to.
const OPPS_STAGE_TO_BFO_STAGE = {
  'agreement sent': '6 - Negotiate to Win',
  'contracting': '5 - Prepare & Bid',
  'quoted': '5 - Prepare & Bid',
  'quoting': '4 - Influence and Develop',
  'qualifying': '4 - Influence and Develop',
  'lead': '3 - Qualify Opportunity',
};

const DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS = `1.  Reference the BFO links below.
2.  If the link's associated status is Lost, then click on the Competitors button and then select New
3.  In the Competitor Name enter Unknown Competition and mark the box below Winner as checked.
4.  Click the save button and then navigate back to the BFO link for this opportunity.
5.  When you are back on that page, update the opportunity to the stage Closed and then click the Select Closed Stage blue button.
6.  The Edit Dependencies menu, choose the 0 - Closed option.
7.  Then select the corresponding Status from the menu below.
8.  Then select the corresponding Reason from the menu below.
9.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_BFO_PREP = `1.  I am logged on to this website https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the BFO Opportunity names below.  My goal is to have you open their websites and copy and paste the BFO website Address to the BFO address table here on the Agents tab of this website https://prospect-tracker-ashen.vercel.app/ in the AI BFO Prep table.`;

// Opps 2 "Reason Not Sold" → corresponding BFO Status + Reason. Used by
// the Close Not Solds prompt so the AI assistant can advance each BFO
// opp through the close-out flow without the user picking values by
// hand. Keys are lower-cased + trimmed for resilient matching.
const REASON_NOT_SOLD_TO_BFO = {
  'cancelled internally - no opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'cancelled internally - not in targets': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'current service delivery issues': { status: 'Lost', reason: 'Relationship Issue with SE' },
  "customer didnt have enough pain": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  "customer didn't have enough pain": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  'duplicate opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'free service': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'ghosted - no response': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
  'never connected': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
  'price pain': { status: 'Lost', reason: 'No acceptable Offer from SE' },
  "software or service doesn't meet need": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  'unknown': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
};

function readOverrides() {
  try {
    const raw = userLsGet(OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(next) {
  try { userLsSet(OVERRIDE_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredEmails() {
  try {
    const raw = userLsGet(IGNORED_EMAILS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredEmails(next) {
  try { userLsSet(IGNORED_EMAILS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredMeetings() {
  try {
    const raw = userLsGet(IGNORED_MEETINGS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredMeetings(next) {
  try { userLsSet(IGNORED_MEETINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readExcludedRecipients() {
  try {
    const raw = userLsGet(EXCLUDED_RECIPIENTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(a => String(a).toLowerCase()) : [];
  } catch {
    return [];
  }
}

function writeExcludedRecipients(next) {
  try { userLsSet(EXCLUDED_RECIPIENTS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readHideActivityOnDate() {
  try { return userLsGet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY) === '1'; } catch { return false; }
}

function writeHideActivityOnDate(on) {
  try { userLsSet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY, on ? '1' : '0'); } catch {}
}

// Toggleable columns on the Activity table (merged Sent emails + Called
// + Meetings), in render order. The Actions column is always shown and
// is not part of this list.
const ACTIVITY_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'type', label: 'Type' },
  { key: 'subject', label: 'Subject / Title' },
  { key: 'to', label: 'To (external)' },
  { key: 'company', label: 'Company' },
  { key: 'bfoCompanyName', label: 'BFO Company Name' },
  { key: 'bfoOpp', label: 'BFO Opportunity' },
  { key: 'lastActivity', label: 'Last Activity' },
  { key: 'bfoLink', label: 'BFO Link' },
  { key: 'outcome', label: 'Outcome / Status' },
  { key: 'location', label: 'Location' },
];
const ACTIVITY_COLUMN_KEYS = ACTIVITY_COLUMNS.map(c => c.key);
const ACTIVITY_COLS_STORAGE_KEY = 'agents-activity-hidden-cols';

// Read the set of hidden Activity-table column keys (persisted per user).
function readHiddenActivityCols() {
  try {
    const raw = userLsGet(ACTIVITY_COLS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(k => ACTIVITY_COLUMN_KEYS.includes(k)) : []);
  } catch { return new Set(); }
}

function writeHiddenActivityCols(set) {
  try { userLsSet(ACTIVITY_COLS_STORAGE_KEY, JSON.stringify([...set])); } catch {}
}

// Normalize a BFO Opportunity Name for matching the Opps tab's "BFO
// Link" value against the BFO Activity tab's "Opportunity Name" column:
// trim, lower-case, and collapse internal whitespace so a stray double
// space on either side doesn't drop the match.
function normalizeBfoOppName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readAiPrompt() {
  try {
    const raw = userLsGet(AI_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT : raw;
  } catch {
    return DEFAULT_AI_PROMPT;
  }
}

function writeAiPrompt(next) {
  try { userLsSet(AI_PROMPT_STORAGE_KEY, next); } catch {}
}

function readNewBfoOppPrompt() {
  try {
    const raw = userLsGet(NEW_BFO_OPP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_NEW_BFO_OPP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_NEW_BFO_OPP;
  }
}

function writeNewBfoOppPrompt(next) {
  try { userLsSet(NEW_BFO_OPP_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseDatesPrompt() {
  try {
    const raw = userLsGet(CLOSE_DATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_DATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_DATES;
  }
}

function writeCloseDatesPrompt(next) {
  try { userLsSet(CLOSE_DATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readAmountUpdatesPrompt() {
  try {
    const raw = userLsGet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_AMOUNT_UPDATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_AMOUNT_UPDATES;
  }
}

function writeAmountUpdatesPrompt(next) {
  try { userLsSet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readStageChangePrompt() {
  try {
    const raw = userLsGet(STAGE_CHANGE_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_STAGE_CHANGE : raw;
  } catch {
    return DEFAULT_AI_PROMPT_STAGE_CHANGE;
  }
}

function writeStageChangePrompt(next) {
  try { userLsSet(STAGE_CHANGE_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseNotSoldsPrompt() {
  try {
    const raw = userLsGet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS;
  }
}

function writeCloseNotSoldsPrompt(next) {
  try { userLsSet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY, next); } catch {}
}

function readUpdateBfoActivityPrompt() {
  try {
    const raw = userLsGet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY : raw;
  } catch {
    return DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY;
  }
}

function writeUpdateBfoActivityPrompt(next) {
  try { userLsSet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY, next); } catch {}
}

function readBfoPrepPrompt() {
  try {
    const raw = userLsGet(BFO_PREP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_BFO_PREP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_BFO_PREP;
  }
}

function writeBfoPrepPrompt(next) {
  try { userLsSet(BFO_PREP_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

// Pull the leading stage digit from BFO Sales Stage values like
// "6 - Negotiate to Win" / "4 - Influence and Develop". Same shape
// PipelineView.matchStage uses so the two views agree on what "Stage
// 5" means.
function bfoStageNumber(v) {
  const m = String(v ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Calendar days from today to the given date string (negative when the
// date is already in the past). Returns null when unparseable.
function daysUntilDate(raw) {
  if (!raw) return null;
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

// Add `days` to a date string and return the result in M/D/YYYY — the
// format BFO's inline Close Date editor expects.
function addDaysFormatted(raw, days) {
  if (!raw) return '';
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return '';
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// Strip currency symbols / commas / whitespace from an Amount-shaped
// cell and return a finite number, or null when the value is blank /
// non-numeric. Same shape DailySuccessManager.parseMoney uses so the
// two views agree on what "amount" means.
function parseMoneyNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Render a money number back as "$1,234" — used to format the Quoted
// Amount that the AI prompt copies into BFO.
function fmtMoney(n) {
  if (!Number.isFinite(n)) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Same client-keyword test PipelineView + YOY's Annual Sales use on the
// Opps Lead Source — keeps "is this a current customer?" consistent
// across views.
const CURRENT_CUSTOMER_LEAD_SOURCE_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

// Resolved at fetch time via getOppsSheetCsvUrl below — admin falls
// back to the legacy bundled sheet so existing behavior is unchanged;
// other users opt in by setting settings.oppsSheetUrl.
const OPPS_DB_STORE = 'opps-cache';

// Same CSV parser OppsView uses — handles quoted fields, escaped quotes,
// and CRLF / LF line endings.
function parseOppsCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// "Did I send this?" is keyed off the per-user work email on HubSpot,
// not the Google auth address — the user signs in (e.g.) with a Gmail
// address but HubSpot threads always carry the @se.com from-address.
// Stored per-user in userSettings.workEmail, set via the CDM Name modal.

// Extract every email-shaped token from an Opps "Contact" cell, which
// can hold a single email, a name + email pair, or a comma/semicolon
// list of either.
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g;

function readActivityCache() {
  try {
    const raw = userLsGet(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The Opps sheet keeps the Salesforce / Lightning URL in the
// "BFO Address" column. Fall back to scanning every field if that one
// happens to be empty so older rows still surface a link when possible.
function detectBfoUrl(rawOpp) {
  if (!rawOpp) return '';
  const direct = String(rawOpp['BFO Address'] || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const v of Object.values(rawOpp)) {
    if (typeof v !== 'string' || !v) continue;
    const m = v.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return '';
}

// A BFO field counts as "missing" when it's blank, "-", or an "#N/A"
// variant — the same placeholders Opps 2 uses for "no value yet".
function bfoFieldBlank(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

// Inline editor for the BFO Address in the AI BFO Prep table. Uncontrolled
// and keyed on the stored value (so an external refresh / the row dropping
// off the list remounts it cleanly). Commits on blur / Enter; Escape
// reverts. A bare host like "se.bfo.com/x" is prefixed with https:// so it
// registers as a URL downstream (detectBfoUrl expects an http(s) link).
function BfoAddressCell({ value, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    let next = el.value.trim();
    if (next && !/^https?:\/\//i.test(next)) next = `https://${next}`;
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <input
      key={initial}
      type="text"
      defaultValue={initial}
      placeholder="Paste BFO website address…"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4, font: 'inherit',
      }}
    />
  );
}

// Phone-touch detection for the Next Steps column — matches "call",
// "called", "calls", "calling", any "voicemail", and "left a vm" / "left
// vm". Shared by detectNextStepsType (email-table Type cell) and the
// Called-today section so both use identical wording rules.
const CALLED_NEXT_STEPS_RE = /\b(call(ed|s|ing)?|voicemail|left\s+(?:a\s+)?vm)\b/i;

// "called" if the Next Steps text mentions a phone touch, otherwise
// the row reflects the email cadence and we tag it as "email".
function detectNextStepsType(rawOpp) {
  const text = String(rawOpp?.['Next Steps'] || '');
  if (CALLED_NEXT_STEPS_RE.test(text)) return 'called';
  return 'email';
}

// Normalize an arbitrary date string into YYYY-MM-DD. Mirrors the
// helper OppsView2 uses so a date parsed there parses the same way
// here. Returns '' if the value isn't a date.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Business days between the Opps "Last Client Heard From Us" date and
// the supplied reference date (defaults to today) — same formula
// OppsView2 uses for its computed "Last Spoke" column. Returns null
// when the field is empty or unparseable.
function lastSpokeBusinessDays(rawOpp, referenceIso) {
  const iso = toISODate(rawOpp?.['Last Client Heard From Us']);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const ref = referenceIso ? parseIsoDate(referenceIso) : new Date();
  ref.setHours(0, 0, 0, 0);
  if (ref <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < ref) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

// Whole calendar days from today to an ISO/parseable date (negative when
// the date is in the past). Mirrors Opps 2's daysFromToday so a Call In
// resolved here matches what the Opps 2 tab shows.
function daysFromTodayAgents(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Resolve an opp's Call In the way Opps 2 does: a blank sentinel stored
// under "Call In" means "no call in"; otherwise compute live from the
// Follow Up date; otherwise fall back to a stored numeric Call In.
// Returns null when there's no resolvable value (i.e. Call In is blank).
function resolveOppCallIn(row) {
  if (row && 'Call In' in row) {
    const s = String(row['Call In'] ?? '').trim().toLowerCase();
    if (s === '' || s === '-' || s === '#n/a' || s === 'n/a') return null;
  }
  const live = daysFromTodayAgents(row?.['Follow Up']);
  if (live != null) return live;
  if (row && 'Call In' in row) {
    const n = parseFloat(String(row['Call In'] ?? '').replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Stages that mean the opp is closed (no longer live).
const CLOSED_OPP_STAGES = new Set(['sold', 'not sold']);

function boundsForDate(iso) {
  const d = parseIsoDate(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// The most recent business day strictly before `date` (skips Sat/Sun).
function previousBusinessDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

// ISO (YYYY-MM-DD) of the previous business day before the given ISO date.
function previousBusinessDayIso(iso) {
  const d = previousBusinessDay(parseIsoDate(iso));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Millisecond window spanning the reference date PLUS the previous
// business day — the "past 2 business days" the Activity sections
// (Sent emails / Called opps) scope to.
function boundsForActivityWindow(iso) {
  const ref = parseIsoDate(iso);
  const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime() + 24 * 60 * 60 * 1000;
  const prev = previousBusinessDay(ref);
  const start = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate()).getTime();
  return { start, end };
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

function externalRecipientList(toRaw) {
  return splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
}

// Normalize a company name for fuzzy matching against BFO Account
// Name. Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes,
// strip punctuation, collapse whitespace. Same shape ActivityView and
// MyAccountsView use so a name that matches there matches here too.
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Best-effort company guess from a recipient's email domain — used
// only when neither an Opps-tab row nor a HubSpot contact carries a
// company so the Company column doesn't render empty.
function domainCompanyGuess(addr) {
  if (!addr) return '';
  const at = String(addr).lastIndexOf('@');
  if (at < 0) return '';
  return String(addr).slice(at + 1)
    .replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

function OppPicker({ oppsCache, onSelect, triggerLabel = '+ Pick opportunity', company = '' }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  // The dropdown is rendered in a portal with fixed positioning so it
  // floats above the page instead of being clipped by the table's
  // horizontal-scroll wrapper (which previously cut it off at the
  // bottom edge of the table). Position is measured from the input.
  const [menuPos, setMenuPos] = useState(null);

  const matches = useMemo(() => {
    if (!oppsCache?.records?.length) return [];
    // With no search term and a company in context, default to that
    // company's opportunities only — so editing a row's tag shows the
    // BFO opps for that company first. Typing searches across all opps.
    if (!term.trim() && company) {
      return oppsCache.records
        .filter(r => companiesMatch(String(r['Account'] || ''), company))
        .slice(0, 50);
    }
    return searchOpps(oppsCache, term).slice(0, 12);
  }, [oppsCache, term, company]);

  // Recompute the fixed-position coordinates from the input's rect,
  // flipping above the field when there isn't room below it.
  const updatePosition = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const MENU_MAX = 260;
    const GAP = 2;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < MENU_MAX + GAP && rect.top > spaceBelow;
    setMenuPos({
      left: rect.left,
      width: rect.width,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
      maxHeight: Math.min(MENU_MAX, Math.max(120, (flipUp ? rect.top : spaceBelow) - GAP - 4)),
    });
  };

  // Measure once the input mounts, then keep the menu pinned to the
  // input as the user scrolls or resizes the window.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onMove = () => updatePosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Close on outside click. The menu lives in a portal, so check both
  // the trigger wrapper and the floating menu before closing.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pickerTrigger}
        onClick={() => setOpen(true)}
        disabled={!oppsCache?.records?.length}
        title={oppsCache?.records?.length ? 'Search Opps 2 for a matching opportunity' : 'Open the Opps 2 tab to load the cache'}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={styles.pickerWrap}>
      <input
        autoFocus
        className={styles.pickerInput}
        placeholder={company ? `Showing ${company} — type to search all opps…` : 'Search opps by account, BFO link, or contact…'}
        value={term}
        onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTerm(''); } }}
      />
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.pickerMenu}
          style={{
            position: 'fixed',
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
            maxHeight: menuPos.maxHeight,
          }}
        >
          {matches.length === 0 ? (
            <div className={styles.pickerEmpty}>
              {!term.trim() && company
                ? `No opportunities found for ${company}. Type to search all opps.`
                : 'No matching opps. Try a different search term.'}
            </div>
          ) : matches.map((opp, i) => {
            const bfoOpp = opp['BFO Link'] || '(no opportunity name)';
            const account = opp['Account'] || '';
            return (
              <button
                key={i}
                type="button"
                className={styles.pickerOption}
                onClick={() => { onSelect(opp); setOpen(false); setTerm(''); }}
              >
                {bfoOpp}
                {account && <span className={styles.pickerOptionAccount}>{account}</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Editable BFO Company Name cell for the New BFO Opp table. When a Table
// View company matches the opp's account, the value is an editable input
// that writes straight back to that company's `bfoCompanyName` (so it
// ties to the Table View / Opps 2). With no match there's nowhere to
// store it, so it stays a read-only dash with a hint.
function NewBfoCompanyNameCell({ prospect, value, onCommit }) {
  if (!prospect) {
    return (
      <td
        className={styles.muted}
        title="No Table View company matches this account. Add the company on the Table View first to store a BFO Company Name."
      >—</td>
    );
  }
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <td>
      <input
        key={initial}
        type="text"
        defaultValue={initial}
        placeholder="Enter BFO Company Name…"
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '2px 5px',
          border: '1px solid transparent', borderRadius: 4, font: 'inherit',
          background: 'transparent', color: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid var(--color-border)'; }}
        onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = '1px solid transparent'; }}
      />
    </td>
  );
}

export function AgentsView({ prospects = [], settings, updateProspect }) {
  const { isAdmin, user } = useAuth();
  // Configured per-user via Settings → CDM Name. The Sent emails section
  // matches HubSpot's hs_email_from_email against this address; blank
  // means "no outbound to show yet — set your work email in Settings".
  const senderEmail = String(settings?.workEmail || '').toLowerCase().trim();
  const [cache, setCache] = useState(() => readActivityCache());
  const [hubspotCache, setHubspotCache] = useState(null);
  const [oppsCache, setOppsCache] = useState(null);
  // Raw Opps record shown in the read-only Opp info modal (New BFO Opp
  // table "i" button). null = closed.
  const [infoOpp, setInfoOpp] = useState(null);
  const [overrides, setOverrides] = useState(readOverrides);
  const [ignoredEmails, setIgnoredEmails] = useState(readIgnoredEmails);
  const [ignoredMeetings, setIgnoredMeetings] = useState(readIgnoredMeetings);
  const [excludedRecipients, setExcludedRecipients] = useState(readExcludedRecipients);
  // When on, the Called / Sent tables hide rows whose Last Activity date
  // is the same calendar day as the selected Activity date up top.
  const [hideActivityOnDate, setHideActivityOnDate] = useState(readHideActivityOnDate);
  // Which Activity-table columns are hidden, plus the column-menu open state.
  const [hiddenActivityCols, setHiddenActivityCols] = useState(readHiddenActivityCols);
  const [activityColsMenuOpen, setActivityColsMenuOpen] = useState(false);
  const activityColsMenuRef = useRef(null);
  const isActivityColVisible = (key) => !hiddenActivityCols.has(key);
  const toggleActivityCol = (key) => {
    setHiddenActivityCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeHiddenActivityCols(next);
      return next;
    });
  };
  useEffect(() => {
    if (!activityColsMenuOpen) return;
    const onDown = (e) => {
      if (!activityColsMenuRef.current?.contains(e.target)) setActivityColsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activityColsMenuOpen]);
  const [aiPrompt, setAiPrompt] = useState(readAiPrompt);
  const [newBfoOppPrompt, setNewBfoOppPrompt] = useState(readNewBfoOppPrompt);
  const [closeDatesPrompt, setCloseDatesPrompt] = useState(readCloseDatesPrompt);
  const [amountUpdatesPrompt, setAmountUpdatesPrompt] = useState(readAmountUpdatesPrompt);
  const [stageChangePrompt, setStageChangePrompt] = useState(readStageChangePrompt);
  const [closeNotSoldsPrompt, setCloseNotSoldsPrompt] = useState(readCloseNotSoldsPrompt);
  const [updateBfoActivityPrompt, setUpdateBfoActivityPrompt] = useState(readUpdateBfoActivityPrompt);
  const [bfoPrepPrompt, setBfoPrepPrompt] = useState(readBfoPrepPrompt);
  const [bfoActivity, setBfoActivity] = useState(null);
  const [copyFlash, setCopyFlash] = useState('');
  const [newBfoOppCopyFlash, setNewBfoOppCopyFlash] = useState('');
  const [closeDatesCopyFlash, setCloseDatesCopyFlash] = useState('');
  const [amountUpdatesCopyFlash, setAmountUpdatesCopyFlash] = useState('');
  const [stageChangeCopyFlash, setStageChangeCopyFlash] = useState('');
  const [closeNotSoldsCopyFlash, setCloseNotSoldsCopyFlash] = useState('');
  const [updateBfoActivityCopyFlash, setUpdateBfoActivityCopyFlash] = useState('');
  // HubSpot Activity refresh — kicked off by the header button. Mirrors
  // the fetchActivity flow on ActivityView so both tabs share the same
  // hubspot-activity-cache localStorage entry.
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [activityRefreshError, setActivityRefreshError] = useState(null);
  const [activityRefreshProgress, setActivityRefreshProgress] = useState(null);
  // ISO date the activity sections (sent emails / meetings / called)
  // are scoped to. Defaults to today; the picker in the header lets the
  // user review what was logged on any past calendar day.
  const [referenceDate, setReferenceDate] = useState(todayIso);
  // Per-section reveal flags for the AI prompt editors. Hidden by
  // default — the user copies prompts far more often than they edit
  // them, so the textareas just take up screen space. Click "Edit
  // prompt" to expand the textarea + reset button for that section.
  const [revealedPrompts, setRevealedPrompts] = useState({});
  const togglePrompt = (key) =>
    setRevealedPrompts(prev => ({ ...prev, [key]: !prev[key] }));

  const ignoredEmailIds = useMemo(() => new Set(ignoredEmails), [ignoredEmails]);
  const ignoredMeetingIds = useMemo(() => new Set(ignoredMeetings), [ignoredMeetings]);
  const excludedRecipientSet = useMemo(() => new Set(excludedRecipients), [excludedRecipients]);

  const updateAiPrompt = (next) => {
    setAiPrompt(next);
    writeAiPrompt(next);
  };
  const resetAiPrompt = () => updateAiPrompt(DEFAULT_AI_PROMPT);

  const updateNewBfoOppPrompt = (next) => {
    setNewBfoOppPrompt(next);
    writeNewBfoOppPrompt(next);
  };
  const resetNewBfoOppPrompt = () => updateNewBfoOppPrompt(DEFAULT_AI_PROMPT_NEW_BFO_OPP);

  const updateCloseDatesPrompt = (next) => {
    setCloseDatesPrompt(next);
    writeCloseDatesPrompt(next);
  };
  const resetCloseDatesPrompt = () => updateCloseDatesPrompt(DEFAULT_AI_PROMPT_CLOSE_DATES);

  const updateAmountUpdatesPrompt = (next) => {
    setAmountUpdatesPrompt(next);
    writeAmountUpdatesPrompt(next);
  };
  const resetAmountUpdatesPrompt = () => updateAmountUpdatesPrompt(DEFAULT_AI_PROMPT_AMOUNT_UPDATES);

  const updateStageChangePrompt = (next) => {
    setStageChangePrompt(next);
    writeStageChangePrompt(next);
  };
  const resetStageChangePrompt = () => updateStageChangePrompt(DEFAULT_AI_PROMPT_STAGE_CHANGE);

  const updateCloseNotSoldsPrompt = (next) => {
    setCloseNotSoldsPrompt(next);
    writeCloseNotSoldsPrompt(next);
  };
  const resetCloseNotSoldsPrompt = () => updateCloseNotSoldsPrompt(DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS);

  const updateUpdateBfoActivityPrompt = (next) => {
    setUpdateBfoActivityPrompt(next);
    writeUpdateBfoActivityPrompt(next);
  };
  const resetUpdateBfoActivityPrompt = () => updateUpdateBfoActivityPrompt(DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY);

  const updateBfoPrepPrompt = (next) => {
    setBfoPrepPrompt(next);
    writeBfoPrepPrompt(next);
  };
  const resetBfoPrepPrompt = () => updateBfoPrepPrompt(DEFAULT_AI_PROMPT_BFO_PREP);

  // The "Update BFO Activity" prompt is appended to the end of every
  // individual prompt copy (and the Copy-all bundle). Helper keeps that
  // one place so all the copy buttons stay in sync.
  const withBfoActivitySuffix = (text) => {
    const suffix = (updateBfoActivityPrompt || '').trim();
    return suffix ? `${text}\n\n===== Update BFO Activity =====\n${suffix}` : text;
  };

  const ignoreEmail = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredEmails(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredEmails(next);
      return next;
    });
  };

  // Permanently exclude the given external recipient address(es) from
  // the Sent emails table — hides this email and any future email sent
  // to the same recipient.
  const excludeRecipient = (addrs) => {
    const list = (Array.isArray(addrs) ? addrs : [addrs])
      .map(a => String(a || '').toLowerCase().trim())
      .filter(Boolean);
    if (!list.length) return;
    setExcludedRecipients(prev => {
      const next = [...prev];
      for (const a of list) if (!next.includes(a)) next.push(a);
      if (next.length === prev.length) return prev;
      writeExcludedRecipients(next);
      return next;
    });
  };

  // Re-include every previously excluded recipient.
  const clearExcludedRecipients = () => {
    setExcludedRecipients(prev => {
      if (!prev.length) return prev;
      writeExcludedRecipients([]);
      return [];
    });
  };

  const ignoreMeeting = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredMeetings(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredMeetings(next);
      return next;
    });
  };

  const setOverride = (key, opp) => {
    if (!key || !opp) return;
    setOverrides(prev => {
      const next = {
        ...prev,
        [key]: {
          bfoOpp: String(opp['BFO Link'] || '').trim(),
          account: String(opp['Account'] || '').trim(),
        },
      };
      writeOverrides(next);
      return next;
    });
  };

  const clearOverride = (key) => {
    if (!key) return;
    setOverrides(prev => {
      const next = { ...prev };
      delete next[key];
      writeOverrides(next);
      return next;
    });
  };

  // Pick up new HubSpot activity pulls from the Activity tab.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Pull the latest HubSpot activity (emails, calls, meetings) AND
  // re-fetch the Opps Google Sheet so the BFO tagging and the Called
  // section both reflect the latest data. The HubSpot pull writes to
  // the shared localStorage cache that ActivityView reads from; the
  // Opps pull writes to the same IndexedDB key OppsView uses. Each
  // half runs independently so a failure on one doesn't block the
  // other.
  async function refreshActivityCache() {
    if (activityRefreshing) return;
    setActivityRefreshing(true);
    setActivityRefreshError(null);
    setActivityRefreshProgress({ email: 0, call: 0, meeting: 0, opps: 0 });
    async function fetchAllPages(type) {
      const all = [];
      let after = '';
      while (true) {
        const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${after}` : ''}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        all.push(...(json.results || []));
        setActivityRefreshProgress(prev => ({ ...prev, [type]: all.length }));
        if (json.nextAfter) after = json.nextAfter;
        else break;
        if (all.length > 5000) break;
      }
      return all;
    }
    async function fetchOpps() {
      const url = getOppsSheetCsvUrl({ isAdmin, settings });
      if (!url) {
        // No sheet configured for this user — leave the existing
        // oppsCache (if any) untouched and skip the Opps refresh half.
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Opps HTTP ${res.status}`);
      const csvText = await res.text();
      const rows = parseOppsCsv(csvText);
      if (rows.length < 2) throw new Error('Opps sheet returned no data');
      const headers = rows[0].map(h => h.trim());
      const records = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const record = { _id: i };
        let hasData = false;
        for (let j = 0; j < headers.length; j++) {
          const h = headers[j];
          if (!h) continue;
          const val = (row[j] || '').trim();
          if (record[h] !== undefined && record[h] !== '' && record[h] !== '-' && record[h] !== '#N/A') continue;
          record[h] = val;
          if (val && val !== '-' && val !== '#N/A') hasData = true;
        }
        // Mirror the Opps tab's filter — keep every row with at least
        // one populated cell. Earlier we required an Account too, which
        // silently dropped sheet rows whose Account was blank.
        if (hasData) records.push(record);
      }
      const result = { headers, records, fetchedAt: new Date().toISOString() };
      setActivityRefreshProgress(prev => ({ ...prev, opps: records.length }));
      await dbPut(OPPS_DB_STORE, result, 'data');
      setOppsCache(result);
      return result;
    }

    const activityPromise = (async () => {
      const emails = await fetchAllPages('email');
      const calls = await fetchAllPages('call');
      const meetings = await fetchAllPages('meeting');
      const result = { emails, calls, meetings, fetchedAt: new Date().toISOString() };
      try {
        userLsSet(ACTIVITY_CACHE_KEY, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
      } catch (err) {
        console.warn('Agents activity cache write skipped (quota):', err?.message || err);
      }
      setCache(result);
    })();
    const oppsPromise = fetchOpps();

    const [activityRes, oppsRes] = await Promise.allSettled([activityPromise, oppsPromise]);
    const errors = [];
    if (activityRes.status === 'rejected') {
      console.error('Agents activity refresh error:', activityRes.reason);
      errors.push(`Activity: ${activityRes.reason?.message || 'fetch failed'}`);
    }
    if (oppsRes.status === 'rejected') {
      console.error('Agents opps refresh error:', oppsRes.reason);
      errors.push(`Opps: ${oppsRes.reason?.message || 'fetch failed'}`);
    }
    if (errors.length > 0) setActivityRefreshError(errors.join(' · '));
    setActivityRefreshing(false);
    setActivityRefreshProgress(null);
  }

  // BFO Activity rows (pasted on the BFO Activity tab, persisted in
  // IndexedDB). Stages live there — the Opps sheet only has free-text
  // status labels ("Not Started" / "Sold" / etc.), not the 1-6 Sales
  // Stage we need for the close-date slip filter.
  useEffect(() => {
    let cancelled = false;
    dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)
      .then(d => { if (!cancelled) setBfoActivity(d || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // HubSpot contacts cache — email → company lookup for tagging.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Opps cache (IndexedDB) — drives the BFO Opportunity Name tagging.
  // Each opp record carries Contact (recipient email[s]), Account
  // (company), and BFO Link (= BFO Opportunity Name). Refresh on
  // window focus so a fresh paste over on the Opps tab shows up here
  // without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache()
        .then(o => { if (!cancelled) setOppsCache(o); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    // Re-pull when Opps 2 writes its cache (an edit on the Opps 2 tab or
    // an inline save here) so matches reflect the latest data live.
    window.addEventListener('opps2-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('opps2-cache-updated', refresh);
    };
  }, []);

  // BFO Activity rows — pasted on the BFO Activity tab, persisted in
  // IndexedDB. Read here so each row's Amount can be compared against
  // the Opps tab's Quoted Amount and a discrepancy list surfaced.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)
        .then(d => { if (!cancelled) setBfoActivity(d || null); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // email → company map from the HubSpot contacts cache.
  const companyByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  // Pre-index the Opps cache for two lookup modes:
  //   1. email → opp  (Contact field carries email tokens)
  //   2. company → opp (Account field, fuzzy-matched)
  // The same opp can answer for either path. BFO Link is the BFO
  // Opportunity Name (the column was renamed visibly elsewhere but the
  // data key stayed "BFO Link").
  const oppIndex = useMemo(() => {
    const records = oppsCache?.records || [];
    const byEmail = new Map(); // lower-case email → opp
    const byBfoOpp = new Map(); // lower-case opp name → opp
    const allOpps = [];
    for (const r of records) {
      const rawBfoOpp = String(r['BFO Link'] || '').trim();
      // The Opps tab uses "-" / "#N/A" as placeholders for rows that
      // don't yet have a BFO Opportunity Name. Treat those as empty
      // here so the Sent emails table renders the inline picker
      // (instead of showing the literal "-") and the user can map
      // the row to a real opportunity.
      const bfoOpp = (rawBfoOpp && rawBfoOpp !== '-' && rawBfoOpp !== '#N/A') ? rawBfoOpp : '';
      const account = String(r['Account'] || '').trim();
      // Skip opps that don't carry the data we need to surface.
      if (!bfoOpp && !account) continue;
      const entry = { raw: r, account, bfoOpp };
      allOpps.push(entry);
      if (bfoOpp) {
        const key = bfoOpp.toLowerCase();
        if (!byBfoOpp.has(key)) byBfoOpp.set(key, entry);
      }
      const contactRaw = String(r['Contact'] || '').toLowerCase();
      if (!contactRaw) continue;
      const emails = contactRaw.match(EMAIL_RE) || [];
      for (const e of emails) {
        const existing = byEmail.get(e);
        // First match wins — except a BFO-tagged opp always beats an
        // untagged one that shares the same contact email, so a row with
        // a real BFO Opportunity Name isn't shadowed by a duplicate opp
        // that doesn't have one.
        if (!existing || (!existing.bfoOpp && entry.bfoOpp)) byEmail.set(e, entry);
      }
    }
    return { byEmail, byBfoOpp, allOpps };
  }, [oppsCache]);

  // Primary path: which Opps-tab row covers this email recipient?
  // Falls back to a fuzzy Account match on the HubSpot company so an
  // unknown-contact email still finds its opp when the company has
  // any open opportunity on the Opps tab.
  const findOppForRecipient = (recipientEmail, hubspotCompany) => {
    if (recipientEmail) {
      const direct = oppIndex.byEmail.get(recipientEmail);
      if (direct) return direct;
    }
    if (hubspotCompany) {
      for (const opp of oppIndex.allOpps) {
        if (companiesMatch(opp.account, hubspotCompany)) return opp;
      }
    }
    return null;
  };

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = boundsForDate(referenceDate);
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    // Sent emails span the past 2 business days (the reference day plus
    // the previous business day); meetings stay scoped to the single
    // reference day.
    const activityBounds = boundsForActivityWindow(referenceDate);
    const inActivityWindow = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= activityBounds.start && t < activityBounds.end;
    };
    const sentByMe = (e) => {
      if (!senderEmail) return false;
      const from = String(e.hs_email_from_email || '').toLowerCase().trim();
      return from === senderEmail;
    };
    const outbound = senderEmail ? (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inActivityWindow(e.hs_timestamp))
      .filter(sentByMe)
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .filter(e => !ignoredEmailIds.has(String(e.id || e.hs_object_id)))
      // Drop emails whose external recipients have all been excluded
      // by the user ("don't include moving forward").
      .filter(e => externalRecipientList(e.hs_email_to_email)
        .some(addr => !excludedRecipientSet.has(addr.toLowerCase())))
      .map(e => {
        const recipients = externalRecipientList(e.hs_email_to_email);
        // Pick the HubSpot-company off the first recipient we have a
        // contact record for. Used both as a fallback Company when no
        // Opp matches and as the secondary-match key for the Opps-tab
        // lookup.
        let hubspotCompany = '';
        for (const addr of recipients) {
          const c = companyByEmail.get(addr);
          if (c) { hubspotCompany = c; break; }
        }
        // Walk the external recipients and take the first one that
        // resolves to an Opp on the Opps tab (by Contact email, then by
        // company-name fuzzy match against the Opps Account). The company
        // comes from the HubSpot contact when we have one, otherwise from
        // a guess off the email domain — so an email to an unknown
        // contact still gets a BFO Opportunity estimate from its company.
        let matchedOpp = null;
        for (const addr of recipients) {
          const companyCandidate = companyByEmail.get(addr) || hubspotCompany || domainCompanyGuess(addr);
          matchedOpp = findOppForRecipient(addr, companyCandidate);
          if (matchedOpp) break;
        }
        // Override key — keyed by the first external recipient so a
        // future email to the same person reuses the manual tag.
        const overrideKey = recipients[0] || '';
        const override = overrideKey ? overrides[overrideKey] : null;
        // Manual override wins over the auto-match. Auto-match wins
        // when there's no override.
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || hubspotCompany || domainCompanyGuess(recipients[0]);
        // Resolve the full opp record for this row's BFO URL / Next
        // Steps. Prefer a manual override's named opp, else the opp we
        // actually matched. Re-looking an auto-match up by name (the old
        // behavior) could land on a *different* record that shares the
        // BFO Opportunity Name — e.g. a duplicate that has no BFO Address
        // — which dropped the BFO Link even though the real opp has one.
        let oppForRow = override?.bfoOpp
          ? oppIndex.byBfoOpp.get(override.bfoOpp.toLowerCase())
          : matchedOpp;
        // If the chosen record has no BFO Address but another opp with
        // the same BFO Opportunity Name does, use that one for the link.
        if (bfoOpp && !detectBfoUrl(oppForRow?.raw)) {
          const key = bfoOpp.toLowerCase();
          const withUrl = oppIndex.allOpps.find(
            o => o.bfoOpp && o.bfoOpp.toLowerCase() === key && detectBfoUrl(o.raw),
          );
          if (withUrl) oppForRow = withUrl;
        }
        const bfoUrl = detectBfoUrl(oppForRow?.raw);
        const nextStepsType = detectNextStepsType(oppForRow?.raw);
        return {
          id: e.id || e.hs_object_id,
          ts: e.hs_timestamp,
          subject: e.hs_email_subject || '(no subject)',
          to: recipients.join(', '),
          recipients,
          rawTo: e.hs_email_to_email || '',
          status: e.hs_email_status || '',
          company,
          bfoOpp,
          bfoUrl,
          nextStepsType,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)) : [];

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .filter(m => !ignoredMeetingIds.has(String(m.id || m.hs_object_id)))
      .map(m => {
        // Resolve associated HubSpot contacts up front. We walk each
        // one looking for an Opps-tab match (by email → Contact, then
        // by company → Account) instead of taking the first contact
        // and stopping — meetings frequently include internal SE
        // attendees first, which would block a match if we short-
        // circuited on the first email / company we saw.
        const ids = m._contactIds || [];
        const contacts = ids
          .map(id => (hubspotCache?.contacts || []).find(c => c.id === id))
          .filter(Boolean);

        // Strongest match keys: an external recipient email and the
        // first non-empty company. Used as the override key + as the
        // last-chance fuzzy match.
        let primaryEmail = '';
        let primaryCompany = '';
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && !e.endsWith('@se.com') && !primaryEmail) primaryEmail = e;
          if (ct.company && !primaryCompany) primaryCompany = ct.company;
        }

        // Walk every external contact + their company against the
        // Opps tab. First opp that resolves wins.
        let matchedOpp = null;
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && e.endsWith('@se.com')) continue;
          matchedOpp = findOppForRecipient(e, ct.company || '');
          if (matchedOpp) break;
        }
        // Final fuzzy fallback: the meeting title or location often
        // carries the customer's company name. Match that against
        // every opp's Account field.
        if (!matchedOpp) {
          const haystack = `${m.hs_meeting_title || ''} ${m.hs_meeting_location || ''}`.trim();
          if (haystack) matchedOpp = findOppForRecipient('', haystack);
        }

        // Meetings rarely have a stable contact email — fall back to
        // the meeting id so the override survives. Same shape as the
        // email rows so the picker code stays one path.
        const meetingId = m.id || m.hs_object_id || '';
        const overrideKey = primaryEmail || (meetingId ? `meeting:${meetingId}` : '');
        const override = overrideKey ? overrides[overrideKey] : null;
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || primaryCompany;
        return {
          id: meetingId,
          ts: m.hs_meeting_start_time || m.hs_timestamp,
          endTs: m.hs_meeting_end_time,
          title: m.hs_meeting_title || 'Meeting',
          outcome: m.hs_meeting_outcome || '',
          location: m.hs_meeting_location || '',
          company,
          bfoOpp,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
    // findOppForRecipient / companyByEmail are derived from the same
    // dependency set as cache + hubspotCache + oppIndex + overrides,
    // so they don't need their own entries here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, hubspotCache, oppIndex, overrides, ignoredEmailIds, ignoredMeetingIds, excludedRecipientSet, referenceDate, senderEmail]);

  // Opps where the user logged a phone touch in Next Steps and the
  // Last Spoke column (business days since Last Client Heard From Us)
  // computes to 0 relative to the picked reference date — i.e. the
  // client touched the conversation on that day.
  const calledOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const rows = [];
    for (const r of records) {
      const nextSteps = String(r['Next Steps'] || '');
      if (!CALLED_NEXT_STEPS_RE.test(nextSteps)) continue;
      // Include calls from the past 2 business days: 0 = the reference
      // day itself, 1 = the previous business day.
      const lsbd = lastSpokeBusinessDays(r, referenceDate);
      if (lsbd !== 0 && lsbd !== 1) continue;
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '—',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        nextSteps,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, referenceDate]);

  // Opps that don't yet exist in BFO and need a fresh Guided Opportunity
  // created. Filter mirrors the user's spec:
  //   • Stage NOT in {Not Started, Not Sold, Sold}
  //   • No BFO Opportunity Name — the Opps tab's "BFO Link" column is
  //     blank, "-", or "#N/A" (all treated as "no link yet").
  // Output carries Company (Account), Lead Source + a current-customer
  // boolean, and Scope so the appended block reads as the table the
  // user described.
  // BFO Company Name lookup — normalized company → bfoCompanyName from
  // the Table View prospect records. Used to enrich each New BFO Opp
  // row with the BFO-side account name (which often differs from the
  // marketing-friendly Account on the Opps sheet).
  const bfoCompanyByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      const bfo = String(p.bfoCompanyName || '').trim();
      if (!norm || !bfo) continue;
      // First match wins so the lookup is deterministic when two
      // prospect rows happen to normalize to the same key.
      if (!map.has(norm)) map.set(norm, bfo);
    }
    return map;
  }, [prospects]);

  // Normalized company → Table View prospect, so the New BFO Opp table
  // can write an entered BFO Company Name straight back to that company's
  // record (the same field Opps 2 / Table View read). First match wins.
  const prospectByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      if (norm && !map.has(norm)) map.set(norm, p);
    }
    return map;
  }, [prospects]);

  // Resolve a Sent-email row's BFO Company Name from the strongest
  // signal available, in order:
  //   1. the recipient contact's company (looked up by email),
  //   2. the company name shown on the row,
  //   3. the matched BFO opp — its own "BFO Company Name" field if the
  //      Opps sheet carries one, else its Account.
  // Each company identifier maps through the Table View bfoCompanyName
  // lookup so the BFO-side name stays consistent with Opps 2.
  const resolveBfoCompanyName = (e) => {
    for (const addr of (e.recipients || [])) {
      const co = companyByEmail.get(addr);
      const v = co ? (bfoCompanyByNorm.get(normalizeCompany(co)) || '') : '';
      if (v) return v;
    }
    const byCompany = bfoCompanyByNorm.get(normalizeCompany(e.company)) || '';
    if (byCompany) return byCompany;
    const opp = e.bfoOpp ? oppIndex.byBfoOpp.get(e.bfoOpp.toLowerCase()) : null;
    if (opp) {
      return String(opp.raw?.['BFO Company Name'] || '').trim()
        || bfoCompanyByNorm.get(normalizeCompany(opp.account || '')) || '';
    }
    return '';
  };

  const newBfoOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const EXCLUDED_STAGES = new Set(['Not Started', 'Not Sold', 'Sold']);
    const overrides = settings?.serviceOverrides || {};
    const rows = [];
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (!stage || EXCLUDED_STAGES.has(stage)) continue;
      // Only list opps whose BFO Opportunity Name is exactly "-" — the
      // deliberate placeholder for "needs a BFO opp created". Blank and
      // "#N/A" do not qualify.
      const bfoLink = String(r['BFO Link'] ?? '').trim();
      if (bfoLink !== '-') continue;
      const callInRaw = String(r['Call In'] ?? '').trim();
      const account = String(r.Account || '').trim();
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      // A Scope can list several comma-joined services (e.g. "Remote
      // assessments, Audits"). The New BFO Opp flow only creates an opp
      // for the first one, so use just the first listed scope item for
      // the Scope column, the metadata lookup, and the Project Name.
      const rawScope = String(r.Scope || '').trim();
      const scope = rawScope.includes(',')
        ? rawScope.split(',')[0].trim()
        : rawScope;
      const followUp = String(r['Follow Up'] ?? '').trim();
      const bfoCompanyName = bfoCompanyByNorm.get(normalizeCompany(account)) || '';
      // Look up the per-service metadata from the Dropdowns › Services
      // subtab. Scope is the canonical service name; the catalog
      // supplies Product Line, Type, Region, Class (= BFO Tag), and
      // Local Project Name. User overrides on the Services tab win
      // over the seed values.
      const svcMeta = getEffectiveServiceMetadata(scope, overrides);
      const productLine = svcMeta?.productLine || '';
      const type = svcMeta?.serviceType || '';
      const region = svcMeta?.region || '';
      const klass = svcMeta?.bfoTag || '';
      // Local Project Name picks up the seed / override value. When
      // the opp's Lead Source is "PE Partner" (the PE-firm referral
      // bucket), append "#PE PRACTICE" so the BFO opp is tagged into
      // the PE practice book of business.
      const baseLpn = svcMeta?.localProjectName || '';
      const isPePartner = /^pe partner$/i.test(leadSource);
      const localProjectName = isPePartner
        ? (baseLpn ? `${baseLpn} #PE PRACTICE` : '#PE PRACTICE')
        : baseLpn;
      // Years is fixed: every new BFO opp starts at Year 1. The
      // catalog's "X years" value represents contract duration, which
      // BFO doesn't surface in the opp name.
      const years = 'YEAR1';
      // Combined Project Name the user pastes into BFO's Project Name
      // box. Format:
      //   SB - {ProductLine code} - New - {Type} - {Region} - YEAR1 - {Scope}
      // {ProductLine code} is the first segment of the Product Line
      // before " - " (e.g. "SUSUP" from "SUSUP - SUPPLY & SUST
      // SERVICES"). Falls back to the raw productLine when the code
      // can't be parsed.
      const plCode = productLine.includes(' - ')
        ? productLine.split(' - ')[0].trim()
        : productLine.trim();
      const projectNameParts = ['SB', plCode, 'New', type, region, years, scope].filter(Boolean);
      const projectName = projectNameParts.join(' - ');
      rows.push({
        id: r._id ?? `${account}|${scope}`,
        // Raw Opps-tab record, so the table can open the same Opp info
        // modal Opps 2 uses (read-only here).
        raw: r,
        company: account || '—',
        bfoCompanyName,
        leadSource: leadSource || '—',
        currentCustomer: CURRENT_CUSTOMER_LEAD_SOURCE_RE.test(leadSource),
        scope: scope || '—',
        stage,
        followUp,
        callIn: callInRaw,
        productLine,
        localProjectName,
        projectName,
        type,
        region,
        class: klass,
        years,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, bfoCompanyByNorm, settings?.serviceOverrides]);

  // Missing data the New BFO Opp AI prompt needs. The prompt emits
  // "BFO Company Name | Project Name | Product Line | Local Project Name"
  // per opp, with Project Name composed from the Product Line code, Type,
  // Region and Scope — so any blank among those fields leaves a hole in
  // the prompt. One entry per affected opp, listing its blank fields;
  // drives the red banner at the top of the page.
  const newBfoMissingData = useMemo(() => {
    const blank = (v) => {
      const s = String(v ?? '').trim();
      return !s || s === '—' || s === '-';
    };
    const out = [];
    for (const o of newBfoOpps) {
      const missing = [];
      if (blank(o.bfoCompanyName)) missing.push('BFO Company Name');
      if (blank(o.productLine)) missing.push('Product Line');
      if (blank(o.type)) missing.push('Type');
      if (blank(o.region)) missing.push('Region');
      if (blank(o.scope)) missing.push('Scope');
      if (blank(o.localProjectName)) missing.push('Local Project Name');
      if (missing.length) out.push({ company: o.company, missing });
    }
    return out;
  }, [newBfoOpps]);

  // BFO Opportunity Name → Last Activity date from the BFO Activity tab.
  // Lets the Called and Sent emails tables show how long it's been since
  // anything happened on the matched BFO opp. Keyed by normalized
  // opportunity name (== the Opps tab's "BFO Link").
  const bfoLastActivityByName = useMemo(() => {
    const map = new Map();
    const headers = bfoActivity?.headers || [];
    const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
    const actCol = headers.find(h => /last\s*activity/i.test(h));
    if (!oppCol || !actCol) return map;
    for (const r of (bfoActivity?.rows || [])) {
      const k = normalizeBfoOppName(r[oppCol]);
      if (!k || map.has(k)) continue;
      const v = String(r[actCol] ?? '').trim();
      if (v) map.set(k, v);
    }
    return map;
  }, [bfoActivity]);

  // Look up the BFO Last Activity date for a given BFO Opportunity Name
  // (blank when there's no opp or no matching BFO Activity row).
  const lastActivityFor = (bfoOpp) => {
    const k = normalizeBfoOppName(bfoOpp);
    return k ? (bfoLastActivityByName.get(k) || '') : '';
  };

  // "Hide rows last active in the activity window" toggle. The Sent /
  // Called tables now span the past 2 business days, so this hides rows
  // whose BFO Last Activity falls on either the reference day or the
  // previous business day. Last Activity is whatever BFO pasted (usually
  // M/D/YYYY) while referenceDate is ISO, so normalize both before
  // comparing.
  const prevBusinessDate = previousBusinessDayIso(referenceDate);
  const lastActivityOnReference = (bfoOpp) => {
    const iso = toISODate(lastActivityFor(bfoOpp));
    return !!iso && (iso === referenceDate || iso === prevBusinessDate);
  };
  const visibleCalledOpps = hideActivityOnDate
    ? calledOpps.filter(o => !lastActivityOnReference(o.bfoOpp))
    : calledOpps;
  const visibleOutbound = hideActivityOnDate
    ? todaysOutbound.filter(e => !lastActivityOnReference(e.bfoOpp))
    : todaysOutbound;
  const visibleMeetings = hideActivityOnDate
    ? todaysMeetings.filter(m => !lastActivityOnReference(m.bfoOpp))
    : todaysMeetings;
  const activityHiddenCount =
    (calledOpps.length - visibleCalledOpps.length)
    + (todaysOutbound.length - visibleOutbound.length)
    + (todaysMeetings.length - visibleMeetings.length);

  // Unified Activity rows: Sent emails + Called + Meetings, normalized to
  // one shape and tagged with `type` (email / call / meeting). Emails and
  // meetings carry an overrideKey so their BFO Opportunity tag is
  // editable; calls come straight off the Opps sheet, so they're shown
  // read-only. Sorted newest-first by timestamp; calls (no timestamp)
  // fall to the bottom.
  const activityRows = useMemo(() => {
    const rows = [];
    for (const e of visibleOutbound) {
      rows.push({
        rowKey: `email:${e.id}`, type: 'email', ts: e.ts, endTs: null,
        title: e.subject, to: e.to, rawTo: e.rawTo, recipients: e.recipients || [],
        company: e.company, bfoOpp: e.bfoOpp, bfoUrl: e.bfoUrl,
        outcome: e.status || '', location: '', overrideKey: e.overrideKey,
        isManual: e.isManual, editable: true, emailId: e.id,
      });
    }
    for (const o of visibleCalledOpps) {
      rows.push({
        rowKey: `call:${o.id}`, type: 'call', ts: null, endTs: null,
        title: o.nextSteps || '', to: '', rawTo: '', recipients: [],
        company: (o.company && o.company !== '—') ? o.company : '', bfoOpp: o.bfoOpp, bfoUrl: o.bfoUrl,
        outcome: '', location: '', overrideKey: '', isManual: false, editable: false,
      });
    }
    for (const m of visibleMeetings) {
      rows.push({
        rowKey: `meeting:${m.id}`, type: 'meeting', ts: m.ts, endTs: m.endTs,
        title: m.title, to: '', rawTo: '', recipients: [],
        company: m.company, bfoOpp: m.bfoOpp, bfoUrl: '',
        outcome: m.outcome || '', location: m.location || '', overrideKey: m.overrideKey,
        isManual: m.isManual, editable: true, meetingId: m.id,
      });
    }
    rows.sort((a, b) => (new Date(b.ts || 0)) - (new Date(a.ts || 0)));
    return rows;
  }, [visibleOutbound, visibleCalledOpps, visibleMeetings]);

  // BFO opps whose Close Date should slip by 30 days. Three windows
  // collapsed into one filter, all keyed off the BFO Sales Stage number
  // (which is why we read the BFO Activity tab — the Opps sheet's
  // Stage column doesn't carry the 1-6 BFO sales-stage value):
  //   • Stage ≤ 4 and < 100 days from today
  //   • Stage = 5 and < 60 days
  //   • Stage = 6 and < 30 days
  const closeDateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const closeCol = bfoActivity.headers.find(h => /close\s*date/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !closeCol || !oppCol) return [];
    const rows = [];
    for (const r of bfoActivity.rows) {
      const stage = bfoStageNumber(r[stageCol]);
      if (stage === null) continue;
      const closeRaw = String(r[closeCol] || '').trim();
      const days = daysUntilDate(closeRaw);
      if (days === null) continue;
      let include = false;
      if (stage <= 4 && days < 100) include = true;
      else if (stage === 5 && days < 60) include = true;
      else if (stage === 6 && days < 30) include = true;
      if (!include) continue;
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      rows.push({
        id: `${name}|${closeRaw}`,
        name,
        stage,
        stageLabel: String(r[stageCol] || '').trim(),
        currentClose: closeRaw,
        newClose: addDaysFormatted(closeRaw, 30),
        daysOut: days,
      });
    }
    rows.sort((a, b) => a.daysOut - b.daysOut);
    return rows;
  }, [bfoActivity]);

  // BFO ↔ Opps amount discrepancies. Joins each BFO Activity row to
  // its Opps record by BFO Opportunity Name (BFO's "Opportunity Name"
  // column == Opps' "BFO Link" column). When the rounded amounts
  // differ, we surface the BFO Address + the Opps Quoted Amount so
  // the AI assistant can update BFO to match. Rows where either side
  // doesn't carry a numeric amount are skipped — they're indistinguishable
  // from "not yet quoted" and would generate noise.
  const amountUpdateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const amtCol = bfoActivity.headers.find(h => /^amount$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!amtCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const bfoAmt = parseMoneyNumber(r[amtCol]);
      const oppsAmt = parseMoneyNumber(oppsRow['Quoted Amount']);
      if (bfoAmt == null || oppsAmt == null) continue;
      if (Math.round(bfoAmt) === Math.round(oppsAmt)) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        stage: stageCol ? String(r[stageCol] || '').trim() : '',
        bfoUrl,
        bfoAmount: bfoAmt,
        quotedAmount: oppsAmt,
        quotedAmountFmt: fmtMoney(oppsAmt),
      });
    }
    rows.sort((a, b) => (b.quotedAmount - b.bfoAmount) - (a.quotedAmount - a.bfoAmount));
    return rows;
  }, [bfoActivity, oppsCache]);

  // BFO ↔ Opps stage mismatches. For each BFO Activity row we look up
  // its joined Opps record by Opportunity Name, then check whether the
  // BFO Sales Stage matches the BFO stage we'd expect for that opp's
  // current Opps 2 Stage. Mismatches surface the BFO Link + the
  // expected BFO stage so the AI assistant can advance BFO to match.
  const stageChangeOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const oppsStage = String(oppsRow.Stage || '').trim();
      const expectedBfoStage = OPPS_STAGE_TO_BFO_STAGE[oppsStage.toLowerCase()];
      if (!expectedBfoStage) continue;
      const bfoStage = String(r[stageCol] || '').trim();
      if (!bfoStage) continue;
      if (bfoStage.toLowerCase() === expectedBfoStage.toLowerCase()) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        bfoStage,
        oppsStage,
        expectedBfoStage,
        bfoUrl,
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return rows;
  }, [bfoActivity, oppsCache]);

  // Not-Sold opps that still have a corresponding BFO row open. Each
  // pulls its Reason Not Sold from Opps 2 and maps it to the Status +
  // Reason values BFO expects when closing the opp out. Rows whose
  // Reason Not Sold isn't in the mapping table fall through so the
  // user can see them and either update the row or extend the table.
  const closeNotSoldOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    if (!records.length) return [];
    // Index BFO Activity by opportunity name so we can quickly check
    // whether an Opps 2 row has a corresponding open BFO opp. Collapse
    // runs of whitespace and lower-case so a stray double-space in
    // either the BFO Link or the Opportunity Name doesn't drop the
    // match.
    const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const bfoByName = new Map();
    const headers = bfoActivity?.headers || [];
    const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
    if (oppCol) {
      for (const r of (bfoActivity?.rows || [])) {
        const k = normalizeName(r[oppCol]);
        if (k && !bfoByName.has(k)) bfoByName.set(k, r);
      }
    }
    const rows = [];
    const seen = new Set();
    for (const r of records) {
      const stage = String(r.Stage || '').trim().toLowerCase();
      if (stage !== 'not sold') continue;
      const bfoOpp = String(r['BFO Link'] || '').trim();
      if (!bfoOpp || bfoOpp === '-' || bfoOpp === '#N/A') continue;
      const key = normalizeName(bfoOpp);
      if (seen.has(key)) continue;
      // Only surface opps that still exist on the BFO Activity tab —
      // the prompt is about closing them out in BFO, so a BFO row is
      // required.
      if (bfoByName.size > 0 && !bfoByName.has(key)) continue;
      // URL is nice-to-have, not a gate: a Not-Sold opp with a
      // matching BFO Activity row but a missing BFO Address still
      // surfaces here (with the URL cell flagged red) so the user can
      // patch the Opps 2 row.
      const bfoUrl = detectBfoUrl(r);
      const reasonNotSold = String(r['Reason Not Sold'] || '').trim();
      const map = REASON_NOT_SOLD_TO_BFO[reasonNotSold.toLowerCase()] || null;
      seen.add(key);
      rows.push({
        id: `${key}|${bfoUrl || bfoOpp}`,
        name: bfoOpp,
        account: String(r.Account || '').trim(),
        reasonNotSold,
        status: map?.status || '',
        reason: map?.reason || '',
        unmapped: !map,
        bfoUrl,
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return rows;
  }, [oppsCache, bfoActivity]);

  // AI BFO Prep — live Opps 2 opps (Stage not Sold / Not Sold) that have
  // a non-blank Call In, carry a BFO Opportunity Name (BFO Link), but
  // have no BFO Address yet. The user fills in each BFO Address inline;
  // once set, the opp drops off this list.
  const bfoPrepOpps = useMemo(() => {
    const recs = oppsCache?.records || [];
    const rows = [];
    for (const r of recs) {
      const name = String(r['BFO Link'] ?? '').trim();
      if (bfoFieldBlank(name)) continue;
      if (!bfoFieldBlank(r['BFO Address'])) continue;
      // Live opps only — drop closed stages.
      if (CLOSED_OPP_STAGES.has(String(r.Stage || '').trim().toLowerCase())) continue;
      // Only opps with an actual Call In number (on a callback schedule).
      if (resolveOppCallIn(r) == null) continue;
      rows.push({
        id: r._id,
        name,
        account: String(r.Account || '').trim(),
        bfoAddress: String(r['BFO Address'] ?? '').trim(),
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
    return rows;
  }, [oppsCache]);

  const [bfoPrepCopyFlash, setBfoPrepCopyFlash] = useState('');

  // Persist a BFO Address edit straight to Opps 2 (cache + Firestore) and
  // optimistically update the local cache so the row reflects it / drops
  // off the prep list immediately.
  const updateOppBfoAddress = async (oppId, value) => {
    setOppsCache(prev => (prev && Array.isArray(prev.records))
      ? { ...prev, records: prev.records.map(r => (String(r._id) === String(oppId) ? { ...r, 'BFO Address': value } : r)) }
      : prev);
    try {
      await setOppField(user?.uid, oppId, 'BFO Address', value);
    } catch (err) {
      console.error('AI BFO Prep: failed to save BFO Address', { oppId, err });
    }
  };

  const dateLabel = useMemo(() => parseIsoDate(referenceDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), [referenceDate]);
  const isToday = referenceDate === todayIso();

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const oppsLoaded = (oppsCache?.records?.length || 0) > 0;

  // Single master prompt that bundles every AI Prompt section on the
  // page so the user can paste one block into their assistant instead
  // of copying each section one at a time. Each section keeps the
  // same prompt + appended data block its individual Copy button
  // would produce; sections are separated by a heading rule so the
  // assistant can still tell them apart.
  const masterPromptBundle = useMemo(() => {
    const activityLines = ['BFO Address'];
    {
      const seen = new Set();
      for (const e of todaysOutbound) {
        if (!e.bfoUrl || seen.has(e.bfoUrl)) continue;
        activityLines.push(`${e.bfoUrl}: Type ${e.nextStepsType}`);
        seen.add(e.bfoUrl);
      }
      for (const o of calledOpps) {
        if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
        activityLines.push(`${o.bfoUrl}: Type called`);
        seen.add(o.bfoUrl);
      }
    }
    const activityBlock = activityLines.join('\n');

    const newBfoLines = ['BFO Opportunities to Create', 'BFO Company Name | Project Name | Product Line | Local Project Name'];
    for (const o of newBfoOpps) {
      newBfoLines.push([o.bfoCompanyName, o.projectName, o.productLine, o.localProjectName].join(' | '));
    }
    const newBfoBlock = newBfoLines.join('\n');

    const closeDatesLines = ['Opportunity Name\tNew Close Date'];
    for (const o of closeDateOpps) closeDatesLines.push(`${o.name}\t${o.newClose}`);
    const closeDatesBlock = closeDatesLines.join('\n');

    const amountLines = ['BFO Address\tQuoted Amount'];
    for (const o of amountUpdateOpps) amountLines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
    const amountBlock = amountLines.join('\n');

    const stageLines = ['BFO Link\tNew Stage'];
    for (const o of stageChangeOpps) stageLines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
    const stageBlock = stageLines.join('\n');

    const closeNotSoldLines = ['BFO Link\tStatus\tReason'];
    for (const o of closeNotSoldOpps) {
      if (o.unmapped) continue;
      closeNotSoldLines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}`);
    }
    const closeNotSoldBlock = closeNotSoldLines.join('\n');

    const bfoPrepBlock = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');

    const sections = [
      { title: 'BFO Prep', prompt: bfoPrepPrompt, block: bfoPrepBlock, hasData: bfoPrepOpps.length > 0 },
      { title: 'Activity', prompt: aiPrompt, block: activityBlock, hasData: activityLines.length > 1 },
      { title: 'New BFO Opp', prompt: newBfoOppPrompt, block: newBfoBlock, hasData: newBfoOpps.length > 0 },
      { title: 'Close Dates', prompt: closeDatesPrompt, block: closeDatesBlock, hasData: closeDateOpps.length > 0 },
      { title: 'Amount Updates', prompt: amountUpdatesPrompt, block: amountBlock, hasData: amountUpdateOpps.length > 0 },
      { title: 'Stage Change', prompt: stageChangePrompt, block: stageBlock, hasData: stageChangeOpps.length > 0 },
      { title: 'Close Not Solds', prompt: closeNotSoldsPrompt, block: closeNotSoldBlock, hasData: closeNotSoldLines.length > 1 },
    ];
    // Skip sections that carry no data — when a section is just its prompt
    // with an empty data block (no BFO links, names, or opportunities to
    // act on), there's nothing for the assistant to do, so leave it out of
    // the bundle. hasData checks the underlying rows (the header-only line
    // count for the deduped / filtered blocks) rather than the prompt text.
    const base = sections
      .filter(s => s.hasData)
      .map(s => `===== ${s.title} =====\n${s.prompt}\n\n${s.block}`)
      .join('\n\n');
    // Update BFO Activity closes out the bundle (no data block of its own).
    const bfoSuffix = (updateBfoActivityPrompt || '').trim();
    if (!bfoSuffix) return base;
    const suffixSection = `===== Update BFO Activity =====\n${bfoSuffix}`;
    return base ? `${base}\n\n${suffixSection}` : suffixSection;
  }, [
    aiPrompt, newBfoOppPrompt, closeDatesPrompt, amountUpdatesPrompt,
    stageChangePrompt, closeNotSoldsPrompt, updateBfoActivityPrompt,
    bfoPrepPrompt, todaysOutbound, calledOpps, newBfoOpps, closeDateOpps,
    amountUpdateOpps, stageChangeOpps, closeNotSoldOpps, bfoPrepOpps,
  ]);

  const [copyAllFlash, setCopyAllFlash] = useState('');
  const onCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(masterPromptBundle);
      setCopyAllFlash('Copied all!');
    } catch {
      setCopyAllFlash('Copy failed');
    }
    window.setTimeout(() => setCopyAllFlash(''), 1500);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <span className={styles.dateline}>{dateLabel}</span>
        <label className={styles.dateField} title="Pick the date the activity sections (sent emails, meetings, called opps) should reference.">
          Activity date
          <input
            type="date"
            className={styles.dateInput}
            value={referenceDate}
            max={todayIso()}
            onChange={(e) => setReferenceDate(e.target.value || todayIso())}
          />
          {!isToday && (
            <button
              type="button"
              className={styles.dateResetBtn}
              onClick={() => setReferenceDate(todayIso())}
              title="Jump back to today"
            >Today</button>
          )}
        </label>
        <label
          className={styles.hideActivityField}
          title="Hide rows in the Called and Sent tables whose Last Activity falls within the past 2 business days (the selected Activity date or the previous business day)."
        >
          <input
            type="checkbox"
            checked={hideActivityOnDate}
            onChange={(e) => {
              const on = e.target.checked;
              setHideActivityOnDate(on);
              writeHideActivityOnDate(on);
            }}
          />
          Hide rows last active in the past 2 business days
        </label>
        <button
          type="button"
          className={styles.refreshActivityBtn}
          onClick={refreshActivityCache}
          disabled={activityRefreshing}
          title="Re-pull every HubSpot email, call, and meeting AND re-fetch the Opps Google Sheet. Updates the shared activity cache (same as the Activity tab's Refresh) and the Opps cache (same as the Opps tab's Refresh)."
        >
          {activityRefreshing
            ? (activityRefreshProgress
                ? `Refreshing… ${activityRefreshProgress.email || 0} email · ${activityRefreshProgress.call || 0} call · ${activityRefreshProgress.meeting || 0} meeting · ${activityRefreshProgress.opps || 0} opps`
                : 'Refreshing…')
            : 'Refresh Activity & Opps'}
        </button>
        <button
          type="button"
          className={styles.refreshActivityBtn}
          onClick={onCopyAll}
          title="Copy every AI Prompt section on this page into one master prompt, ready to paste into an assistant."
        >Copy all prompts</button>
        {copyAllFlash && <span className={styles.copyFlash}>{copyAllFlash}</span>}
      </div>
      {newBfoMissingData.length > 0 && (
        <div className={styles.errorBanner}>
          <strong>New BFO Opp prompt is missing data for {newBfoMissingData.length} opp{newBfoMissingData.length === 1 ? '' : 's'}:</strong>{' '}
          {newBfoMissingData.map((m, i) => (
            <span key={m.company + i}>
              {i > 0 && '; '}
              <strong>{m.company}</strong> — {m.missing.join(', ')}
            </span>
          ))}
          {' '}(BFO Company Name comes from the company&rsquo;s Table View record; Product Line / Type / Region / Local Project Name come from Dropdowns › Services for the opp&rsquo;s Scope.)
        </div>
      )}
      {activityRefreshError && (
        <div className={styles.staleBanner}>
          Refresh failed: {activityRefreshError}
        </div>
      )}
      {senderEmail ? (
        <p className={styles.subnote}>
          The Activity table merges outbound emails from <strong>{senderEmail}</strong> (to non-SE recipients, past 2 business days), logged calls from the Opps tab, and meetings on {isToday ? 'today' : `${dateLabel}`}&rsquo;s calendar — the Type column marks each row as Email, Call, or Meeting. BFO Opportunity tagging walks each recipient&rsquo;s email against the Opps tab&rsquo;s Contact field first, then estimates by company name — fuzzy-matching the HubSpot company (or, when there&rsquo;s no HubSpot contact, the company guessed from the email domain) against the Opps tab&rsquo;s Account field. Use the inline picker to set or change any tag (it shows that company&rsquo;s opportunities first); your selection is remembered for that recipient on future emails. The BFO Company Name column is resolved from the Company. Use the Columns menu to choose which columns are shown.
        </p>
      ) : (
        <div className={styles.staleBanner}>
          Set your work email in Settings → CDM Name so this section can match your outbound HubSpot emails. Until then, no Sent emails will appear.
        </div>
      )}

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>sent emails</div>
        <div className={styles.tally}><strong>{calledOpps.length}</strong>call{calledOpps.length === 1 ? '' : 's'}</div>
        <div className={styles.tally}><strong>{todaysMeetings.length}</strong>meeting{todaysMeetings.length === 1 ? '' : 's'}</div>
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
        </div>
      )}
      {cache && !oppsLoaded && (
        <div className={styles.staleBanner}>
          No Opps cache loaded yet. Visit the Opps tab to populate the BFO Opportunity column.
        </div>
      )}
      {cache && fetchedLabel && (
        <div className={styles.subnote}>Cache last refreshed {fetchedLabel}.</div>
      )}

      <section className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <h2 className={styles.sectionHeader}>
            Activity <span className={styles.sectionCount}>{activityRows.length}</span>
          </h2>
          <div ref={activityColsMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setActivityColsMenuOpen(o => !o)}
              title="Choose which columns are visible on the Activity table"
            >
              Columns ({ACTIVITY_COLUMNS.length - hiddenActivityCols.size}/{ACTIVITY_COLUMNS.length}) ▾
            </button>
            {activityColsMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '0.35rem', minWidth: 190 }}>
                {ACTIVITY_COLUMNS.map(col => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.25rem 0.4rem', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={isActivityColVisible(col.key)} onChange={() => toggleActivityCol(col.key)} />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              {isActivityColVisible('time') && <th style={{ width: 110 }}>Time</th>}
              {isActivityColVisible('type') && <th style={{ width: 80 }}>Type</th>}
              {isActivityColVisible('subject') && <th>Subject / Title</th>}
              {isActivityColVisible('to') && <th>To (external)</th>}
              {isActivityColVisible('company') && <th>Company</th>}
              {isActivityColVisible('bfoCompanyName') && <th>BFO Company Name</th>}
              {isActivityColVisible('bfoOpp') && <th>BFO Opportunity</th>}
              {isActivityColVisible('lastActivity') && <th style={{ width: 110 }}>Last Activity</th>}
              {isActivityColVisible('bfoLink') && <th style={{ width: 70 }}>BFO Link</th>}
              {isActivityColVisible('outcome') && <th style={{ width: 130 }}>Outcome / Status</th>}
              {isActivityColVisible('location') && <th>Location</th>}
              <th style={{ width: 64 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {activityRows.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={ACTIVITY_COLUMNS.length - hiddenActivityCols.size + 1}>No activity (emails, calls, or meetings) for {isToday ? 'today' : dateLabel}.</td>
              </tr>
            ) : activityRows.map(r => {
                const lastActivity = lastActivityFor(r.bfoOpp);
                const bfoCompanyName = resolveBfoCompanyName(r);
                const typeLabel = r.type === 'email' ? 'Email' : r.type === 'call' ? 'Call' : 'Meeting';
                return (
                <tr key={r.rowKey}>
                  {isActivityColVisible('time') && <td className={r.ts ? '' : styles.muted}>{r.ts ? `${fmtTime(r.ts)}${r.endTs ? ` – ${fmtTime(r.endTs)}` : ''}` : '—'}</td>}
                  {isActivityColVisible('type') && <td>{typeLabel}</td>}
                  {isActivityColVisible('subject') && <td className={r.title ? '' : styles.muted} title={r.title}>{r.title || '—'}</td>}
                  {isActivityColVisible('to') && <td title={r.rawTo}>{r.to || <span className={styles.muted}>—</span>}</td>}
                  {isActivityColVisible('company') && <td className={r.company ? '' : styles.muted}>{r.company || '—'}</td>}
                  {isActivityColVisible('bfoCompanyName') && <td className={bfoCompanyName ? '' : styles.muted}>{bfoCompanyName || '—'}</td>}
                  {isActivityColVisible('bfoOpp') && (
                    <td>
                      {r.editable ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {r.bfoOpp && (
                            <span className={styles.overrideValue}>
                              {r.bfoOpp}
                              {r.isManual && (
                                <button
                                  type="button"
                                  className={styles.overrideClear}
                                  onClick={() => clearOverride(r.overrideKey)}
                                  title="Clear manual tag (revert to auto-match)"
                                >✕</button>
                              )}
                            </span>
                          )}
                          <OppPicker
                            oppsCache={oppsCache}
                            company={r.company}
                            triggerLabel={r.bfoOpp ? '✎ Change' : '+ Pick opportunity'}
                            onSelect={(opp) => setOverride(r.overrideKey, opp)}
                          />
                        </div>
                      ) : (
                        <span className={r.bfoOpp ? '' : styles.muted} title={r.title}>{r.bfoOpp || '—'}</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('lastActivity') && <td className={lastActivity ? '' : styles.muted}>{lastActivity || '—'}</td>}
                  {isActivityColVisible('bfoLink') && (
                    <td>
                      {r.bfoUrl ? (
                        <a
                          href={r.bfoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.bfoLink}
                        >Open</a>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('outcome') && <td className={r.outcome ? '' : styles.muted}>{r.outcome || '—'}</td>}
                  {isActivityColVisible('location') && <td className={r.location ? '' : styles.muted}>{r.location || '—'}</td>}
                  <td className={styles.actionsCell}>
                    {r.type === 'email' && (
                      <>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => ignoreEmail(r.emailId)}
                          title="Hide just this email from the Activity table"
                          aria-label="Ignore email"
                        >✕</button>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => excludeRecipient(r.recipients)}
                          disabled={!r.recipients?.length}
                          title={r.recipients?.length
                            ? `Don't include emails to ${r.recipients.join(', ')} moving forward`
                            : 'No external recipient to exclude'}
                          aria-label="Exclude recipient from future activity"
                        >🚫</button>
                      </>
                    )}
                    {r.type === 'meeting' && (
                      <button
                        type="button"
                        className={styles.ignoreBtn}
                        onClick={() => ignoreMeeting(r.meetingId)}
                        title="Hide this meeting from the Activity table"
                        aria-label="Ignore meeting"
                      >✕</button>
                    )}
                  </td>
                </tr>
                );
              })}
          </tbody>
        </table>
        {hideActivityOnDate && activityHiddenCount > 0 && (
          <p className={styles.subnote}>
            Hiding {activityHiddenCount} row{activityHiddenCount === 1 ? '' : 's'} last active in the past 2 business days.
          </p>
        )}
        {excludedRecipients.length > 0 && (
          <p className={styles.subnote}>
            Hiding emails to {excludedRecipients.length} excluded recipient{excludedRecipients.length === 1 ? '' : 's'} ({excludedRecipients.join(', ')}).{' '}
            <button type="button" className={styles.linkBtn} onClick={clearExcludedRecipients}>Restore all</button>
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          AI BFO Prep
          <span className={styles.sectionCount}>{bfoPrepOpps.length}</span>
        </h2>
        <p className={styles.subnote}>
          Live Opps 2 opps (Stage not Sold / Not Sold) with a Call In number that have a BFO Opportunity Name but no BFO Address yet. Copy the prompt to have your AI assistant look up each opp&rsquo;s BFO website address, then paste it into the BFO Address column below — it saves straight to Opps 2 and the row drops off once set.
        </p>
        {revealedPrompts.bfoPrep && (
          <textarea
            className={styles.aiPromptInput}
            value={bfoPrepPrompt}
            onChange={(e) => updateBfoPrepPrompt(e.target.value)}
            rows={12}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            disabled={bfoPrepOpps.length === 0}
            onClick={async () => {
              const block = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');
              const fullPrompt = `${bfoPrepPrompt}\n\n${block}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setBfoPrepCopyFlash('Copied!');
              } catch {
                setBfoPrepCopyFlash('Copy failed');
              }
              window.setTimeout(() => setBfoPrepCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('bfoPrep')}>
            {revealedPrompts.bfoPrep ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.bfoPrep && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetBfoPrepPrompt}>Reset to default</button>
          )}
          {bfoPrepCopyFlash && <span className={styles.copyFlash}>{bfoPrepCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Company</th>
                <th>BFO Opportunity Name</th>
                <th style={{ minWidth: 280 }}>BFO Address</th>
              </tr>
            </thead>
            <tbody>
              {bfoPrepOpps.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={3}>No opps are missing a BFO Address (every opp with a BFO Opportunity Name already has one).</td>
                </tr>
              ) : bfoPrepOpps.map(o => (
                <tr key={o.id}>
                  <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                  <td>{o.name}</td>
                  <td>
                    <BfoAddressCell
                      value={o.bfoAddress}
                      onCommit={(v) => updateOppBfoAddress(o.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(() => {
        // Build the BFO Address block from today's outbound emails AND
        // the Called section so the AI prompt covers both touch types
        // in one pass. Dedupe by URL so an opp that appears in both
        // lists only gets one line (the email entry wins, matching the
        // tab's read order).
        const lines = ['BFO Address'];
        const seen = new Set();
        for (const e of todaysOutbound) {
          if (!e.bfoUrl || seen.has(e.bfoUrl)) continue;
          lines.push(`${e.bfoUrl}: Type ${e.nextStepsType}`);
          seen.add(e.bfoUrl);
        }
        for (const o of calledOpps) {
          if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
          lines.push(`${o.bfoUrl}: Type called`);
          seen.add(o.bfoUrl);
        }
        const addressBlock = lines.join('\n');
        const fullPrompt = `${aiPrompt}\n\n${addressBlock}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCopyFlash('Copied!');
          } catch {
            setCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Activity)</h2>
            <p className={styles.subnote}>
              The past 2 business days&rsquo; BFO addresses (sent emails and calls) are appended automatically. Click Copy to grab the full prompt for your AI assistant, or Edit prompt to tweak the wording.
            </p>
            {revealedPrompts.activity && (
              <textarea
                className={styles.aiPromptInput}
                value={aiPrompt}
                onChange={(e) => updateAiPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('activity')}>
                {revealedPrompts.activity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.activity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAiPrompt}>Reset to default</button>
              )}
              {copyFlash && <span className={styles.copyFlash}>{copyFlash}</span>}
            </div>
            {revealedPrompts.activity && (
              <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            )}
          </section>
        );
      })()}

      {(() => {
        // New BFO Opp prompt — table of qualifying opps the AI assistant
        // should create in BFO. The user only needs BFO Company Name and
        // Project Name in the pasted block; the rest of the fields stay
        // on the New BFO Opp table for review but are dropped from the
        // prompt to keep the AI focused.
        const header = 'BFO Company Name | Project Name | Product Line | Local Project Name';
        const lines = ['BFO Opportunities to Create', header];
        for (const o of newBfoOpps) {
          lines.push([
            o.bfoCompanyName,
            o.projectName,
            o.productLine,
            o.localProjectName,
          ].join(' | '));
        }
        const block = lines.join('\n');
        const fullPrompt = `${newBfoOppPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setNewBfoOppCopyFlash('Copied!');
          } catch {
            setNewBfoOppCopyFlash('Copy failed');
          }
          window.setTimeout(() => setNewBfoOppCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (New BFO Opp)
              <span className={styles.sectionCount}>{newBfoOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Lists Opps whose Stage is not Not Started / Not Sold / Sold and whose BFO Opportunity Name is &ldquo;-&rdquo; (the placeholder for opps that still need a BFO opp created). Blank or &ldquo;#N/A&rdquo; values are excluded.
            </p>
            {revealedPrompts.newBfoOpp && (
              <textarea
                className={styles.aiPromptInput}
                value={newBfoOppPrompt}
                onChange={(e) => updateNewBfoOppPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('newBfoOpp')}>
                {revealedPrompts.newBfoOpp ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.newBfoOpp && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetNewBfoOppPrompt}>Reset to default</button>
              )}
              {newBfoOppCopyFlash && <span className={styles.copyFlash}>{newBfoOppCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Company</th>
                    <th>BFO Company Name</th>
                    <th>Lead Source</th>
                    <th style={{ width: 110 }}>Current Customer</th>
                    <th>Scope</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th>Project Name</th>
                    <th>Product Line</th>
                    <th>Local Project Name</th>
                    <th>Type</th>
                    <th>Region</th>
                    <th>Class</th>
                    <th>Years</th>
                  </tr>
                </thead>
                <tbody>
                  {newBfoOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={14}>No Opps currently match (Stage ≠ Not Started / Not Sold / Sold and BFO Opportunity Name is &ldquo;-&rdquo;).</td>
                    </tr>
                  ) : newBfoOpps.map(o => {
                    const matchedProspect = prospectByNorm.get(normalizeCompany(o.company)) || null;
                    return (
                    <tr key={o.id}>
                      <td>
                        {o.raw && (
                          <button
                            type="button"
                            onClick={() => setInfoOpp(o.raw)}
                            title="Show opp info"
                            style={{
                              padding: 0, width: 22, height: 22, lineHeight: 1,
                              fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
                              color: 'var(--color-accent)', background: '#fff',
                              border: '1px solid var(--color-accent)', borderRadius: '50%',
                              cursor: 'pointer',
                            }}
                          >i</button>
                        )}
                      </td>
                      <td className={o.company && o.company !== '—' ? '' : styles.muted}>{o.company || '—'}</td>
                      <NewBfoCompanyNameCell
                        prospect={matchedProspect}
                        value={o.bfoCompanyName}
                        onCommit={(v) => updateProspect && matchedProspect && updateProspect(matchedProspect.id, { bfoCompanyName: v })}
                      />
                      <td className={o.leadSource && o.leadSource !== '—' ? '' : styles.muted}>{o.leadSource || '—'}</td>
                      <td>
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: o.currentCustomer ? '#DCFCE7' : '#F1F5F9',
                          color: o.currentCustomer ? '#166534' : '#64748B',
                          border: `1px solid ${o.currentCustomer ? '#86EFAC' : '#CBD5E1'}`,
                        }}>{o.currentCustomer ? 'Yes' : 'No'}</span>
                      </td>
                      <td className={o.scope && o.scope !== '—' ? '' : styles.muted}>{o.scope || '—'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '—'}</td>
                      <td className={o.projectName ? '' : styles.muted}>{o.projectName || '—'}</td>
                      <td className={o.productLine ? '' : styles.muted}>{o.productLine || '—'}</td>
                      <td className={o.localProjectName ? '' : styles.muted}>{o.localProjectName || '—'}</td>
                      <td className={o.type ? '' : styles.muted}>{o.type || '—'}</td>
                      <td className={o.region ? '' : styles.muted}>{o.region || '—'}</td>
                      <td className={o.class ? '' : styles.muted}>{o.class || '—'}</td>
                      <td className={o.years ? '' : styles.muted}>{o.years || '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            {infoOpp && (
              <OppInfoModal
                opp={infoOpp}
                headers={oppsCache?.headers || []}
                onClose={() => setInfoOpp(null)}
              />
            )}
          </section>
        );
      })()}

      {(() => {
        // Close Dates prompt — a tab-delimited "Opportunity Name | New
        // Close Date" block the AI assistant can read row-by-row to
        // bump each opp's BFO Close Date 30 days out.
        const headerLine = 'Opportunity Name\tNew Close Date';
        const lines = [headerLine];
        for (const o of closeDateOpps) lines.push(`${o.name}\t${o.newClose}`);
        const block = lines.join('\n');
        const fullPrompt = `${closeDatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseDatesCopyFlash('Copied!');
          } catch {
            setCloseDatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseDatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Dates)
              <span className={styles.sectionCount}>{closeDateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              BFO opps that should slip 30 days: Stage ≤ 4 with under 100 days to close, Stage 5 under 60 days, Stage 6 under 30 days. Stages come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.closeDates && (
              <textarea
                className={styles.aiPromptInput}
                value={closeDatesPrompt}
                onChange={(e) => updateCloseDatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeDates')}>
                {revealedPrompts.closeDates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeDates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseDatesPrompt}>Reset to default</button>
              )}
              {closeDatesCopyFlash && <span className={styles.copyFlash}>{closeDatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>Current Close</th>
                    <th style={{ width: 90 }}>Days Out</th>
                    <th style={{ width: 130 }}>New Close Date</th>
                  </tr>
                </thead>
                <tbody>
                  {closeDateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={5}>No BFO opps currently meet the close-date slip criteria. Confirm the BFO Activity tab has fresh data.</td>
                    </tr>
                  ) : closeDateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.stageLabel || `Stage ${o.stage}`}</td>
                      <td>{o.currentClose}</td>
                      <td>{o.daysOut}</td>
                      <td>{o.newClose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Amount Updates prompt — for every BFO opp whose Amount disagrees
        // with the Opps tab's Quoted Amount, emit "BFO Address\tQuoted
        // Amount" so the AI assistant can open each link and bump the
        // BFO Unit Amount to match.
        const headerLine = 'BFO Address\tQuoted Amount';
        const lines = [headerLine];
        for (const o of amountUpdateOpps) lines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
        const block = lines.join('\n');
        const fullPrompt = `${amountUpdatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setAmountUpdatesCopyFlash('Copied!');
          } catch {
            setAmountUpdatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setAmountUpdatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Amount updates)
              <span className={styles.sectionCount}>{amountUpdateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Amount disagrees with the Opps tab&rsquo;s Quoted Amount. Join key is BFO Opportunity Name. BFO amounts come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.amountUpdates && (
              <textarea
                className={styles.aiPromptInput}
                value={amountUpdatesPrompt}
                onChange={(e) => updateAmountUpdatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('amountUpdates')}>
                {revealedPrompts.amountUpdates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.amountUpdates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAmountUpdatesPrompt}>Reset to default</button>
              )}
              {amountUpdatesCopyFlash && <span className={styles.copyFlash}>{amountUpdatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>BFO Amount</th>
                    <th style={{ width: 120 }}>Quoted Amount</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {amountUpdateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No discrepancies — every BFO opp matched against the Opps tab has the same amount. Confirm the BFO Activity tab has fresh data if you expected mismatches.</td>
                    </tr>
                  ) : amountUpdateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '—'}</td>
                      <td>{fmtMoney(o.bfoAmount)}</td>
                      <td>{o.quotedAmountFmt}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Stage Change prompt — every opp whose BFO Sales Stage doesn't
        // match what its current Opps 2 Stage maps to gets a
        // "BFO Link\tNew Stage" line so the AI assistant can update BFO.
        const headerLine = 'BFO Link\tNew Stage';
        const lines = [headerLine];
        for (const o of stageChangeOpps) lines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
        const block = lines.join('\n');
        const fullPrompt = `${stageChangePrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setStageChangeCopyFlash('Copied!');
          } catch {
            setStageChangeCopyFlash('Copy failed');
          }
          window.setTimeout(() => setStageChangeCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Stage Change)
              <span className={styles.sectionCount}>{stageChangeOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Sales Stage doesn&rsquo;t match what their Opps 2 Stage implies. Join key is BFO Opportunity Name. BFO stages come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.stageChange && (
              <textarea
                className={styles.aiPromptInput}
                value={stageChangePrompt}
                onChange={(e) => updateStageChangePrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('stageChange')}>
                {revealedPrompts.stageChange ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.stageChange && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetStageChangePrompt}>Reset to default</button>
              )}
              {stageChangeCopyFlash && <span className={styles.copyFlash}>{stageChangeCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Opps 2 Stage</th>
                    <th>BFO Stage (current)</th>
                    <th>New BFO Stage</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {stageChangeOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No stage mismatches — every BFO opp matched against the Opps tab is on the BFO stage its Opps 2 Stage maps to.</td>
                    </tr>
                  ) : stageChangeOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                      <td>{o.oppsStage}</td>
                      <td>{o.bfoStage}</td>
                      <td>{o.expectedBfoStage}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Close Not Solds prompt — every Not-Sold Opps 2 opp that's
        // still open on the BFO Activity tab. Output is a tab-delimited
        // "BFO Link\tStatus\tReason" block so the AI assistant can walk
        // each row and close it out. Rows without a known Reason Not
        // Sold mapping leave Status / Reason blank — surfaced in the
        // table so the user can act on them.
        const headerLine = 'BFO Link\tStatus\tReason';
        const lines = [headerLine];
        for (const o of closeNotSoldOpps) {
          if (o.unmapped) continue;
          lines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}`);
        }
        const block = lines.join('\n');
        const fullPrompt = `${closeNotSoldsPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseNotSoldsCopyFlash('Copied!');
          } catch {
            setCloseNotSoldsCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseNotSoldsCopyFlash(''), 1500);
        };
        const unmappedCount = closeNotSoldOpps.filter(o => o.unmapped).length;
        const readyCount = closeNotSoldOpps.length - unmappedCount;
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Not Solds)
              <span className={styles.sectionCount}>{closeNotSoldOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Not-Sold Opps 2 rows that still have a matching BFO Activity row. Status + Reason come from the Reason Not Sold → BFO mapping. Rows whose Reason Not Sold isn&rsquo;t in the mapping table are listed (highlighted) so you can update them on Opps 2 or extend the mapping.
            </p>
            {revealedPrompts.closeNotSolds && (
              <textarea
                className={styles.aiPromptInput}
                value={closeNotSoldsPrompt}
                onChange={(e) => updateCloseNotSoldsPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeNotSolds')}>
                {revealedPrompts.closeNotSolds ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeNotSolds && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseNotSoldsPrompt}>Reset to default</button>
              )}
              {closeNotSoldsCopyFlash && <span className={styles.copyFlash}>{closeNotSoldsCopyFlash}</span>}
            </div>
            {closeNotSoldOpps.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
                {readyCount} ready · {unmappedCount} need a mapped Reason Not Sold (excluded from the prompt block below).
              </div>
            )}
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Reason Not Sold</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {closeNotSoldOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No Not-Sold opps with a matching BFO Activity row. Paste fresh BFO Activity data if you expected matches.</td>
                    </tr>
                  ) : closeNotSoldOpps.map(o => (
                    <tr key={o.id} style={o.unmapped ? { background: '#FEF3C7' } : undefined}>
                      <td className={o.name ? '' : styles.missing}>{o.name || 'Missing'}</td>
                      <td className={o.account ? '' : styles.missing}>{o.account || 'Missing'}</td>
                      <td className={o.reasonNotSold ? '' : styles.missing}>{o.reasonNotSold || 'Missing'}</td>
                      <td className={o.status ? '' : styles.missing}>{o.status || (o.unmapped ? 'Missing (unmapped reason)' : 'Missing')}</td>
                      <td className={o.reason ? '' : styles.missing}>{o.reason || (o.unmapped ? 'Missing (unmapped reason)' : 'Missing')}</td>
                      <td className={o.bfoUrl ? '' : styles.missing}>
                        {o.bfoUrl ? (
                          <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                        ) : 'Missing'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
      {(() => {
        const fullPrompt = updateBfoActivityPrompt;
        const onCopy = async () => {
          try {
            // This prompt is itself the suffix, so copy it as-is (no
            // double-append).
            await navigator.clipboard.writeText(fullPrompt);
            setUpdateBfoActivityCopyFlash('Copied!');
          } catch {
            setUpdateBfoActivityCopyFlash('Copy failed');
          }
          window.setTimeout(() => setUpdateBfoActivityCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Update BFO Activity)</h2>
            <p className={styles.subnote}>
              Appended to the end of every prompt copy on this page (and &ldquo;Copy all prompts&rdquo;) so the assistant finishes by re-pulling the BFO Opportunity list into the BFO Activity tab. You can copy it on its own here too.
            </p>
            {revealedPrompts.updateBfoActivity && (
              <textarea
                className={styles.aiPromptInput}
                value={updateBfoActivityPrompt}
                onChange={(e) => updateUpdateBfoActivityPrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('updateBfoActivity')}>
                {revealedPrompts.updateBfoActivity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.updateBfoActivity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetUpdateBfoActivityPrompt}>Reset to default</button>
              )}
              {updateBfoActivityCopyFlash && <span className={styles.copyFlash}>{updateBfoActivityCopyFlash}</span>}
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
    </div>
  );
}
