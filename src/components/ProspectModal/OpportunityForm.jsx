import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { ScopingNotesEditor } from './ScopingNotesEditor';
import { SERVICE_CATEGORIES } from '../../data/enums';
import { SERVICE_QUESTIONS, SERVICE_THEIR_QUESTIONS } from '../../data/serviceQuestions';
import * as MsgReaderModule from '@kenjiuno/msgreader';
// CJS default-export interop: depending on how Vite resolves the package,
// the class can land at either MsgReaderModule.default or one extra level
// down. Unwrap once if needed so `new MsgReader(...)` works either way.
const MsgReader = (MsgReaderModule?.default?.default || MsgReaderModule?.default || MsgReaderModule);
// OutlookMeetingPicker exists at ./OutlookMeetingPicker.jsx but is not
// wired in: it requires a Microsoft Entra ID app registration in the
// user's tenant (OUTLOOK_CLIENT_ID env var on Vercel), which Schneider
// Electric IT does not provision for personal-tracker tools. Re-enable
// by importing it and the button block in the meeting drop zone if/when
// an app is registered.

// Uncontrolled-ish text input / textarea that holds its own local state
// and only propagates up on blur. Used for the heavy free-form fields
// (summary, intent, context, table cells…) so keystrokes don't trigger
// a re-render of the entire OpportunityForm tree. Still syncs in when
// the parent value legitimately changes (opp-link autofill, template
// self-heal, etc.).
// Flat list of every service from the Services Explored picker —
// drives the @-mention dropdown on the Scoping Details Notes field.
// De-duped while preserving the source order so DATA-tier services
// stay grouped together when no query is typed.
const SCOPING_SERVICE_OPTIONS = (() => {
  const seen = new Set();
  const out = [];
  for (const cat of SERVICE_CATEGORIES) {
    for (const item of cat.items) {
      if (!seen.has(item)) { seen.add(item); out.push(item); }
    }
  }
  return out;
})();

// Default form schema. Edit these arrays to change the template.
// `autofill` is the Opps sheet column whose value should populate the field
// when an opportunity is linked.
export const DEFAULT_FORM_TEMPLATE = {
  fields: [
    { key: 'stage', label: 'Stage', type: 'text', autofill: 'Stage' },
    { key: 'status', label: 'Status', type: 'text' }, // populated from the linked opp's account (prospects), not the opp row
    // Auto-populated from the matched prospect's website field; rendered
    // as a clickable link in the form header and as a hyperlink in the
    // Excel export.
    { key: 'companyWebsite', label: 'Company Website', type: 'text', isLink: true },
    { key: 'scope', label: 'Scope Being Explored', type: 'text', autofill: 'Scope' },
    { key: 'clientManager', label: 'Client Manager', type: 'text' },
    // Auto-populated with the matched prospect's current active services
    // (Sold / Renewal / In Progress) on opp-link, but editable any time.
    { key: 'currentScope', label: 'Current Scope', type: 'textarea' },
    { key: 'region', label: 'Region', type: 'select', options: ['EU', 'Global', 'NAM', 'APAC', 'LATAM'] },
    { key: 'summary', label: 'General Notes', type: 'textarea' },
    // Free-form scoping notes that support @-mentions of services from
    // the Services Explored list (see ScopingNotesEditor).
    { key: 'scopingNotes', label: 'Scoping Details Notes', type: 'scopingNotes' },
  ],
  tables: [
    {
      key: 'agenda',
      label: 'Agenda',
      placement: 'top', // renders before the Stage/Status fields grid
      smartAgenda: true, // unlocks speaker picker + time-balance behavior
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'speaker', label: 'Subject Owner(s)', attendeePicker: true, multi: true },
        { key: 'startTime', label: 'Time' },
        { key: 'duration', label: 'Minutes', numeric: true, numFmt: '0' },
        { key: 'slides', label: 'Slides / Software' },
      ],
    },
    {
      key: 'ourQuestions',
      label: 'Questions to Ask Them',
      group: 'Questions',
      reorderable: true,
      columns: [
        { key: 'service', label: 'Service', widthRatio: 0.25 },
        { key: 'question', label: 'Question', widthRatio: 0.75 },
      ],
    },
    {
      key: 'theirQuestions',
      label: 'Questions They Might Ask',
      group: 'Questions',
      columns: [
        { key: 'service', label: 'Service', widthRatio: 0.25 },
        { key: 'question', label: 'Their Question', widthRatio: 0.375 },
        { key: 'response', label: 'Our Response', widthRatio: 0.375 },
      ],
    },
    {
      key: 'risks',
      label: 'Yellow Lights',
      columns: [
        { key: 'service', label: 'Service', widthRatio: 0.25 },
        { key: 'item', label: 'What Yellow Lights Might Arise', widthRatio: 0.375 },
        { key: 'notes', label: 'How Will You Respond?', widthRatio: 0.375 },
      ],
    },
    {
      key: 'meetingNotes',
      label: 'Key Issues',
      aboveField: 'summary', // rendered inline ABOVE the General Notes field
      starrable: true, // star-to-promote: one row at a time bubbles to the top
      wrapCells: true, // long-form note taking — textareas that grow with content
      columns: [
        { key: 'issue', label: 'Issue - Capture all issues (What else is there?)' },
        { key: 'evidence', label: 'Evidence - How does this show up today?', bulletList: true },
        { key: 'impact', label: 'Impact - What does that cost you? How much time are you spending on that?', bulletList: true },
      ],
    },
    {
      key: 'actionItems',
      label: 'Action Items / Next Steps',
      underField: 'summary', // nests directly under General Notes
      columns: [
        { key: 'item', label: 'Action Item' },
        { key: 'owner', label: 'Owner', attendeePicker: true },
      ],
    },
  ],
};

// Seed values for the very first row of certain tables so a fresh form
// already has the kickoff line filled in. Keyed by table.key, then column.key.
function buildFirstRowSeeds(cdmName) {
  return {
    agenda: { subject: 'Introductions', speaker: cdmName || '', duration: '5' },
  };
}

function emptyFormData(template = DEFAULT_FORM_TEMPLATE, cdmName) {
  const fieldValues = {};
  for (const f of template.fields) fieldValues[f.key] = '';
  const tables = {};
  const firstRowSeeds = buildFirstRowSeeds(cdmName);
  for (const t of template.tables) {
    const seed = firstRowSeeds[t.key] || null;
    tables[t.key] = Array.from({ length: 2 }, (_, idx) => {
      const row = Object.fromEntries(t.columns.map(c => [c.key, '']));
      if (idx === 0 && seed) {
        for (const [k, v] of Object.entries(seed)) {
          if (k in row) row[k] = v;
        }
      }
      return row;
    });
  }
  return { fieldValues, tables, linkedBfoLink: null, linkedOppName: null, meeting: null };
}

// ---- .ics parser --------------------------------------------------------
// Unfolds wrapped lines per RFC 5545 (continuation lines start with space/tab),
// then splits PROPERTY;PARAM=VAL:VALUE rows. Returns { subject, start, end,
// durationMinutes, location, organizer, attendees, sourceTimeZone }.
const EASTERN_TZ = 'America/New_York';

// Outlook emits TZID values using Microsoft's Windows timezone names rather
// than IANA IDs, so map the common ones. Anything not here falls through to
// the raw TZID (which Intl will accept if it's already IANA).
const WIN_TO_IANA_TZ = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'GTB Standard Time': 'Europe/Athens',
  'FLE Standard Time': 'Europe/Kyiv',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'UTC': 'UTC',
};

function resolveTimeZone(tzid) {
  if (!tzid) return null;
  const clean = String(tzid).replace(/^"|"$/g, '').trim();
  if (!clean) return null;
  return WIN_TO_IANA_TZ[clean] || clean;
}

function getTimezoneOffsetMs(timeZone, date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = fmt.formatToParts(date).reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
    const asUTC = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second
    );
    return asUTC - date.getTime();
  } catch { return 0; }
}

// Converts a wall-clock time expressed in `timeZone` into a real UTC Date.
function wallTimeInZoneToUTC(y, moOneBased, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, moOneBased - 1, d, h, mi, s);
  const offset = getTimezoneOffsetMs(timeZone, new Date(guess));
  return new Date(guess - offset);
}

function parseIcs(text) {
  if (!text) return null;
  // Unfold continuation lines
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const attendees = [];
  let subject = '';
  let location = '';
  let organizer = null;
  let dtStart = null;
  let dtEnd = null;
  let duration = null;
  let inEvent = false;
  let sourceTzidRaw = null;

  const unescape = (s) => (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

  const parseIcsDate = (val, params) => {
    if (!val) return null;
    // Forms: 20260420T140000Z | 20260420T140000 | 20260420
    const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
    const hasTime = !!val.includes('T');
    if (z || !hasTime) {
      // UTC or date-only
      return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    }
    // Look for a TZID=... parameter on this property.
    const tzidParam = (params || []).find(p => /^tzid=/i.test(p));
    if (tzidParam) {
      const tzid = resolveTimeZone(tzidParam.slice(tzidParam.indexOf('=') + 1));
      if (tzid) {
        try { return wallTimeInZoneToUTC(+y, +mo, +d, +h, +mi, +s, tzid); } catch {}
      }
    }
    // Floating — fall back to treating as local time (pre-existing behavior).
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  };

  const parsePerson = (raw, params) => {
    // raw looks like "mailto:a@b.com". CN=... is in params.
    const email = (raw || '').replace(/^mailto:/i, '').trim();
    let cn = '';
    let role = '';
    const rawParams = {};
    for (const p of params) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
      if (!k) continue;
      const K = k.toUpperCase();
      rawParams[K] = v;
      if (K === 'CN') cn = v;
      else if (K === 'ROLE') role = v.toUpperCase();
    }
    if (!email && !cn) return null;
    // Classify required/optional. Primary source is iCal ROLE:
    //   CHAIR, REQ-PARTICIPANT -> required
    //   OPT-PARTICIPANT, NON-PARTICIPANT -> optional
    // Some Outlook exports omit ROLE and instead use Microsoft extensions
    // like X-MICROSOFT-CDO-ATTENDEETYPE (1=required, 2=optional, 3=resource)
    // or X-MICROSOFT-ATTENDEE-REQUEST.
    let required = true;
    if (role === 'OPT-PARTICIPANT' || role === 'NON-PARTICIPANT') {
      required = false;
    } else if (!role) {
      const msType = rawParams['X-MICROSOFT-CDO-ATTENDEETYPE'] || rawParams['X-MS-OLK-ATTENDEETYPE'];
      if (msType === '2' || msType === '3') required = false;
    }
    return { name: cn || email, email, required, role: role || 'REQ-PARTICIPANT', rawParams };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (line === 'END:VEVENT') { inEvent = false; continue; }
    if (!inEvent) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [prop, ...params] = left.split(';');
    const propUpper = prop.toUpperCase();
    switch (propUpper) {
      case 'SUMMARY': subject = unescape(value); break;
      case 'LOCATION': location = unescape(value); break;
      case 'DTSTART': {
        dtStart = parseIcsDate(value, params);
        if (!sourceTzidRaw) {
          const tzParam = params.find(p => /^tzid=/i.test(p));
          if (tzParam) sourceTzidRaw = tzParam.slice(tzParam.indexOf('=') + 1).replace(/^"|"$/g, '').trim();
          else if (/z$/i.test(value)) sourceTzidRaw = 'UTC';
        }
        break;
      }
      case 'DTEND': dtEnd = parseIcsDate(value, params); break;
      case 'DURATION': duration = value; break;
      case 'ORGANIZER': {
        const p = parsePerson(value, params);
        if (p) organizer = p;
        break;
      }
      case 'ATTENDEE': {
        const p = parsePerson(value, params);
        if (p) attendees.push(p);
        break;
      }
      default: break;
    }
  }

  let durationMinutes = null;
  if (dtStart && dtEnd) {
    durationMinutes = Math.round((dtEnd.getTime() - dtStart.getTime()) / 60000);
  } else if (duration) {
    // Parse ISO 8601 duration like PT1H30M
    const m = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
    if (m) durationMinutes = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }

  return {
    subject,
    start: dtStart ? dtStart.toISOString() : null,
    end: dtEnd ? dtEnd.toISOString() : null,
    durationMinutes,
    location,
    organizer,
    attendees,
    sourceTimeZone: sourceTzidRaw || null,
  };
}

// All meeting times render in Eastern (America/New_York) regardless of the
// browser's locale so the team sees a single consistent clock. The source
// timezone from the invite is noted separately in the UI.
function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: EASTERN_TZ,
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch { return iso; }
}

function formatEasternTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: EASTERN_TZ,
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return ''; }
}

function formatDuration(min) {
  if (min == null) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Lightweight company-name fuzzy match. Good enough for the linked-opp
// → account lookup (strips common corp suffixes, then compares on
// containment with a length ratio).
// Prefer the live HubSpot contact's name over whatever was parsed from
// the ICS/manual entry, so edits made in the contact table propagate to
// the form immediately. When a nickname is recorded for the matched
// contact, append " - Goes by <Nick>" so e.g. "Daniel Baldauf" reads as
// "Daniel Baldauf - Goes by Dan" everywhere we list client contacts.
function displayAttendeeName(a, nicknames = {}) {
  const fn = (a?.match?.firstname || '').trim();
  const ln = (a?.match?.lastname || '').trim();
  const combined = [fn, ln].filter(Boolean).join(' ');
  const cid = a?.match?.id || a?.match?.vid;
  const nick = (cid && nicknames && nicknames[cid] ? String(nicknames[cid]).trim() : '');
  const base = combined || a?.name || a?.email || '(unknown)';
  if (!nick) return base;
  // Skip the "goes by" suffix if the nickname is already part of the
  // displayed name (e.g. when name is a single token that happens to
  // match the nickname).
  if (base.toLowerCase().includes(nick.toLowerCase())) return base;
  return `${base} - Goes by ${nick}`;
}

// Fields we snapshot from a matched HubSpot contact onto the saved
// attendee. Mirrors every match.* field read by displayAttendeeName,
// renderAttendee and the Excel export so the Attendees section keeps
// rendering names, titles, company, location, notes and LinkedIn even
// when the live HubSpot contact pool hasn't been (re)loaded this session.
const ATTENDEE_SNAPSHOT_FIELDS = [
  'id', 'vid', 'firstname', 'lastname', 'email', 'jobtitle', 'company',
  'city', 'country', 'notes', 'hs_content_membership_notes', 'message',
  'hs_linkedin_url', 'linkedin_url', 'hs_linkedinid',
];
function snapshotFromMatch(match) {
  if (!match) return null;
  const snap = {};
  for (const k of ATTENDEE_SNAPSHOT_FIELDS) {
    const v = match[k];
    if (v !== undefined && v !== null && v !== '') snap[k] = v;
  }
  return Object.keys(snap).length ? snap : null;
}

function matchProspectByName(name, prospects) {
  if (!name || !prospects?.length) return null;
  const strip = s => String(s || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|lp|gmbh)\b\.?/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const target = strip(name);
  if (!target) return null;
  let best = null;
  for (const p of prospects) {
    const pn = strip(p.company);
    if (!pn) continue;
    if (pn === target) return p;
    const longer = pn.length >= target.length ? pn : target;
    const shorter = pn.length >= target.length ? target : pn;
    if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) {
      best = best || p;
    }
  }
  return best;
}

function currentServicesFor(prospect) {
  const svc = prospect?.servicesExplored || {};
  // Only Sold services count as the "current scope" on this opportunity.
  return Object.entries(svc)
    .filter(([, status]) => status === 'Sold')
    .map(([name]) => name)
    .sort();
}

// Map Dan's opportunity status/stage values (as they appear in the Opps
// sheet) to the BFO stage names displayed in the form. Lookup is
// case-insensitive and whitespace-tolerant.
const DAN_STATUS_TO_BFO_STAGE = {
  'agreement sent': '6 - Negotiate to Win',
  'contracting': '5 - Prepare & Bid',
  'quoted': '5 - Prepare & Bid',
  'quoting': '4 - Influence and Develop',
  'lead': '3 - Qualify Opportunity',
  'qualifying': '4 - Influence and Develop',
};

function mapDanStatusToBfoStage(raw) {
  if (!raw) return '';
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  // Exact match first
  if (DAN_STATUS_TO_BFO_STAGE[key]) return DAN_STATUS_TO_BFO_STAGE[key];
  // Prefix match so values like "Qualifying (Discovery)" or "Lead — New"
  // still resolve to their BFO stage. Longest prefix wins.
  let bestKey = '';
  let bestVal = '';
  for (const [danKey, bfoValue] of Object.entries(DAN_STATUS_TO_BFO_STAGE)) {
    if (key.startsWith(danKey) && danKey.length > bestKey.length) {
      bestKey = danKey;
      bestVal = bfoValue;
    }
  }
  return bestVal;
}

// If a value already looks like a BFO stage (e.g. "3 - Qualify Opportunity"),
// keep it as-is. Otherwise return the mapped BFO value, or '' if no match.
function toBfoStage(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (/^\d+\s*-/.test(trimmed)) return trimmed; // already BFO
  return mapDanStatusToBfoStage(trimmed);
}

// Pre-filled Intent + Meeting Goal (End In Mind) per Dan's sales stage.
// On opp-link we look up the stage, substitute {company} with the linked
// account name, and write the text into the form's Intent / End In Mind
// boxes. Lowercased keys so we can match case-insensitively.
const STAGE_MEETING_TEMPLATES = {
  'lead': {
    intent: 'Confirm {company} is a fit and determine if further partnership exploration is warranted.',
    endInMind: 'By the end of our meeting, {company} will understand what we do and whether it could apply to a current priorities. They will have enough information to decide, yes or no, if a deeper qualifying conversation is worth their time.',
  },
  'qualifying': {
    intent: 'Verify a real, funded, timely opportunity exists with {company}.',
    endInMind: 'By the end of our meeting, {company} will have shared their business problem, validated it against our solutions, and have a clear view of whether or not it makes sense to get a proposal from us to help determine if this is worth pursuing.',
  },
  'quoting': {
    intent: 'Gather inputs from {company} needed to build an accurate quote.',
    endInMind: 'By the end of our meeting, {company} will have confirmed their requirements, pricing parameters, and who needs to review the proposal. They will feel confident the quote they receive will reflect what they actually need.',
  },
  'quoted': {
    intent: 'Walk {company} through the proposal and ensure it meets their requirements.',
    endInMind: 'By the end of our meeting, {company} will have understood the proposal and had their questions addressed so they can decide whether to move forward to contracting or end the exploration here.',
  },
  'contracting': {
    intent: 'Help {company} get through their internal review process quickly and confidently so they can start realizing value from SE solutions.',
    endInMind: 'By the end of our meeting, {company} will have a clear path through their legal, procurement, and security review, with open items and a target signature date agreed.',
  },
  'agreement sent': {
    intent: 'Give {company} everything they need to sign with confidence and feel ready for a smooth onboarding.',
    endInMind: 'By the end of our meeting, {company} will have answered any final questions and be aligned on what happens after signature.',
  },
};

// Match a raw stage value to a template. Tries the Dan name exactly, then
// falls back to the BFO-shaped name by reverse-mapping through
// DAN_STATUS_TO_BFO_STAGE.
function meetingTemplateFor(rawStage) {
  if (!rawStage) return null;
  const key = String(rawStage).trim().toLowerCase().replace(/\s+/g, ' ');
  if (STAGE_MEETING_TEMPLATES[key]) return STAGE_MEETING_TEMPLATES[key];
  // Reverse-map: e.g. raw = "4 - Influence and Develop" might correspond to
  // multiple Dan stages; pick the first that exists in the template map.
  for (const [danKey, bfoVal] of Object.entries(DAN_STATUS_TO_BFO_STAGE)) {
    if (String(bfoVal).toLowerCase() === key && STAGE_MEETING_TEMPLATES[danKey]) {
      return STAGE_MEETING_TEMPLATES[danKey];
    }
  }
  return null;
}

