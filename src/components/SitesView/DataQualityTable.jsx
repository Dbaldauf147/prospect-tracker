// The data summary on the Utility Lookup page.
//
// One row per input: what it is, and where it came from. It replaces four
// cards that counted sites into buckets a commodity at a time (actual kWh,
// estimated kWh, missing kWh, and the same again for cost, utilities and
// market structure) and two warning banners that each argued one of those
// gaps in a paragraph. Between them they said a great deal and answered the
// question late: how much of this analysis is real?
//
// So it is a table, and it is read in one pass. The left column is the
// inputs that are either given per site or worked out per site, as
// percentages. The right column is the facts about the buildings
// themselves, where the answer is a method rather than a split. The model
// behind it - every number and every sentence - is dataQualitySummary.js;
// this file only lays it out.
//
// The tints are the one thing the cards did that a table of sentences would
// otherwise lose: green where the page is working from what the file said,
// amber where it is working from an estimate, red where it has nothing. A
// reader who never hovers a single row still sees the shape of the upload.

const TONES = {
  good: { background: '#F0FDF4', bar: '#16A34A', text: '#166534' },
  warn: { background: '#FFFBEB', bar: '#F59E0B', text: '#92400E' },
  bad: { background: '#FEF2F2', bar: '#DC2626', text: '#991B1B' },
};

const labelCellStyle = {
  padding: '0.3rem 0.5rem 0.3rem 0',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#475569',
  verticalAlign: 'middle',
};

const valueCellStyle = {
  padding: '0.3rem 0.5rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  color: '#0F172A',
  verticalAlign: 'middle',
  borderRadius: 4,
};

function Cell({ row, last }) {
  if (!row) {
    // The right-hand column runs out before the left one does. An empty
    // pair rather than a shorter table, so the rows on both sides stay on
    // the same baselines.
    return (
      <>
        <td style={labelCellStyle} />
        <td style={valueCellStyle} />
      </>
    );
  }
  const tone = TONES[row.tone] || null;
  return (
    <>
      <td style={labelCellStyle} title={row.title}>{row.label}</td>
      <td
        style={tone
          ? {
            ...valueCellStyle,
            background: tone.background,
            color: tone.text,
            borderLeft: `3px solid ${tone.bar}`,
            paddingLeft: '0.45rem',
            paddingRight: last ? '0.5rem' : '0.75rem',
          }
          : valueCellStyle}
        title={row.title}
      >{row.value}</td>
    </>
  );
}

export function DataQualityTable({ summary }) {
  if (!summary) return null;
  const depth = Math.max(summary.left.length, summary.right.length);
  const lines = Array.from({ length: depth }, (_, i) => i);
  return (
    <div
      style={{
        margin: '0.5rem 1.25rem 0.75rem',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        background: '#FFFFFF',
        padding: '0.65rem 0.85rem',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, color: '#0F172A',
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem',
        }}
        title={'What this analysis is working from. Actual and mapped mean the upload carried it; estimated means the page worked it out, '
          + 'and every figure downstream of an estimate is only as good as the property type behind it.'}
      >
        Data summary
        <span style={{ fontWeight: 500, color: '#94A3B8', textTransform: 'none', letterSpacing: 0, marginLeft: '0.4rem' }}>
          {summary.total.toLocaleString()} site{summary.total === 1 ? '' : 's'}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0.15rem', tableLayout: 'fixed' }}>
        <colgroup>
          {/* The labels are short and the values are sentences, so the
              value columns take the width. Wide enough for the longest
              label ("Natural gas consumption") to stay on one line on a
              laptop, and the labels wrap rather than clip below that. */}
          <col style={{ width: '17%' }} />
          <col style={{ width: '31%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '38%' }} />
        </colgroup>
        <tbody>
          {lines.map(i => (
            <tr key={summary.left[i]?.key || summary.right[i]?.key || i}>
              <Cell row={summary.left[i]} />
              <Cell row={summary.right[i]} last />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataQualityTable;
