import { splitBfoNames } from '../../utils/bfoCompanyNames';

// The company's other BFO Account names (utils/bfoCompanyNames), as chips:
// Enter or clicking away adds the typed name, x removes one. `value` is the
// stored one-per-line string; `primary` is the BFO Company Name, which isn't
// repeated here.
export function BfoNamesField({ value, primary = '', onChange }) {
  const names = splitBfoNames(value);
  const taken = (val) => {
    const k = val.toLowerCase();
    return k === String(primary || '').trim().toLowerCase() || names.some(n => n.toLowerCase() === k);
  };
  const add = (input) => {
    const val = input.value.trim();
    input.value = '';
    if (val && !taken(val)) onChange([...names, val].join('\n'));
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', minHeight: '28px', alignItems: 'center' }}>
      {names.map((n, i) => (
        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.5rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '999px', fontSize: '0.72rem', color: '#1E40AF' }}>
          {n}
          <button
            type="button"
            aria-label={`Remove ${n}`}
            onClick={() => onChange(names.filter((_, j) => j !== i).join('\n'))}
            style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.8rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
          >&times;</button>
        </span>
      ))}
      <input
        type="text"
        placeholder={names.length === 0 ? '+ Add another BFO name' : '+ Add another'}
        title="Other Account names this company has in BFO. Each one is matched against BFO Activity and searched in the BFO History task."
        onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); add(e.target); } }}
        onBlur={e => add(e.target)}
        style={{ border: 'none', outline: 'none', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text)', padding: '0.15rem 0', minWidth: '140px', flex: '1 1 140px', background: 'none' }}
      />
    </div>
  );
}
