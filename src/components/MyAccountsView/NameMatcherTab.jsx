// My Accounts > Name Matcher: paste a list of company names (one per line,
// or a column copied out of a spreadsheet) and each is lined up with the
// Table company it most likely is, with that company's CDM and Tier. Where
// the name isn't an exact match the best few near names are offered and the
// pick can be changed per row. The matching rules are utils/pasteCompanyMatch.
//
// The paste lives in this module for the session, so switching subtabs and
// coming back keeps it.

import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { makePasteMatcher, parsePastedNames } from '../../utils/pasteCompanyMatch.js';
import { writeRichCopy } from '../../utils/clipboardCopy.js';

let sessionText = '';
let sessionPicks = {};

const TIER_TINTS = {
  'Tier 1': { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  'Tier 2': { bg: '#F5F3FF', border: '#DDD6FE', ink: '#6D28D9' },
  'Tier 3': { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' },
};
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;

const MATCH_LABEL = { exact: 'Exact', alias: 'Alias', similar: 'Suggested', none: 'No match' };
const MATCH_TINT = {
  exact: { bg: '#ECFDF5', ink: '#047857' },
  alias: { bg: '#ECFDF5', ink: '#047857' },
  similar: { bg: '#FFFBEB', ink: '#B45309' },
  none: { bg: '#FEF2F2', ink: '#B91C1C' },
};

export function NameMatcherTab({ prospects, accounts, settings, updateSettings, onSelect }) {
  const [text, setTextState] = useState(sessionText);
  const [picks, setPicksState] = useState(sessionPicks);
  const [copied, setCopied] = useState('');
  const setText = (v) => { sessionText = v; setTextState(v); };
  const setPicks = (fn) => setPicksState(prev => { const next = fn(prev); sessionPicks = next; return next; });

  const match = useMemo(() => makePasteMatcher(prospects), [prospects]);
  const names = useMemo(() => parsePastedNames(text), [text]);
  const myIds = useMemo(() => new Set((accounts || []).map(a => a.id)), [accounts]);

  const rows = useMemo(() => names.map((name, i) => {
    const { suggestions } = match(name);
    const pickedId = picks[name];
    // A pick of '' is "No match"; no pick (or a stale one) takes the best.
    const chosen = pickedId === '' ? null
      : (suggestions.find(s => String(s.prospect.id) === String(pickedId)) || suggestions[0] || null);
    const p = chosen?.prospect || null;
    return {
      id: `${i}:${name}`,
      order: i,
      pasted: name,
      suggestions,
      chosen,
      prospect: p,
      company: p?.company || '',
      cdm: p?.cdm || '',
      tier: p?.tier || '',
      status: p?.status || '',
      matchKind: chosen ? chosen.via : 'none',
      score: chosen ? chosen.score : null,
      mine: p ? myIds.has(p.id) : false,
    };
  }), [names, match, picks, myIds]);

  const counts = useMemo(() => {
    const c = { exact: 0, similar: 0, none: 0 };
    for (const r of rows) {
      if (r.matchKind === 'exact' || r.matchKind === 'alias') c.exact++;
      else if (r.matchKind === 'similar') c.similar++;
      else c.none++;
    }
    return c;
  }, [rows]);

  const columns = useMemo(() => [
    {
      key: 'pasted', label: 'Pasted Name', defaultWidth: 240,
      getSortValue: r => r.order,
      getFilterValue: r => r.pasted,
      exportValue: r => r.pasted,
      render: r => <span style={{ fontWeight: 600 }}>{r.pasted}</span>,
    },
    {
      key: 'company', label: 'Suggested Table Company', defaultWidth: 280,
      headerTitle: 'The Table company this name most likely is. Pick another from the list when the first suggestion is wrong, or "No match" when none is right.',
      getSortValue: r => r.company.toLowerCase() || null,
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => {
        if (!r.suggestions.length) return <span style={{ color: '#94A3B8' }}>No Table company found</span>;
        const choosable = r.suggestions.length > 1 || r.matchKind === 'similar' || r.matchKind === 'none';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            {choosable ? (
              <select
                value={r.prospect ? String(r.prospect.id) : ''}
                onChange={e => { const v = e.target.value; setPicks(prev => ({ ...prev, [r.pasted]: v })); }}
                onClick={e => e.stopPropagation()}
                style={{ fontSize: '0.75rem', fontFamily: 'inherit', padding: '1px 4px', borderRadius: 4, border: '1px solid #CBD5E1', maxWidth: 200 }}
                title="Choose which Table company this name is"
              >
                {r.suggestions.map(s => (
                  <option key={s.prospect.id} value={String(s.prospect.id)}>
                    {s.prospect.company}{s.via === 'similar' ? ` (${s.score}%)` : ''}
                  </option>
                ))}
                <option value="">No match</option>
              </select>
            ) : null}
            {r.prospect && onSelect && (
              choosable ? (
                <button type="button" onClick={() => onSelect(r.prospect)} title="Open the company" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: '0.72rem', color: '#1D4ED8', cursor: 'pointer' }}>Open</button>
              ) : (
                <button type="button" onClick={() => onSelect(r.prospect)} title="Open the company" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}>{r.company}</button>
              )
            )}
          </span>
        );
      },
    },
    {
      key: 'matchKind', label: 'Match', defaultWidth: 120,
      headerTitle: 'Exact: the same name (case, punctuation and Inc / LLC / Group ignored). Alias: one of the names the company also goes by. Suggested: a near name, with how alike the two are.',
      getSortValue: r => ({ exact: 0, alias: 1, similar: 2, none: 3 })[r.matchKind] * 1000 - (r.score || 0),
      getFilterValue: r => MATCH_LABEL[r.matchKind],
      exportValue: r => (r.matchKind === 'similar' ? `Suggested (${r.score}%)` : MATCH_LABEL[r.matchKind]),
      render: r => {
        const t = MATCH_TINT[r.matchKind];
        return (
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: t.ink, background: t.bg, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>
            {MATCH_LABEL[r.matchKind]}{r.matchKind === 'similar' ? ` ${r.score}%` : ''}
          </span>
        );
      },
    },
    {
      key: 'cdm', label: 'CDM', defaultWidth: 150,
      getSortValue: r => r.cdm.toLowerCase() || null,
      getFilterValue: r => r.cdm,
      exportValue: r => r.cdm,
      render: r => (r.cdm ? r.cdm : blank),
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 110,
      getSortValue: r => r.tier || null,
      getFilterValue: r => r.tier,
      exportValue: r => r.tier,
      render: r => {
        if (!r.tier) return blank;
        const tint = TIER_TINTS[r.tier];
        if (!tint) return <span style={{ color: '#475569', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{r.tier}</span>;
        return <span style={{ fontSize: '0.68rem', fontWeight: 700, color: tint.ink, background: tint.bg, border: `1px solid ${tint.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.tier}</span>;
      },
    },
    {
      key: 'status', label: 'Status', defaultWidth: 130,
      getSortValue: r => r.status.toLowerCase() || null,
      getFilterValue: r => r.status,
      exportValue: r => r.status,
      render: r => (r.status ? r.status : blank),
    },
    {
      key: 'mine', label: 'In My Accounts', defaultWidth: 110,
      headerTitle: 'Whether the matched company is on your My Accounts list.',
      getSortValue: r => (r.prospect ? (r.mine ? 0 : 1) : null),
      getFilterValue: r => (r.prospect ? (r.mine ? 'Yes' : 'No') : ''),
      exportValue: r => (r.prospect ? (r.mine ? 'Yes' : 'No') : ''),
      render: r => (r.prospect ? (r.mine ? <span style={{ color: '#047857', fontWeight: 600 }}>Yes</span> : 'No') : blank),
    },
  ], [onSelect]);

  async function copyResults() {
    const head = ['Pasted Name', 'Table Company', 'Match', 'CDM', 'Tier', 'Status', 'In My Accounts'];
    const lines = rows.map(r => [
      r.pasted, r.company,
      r.matchKind === 'similar' ? `Suggested (${r.score}%)` : MATCH_LABEL[r.matchKind],
      r.cdm, r.tier, r.status, r.prospect ? (r.mine ? 'Yes' : 'No') : '',
    ]);
    const plain = [head, ...lines].map(l => l.map(c => String(c || '').replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${lines.map(l => `<tr>${l.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    try {
      await writeRichCopy(plain, html);
      setCopied('Copied');
    } catch {
      setCopied('Copy failed');
    }
    setTimeout(() => setCopied(''), 2000);
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '0.75rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 280, flexShrink: 0, gap: '0.4rem' }}>
        <label htmlFor="name-matcher-paste" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>Paste company names</label>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>One per line, or a column copied from a spreadsheet.</span>
        <textarea
          id="name-matcher-paste"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Blackstone\nHines\nBrookfield Asset Management'}
          spellCheck={false}
          style={{ flex: 1, minHeight: 200, resize: 'none', fontFamily: 'inherit', fontSize: '0.8rem', padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6 }}
        />
        <button
          type="button"
          onClick={() => { setText(''); setPicks(() => ({})); }}
          disabled={!text}
          style={{ padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 600, cursor: text ? 'pointer' : 'default', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
        >Clear</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, gap: '0.5rem' }}>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {rows.length} name{rows.length === 1 ? '' : 's'} · {counts.exact} matched · {counts.similar} suggested · {counts.none} with no match
        </span>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="my-accounts-name-matcher"
            exportFileName="Name Matcher"
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'pasted', direction: 'asc' }}
            fitWidth
            alwaysVisible={['pasted']}
            emptyMessage="Paste company names on the left to see their Table match, CDM and Tier"
            toolbarActions={[{ key: 'copy', label: copied || 'Copy results', title: 'Copy the table to paste into a spreadsheet or email', onClick: copyResults, disabled: !rows.length }]}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      </div>
    </div>
  );
}
