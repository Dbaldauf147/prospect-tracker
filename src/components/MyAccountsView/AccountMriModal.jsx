// The Account MRI popup: one company's Account MRI as the seven tabs of
// the intake template (My Accounts > Strategic Accounts > Account MRI,
// click a company).
//
// Tab 1, the buying committee and the site list open already filled from
// the tracker, through the same mapping the export uses
// (utils/accountMri.js). Everything typed here is saved per company under
// settings.accountMri and laid over the tracker's answers, and the Export
// button writes all of it into the template. The form's shape, lists and
// scoring live in utils/accountMriForm.js.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MRI_LISTS, MRI_TABS, PROFILE_SECTIONS, BODY_SYSTEMS, OPPORTUNITY_SECTIONS, BUY_STATEMENTS, OURS_STATEMENTS,
  WIN_LEVELS, WIN_MATRIX, MRI_TABLES, mergeProfile, systemScore, dealHealthScore, committeeRows,
  addMissingDecisionMakers, tabProgress, DEFAULT_SIGNALS, diagnosisNotes, mriFormExport, formatMoneyInput, formatNumberInput, mergeSignals, withTrackerSignals,
} from '../../utils/accountMriForm';
import { downloadAccountMri } from '../../utils/accountMriDownload';
import { DataTable } from '../common/DataTable';

// The MRI tool's own look: warm paper, ink, one brick red for the scores.
const INK = '#1F1D1A';
const MUTED = '#6B675F';
const PAPER = '#F2F0EB';
const FIELD = '#FAF9F5';
const LINE = '#DAD6CC';
const BRICK = '#A8443A';
const AMBER = '#C08A2B';
const SAGE = '#5E7B5A';
const LEVEL_FILL = { Absent: INK, Low: '#8A8578', Moderate: AMBER, Strong: BRICK };

const labelStyle = { display: 'block', fontSize: '0.66rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.65rem', fontSize: '0.84rem', fontFamily: 'inherit', color: INK, background: FIELD, border: `1px solid ${LINE}`, borderRadius: 2 };
// Anything still to fill in on the form is outlined in red.
const MISSING = '#DC2626';
const isMissing = v => v == null || String(v).trim() === '';
const missingOutline = v => (isMissing(v) ? { borderColor: MISSING, boxShadow: `0 0 0 1px ${MISSING}` } : null);
const sectionTitle = { fontSize: '0.86rem', fontWeight: 700, color: INK };
const sectionHint = { fontSize: '0.7rem', fontWeight: 600, color: MUTED, marginLeft: 8 };
const sectionBox = { borderTop: `1px solid ${LINE}`, paddingTop: '0.9rem', marginTop: '1.1rem' };
const ghostButton = { fontSize: '0.74rem', fontFamily: 'inherit', padding: '0.35rem 0.75rem', border: `1px solid ${LINE}`, background: FIELD, color: INK, borderRadius: 2, cursor: 'pointer' };

