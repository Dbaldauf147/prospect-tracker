import { useState, useEffect, useMemo, useRef } from 'react';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';

// Default form schema. Edit these arrays to change the template.
// `autofill` is the Opps sheet column whose value should populate the field
// when an opportunity is linked.
export const DEFAULT_FORM_TEMPLATE = {
  fields: [
    { key: 'stage', label: 'Stage', type: 'text', autofill: 'Stage' },
    { key: 'status', label: 'Status', type: 'text', autofill: 'Status' },
    { key: 'scope', label: 'Scope', type: 'text', autofill: 'Scope' },
    { key: 'quotedAmount', label: 'Quoted Amount', type: 'text', autofill: 'Quoted Amount' },
    { key: 'startDate', label: 'Start Date', type: 'text', autofill: 'Start Date' },
    { key: 'closeDate', label: 'Close Date', type: 'text', autofill: 'Close Date' },
    { key: 'summary', label: 'Meeting Summary / Notes', type: 'textarea' },
    { key: 'nextSteps', label: 'Next Steps', type: 'textarea' },
  ],
  tables: [
    {
      key: 'actionItems',
      label: 'Action Items',
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
  return { fieldValues, tables, linkedBfoLink: null, meeting: null };
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

export function OpportunityForm({ value, onChange, onLinkOpp, companyName, companyContacts = [], allHubspotContacts = [], contactNotes = {}, onCreateContact }) {
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
      meeting: value.meeting || null,
    };
  }, [value, template]);

  const set = (next) => onChange({ ...formData, ...next });

  const updateField = (key, val) => {
    set({ fieldValues: { ...formData.fieldValues, [key]: val } });
  };

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
    set({
      fieldValues: nextValues,
      linkedBfoLink: opp['BFO Link'] || null,
    });
    if (onLinkOpp) onLinkOpp(opp);
    setPickerOpen(false);
    setSearch('');
  };

  const unlinkOpp = () => set({ linkedBfoLink: null });

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

  // ---- Export to Excel ----
  const exportExcel = async () => {
    try {
      const { Workbook } = await import('exceljs');
      const wb = new Workbook();
      wb.creator = 'Prospect Tracker';
      wb.created = new Date();
      const ws = wb.addWorksheet('Opportunity', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      ws.columns = [{ width: 28 }, { width: 60 }];

      const HEADER_FILL = 'FF009530';
      const BORDER = { style: 'thin', color: { argb: 'FFD4DDE1' } };

      const addSectionHeader = (text) => {
        const row = ws.addRow([text, '']);
        ws.mergeCells(row.number, 1, row.number, 2);
        const cell = row.getCell(1);
        cell.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        row.height = 22;
      };

      const addFieldRow = (label, value) => {
        const row = ws.addRow([label, value]);
        row.getCell(1).font = { name: 'Nunito Sans', bold: true, size: 10 };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9F4' } };
        row.getCell(1).alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
        row.getCell(2).font = { name: 'Nunito Sans', size: 10 };
        row.getCell(2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        row.getCell(1).border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
        row.getCell(2).border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
      };

      // Title
      const titleRow = ws.addRow([`${companyName || 'Opportunity'}`, '']);
      ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
      const titleCell = titleRow.getCell(1);
      titleCell.value = `${companyName || 'Opportunity'}`;
      titleCell.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3DCD58' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      titleRow.height = 28;

      ws.addRow([]);
      addSectionHeader('Details');
      for (const f of template.fields) {
        addFieldRow(f.label, formData.fieldValues[f.key] || '');
      }

      for (const t of template.tables) {
        ws.addRow([]);
        addSectionHeader(t.label);
        // Table header
        const hRow = ws.addRow(t.columns.map(c => c.label));
        // Extend worksheet columns to accommodate table
        while (ws.columnCount < t.columns.length) {
          ws.getColumn(ws.columnCount + 1).width = 22;
        }
        hRow.eachCell((cell, col) => {
          if (col > t.columns.length) return;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
        });
        const rows = formData.tables[t.key] || [];
        for (const r of rows) {
          const values = t.columns.map(c => r[c.key] || '');
          const row = ws.addRow(values);
          row.eachCell((cell, col) => {
            if (col > t.columns.length) return;
            cell.font = { name: 'Nunito Sans', size: 10 };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
          });
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const safeName = (companyName || 'Opportunity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName} - Opportunity.xlsx`;
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
            <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
              Linked to BFO: <code>{formData.linkedBfoLink}</code>
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
                            {renderGroupedList(seAttendees)}
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

      <div style={sx.grid}>
        {template.fields.map(f => (
          <div key={f.key} style={f.type === 'textarea' ? { gridColumn: 'span 2' } : undefined}>
            <div style={sx.fieldLabel}>{f.label}</div>
            {f.type === 'textarea' ? (
              <textarea
                style={sx.textarea}
                value={formData.fieldValues[f.key] || ''}
                onChange={e => updateField(f.key, e.target.value)}
              />
            ) : (
              <input
                type={f.type === 'date' ? 'date' : 'text'}
                style={sx.input}
                value={formData.fieldValues[f.key] || ''}
                onChange={e => updateField(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {template.tables.map(t => (
        <div key={t.key}>
          <div style={sx.sectionTitle}>{t.label}</div>
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
                  {t.columns.map(c => (
                    <td key={c.key} style={sx.td}>
                      <input
                        style={sx.cellInput}
                        value={row[c.key] || ''}
                        onChange={e => updateTableCell(t.key, rIdx, c.key, e.target.value)}
                      />
                    </td>
                  ))}
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
        </div>
      ))}
    </div>
  );
}