// Prominent picker for importing a previous Notes page's Call Context
// into the active one. Replaces the original tiny inline <select> next
// to the field label — that picker was easy to miss, this one shows a
// labeled button with the candidate count and a click-to-import panel
// of each source note (title + last-edited + preview).
function CallContextImportPicker({ candidates, onImport }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const formatWhen = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    const day = 86400000;
    if (diff < day) return 'today';
    if (diff < 2 * day) return 'yesterday';
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Pull the Call Context from a previous Notes page on this company"
        style={{
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          padding: '0.3rem 0.65rem',
          color: '#fff', background: '#0078D4',
          border: '1px solid #0078D4', borderRadius: 4,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        }}
      >
        <span aria-hidden="true">⤓</span>
        <span>Import Call Context</span>
        <span style={{
          fontSize: '0.7rem', fontWeight: 700,
          padding: '0 0.4rem', borderRadius: 999,
          background: 'rgba(255,255,255,0.25)',
        }}>{candidates.length}</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            zIndex: 50, width: 380, maxWidth: '92vw',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 6, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
            overflow: 'hidden',
          }}
        >
          <div style={{
            padding: '0.5rem 0.7rem',
            borderBottom: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
            fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            Pick a previous Notes page
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {candidates.map(n => {
              const ctx = (n.context || '').trim();
              const preview = ctx.length > 160 ? `${ctx.slice(0, 160).trimEnd()}…` : ctx;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => { onImport(n); setOpen(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '0.55rem 0.7rem',
                    border: 'none', borderBottom: '1px solid var(--color-border-light)',
                    background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}>
                    <span style={{
                      fontWeight: 600, color: 'var(--color-text)', fontSize: '0.82rem',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{n.title || 'Untitled'}</span>
                    <span style={{
                      flex: '0 0 auto',
                      fontSize: '0.68rem', color: 'var(--color-text-muted)',
                    }}>{formatWhen(n.updatedAt)} · {ctx.length} chars</span>
                  </div>
                  {preview && (
                    <div style={{
                      marginTop: '0.2rem',
                      fontSize: '0.75rem', color: 'var(--color-text-muted)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>{preview}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function OpportunityForm({ value, onChange, onLinkOpp, companyName, companyContacts = [], allHubspotContacts = [], contactNotes = {}, contactReportsTo = {}, contactNicknames = {}, prospects = [], onCreateContact, onOpenContact, importableNotes = [], cdmName, competitorOptions = [], onMentionCompetitor, companyBackground = null, serviceQuestionsOverride = null, serviceTheirQuestionsOverride = null }) {
  const template = DEFAULT_FORM_TEMPLATE;

  // Local mirror of the persisted value. All edits update localValue
  // immediately (so the UI feels instant), and a debounced flush pushes
  // the changes up to the parent — which in turn writes to Firestore and
  // re-renders the whole modal. Without this, every keystroke round-trips
  // through Firestore (stale-write check + updateDoc) and rebuilds the
  // entire ProspectModal tree.
  const [localValue, setLocalValue] = useState(value);
  const lastAcceptedRef = useRef(value);
  const flushTimerRef = useRef(null);
  const pendingRef = useRef(null);

  // Accept a new parent value when the reference actually changed.
  // Reference equality is enough — we never overwrite localValue with the
  // same object, so if reference differs it's a genuinely new value from
  // the parent (opp link, tab switch, etc.).
  useEffect(() => {
    if (value === lastAcceptedRef.current) return;
    lastAcceptedRef.current = value;
    setLocalValue(value);
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; pendingRef.current = null; }
  }, [value]);

  // Debounced flush: after 350ms without new edits, push localValue up.
  // Reference comparison only — stringify on every keystroke was slow.
  useEffect(() => {
    if (localValue === lastAcceptedRef.current) return;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    pendingRef.current = localValue;
    flushTimerRef.current = setTimeout(() => {
      const payload = pendingRef.current;
      flushTimerRef.current = null;
      pendingRef.current = null;
      if (payload) {
        lastAcceptedRef.current = payload;
        onChange(payload);
      }
    }, 350);
    return () => { if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; } };
  }, [localValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending edits on unmount so switching tabs / closing the modal
  // doesn't lose the last few characters.
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        try { onChange(pendingRef.current); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formData = useMemo(() => {
    const base = emptyFormData(template, cdmName);
    const src = localValue;
    if (!src) return base;
    return {
      fieldValues: { ...base.fieldValues, ...(src.fieldValues || {}) },
      tables: Object.fromEntries(
        template.tables.map(t => [t.key, (src.tables && src.tables[t.key]) || base.tables[t.key]])
      ),
      linkedBfoLink: src.linkedBfoLink || null,
      linkedOppName: src.linkedOppName || null,
      meeting: src.meeting || null,
      // Carry the per-form seed record through so the question auto-fill
      // effects can tell which services were already imported. Without
      // this, formData.seededScopeServices is always undefined and the
      // effects fall back to inferring seeds from populated rows — which
      // resurrects questions the user deleted after a page refresh.
      seededScopeServices: src.seededScopeServices || null,
    };
  }, [localValue, template, cdmName]);

  // Optimistic local update — feels instant; debounced useEffect above
  // flushes to the parent ~350ms after the last edit.
  const set = (next) => setLocalValue(prev => ({ ...(prev || {}), ...next }));

  const updateField = (key, val) => {
    set({ fieldValues: { ...formData.fieldValues, [key]: val } });
  };

  // Self-heal: if the stored Stage field still has a Dan value (because it
  // was written before the Dan->BFO mapping shipped), convert it to the BFO
  // equivalent on first render. Runs only when the value actually needs
  // changing, so no loop.
  useEffect(() => {
    const current = formData.fieldValues?.stage;
    if (!current) return;
    const trimmed = String(current).trim();
    if (/^\d+\s*-/.test(trimmed)) return; // already BFO, leave alone
    const converted = mapDanStatusToBfoStage(trimmed);
    if (converted && converted !== current) {
      // eslint-disable-next-line no-console
      console.log('[OpportunityForm] auto-converting stale Stage value', current, '->', converted);
      updateField('stage', converted);
    }
  }, [formData.fieldValues?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Self-heal: whenever the Stage maps to a known meeting template and the
  // Intent/End In Mind fields are empty, auto-populate them. This covers
  // forms created before the template mapping shipped — users don't need
  // to re-link the opportunity.
  useEffect(() => {
    const stage = formData.fieldValues?.stage;
    if (!stage) return;
    const tmpl = meetingTemplateFor(stage);
    if (!tmpl) return;
    const displayCompany = (companyName || 'the customer').trim();
    const nextIntent = tmpl.intent.replaceAll('{company}', displayCompany);
    const nextEnd = tmpl.endInMind.replaceAll('{company}', displayCompany);
    const currentIntent = formData.fieldValues?.intent || '';
    const currentEnd = formData.fieldValues?.endInMind || '';
    const updates = {};
    if (!currentIntent.trim()) updates.intent = nextIntent;
    if (!currentEnd.trim()) updates.endInMind = nextEnd;
    if (Object.keys(updates).length === 0) return;
    set({ fieldValues: { ...formData.fieldValues, ...updates } });
  }, [formData.fieldValues?.stage, companyName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Self-heal: fill Company Website / Current Scope / Client Manager from
  // the matching prospect whenever those fields are empty. Doesn't overwrite
  // manual edits. Also migrates any legacy currentClientScope value stored
  // on older forms into the new currentScope field.
  useEffect(() => {
    const fv = formData.fieldValues || {};
    const match = matchProspectByName(companyName, prospects);
    const updates = {};

    // Company Website
    if (!(fv.companyWebsite || '').trim()) {
      const url = (match?.website || '').trim();
      if (url) updates.companyWebsite = url;
    }
    // Current Scope (auto-fill from prospect's active services)
    if (!(fv.currentScope || '').trim()) {
      // Migrate legacy key if present
      const legacy = (fv.currentClientScope || '').trim();
      if (legacy) {
        updates.currentScope = legacy;
      } else if (match) {
        const active = currentServicesFor(match);
        if (active.length > 0) updates.currentScope = active.join(', ');
      }
    }
    // Client Manager (from prospect's CDM). If this company isn't currently
    // a Client, fall back to the N/A label instead of leaving it blank.
    if (!(fv.clientManager || '').trim()) {
      const cdm = (match?.cdm || '').trim();
      const isClient = (match?.status || '').trim() === 'Client';
      if (isClient && cdm) updates.clientManager = cdm;
      else if (match && !isClient) updates.clientManager = 'N/A - Not a current client';
    }

    if (Object.keys(updates).length === 0) return;
    set({ fieldValues: { ...fv, ...updates } });
  }, [companyName, prospects, formData.fieldValues?.companyWebsite, formData.fieldValues?.currentScope, formData.fieldValues?.clientManager, formData.fieldValues?.currentClientScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Self-heal: for every service listed in Scope Being Explored, add its
  // canned 'Questions to Ask Them' to the ourQuestions table — but only
  // ONCE per service per form. We persist a list of services that have
  // already been seeded inside formData so a refresh (or scope re-edit)
  // never re-imports questions the user has since deleted. For legacy
  // forms (no seededScopeServices key), every service that already has
  // populated rows is treated as already seeded so the first refresh
  // after this change doesn't resurrect previously-deleted questions.
  useEffect(() => {
    const scope = (formData.fieldValues?.scope || '').trim();
    if (!scope) return;
    const services = scope.split(',').map(s => s.trim()).filter(Boolean);
    if (services.length === 0) return;

    const seedKey = 'ourQuestions';
    const existingRows = formData.tables?.ourQuestions || [];
    const populated = existingRows.filter(r =>
      (r.service || '').trim() || (r.question || '').trim()
    );

    const prior = new Set((formData.seededScopeServices?.[seedKey] || []).map(s => s.toLowerCase()));
    const hasSeedRecord = !!formData.seededScopeServices?.[seedKey];
    if (!hasSeedRecord) {
      for (const r of populated) {
        const s = (r.service || '').toLowerCase().trim();
        if (s) prior.add(s);
      }
    }

    const existingKeys = new Set(
      populated.map(r => `${(r.service || '').toLowerCase().trim()}::${(r.question || '').trim()}`)
    );
    const additions = [];
    for (const svc of services) {
      const key = svc.toLowerCase();
      if (prior.has(key)) continue;
      // Prefer the user's edited template (Dropdowns → Questions) for this
      // service; fall back to the hardcoded default when untouched.
      const canned = (Array.isArray(serviceQuestionsOverride?.[key]) ? serviceQuestionsOverride[key] : SERVICE_QUESTIONS[key]);
      if (!canned) continue;
      for (const q of canned) {
        const k = `${key}::${q}`;
        if (existingKeys.has(k)) continue;
        additions.push({ service: svc, question: q });
        existingKeys.add(k);
      }
    }

    const fullSeed = new Set(prior);
    for (const svc of services) fullSeed.add(svc.toLowerCase());
    const priorList = formData.seededScopeServices?.[seedKey] || [];
    const seedListChanged = fullSeed.size !== priorList.length || [...fullSeed].some(s => !priorList.includes(s));
    if (additions.length === 0 && !seedListChanged) return;

    const patch = {};
    if (additions.length > 0) {
      patch.tables = { ...formData.tables, ourQuestions: [...populated, ...additions] };
    }
    if (seedListChanged) {
      patch.seededScopeServices = {
        ...(formData.seededScopeServices || {}),
        [seedKey]: [...fullSeed],
      };
    }
    set(patch);
  }, [formData.fieldValues?.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Self-heal: mirror the ourQuestions auto-fill for theirQuestions.
  // Same one-shot-per-service-per-form rule via seededScopeServices.
  useEffect(() => {
    const scope = (formData.fieldValues?.scope || '').trim();
    if (!scope) return;
    const services = scope.split(',').map(s => s.trim()).filter(Boolean);
    if (services.length === 0) return;

    const seedKey = 'theirQuestions';
    const existingRows = formData.tables?.theirQuestions || [];
    const populated = existingRows.filter(r =>
      (r.service || '').trim() || (r.question || '').trim() || (r.response || '').trim()
    );

    const prior = new Set((formData.seededScopeServices?.[seedKey] || []).map(s => s.toLowerCase()));
    const hasSeedRecord = !!formData.seededScopeServices?.[seedKey];
    if (!hasSeedRecord) {
      for (const r of populated) {
        const s = (r.service || '').toLowerCase().trim();
        if (s) prior.add(s);
      }
    }

    const existingKeys = new Set(
      populated.map(r => `${(r.service || '').toLowerCase().trim()}::${(r.question || '').trim().toLowerCase()}`)
    );
    const additions = [];
    for (const svc of services) {
      const key = svc.toLowerCase();
      if (prior.has(key)) continue;
      const canned = (Array.isArray(serviceTheirQuestionsOverride?.[key]) ? serviceTheirQuestionsOverride[key] : SERVICE_THEIR_QUESTIONS[key]);
      if (!canned) continue;
      for (const pair of canned) {
        const qText = (pair.question || '').trim();
        if (!qText) continue;
        const k = `${key}::${qText.toLowerCase()}`;
        if (existingKeys.has(k)) continue;
        additions.push({ service: svc, question: pair.question, response: pair.response });
        existingKeys.add(k);
      }
    }

    const fullSeed = new Set(prior);
    for (const svc of services) fullSeed.add(svc.toLowerCase());
    const priorList = formData.seededScopeServices?.[seedKey] || [];
    const seedListChanged = fullSeed.size !== priorList.length || [...fullSeed].some(s => !priorList.includes(s));
    if (additions.length === 0 && !seedListChanged) return;

    const patch = {};
    if (additions.length > 0) {
      patch.tables = { ...formData.tables, theirQuestions: [...populated, ...additions] };
    }
    if (seedListChanged) {
      patch.seededScopeServices = {
        ...(formData.seededScopeServices || {}),
        [seedKey]: [...fullSeed],
      };
    }
    set(patch);
  }, [formData.fieldValues?.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always keep at least one empty row at the bottom of the Questions
  // tables so the user can always type a new question without having to
  // go find an 'add row' button — including after every row is cleared.
  const ensureTrailingEmptyRow = (key) => {
    const def = template.tables.find(t => t.key === key);
    if (!def) return;
    const rows = formData.tables?.[key] || [];
    const isRowEmpty = (r) => def.columns.every(c => !(r?.[c.key] || '').toString().trim());
    const last = rows[rows.length - 1];
    // Append a fresh empty row when the table is empty or the last row
    // already has content; do nothing if a trailing empty row exists.
    if (rows.length > 0 && isRowEmpty(last)) return;
    const empty = Object.fromEntries(def.columns.map(c => [c.key, '']));
    set({ tables: { ...formData.tables, [key]: [...rows, empty] } });
  };

  useEffect(() => {
    ensureTrailingEmptyRow('ourQuestions');
  }, [formData.tables?.ourQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ensureTrailingEmptyRow('theirQuestions');
  }, [formData.tables?.theirQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTableCell = (tableKey, rowIdx, colKey, val) => {
    const rows = [...(formData.tables[tableKey] || [])];
    rows[rowIdx] = { ...rows[rowIdx], [colKey]: val };
    // Auto-append an empty row when the user starts filling in the last row
    // so the user never has to click '+ Add row'.
    if (rowIdx === rows.length - 1) {
      const touched = Object.values(rows[rowIdx] || {}).some(v => v != null && String(v).trim() !== '');
      if (touched) {
        const tableDef = template.tables.find(t => t.key === tableKey);
        if (tableDef) {
          rows.push(Object.fromEntries(tableDef.columns.map(c => [c.key, ''])));
        }
      }
    }
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };

  const addTableRow = (tableKey) => {
    const col = template.tables.find(t => t.key === tableKey);
    if (!col) return;
    const empty = Object.fromEntries(col.columns.map(c => [c.key, '']));
    let nextRows = [...(formData.tables[tableKey] || []), empty];
    // Agenda: when a fresh blank row is added, recompute the
    // auto-fill so the new row picks up the remaining minutes (or, if
    // a previous row was already auto-filled, leave that one alone
    // and let it stay the carrier).
    if (tableKey === 'agenda' && col.smartAgenda && meetingTotalMinutes) {
      nextRows = applyAutoBalance(nextRows, meetingTotalMinutes);
    }
    set({ tables: { ...formData.tables, [tableKey]: nextRows } });
  };

  const removeTableRow = (tableKey, rowIdx) => {
    const rows = [...(formData.tables[tableKey] || [])];
    rows.splice(rowIdx, 1);
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };

  const moveTableRow = (tableKey, rowIdx, delta) => {
    const rows = [...(formData.tables[tableKey] || [])];
    const target = rowIdx + delta;
    if (target < 0 || target >= rows.length) return;
    const tmp = rows[rowIdx];
    rows[rowIdx] = rows[target];
    rows[target] = tmp;
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };

  // Star / prioritize a row. Starring promotes the row to the top of the
  // table and un-stars every sibling so the "top issue" is unambiguous.
  // Clicking a filled star un-stars it in place (without moving rows).
  const toggleRowStar = (tableKey, rowIdx) => {
    const rows = [...(formData.tables[tableKey] || [])];
    if (!rows[rowIdx]) return;
    if (rows[rowIdx].starred) {
      rows[rowIdx] = { ...rows[rowIdx], starred: false };
      set({ tables: { ...formData.tables, [tableKey]: rows } });
      return;
    }
    const cleared = rows.map(r => (r?.starred ? { ...r, starred: false } : r));
    const [picked] = cleared.splice(rowIdx, 1);
    cleared.unshift({ ...picked, starred: true });
    set({ tables: { ...formData.tables, [tableKey]: cleared } });
  };

  // HTML5 drag-and-drop reorder for reorderable tables. dragRowRef
  // remembers the grabbed row between dragStart and drop.
  const dragRowRef = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null); // `${tableKey}:${rowIdx}` — for hover highlight

  const handleRowDragStart = (tableKey, rIdx) => (e) => {
    dragRowRef.current = { tableKey, rIdx };
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(rIdx));
    } catch {}
  };
  const handleRowDragOver = (tableKey, rIdx) => (e) => {
    const drag = dragRowRef.current;
    if (!drag || drag.tableKey !== tableKey) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    const key = `${tableKey}:${rIdx}`;
    if (dragOverKey !== key) setDragOverKey(key);
  };
  const handleRowDragLeave = () => setDragOverKey(null);
  const handleRowDrop = (tableKey, rIdx) => (e) => {
    e.preventDefault();
    const drag = dragRowRef.current;
    dragRowRef.current = null;
    setDragOverKey(null);
    if (!drag || drag.tableKey !== tableKey) return;
    if (drag.rIdx === rIdx) return;
    const rows = [...(formData.tables[tableKey] || [])];
    if (drag.rIdx < 0 || drag.rIdx >= rows.length) return;
    const [moved] = rows.splice(drag.rIdx, 1);
    const insertAt = drag.rIdx < rIdx ? rIdx - 1 : rIdx;
    rows.splice(Math.max(0, Math.min(rows.length, insertAt)), 0, moved);
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };
  const handleRowDragEnd = () => {
    dragRowRef.current = null;
    setDragOverKey(null);
  };

  // Smart Agenda helpers are defined further below, AFTER seAttendees /
  // customerAttendees are computed. Declaring them here would hit a TDZ
  // on module load because this closure reads those bindings.

  function renderTables(list) {
    return list.map((t, idx) => {
      const prev = idx > 0 ? list[idx - 1] : null;
      const showGroupHeader = t.group && (!prev || prev.group !== t.group);
      return (
        <div key={t.key}>
          {showGroupHeader && (
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B', margin: '1rem 0 0.15rem', borderBottom: '2px solid #009530', paddingBottom: '0.25rem' }}>
              {t.group}
            </div>
          )}
          <div style={{ ...sx.sectionTitle, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span>{t.label}</span>
            {t.smartAgenda && meetingTotalMinutes > 0 && (
              <span style={{ fontSize: '0.68rem', fontWeight: 500, color: agendaSum > meetingTotalMinutes ? '#B91C1C' : agendaSum === meetingTotalMinutes ? '#15803D' : '#64748B' }}>
                {agendaSum} / {meetingTotalMinutes} min
                {agendaSum > meetingTotalMinutes && ' · over'}
                {agendaSum < meetingTotalMinutes && ` · ${meetingTotalMinutes - agendaSum} min unassigned`}
              </span>
            )}
            {(t.key === 'ourQuestions' || t.key === 'theirQuestions') && (() => {
              const rowCount = (formData.tables?.[t.key] || []).filter(r => {
                if (!r) return false;
                for (const c of t.columns) if ((r[c.key] || '').toString().trim()) return true;
                return false;
              }).length;
              return (
                <button
                  type="button"
                  disabled={rowCount === 0}
                  onClick={() => {
                    if (rowCount === 0) return;
                    if (!window.confirm(`Clear all ${rowCount} row${rowCount === 1 ? '' : 's'} from "${t.label}"? The auto-fill will not re-add canned questions for services already in Scope.`)) return;
                    // Mark every current Scope service as already seeded
                    // so the canned-question auto-fill effect doesn't
                    // immediately re-populate the table after the clear.
                    const scope = (formData.fieldValues?.scope || '').trim();
                    const services = scope ? scope.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const priorSeed = new Set((formData.seededScopeServices?.[t.key] || []).map(s => String(s).toLowerCase()));
                    for (const svc of services) priorSeed.add(svc.toLowerCase());
                    set({
                      tables: { ...formData.tables, [t.key]: [] },
                      seededScopeServices: {
                        ...(formData.seededScopeServices || {}),
                        [t.key]: [...priorSeed],
                      },
                    });
                  }}
                  title={rowCount === 0
                    ? 'Already empty'
                    : `Remove every row from ${t.label} and stop the auto-fill from re-seeding canned questions for the current Scope services.`}
                  style={{ marginLeft: 'auto', fontSize: '0.68rem', padding: '0.15rem 0.5rem', border: '1px solid #FCA5A5', background: rowCount === 0 ? '#F8FAFC' : '#FEF2F2', color: rowCount === 0 ? '#94A3B8' : '#B91C1C', borderRadius: 4, cursor: rowCount === 0 ? 'not-allowed' : 'pointer', fontWeight: 600, fontFamily: 'inherit' }}
                >Clear all{rowCount > 0 ? ` (${rowCount})` : ''}</button>
              );
            })()}
            {t.key === 'meetingNotes' && importableNotes.some(n => (n.rows?.length || 0) > 0) && (
              <select
                defaultValue=""
                onChange={(e) => {
                  const sourceId = e.target.value;
                  e.target.value = '';
                  if (!sourceId) return;
                  const source = importableNotes.find(n => n.id === sourceId);
                  if (!source || !source.rows?.length) return;
                  // Append source rows to the current Key Issues table after
                  // trimming any trailing fully-empty rows from the current
                  // list. Keeps the imported rows visible in order without
                  // wiping anything the user already typed.
                  const cols = t.columns;
                  const isEmptyRow = (r) => {
                    if (!r) return true;
                    for (const c of cols) if ((r[c.key] || '').toString().trim()) return false;
                    return true;
                  };
                  const current = [...(formData.tables.meetingNotes || [])];
                  while (current.length && isEmptyRow(current[current.length - 1])) current.pop();
                  const incoming = source.rows
                    .filter(r => !isEmptyRow(r))
                    .map(r => {
                      // Copy only known columns + starred flag — drops any
                      // legacy keys the source might have lying around.
                      const next = {};
                      for (const c of cols) next[c.key] = r[c.key] || '';
                      if (r.starred) next.starred = true;
                      return next;
                    });
                  if (incoming.length === 0) return;
                  set({ tables: { ...formData.tables, meetingNotes: [...current, ...incoming] } });
                }}
                title="Append the Key Issues rows from another note for this company"
                style={{ fontSize: '0.68rem', padding: '0.15rem 0.35rem', border: '1px solid var(--color-border)', borderRadius: 4, marginLeft: 'auto', cursor: 'pointer', background: '#fff' }}
              >
                <option value="">⤓ Import Key Issues from…</option>
                {importableNotes
                  .filter(n => (n.rows?.length || 0) > 0)
                  .map(n => (
                    <option key={n.id} value={n.id}>{n.title} ({n.rowsCount})</option>
                  ))}
              </select>
            )}
          </div>
          <table style={sx.table}>
            <thead>
              <tr>
                {t.starrable && <th style={{ ...sx.th, width: 28 }} title="Star the top issue"></th>}
                {t.columns.map(c => (
                  <th
                    key={c.key}
                    style={{
                      ...sx.th,
                      ...(c.widthRatio ? { width: `${Math.round(c.widthRatio * 100)}%` } : {}),
                    }}
                  >{c.label}</th>
                ))}
                <th style={{ ...sx.th, width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {(formData.tables[t.key] || []).map((row, rIdx) => (
                <tr
                  key={rIdx}
                  draggable={t.reorderable || undefined}
                  onDragStart={t.reorderable ? handleRowDragStart(t.key, rIdx) : undefined}
                  onDragOver={t.reorderable ? handleRowDragOver(t.key, rIdx) : undefined}
                  onDragLeave={t.reorderable ? handleRowDragLeave : undefined}
                  onDrop={t.reorderable ? handleRowDrop(t.key, rIdx) : undefined}
                  onDragEnd={t.reorderable ? handleRowDragEnd : undefined}
                  style={{
                    ...(t.reorderable ? { cursor: 'grab' } : {}),
                    ...(t.starrable && row?.starred ? { background: '#FEF3C7' } : {}),
                    ...(dragOverKey === `${t.key}:${rIdx}` ? { background: '#EFF6FF' } : {}),
                  }}
                >
                  {t.starrable && (
                    <td style={{ ...sx.td, textAlign: 'center', padding: '0.3rem 0.2rem' }}>
                      <button
                        type="button"
                        onClick={() => toggleRowStar(t.key, rIdx)}
                        title={row?.starred ? 'Unstar — remove priority' : 'Star as the top issue (moves to top)'}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          padding: '0 2px', lineHeight: 1, fontSize: '1rem',
                          color: row?.starred ? '#F59E0B' : '#CBD5E1',
                        }}
                      >{row?.starred ? '★' : '☆'}</button>
                    </td>
                  )}
                  {t.columns.map(c => {
                    // Any column flagged attendeePicker renders as a grouped
                    // dropdown sourced from the imported meeting's attendees
                    // (Schneider Electric group + Customer group). Used by
                    // the Agenda Speaker column and Action Items Owner.
                    if (c.attendeePicker) {
                      const val = row[c.key] || '';
                      const knownOptions = agendaSpeakerGroups.flatMap(g => g.items);
                      // Multi-select: value is stored as 'Name A / Name B'.
                      // A second <select> appears below the first as soon as
                      // the first has a value; picking a second name appends
                      // it to the existing value with ' / '. Picking the
                      // blank '—' removes that slot.
                      if (c.multi) {
                        const parts = val ? val.split(' / ').map(s => s.trim()).filter(Boolean) : [];
                        const updateSlot = (idx, nextName) => {
                          const next = [...parts];
                          if (nextName) {
                            if (idx >= next.length) next.push(nextName);
                            else next[idx] = nextName;
                          } else {
                            if (idx < next.length) next.splice(idx, 1);
                          }
                          // Dedupe (keep first occurrence)
                          const seen = new Set();
                          const uniq = next.filter(n => (seen.has(n) ? false : (seen.add(n), true)));
                          updateTableCell(t.key, rIdx, c.key, uniq.join(' / '));
                        };
                        // Render slots: existing names + one empty trailing slot
                        const slots = [...parts, ''];
                        return (
                          <td key={c.key} style={sx.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {slots.map((slotVal, idx) => {
                                const isCustomSlot = slotVal && !knownOptions.includes(slotVal);
                                return (
                                  <select
                                    key={idx}
                                    style={sx.cellInput}
                                    value={slotVal}
                                    onChange={e => updateSlot(idx, e.target.value)}
                                  >
                                    <option value="">—</option>
                                    {agendaSpeakerGroups.map(g => (
                                      <optgroup key={g.label} label={g.label}>
                                        {g.items.map(name => <option key={name} value={name}>{name}</option>)}
                                      </optgroup>
                                    ))}
                                    {isCustomSlot && <option value={slotVal}>{slotVal}</option>}
                                  </select>
                                );
                              })}
                            </div>
                          </td>
                        );
                      }
                      const isCustom = val && !knownOptions.includes(val);
                      return (
                        <td key={c.key} style={sx.td}>
                          <select
                            style={sx.cellInput}
                            value={val}
                            onChange={e => updateTableCell(t.key, rIdx, c.key, e.target.value)}
                          >
                            <option value="">—</option>
                            {agendaSpeakerGroups.map(g => (
                              <optgroup key={g.label} label={g.label}>
                                {g.items.map(name => <option key={name} value={name}>{name}</option>)}
                              </optgroup>
                            ))}
                            {isCustom && <option value={val}>{val}</option>}
                          </select>
                        </td>
                      );
                    }
                    if (t.smartAgenda && c.key === 'startTime') {
                      const computed = computeAgendaStartTime(rIdx);
                      return (
                        <td key={c.key} style={{ ...sx.td, padding: '0.4rem 0.5rem', color: '#334155', background: '#F8FAFC', fontVariantNumeric: 'tabular-nums' }}>
                          {computed || <span style={{ color: '#94A3B8' }}>—</span>}
                        </td>
                      );
                    }
                    if (t.smartAgenda && c.key === 'duration') {
                      const isAuto = !!row?._autoDuration;
                      return (
                        <td key={c.key} style={sx.td}>
                          <input
                            type="number"
                            min="0"
                            title={isAuto ? 'Auto-filled with the remaining meeting minutes. Type a value to pin it.' : undefined}
                            style={{
                              ...sx.cellInput,
                              ...(isAuto ? { fontStyle: 'italic', color: '#64748B' } : null),
                            }}
                            value={row[c.key] || ''}
                            onChange={e => updateAgendaDuration(rIdx, e.target.value)}
                            placeholder="min"
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} style={{ ...sx.td, ...(t.wrapCells ? { verticalAlign: 'top' } : {}) }}>
                        <CommitOnBlurInput
                          multiline={t.wrapCells || undefined}
                          autoGrow={t.wrapCells || undefined}
                          bulletList={c.bulletList || undefined}
                          style={t.wrapCells ? { ...sx.cellInput, resize: 'none', minHeight: '1.8em', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : sx.cellInput}
                          value={row[c.key] || ''}
                          onCommit={v => updateTableCell(t.key, rIdx, c.key, v)}
                        />
                      </td>
                    );
                  })}
                  <td style={sx.td}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0 }}>
                      {t.reorderable && (
                        <>
                          <span
                            title="Drag to reorder"
                            style={{ color: '#94A3B8', cursor: 'grab', fontSize: '0.9rem', lineHeight: 1, padding: '0 4px', userSelect: 'none' }}
                          >⋮⋮</span>
                          <button
                            type="button"
                            style={{ ...sx.rowBtn, color: '#64748B', padding: '0 3px', fontSize: '0.78rem' }}
                            title="Move up"
                            disabled={rIdx === 0}
                            onClick={() => moveTableRow(t.key, rIdx, -1)}
                          >↑</button>
                          <button
                            type="button"
                            style={{ ...sx.rowBtn, color: '#64748B', padding: '0 3px', fontSize: '0.78rem' }}
                            title="Move down"
                            disabled={rIdx >= (formData.tables[t.key] || []).length - 1}
                            onClick={() => moveTableRow(t.key, rIdx, 1)}
                          >↓</button>
                        </>
                      )}
                      <button
                        type="button"
                        style={sx.rowBtn}
                        title="Remove row"
                        onClick={() => removeTableRow(t.key, rIdx)}
                      >×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {t.smartAgenda && meetingStartIso && (() => {
              let endText = '';
              try {
                const d = new Date(meetingStartIso);
                d.setMinutes(d.getMinutes() + agendaSum);
                endText = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              } catch {}
              const scheduledEnd = formData.meeting?.end
                ? (() => { try { return new Date(formData.meeting.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } })()
                : '';
              const mismatch = scheduledEnd && endText && scheduledEnd !== endText;
              const timeColIndex = t.columns.findIndex(c => c.key === 'startTime');
              return (
                <tfoot>
                  <tr>
                    {t.columns.map((c, i) => {
                      if (i === Math.max(0, timeColIndex - 1)) {
                        return (
                          <td key={c.key} style={{ ...sx.td, padding: '0.35rem 0.5rem', textAlign: 'right', fontSize: '0.72rem', color: '#15803D', fontWeight: 700 }}>
                            Meeting ends:
                          </td>
                        );
                      }
                      if (i === timeColIndex) {
                        return (
                          <td key={c.key} style={{ ...sx.td, padding: '0.4rem 0.5rem', background: mismatch ? '#FEF2F2' : '#F0FDF4', color: mismatch ? '#B91C1C' : '#15803D', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {endText || '—'}
                            {mismatch && <div style={{ fontSize: '0.65rem', fontWeight: 500, color: '#B91C1C', marginTop: 1 }}>invite: {scheduledEnd}</div>}
                          </td>
                        );
                      }
                      return <td key={c.key} style={{ ...sx.td, padding: '0.35rem 0.5rem' }}></td>;
                    })}
                    <td style={sx.td}></td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      );
    });
  }

  const topTables = template.tables.filter(t => t.placement === 'top');
  const bottomTables = template.tables.filter(t => t.placement !== 'top' && !t.underField && !t.aboveField);
  const tablesByField = {};   // rendered AFTER the field input
  const tablesAboveField = {}; // rendered BEFORE the field input
  for (const t of template.tables) {
    if (t.underField) {
      if (!tablesByField[t.underField]) tablesByField[t.underField] = [];
      tablesByField[t.underField].push(t);
    } else if (t.aboveField) {
      if (!tablesAboveField[t.aboveField]) tablesAboveField[t.aboveField] = [];
      tablesAboveField[t.aboveField].push(t);
    }
  }

  // ---- Link opportunity (search the Opps cache by BFO Link or text) ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cache, setCache] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Load when the picker opens, or eagerly when there's no linked opp and
    // we have a company — so we can show suggested open opps for the account.
    if (!pickerOpen && (formData.linkedBfoLink || !companyName)) return;
    loadOppsFromCache().then(c => setCache(c));
  }, [pickerOpen, formData.linkedBfoLink, companyName]);

  const results = useMemo(() => searchOpps(cache, search), [cache, search]);

  // Suggested open opps for the current company — shown when no opp is
  // linked yet so the user can one-click attach the right one.
  const suggestedOpps = useMemo(() => {
    if (formData.linkedBfoLink) return [];
    if (!cache?.records || !companyName) return [];
    const strip = s => String(s || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|lp|gmbh)\b\.?/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const target = strip(companyName);
    if (!target) return [];
    const CLOSED = new Set(['sold', 'not sold']);
    const matches = [];
    for (const r of cache.records) {
      const acct = strip(r['Account']);
      if (!acct) continue;
      const sameAccount = (
        acct === target ||
        (target.length >= 4 && acct.includes(target)) ||
        (acct.length >= 4 && target.includes(acct))
      );
      if (!sameAccount) continue;
      const stage = String(r['Stage'] || '').trim().toLowerCase();
      if (CLOSED.has(stage)) continue;
      matches.push(r);
    }
    return matches.slice(0, 10);
  }, [cache, companyName, formData.linkedBfoLink]);

  const linkOpp = (opp) => {
    const nextValues = { ...formData.fieldValues };
    for (const f of template.fields) {
      if (f.autofill && opp[f.autofill] != null) {
        nextValues[f.key] = String(opp[f.autofill]);
      }
    }
    // Status is driven by the Account (company) on this opp, not the opp
    // row's Status column. Look up the matching prospect in the Table View
    // data and pull its account-level status. Also auto-populate Current
    // Scope with the company's active services, and Client Manager with
    // the CDM on the prospect record if we have one.
    const accountName = (opp?.['Account'] || '').trim();
    const matchedProspect = matchProspectByName(accountName, prospects);
    if (matchedProspect?.status) {
      nextValues.status = matchedProspect.status;
    }
    if (matchedProspect) {
      const active = currentServicesFor(matchedProspect);
      if (active.length > 0) nextValues.currentScope = active.join(', ');
      const cdm = (matchedProspect.cdm || '').trim();
      const isClient = (matchedProspect.status || '').trim() === 'Client';
      if (!nextValues.clientManager) {
        if (isClient && cdm) nextValues.clientManager = cdm;
        else if (!isClient) nextValues.clientManager = 'N/A - Not a current client';
      }
    }
    // Stage must always resolve to a BFO value. Try the opp's Stage column
    // first; if it's already a BFO name ('3 - Qualify Opportunity' etc.)
    // keep it. If it's a Dan name ('Quoted', 'Lead'), convert to BFO. Then
    // fall back to the Status column by the same rules.
    const oppStage = (opp?.['Stage'] || '').trim();
    const oppStatus = (opp?.['Status'] || '').trim();
    const bfoFromStage = toBfoStage(oppStage);
    const bfoFromStatus = toBfoStage(oppStatus);
    const finalStage = bfoFromStage || bfoFromStatus || '';
    // eslint-disable-next-line no-console
    console.log('[OpportunityForm] stage mapping:', { oppStage, oppStatus, bfoFromStage, bfoFromStatus, finalStage });
    if (finalStage) {
      nextValues.stage = finalStage;
    } else {
      // No recognized value — blank it out so the user sees that nothing
      // was matched instead of a Dan value that looks BFO-like.
      nextValues.stage = oppStage || '';
    }

    // Prefill Intent / End In Mind from the stage-specific meeting template
    // so every form starts with the right customer-facing framing. We match
    // on the Dan name first (oppStage or oppStatus, whichever the Opps sheet
    // uses), then fall back to the BFO value we just resolved.
    const templateMatch =
      meetingTemplateFor(oppStage) ||
      meetingTemplateFor(oppStatus) ||
      meetingTemplateFor(finalStage);
    if (templateMatch) {
      const displayCompany = (opp?.['Account'] || companyName || 'the customer').trim();
      nextValues.intent = templateMatch.intent.replaceAll('{company}', displayCompany);
      nextValues.endInMind = templateMatch.endInMind.replaceAll('{company}', displayCompany);
    }

    // Friendly display label for the linked BFO opportunity — used as the
    // hyperlink anchor text. Prefer Account + first service from Scope.
    const scopeStr = String(opp?.['Scope'] || '').trim();
    const firstScope = scopeStr.split(',').map(s => s.trim()).filter(Boolean)[0] || '';
    const linkedOppName = [opp?.['Account'] || '', firstScope].filter(Boolean).join(' — ');

    const nextFormData = {
      ...formData,
      fieldValues: nextValues,
      linkedBfoLink: opp['BFO Link'] || null,
      linkedOppName: linkedOppName || null,
    };
    // Single write through the parent. Previously we did
    //   set(...)  -> updateOpportunityFormData (write 1)
    //   onLinkOpp -> applySuggestedTitle (write 2)
    // and write 2 used a stale companyOppsData closure that silently
    // overwrote write 1's formData, so all the freshly linked fields
    // disappeared. Now the parent gets the full delta and commits
    // formData + title in one atomic writeCompanyOpps.
    // Linking is a discrete event — cancel any pending debounced typing
    // flush, sync local state, and write up immediately.
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; pendingRef.current = null; }
    lastAcceptedRef.current = nextFormData;
    setLocalValue(nextFormData);
    if (onLinkOpp) onLinkOpp(opp, nextFormData);
    else onChange(nextFormData);
    setPickerOpen(false);
    setSearch('');
  };

  const unlinkOpp = () => set({ linkedBfoLink: null, linkedOppName: null });

  // "Dan's Ask" — per-SE-attendee free text stored under the meeting
  // object, keyed by lowercased email so it survives ICS re-imports.
  const dansAsks = (formData.meeting?.dansAsks) || {};
  // Dan's Ask is keyed on the attendee's email when present, otherwise on
  // a name-based key — so manually added attendees without an email still
  // get their Ask persisted.
  const dansAskKey = (att) => {
    const em = (att?.email || '').trim().toLowerCase();
    if (em) return em;
    const nm = (att?.name || '').trim().toLowerCase();
    return nm ? `name:${nm}` : '';
  };
  const updateDansAsk = (attendee, text) => {
    const key = dansAskKey(attendee);
    if (!key) return;
    const next = { ...(formData.meeting || {}) };
    next.dansAsks = { ...(next.dansAsks || {}), [key]: text };
    set({ meeting: next });
  };

  // ---- Meeting drop zone (drag an Outlook .ics or live meeting in) -------
  const [isDraggingMeeting, setIsDraggingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState('');
  const fileInputRef = useRef(null);

  async function ingestMeetingFile(file) {
    setMeetingError('');
    if (!file) return;
    const name = (file.name || '').toLowerCase();

    // .msg = Outlook's native binary format. This is what Outlook desktop
    // actually drops onto the browser when you drag a meeting (NOT a .ics).
    if (name.endsWith('.msg')) {
      try {
        const buf = await file.arrayBuffer();
        const reader = new MsgReader(buf);
        const data = reader.getFileData();
        const parsed = msgToMeeting(data);
        if (!parsed || (!parsed.subject && !parsed.start && parsed.attendees.length === 0)) {
          setMeetingError('Could not extract a meeting from that .msg file.');
          return;
        }
        console.log('[OpportunityForm] parsed .msg:', {
          subject: parsed.subject, start: parsed.start, end: parsed.end,
          attendees: parsed.attendees.length, location: parsed.location,
          rawKeys: Object.keys(data || {}),
          rawApptStartWhole: data?.apptStartWhole,
          rawApptEndWhole: data?.apptEndWhole,
          rawLocation: data?.location,
        });
        set({ meeting: parsed });
      } catch (err) {
        console.error('msg parse failed', err);
        setMeetingError('Failed to read .msg file: ' + (err.message || err));
      }
      return;
    }

    if (!name.endsWith('.ics')) {
      setMeetingError(`${file.name || 'File'} is not a recognized meeting file. Drag an .ics export from Outlook (or a .msg) — or use "Add attendees manually" below.`);
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseIcs(text);
      if (!parsed || (!parsed.subject && !parsed.start)) {
        setMeetingError('Could not parse that .ics file.');
        return;
      }
      // Diagnostic: surfaces the role + raw params per attendee so we can
      // figure out which field Outlook is using for required/optional.
      if (parsed.attendees?.length) {
        // eslint-disable-next-line no-console
        console.log('[OpportunityForm] parsed attendees:', parsed.attendees.map(a => ({
          name: a.name, email: a.email, required: a.required, role: a.role, rawParams: a.rawParams,
        })));
      }
      set({ meeting: parsed });
    } catch (err) {
      setMeetingError('Failed to read meeting file: ' + (err.message || err));
    }
  }

  // Convert MsgReader's getFileData() output into our meeting shape.
  // MsgReader exposes meeting items with fields like:
  //   subject, body, bodyHtml, recipients[{ name, email, recipType }],
  //   appointment fields (start/end/location/duration)
  function msgToMeeting(data) {
    if (!data) return null;
    const out = {
      subject: data.subject || data.normalizedSubject || '',
      start: null,
      end: null,
      durationMinutes: null,
      location: '',
      organizer: null,
      attendees: [],
      manualAttendees: [],
      sourceTimeZone: null,
    };

    // Appointment-specific fields. The library exposes start/end as ISO
    // strings or Date objects depending on version; normalize.
    const toIso = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString();
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    // @kenjiuno/msgreader exposes appointment times as apptStartWhole /
    // apptEndWhole (PidLidAppointmentStartWhole / PidLidAppointmentEndWhole).
    out.start = toIso(data.apptStartWhole || data.appointmentStartWhole || data.startDate || data.start);
    out.end = toIso(data.apptEndWhole || data.appointmentEndWhole || data.endDate || data.end);
    if (out.start && out.end) {
      const ms = new Date(out.end).getTime() - new Date(out.start).getTime();
      if (Number.isFinite(ms) && ms > 0) out.durationMinutes = Math.round(ms / 60000);
    }
    out.location = data.location || '';

    // MsgReader exposes two address fields per recipient: `email`
    // (PR_EMAIL_ADDRESS — for cached-mode Exchange contacts this is an
    // X.500 EX address like `/o=ExchangeLabs/.../sesa495000`, not an
    // SMTP one) and `smtpAddress` (PR_SMTP_ADDRESS — always SMTP). We
    // prefer SMTP so downstream identity / Schneider-domain checks
    // see `daniel.baldauf@se.com` and not the Exchange DN that those
    // checks can't classify. Fall back to `email` only when the SMTP
    // form is missing — the EX-pattern hint in the SE bucketer can
    // still rescue it.
    const pickAddress = (smtp, ex) => {
      const s = (smtp || '').trim();
      if (s) return s.toLowerCase();
      return (ex || '').trim().toLowerCase();
    };

    // Sender becomes organizer. Same SMTP-over-EX preference.
    const senderEmail = pickAddress(data.senderSmtpAddress || data.senderEmailSmtp, data.senderEmail);
    if (senderEmail || data.senderName) {
      out.organizer = { name: data.senderName || '', email: senderEmail || '' };
    }

    // Recipients → attendees. .msg recipType: 1 = To (required),
    // 2 = Cc (optional), 3 = Bcc.
    const seen = new Set();
    for (const r of (data.recipients || [])) {
      const email = pickAddress(r.smtpAddress, r.email);
      const name = (r.name || '').trim() || email;
      if (!email && !name) continue;
      const key = email || `name:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.attendees.push({
        name, email,
        required: r.recipType !== 2,
        role: r.recipType === 2 ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT',
        rawParams: { source: 'msg', recipType: r.recipType, exAddress: r.email || null },
      });
    }

    // If we still don't have a start time, look for "When: ..." in the body.
    // Also try "Location:" / "Where:" if location came back empty.
    if ((!out.start || !out.location) && data.body) {
      const lines = String(data.body).split(/\r?\n/);
      for (const line of lines) {
        if (!out.start) {
          const m = line.match(/^\s*(?:When|Time|Start)\s*[:–—-]\s*(.+)$/i);
          if (m) {
            const cleaned = m[1].replace(/\s+\([^)]+\)\s*$/, '').trim();
            const d = new Date(cleaned);
            if (!Number.isNaN(d.getTime())) out.start = d.toISOString();
          }
        }
        if (!out.location) {
          const m = line.match(/^\s*(?:Where|Location)\s*[:–—-]\s*(.+)$/i);
          if (m) out.location = m[1].trim();
        }
      }
    }

    return out;
  }

  // Tries to extract a meeting from non-file drops. Outlook desktop on
  // Windows doesn't put a real .ics blob in the drag payload, but it
  // does write something useful into text/html and text/plain. Parse
  // whatever's there best-effort. Returns null if nothing useful found.
  function parseDroppedOutlookText({ html, plain }) {
    const out = {
      subject: '', start: null, end: null, durationMinutes: null,
      location: '', organizer: null, attendees: [], manualAttendees: [],
      sourceTimeZone: null,
    };

    // Plain text: first non-empty line is usually the subject. Look for
    // "When: <date>" and "Where: <location>" lines (Outlook desktop
    // meeting-body format).
    if (plain) {
      const lines = plain.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length > 0 && !out.subject) out.subject = lines[0];
      for (const line of lines) {
        const mWhen = line.match(/^When:\s*(.+)$/i);
        if (mWhen && !out.start) {
          const parsed = new Date(mWhen[1].replace(/\s+\(.+\)\s*$/, '').trim());
          if (!Number.isNaN(parsed.getTime())) out.start = parsed.toISOString();
        }
        const mWhere = line.match(/^(?:Where|Location):\s*(.+)$/i);
        if (mWhere && !out.location) out.location = mWhere[1].trim();
      }
    }

    // HTML: pull subject from <title>/<h1>, attendees from "Required
    // Attendees:" / "Optional Attendees:" lines, and a richer date if we
    // find one.
    if (html) {
      const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

      if (!out.subject) {
        const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (t) out.subject = stripTags(t[1]);
      }
      if (!out.subject) {
        const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h) out.subject = stripTags(h[1]);
      }

      // Outlook drag-HTML often surfaces attendees with mailto: links.
      // Pull every name/email pair out of the HTML and dedupe.
      const seen = new Set();
      const attendeeRe = /<a[^>]*href="mailto:([^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = attendeeRe.exec(html)) !== null) {
        const email = m[1].trim().toLowerCase();
        const name = stripTags(m[2]) || email;
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.attendees.push({ name, email, required: true, role: 'unknown', rawParams: { source: 'html-drag' } });
      }
    }

    // Nothing useful at all → bail.
    if (!out.subject && !out.start && out.attendees.length === 0) return null;
    return out;
  }

  async function handleMeetingDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingMeeting(false);

    // 1. Real file drop. .msg is what Outlook desktop on Windows actually
    //    drops when you drag a meeting (NOT .ics — that's only when the
    //    user has explicitly saved as Calendar Format first).
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0 && /\.(ics|msg)$/i.test(files[0].name || '')) {
      ingestMeetingFile(files[0]);
      return;
    }

    // 2. Real ICS payload sometimes comes via text/calendar (rare, but
    //    happens on Outlook web and a few clients).
    const ics = e.dataTransfer?.getData?.('text/calendar') || e.dataTransfer?.getData?.('text/x-vcalendar');
    if (ics && ics.includes('BEGIN:VCALENDAR')) {
      try {
        const parsed = parseIcs(ics);
        if (parsed && (parsed.subject || parsed.start)) {
          set({ meeting: parsed });
          return;
        }
      } catch {}
    }

    // 3. Outlook desktop on Windows often advertises a virtual file via
    //    types=['Files'] but exposes nothing through dataTransfer.files
    //    (that's the OLE/CFSTR_FILEDESCRIPTOR clipboard format). The
    //    .items API can sometimes still hand us a real File object —
    //    if it can, it's frequently a real .ics under the hood.
    try {
      const items = Array.from(e.dataTransfer?.items || []);
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile?.();
        if (!file) continue;
        const itemName = (file.name || '').toLowerCase();
        // Accept .ics, .vcs, or extensionless names — try reading text and
        // see if it parses as ICS regardless.
        try {
          const text = await file.text();
          if (text && text.includes('BEGIN:VCALENDAR')) {
            const parsed = parseIcs(text);
            if (parsed && (parsed.subject || parsed.start)) {
              set({ meeting: parsed });
              return;
            }
          }
          // If it's a saved .ics-named file Chrome did expose here but
          // didn't put in .files, run it through ingestMeetingFile too.
          if (/\.(ics|vcs)$/i.test(itemName)) {
            await ingestMeetingFile(file);
            return;
          }
        } catch {
          // OLE virtual files often throw on .text() — that's the case
          // where Chrome literally can't read them. Fall through.
        }
      }
    } catch {}

    // 4. Fallback: parse whatever HTML/text Outlook desktop did include.
    //    On Windows this is what we usually get from a calendar drag —
    //    not a real .ics, but enough to fill the form most of the way.
    const html = e.dataTransfer?.getData?.('text/html') || '';
    const plain = e.dataTransfer?.getData?.('text/plain') || '';
    const types = Array.from(e.dataTransfer?.types || []);
    // Diagnostic: helps when the parser misses something — paste the log
    // back into a chat and we can teach the parser the new format.
    console.log('[OpportunityForm] non-ics drop. types=', types,
      'plainPreview=', plain.slice(0, 400),
      'htmlLen=', html.length);
    const partial = parseDroppedOutlookText({ html, plain });
    if (partial) {
      set({ meeting: partial });
      setMeetingError(
        partial.attendees.length === 0 && !partial.start
          ? 'Imported subject only — Outlook didn\'t include attendees or time in the drag. Fill in the missing pieces, or save the meeting as .ics for full attendee/time import.'
          : ''
      );
      return;
    }

    // 4. Nothing parseable. Existing legacy file path with .ics-only
    //    error if there was a non-.ics file dropped.
    if (files.length > 0) {
      ingestMeetingFile(files[0]);
      return;
    }
    setMeetingError(
      'Couldn\'t read the drop. Outlook desktop on Windows sometimes only exposes the meeting in formats browsers can\'t read. ' +
      'Workaround: open the meeting → File → Save As → Calendar Format (.ics) → drag the saved file in. Or use "Add attendees manually" below.'
    );
    return;
  }

  const clearMeeting = () => set({ meeting: null });

  // Attendee matching + SE vs Customer bucketing. SE is anyone on an
  // @se.com address (case-insensitive, matches subdomains too). Everyone
  // else is grouped under the current customer company. We also track
  // each attendee's required/optional role from the ICS.
  const { seAttendees, customerAttendees } = useMemo(() => {
    const mt = formData.meeting;
    const ics = mt?.attendees || [];
    const manual = mt?.manualAttendees || [];
    const empty = { seAttendees: [], customerAttendees: [] };
    if (ics.length === 0 && manual.length === 0) return empty;
    const byEmail = new Map();
    const pool = (allHubspotContacts && allHubspotContacts.length > 0) ? allHubspotContacts : companyContacts;
    for (const c of pool) {
      const em = (c.email || '').toLowerCase().trim();
      if (em && !byEmail.has(em)) byEmail.set(em, c);
    }
    const thisCompany = (companyName || '').toLowerCase().trim();
    const se = [];
    const cust = [];
    const seen = new Set();
    for (const a of [...ics, ...manual]) {
      const em = (a.email || '').toLowerCase().trim();
      const key = em || `name:${(a.name || '').toLowerCase().trim()}`;
      if (seen.has(key)) continue; // dedupe if same email/name on both sides
      seen.add(key);
      // Prefer the live HubSpot contact, but fall back to the snapshot
      // persisted on the attendee so the section still populates when the
      // contact pool hasn't been loaded/refreshed this session.
      const match = (em ? byEmail.get(em) : null) || a.matchSnapshot || null;
      const matchedCompany = (match?.company || '').trim();
      const matchedOtherCompany = !!matchedCompany && matchedCompany.toLowerCase() !== thisCompany;
      const enriched = { ...a, match, matchedCompany, matchedOtherCompany };
      // Explicit bucket on manual attendees wins; otherwise fall back to
      // email-domain detection for @se.com / @schneider-electric.com.
      // When the address came in as an Exchange X.500 DN (cached-mode
      // .msg drag from Outlook desktop), the SMTP form is missing, but
      // those DNs reliably contain Schneider's `sesa<digits>` SAM
      // suffix on the cn= leg and / or the literal "schneider" substring
      // higher up the path — either is a strong SE signal.
      let isSE;
      if (a.bucket === 'se') isSE = true;
      else if (a.bucket === 'customer') isSE = false;
      else {
        const exHint = String(a.rawParams?.exAddress || '').toLowerCase();
        isSE = /@(se\.com|schneider-electric\.com)$/i.test(em)
          || /sesa\d+/.test(em) || /sesa\d+/.test(exHint)
          || /schneider/.test(em) || /schneider/.test(exHint);
      }
      if (isSE) se.push(enriched); else cust.push(enriched);
    }
    // Required first, optional after. Within each group sort by an
    // explicit _order field when set (so user-driven drag / move
    // up-down survives a refresh) and fall back to alphabetical.
    const sorter = (a, b) => {
      if (!!a.required !== !!b.required) return a.required ? -1 : 1;
      const ao = Number.isFinite(a._order) ? a._order : null;
      const bo = Number.isFinite(b._order) ? b._order : null;
      if (ao !== null && bo !== null) return ao - bo;
      if (ao !== null) return -1;
      if (bo !== null) return 1;
      return displayAttendeeName(a, contactNicknames).localeCompare(displayAttendeeName(b, contactNicknames));
    };
    se.sort(sorter);
    cust.sort(sorter);
    return { seAttendees: se, customerAttendees: cust };
  }, [formData.meeting, allHubspotContacts, companyContacts, companyName]);

  const totalAttendees = (seAttendees?.length || 0) + (customerAttendees?.length || 0);

  // Persist a snapshot of each attendee's matched HubSpot contact onto the
  // saved meeting so the Attendees section still populates (name, title,
  // company, location, notes, LinkedIn) without re-loading the HubSpot
  // contact pool. Only runs when the live pool is present and only writes
  // when a snapshot actually changed, so it can't loop. When no live pool
  // is loaded we leave any existing snapshots untouched.
  useEffect(() => {
    const mt = formData.meeting;
    if (!mt) return;
    const pool = (allHubspotContacts && allHubspotContacts.length > 0) ? allHubspotContacts : companyContacts;
    if (!pool || pool.length === 0) return;
    const byEmail = new Map();
    for (const c of pool) {
      const em = (c.email || '').toLowerCase().trim();
      if (em && !byEmail.has(em)) byEmail.set(em, c);
    }
    let changed = false;
    const sync = (list) => (list || []).map(a => {
      const em = (a.email || '').toLowerCase().trim();
      const live = em ? byEmail.get(em) : null;
      if (!live) return a; // no live match — keep whatever snapshot is already there
      const snap = snapshotFromMatch(live);
      if (JSON.stringify(a.matchSnapshot || null) === JSON.stringify(snap)) return a;
      changed = true;
      return { ...a, matchSnapshot: snap };
    });
    const attendees = sync(mt.attendees);
    const manualAttendees = sync(mt.manualAttendees);
    if (changed) set({ meeting: { ...mt, attendees, manualAttendees } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.meeting, allHubspotContacts, companyContacts]);

  // --- Manual attendees -------------------------------------------------
  // Users can add attendees on top of those imported from Outlook. Stored
  // under meeting.manualAttendees so they survive ICS re-imports (re-import
  // replaces meeting.attendees but we preserve manualAttendees separately
  // when the user chooses to re-drop a .ics).
  const [addingTo, setAddingTo] = useState(null); // 'se' | 'customer' | null
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftRequired, setDraftRequired] = useState(true);
  // Drag state for reordering Schneider attendees between Required /
  // Optional sub-sections (and within a sub-section).
  const [seDragKey, setSeDragKey] = useState(null);   // unique id of the row being dragged
  const [seDragOverIdx, setSeDragOverIdx] = useState(null); // current drop target index in the displayed SE list
  // Customer-side drag state. Custom groups live on the meeting object
  // under `customerGroups: string[]`; each attendee may carry a free-
  // text `group` field that places them under that custom group. Empty
  // group falls back to Required / Optional bucketing.
  const [custDragKey, setCustDragKey] = useState(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // Once the user picks a contact from the dropdown we hide the list until
  // they edit the name again — avoids re-showing the suggestion they just
  // selected.
  const [draftPicked, setDraftPicked] = useState(false);

  function openAddAttendee(bucket) {
    setAddingTo(bucket);
    setDraftName('');
    setDraftEmail('');
    setDraftRequired(true);
    setDraftPicked(false);
  }
  function cancelAddAttendee() {
    setAddingTo(null);
    setDraftName('');
    setDraftEmail('');
    setDraftPicked(false);
  }
  function commitAddAttendee() {
    const name = draftName.trim();
    const email = draftEmail.trim();
    if (!name && !email) { setAddingTo(null); return; }
    const bucket = addingTo;
    const mt = formData.meeting || { subject: '', start: null, end: null, durationMinutes: null, location: '', organizer: null, attendees: [], manualAttendees: [] };
    const manual = Array.isArray(mt.manualAttendees) ? mt.manualAttendees : [];
    const next = {
      ...mt,
      manualAttendees: [
        ...manual,
        { name: name || email, email, required: !!draftRequired, bucket, source: 'manual' },
      ],
    };
    set({ meeting: next });
    setAddingTo(null);
    setDraftName('');
    setDraftEmail('');
    setDraftPicked(false);
  }
  function removeManualAttendee(a) {
    const mt = formData.meeting || {};
    const manual = (mt.manualAttendees || []).filter(x => {
      if (x.source !== 'manual') return true;
      if (x.email && a.email && x.email.toLowerCase() === a.email.toLowerCase()) return false;
      if (!x.email && !a.email && (x.name || '') === (a.name || '')) return false;
      return true;
    });
    set({ meeting: { ...mt, manualAttendees: manual } });
  }

  // Unified remove for ICS-imported AND manually added attendees. Matches
  // by email (case-insensitive) when present, else by name.
  function removeAttendee(a) {
    const mt = formData.meeting || {};
    const sameAttendee = (x) => {
      if (a.email && x.email && x.email.toLowerCase() === a.email.toLowerCase()) return true;
      if (!a.email && !x.email && (x.name || '') === (a.name || '')) return true;
      return false;
    };
    const attendees = (mt.attendees || []).filter(x => !sameAttendee(x));
    const manualAttendees = (mt.manualAttendees || []).filter(x => !sameAttendee(x));
    set({ meeting: { ...mt, attendees, manualAttendees } });
  }

  // Locate an attendee in either of the two underlying lists. Used by
  // the patch / move helpers below so we can mutate the right slot in
  // meeting.attendees vs meeting.manualAttendees.
  function findAttendeeIn(mt, target) {
    const sameAttendee = (x) => {
      if (target.email && x.email && x.email.toLowerCase() === target.email.toLowerCase()) return true;
      if (!target.email && !x.email && (x.name || '') === (target.name || '')) return true;
      return false;
    };
    const ics = mt.attendees || [];
    const icsIdx = ics.findIndex(sameAttendee);
    if (icsIdx >= 0) return { source: 'attendees', index: icsIdx };
    const manual = mt.manualAttendees || [];
    const manualIdx = manual.findIndex(sameAttendee);
    if (manualIdx >= 0) return { source: 'manualAttendees', index: manualIdx };
    return null;
  }

  // Flip the Required flag on a single attendee. The display sort
  // automatically moves them between the Required and Optional
  // sub-sections; their _order is preserved.
  function setAttendeeRequired(a, required) {
    const mt = formData.meeting || {};
    const found = findAttendeeIn(mt, a);
    if (!found) return;
    const next = [...(mt[found.source] || [])];
    next[found.index] = { ...next[found.index], required: !!required };
    set({ meeting: { ...mt, [found.source]: next } });
  }

  // Move an attendee to a different customer-side bucket. `group` is a
  // free-text custom group label, or '' to fall back to Required /
  // Optional. `required` overrides the required flag when supplied.
  function setAttendeeCustomGroup(a, group, required) {
    const mt = formData.meeting || {};
    const found = findAttendeeIn(mt, a);
    if (!found) return;
    const next = [...(mt[found.source] || [])];
    const patch = { group: group || '' };
    if (typeof required === 'boolean') patch.required = required;
    next[found.index] = { ...next[found.index], ...patch };
    set({ meeting: { ...mt, [found.source]: next } });
  }

  function addCustomerGroup(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const mt = formData.meeting || {};
    const existing = Array.isArray(mt.customerGroups) ? mt.customerGroups : [];
    if (existing.some(g => g.toLowerCase() === trimmed.toLowerCase())) return;
    set({ meeting: { ...mt, customerGroups: [...existing, trimmed] } });
  }

  function removeCustomerGroup(name) {
    const mt = formData.meeting || {};
    const existing = Array.isArray(mt.customerGroups) ? mt.customerGroups : [];
    const trimmed = (name || '').trim();
    const nextGroups = existing.filter(g => g.toLowerCase() !== trimmed.toLowerCase());
    // Any attendees pointing at the removed group fall back to Required
    // / Optional bucketing.
    const stripGroup = (arr) => (arr || []).map(x => {
      if (!x?.group) return x;
      if (String(x.group).toLowerCase() === trimmed.toLowerCase()) {
        const { group: _drop, ...rest } = x;
        return rest;
      }
      return x;
    });
    set({ meeting: {
      ...mt,
      customerGroups: nextGroups,
      attendees: stripGroup(mt.attendees),
      manualAttendees: stripGroup(mt.manualAttendees),
    } });
  }

  // Reorder a displayed list (the SE-only or Customer-only bucket, in
  // current display order). Stamps a sequential _order on every entry
  // so the new position survives a refresh, and writes those _orders
  // back into both meeting.attendees and meeting.manualAttendees.
  function reorderAttendees(displayedList, fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= displayedList.length || toIdx >= displayedList.length) return;
    const reordered = [...displayedList];
    const [item] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, item);
    let mt = formData.meeting || {};
    let attendees = [...(mt.attendees || [])];
    let manualAttendees = [...(mt.manualAttendees || [])];
    reordered.forEach((x, i) => {
      const found = findAttendeeIn({ attendees, manualAttendees }, x);
      if (!found) return;
      const arr = found.source === 'attendees' ? attendees : manualAttendees;
      arr[found.index] = { ...arr[found.index], _order: i * 10 };
    });
    set({ meeting: { ...mt, attendees, manualAttendees } });
  }

  // --- Smart Agenda helpers (must live after seAttendees/customerAttendees
  //     are defined — they're used by renderTables via closure). --------
  // Each company name is included at the top of its own optgroup as a
  // pickable "team" option so a row can be attributed to the whole
  // organization rather than a specific person.
  const agendaSpeakerGroups = useMemo(() => {
    const opts = [];
    const se = (seAttendees || []).map(a => displayAttendeeName(a, contactNicknames)).filter(n => n && n !== '(unknown)');
    const cust = (customerAttendees || []).map(a => displayAttendeeName(a, contactNicknames)).filter(n => n && n !== '(unknown)');
    const customerLabel = companyName || 'Customer';
    if (se.length > 0 || true) {
      opts.push({ label: 'Schneider Electric', items: ['Schneider Electric', ...se] });
    }
    if (cust.length > 0 || companyName) {
      opts.push({ label: customerLabel, items: [customerLabel, ...cust] });
    }
    return opts;
  }, [seAttendees, customerAttendees, companyName]);

  const meetingTotalMinutes = formData.meeting?.durationMinutes || 0;
  const meetingStartIso = formData.meeting?.start || '';

  // Compute the start time for agenda row N as: meeting.start + sum of
  // durations for rows 0..N-1. Returns a short time string like "2:05 PM"
  // or '' if the meeting has no start time.
  function computeAgendaStartTime(rowIdx) {
    if (!meetingStartIso) return '';
    const rows = formData.tables.agenda || [];
    let priorSum = 0;
    for (let i = 0; i < rowIdx; i++) priorSum += Number(rows[i]?.duration) || 0;
    try {
      const d = new Date(meetingStartIso);
      d.setMinutes(d.getMinutes() + priorSum);
      return formatEasternTime(d.toISOString());
    } catch { return ''; }
  }

  // Auto-balance the agenda so the next blank row always carries the
  // remaining meeting minutes. The "auto-filled" row is tagged with
  // _autoDuration so a follow-up edit elsewhere can rebalance it back
  // to the new remainder. User-typed durations clear the tag and
  // pin that cell.
  function applyAutoBalance(rows, totalMinutes) {
    if (!totalMinutes || !rows?.length) return rows;
    // Prefer rebalancing a row we already auto-filled (so changing
    // earlier rows just shrinks/grows that one). Otherwise target the
    // first blank-duration row after at least one filled row — that's
    // "the next agenda item" the user is asking about.
    let target = rows.findIndex(r => r?._autoDuration);
    if (target === -1) {
      const firstFilled = rows.findIndex(r => Number(r?.duration) > 0);
      if (firstFilled === -1) return rows; // nothing filled yet, nothing to balance from
      for (let i = firstFilled + 1; i < rows.length; i++) {
        const d = rows[i]?.duration;
        if (d == null || d === '' || (typeof d === 'string' && d.trim() === '')) {
          target = i;
          break;
        }
      }
    }
    if (target === -1) return rows;
    let used = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === target) continue;
      used += Number(rows[i]?.duration) || 0;
    }
    const remaining = totalMinutes - used;
    const current = rows[target]?.duration ?? '';
    if (remaining > 0) {
      const nextVal = String(remaining);
      if (current === nextVal && rows[target]?._autoDuration) return rows;
      const next = [...rows];
      next[target] = { ...next[target], duration: nextVal, _autoDuration: true };
      return next;
    }
    // Remainder gone (or negative — overflow). If we had auto-filled
    // this row before, drop the auto-fill and clear the cell so the
    // user can see they're at/over the budget. Don't touch rows the
    // user filled themselves.
    if (rows[target]?._autoDuration) {
      const next = [...rows];
      const { _autoDuration, ...rest } = next[target];
      next[target] = { ...rest, duration: '' };
      return next;
    }
    return rows;
  }

  function updateAgendaDuration(rowIdx, newMinutes) {
    const rows = [...(formData.tables.agenda || [])];
    if (!rows.length) return;
    const parsed = Math.max(0, Number(newMinutes) || 0);
    // User typing into the cell clears any auto-fill marker on that
    // row — their value is now pinned.
    const { _autoDuration: _drop, ...rest } = rows[rowIdx] || {};
    rows[rowIdx] = { ...rest, duration: parsed === 0 ? '' : String(parsed) };
    const balanced = applyAutoBalance(rows, meetingTotalMinutes);
    set({ tables: { ...formData.tables, agenda: balanced } });
  }

  const agendaSum = useMemo(() => {
    const rows = formData.tables.agenda || [];
    return rows.reduce((s, r) => s + (Number(r?.duration) || 0), 0);
  }, [formData.tables.agenda]);

  // When the meeting duration becomes known (or changes — different
  // calendar invite dropped in) re-run the auto-balance so any
  // existing blank row picks up the new remainder. Doesn't depend on
  // the agenda rows themselves so an in-progress edit doesn't loop.
  useEffect(() => {
    if (!meetingTotalMinutes) return;
    const rows = formData.tables.agenda || [];
    if (!rows.length) return;
    const balanced = applyAutoBalance(rows, meetingTotalMinutes);
    if (balanced !== rows) {
      set({ tables: { ...formData.tables, agenda: balanced } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingTotalMinutes]);

  const [creatingEmail, setCreatingEmail] = useState(null); // email currently being created

  async function handleCreateAttendeeContact(att) {
    if (!onCreateContact || !att.email) return;
    setCreatingEmail(att.email);
    try {
      // Split "First Last" naively; HubSpot accepts firstname/lastname
      const name = (att.name || '').trim();
      let firstname = '', lastname = '';
      if (name && name !== att.email) {
        const parts = name.split(/\s+/);
        firstname = parts[0] || '';
        lastname = parts.slice(1).join(' ') || '';
      }
      await onCreateContact({ email: att.email, firstname, lastname });
    } finally {
      setCreatingEmail(null);
    }
  }

  // ---- Export to Excel with Schneider Electric branding ----
  const exportExcel = async () => {
    try {
      const { Workbook } = await import('exceljs');

      // Schneider Electric brand palette (matches Portfolio Companies export)
      const SE_GREEN = 'FF3DCD58';      // Life is On green (title band)
      const SE_GREEN_DARK = 'FF009530'; // Section / table header band
      const SE_TEXT_DARK = 'FF1E293B';
      const SE_SURFACE = 'FFF6F9F4';    // Zebra / field-label surface
      const SE_BORDER = 'FFD4DDE1';
      const SE_MUTED = 'FF64748B';

      const thin = { style: 'thin', color: { argb: SE_BORDER } };
      const borderAll = { top: thin, bottom: thin, left: thin, right: thin };

      const wb = new Workbook();
      wb.creator = 'Schneider Electric · Prospect Tracker';
      wb.created = new Date();
      const ws = wb.addWorksheet('Opportunity', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
      });
      // 10-column sheet with uniform widths so any N-column table splits
      // the full page width into visually balanced slots (1-col = full
      // width, 2-col = 5/5, 3-col = 3/3/4, 4-col = 3/3/2/2, 5-col = 2/2/
      // 2/2/2). The attendees section uses cols 1-4 for SE and cols 6-10
      // for the customer side, with col 5 as a visual gap.
      const colWidths = [24, 24, 24, 24, 24, 24, 24, 24, 24, 24];
      ws.columns = colWidths.map(w => ({ width: w }));
      const SPAN = colWidths.length;

      // Estimate how many visible rows a cell will take given its text and
      // column width (Excel character-width units). Used to set row.height
      // so wrapped text is fully visible without leaving excess empty
      // space. Nunito Sans 10pt is ~0.67x the width of Excel's default
      // Calibri 11pt, so ~1.5 chars fit per column-width unit in practice.
      //
      // Also normalizes whitespace so copy-pasted HubSpot notes (trailing
      // newlines, triple-blank-line paragraph breaks, stray \r chars)
      // don't inflate the line count past what Excel will actually render.
      const estimateWrappedLines = (text, colUnits) => {
        if (!text) return 1;
        const s = String(text)
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')     // strip trailing spaces on wrap
          .replace(/\n{3,}/g, '\n\n')     // collapse >2 blank lines
          .replace(/^\s+|\s+$/g, '');     // trim outer whitespace
        if (!s) return 1;
        const explicit = s.split('\n');
        let lines = 0;
        // Slightly conservative chars-per-line (1.4 rather than 1.5) so
        // text that wraps just past the column width is counted as the
        // extra line it really takes, instead of being clipped.
        const perLine = Math.max(8, Math.floor(colUnits * 1.4));
        for (const line of explicit) {
          const len = line.length;
          if (len === 0) { lines += 1; continue; }
          lines += Math.ceil(len / perLine);
        }
        return Math.max(1, lines);
      };
      // ~14pt per wrapped line of 10pt text (matches Excel's native
      // auto-fit), with a 16pt floor so single-line rows stay tight.
      // Multi-line (wrapping) cells get a small cushion on top so the
      // final line never clips when Excel wraps a touch tighter than
      // estimated.
      const rowHeightForLines = (lines) => (lines <= 1 ? 16 : Math.min(600, lines * 14 + 8));

      // Row 1: "SE ADVISORY SERVICES" wordmark. SE is green, the rest
      // is dark gray — rendered as a rich-text cell on a white background.
      ws.mergeCells(1, 1, 1, SPAN);
      const wordmarkCell = ws.getCell(1, 1);
      wordmarkCell.value = {
        richText: [
          { text: 'SE', font: { name: 'Nunito Sans', bold: true, size: 22, color: { argb: SE_GREEN } } },
          { text: ' ADVISORY SERVICES', font: { name: 'Nunito Sans', bold: true, size: 22, color: { argb: 'FF475569' } } },
        ],
      };
      wordmarkCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      wordmarkCell.alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getRow(1).height = 40;

      // Row 2: Call Plan brand band (green).
      ws.mergeCells(2, 1, 2, SPAN);
      const titleCell = ws.getCell(2, 1);
      titleCell.value = 'Call Plan';
      titleCell.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(2).height = 26;

      // Row 3: Subtitle — "{Company} · Opportunity Prep"
      ws.mergeCells(3, 1, 3, SPAN);
      const subCell = ws.getCell(3, 1);
      subCell.value = `${companyName || 'Opportunity'}  ·  Opportunity Prep`;
      subCell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_MUTED } };
      subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(3).height = 20;

      // Helpers — all operate on the already-established column layout.
      const addSectionHeader = (text) => {
        const row = ws.addRow([]);
        ws.mergeCells(row.number, 1, row.number, SPAN);
        const c = ws.getCell(row.number, 1);
        c.value = text;
        c.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = borderAll;
        row.height = 24;
      };

      const addFieldRow = (label, value, hyperlink) => {
        const row = ws.addRow([]);
        // Label cell
        const labelCell = ws.getCell(row.number, 1);
        labelCell.value = label;
        labelCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
        labelCell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
        labelCell.border = borderAll;
        // Value cell (merged across remaining columns)
        ws.mergeCells(row.number, 2, row.number, SPAN);
        const valCell = ws.getCell(row.number, 2);
        const displayText = (value === '' || value == null) ? null : String(value);
        if (hyperlink) {
          // Clickable link — Excel styles it blue + underline automatically
          // from the 'hyperlink' type, but we set font explicitly for
          // consistency across viewers.
          valCell.value = { text: displayText || hyperlink, hyperlink };
          valCell.font = { name: 'Nunito Sans', size: 10, color: { argb: 'FF0A66C2' }, underline: true };
        } else {
          valCell.value = displayText;
          valCell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        }
        valCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        valCell.border = borderAll;
        // Size the row so wrapped content isn't clipped. The merged value
        // cell spans cols 2..SPAN, so we estimate wraps against the sum of
        // their widths.
        const mergedWidth = colWidths.slice(1).reduce((a, b) => a + b, 0);
        row.height = rowHeightForLines(estimateWrappedLines(value, mergedWidth));
      };

      const addBlankRow = () => { ws.addRow([]); };

      const addSubheading = (text) => {
        const row = ws.addRow([]);
        ws.mergeCells(row.number, 1, row.number, SPAN);
        const c = ws.getCell(row.number, 1);
        c.value = text;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        row.height = 18;
      };

      const addTable = (title, columns, rows, _widths /* unused */, opts = {}) => {
        addSectionHeader(title);
        const highlightRow = typeof opts.highlightRow === 'function' ? opts.highlightRow : null;
        // Distribute the SPAN worksheet columns across this table's columns
        // so the whole table fills the full page width. Columns can declare
        // a widthRatio (e.g. 0.25 for a Service column); any missing ratios
        // default to equal shares of whatever is left. Widths are then
        // rounded to whole worksheet-column slots, with any remainder going
        // to the widest column so narrow columns don't swell unexpectedly.
        const numCols = columns.length;
        const explicit = columns.map(c => (typeof c.widthRatio === 'number' ? c.widthRatio : null));
        const explicitSum = explicit.reduce((a, r) => a + (r || 0), 0);
        const unspecifiedCount = explicit.filter(r => r == null).length;
        const remainder = Math.max(0, 1 - explicitSum);
        const defaultShare = unspecifiedCount > 0 ? remainder / unspecifiedCount : 0;
        const ratios = explicit.map(r => (r == null ? defaultShare : r));
        const ratioSum = ratios.reduce((a, b) => a + b, 0) || 1;
        const widths = ratios.map(r => Math.max(1, Math.floor((r / ratioSum) * SPAN)));
        let used = widths.reduce((a, b) => a + b, 0);
        while (used > SPAN) {
          let maxIdx = 0;
          for (let i = 1; i < numCols; i++) if (widths[i] > widths[maxIdx]) maxIdx = i;
          if (widths[maxIdx] <= 1) break;
          widths[maxIdx]--;
          used--;
        }
        while (used < SPAN) {
          let maxIdx = 0;
          for (let i = 1; i < numCols; i++) if (ratios[i] > ratios[maxIdx]) maxIdx = i;
          widths[maxIdx]++;
          used++;
        }
        const slots = [];
        let cur = 1;
        for (let i = 0; i < numCols; i++) {
          const w = widths[i];
          slots.push({ start: cur, end: cur + w - 1 });
          cur += w;
        }
        const slotUnits = (slot) => {
          let u = 0;
          for (let k = slot.start - 1; k <= slot.end - 1; k++) u += colWidths[k] || 0;
          return u;
        };

        // Header row
        const hRow = ws.addRow([]);
        slots.forEach((slot, i) => {
          const c = ws.getCell(hRow.number, slot.start);
          c.value = columns[i].label;
          c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
          c.border = borderAll;
          if (slot.end > slot.start) {
            ws.mergeCells(hRow.number, slot.start, hRow.number, slot.end);
          }
        });
        hRow.height = 22;

        // Data rows
        const HL_BG = 'FFFEF3C7';   // amber-100 — highlighted (top) row fill
        const HL_TEXT = 'FF7C2D12'; // amber-900 — highlighted row text
        const dataRows = rows.length > 0 ? rows : [{}];
        dataRows.forEach((r, idx) => {
          const dRow = ws.addRow([]);
          const zebra = idx % 2 === 1;
          const isHighlight = highlightRow ? highlightRow(r) : false;
          let maxLines = 1;
          slots.forEach((slot, i) => {
            const col = columns[i];
            const raw = r[col.key];
            const c = ws.getCell(dRow.number, slot.start);
            // Agenda minutes should be a real number in the sheet, not text.
            if (col.numeric) {
              const n = (raw === '' || raw == null) ? null : Number(raw);
              c.value = (n != null && !isNaN(n)) ? n : null;
              if (col.numFmt) c.numFmt = col.numFmt;
            } else {
              // Star the highlighted row's first column so the top issue
              // reads as "★ …" while staying in the same table.
              const text = (raw === '' || raw == null) ? '' : String(raw);
              const display = (isHighlight && i === 0) ? `★ ${text}`.trim() : text;
              c.value = display === '' ? null : display;
            }
            c.font = { name: 'Nunito Sans', size: 10, bold: isHighlight, color: { argb: isHighlight ? HL_TEXT : SE_TEXT_DARK } };
            c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
            c.border = borderAll;
            if (isHighlight) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HL_BG } };
            else if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
            if (slot.end > slot.start) {
              ws.mergeCells(dRow.number, slot.start, dRow.number, slot.end);
            }
            const measure = (isHighlight && i === 0 && (raw != null && raw !== '')) ? `★ ${raw}` : raw;
            maxLines = Math.max(maxLines, estimateWrappedLines(measure, slotUnits(slot)));
          });
          dRow.height = rowHeightForLines(maxLines);
        });
      };

      // --- Company Background (from saved Claude research) -------------
      // Surfaces the prospect's Claude research at the very top of the
      // export. Sources are intentionally omitted; Summary, Programs,
      // Targets, Frameworks, and Reports (with clickable URLs) are
      // included. Skipped entirely when no research has been run yet.
      if (companyBackground) {
        const d = companyBackground;
        const hasSummary = typeof d.summary === 'string' && d.summary.trim().length > 0;
        const hasPrograms = Array.isArray(d.programs) && d.programs.length > 0;
        const hasTargets = Array.isArray(d.targets) && d.targets.length > 0;
        const hasFrameworks = Array.isArray(d.frameworks) && d.frameworks.length > 0;
        const hasReports = Array.isArray(d.reports) && d.reports.length > 0;
        if (hasSummary || hasPrograms || hasTargets || hasFrameworks || hasReports) {
          addBlankRow();
          addSectionHeader('Company Background');
          if (hasSummary) addFieldRow('Summary', d.summary.trim());
          if (hasPrograms) addFieldRow('Programs', d.programs.map(p => `• ${p}`).join('\n'));
          if (hasTargets) addFieldRow('Targets', d.targets.map(t => `• ${t}`).join('\n'));
          if (hasFrameworks) addFieldRow('Frameworks', d.frameworks.join(', '));
          if (hasReports) {
            for (const r of d.reports) {
              const title = r?.title || r?.url || '';
              const year = r?.year ? ` (${r.year})` : '';
              addFieldRow('Report', `${title}${year}`, r?.url || undefined);
            }
          }
        }
      }

      // --- Meeting (imported from .ics) --------------------------------
      if (formData.meeting) {
        addBlankRow();
        addSectionHeader('Meeting');
        addFieldRow('Subject', formData.meeting.subject || '');
        addFieldRow('When', formatDateTime(formData.meeting.start));
        addFieldRow('Ends', formatDateTime(formData.meeting.end));
        if (formData.meeting.sourceTimeZone) {
          addFieldRow('Original TZ', formData.meeting.sourceTimeZone);
        }
        const mins = formData.meeting.durationMinutes;
        if (mins != null) {
          const h = Math.floor(mins / 60), m = mins % 60;
          addFieldRow('Duration', m === 0 ? `${h}h` : h === 0 ? `${m} min` : `${h}h ${m}m`);
        }
        if (formData.meeting.location) addFieldRow('Location', formData.meeting.location);

        // Side-by-side attendee tables mirroring the on-screen form. SE
        // uses cols 1-4 (Name, Required, Dan's Ask, filler); col 5 is the
        // gap; Customer uses cols 6-10 (Name, Required, Title, City/Country,
        // Notes).
        addSectionHeader('Attendees');

        // Company sub-headers row
        const sbRow = ws.addRow([]);
        ws.mergeCells(sbRow.number, 1, sbRow.number, 4);
        ws.mergeCells(sbRow.number, 6, sbRow.number, 10);
        const seHead = ws.getCell(sbRow.number, 1);
        seHead.value = 'Schneider Electric';
        seHead.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
        seHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        const custHead = ws.getCell(sbRow.number, 6);
        custHead.value = companyName || 'Customer';
        custHead.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
        custHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        sbRow.height = 20;

        // Column headers row
        const seColLabels = ['Name', 'Required?', "Dan's Ask", ''];
        const custColLabels = ['Name', 'Reports to', 'Title', 'City, Country', 'Notes'];
        const hdrRow = ws.addRow([]);
        const styleHeader = (cell, text, filled) => {
          cell.value = text;
          if (filled) {
            cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
          }
          cell.border = borderAll;
        };
        for (let c = 0; c < 4; c++) styleHeader(hdrRow.getCell(c + 1), seColLabels[c], c < 3);
        // Merge the Dan's Ask header cell across cols 3-4 so it spans the
        // same width as the data cells below.
        ws.mergeCells(hdrRow.number, 3, hdrRow.number, 4);
        for (let c = 0; c < 5; c++) styleHeader(hdrRow.getCell(c + 6), custColLabels[c], true);
        hdrRow.height = 22;

        const dansAskMap = dansAsks || {};
        const maxAttendeeRows = Math.max(seAttendees.length, customerAttendees.length, 1);
        for (let i = 0; i < maxAttendeeRows; i++) {
          const dRow = ws.addRow([]);
          const zebra = i % 2 === 1;
          let maxLines = 1;

          // Helper: normalize a LinkedIn URL from any of the three props
          // HubSpot uses for it. Adds https:// prefix if missing.
          const liUrlFor = (att) => {
            const raw = (att?.match?.hs_linkedin_url || att?.match?.linkedin_url || att?.match?.hs_linkedinid || '').trim();
            if (!raw) return '';
            return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
          };

          const se = seAttendees[i];
          const seVals = se
            ? [
                displayAttendeeName(se, contactNicknames),
                se.required ? 'Required' : 'Optional',
                dansAskMap[dansAskKey(se)] || '',
                '',
              ]
            : ['', '', '', ''];
          const seLink = liUrlFor(se);
          for (let c = 0; c < 4; c++) {
            const cell = dRow.getCell(c + 1);
            // Column 0 is Name — hyperlink to LinkedIn when we have it.
            if (c === 0 && seLink && seVals[0]) {
              cell.value = { text: seVals[0], hyperlink: seLink };
              cell.font = { name: 'Nunito Sans', size: 10, color: { argb: 'FF0A66C2' }, underline: true };
            } else {
              cell.value = seVals[c];
              cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            }
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            cell.border = borderAll;
            if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
            if (c < 3) maxLines = Math.max(maxLines, estimateWrappedLines(seVals[c], colWidths[c]));
          }
          // Merge Dan's Ask (col 3) with the empty col 4 so the field has
          // more horizontal room for longer text and matches the visual
          // weight of the customer-side Notes column.
          ws.mergeCells(dRow.number, 3, dRow.number, 4);
          // Re-estimate Dan's Ask wrap against the merged width.
          maxLines = Math.max(
            maxLines,
            estimateWrappedLines(seVals[2], (colWidths[2] || 0) + (colWidths[3] || 0))
          );

          const cust = customerAttendees[i];
          let custVals;
          if (cust) {
            const city = (cust.match?.city || '').trim();
            const country = (cust.match?.country || '').trim();
            const noteSrc = (cust.match?.id && contactNotes[cust.match.id]) || cust.match?.notes || cust.match?.hs_content_membership_notes || cust.match?.message || '';
            // Resolve Reports to: contactReportsTo[id] holds an array of
            // manager contact ids; map each to its display name from the
            // hubspot pool. Falls back to '' if not matched or unknown.
            const mgrIds = (cust.match?.id && Array.isArray(contactReportsTo[cust.match.id]))
              ? contactReportsTo[cust.match.id]
              : [];
            const pool = (allHubspotContacts && allHubspotContacts.length > 0) ? allHubspotContacts : companyContacts;
            const byId = new Map();
            for (const c of pool) {
              const id = c.id || c.vid;
              if (id) byId.set(String(id), c);
            }
            const reportsToText = mgrIds
              .map(id => {
                const m = byId.get(String(id));
                if (!m) return '';
                const fn = (m.firstname || '').trim();
                const ln = (m.lastname || '').trim();
                return [fn, ln].filter(Boolean).join(' ') || (m.email || '');
              })
              .filter(Boolean)
              .join(', ');
            custVals = [
              displayAttendeeName(cust, contactNicknames),
              reportsToText,
              cust.match?.jobtitle || '',
              [city, country].filter(Boolean).join(', '),
              noteSrc,
            ];
          } else {
            custVals = ['', '', '', '', ''];
          }
          const custLink = liUrlFor(cust);
          for (let c = 0; c < 5; c++) {
            const cell = dRow.getCell(c + 6);
            // Column 0 of the customer block is Name — hyperlink to LinkedIn when we have it.
            if (c === 0 && custLink && custVals[0]) {
              cell.value = { text: custVals[0], hyperlink: custLink };
              cell.font = { name: 'Nunito Sans', size: 10, color: { argb: 'FF0A66C2' }, underline: true };
            } else {
              cell.value = custVals[c];
              cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            }
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            cell.border = borderAll;
            if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
            maxLines = Math.max(maxLines, estimateWrappedLines(custVals[c], colWidths[c + 5]));
          }

          dRow.height = rowHeightForLines(maxLines);
        }
      }

      // --- Meeting Prep (free-form) -----------------------------------
      addBlankRow();
      addSectionHeader('Meeting Prep');
      {
        const raw = (formData.fieldValues.pptLink || '').trim();
        const href = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : '';
        addFieldRow('PPT Link', raw, href);
      }
      // Call Context can be long — when a single cell exceeds Excel's
      // per-row height limit (~409 pt) the trailing lines clip and the
      // user has to expand the row by hand to see them. Render it as a
      // subheading + one row per paragraph so each row stays well under
      // the cap and the full text is visible by default.
      {
        const ctx = String(formData.fieldValues.context || '').trim();
        if (ctx) {
          addSubheading('Call Context');
          const fullWidth = colWidths.reduce((a, b) => a + b, 0);
          const paragraphs = ctx.split(/\n{2,}/);
          for (const para of paragraphs) {
            const text = para.replace(/\s+$/g, '');
            if (!text) continue;
            const row = ws.addRow([]);
            ws.mergeCells(row.number, 1, row.number, SPAN);
            const c = ws.getCell(row.number, 1);
            c.value = text;
            c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
            c.border = borderAll;
            row.height = rowHeightForLines(estimateWrappedLines(text, fullWidth));
          }
        } else {
          addFieldRow('Call Context', '');
        }
      }
      addFieldRow('Intent', formData.fieldValues.intent || '');
      addFieldRow('End In Mind', formData.fieldValues.endInMind || '');

      // --- Details (structured fields) --------------------------------
      // "General Notes" and "Scoping Details Notes" are explicitly
      // excluded from the export — they're surfaced inside the Notes
      // page UI but the user doesn't want them duplicated into the
      // structured Details block of the workbook.
      const DETAILS_EXPORT_SKIP = new Set(['summary', 'scopingNotes']);
      addBlankRow();
      addSectionHeader('Details');
      for (const f of template.fields) {
        if (DETAILS_EXPORT_SKIP.has(f.key)) continue;
        if (f.showWhenStatus && formData.fieldValues.status !== f.showWhenStatus) continue;
        const raw = (formData.fieldValues[f.key] || '').trim ? (formData.fieldValues[f.key] || '').trim() : (formData.fieldValues[f.key] || '');
        if (f.isLink && raw) {
          const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
          addFieldRow(f.label, raw, href);
        } else {
          addFieldRow(f.label, raw);
        }
      }

      // --- Tables (Agenda, Questions, Action Items, Risks) ------------
      for (const t of template.tables) {
        addBlankRow();
        const widths = colWidths.slice(0, t.columns.length);
        let tableRows = formData.tables[t.key] || [];
        // For the Smart Agenda, backfill each row's Start Time from the
        // meeting's start + the sum of prior durations so the exported
        // sheet shows real clock times instead of blanks.
        if (t.smartAgenda && meetingStartIso) {
          let priorSum = 0;
          tableRows = tableRows.map((r) => {
            const out = { ...r };
            try {
              const d = new Date(meetingStartIso);
              d.setMinutes(d.getMinutes() + priorSum);
              out.startTime = formatEasternTime(d.toISOString());
            } catch {}
            priorSum += Number(r?.duration) || 0;
            return out;
          });
        }
        // Key Issues: keep the starred "top issue" inside the Key Issues
        // table rather than lifting it into a separate callout above.
        // Float it to the first row and flag it so addTable renders it
        // with the amber highlight / ★ styling — same table, different
        // formatting.
        let addTableOpts;
        if (t.key === 'meetingNotes') {
          const starred = tableRows.find(r => r?.starred);
          if (starred) {
            tableRows = [starred, ...tableRows.filter(r => r !== starred)];
            addTableOpts = { highlightRow: (r) => r === starred };
          }
        }
        addTable(t.label, t.columns, tableRows, widths, addTableOpts);
        // Restore defaults for next block
        colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      }

      // Frame the whole document with a medium SE-green outer border.
      // Gridlines are already off (view.showGridLines = false), so this
      // border is what visually defines where the sheet ends; we preserve
      // each cell's existing thin internal borders and only override the
      // perimeter side(s).
      {
        const outer = { style: 'medium', color: { argb: SE_GREEN_DARK } };
        const lastRow = ws.rowCount;
        for (let r = 1; r <= lastRow; r++) {
          for (let c = 1; c <= SPAN; c++) {
            if (r !== 1 && r !== lastRow && c !== 1 && c !== SPAN) continue;
            const cell = ws.getCell(r, c);
            const b = { ...(cell.border || {}) };
            if (r === 1) b.top = outer;
            if (r === lastRow) b.bottom = outer;
            if (c === 1) b.left = outer;
            if (c === SPAN) b.right = outer;
            cell.border = b;
          }
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const safeCompany = (companyName || 'Opportunity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeCompany} - Opportunity.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Failed to export: ' + (err.message || err));
    }
  };

  // Simple styles inlined so this drops into ProspectModal without a new CSS file.
  const sx = {
    wrap: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
    toolbar: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
    btn: { fontSize: '0.72rem', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
    primaryBtn: { fontSize: '0.72rem', padding: '0.3rem 0.6rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
    fieldLabel: { fontSize: '0.68rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.2rem' },
    input: { width: '100%', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem' },
    textarea: { width: '100%', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem', minHeight: '60px', resize: 'vertical' },
    sectionTitle: { fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', margin: '0.75rem 0 0.35rem' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
    th: { textAlign: 'left', padding: '0.35rem 0.5rem', background: '#F1F5F9', fontWeight: 600, fontSize: '0.7rem', color: '#64748B', border: '1px solid var(--color-border-light)' },
    td: { padding: 0, border: '1px solid var(--color-border-light)', verticalAlign: 'top' },
    cellInput: { width: '100%', border: 'none', padding: '0.4rem 0.5rem', fontFamily: 'inherit', fontSize: '0.82rem', background: 'transparent' },
    rowBtn: { background: 'transparent', border: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer' },
    picker: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginTop: 4, maxHeight: 320, overflow: 'auto' },
    pickerItem: { padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer' },
  };

  return (
    <div style={sx.wrap}>
      <div style={sx.toolbar}>
        <div style={{ position: 'relative' }}>
          <button type="button" style={sx.btn} onClick={() => setPickerOpen(o => !o)}>
            {formData.linkedBfoLink ? 'Change linked opportunity' : 'Link opportunity'}
          </button>
          {pickerOpen && (
            <div style={sx.picker}>
              <div style={{ padding: '0.4rem' }}>
                <input
                  style={sx.input}
                  autoFocus
                  placeholder="Search by Account, Contact, BFO Opportunity Name, Scope, Stage…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {cache == null ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>Loading opps cache…</div>
              ) : !cache.records?.length ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>
                  No opps cached. Open the Opps tab once to populate the cache.
                </div>
              ) : results.length === 0 ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>No matches.</div>
              ) : results.map((r, i) => (
                <div
                  key={r._id || i}
                  style={sx.pickerItem}
                  onClick={() => linkOpp(r)}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{r['Account'] || '(no account)'}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    {[r['Contact'], r['Stage'], r['Scope']].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>BFO Opp: {r['BFO Link'] || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {formData.linkedBfoLink && (
          <>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Linked:{' '}
              <a
                href={formData.linkedBfoLink}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in BFO"
                style={{ color: '#0A66C2', fontWeight: 600, textDecoration: 'none' }}
              >{formData.linkedOppName || 'Open in BFO'}</a>
            </span>
            <button type="button" style={sx.btn} onClick={unlinkOpp}>Unlink</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" style={sx.primaryBtn} onClick={exportExcel}>Export Excel</button>
      </div>

      {!formData.linkedBfoLink && suggestedOpps.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          flexWrap: 'wrap',
          fontSize: '0.72rem',
          background: '#F8FAFC',
          border: '1px solid var(--color-border-light)',
          borderRadius: 6,
          padding: '0.45rem 0.6rem',
        }}>
          <span style={{ color: '#475569', fontWeight: 600 }}>
            Open opps for {companyName}:
          </span>
          {suggestedOpps.map((opp, i) => {
            const stage = String(opp['Stage'] || '').trim();
            const scope = String(opp['Scope'] || '').trim();
            const label = [stage, scope].filter(Boolean).join(' · ') || (opp['Account'] || 'Untitled');
            return (
              <button
                key={opp._id || i}
                type="button"
                onClick={() => linkOpp(opp)}
                title={`Link ${opp['Account'] || ''}${stage ? ' — ' + stage : ''}${scope ? ' · ' + scope : ''}`}
                style={{
                  padding: '0.25rem 0.6rem',
                  border: '1px solid #93C5FD',
                  background: '#EFF6FF',
                  color: '#1D4ED8',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  maxWidth: 280,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title="Search all opportunities"
            style={{
              padding: '0.25rem 0.6rem',
              border: '1px dashed var(--color-border)',
              background: '#fff',
              color: '#475569',
              borderRadius: 999,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            Search…
          </button>
        </div>
      )}

      {/* Meeting drop zone — drag an Outlook .ics file in to auto-fill */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingMeeting(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingMeeting(false); }}
        onDrop={handleMeetingDrop}
        onClick={formData.meeting ? undefined : () => fileInputRef.current?.click()}
        style={{
          border: isDraggingMeeting ? '3px dashed #009530' : '3px dashed #3DCD58',
          background: isDraggingMeeting ? '#DCFCE7' : '#F0FDF4',
          borderRadius: 10,
          padding: formData.meeting ? '0.75rem 1rem' : '1.5rem 1rem',
          textAlign: formData.meeting ? 'left' : 'center',
          fontSize: '0.85rem',
          color: '#1E293B',
          cursor: formData.meeting ? 'default' : 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,.msg,text/calendar,application/vnd.ms-outlook"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestMeetingFile(f); e.target.value = ''; }}
        />
        {!formData.meeting && (
          <>
            <div style={{ fontWeight: 700, color: '#15803D', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
              {isDraggingMeeting ? 'Drop to import' : 'Drag a meeting from Outlook (or a saved .ics) here'}
            </div>
            <div style={{ color: '#475569', marginBottom: '0.6rem' }}>
              Tries to pull subject, time, location, and attendees from whatever Outlook puts in the drag.
              For full attendee/time fidelity, save the meeting as .ics first (File → Save As → Calendar Format) and drop the file.
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              style={{
                fontSize: '0.8rem', padding: '0.4rem 0.9rem', border: 'none',
                background: '#009530', color: '#fff', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              Choose .ics or .msg file…
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                set({ meeting: { subject: '', start: null, end: null, durationMinutes: null, location: '', organizer: null, attendees: [], manualAttendees: [] } });
              }}
              style={{
                marginLeft: '0.5rem',
                fontSize: '0.8rem', padding: '0.4rem 0.9rem', border: '1px solid #CBD5E1',
                background: '#fff', color: '#475569', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              Add attendees manually
            </button>
          </>
        )}
        {formData.meeting && (
          <div onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, color: '#1E293B', fontSize: '0.88rem' }}>
                {formData.meeting.subject || '(no subject)'}
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" style={sx.btn} onClick={() => fileInputRef.current?.click()}>
                Replace
              </button>
              <button type="button" style={sx.btn} onClick={clearMeeting}>Clear</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem 0.75rem', fontSize: '0.78rem', color: '#475569', marginBottom: '0.5rem' }}>
              <div><strong>When:</strong> {formatDateTime(formData.meeting.start) || '—'}</div>
              <div><strong>Duration:</strong> {formatDuration(formData.meeting.durationMinutes) || '—'}</div>
              <div><strong>Ends:</strong> {formatDateTime(formData.meeting.end) || '—'}</div>
              <div><strong>Location:</strong> {formData.meeting.location || '—'}</div>
              {formData.meeting.sourceTimeZone && (
                <div style={{ gridColumn: 'span 2', fontSize: '0.72rem', color: '#64748B', fontStyle: 'italic' }}>
                  Original timezone: {formData.meeting.sourceTimeZone}. Times shown above are in Eastern (America/New_York).
                </div>
              )}
              {formData.meeting.organizer && (
                <div style={{ gridColumn: 'span 2' }}>
                  <strong>Organizer:</strong> {formData.meeting.organizer.name}
                  {formData.meeting.organizer.email ? ` <${formData.meeting.organizer.email}>` : ''}
                </div>
              )}
            </div>
            {totalAttendees > 0 && (() => {
              const GRID_COLS = 'auto minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1.4fr) auto';
              // Detect reporting lines *within* the customer attendee list:
              // build an id→attendee map of the customer attendees, then for
              // any attendee return the names of their managers who are also
              // on the list. Lets us flag "reports to X" right on the row.
              const custAttendeeById = new Map();
              for (const a of customerAttendees) {
                const id = a.match?.id || a.match?.vid;
                if (id) custAttendeeById.set(String(id), a);
              }
              const managersAmongAttendees = (a) => {
                const id = a.match?.id || a.match?.vid;
                if (!id) return [];
                const mgrIds = Array.isArray(contactReportsTo[id]) ? contactReportsTo[id] : [];
                const out = [];
                for (const mid of mgrIds) {
                  const mgr = custAttendeeById.get(String(mid));
                  if (mgr) out.push(displayAttendeeName(mgr, contactNicknames));
                }
                return out;
              };
              const attendeeId = (a) => { const id = a?.match?.id || a?.match?.vid; return id ? String(id) : null; };
              // Reorder a bucket so managers sit above their reports, with
              // each report nested (indented) under its manager. Hierarchy
              // is scoped to the bucket: only a manager present in the same
              // bucket pulls a report beneath them. Returns [{ attendee,
              // depth }]; roots keep their existing order.
              const orderByHierarchy = (members) => {
                const ids = new Set(members.map(attendeeId).filter(Boolean));
                const childrenByMgr = new Map();
                const hasMgrInBucket = new Set();
                for (const a of members) {
                  const id = attendeeId(a);
                  const mgrIds = (id && Array.isArray(contactReportsTo[id])) ? contactReportsTo[id].map(String) : [];
                  const mgr = mgrIds.find(m => m !== id && ids.has(m));
                  if (mgr) {
                    hasMgrInBucket.add(a);
                    if (!childrenByMgr.has(mgr)) childrenByMgr.set(mgr, []);
                    childrenByMgr.get(mgr).push(a);
                  }
                }
                const out = [];
                const visited = new Set();
                const visit = (a, depth) => {
                  if (visited.has(a)) return; // cycle / dupe guard
                  visited.add(a);
                  out.push({ attendee: a, depth });
                  const id = attendeeId(a);
                  for (const kid of (id ? childrenByMgr.get(id) || [] : [])) visit(kid, depth + 1);
                };
                for (const a of members) if (!hasMgrInBucket.has(a)) visit(a, 0);
                for (const a of members) if (!visited.has(a)) visit(a, 0); // safety net
                return out;
              };
              const renderAttendee = (a, i) => {
                const matched = !!a.match;
                const rawSummary = a.rawParams
                  ? Object.entries(a.rawParams).map(([k, v]) => `${k}=${v}`).join('; ')
                  : '';
                const tooltip = `${a.email}${a.role ? ' · ROLE=' + a.role : ''}${rawSummary ? ' · ' + rawSummary : ''}`;
                const title = a.match?.jobtitle || '';
                const company = (a.match?.company || '').trim();
                const contactId = a.match?.id || a.match?.vid;
                const contactNote = (contactId && contactNotes[contactId])
                  || a.match?.notes
                  || a.match?.hs_content_membership_notes
                  || a.match?.message
                  || '';
                const linkedinUrl = a.match?.hs_linkedin_url || a.match?.linkedin_url || a.match?.hs_linkedinid || '';
                const city = (a.match?.city || '').trim();
                const country = (a.match?.country || '').trim();
                const cityCountry = [city, country].filter(Boolean).join(', ');
                const wrap = { overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
                return (
                  <div
                    key={i}
                    title={tooltip}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID_COLS,
                      columnGap: '0.5rem',
                      alignItems: 'start',
                      padding: '0.4rem 0.5rem',
                      background: matched ? '#F0FDF4' : '#FEF2F2',
                      border: '1px solid',
                      borderColor: matched ? '#BBF7D0' : '#FECACA',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: matched ? '#15803D' : '#B91C1C', fontWeight: 700, fontSize: '0.9rem', paddingTop: 2 }}>{matched ? '✓' : '✗'}</span>
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      {matched && onOpenContact ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenContact(a.match); }}
                          style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontWeight: 600, fontSize: '0.8rem', color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', textAlign: 'left', ...wrap }}
                          title="Open HubSpot contact details"
                        >
                          {displayAttendeeName(a, contactNicknames)}
                        </button>
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#1E293B', ...wrap }}>
                          {displayAttendeeName(a, contactNicknames)}
                        </span>
                      )}
                      {linkedinUrl && (
                        <a
                          href={linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: '0.7rem', color: '#0A66C2', textDecoration: 'none', fontWeight: 700 }}
                          title="Open LinkedIn profile"
                        >in↗</a>
                      )}
                      {(() => {
                        const mgrs = managersAmongAttendees(a);
                        if (mgrs.length === 0) return null;
                        return (
                          <span
                            style={{ flexBasis: '100%', fontSize: '0.68rem', color: '#0F766E', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            title={`Reports to ${mgrs.join(', ')} — also on this attendee list`}
                          >
                            <span aria-hidden="true">↳</span> Reports to {mgrs.join(', ')}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#475569', paddingTop: 3, ...wrap }}>
                      {company || <span style={{ color: '#94A3B8' }}>—</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#475569', paddingTop: 3, ...wrap }}>
                      {title || <span style={{ fontStyle: 'italic', color: '#94A3B8' }}>{matched ? '—' : 'not in HubSpot'}</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#475569', paddingTop: 3, ...wrap }}>
                      {cityCountry || <span style={{ color: '#94A3B8' }}>—</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#334155', paddingTop: 3, ...wrap }}>
                      {contactNote || <span style={{ color: '#94A3B8' }}>—</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      {!matched && a.email && onCreateContact && (
                        <button
                          type="button"
                          style={sx.btn}
                          disabled={creatingEmail === a.email}
                          onClick={() => handleCreateAttendeeContact(a)}
                        >
                          {creatingEmail === a.email ? 'Adding…' : 'Add to HubSpot'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttendee(a)}
                        title="Remove attendee"
                        style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }}
                      >×</button>
                    </div>
                  </div>
                );
              };
              const countLine = (list) => {
                const req = list.filter(a => a.required).length;
                const opt = list.length - req;
                if (opt === 0) return `${list.length} required`;
                if (req === 0) return `${list.length} optional`;
                return `${req} required · ${opt} optional`;
              };
              const columnHeader = (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLS,
                  columnGap: '0.5rem',
                  padding: '0 0.5rem 0.25rem',
                  fontSize: '0.62rem', fontWeight: 700,
                  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <span style={{ width: 12 }} />
                  <span>Name</span>
                  <span>Company</span>
                  <span>Title</span>
                  <span>City, Country</span>
                  <span>Notes</span>
                  <span />
                </div>
              );
              // Dedicated renderer for Schneider Electric attendees: drag
              // handle + matched check + name + Required/Optional toggle
              // + free-text "Dan's Ask" column + remove button.
              const SE_GRID = 'auto auto minmax(0, 1fr) auto minmax(0, 2fr) auto';
              const seColumnHeader = (
                <div style={{
                  display: 'grid', gridTemplateColumns: SE_GRID, columnGap: '0.5rem',
                  padding: '0 0.5rem 0.25rem',
                  fontSize: '0.62rem', fontWeight: 700,
                  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <span style={{ width: 12 }} />
                  <span style={{ width: 12 }} />
                  <span>Name</span>
                  <span>R/O</span>
                  <span>Dan&apos;s Ask</span>
                  <span />
                </div>
              );
              const seKey = (a) => (a.email || '').toLowerCase().trim() || `name:${(a.name || '').toLowerCase().trim()}`;
              const renderSeAttendee = (a, displayIdx) => {
                const matched = !!a.match;
                const linkedinUrl = a.match?.hs_linkedin_url || a.match?.linkedin_url || a.match?.hs_linkedinid || '';
                const rawSummary = a.rawParams
                  ? Object.entries(a.rawParams).map(([k, v]) => `${k}=${v}`).join('; ')
                  : '';
                const tooltip = `${a.email}${a.role ? ' · ROLE=' + a.role : ''}${rawSummary ? ' · ' + rawSummary : ''}`;
                const ask = dansAsks[dansAskKey(a)] || '';
                const wrap = { overflowWrap: 'anywhere', wordBreak: 'break-word' };
                const myKey = seKey(a);
                const isDragging = seDragKey === myKey;
                const isDragOver = seDragOverIdx === displayIdx && seDragKey && seDragKey !== myKey;
                return (
                  <div
                    key={myKey}
                    title={tooltip}
                    draggable
                    onDragStart={(e) => {
                      setSeDragKey(myKey);
                      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', myKey); } catch {}
                    }}
                    onDragEnd={() => { setSeDragKey(null); setSeDragOverIdx(null); }}
                    onDragOver={(e) => {
                      if (!seDragKey || seDragKey === myKey) return;
                      e.preventDefault();
                      try { e.dataTransfer.dropEffect = 'move'; } catch {}
                      if (seDragOverIdx !== displayIdx) setSeDragOverIdx(displayIdx);
                    }}
                    onDragLeave={() => { if (seDragOverIdx === displayIdx) setSeDragOverIdx(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!seDragKey || seDragKey === myKey) { setSeDragKey(null); setSeDragOverIdx(null); return; }
                      const fromIdx = seAttendees.findIndex(x => seKey(x) === seDragKey);
                      if (fromIdx < 0) { setSeDragKey(null); setSeDragOverIdx(null); return; }
                      const dragged = seAttendees[fromIdx];
                      // If the drop target sits in a different required
                      // bucket than the dragged item, flip the dragged
                      // attendee's required flag to match before reordering.
                      if (!!dragged.required !== !!a.required) {
                        setAttendeeRequired(dragged, !!a.required);
                      }
                      reorderAttendees(seAttendees, fromIdx, displayIdx);
                      setSeDragKey(null);
                      setSeDragOverIdx(null);
                    }}
                    style={{
                      display: 'grid', gridTemplateColumns: SE_GRID, columnGap: '0.5rem',
                      alignItems: 'center',
                      padding: '0.4rem 0.5rem',
                      background: matched ? '#F0FDF4' : '#FEF2F2',
                      border: '1px solid', borderColor: isDragOver ? '#2563EB' : (matched ? '#BBF7D0' : '#FECACA'),
                      borderRadius: 4,
                      opacity: isDragging ? 0.5 : 1,
                      cursor: 'grab',
                    }}
                  >
                    <span title="Drag to reorder or move between Required / Optional" style={{ color: '#94A3B8', cursor: 'grab', userSelect: 'none', fontSize: '0.85rem' }}>⋮⋮</span>
                    <span style={{ color: matched ? '#15803D' : '#B91C1C', fontWeight: 700, fontSize: '0.9rem' }}>{matched ? '✓' : '✗'}</span>
                    <div style={{ minWidth: 0 }}>
                      {linkedinUrl ? (
                        <a
                          href={linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0A66C2', textDecoration: 'none', ...wrap }}
                          title="Open LinkedIn profile"
                        >
                          {displayAttendeeName(a, contactNicknames)}
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#1E293B', ...wrap }}>
                          {displayAttendeeName(a, contactNicknames)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttendeeRequired(a, !a.required)}
                      title={a.required ? 'Click to mark as Optional' : 'Click to mark as Required'}
                      style={{
                        padding: '2px 8px',
                        fontSize: '0.6rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        border: '1px solid',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        color: a.required ? '#B91C1C' : '#3730A3',
                        background: a.required ? '#FEE2E2' : '#E0E7FF',
                        borderColor: a.required ? '#FCA5A5' : '#A5B4FC',
                      }}
                    >{a.required ? 'Required' : 'Optional'}</button>
                    <CommitOnBlurInput
                      multiline
                      autoGrow
                      value={ask}
                      onCommit={v => updateDansAsk(a, v)}
                      rows={1}
                      placeholder="What do you want to ask / bring up with them?"
                      style={{
                        width: '100%',
                        fontSize: '0.72rem',
                        padding: '0.25rem 0.4rem',
                        border: '1px solid #CBD5E1',
                        borderRadius: 3,
                        fontFamily: 'inherit',
                        background: '#fff',
                        resize: 'vertical',
                        minHeight: '1.6rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeAttendee(a)}
                      title="Remove attendee"
                      style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', padding: '0 0.35rem', lineHeight: 1 }}
                    >×</button>
                  </div>
                );
              };
              const renderSeGrouped = (list) => {
                // Indices need to be global within `list` so drag-drop
                // reorder maps positions back into the same array we
                // pass to reorderAttendees.
                const idxOf = new Map();
                list.forEach((x, i) => idxOf.set(x, i));
                const req = list.filter(a => a.required);
                const opt = list.filter(a => !a.required);
                // Drop zone for the Required / Optional sub-headers — lets
                // the user move an attendee across buckets even when the
                // target bucket is empty or they want to drop "above all".
                const subHeader = (label, count, color, bg, targetRequired) => (
                  <div
                    onDragOver={(e) => {
                      if (!seDragKey) return;
                      e.preventDefault();
                      try { e.dataTransfer.dropEffect = 'move'; } catch {}
                    }}
                    onDrop={(e) => {
                      if (!seDragKey) return;
                      e.preventDefault();
                      const fromIdx = list.findIndex(x => seKey(x) === seDragKey);
                      if (fromIdx < 0) { setSeDragKey(null); setSeDragOverIdx(null); return; }
                      const dragged = list[fromIdx];
                      if (!!dragged.required !== !!targetRequired) {
                        setAttendeeRequired(dragged, !!targetRequired);
                      }
                      // Drop on a section header → put the dragged item
                      // at the top of that section. Find the first index
                      // currently in the target bucket; insert there.
                      let toIdx;
                      if (targetRequired) {
                        toIdx = 0;
                      } else {
                        const firstOpt = list.findIndex(x => !x.required);
                        toIdx = firstOpt < 0 ? list.length - 1 : firstOpt;
                      }
                      reorderAttendees(list, fromIdx, toIdx);
                      setSeDragKey(null);
                      setSeDragOverIdx(null);
                    }}
                    style={{
                      marginTop: '0.35rem', marginBottom: '0.25rem',
                      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color, background: bg, padding: '2px 8px', borderRadius: 4,
                      display: 'inline-block',
                      border: seDragKey ? '1px dashed #2563EB' : '1px solid transparent',
                    }}
                    title={seDragKey ? `Drop here to mark as ${label}` : undefined}
                  >{label} · {count}</div>
                );
                return (
                  <div>
                    {seColumnHeader}
                    {(req.length > 0 || seDragKey) && (<>
                      {subHeader('Required', req.length, '#B91C1C', '#FEE2E2', true)}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {req.map(a => renderSeAttendee(a, idxOf.get(a)))}
                      </div>
                    </>)}
                    {(opt.length > 0 || seDragKey) && (<>
                      {subHeader('Optional', opt.length, '#3730A3', '#E0E7FF', false)}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {opt.map(a => renderSeAttendee(a, idxOf.get(a)))}
                      </div>
                    </>)}
                  </div>
                );
              };
              const customerGroups = Array.isArray(formData.meeting?.customerGroups)
                ? formData.meeting.customerGroups
                : [];
              const custKey = (a) => (a.email || '').toLowerCase() || (a.name || '');
              // Make a customer attendee row draggable so it can be
              // moved between custom groups / Required / Optional. The
              // drop targets sit on the section headers.
              const renderCustomerAttendee = (a, depth = 0) => {
                const myKey = custKey(a);
                return (
                  <div
                    key={myKey || JSON.stringify(a)}
                    draggable
                    onDragStart={() => setCustDragKey(myKey)}
                    onDragEnd={() => setCustDragKey(null)}
                    style={{
                      opacity: custDragKey === myKey ? 0.5 : 1,
                      cursor: 'grab',
                      // Nest reports under their manager: indent + a left
                      // rail echoing the Org Chart's connector styling.
                      marginLeft: depth ? depth * 18 : 0,
                      paddingLeft: depth ? 8 : 0,
                      borderLeft: depth ? '2px solid #CBD5E1' : undefined,
                    }}
                  >
                    {renderAttendee(a)}
                  </div>
                );
              };
              const dropOnGroupHeader = (e, targetGroup, targetRequired) => {
                if (!custDragKey) return;
                e.preventDefault();
                const all = [...customerAttendees];
                const dragged = all.find(x => custKey(x) === custDragKey);
                if (!dragged) { setCustDragKey(null); return; }
                setAttendeeCustomGroup(dragged, targetGroup || '', targetRequired);
                setCustDragKey(null);
              };
              const groupHeader = (label, count, color, bg, opts = {}) => (
                <div
                  onDragOver={(e) => { if (custDragKey) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ } } }}
                  onDrop={(e) => dropOnGroupHeader(e, opts.targetGroup ?? '', opts.targetRequired)}
                  style={{
                    marginTop: '0.35rem', marginBottom: '0.25rem',
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color, background: bg, padding: '2px 8px', borderRadius: 4,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    border: custDragKey ? '1px dashed #2563EB' : '1px solid transparent',
                  }}
                  title={custDragKey ? `Drop here to move into "${label}"` : undefined}
                >
                  <span>{label} · {count}</span>
                  {opts.onRemove && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); opts.onRemove(); }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color, fontWeight: 700, fontSize: '0.75rem', lineHeight: 1, padding: 0 }}
                      title={`Remove the "${label}" group`}
                    >×</button>
                  )}
                </div>
              );
              const renderGroupedList = (list) => {
                // Custom groups first (in user-defined order), then
                // Required / Optional as the fallback buckets for
                // attendees with no custom group.
                const byGroupKey = new Map(); // lowerCase -> list
                for (const g of customerGroups) byGroupKey.set(g.toLowerCase(), []);
                const ungrouped = [];
                for (const a of list) {
                  const g = (a.group || '').trim();
                  if (g && byGroupKey.has(g.toLowerCase())) {
                    byGroupKey.get(g.toLowerCase()).push(a);
                  } else if (g) {
                    // Orphaned custom group label (group was removed
                    // but the attendee still points at it) — surface a
                    // bucket for it so the user can drag them out.
                    if (!byGroupKey.has(g.toLowerCase())) byGroupKey.set(g.toLowerCase(), []);
                    byGroupKey.get(g.toLowerCase()).push(a);
                  } else {
                    ungrouped.push(a);
                  }
                }
                const req = ungrouped.filter(a => a.required);
                const opt = ungrouped.filter(a => !a.required);
                return (
                  <div>
                    {columnHeader}
                    {Array.from(byGroupKey.entries()).map(([lcName, members]) => {
                      // Preserve the original-case label by looking it
                      // up in the meeting's list, falling back to the
                      // first matching attendee's stored value.
                      const displayName = customerGroups.find(g => g.toLowerCase() === lcName)
                        || members[0]?.group
                        || lcName;
                      return (
                        <div key={`grp-${lcName}`}>
                          {groupHeader(
                            displayName,
                            members.length,
                            '#0F766E',
                            '#CCFBF1',
                            { targetGroup: displayName, onRemove: () => removeCustomerGroup(displayName) },
                          )}
                          {members.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {orderByHierarchy(members).map(({ attendee, depth }) => renderCustomerAttendee(attendee, depth))}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontStyle: 'italic', padding: '0.2rem 0.5rem' }}>
                              Drop attendees here.
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(req.length > 0 || custDragKey) && (
                      <>
                        {groupHeader('Required', req.length, '#B91C1C', '#FEE2E2', { targetGroup: '', targetRequired: true })}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {orderByHierarchy(req).map(({ attendee, depth }) => renderCustomerAttendee(attendee, depth))}
                        </div>
                      </>
                    )}
                    {(opt.length > 0 || custDragKey) && (
                      <>
                        {groupHeader('Optional', opt.length, '#3730A3', '#E0E7FF', { targetGroup: '', targetRequired: false })}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {orderByHierarchy(opt).map(({ attendee, depth }) => renderCustomerAttendee(attendee, depth))}
                        </div>
                      </>
                    )}
                    <div style={{ marginTop: '0.5rem' }}>
                      {newGroupOpen ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            autoFocus
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder="Group name"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { addCustomerGroup(newGroupName); setNewGroupName(''); setNewGroupOpen(false); }
                              if (e.key === 'Escape') { setNewGroupName(''); setNewGroupOpen(false); }
                            }}
                            style={{ fontSize: '0.76rem', padding: '0.2rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 3 }}
                          />
                          <button type="button" style={{ ...sx.primaryBtn, fontSize: '0.7rem', padding: '0.2rem 0.55rem' }} onClick={() => { addCustomerGroup(newGroupName); setNewGroupName(''); setNewGroupOpen(false); }}>Add</button>
                          <button type="button" style={{ ...sx.btn, fontSize: '0.7rem', padding: '0.2rem 0.55rem' }} onClick={() => { setNewGroupName(''); setNewGroupOpen(false); }}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNewGroupOpen(true)}
                          style={{ ...sx.btn, fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                        >+ Add group</button>
                      )}
                    </div>
                  </div>
                );
              };
              const customerHeading = (companyName || 'Customer').trim() || 'Customer';
              // Customer-bucket autocomplete: suggest from the company's
              // known HubSpot contacts, filtered by draftName and excluding
              // those already on this meeting's customer list.
              const existingCustEmails = new Set(
                customerAttendees.map(a => (a.email || '').toLowerCase().trim()).filter(Boolean)
              );
              const contactFullName = (c) => [(c.firstname || '').trim(), (c.lastname || '').trim()].filter(Boolean).join(' ');
              const suggestions = (() => {
                if (addingTo !== 'customer') return [];
                if (draftPicked) return [];
                const list = Array.isArray(companyContacts) ? companyContacts : [];
                if (list.length === 0) return [];
                const q = draftName.trim().toLowerCase();
                const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
                const filtered = list.filter(c => {
                  const em = (c.email || '').toLowerCase().trim();
                  if (em && existingCustEmails.has(em)) return false;
                  if (tokens.length === 0) return true;
                  const hay = `${(c.firstname || '')} ${(c.lastname || '')} ${(c.email || '')} ${(c.jobtitle || '')}`.toLowerCase();
                  return tokens.every(t => hay.includes(t));
                });
                filtered.sort((a, b) => contactFullName(a).localeCompare(contactFullName(b)));
                return filtered.slice(0, 8);
              })();
              const pickSuggestion = (c) => {
                const full = contactFullName(c) || (c.email || '');
                setDraftName(full);
                setDraftEmail(c.email || '');
                setDraftPicked(true);
              };
              const addForm = (bucket) => (addingTo === bucket) && (
                <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.5rem', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 4 }}>
                  <input
                    autoFocus
                    value={draftName}
                    onChange={e => { setDraftName(e.target.value); setDraftPicked(false); }}
                    placeholder="Name"
                    style={{ ...sx.cellInput, fontSize: '0.78rem', padding: '0.25rem 0.4rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 3, marginBottom: 4 }}
                  />
                  {bucket === 'customer' && suggestions.length > 0 && (
                    <div style={{ marginBottom: 4, border: '1px solid #CBD5E1', borderRadius: 3, background: '#fff', maxHeight: 180, overflowY: 'auto' }}>
                      {suggestions.map(c => {
                        const full = contactFullName(c) || '(no name)';
                        const sub = [c.jobtitle, c.email].filter(Boolean).join(' · ');
                        return (
                          <div
                            key={c.id || c.vid || c.email || full}
                            onClick={() => pickSuggestion(c)}
                            style={{ padding: '0.25rem 0.5rem', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', fontSize: '0.76rem' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                          >
                            <div style={{ fontWeight: 600, color: '#1E293B' }}>{full}</div>
                            {sub && <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{sub}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <input
                    value={draftEmail}
                    onChange={e => setDraftEmail(e.target.value)}
                    placeholder="Email (optional)"
                    style={{ ...sx.cellInput, fontSize: '0.78rem', padding: '0.25rem 0.4rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 3, marginBottom: 4 }}
                  />
                  <label style={{ fontSize: '0.7rem', color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                    <input type="checkbox" checked={draftRequired} onChange={e => setDraftRequired(e.target.checked)} />
                    Required
                  </label>
                  <button type="button" style={{ ...sx.primaryBtn, fontSize: '0.7rem', padding: '0.2rem 0.55rem' }} onClick={commitAddAttendee}>Add</button>
                  <button type="button" style={{ ...sx.btn, fontSize: '0.7rem', padding: '0.2rem 0.55rem', marginLeft: 4 }} onClick={cancelAddAttendee}>Cancel</button>
                </div>
              );
              const addButton = (bucket) => addingTo !== bucket && (
                <button
                  type="button"
                  onClick={() => openAddAttendee(bucket)}
                  style={{ ...sx.btn, fontSize: '0.68rem', padding: '0.2rem 0.5rem', marginTop: '0.35rem' }}
                >+ Add attendee</button>
              );
              return (
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.3rem' }}>
                    Attendees ({totalAttendees})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.25rem' }}>
                        Schneider Electric <span style={{ color: '#64748B', fontWeight: 500 }}>({seAttendees.length})</span>
                      </div>
                      {seAttendees.length === 0
                        ? <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No Schneider attendees</div>
                        : (
                          <>
                            <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: '0.3rem' }}>{countLine(seAttendees)}</div>
                            {renderSeGrouped(seAttendees)}
                          </>
                        )}
                      {addButton('se')}
                      {addForm('se')}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.25rem' }}>
                        {customerHeading} <span style={{ color: '#64748B', fontWeight: 500 }}>({customerAttendees.length})</span>
                      </div>
                      {customerAttendees.length === 0
                        ? <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No {customerHeading} attendees</div>
                        : (
                          <>
                            <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: '0.3rem' }}>{countLine(customerAttendees)}</div>
                            {renderGroupedList(customerAttendees)}
                          </>
                        )}
                      {addButton('customer')}
                      {addForm('customer')}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {meetingError && (
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '0.5rem', color: '#B91C1C', fontSize: '0.75rem' }}>
            {meetingError}
          </div>
        )}
      </div>

      {/* Free-form meeting-prep buckets that sit between the imported
          meeting data and the structured opportunity form fields. */}
      <div>
        <div style={sx.fieldLabel}>
          PPT Link
          {formData.fieldValues.pptLink && (
            <a
              href={/^https?:\/\//i.test(formData.fieldValues.pptLink) ? formData.fieldValues.pptLink : `https://${formData.fieldValues.pptLink}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: '0.4rem', color: '#0A66C2', fontWeight: 600, textDecoration: 'none' }}
              title="Open PPT link"
            >Open ↗</a>
          )}
        </div>
        <CommitOnBlurInput
          type="text"
          value={formData.fieldValues.pptLink || ''}
          onCommit={v => updateField('pptLink', v)}
          placeholder="Paste the PowerPoint URL (SharePoint, OneDrive, etc.)"
          style={sx.input}
        />
      </div>

      <div>
        <div style={{ ...sx.fieldLabel, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Call Context</span>
          {(() => {
            const candidates = importableNotes.filter(n => (n.context || '').trim());
            if (candidates.length === 0) return null;
            return (
              <CallContextImportPicker
                candidates={candidates}
                onImport={(source) => {
                  const incoming = (source?.context || '').trim();
                  if (!incoming) return;
                  // Append the source's Call Context, with a blank-line
                  // separator when the current field already has text.
                  // Replaces in place when the current field is empty.
                  const current = (formData.fieldValues.context || '').replace(/\s+$/, '');
                  const merged = current ? `${current}\n\n${incoming}` : incoming;
                  updateField('context', merged);
                }}
              />
            );
          })()}
        </div>
        <CommitOnBlurInput
          multiline
          autoGrow
          style={{ ...sx.textarea, minHeight: '90px' }}
          value={formData.fieldValues.context || ''}
          onCommit={v => updateField('context', v)}
          placeholder="Background and context for this meeting — what led up to it, who introduced us, relevant history, recent news about the account, etc."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <div style={sx.fieldLabel}>Intent</div>
          <CommitOnBlurInput
            multiline
            autoGrow
            style={sx.textarea}
            value={formData.fieldValues.intent || ''}
            onCommit={v => updateField('intent', v)}
            placeholder="Why are we having this meeting? What do we hope to walk in and accomplish?"
          />
        </div>
        <div>
          <div style={sx.fieldLabel}>End In Mind</div>
          <CommitOnBlurInput
            multiline
            autoGrow
            style={sx.textarea}
            value={formData.fieldValues.endInMind || ''}
            onCommit={v => updateField('endInMind', v)}
            placeholder="What does a successful outcome look like? What do we want them to do next?"
          />
        </div>
      </div>

      {renderTables(topTables)}

      <div style={sx.grid}>
        {template.fields.map(f => {
          // Conditional fields (e.g. Current Client Scope only shows for Clients)
          if (f.showWhenStatus && formData.fieldValues.status !== f.showWhenStatus) return null;
          // scopingNotes is rendered as a sub-section inside the General
          // Notes (summary) block — see below — so skip it in the main
          // field loop. The fieldValues entry is still initialized via
          // emptyFormData since the field stays in template.fields.
          if (f.key === 'scopingNotes') return null;
          const isStatus = f.key === 'status';
          const statusValue = formData.fieldValues.status || '';
          const notCurrentClient = isStatus && statusValue && statusValue !== 'Client';
          const nestedTables = tablesByField[f.key] || [];
          const aboveTables = tablesAboveField[f.key] || [];
          // Any field that has nested tables takes the full grid width so
          // the table actually fits. Textareas already do this.
          const spanFull = f.type === 'textarea' || f.type === 'scopingNotes' || nestedTables.length > 0 || aboveTables.length > 0;
          return (
            <div key={f.key} style={spanFull ? { gridColumn: 'span 2' } : undefined}>
              {aboveTables.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {f.key === 'summary' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      {[
                        { key: 'timingAnswer', label: 'When do they want to do it by? What is driving that deadline?' },
                        { key: 'budgetAnswer', label: 'Have they budgeted for this?' },
                        { key: 'leadershipAnswer', label: 'What kicked off this scoping exercise? Was it a problem that surfaced or a mandate from leadership?' },
                      ].map(q => {
                        const v = formData.fieldValues[q.key] || '';
                        const empty = !v.trim();
                        return (
                          <div
                            key={q.key}
                            style={{
                              padding: '0.5rem 0.6rem',
                              border: `1px solid ${empty ? '#FCA5A5' : 'var(--color-border)'}`,
                              borderRadius: 6,
                              background: empty ? '#FEE2E2' : '#fff',
                              transition: 'background 0.2s, border-color 0.2s',
                            }}
                          >
                            <div style={{ ...sx.fieldLabel, color: empty ? '#991B1B' : '#64748B', marginBottom: '0.25rem' }}>
                              {q.label}
                            </div>
                            <CommitOnBlurInput
                              style={{ ...sx.input, background: '#fff' }}
                              value={v}
                              onCommit={val => updateField(q.key, val)}
                              placeholder="Answer…"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {renderTables(aboveTables)}
                </div>
              )}
              <div style={sx.fieldLabel}>
                {f.label}
                {notCurrentClient && (
                  <span style={{ marginLeft: '0.4rem' }}>
                    – Not Current Client
                  </span>
                )}
                {f.isLink && formData.fieldValues[f.key] && (
                  <a
                    href={/^https?:\/\//i.test(formData.fieldValues[f.key]) ? formData.fieldValues[f.key] : `https://${formData.fieldValues[f.key]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: '0.4rem', color: '#0A66C2', fontWeight: 600, textDecoration: 'none' }}
                    title={`Open ${f.label}`}
                  >Open ↗</a>
                )}
              </div>
              {f.type === 'textarea' ? (
                f.key === 'summary' ? (
                  // Wrap the General Notes editor in a visible box so
                  // its nested Scoping Details Notes can sit inside it
                  // as a second, lighter sub-box — the user wanted the
                  // hierarchy to be obvious at a glance instead of two
                  // textareas stacked with only a label between them.
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '0.6rem',
                    padding: '0.6rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    background: '#fff',
                  }}>
                    <ScopingNotesEditor
                      value={formData.fieldValues[f.key] || ''}
                      onCommit={v => updateField(f.key, v)}
                      services={SCOPING_SERVICE_OPTIONS}
                      competitors={competitorOptions}
                      onMentionCompetitor={onMentionCompetitor}
                      placeholder="General notes. Type @ for services or competitors (Services / Competitors are grouped in the dropdown). Bullet list: type - or * at the start of a line."
                      style={{ minHeight: '120px' }}
                    />
                    <div style={{
                      padding: '0.5rem 0.6rem',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: 6,
                      background: 'var(--color-bg)',
                    }}>
                      <div style={{ ...sx.fieldLabel, marginBottom: '0.3rem' }}>Scoping Details Notes</div>
                      <ScopingNotesEditor
                        value={formData.fieldValues.scopingNotes || ''}
                        onCommit={v => updateField('scopingNotes', v)}
                        services={SCOPING_SERVICE_OPTIONS}
                        competitors={competitorOptions}
                        onMentionCompetitor={onMentionCompetitor}
                        placeholder="Capture scoping notes. Type @ to tag a service or competitor — e.g. @strategic, @engie."
                      />
                    </div>
                  </div>
                ) : (
                  <CommitOnBlurInput
                    multiline
                    autoGrow
                    style={sx.textarea}
                    value={formData.fieldValues[f.key] || ''}
                    onCommit={v => updateField(f.key, v)}
                  />
                )
              ) : f.type === 'scopingNotes' ? (
                // Renders inside the summary block above; this branch is
                // a no-op fallback in case the type ever lands as its own
                // row again.
                <ScopingNotesEditor
                  value={formData.fieldValues[f.key] || ''}
                  onCommit={v => updateField(f.key, v)}
                  services={SCOPING_SERVICE_OPTIONS}
                  placeholder="Capture scoping notes. Type @ to tag a service from the Services Explored list — e.g. @strategic → Strategic sourcing."
                />
              ) : f.type === 'select' ? (
                <select
                  style={sx.input}
                  value={formData.fieldValues[f.key] || ''}
                  onChange={e => updateField(f.key, e.target.value)}
                >
                  <option value="">—</option>
                  {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <CommitOnBlurInput
                  type={f.type === 'date' ? 'date' : 'text'}
                  style={sx.input}
                  value={formData.fieldValues[f.key] || ''}
                  onCommit={v => updateField(f.key, v)}
                />
              )}
              {nestedTables.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  {renderTables(nestedTables)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {renderTables(bottomTables)}
    </div>
  );
}
