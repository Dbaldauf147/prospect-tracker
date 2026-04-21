import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';

// Uncontrolled-ish text input / textarea that holds its own local state
// and only propagates up on blur. Used for the heavy free-form fields
// (summary, intent, context, table cells…) so keystrokes don't trigger
// a re-render of the entire OpportunityForm tree. Still syncs in when
// the parent value legitimately changes (opp-link autofill, template
// self-heal, etc.).
const CommitOnBlurInput = memo(function CommitOnBlurInput({ value, onCommit, multiline, type, ...rest }) {
  const [local, setLocal] = useState(value ?? '');
  const lastExternal = useRef(value ?? '');
  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) {
      lastExternal.current = v;
      setLocal(v);
    }
  }, [value]);
  const handleBlur = () => {
    if (local !== lastExternal.current) {
      lastExternal.current = local;
      onCommit(local);
    }
  };
  if (multiline) {
    return <textarea {...rest} value={local} onChange={e => setLocal(e.target.value)} onBlur={handleBlur} />;
  }
  return <input type={type || 'text'} {...rest} value={local} onChange={e => setLocal(e.target.value)} onBlur={handleBlur} />;
});

// Default form schema. Edit these arrays to change the template.
// `autofill` is the Opps sheet column whose value should populate the field
// when an opportunity is linked.
export const DEFAULT_FORM_TEMPLATE = {
  fields: [
    { key: 'stage', label: 'Stage', type: 'text', autofill: 'Stage' },
    { key: 'status', label: 'Status', type: 'text' }, // populated from the linked opp's account (prospects), not the opp row
    { key: 'scope', label: 'Scope', type: 'text', autofill: 'Scope' },
    { key: 'region', label: 'Region', type: 'select', options: ['EU', 'Global', 'NAM', 'APAC', 'LATAM'] },
    // Only rendered when status === 'Client'. Auto-populated with the
    // company's current active services (Sold / Renewal / In Progress).
    { key: 'currentClientScope', label: 'Current Client Scope', type: 'textarea', showWhenStatus: 'Client' },
    { key: 'summary', label: 'Meeting Summary / Notes', type: 'textarea' },
  ],
  tables: [
    {
      key: 'agenda',
      label: 'Agenda',
      placement: 'top', // renders before the Stage/Status fields grid
      smartAgenda: true, // unlocks speaker picker + time-balance behavior
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'speaker', label: 'Speaker(s)', attendeePicker: true, multi: true },
        { key: 'startTime', label: 'Time' },
        { key: 'duration', label: 'Minutes', numeric: true, numFmt: '0' },
        { key: 'slides', label: 'Slides / Software' },
      ],
    },
    {
      key: 'ourQuestions',
      label: 'Questions to Ask Them',
      group: 'Questions',
      columns: [
        { key: 'question', label: 'Question' },
      ],
    },
    {
      key: 'theirQuestions',
      label: 'Questions They Might Ask',
      group: 'Questions',
      columns: [
        { key: 'question', label: 'Their Question' },
        { key: 'response', label: 'Our Response' },
      ],
    },
    {
      key: 'risks',
      label: 'Yellow Lights',
      columns: [
        { key: 'item', label: 'What Yellow Lights Might Arise' },
        { key: 'notes', label: 'How Will You Respond?' },
      ],
    },
    {
      key: 'meetingNotes',
      label: 'Key Issues',
      underField: 'summary', // rendered inline beneath the Meeting Summary / Notes field
      columns: [
        { key: 'issue', label: 'Issue' },
        { key: 'evidence', label: 'Evidence' },
        { key: 'impact', label: 'Impact' },
      ],
    },
    {
      key: 'actionItems',
      label: 'Action Items / Next Steps',
      underField: 'summary', // nests directly under Key Issues beneath Meeting Summary / Notes
      columns: [
        { key: 'item', label: 'Action Item' },
        { key: 'owner', label: 'Owner', attendeePicker: true },
      ],
    },
  ],
};

function emptyFormData(template = DEFAULT_FORM_TEMPLATE) {
  const fieldValues = {};
  for (const f of template.fields) fieldValues[f.key] = '';
  const tables = {};
  for (const t of template.tables) {
    tables[t.key] = Array.from({ length: 2 }, () =>
      Object.fromEntries(t.columns.map(c => [c.key, '']))
    );
  }
  return { fieldValues, tables, linkedBfoLink: null, linkedOppName: null, meeting: null };
}

