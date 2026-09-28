import { useMemo, useState } from 'react';
import styles from './ProspectModal.module.css';
import {
  TRANSACTION_KINDS, DEAL_TYPES_BY_KIND, blankTransaction, sortTransactions,
  summarizeTransactions, parseDigestText, transactionKey,
} from '../../utils/portfolioTransactions';

// The Portfolio tab's Acquisitions & Dispositions page: a log of what this
// company has bought and sold, kept by hand off the weekly acquisition-news
// digest. Rows edit in place and write straight back through onChange, which
// the card autosaves like every other field.

const KIND_COLORS = {
  Acquisition: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  Disposition: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
};

const cellInput = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: '0.72rem',
  padding: '0.25rem 0.35rem',
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  fontFamily: 'inherit',
  color: 'inherit',
};

const th = {
  position: 'sticky', top: 0, background: '#F8FAFC', textAlign: 'left',
  padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--color-border-light)',
  whiteSpace: 'nowrap', fontWeight: 600, fontSize: '0.7rem', zIndex: 1,
};

const td = {
  padding: '0.1rem 0.2rem', borderBottom: '1px solid var(--color-border-light)',
  verticalAlign: 'top',
};

// Date, Type, Asset, Deal, Counterparty, Through, Sector, Value, Sites,
// Source, Notes, remove. Fixed so a long asset name can't squeeze the
// dropdowns shut; the table scrolls sideways instead.
const COL_WIDTHS = [130, 118, 200, 125, 150, 150, 140, 90, 60, 180, 240, 32];

function btn(primary) {
  return primary
    ? { fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6, border: 'none', background: 'var(--color-accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }
    : { fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 };
}

function EditCell({ value, onChange, placeholder, type = 'text', title }) {
  return (
    <input
      type={type}
      value={value || ''}
      placeholder={placeholder}
      title={title}
      onChange={e => onChange(e.target.value)}
      style={cellInput}
      onFocus={e => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.background = 'var(--color-surface)'; }}
      onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; }}
    />
  );
}

