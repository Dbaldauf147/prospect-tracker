import { useState, useMemo } from 'react';
import { parseTsv } from '../../utils/parseTsv';
import { IMPORT_FIELDS, COMPANY, autoMapHeader, buildImportPlan } from '../../utils/clientFieldsImport';

// Bulk restore for the per-client fields typed on the Clients tab.
//
// These fields live only in this browser (mirrored to Firestore since the
// localMirrorSync change, but with no other source), so a browser that lost
// them has to be refilled by hand — 44 clients times six columns. This takes
// the same rows back from a spreadsheet in one paste.
//
// Two rules make it safe to run against live data:
//   • A blank cell means "leave this field alone", never "clear it". An
//     import meant to restore data must not turn an empty column into a
//     wipe of the values already there.
//   • Nothing is written until the preview has been read. The preview names
//     every row that matches no client, so a typo shows up as a skipped row
//     rather than as a value keyed to a company that doesn't exist.

const btn = (bg, fg, border) => ({
  padding: '0.45rem 0.9rem', border: `1px solid ${border}`, borderRadius: 6, background: bg,
  color: fg, fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
});

export function ClientFieldsPasteModal({ companies = [], current = {}, onApply, onClose }) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');

  // Stage 1 -> 2: parse the clipboard and pre-map the headers it recognises.
  function handleParse() {
    setError('');
    const { headers: h, rows } = parseTsv(paste);
    if (!h.length || !rows.length) {
      setError('Nothing to import. Copy the rows from Excel or Sheets including the header row, then paste here.');
      return;
    }
    setHeaders(h);
    setRawRows(rows);
    setMapping(Object.fromEntries(h.map(src => [src, autoMapHeader(src)])));
    setStage('map');
  }

  const companyCol = Object.keys(mapping).find(k => mapping[k] === COMPANY);

  // What the import would actually change, resolved against the values the
  // app holds right now. Rows matching no client, and fields whose value is
  // already correct, are separated out so the preview can say so.
  const plan = useMemo(() => {
    if (stage === 'paste') return null;
    return buildImportPlan({ headers, rows: rawRows, mapping, companies, current });
  }, [stage, headers, rawRows, mapping, companies, current]);

  function handleApply() {
    if (!plan || !plan.writes.length) return;
    onApply(plan.writes);
  }

  const wrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const card = { background: '#fff', borderRadius: 12, padding: '1.25rem', width: 820, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };

  return (
    <div style={wrap} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Import client fields</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {stage === 'paste' && (
          <>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 0.5rem' }}>
              Paste rows copied from Excel or Google Sheets, header row included. One column must hold the
              company name; the rest map to the Clients-tab fields on the next screen.
            </p>
            <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.5rem' }}>
              A blank cell leaves that field as it is — this only fills values in, it never clears them.
              Checkbox columns read Yes/No, TRUE/FALSE, X, or 1/0.
            </p>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder={'Company\tClient Manager\tRenewal Status\tDon’t Track\nMoody’s\tJane Smith\tReached out to CM\tNo'}
              rows={10}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.72rem', padding: '0.5rem', border: '1px solid #E2E8F0', borderRadius: 6, resize: 'vertical' }}
            />
          </>
        )}

        {stage === 'map' && (
          <>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 0.6rem' }}>
              Match each pasted column to a field. Anything left as “Skip” is ignored.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {headers.map(h => (
                <label key={h} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#334155' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>{h || '(unnamed)'}</span>
                  <select
                    value={mapping[h] || ''}
                    onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                    style={{ padding: '0.25rem', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
                  >
                    <option value="">Skip</option>
                    <option value={COMPANY}>Company (match on this)</option>
                    {IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {!companyCol && (
              <div style={{ padding: '0.5rem 0.7rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.74rem', color: '#991B1B' }}>
                Pick which column holds the company name — rows are matched on it.
              </div>
            )}

            {plan && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#334155' }}>
                <div style={{ padding: '0.6rem 0.8rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  <strong>{plan.changing.length}</strong> of {plan.matched.length} matched {plan.matched.length === 1 ? 'client' : 'clients'} would change
                  {plan.matched.length - plan.changing.length > 0 && ` · ${plan.matched.length - plan.changing.length} already match`}
                  {plan.unmatched.length > 0 && <> · <span style={{ color: '#B45309' }}>{plan.unmatched.length} matched no client and will be skipped</span></>}
                  {Object.keys(plan.perField).length > 0 && (
                    <div style={{ marginTop: 4, color: '#64748B' }}>
                      {Object.entries(plan.perField).map(([k, n]) => `${k}: ${n}`).join(' · ')}
                    </div>
                  )}
                </div>

                {plan.unmatched.length > 0 && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.7rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, color: '#92400E' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>No client by these names — fix the spelling and paste again if they should count:</div>
                    <div style={{ maxHeight: 90, overflowY: 'auto' }}>{plan.unmatched.slice(0, 40).join(', ')}{plan.unmatched.length > 40 ? ` … (+${plan.unmatched.length - 40})` : ''}</div>
                  </div>
                )}

                {plan.changing.length > 0 && (
                  <div style={{ marginTop: '0.5rem', maxHeight: 260, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Company</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Field</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Now</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.changing.flatMap(row => row.changes.map((c, i) => (
                          <tr key={row.company + c.field.key} style={{ borderTop: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '4px 8px', color: '#64748B' }}>{i === 0 ? row.company : ''}</td>
                            <td style={{ padding: '4px 8px' }}>{c.field.label}</td>
                            <td style={{ padding: '4px 8px', color: '#94A3B8' }}>{c.field.kind === 'bool' ? (c.was ? 'Yes' : 'No') : (c.was || '—')}</td>
                            <td style={{ padding: '4px 8px', fontWeight: 600 }}>{c.field.kind === 'bool' ? (c.value ? 'Yes' : 'No') : c.value}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.7rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.74rem', color: '#991B1B' }}>{error}</div>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          {stage === 'map' && (
            <button type="button" onClick={() => setStage('paste')} style={btn('#fff', '#64748B', '#E2E8F0')}>Back</button>
          )}
          <button type="button" onClick={onClose} style={btn('#fff', '#64748B', '#E2E8F0')}>Cancel</button>
          {stage === 'paste' ? (
            <button type="button" onClick={handleParse} disabled={!paste.trim()}
              style={{ ...btn(paste.trim() ? '#0078D4' : '#94A3B8', '#fff', 'transparent'), cursor: paste.trim() ? 'pointer' : 'not-allowed' }}>Next</button>
          ) : (
            <button type="button" onClick={handleApply} disabled={!plan || !plan.changing.length}
              style={{ ...btn(plan && plan.changing.length ? '#059669' : '#94A3B8', '#fff', 'transparent'), cursor: plan && plan.changing.length ? 'pointer' : 'not-allowed' }}>
              {plan && plan.changing.length ? `Import ${plan.changing.length} client${plan.changing.length === 1 ? '' : 's'}` : 'Nothing to import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