// ---- .ics parser --------------------------------------------------------
// Unfolds wrapped lines per RFC 5545 (continuation lines start with space/tab),
// then splits PROPERTY;PARAM=VAL:VALUE rows. Returns { subject, start, end,
// durationMinutes, location, organizer, attendees }.
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
    // Floating or TZID-scoped: best-effort treat as local time
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
      case 'DTSTART': dtStart = parseIcsDate(value, params); break;
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
  };
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
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
  const active = new Set(['Sold', 'Renewal', 'In Progress']);
  return Object.entries(svc)
    .filter(([, status]) => active.has(status))
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

export function OpportunityForm({ value, onChange, onLinkOpp, companyName, companyContacts = [], allHubspotContacts = [], contactNotes = {}, prospects = [], onCreateContact }) {
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
    const base = emptyFormData(template);
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
    };
  }, [localValue, template]);

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
    set({ tables: { ...formData.tables, [tableKey]: [...(formData.tables[tableKey] || []), empty] } });
  };

  const removeTableRow = (tableKey, rowIdx) => {
    const rows = [...(formData.tables[tableKey] || [])];
    rows.splice(rowIdx, 1);
    set({ tables: { ...formData.tables, [tableKey]: rows } });
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
          </div>
          <table style={sx.table}>
            <thead>
              <tr>
                {t.columns.map(c => (
                  <th key={c.key} style={sx.th}>{c.label}</th>
                ))}
                <th style={{ ...sx.th, width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {(formData.tables[t.key] || []).map((row, rIdx) => (
                <tr key={rIdx}>
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
                      return (
                        <td key={c.key} style={sx.td}>
                          <input
                            type="number"
                            min="0"
                            style={sx.cellInput}
                            value={row[c.key] || ''}
                            onChange={e => updateAgendaDuration(rIdx, e.target.value)}
                            placeholder="min"
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} style={sx.td}>
                        <CommitOnBlurInput
                          style={sx.cellInput}
                          value={row[c.key] || ''}
                          onCommit={v => updateTableCell(t.key, rIdx, c.key, v)}
                        />
                      </td>
                    );
                  })}
                  <td style={sx.td}>
                    <button
                      type="button"
                      style={sx.rowBtn}
                      title="Remove row"
                      onClick={() => removeTableRow(t.key, rIdx)}
                    >×</button>
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
  const bottomTables = template.tables.filter(t => t.placement !== 'top' && !t.underField);
  const tablesByField = {};
  for (const t of template.tables) {
    if (t.underField) {
      if (!tablesByField[t.underField]) tablesByField[t.underField] = [];
      tablesByField[t.underField].push(t);
    }
  }

  // ---- Link opportunity (search the Opps cache by BFO Link or text) ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cache, setCache] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!pickerOpen) return;
    loadOppsFromCache().then(c => setCache(c));
  }, [pickerOpen]);

  const results = useMemo(() => searchOpps(cache, search), [cache, search]);

  const linkOpp = (opp) => {
    const nextValues = { ...formData.fieldValues };
    for (const f of template.fields) {
      if (f.autofill && opp[f.autofill] != null) {
        nextValues[f.key] = String(opp[f.autofill]);
      }
    }
    // Status is driven by the Account (company) on this opp, not the opp
    // row's Status column. Look up the matching prospect in the Table View
    // data and pull its account-level status. If that status is Client,
    // also populate Current Client Scope with the company's active services.
    const accountName = (opp?.['Account'] || '').trim();
    const matchedProspect = matchProspectByName(accountName, prospects);
    if (matchedProspect?.status) {
      nextValues.status = matchedProspect.status;
      if (matchedProspect.status === 'Client') {
        nextValues.currentClientScope = currentServicesFor(matchedProspect).join(', ');
      } else {
        nextValues.currentClientScope = '';
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
  const updateDansAsk = (email, text) => {
    if (!email) return;
    const next = { ...(formData.meeting || {}) };
    next.dansAsks = { ...(next.dansAsks || {}), [email.toLowerCase()]: text };
    set({ meeting: next });
  };

  // ---- Meeting drop zone (drag an Outlook .ics into this form) -----------
  const [isDraggingMeeting, setIsDraggingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState('');
  const fileInputRef = useRef(null);

  async function ingestMeetingFile(file) {
    setMeetingError('');
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    if (!name.endsWith('.ics')) {
      setMeetingError(`${file.name || 'File'} is not a .ics meeting file. Drag an .ics export from Outlook (from the Calendar view or "Save as .ics" on a meeting).`);
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

  function handleMeetingDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingMeeting(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) ingestMeetingFile(files[0]);
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
      const match = em ? byEmail.get(em) : null;
      const matchedCompany = (match?.company || '').trim();
      const matchedOtherCompany = !!matchedCompany && matchedCompany.toLowerCase() !== thisCompany;
      const enriched = { ...a, match, matchedCompany, matchedOtherCompany };
      // Explicit bucket on manual attendees wins; otherwise fall back to
      // email-domain detection for @se.com / @schneider-electric.com.
      let isSE;
      if (a.bucket === 'se') isSE = true;
      else if (a.bucket === 'customer') isSE = false;
      else isSE = /@(se\.com|schneider-electric\.com)$/i.test(em);
      if (isSE) se.push(enriched); else cust.push(enriched);
    }
    // Required first, optional after, alphabetical within each group.
    const sorter = (a, b) => {
      if (!!a.required !== !!b.required) return a.required ? -1 : 1;
      return (a.name || a.email || '').localeCompare(b.name || b.email || '');
    };
    se.sort(sorter);
    cust.sort(sorter);
    return { seAttendees: se, customerAttendees: cust };
  }, [formData.meeting, allHubspotContacts, companyContacts, companyName]);

  const totalAttendees = (seAttendees?.length || 0) + (customerAttendees?.length || 0);

  // --- Manual attendees -------------------------------------------------
  // Users can add attendees on top of those imported from Outlook. Stored
  // under meeting.manualAttendees so they survive ICS re-imports (re-import
  // replaces meeting.attendees but we preserve manualAttendees separately
  // when the user chooses to re-drop a .ics).
  const [addingTo, setAddingTo] = useState(null); // 'se' | 'customer' | null
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftRequired, setDraftRequired] = useState(true);

  function openAddAttendee(bucket) {
    setAddingTo(bucket);
    setDraftName('');
    setDraftEmail('');
    setDraftRequired(true);
  }
  function cancelAddAttendee() {
    setAddingTo(null);
    setDraftName('');
    setDraftEmail('');
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

  // --- Smart Agenda helpers (must live after seAttendees/customerAttendees
  //     are defined — they're used by renderTables via closure). --------
  // Each company name is included at the top of its own optgroup as a
  // pickable "team" option so a row can be attributed to the whole
  // organization rather than a specific person.
  const agendaSpeakerGroups = useMemo(() => {
    const opts = [];
    const se = (seAttendees || []).map(a => a.name || a.email).filter(Boolean);
    const cust = (customerAttendees || []).map(a => a.name || a.email).filter(Boolean);
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
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }

  function updateAgendaDuration(rowIdx, newMinutes) {
    const rows = [...(formData.tables.agenda || [])];
    if (!rows.length) return;
    const parsed = Math.max(0, Number(newMinutes) || 0);
    rows[rowIdx] = { ...rows[rowIdx], duration: parsed === 0 ? '' : String(parsed) };
    if (meetingTotalMinutes > 0) {
      let usedBeforeAndAt = 0;
      for (let i = 0; i <= rowIdx; i++) usedBeforeAndAt += Number(rows[i]?.duration) || 0;
      const remainAfter = Math.max(0, meetingTotalMinutes - usedBeforeAndAt);
      if (remainAfter > 0) {
        if (rowIdx + 1 >= rows.length) {
          rows.push({ subject: '', speaker: '', startTime: '', duration: String(remainAfter), slides: '' });
        } else {
          rows[rowIdx + 1] = { ...rows[rowIdx + 1], duration: String(remainAfter) };
          for (let i = rowIdx + 2; i < rows.length; i++) {
            rows[i] = { ...rows[i], duration: '' };
          }
        }
      }
    }
    set({ tables: { ...formData.tables, agenda: rows } });
  }

  const agendaSum = useMemo(() => {
    const rows = formData.tables.agenda || [];
    return rows.reduce((s, r) => s + (Number(r?.duration) || 0), 0);
  }, [formData.tables.agenda]);

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
        views: [{ state: 'frozen', ySplit: 3 }],
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
      // so wrapped text is fully visible instead of being clipped. The
      // ratio is deliberately conservative — word-wrapping at space
      // boundaries produces fewer chars per line than strict char-count,
      // and Nunito Sans 10pt is wider than Calibri 11pt (Excel default),
      // so we under-pack.
      const estimateWrappedLines = (text, colUnits) => {
        if (!text) return 1;
        const s = String(text);
        const explicit = s.split('\n');
        let lines = 0;
        // ~0.95 avg chars per column unit at 10pt Nunito Sans, then trim
        // for word-boundary wrap inefficiency.
        const perLine = Math.max(10, Math.floor(colUnits * 0.85));
        for (const line of explicit) {
          lines += Math.max(1, Math.ceil((line.length || 1) / perLine));
        }
        return lines;
      };
      // 18 pt per line of 10pt wrapped text (Excel adds leading + padding).
      const rowHeightForLines = (lines) => Math.min(750, Math.max(20, lines * 18));

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

      const addTable = (title, columns, rows /*, widths unused */) => {
        addSectionHeader(title);
        // Distribute the SPAN worksheet columns across this table's columns
        // so the whole table fills the full page width. A 1-column table
        // occupies all SPAN cols; a 2-col table is 5+5; 3-col is 3/3/4; etc.
        const numCols = columns.length;
        const base = Math.floor(SPAN / numCols);
        const rem = SPAN - base * numCols;
        const slots = [];
        let cur = 1;
        for (let i = 0; i < numCols; i++) {
          const w = base + (i < rem ? 1 : 0);
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
        const dataRows = rows.length > 0 ? rows : [{}];
        dataRows.forEach((r, idx) => {
          const dRow = ws.addRow([]);
          const zebra = idx % 2 === 1;
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
              c.value = (raw === '' || raw == null) ? null : raw;
            }
            c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            c.alignment = { vertical: 'top', horizontal: col.numeric ? 'right' : 'left', wrapText: true, indent: col.numeric ? 0 : 1 };
            c.border = borderAll;
            if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
            if (slot.end > slot.start) {
              ws.mergeCells(dRow.number, slot.start, dRow.number, slot.end);
            }
            maxLines = Math.max(maxLines, estimateWrappedLines(raw, slotUnits(slot)));
          });
          dRow.height = rowHeightForLines(maxLines);
        });
      };

      // --- Meeting (imported from .ics) --------------------------------
      if (formData.meeting) {
        addBlankRow();
        addSectionHeader('Meeting');
        addFieldRow('Subject', formData.meeting.subject || '');
        addFieldRow('When', (() => {
          try { return formData.meeting.start ? new Date(formData.meeting.start).toLocaleString() : ''; } catch { return ''; }
        })());
        addFieldRow('Ends', (() => {
          try { return formData.meeting.end ? new Date(formData.meeting.end).toLocaleString() : ''; } catch { return ''; }
        })());
        const mins = formData.meeting.durationMinutes;
        if (mins != null) {
          const h = Math.floor(mins / 60), m = mins % 60;
          addFieldRow('Duration', m === 0 ? `${h}h` : h === 0 ? `${m} min` : `${h}h ${m}m`);
        }
        if (formData.meeting.location) addFieldRow('Location', formData.meeting.location);
        if (formData.meeting.organizer) addFieldRow('Organizer',
          [formData.meeting.organizer.name, formData.meeting.organizer.email && `<${formData.meeting.organizer.email}>`].filter(Boolean).join(' ')
        );

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
        const custColLabels = ['Name', 'Required?', 'Title', 'City, Country', 'Notes'];
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
                se.name || se.email || '',
                se.required ? 'Required' : 'Optional',
                (se.email && dansAskMap[se.email.toLowerCase()]) || '',
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

          const cust = customerAttendees[i];
          let custVals;
          if (cust) {
            const city = (cust.match?.city || '').trim();
            const country = (cust.match?.country || '').trim();
            const noteSrc = (cust.match?.id && contactNotes[cust.match.id]) || cust.match?.notes || cust.match?.hs_content_membership_notes || cust.match?.message || '';
            custVals = [
              cust.name || cust.email || '',
              cust.required ? 'Required' : 'Optional',
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
      addFieldRow('Call Context', formData.fieldValues.context || '');
      addFieldRow('Intent', formData.fieldValues.intent || '');
      addFieldRow('End In Mind', formData.fieldValues.endInMind || '');

      // --- Details (structured fields) --------------------------------
      addBlankRow();
      addSectionHeader('Details');
      for (const f of template.fields) {
        if (f.showWhenStatus && formData.fieldValues.status !== f.showWhenStatus) continue;
        addFieldRow(f.label, formData.fieldValues[f.key] || '');
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
              out.startTime = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            } catch {}
            priorSum += Number(r?.duration) || 0;
            return out;
          });
        }
        addTable(t.label, t.columns, tableRows, widths);
        // Restore defaults for next block
        colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
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
                  placeholder="Search by Account, Contact, BFO Link, Scope, Stage…"
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
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>BFO: {r['BFO Link'] || '—'}</div>
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
          accept=".ics,text/calendar"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestMeetingFile(f); e.target.value = ''; }}
        />
        {!formData.meeting && (
          <>
            <div style={{ fontWeight: 700, color: '#15803D', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
              {isDraggingMeeting ? 'Drop the meeting file to import' : 'Drag an Outlook meeting (.ics) here'}
            </div>
            <div style={{ color: '#475569', marginBottom: '0.6rem' }}>
              Pulls subject, time, duration, location, and attendees. Unmatched attendees can be added to HubSpot in one click.
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
              Choose .ics file…
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
              {formData.meeting.organizer && (
                <div style={{ gridColumn: 'span 2' }}>
                  <strong>Organizer:</strong> {formData.meeting.organizer.name}
                  {formData.meeting.organizer.email ? ` <${formData.meeting.organizer.email}>` : ''}
                </div>
              )}
            </div>
            {totalAttendees > 0 && (() => {
              const GRID_COLS = 'auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1.4fr) auto';
              const renderAttendee = (a, i) => {
                const matched = !!a.match;
                const rawSummary = a.rawParams
                  ? Object.entries(a.rawParams).map(([k, v]) => `${k}=${v}`).join('; ')
                  : '';
                const tooltip = `${a.email}${a.role ? ' · ROLE=' + a.role : ''}${rawSummary ? ' · ' + rawSummary : ''}`;
                const title = a.match?.jobtitle || '';
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
                          {a.name || a.email || '(unknown)'}
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#1E293B', ...wrap }}>
                          {a.name || a.email || '(unknown)'}
                        </span>
                      )}
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
                    <div>
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
                  gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1.4fr) auto',
                  columnGap: '0.5rem',
                  padding: '0 0.5rem 0.25rem',
                  fontSize: '0.62rem', fontWeight: 700,
                  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <span style={{ width: 12 }} />
                  <span>Name</span>
                  <span>Title</span>
                  <span>City, Country</span>
                  <span>Notes</span>
                  <span />
                </div>
              );
              // Dedicated renderer for Schneider Electric attendees: just
              // name + free-text "Dan's Ask" column. No title/city/notes.
              const SE_GRID = 'auto minmax(0, 1fr) minmax(0, 2fr)';
              const seColumnHeader = (
                <div style={{
                  display: 'grid', gridTemplateColumns: SE_GRID, columnGap: '0.5rem',
                  padding: '0 0.5rem 0.25rem',
                  fontSize: '0.62rem', fontWeight: 700,
                  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <span style={{ width: 12 }} />
                  <span>Name</span>
                  <span>Dan&apos;s Ask</span>
                </div>
              );
              const renderSeAttendee = (a, i) => {
                const matched = !!a.match;
                const linkedinUrl = a.match?.hs_linkedin_url || a.match?.linkedin_url || a.match?.hs_linkedinid || '';
                const rawSummary = a.rawParams
                  ? Object.entries(a.rawParams).map(([k, v]) => `${k}=${v}`).join('; ')
                  : '';
                const tooltip = `${a.email}${a.role ? ' · ROLE=' + a.role : ''}${rawSummary ? ' · ' + rawSummary : ''}`;
                const ask = (a.email && dansAsks[a.email.toLowerCase()]) || '';
                const wrap = { overflowWrap: 'anywhere', wordBreak: 'break-word' };
                return (
                  <div
                    key={i}
                    title={tooltip}
                    style={{
                      display: 'grid', gridTemplateColumns: SE_GRID, columnGap: '0.5rem',
                      alignItems: 'center',
                      padding: '0.4rem 0.5rem',
                      background: matched ? '#F0FDF4' : '#FEF2F2',
                      border: '1px solid', borderColor: matched ? '#BBF7D0' : '#FECACA',
                      borderRadius: 4,
                    }}
                  >
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
                          {a.name || a.email || '(unknown)'}
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#1E293B', ...wrap }}>
                          {a.name || a.email || '(unknown)'}
                        </span>
                      )}
                    </div>
                    <CommitOnBlurInput
                      multiline
                      value={ask}
                      onCommit={v => updateDansAsk(a.email, v)}
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
                  </div>
                );
              };
              const renderSeGrouped = (list) => {
                const req = list.filter(a => a.required);
                const opt = list.filter(a => !a.required);
                const subHeader = (label, count, color, bg) => (
                  <div style={{
                    marginTop: '0.35rem', marginBottom: '0.25rem',
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color, background: bg, padding: '2px 8px', borderRadius: 4,
                    display: 'inline-block',
                  }}>{label} · {count}</div>
                );
                return (
                  <div>
                    {seColumnHeader}
                    {req.length > 0 && (<>
                      {subHeader('Required', req.length, '#B91C1C', '#FEE2E2')}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {req.map(renderSeAttendee)}
                      </div>
                    </>)}
                    {opt.length > 0 && (<>
                      {subHeader('Optional', opt.length, '#3730A3', '#E0E7FF')}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {opt.map(renderSeAttendee)}
                      </div>
                    </>)}
                  </div>
                );
              };
              const renderGroupedList = (list) => {
                const req = list.filter(a => a.required);
                const opt = list.filter(a => !a.required);
                const subHeader = (label, count, color, bg) => (
                  <div style={{
                    marginTop: '0.35rem', marginBottom: '0.25rem',
                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color, background: bg, padding: '2px 8px', borderRadius: 4,
                    display: 'inline-block',
                  }}>{label} · {count}</div>
                );
                return (
                  <div>
                    {columnHeader}
                    {req.length > 0 && (
                      <>
                        {subHeader('Required', req.length, '#B91C1C', '#FEE2E2')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {req.map(renderAttendee)}
                        </div>
                      </>
                    )}
                    {opt.length > 0 && (
                      <>
                        {subHeader('Optional', opt.length, '#3730A3', '#E0E7FF')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {opt.map(renderAttendee)}
                        </div>
                      </>
                    )}
                  </div>
                );
              };
              const customerHeading = (companyName || 'Customer').trim() || 'Customer';
              const addForm = (bucket) => (addingTo === bucket) && (
                <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.5rem', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 4 }}>
                  <input
                    autoFocus
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    placeholder="Name"
                    style={{ ...sx.cellInput, fontSize: '0.78rem', padding: '0.25rem 0.4rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 3, marginBottom: 4 }}
                  />
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
        <div style={sx.fieldLabel}>Call Context</div>
        <CommitOnBlurInput
          multiline
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
          const isStatus = f.key === 'status';
          const statusValue = formData.fieldValues.status || '';
          const notCurrentClient = isStatus && statusValue && statusValue !== 'Client';
          const nestedTables = tablesByField[f.key] || [];
          // Any field that has nested tables takes the full grid width so
          // the table actually fits. Textareas already do this.
          const spanFull = f.type === 'textarea' || nestedTables.length > 0;
          return (
            <div key={f.key} style={spanFull ? { gridColumn: 'span 2' } : undefined}>
              <div style={sx.fieldLabel}>
                {f.label}
                {notCurrentClient && (
                  <span style={{ marginLeft: '0.4rem' }}>
                    – Not Current Client
                  </span>
                )}
              </div>
              {f.type === 'textarea' ? (
                <CommitOnBlurInput
                  multiline
                  style={sx.textarea}
                  value={formData.fieldValues[f.key] || ''}
                  onCommit={v => updateField(f.key, v)}
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