const newId = () => `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const pct = n => `${Math.round(n * 100)}%`;

// A money box that formats as it is typed: "$1,350,000". The caret is put
// back after the same number of digits it followed, so typing or deleting
// in the middle doesn't throw it to the end when a comma comes or goes.
function MoneyInput({ value, onChange, prefix = '$' }) {
  const ref = useRef(null);
  const caretDigits = useRef(null);
  const format = v => (prefix === '$' ? formatMoneyInput(v) : formatNumberInput(v, prefix));
  const shown = format(value);
  useLayoutEffect(() => {
    const el = ref.current;
    const want = caretDigits.current;
    if (!el || want == null || document.activeElement !== el) return;
    caretDigits.current = null;
    let pos = prefix ? el.value.indexOf(prefix) + 1 : (el.value.startsWith('-') ? 1 : 0);
    for (let seen = 0; pos < el.value.length && seen < want; pos++) {
      if (/[\d.]/.test(el.value[pos])) seen++;
    }
    el.setSelectionRange(pos, pos);
  });
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      placeholder={`${prefix}0`}
      value={shown}
      onChange={e => {
        const before = e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length);
        caretDigits.current = (before.match(/[\d.]/g) || []).length;
        onChange(format(e.target.value));
      }}
      style={{ ...inputStyle, ...missingOutline(shown) }}
    />
  );
}

// One control for every kind of field the form has.
function Field({ field, value, onChange, hint, onReset }) {
  const style = { ...inputStyle, ...missingOutline(value) };
  const common = { value: value ?? '', onChange: e => onChange(e.target.value), style };
  let control;
  if (field.type === 'select') {
    const options = MRI_LISTS[field.list] || [];
    const current = String(value ?? '');
    control = (
      <select {...common}>
        <option value="">-</option>
        {/* A tracker value off the template's list (a Status the MRI has no stage for) still shows. */}
        {current && !options.includes(current) && <option value={current}>{current}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = <textarea {...common} rows={field.tall ? 5 : 3} style={{ ...style, resize: 'vertical', lineHeight: 1.4 }} />;
  } else if (field.type === 'date') {
    control = <input type="date" {...common} />;
  } else if (field.type === 'money') {
    control = <MoneyInput value={value} onChange={onChange} />;
  } else if (field.type === 'count') {
    control = <MoneyInput value={value} onChange={onChange} prefix="" />;
  } else if (field.type === 'number' || field.type === 'percent') {
    control = <input type="number" step="any" {...common} />;
  } else {
    control = <input type="text" placeholder={field.placeholder || ''} {...common} />;
  }
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>
        {field.label}
        {hint && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, marginLeft: 6, color: SAGE }}>{hint}</span>}
        {onReset && (
          <button type="button" onClick={onReset} title="Drop what was typed here and show the tracker's value again" style={{ marginLeft: 6, padding: 0, border: 'none', background: 'none', font: 'inherit', textTransform: 'none', letterSpacing: 0, color: BRICK, cursor: 'pointer', textDecoration: 'underline' }}>use tracker</button>
        )}
      </label>
      {control}
    </div>
  );
}

// Fields that read better across the whole width of their section.
const FULL_WIDTH = new Set(['mainContact', 'competitors', 'background', 'services', 'upsell']);

function ProfileTab({ profile, typed, tracker, onChange, onReset }) {
  const section = key => PROFILE_SECTIONS.find(s => s.key === key);
  const draw = (s, columns) => (
    <div>
      <div><span style={sectionTitle}>{s.title}</span>{s.hint && <span style={sectionHint}>{s.hint}</span>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '0.75rem 0.8rem', marginTop: '0.6rem' }}>
        {s.fields.map((f) => {
          const hasTracker = !!f.source && tracker[f.key] != null && tracker[f.key] !== '';
          const own = !!typed[f.key];
          return (
            <div key={f.key} style={{ gridColumn: FULL_WIDTH.has(f.key) ? '1 / -1' : 'auto' }}>
              <Field
                field={f}
                value={profile[f.key]}
                onChange={v => onChange(f.key, v)}
                hint={!own && hasTracker ? `from ${f.source}` : ''}
                onReset={own && f.source ? () => onReset(f.key) : null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0 2rem', ...sectionBox, marginTop: 0 }}>
        {draw(section('account'), 2)}
        {draw(section('background'), 2)}
      </div>
      <div style={sectionBox}>{draw(section('commercials'), 4)}</div>
      <div style={{ fontSize: '0.72rem', color: MUTED, marginTop: '0.9rem' }}>
        Fields marked "from ..." show the tracker's own value. Typing in one keeps what you typed for this Account MRI only; the company record is not changed.
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange, fill }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 2, overflow: 'hidden', flexShrink: 0, ...missingOutline(value) }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? '' : o)}
            title={on ? 'Click again to clear' : o}
            style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', padding: '0.22rem 0.5rem', border: 'none', cursor: 'pointer', background: on ? (fill?.[o] || INK) : FIELD, color: on ? '#fff' : MUTED }}
          >{o}</button>
        );
      })}
    </div>
  );
}

function DiagnosisTab({ diagnosis, tracker = {}, trackerNoteFor = {}, onChange }) {
  const signals = mergeSignals(tracker, diagnosis.signals);
  const notes = diagnosisNotes({ ...trackerNoteFor, ...(diagnosis.notes || {}) });
  const set = (group, key, value) => {
    const next = { ...(diagnosis[group] || {}) };
    // A rating with a default (DEFAULT_SIGNALS) or a tracker rating is kept
    // as '' when cleared, so that rating doesn't come straight back.
    // Intel notes have a default too (DEFAULT_INTEL_NOTE), so an emptied box
    // is kept as '' as well.
    const keepBlank = (group === 'signals' && (DEFAULT_SIGNALS[key] || tracker[key])) || group === 'notes';
    if (value === '' && !keepBlank) delete next[key]; else next[key] = value;
    onChange({ ...diagnosis, [group]: next });
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '0.9rem' }}>
        {BODY_SYSTEMS.map((system) => {
          const score = systemScore(system, signals);
          const edge = score.pct >= 67 ? BRICK : score.pct >= 34 ? AMBER : LINE;
          return (
            <div key={system.key} style={{ background: FIELD, border: `1px solid ${LINE}`, borderLeft: `3px solid ${edge}`, padding: '0.9rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: INK }}>{system.name}</div>
                  <div style={{ fontSize: '0.76rem', color: MUTED }}>{system.focus}</div>
                </div>
                <div style={{ textAlign: 'right' }} title={`Signal score ${score.sum} of 12 (${score.rated} of 4 rated)`}>
                  <div style={{ fontSize: '1.45rem', lineHeight: 1, color: score.rated ? BRICK : '#B5B0A4' }}>{score.pct}</div>
                  <div style={{ fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.1em', color: MUTED }}>POTENTIAL OPP.</div>
                </div>
              </div>
              <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
                {system.signs.map(sign => (
                  <div key={sign.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: '0.8rem', color: INK }}>
                      {sign.label}
                      {tracker[sign.key] && diagnosis.signals?.[sign.key] === undefined && (
                        <span style={{ marginLeft: 6, fontSize: '0.68rem', fontWeight: 500, color: SAGE }} title="Rated from the company's Targets tab until you pick a rating here">from Targets</span>
                      )}
                    </span>
                    <Segmented options={MRI_LISTS.level} value={signals[sign.key] || ''} fill={LEVEL_FILL} onChange={v => set('signals', sign.key, v)} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '0.8rem' }}>
                <Field
                  field={{ label: 'Schneider footprint', type: 'select', list: 'footprint' }}
                  value={diagnosis.footprint?.[system.key] || ''}
                  onChange={v => set('footprint', system.key, v)}
                />
              </div>
              <div style={{ marginTop: '0.7rem' }}>
                <Field
                  field={{ label: 'Intel notes', type: 'textarea' }}
                  hint={trackerNoteFor[system.key] && diagnosis.notes?.[system.key] === undefined ? 'from Targets' : ''}
                  value={notes[system.key]}
                  onChange={v => set('notes', system.key, v)}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div style={sectionBox}>
        <Field
          field={{ label: 'Raw intel for Auto-Diagnose (optional): call notes, 10-K / ESG excerpts or RFP text', type: 'textarea', tall: true }}
          value={diagnosis.rawIntel || ''}
          onChange={v => onChange({ ...diagnosis, rawIntel: v })}
        />
      </div>
    </div>
  );
}

const cellInput = { ...inputStyle, padding: '0.3rem 0.45rem', fontSize: '0.8rem' };

// One of the form's list tables, edited in place. Drawn by the shared
// DataTable so its columns carry the house column formatting.
function EditGrid({ tableId, def, rows, onChange, addLabel, actions, settings, updateSettings, exportFileName, emptyMessage }) {
  // Latest rows for the cell handlers, so the columns need not be rebuilt
  // (and every input remounted) on each keystroke.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const patch = useCallback((id, key, value) => {
    onChange(rowsRef.current.map(r => (r.id === id ? { ...r, [key]: value } : r)));
  }, [onChange]);
  const remove = useCallback((id) => onChange(rowsRef.current.filter(r => r.id !== id)), [onChange]);

  const columns = useMemo(() => [
    ...def.columns.map(c => ({
      key: c.key,
      label: c.label,
      defaultWidth: c.width,
      getSortValue: r => {
        const v = r[c.key];
        if (v == null || v === '') return null;
        return c.type === 'number' && Number.isFinite(Number(v)) ? Number(v) : String(v).toLowerCase();
      },
      getFilterValue: r => String(r[c.key] ?? ''),
      exportValue: r => r[c.key] ?? '',
      render: (r) => {
        const value = r[c.key] ?? '';
        if (c.list) {
          const options = MRI_LISTS[c.list];
          return (
            <select value={value} onChange={e => patch(r.id, c.key, e.target.value)} style={{ ...cellInput, ...missingOutline(value) }}>
              <option value="">-</option>
              {value && !options.includes(value) && <option value={value}>{value}</option>}
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        }
        return (
          <input
            type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
            value={value}
            onChange={e => patch(r.id, c.key, e.target.value)}
            style={{ ...cellInput, ...missingOutline(value) }}
          />
        );
      },
    })),
    {
      key: '_remove', label: '', defaultWidth: 44,
      render: r => (
        <button type="button" onClick={() => remove(r.id)} title="Remove this row" style={{ border: 'none', background: 'none', color: MUTED, fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
      ),
    },
  ], [def, patch, remove]);

  const toolbarActions = useMemo(() => [
    ...(actions || []),
    { key: 'add', label: addLabel, title: 'Add a blank row at the end', onClick: () => onChange([...rowsRef.current, { id: newId() }]) },
  ], [actions, addLabel, onChange]);

  return (
    <div style={{ height: Math.min(520, 150 + Math.max(1, rows.length) * 42), display: 'flex', flexDirection: 'column', border: `1px solid ${LINE}`, background: '#fff' }}>
      <DataTable
        tableId={tableId}
        exportFileName={exportFileName}
        columns={columns}
        rows={rows}
        alwaysVisible={[def.columns[0].key, '_remove']}
        emptyMessage={emptyMessage}
        settings={settings}
        updateSettings={updateSettings}
        toolbarActions={toolbarActions}
        variableRowHeight
      />
    </div>
  );
}

function RatingBlock({ title, statements, list, ratings, block, onRate }) {
  const th = { textAlign: 'left', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED, padding: '0.35rem 0.5rem', borderBottom: `1px solid ${LINE}` };
  const td = { padding: '0.45rem 0.5rem', borderBottom: `1px solid ${LINE}`, fontSize: '0.8rem', color: INK, verticalAlign: 'top' };
  const tint = block.level === 'HIGH' ? SAGE : block.level === 'MED' ? AMBER : BRICK;
  return (
    <div>
      <div style={sectionTitle}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(160px, 1.1fr) minmax(200px, 2fr) 190px 60px', marginTop: '0.5rem', background: FIELD, border: `1px solid ${LINE}` }}>
        {['#', 'Statement', 'What it means', 'Rating', 'Score'].map(h => <div key={h} style={th}>{h}</div>)}
        {statements.map((s, i) => [
          <div key={`${s.key}n`} style={td}>{i + 1}</div>,
          <div key={`${s.key}l`} style={{ ...td, fontWeight: 600 }}>{s.label}</div>,
          <div key={`${s.key}m`} style={{ ...td, color: MUTED }}>{s.meaning}</div>,
          <div key={`${s.key}r`} style={td}>
            <select value={ratings?.[s.key] || ''} onChange={e => onRate(s.key, e.target.value)} style={{ ...cellInput, ...missingOutline(ratings?.[s.key]) }}>
              <option value="">-</option>
              {list.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>,
          <div key={`${s.key}s`} style={{ ...td, textAlign: 'right' }}>{block.scores[i]}</div>,
        ])}
        <div style={{ ...td, borderBottom: 'none' }} />
        <div style={{ ...td, borderBottom: 'none', fontWeight: 700 }}>Total (of {block.max})</div>
        <div style={{ ...td, borderBottom: 'none' }} />
        <div style={{ ...td, borderBottom: 'none' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: tint, padding: '2px 10px', borderRadius: 2 }}>{block.level}</span>
        </div>
        <div style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 700 }}>{block.total}</div>
      </div>
    </div>
  );
}

function DealHealthTab({ dealHealth, stage, onChange, grid }) {
  const score = dealHealthScore(dealHealth, stage);
  const rate = (group, key, value) => {
    const next = { ...(dealHealth[group] || {}) };
    if (value === '') delete next[key]; else next[key] = value;
    onChange({ ...dealHealth, [group]: next });
  };
  const live = score.winProbability > 0;
  const cell = { padding: '0.4rem 0.9rem', fontSize: '0.8rem', textAlign: 'center', border: `1px solid ${LINE}` };
  return (
    <div>
      <RatingBlock title="Will they buy? (Sales Probability Index)" statements={BUY_STATEMENTS} list={MRI_LISTS.agree} ratings={dealHealth.buy} block={score.buy} onRate={(k, v) => rate('buy', k, v)} />
      <div style={{ marginTop: '1.1rem' }}>
        <RatingBlock title="Will they buy ours?" statements={OURS_STATEMENTS} list={MRI_LISTS.advantage} ratings={dealHealth.ours} block={score.ours} onRate={(k, v) => rate('ours', k, v)} />
      </div>
      <div style={{ ...sectionBox, display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={sectionTitle}>Win probability</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', marginTop: '0.5rem', background: FIELD }}>
            <div style={{ ...cell, color: MUTED, fontSize: '0.68rem' }}>Ours ↓ · Buy →</div>
            {WIN_LEVELS.map(l => <div key={l} style={{ ...cell, fontWeight: 700 }}>{l}</div>)}
            {['HIGH', 'MED', 'LOW'].map(ours => [
              <div key={ours} style={{ ...cell, fontWeight: 700 }}>{ours}</div>,
              ...WIN_LEVELS.map((buy, i) => {
                const here = live && score.ours.level === ours && score.buy.level === buy;
                return <div key={`${ours}${buy}`} style={{ ...cell, background: here ? BRICK : FIELD, color: here ? '#fff' : INK, fontWeight: here ? 700 : 400 }}>{pct(WIN_MATRIX[ours][i])}</div>;
              }),
            ])}
          </div>
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={labelStyle}>Win probability</div>
          <div style={{ fontSize: '2rem', lineHeight: 1.1, color: live ? BRICK : '#B5B0A4' }}>{pct(score.winProbability)}</div>
          <div style={{ ...labelStyle, marginTop: '0.8rem' }}>Suggested max for current stage</div>
          <div style={{ fontSize: '1.1rem', color: INK }}>{score.stageCap == null ? '-' : pct(score.stageCap)}{stage ? <span style={{ fontSize: '0.74rem', color: MUTED, marginLeft: 8 }}>{stage}</span> : null}</div>
        </div>
        <div style={{ flex: 1, minWidth: 260, fontSize: '0.72rem', color: MUTED, lineHeight: 1.5 }}>
          Buy is HIGH at 19 or more and MED at 12 or more; Ours is HIGH at 15 or more and MED at 10 or more. A level caps at MED if any "Will they buy?" rating is below Neutral, or any "Will they buy ours?" is a Clear disadvantage or Unknown. Win probability stays at 0% until both blocks have a rating.
        </div>
      </div>
      <div style={sectionBox}>
        <div style={{ marginBottom: '0.5rem' }}><span style={sectionTitle}>Decision process & criteria</span><span style={sectionHint}>from Opportunity Plan › Decision Grid</span></div>
        {grid('decisionGrid', dealHealth.decisionGrid || [], rows => onChange({ ...dealHealth, decisionGrid: rows }), '+ Add step', 'No decision steps yet')}
      </div>
      <div style={sectionBox}>
        <div style={{ marginBottom: '0.5rem' }}><span style={sectionTitle}>Yellow lights</span><span style={sectionHint}>from Opportunity Plan › Yellow Lights</span></div>
        {grid('yellowLights', dealHealth.yellowLights || [], rows => onChange({ ...dealHealth, yellowLights: rows }), '+ Add yellow light', 'No yellow lights yet')}
      </div>
    </div>
  );
}

const SITE_COLUMNS = [
  ['name', 'Facility name', 260], ['country', 'Country', 110], ['location', 'Location', 180], ['function', 'Function', 170],
  ['elec', 'Elec consumption', 150, true], ['elecUnits', 'Elec units', 100], ['fuel', 'Fuel consumption', 150, true], ['fuelUnits', 'Fuel units', 100],
].map(([key, label, defaultWidth, numeric]) => ({
  key,
  label,
  defaultWidth,
  getSortValue: r => (r[key] == null || r[key] === '' ? null : numeric ? r[key] : String(r[key]).toLowerCase()),
  getFilterValue: r => String(r[key] ?? ''),
  exportValue: r => r[key] ?? '',
  render: r => (r[key] == null || r[key] === ''
    ? <span title="Missing" style={{ color: '#CBD5E1', display: 'block', border: `1px solid ${MISSING}`, borderRadius: 2, padding: '0 4px' }}>-</span>
    : <span style={{ color: '#475569' }}>{numeric ? Number(r[key]).toLocaleString() : r[key]}</span>),
}));

function SitesTab({ sites, company, settings, updateSettings }) {
  const rows = useMemo(() => sites.map((s, i) => ({ id: `s${i}`, ...s })), [sites]);
  const total = key => sites.reduce((t, r) => t + (Number.isFinite(Number(r[key])) ? Number(r[key]) : 0), 0);
  const unit = key => {
    const units = [...new Set(sites.map(r => r[key]).filter(Boolean))];
    return units.length === 1 ? ` ${units[0]}` : '';
  };
  const stat = (label, value) => (
    <div style={{ background: FIELD, border: `1px solid ${LINE}`, padding: '0.6rem 0.9rem', minWidth: 170 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: '1.15rem', color: INK }}>{value}</div>
    </div>
  );
  return (
    <div>
      <div><span style={sectionTitle}>Client site utility summary</span><span style={sectionHint}>from Opportunity Plan › Efficiency Site Utility Summary</span></div>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', margin: '0.6rem 0 0.9rem' }}>
        {stat('Site count', sites.length.toLocaleString())}
        {stat('Total electric', `${total('elec').toLocaleString()}${unit('elecUnits')}`)}
        {stat('Total fuel', `${total('fuel').toLocaleString()}${unit('fuelUnits')}`)}
      </div>
      <div style={{ height: 460, display: 'flex', flexDirection: 'column', border: `1px solid ${LINE}`, background: '#fff' }}>
        <DataTable
          tableId="account-mri-popup-sites"
          exportFileName={`${company} Sites and Utilities`}
          columns={SITE_COLUMNS}
          rows={rows}
          alwaysVisible={['name']}
          emptyMessage="No site list is saved for this company yet"
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
      <div style={{ fontSize: '0.72rem', color: MUTED, marginTop: '0.6rem' }}>
        These are the sites still open on the site list saved on the company popup, one row per facility. To change them, edit that site list; this tab follows it.
      </div>
    </div>
  );
}

/**
 * `row` is the Account MRI table's row for the company: { company, record,
 * profile (the tracker's tab 1), committee (its decision makers), sites }.
 * `form` is what is saved for it and `onSave(next)` saves it.
 */
export function AccountMriModal({ row, form: savedForm, onSave, onClose, onOpenCompany, settings, updateSettings }) {
  const [tab, setTab] = useState('profile');
  const [form, setForm] = useState(() => savedForm || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Typing saves a little after it stops, and at once on close.
  const dirtyRef = useRef(null);
  const timerRef = useRef(null);
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (dirtyRef.current) { saveRef.current(dirtyRef.current); dirtyRef.current = null; }
  }, []);
  const change = useCallback((mutate) => {
    setForm((prev) => {
      const next = mutate(prev);
      dirtyRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 700);
      return next;
    });
  }, [flush]);
  useEffect(() => flush, [flush]);

  const merged = useMemo(() => mergeProfile(row.profile, form.profile), [row.profile, form.profile]);
  const committee = useMemo(
    () => committeeRows(form.committee, row.committee).map((r, i) => (r.id ? r : { ...r, id: `t_${String(r.email || r.name || i).toLowerCase()}` })),
    [form.committee, row.committee],
  );
  // The form with the tracker's Diagnosis ratings filled in where none was picked.
  const signalsFromTracker = row.trackerSignals;
  const notesFromTracker = row.trackerNotes;
  const effectiveForm = useMemo(() => withTrackerSignals(form, signalsFromTracker, notesFromTracker), [form, signalsFromTracker, notesFromTracker]);
  const progress = useMemo(
    () => tabProgress({ form: effectiveForm, profile: merged.values, committee, sites: row.sites }),
    [effectiveForm, merged, committee, row.sites],
  );

  const setKey = useCallback((key, value) => change(prev => ({ ...prev, [key]: value })), [change]);
  const setCommittee = useCallback(rows => setKey('committee', rows), [setKey]);
  const setPursuit = useCallback(rows => setKey('pursuitTeam', rows), [setKey]);
  const setEvidence = useCallback(rows => setKey('evidence', rows), [setKey]);
  const setClosePlan = useCallback(rows => setKey('closePlan', rows), [setKey]);

  const grid = (name, rows, onChange, addLabel, emptyMessage, actions) => (
    <EditGrid
      tableId={`account-mri-popup-${name}`}
      exportFileName={`${row.company} ${addLabel.replace(/^\+ Add /, '')}`}
      def={MRI_TABLES[name]}
      rows={rows}
      onChange={onChange}
      addLabel={addLabel}
      emptyMessage={emptyMessage}
      actions={actions}
      settings={settings}
      updateSettings={updateSettings}
    />
  );

  const missing = useMemo(
    () => addMissingDecisionMakers(committee, row.committee).length - committee.length,
    [committee, row.committee],
  );
  const committeeActions = useMemo(() => (missing > 0 ? [{
    key: 'pull',
    label: `Add ${missing} from tracker`,
    title: 'Add the decision makers tagged on the company that are not on this list yet',
    onClick: () => setCommittee(addMissingDecisionMakers(committee, row.committee).map(r => (r.id ? r : { ...r, id: newId() }))),
  }] : []), [missing, committee, row.committee, setCommittee]);

  const exportNow = async () => {
    flush();
    setBusy(true);
    setError('');
    try {
      await downloadAccountMri({
        company: row.company,
        profile: merged.values,
        committee,
        sites: row.sites,
        extra: mriFormExport(effectiveForm),
      });
    } catch (err) {
      setError(err?.message || 'The export failed.');
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (tab === 'profile') {
    body = (
      <ProfileTab
        profile={merged.values}
        typed={merged.typed}
        tracker={row.profile}
        onChange={(key, value) => change(prev => ({ ...prev, profile: { ...(prev.profile || {}), [key]: value } }))}
        onReset={key => change((prev) => {
          const next = { ...(prev.profile || {}) };
          delete next[key];
          return { ...prev, profile: next };
        })}
      />
    );
  } else if (tab === 'diagnosis') {
    body = <DiagnosisTab diagnosis={form.diagnosis || {}} tracker={row.trackerSignals || {}} trackerNoteFor={row.trackerNotes || {}} onChange={next => setKey('diagnosis', next)} />;
  } else if (tab === 'committee') {
    body = (
      <div>
        <div style={{ marginBottom: '0.5rem' }}><span style={sectionTitle}>Key people & buying committee</span><span style={sectionHint}>from Opportunity Plan › Key People</span></div>
        {grid('committee', committee, setCommittee, '+ Add stakeholder', 'No stakeholders yet. Tag decision makers on the company, or add one here.', committeeActions)}
        <div style={{ fontSize: '0.72rem', color: MUTED, marginTop: '0.5rem' }}>
          Starts as the contacts tagged Decision Maker on the company. Once you edit the list it is kept as you leave it for this Account MRI.
        </div>
        <div style={sectionBox}>
          <div style={{ ...sectionTitle, marginBottom: '0.5rem' }}>Our pursuit team</div>
          {grid('pursuitTeam', form.pursuitTeam || [], setPursuit, '+ Add team member', 'Nobody on the pursuit team yet')}
        </div>
      </div>
    );
  } else if (tab === 'opportunity') {
    const values = form.opportunity || {};
    body = (
      <div>
        {OPPORTUNITY_SECTIONS.map((s, i) => (
          <div key={s.title} style={i ? sectionBox : undefined}>
            <div><span style={sectionTitle}>{s.title}</span>{s.hint && <span style={sectionHint}>{s.hint}</span>}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem 0.8rem', marginTop: '0.6rem' }}>
              {s.fields.map(f => (
                <div key={f.key} style={{ gridColumn: f.tall ? '1 / -1' : 'auto' }}>
                  <Field field={f} value={values[f.key]} onChange={v => change(prev => ({ ...prev, opportunity: { ...(prev.opportunity || {}), [f.key]: v } }))} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={sectionBox}>
          <div style={{ marginBottom: '0.5rem' }}><span style={sectionTitle}>Evidence ledger · issue → evidence → impact</span><span style={sectionHint}>from Opportunity Plan › Opportunity Worksheet</span></div>
          {grid('evidence', form.evidence || [], setEvidence, '+ Add issue', 'No issues on the ledger yet')}
        </div>
      </div>
    );
  } else if (tab === 'sites') {
    body = <SitesTab sites={row.sites} company={row.company} settings={settings} updateSettings={updateSettings} />;
  } else if (tab === 'dealHealth') {
    body = <DealHealthTab dealHealth={form.dealHealth || {}} stage={merged.values.stage} onChange={next => setKey('dealHealth', next)} grid={grid} />;
  } else {
    body = (
      <div>
        <div style={{ marginBottom: '0.5rem' }}><span style={sectionTitle}>Activities to close</span><span style={sectionHint}>from Opportunity Plan › Close Plan</span></div>
        {grid('closePlan', form.closePlan || [], setClosePlan, '+ Add activity', 'No activities yet')}
      </div>
    );
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
    >
      <div role="dialog" aria-label={`Account MRI for ${row.company}`} style={{ background: PAPER, color: INK, width: 1700, maxWidth: '97vw', height: '94vh', display: 'flex', flexDirection: 'column', borderRadius: 6, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.9rem 1.4rem 0.6rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.1em', color: MUTED }}>ACCOUNT MRI</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company}</div>
          </div>
          {error && <span style={{ fontSize: '0.74rem', color: '#B91C1C' }}>{error}</span>}
          {onOpenCompany && <button type="button" onClick={onOpenCompany} title="Open the company's own popup" style={ghostButton}>Open company</button>}
          <button type="button" onClick={exportNow} disabled={busy} title="Download the Account MRI intake template filled in with all seven tabs" style={{ ...ghostButton, background: INK, color: '#fff', borderColor: INK, opacity: busy ? 0.6 : 1 }}>{busy ? 'Exporting...' : 'Export Account MRI'}</button>
          <button type="button" onClick={onClose} title="Close" style={{ border: 'none', background: 'none', fontSize: '1.4rem', color: MUTED, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: '0.2rem', padding: '0 1.4rem', borderBottom: `1px solid ${LINE}`, overflowX: 'auto', flexShrink: 0 }}>
          {MRI_TABS.map((t, i) => {
            const on = t.key === tab;
            const done = progress[t.key] >= 100;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0.6rem 0.75rem', border: 'none', borderBottom: `2px solid ${on ? INK : 'transparent'}`, background: 'none', fontFamily: 'inherit', fontSize: '0.84rem', fontWeight: on ? 700 : 500, color: on ? INK : MUTED, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                <span style={{ width: 19, height: 19, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, background: done ? SAGE : 'transparent', color: done ? '#fff' : MUTED, border: done ? 'none' : `1px solid ${MUTED}` }}>{done ? '✓' : i + 1}</span>
                {t.label}
                {!done && <span style={{ fontSize: '0.66rem', color: MUTED, fontWeight: 500 }}>{progress[t.key]}%</span>}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.1rem 1.4rem 1.6rem' }}>{body}</div>
      </div>
    </div>,
    document.body,
  );
}