function PasteDigestPanel({ existingKeys, onAdd, onClose }) {
  const [text, setText] = useState('');
  const [links, setLinks] = useState([]);
  const parsed = useMemo(() => parseDigestText(text, links), [text, links]);
  const fresh = parsed.filter(d => !existingKeys.has(transactionKey(d)));
  const [kind, setKind] = useState('Acquisition');

  function handlePaste(e) {
    // The rendered email copies as HTML too; the source links only survive
    // in that half, so keep its anchors for the parser to match against.
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      setLinks(Array.from(doc.querySelectorAll('a[href]')).map(a => ({ text: a.textContent || '', href: a.getAttribute('href') || '' })));
    } catch { /* plain text still parses */ }
  }

  return (
    <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '0.6rem', marginBottom: '0.6rem', background: '#F8FAFC' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Paste from the weekly news digest</div>
      <p style={{ fontSize: '0.7rem', color: '#64748B', margin: '0 0 0.4rem' }}>
        Select this company&apos;s deals in the Company Acquisition News email, copy, and paste them here. Each deal is read off its date line; anything already on the log is skipped.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onPaste={handlePaste}
        rows={6}
        placeholder={'2026-09-21\nAcme Services\nAdd-on · Industrial Services · $120M · 14 sites\nBuyer: ...\n...'}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.72rem', fontFamily: 'inherit', padding: '0.4rem', borderRadius: 6, border: '1px solid var(--color-border)' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
        <span style={{ fontSize: '0.72rem', color: '#475569' }}>
          {text.trim()
            ? (parsed.length === 0
              ? 'No deals found. Each deal needs its date line (YYYY-MM-DD).'
              : `${parsed.length} ${parsed.length === 1 ? 'deal' : 'deals'} found${parsed.length > fresh.length ? `, ${parsed.length - fresh.length} already logged` : ''}.`)
            : ''}
        </span>
        <label style={{ fontSize: '0.72rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
          Log as
          <select value={kind} onChange={e => setKind(e.target.value)} style={{ fontSize: '0.72rem' }}>
            {TRANSACTION_KINDS.map(k => <option key={k} value={k}>{k}s</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
        <button
          type="button"
          style={{ ...btn(true), opacity: fresh.length ? 1 : 0.5, cursor: fresh.length ? 'pointer' : 'default' }}
          disabled={!fresh.length}
          onClick={() => {
            onAdd(fresh.map(d => blankTransaction(kind, {
              ...d,
              kind,
              // A disposition's deal type comes from the other list; the
              // digest's labels are all acquisition ones.
              dealType: kind === 'Acquisition' ? d.dealType : '',
            })));
            onClose();
          }}
        >
          Add {fresh.length || ''} to log
        </button>
      </div>
    </div>
  );
}

export default function PortfolioTransactions({ rows, onChange }) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
  const [filter, setFilter] = useState('all');
  const [pasteOpen, setPasteOpen] = useState(false);

  const sorted = useMemo(() => sortTransactions(list), [list]);
  const shown = filter === 'all' ? sorted : sorted.filter(r => (r.kind || 'Acquisition') === filter);
  const summary = useMemo(() => summarizeTransactions(list), [list]);
  const existingKeys = useMemo(() => new Set(list.map(transactionKey)), [list]);

  const update = (id, patch) => onChange(list.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => onChange(list.filter(r => r.id !== id));
  const add = (kind) => {
    onChange([blankTransaction(kind), ...list]);
    setFilter(f => (f === 'all' || f === kind ? f : 'all'));
  };

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <label className={styles.label} style={{ margin: 0 }}>Acquisitions &amp; Dispositions</label>
        {list.length > 0 && (
          <span style={{ fontSize: '0.68rem', color: '#64748B' }} title="Last 12 months counts deals dated within a year of today.">
            {summary.acquisitions} {summary.acquisitions === 1 ? 'acquisition' : 'acquisitions'}
            {' · '}{summary.dispositions} {summary.dispositions === 1 ? 'disposition' : 'dispositions'}
            {' · '}last 12 months: {summary.recentAcquisitions} bought, {summary.recentDispositions} sold
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <button type="button" style={btn(true)} onClick={() => add('Acquisition')}>+ Acquisition</button>
        <button type="button" style={btn(true)} onClick={() => add('Disposition')}>+ Disposition</button>
        <button type="button" style={btn(false)} onClick={() => setPasteOpen(o => !o)}>Paste from digest email</button>
        <span style={{ flex: 1 }} />
        {list.length > 0 && (
          <div style={{ display: 'flex', gap: 2, border: '1px solid var(--color-border)', borderRadius: 6, padding: 2 }}>
            {[['all', 'All'], ['Acquisition', 'Acquisitions'], ['Disposition', 'Dispositions']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{
                  fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: 4, border: 'none', cursor: 'pointer', fontWeight: 600,
                  background: filter === key ? 'var(--color-accent)' : 'transparent',
                  color: filter === key ? '#fff' : 'var(--color-text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {pasteOpen && (
        <PasteDigestPanel
          existingKeys={existingKeys}
          onAdd={added => onChange([...added, ...list])}
          onClose={() => setPasteOpen(false)}
        />
      )}

      {list.length === 0 ? (
        <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
          Nothing logged yet. Add an acquisition or disposition as it comes through the weekly news email, or paste the deals straight out of the digest.
        </p>
      ) : shown.length === 0 ? (
        <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
          No {filter === 'Acquisition' ? 'acquisitions' : 'dispositions'} logged.
        </p>
      ) : (
        <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%', minWidth: COL_WIDTHS.reduce((a, b) => a + b, 0), tableLayout: 'fixed' }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Type</th>
                <th style={th}>Asset / Company</th>
                <th style={th}>Deal</th>
                <th style={th} title="The seller on an acquisition, the buyer on a disposition">Counterparty</th>
                <th style={th} title="Which fund or portfolio company did the deal. Blank means the company itself.">Through</th>
                <th style={th}>Sector</th>
                <th style={th}>Value</th>
                <th style={th}>Sites</th>
                <th style={th}>Source</th>
                <th style={th}>Notes</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const kind = r.kind === 'Disposition' ? 'Disposition' : 'Acquisition';
                const c = KIND_COLORS[kind];
                const dealTypes = DEAL_TYPES_BY_KIND[kind];
                return (
                  <tr key={r.id}>
                    <td style={td}><EditCell type="date" value={r.date} onChange={v => update(r.id, { date: v })} /></td>
                    <td style={td}>
                      <select
                        value={kind}
                        onChange={e => update(r.id, { kind: e.target.value, dealType: DEAL_TYPES_BY_KIND[e.target.value].includes(r.dealType) ? r.dealType : '' })}
                        style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.3rem', borderRadius: 999, border: `1px solid ${c.border}`, background: c.bg, color: c.fg, marginTop: 2 }}
                      >
                        {TRANSACTION_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <EditCell value={r.asset} placeholder="What was bought or sold" onChange={v => update(r.id, { asset: v })} />
                      {r.source === 'digest' && (
                        <div
                          style={{ fontSize: '0.62rem', color: '#64748B', padding: '0 0.4rem 0.15rem' }}
                          title={`Logged automatically by the weekly acquisition-news run${r.loggedAt ? ` on ${new Date(r.loggedAt).toLocaleDateString()}` : ''}. Check it against the source.`}
                        >
                          From weekly digest
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <select value={r.dealType || ''} onChange={e => update(r.id, { dealType: e.target.value })} style={{ ...cellInput, cursor: 'pointer' }}>
                        <option value="">-</option>
                        {dealTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        {r.dealType && !dealTypes.includes(r.dealType) && <option value={r.dealType}>{r.dealType}</option>}
                      </select>
                    </td>
                    <td style={td}><EditCell value={r.counterparty} placeholder={kind === 'Acquisition' ? 'Seller' : 'Buyer'} onChange={v => update(r.id, { counterparty: v })} /></td>
                    <td style={td}><EditCell value={r.entity} placeholder="Company itself" onChange={v => update(r.id, { entity: v })} /></td>
                    <td style={td}><EditCell value={r.sector} onChange={v => update(r.id, { sector: v })} /></td>
                    <td style={td}><EditCell value={r.value} placeholder="$" onChange={v => update(r.id, { value: v })} /></td>
                    <td style={td}><EditCell value={r.sites} onChange={v => update(r.id, { sites: v })} /></td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <EditCell
                          value={r.sourceUrl}
                          placeholder="https://"
                          title={r.sourceTitle || undefined}
                          onChange={v => update(r.id, { sourceUrl: v })}
                        />
                        {/^https?:\/\//i.test(r.sourceUrl || '') && (
                          <a href={r.sourceUrl} target="_blank" rel="noreferrer" title={r.sourceTitle || 'Open source'} style={{ fontSize: '0.72rem', color: 'var(--color-accent)', textDecoration: 'none', padding: '0 0.2rem' }}>
                            ↗
                          </a>
                        )}
                      </div>
                    </td>
                    <td style={td}>
                      <textarea
                        value={r.notes || ''}
                        rows={1}
                        onChange={e => update(r.id, { notes: e.target.value })}
                        style={{ ...cellInput, resize: 'vertical', minHeight: 24 }}
                      />
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        type="button"
                        title="Remove this row"
                        onClick={() => remove(r.id)}
                        style={{ border: 'none', background: 'transparent', color: '#B91C1C', cursor: 'pointer', fontSize: '0.8rem', padding: '0.25rem' }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
