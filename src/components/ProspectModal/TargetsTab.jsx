// Company popup > Targets: the company's sustainability targets, logged by
// hand. One row per target: its Action (Target or Commitment, as SBTi lists
// it), what kind it is (off the user's own list of
// types, see TargetTypeSelect), the year it was set, its base year, up to two
// target years, which of Scopes 1, 2 and 3 it covers, and when its five-yearly
// refresh falls due. Every cell edits in place and autosaves with the rest of
// the card. See utils/companyTargets for the stored shape.
// "Paste targets" takes a whole table at once, shaped like the SBTi target
// dashboard's Targets / Commitments table, or a target written as prose
// (see parsePastedTargets / parseFreeTextTargets). "Research targets" has
// Claude look them up on the web and returns them already in these columns
// (api/research-targets.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable } from '../common/DataTable';
import {
  TARGET_SCOPES, TARGET_ACTIONS, REFRESH_CYCLE_YEARS, blankTarget, normalizeTargets,
  updateTarget, removeTarget, refreshDue, scopesLabel,
  parsePastedTargets, mergePastedTargets, mergeResearchedTargets, NO_TARGET_TYPE, noTargetRow, hasNoTargetRow,
} from '../../utils/companyTargets';
import { addTargetTypeOption } from '../../utils/targetTypeOptions';
import { TargetTypeSelect } from './TargetTypeSelect';
import { useTargetTypeOptions } from './useTargetTypeOptions';
import { TargetSearchMenu } from './TargetSearchMenu';
import { apiFetch } from '../../utils/apiFetch';
import { bareDomain } from '../../utils/targetWebSearch';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '0.2rem 0.4rem', fontSize: '0.8rem',
  border: '1px solid #E2E8F0', borderRadius: 4, fontFamily: 'inherit', background: '#fff',
};
const yearStyle = { ...inputStyle, fontVariantNumeric: 'tabular-nums' };
const addBtn = {
  padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #2563EB', background: '#2563EB',
  color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const secondaryBtn = {
  ...addBtn, background: '#fff', color: '#2563EB',
};
const rowBtn = {
  background: 'none', border: '1px solid transparent', borderRadius: 4, padding: '0 6px',
  lineHeight: 1.2, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', color: '#94A3B8',
};

const REFRESH_COLORS = {
  overdue: { background: '#FEE2E2', color: '#991B1B' },
  due: { background: '#FEF3C7', color: '#92400E' },
  upcoming: { background: '#F1F5F9', color: '#334155' },
};

const YEAR_COLUMNS = [
  { key: 'yearSet', label: 'Year Set' },
  { key: 'baseYear', label: 'Base Year' },
  { key: 'targetYear1', label: 'Target Year 1' },
  { key: 'targetYear2', label: 'Target Year 2' },
];
const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
const TEXT_COLUMNS = [
  { key: 'classification', label: 'Classification', width: 130 },
  { key: 'status', label: 'Status', width: 150 },
  { key: 'datePublished', label: 'Date Published', width: 130 },
];

const previewCell = { padding: '0.25rem 0.5rem', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' };
const previewHead = { ...previewCell, fontWeight: 600, color: '#475569', background: '#F8FAFC', textAlign: 'left' };

const PREVIEW_HEADS = ['Action', 'Target Type', 'Commitment Type', 'Year Set', 'Base Year', 'Target Year', 'Scopes', 'Classification', 'Status', 'Date Published'];

// What is about to be added, read-only, in the table's own columns.
// `withDetail` adds the researched rows' one-line wording and source link.
function TargetPreviewTable({ rows, withDetail = false }) {
  if (!rows.length) return null;
  return (
    <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem' }}>
        <thead>
          <tr>
            {[...PREVIEW_HEADS, ...(withDetail ? ['As stated', 'Source'] : [])].map(h => (
              <th key={h} style={previewHead}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              <td style={previewCell}>{r.action || '-'}</td>
              <td style={previewCell}>{r.type || '-'}</td>
              <td style={previewCell}>{r.commitmentType || '-'}</td>
              <td style={previewCell}>{r.yearSet || '-'}</td>
              <td style={previewCell}>{r.baseYear || '-'}</td>
              <td style={previewCell}>{[r.targetYear1, r.targetYear2].filter(Boolean).join(', ') || '-'}</td>
              <td style={previewCell}>{scopesLabel(r) || '-'}</td>
              <td style={previewCell}>{r.classification || '-'}</td>
              <td style={previewCell}>{r.status || '-'}</td>
              <td style={previewCell}>{r.datePublished || '-'}</td>
              {withDetail && (
                <>
                  <td style={{ ...previewCell, whiteSpace: 'normal', minWidth: 260 }}>{r.detail || '-'}</td>
                  <td style={previewCell}>
                    {r.sourceUrl
                      ? <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB' }}>{bareDomain(r.sourceUrl) || 'Open'}</a>
                      : '-'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "Research targets": asks /api/research-targets (Claude with web search)
// for the company's targets and shows them, already in the table's columns
// and spellings, to check before adding. Nothing is saved until Add.
function ResearchTargetsPanel({ company, domain, typeOptions, existing, noTargetLogged, onAdd, onNoTarget, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [run, setRun] = useState(0);
  // The type list as it stood when the panel opened: a list that changes
  // mid-request must not start the search over.
  const typesRef = useRef(typeOptions);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await apiFetch('/api/research-targets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company, domain, types: typesRef.current }),
        });
        const txt = await r.text();
        let body = null;
        try { body = JSON.parse(txt); } catch { /* not JSON: reported below */ }
        if (!live) return;
        if (!r.ok || !body) {
          setState({ loading: false, data: null, error: body?.error || txt.slice(0, 200) || `HTTP ${r.status}` });
          return;
        }
        setState({ loading: false, data: body, error: '' });
      } catch (err) {
        if (live) setState({ loading: false, data: null, error: err?.message || 'Request failed' });
      }
    })();
    return () => { live = false; };
  }, [company, domain, run]);

  const found = useMemo(() => state.data?.targets || [], [state.data]);
  const merge = useMemo(() => mergeResearchedTargets(existing, found), [existing, found]);
  const changes = merge.added + merge.updated;
  const add = () => {
    if (!changes) return;
    for (const t of new Set(found.map(r => r.type).filter(Boolean))) addTargetTypeOption(t);
    onAdd(merge.list);
  };
  const again = () => { setState({ loading: true, data: null, error: '' }); setRun(n => n + 1); };
  const { data } = state;
  return (
    <div style={{ border: '1px solid #BFDBFE', background: '#F8FAFF', borderRadius: 8, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {state.loading && (
        <div role="status" style={{ fontSize: '0.8rem', color: '#334155' }}>
          Researching {company}'s targets on the web (SBTi dashboard, sustainability report, CDP). This takes up to a minute.
        </div>
      )}
      {state.error && (
        <div role="alert" style={{ fontSize: '0.8rem', color: '#991B1B' }}>Research failed: {state.error}</div>
      )}
      {data && (
        <>
          {data.summary && <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>{data.summary}</div>}
          {found.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: '#334155' }}>
              {data.noTargetFound ? 'No target was found for this company.' : 'Nothing that reads as a target came back.'}
            </div>
          )}
          <TargetPreviewTable rows={found} withDetail />
          {data.sources?.length > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#64748B', lineHeight: 1.6 }}>
              Sources:{' '}
              {data.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ', '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB' }}>{s.title || bareDomain(s.url)}</a>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {found.length > 0 && (
          <button type="button" onClick={add} disabled={!changes}
            style={{ ...addBtn, opacity: changes ? 1 : 0.5, cursor: changes ? 'pointer' : 'default' }}>
            {[
              merge.added ? `Add ${merge.added} target${merge.added === 1 ? '' : 's'}` : '',
              merge.updated ? `${merge.added ? 'fill' : 'Fill'} in ${merge.updated} already logged` : '',
            ].filter(Boolean).join(', ') || 'Nothing new to add'}
          </button>
        )}
        {data && found.length === 0 && data.noTargetFound && !noTargetLogged && existing.length === 0 && (
          <button type="button" onClick={onNoTarget} style={addBtn}>Log No Target Set</button>
        )}
        {!state.loading && (
          <button type="button" onClick={again} style={secondaryBtn}>Search again</button>
        )}
        <button type="button" onClick={onClose} style={secondaryBtn}>{state.loading ? 'Cancel' : 'Close'}</button>
        {found.length > 0 && (
          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
            {[
              `${found.length} target${found.length === 1 ? '' : 's'} found`,
              merge.duplicates - merge.updated ? `${merge.duplicates - merge.updated} already logged in full` : '',
              'check against the sources before adding',
            ].filter(Boolean).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}

// The paste box: a textarea, a preview of what it reads, and Add.
function PasteTargetsPanel({ existing, onAdd, onClose }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parsePastedTargets(text), [text]);
  const merge = useMemo(() => mergePastedTargets(existing, parsed.rows), [existing, parsed]);
  const changes = merge.added + merge.updated;
  const add = () => {
    if (!changes) return;
    for (const t of new Set(parsed.rows.map(r => r.type).filter(Boolean))) addTargetTypeOption(t);
    onAdd(merge.list);
  };
  return (
    <div style={{ border: '1px solid #BFDBFE', background: '#F8FAFF', borderRadius: 8, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
        Paste a targets table, header row optional. The SBTi dashboard's Targets / Commitments
        table works as copied: Action, Commitment Type, Status, Target, Scope, Target Classification,
        Base Year, Target Year, Date Published. The year it was published becomes the Year Set.
        Or paste a target written as text, such as a sentence from a sustainability report: each
        sentence naming a target year or a kind of target becomes a row. Check the preview before adding.
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste the table or the text here (Ctrl+V)"
        aria-label="Pasted targets"
        rows={5}
        style={{ ...inputStyle, fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
      />
      <TargetPreviewTable rows={parsed.rows} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={add}
          disabled={!changes}
          style={{ ...addBtn, opacity: changes ? 1 : 0.5, cursor: changes ? 'pointer' : 'default' }}
        >
          {!merge.added && merge.updated
            ? `Fill in ${merge.updated} target${merge.updated === 1 ? '' : 's'}`
            : `Add ${merge.added || ''} target${merge.added === 1 ? '' : 's'}`}
        </button>
        <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
          {!text.trim() ? ''
            : !parsed.rows.length ? 'No targets found in what was pasted.'
              : [
                `${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} read`,
                merge.duplicates - merge.updated ? `${merge.duplicates - merge.updated} already logged, skipped` : '',
                merge.updated ? `${merge.updated} already logged, missing details filled in` : '',
              ].filter(Boolean).join(', ')}
        </span>
      </div>
    </div>
  );
}

export function TargetsTab({ company = '', website = '', emailDomain = '', targets, onChange, settings, updateSettings }) {
  const rows = useMemo(() => normalizeTargets(targets), [targets]);
  const typeOptions = useTargetTypeOptions();
  const edit = (id, key, value) => onChange(updateTarget(rows, id, key, value));
  const add = () => onChange([...rows, blankTarget()]);
  const noTargetLogged = hasNoTargetRow(rows);
  const addNoTarget = () => {
    if (noTargetLogged) return;
    addTargetTypeOption(NO_TARGET_TYPE);
    onChange([...rows, noTargetRow()]);
  };
  // Which panel is open under the buttons: '' | 'paste' | 'research'.
  const [panel, setPanel] = useState('');
  const pasting = panel === 'paste';
  const researching = panel === 'research';
  const domain = bareDomain(website) || bareDomain(emailDomain);
  const remove = (row) => {
    const named = row.type ? `the "${row.type}" target` : 'this target';
    if (window.confirm(`Delete ${named}?`)) onChange(removeTarget(rows, row.id));
  };

  const columns = [
    {
      key: '__delete__',
      label: '',
      // First on the left, ahead of any saved column order, so removing a
      // target never means scrolling the table sideways to find the button.
      lead: true,
      defaultWidth: 110,
      exportValue: () => '',
      render: r => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" style={rowBtn} title="Delete this target" aria-label="Delete this target"
            onClick={() => remove(r)}>&#10005;</button>
          <button
            type="button"
            onClick={() => edit(r.id, 'hidden', !r.hidden)}
            title={r.hidden ? 'Show this target normally again' : 'Grey this target out (it stays on the list)'}
            aria-label={r.hidden ? 'Show this target' : 'Hide this target'}
            aria-pressed={r.hidden}
            style={{
              padding: '1px 8px', borderRadius: 999, font: 'inherit', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${r.hidden ? '#94A3B8' : '#CBD5E1'}`, background: r.hidden ? '#E2E8F0' : '#fff', color: '#475569',
            }}
          >{r.hidden ? 'Show' : 'Hide'}</button>
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      defaultWidth: 130,
      getSortValue: r => r.action.toLowerCase() || null,
      getFilterValue: r => r.action,
      exportValue: r => r.action,
      render: r => (
        <select
          value={r.action}
          aria-label="Action"
          onChange={e => edit(r.id, 'action', e.target.value)}
          style={inputStyle}
        >
          <option value="">-</option>
          {TARGET_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          {r.action && !TARGET_ACTIONS.includes(r.action) && <option value={r.action}>{r.action}</option>}
        </select>
      ),
    },
    {
      key: 'type',
      label: 'Target Type',
      defaultWidth: 260,
      getSortValue: r => r.type.toLowerCase() || null,
      getFilterValue: r => r.type,
      exportValue: r => r.type,
      render: r => (
        <TargetTypeSelect
          value={r.type}
          options={typeOptions}
          onChange={v => edit(r.id, 'type', v)}
        />
      ),
    },
    {
      key: 'commitmentType',
      label: 'Commitment Type',
      defaultWidth: 150,
      getSortValue: r => r.commitmentType.toLowerCase() || null,
      getFilterValue: r => r.commitmentType,
      exportValue: r => r.commitmentType,
      render: r => (
        <input
          type="text"
          value={r.commitmentType}
          aria-label="Commitment Type"
          onChange={e => edit(r.id, 'commitmentType', e.target.value)}
          style={inputStyle}
        />
      ),
    },
    ...YEAR_COLUMNS.map(c => ({
      key: c.key,
      label: c.label,
      defaultWidth: 120,
      getSortValue: r => (r[c.key] ? Number(r[c.key]) : null),
      getFilterValue: r => r[c.key],
      exportValue: r => r[c.key],
      render: r => (
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={r[c.key]}
          placeholder="YYYY"
          aria-label={c.label}
          onChange={e => edit(r.id, c.key, e.target.value)}
          style={yearStyle}
        />
      ),
    })),
    ...TARGET_SCOPES.map(k => ({
      key: k,
      label: SCOPE_LABELS[k],
      defaultWidth: 90,
      getSortValue: r => (r[k] ? 1 : 0),
      getFilterValue: r => (r[k] ? 'Included' : 'Not included'),
      exportValue: r => (r[k] ? 'Yes' : 'No'),
      render: r => (
        <label style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={r[k]}
            aria-label={`${SCOPE_LABELS[k]} included`}
            onChange={e => edit(r.id, k, e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      ),
    })),
    ...TEXT_COLUMNS.map(c => ({
      key: c.key,
      label: c.label,
      defaultWidth: c.width,
      getSortValue: r => r[c.key].toLowerCase() || null,
      getFilterValue: r => r[c.key],
      exportValue: r => r[c.key],
      render: r => (
        <input
          type="text"
          value={r[c.key]}
          aria-label={c.label}
          onChange={e => edit(r.id, c.key, e.target.value)}
          style={inputStyle}
        />
      ),
    })),
    {
      key: 'refreshDue',
      label: 'Refresh Due',
      defaultWidth: 160,
      getSortValue: r => refreshDue(r)?.year ?? null,
      getFilterValue: r => refreshDue(r)?.label || '',
      exportValue: r => refreshDue(r)?.year ?? '',
      render: r => {
        const due = refreshDue(r);
        if (!due) {
          return <span style={{ color: '#94A3B8', fontSize: '0.75rem' }} title="Log the year set to schedule its refresh">-</span>;
        }
        return (
          <span
            title={`Refreshed every ${REFRESH_CYCLE_YEARS} years: set in ${r.yearSet}, so due in ${due.year}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}
          >
            <strong style={{ color: '#1E293B' }}>{due.year}</strong>
            <span style={{ ...REFRESH_COLORS[due.status], padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700 }}>
              {due.label}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        The sustainability targets {company ? <strong>{company}</strong> : 'this company'} has set:
        the kind of target, the year it was set, its base year, up to two target years, and which
        scopes it covers. Research targets looks them up on the web and lists what it finds in
        these columns for you to check. Paste targets takes a whole table at once, such as the SBTi
        dashboard's, or a target written as text. Each target is due a refresh {REFRESH_CYCLE_YEARS} years after the year
        it was set. Changes save as you type.
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={add} style={addBtn}>+ Add target</button>
        <button
          type="button"
          onClick={addNoTarget}
          disabled={noTargetLogged}
          title={noTargetLogged
            ? 'Already logged as having no target'
            : 'Log that this company has no target set (adds a "No target set" row)'}
          style={{ ...secondaryBtn, opacity: noTargetLogged ? 0.5 : 1, cursor: noTargetLogged ? 'default' : 'pointer' }}
        >
          No Target Set
        </button>
        <button
          type="button"
          onClick={() => setPanel('research')}
          disabled={!company.trim() || researching}
          title={company.trim()
            ? 'Look this company\'s targets up on the web and list them in this table\'s columns, to check before adding'
            : 'Give the company a name to research it'}
          style={{ ...secondaryBtn, opacity: !company.trim() || researching ? 0.5 : 1, cursor: !company.trim() || researching ? 'default' : 'pointer' }}
        >
          Research targets
        </button>
        {!pasting && (
          <button type="button" onClick={() => setPanel('paste')} style={secondaryBtn}
            title="Paste a table of targets or a target written as text, such as the SBTi dashboard's Targets / Commitments table">
            Paste targets
          </button>
        )}
        <TargetSearchMenu company={company} website={website} emailDomain={emailDomain} buttonStyle={secondaryBtn} />
      </div>
      {researching && (
        <ResearchTargetsPanel
          // A different company is a different search: start the panel over.
          key={`${company.trim()}|${domain}`}
          company={company.trim()}
          domain={domain}
          typeOptions={typeOptions}
          existing={rows}
          noTargetLogged={noTargetLogged}
          onAdd={(next) => { onChange(next); setPanel(''); }}
          onNoTarget={() => { addNoTarget(); setPanel(''); }}
          onClose={() => setPanel('')}
        />
      )}
      {pasting && (
        <PasteTargetsPanel
          existing={rows}
          onAdd={(next) => { onChange(next); setPanel(''); }}
          onClose={() => setPanel('')}
        />
      )}
      {/* DataTable fills a flex column, so it needs a box with a height.
          Sized to the rows so a company with one or two targets doesn't
          sit above a screen of empty table, capped so a long list scrolls. */}
      <div style={{
        height: `min(55vh, ${150 + Math.max(rows.length, 1) * 40}px)`,
        display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0',
        borderRadius: 8, overflow: 'hidden', background: '#fff',
      }}>
      <DataTable
        tableId="company-targets"
        columns={columns}
        rows={rows}
        alwaysVisible={['type', '__delete__']}
        // Hidden targets sit greyed out below the rest, whatever the sort.
        rowGroup={r => (r.hidden ? 1 : 0)}
        rowStyle={r => (r.hidden ? { opacity: 0.45, background: '#F1F5F9' } : undefined)}
        emptyMessage={rows.length ? 'No targets match the filters.' : 'No targets logged yet. Use + Add target to log one.'}
        // The filter row only once there is something to filter: on an empty
        // table its boxes look like the place to type a new target in.
        enableColumnFilters={rows.length > 0}
        exportFileName={`${company || 'Company'} targets`}
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
