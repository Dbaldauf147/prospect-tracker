import { useState, useEffect, useMemo, useRef } from 'react';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';

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
        { key: 'speaker', label: 'Speaker' },
        { key: 'startTime', label: 'Start Time' },
        { key: 'duration', label: 'Minutes' },
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
      key: 'meetingNotes',
      label: 'Meeting Notes',
      columns: [
        { key: 'issue', label: 'Issue' },
        { key: 'evidence', label: 'Evidence' },
        { key: 'impact', label: 'Impact' },
      ],
    },
    {
      key: 'actionItems',
      label: 'Action Items / Next Steps',
      columns: [
        { key: 'item', label: 'Action Item' },
        { key: 'owner', label: 'Owner' },
        { key: 'due', label: 'Due Date' },
        { key: 'status', label: 'Status' },
      ],
    },
    {
      key: 'risks',
      label: 'Risks / Open Items',
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'notes', label: 'Notes' },
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
  const formData = useMemo(() => {
    const base = emptyFormData(template);
    if (!value) return base;
    return {
      fieldValues: { ...base.fieldValues, ...(value.fieldValues || {}) },
      tables: Object.fromEntries(
        template.tables.map(t => [t.key, (value.tables && value.tables[t.key]) || base.tables[t.key]])
      ),
      linkedBfoLink: value.linkedBfoLink || null,
      linkedOppName: value.linkedOppName || null,
      meeting: value.meeting || null,
    };
  }, [value, template]);

  const set = (next) => onChange({ ...formData, ...next });

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
                    // Smart Agenda: speaker column becomes a grouped picker,
                    // duration column routes through updateAgendaDuration.
                    if (t.smartAgenda && c.key === 'speaker') {
                      const val = row[c.key] || '';
                      const knownOptions = agendaSpeakerGroups.flatMap(g => g.items);
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
                        <input
                          style={sx.cellInput}
                          value={row[c.key] || ''}
                          onChange={e => updateTableCell(t.key, rIdx, c.key, e.target.value)}
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
          </table>
          <button type="button" style={{ ...sx.btn, marginTop: '0.35rem' }} onClick={() => addTableRow(t.key)}>
            + Add row
          </button>
          {t.smartAgenda && meetingStartIso && (() => {
            let total = 0;
            try {
              const d = new Date(meetingStartIso);
              d.setMinutes(d.getMinutes() + agendaSum);
              total = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            } catch {}
            const scheduledEnd = formData.meeting?.end
              ? (() => { try { return new Date(formData.meeting.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } })()
              : '';
            return (
              <div style={{ marginTop: '0.5rem', padding: '0.45rem 0.6rem', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, fontSize: '0.78rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span><strong>Meeting ends:</strong> {total || '—'}</span>
                {scheduledEnd && total && scheduledEnd !== total && (
                  <span style={{ color: '#B91C1C' }}>
                    (invite says {scheduledEnd})
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      );
    });
  }

  const topTables = template.tables.filter(t => t.placement === 'top');
  const bottomTables = template.tables.filter(t => t.placement !== 'top');

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
    const empty = { seAttendees: [], customerAttendees: [] };
    if (!mt?.attendees?.length) return empty;
    const byEmail = new Map();
    const pool = (allHubspotContacts && allHubspotContacts.length > 0) ? allHubspotContacts : companyContacts;
    for (const c of pool) {
      const em = (c.email || '').toLowerCase().trim();
      if (em && !byEmail.has(em)) byEmail.set(em, c);
    }
    const thisCompany = (companyName || '').toLowerCase().trim();
    const se = [];
    const cust = [];
    for (const a of mt.attendees) {
      const em = (a.email || '').toLowerCase().trim();
      const match = em ? byEmail.get(em) : null;
      const matchedCompany = (match?.company || '').trim();
      const matchedOtherCompany = !!matchedCompany && matchedCompany.toLowerCase() !== thisCompany;
      const enriched = { ...a, match, matchedCompany, matchedOtherCompany };
      const isSE = /@(se\.com|schneider-electric\.com)$/i.test(em);
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

  // --- Smart Agenda helpers (must live after seAttendees/customerAttendees
  //     are defined — they're used by renderTables via closure). --------
  const agendaSpeakerGroups = useMemo(() => {
    const opts = [];
    if (seAttendees?.length) {
      opts.push({
        label: 'Schneider Electric',
        items: seAttendees.map(a => a.name || a.email).filter(Boolean),
      });
    }
    if (customerAttendees?.length) {
      opts.push({
        label: companyName || 'Customer',
        items: customerAttendees.map(a => a.name || a.email).filter(Boolean),
      });
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
        views: [{ state: 'frozen', ySplit: 2 }],
      });
      // Wide enough for label + long values and for a 5-col Agenda table.
      const colWidths = [26, 22, 22, 22, 22];
      ws.columns = colWidths.map(w => ({ width: w }));
      const SPAN = colWidths.length;

      // Row 1: "Schneider Electric" title band
      ws.mergeCells(1, 1, 1, SPAN);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'Schneider Electric';
      titleCell.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      // Row 2: Subtitle — "{Company} · Opportunity Prep"
      ws.mergeCells(2, 1, 2, SPAN);
      const subCell = ws.getCell(2, 1);
      const subPieces = [companyName || 'Opportunity', 'Opportunity Prep'];
      if (formData.linkedOppName) subPieces.push(formData.linkedOppName);
      subCell.value = subPieces.join('  ·  ');
      subCell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_MUTED } };
      subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(2).height = 20;

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

      const addFieldRow = (label, value) => {
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
        valCell.value = (value === '' || value == null) ? null : String(value);
        valCell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        valCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        valCell.border = borderAll;
        // Taller row for free-form text fields
        const lines = String(value || '').split('\n').length;
        row.height = Math.min(120, 18 + Math.max(0, lines - 1) * 14);
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

      const addTable = (title, columns, rows, widths) => {
        addSectionHeader(title);
        // Resize columns to fit this table. We restore generous defaults
        // after each table so later sections can reflow.
        const usable = Math.min(columns.length, SPAN);
        if (widths) {
          for (let i = 0; i < usable; i++) ws.getColumn(i + 1).width = widths[i] || colWidths[i] || 20;
        }
        // Header row
        const hRow = ws.addRow(columns.map(c => c.label).concat(Array(Math.max(0, SPAN - columns.length)).fill('')));
        for (let i = 1; i <= SPAN; i++) {
          const cell = hRow.getCell(i);
          if (i <= columns.length) {
            cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
            cell.border = borderAll;
          } else {
            cell.border = borderAll;
          }
        }
        hRow.height = 22;
        // Data rows
        const dataRows = rows.length > 0 ? rows : [{}];
        dataRows.forEach((r, idx) => {
          const values = columns.map(c => r[c.key] != null ? r[c.key] : '');
          const row = ws.addRow(values.concat(Array(Math.max(0, SPAN - values.length)).fill('')));
          const zebra = idx % 2 === 1;
          for (let i = 1; i <= SPAN; i++) {
            const cell = row.getCell(i);
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            cell.border = borderAll;
            if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_SURFACE } };
          }
          row.height = 20;
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

        // Attendees broken into SE and Customer buckets, same way the UI shows them.
        const writeAttendeeBucket = (heading, list) => {
          if (!list?.length) return;
          addSubheading(heading);
          const isSE = /Schneider/i.test(heading);
          const dansAskMap = dansAsks || {};
          const cols = isSE
            ? [
                { key: 'name', label: 'Name' },
                { key: 'required', label: 'Required?' },
                { key: 'ask', label: "Dan's Ask" },
              ]
            : [
                { key: 'name', label: 'Name' },
                { key: 'required', label: 'Required?' },
                { key: 'jobtitle', label: 'Title' },
                { key: 'location', label: 'City, Country' },
                { key: 'note', label: 'Notes' },
              ];
          const data = list.map(a => {
            const base = {
              name: a.name || a.email || '',
              required: a.required ? 'Required' : 'Optional',
            };
            if (isSE) {
              base.ask = (a.email && dansAskMap[a.email.toLowerCase()]) || '';
            } else {
              const city = (a.match?.city || '').trim();
              const country = (a.match?.country || '').trim();
              const noteSrc = (a.match?.id && contactNotes[a.match.id]) || a.match?.notes || a.match?.hs_content_membership_notes || a.match?.message || '';
              base.jobtitle = a.match?.jobtitle || '';
              base.location = [city, country].filter(Boolean).join(', ');
              base.note = noteSrc;
            }
            return base;
          });
          const widths = isSE ? [26, 14, 42] : [24, 12, 24, 20, 30];
          addTable(heading, cols, data, widths);
        };
        writeAttendeeBucket('Schneider Electric Attendees', seAttendees);
        writeAttendeeBucket((companyName || 'Customer') + ' Attendees', customerAttendees);
        // Restore default column widths after per-table overrides
        colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      }

      // --- Meeting Prep (free-form) -----------------------------------
      addBlankRow();
      addSectionHeader('Meeting Prep');
      addFieldRow('PPT Link', formData.fieldValues.pptLink || '');
      addFieldRow('Context', formData.fieldValues.context || '');
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
                    <textarea
                      value={ask}
                      onChange={e => updateDansAsk(a.email, e.target.value)}
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
        <input
          type="text"
          value={formData.fieldValues.pptLink || ''}
          onChange={e => updateField('pptLink', e.target.value)}
          placeholder="Paste the PowerPoint URL (SharePoint, OneDrive, etc.)"
          style={sx.input}
        />
      </div>

      <div>
        <div style={sx.fieldLabel}>Context</div>
        <textarea
          style={{ ...sx.textarea, minHeight: '90px' }}
          value={formData.fieldValues.context || ''}
          onChange={e => updateField('context', e.target.value)}
          placeholder="Background and context for this meeting — what led up to it, who introduced us, relevant history, recent news about the account, etc."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <div style={sx.fieldLabel}>Intent</div>
          <textarea
            style={sx.textarea}
            value={formData.fieldValues.intent || ''}
            onChange={e => updateField('intent', e.target.value)}
            placeholder="Why are we having this meeting? What do we hope to walk in and accomplish?"
          />
        </div>
        <div>
          <div style={sx.fieldLabel}>End In Mind</div>
          <textarea
            style={sx.textarea}
            value={formData.fieldValues.endInMind || ''}
            onChange={e => updateField('endInMind', e.target.value)}
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
          return (
            <div key={f.key} style={f.type === 'textarea' ? { gridColumn: 'span 2' } : undefined}>
              <div style={sx.fieldLabel}>
                {f.label}
                {notCurrentClient && (
                  <span style={{ marginLeft: '0.4rem' }}>
                    – Not Current Client
                  </span>
                )}
              </div>
              {f.type === 'textarea' ? (
                <textarea
                  style={sx.textarea}
                  value={formData.fieldValues[f.key] || ''}
                  onChange={e => updateField(f.key, e.target.value)}
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
                <input
                  type={f.type === 'date' ? 'date' : 'text'}
                  style={sx.input}
                  value={formData.fieldValues[f.key] || ''}
                  onChange={e => updateField(f.key, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {renderTables(bottomTables)}
    </div>
  );
}
