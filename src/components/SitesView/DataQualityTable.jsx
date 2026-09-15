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

// Labels stay on one line: they are two words each, and a wrapped label
// makes a row twice as tall as the sentence beside it.
const labelCellStyle = {
  padding: '0.22rem 0.5rem 0.22rem 0',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#475569',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

// The second pair starts here, so it carries the gutter between the two
// halves of the table rather than a spacer column.
const rightLabelCellStyle = { ...labelCellStyle, paddingLeft: '1.75rem' };

const valueCellStyle = {
  padding: '0.1rem 0.5rem 0.1rem 0',
  fontSize: '0.74rem',
  fontWeight: 600,
  color: '#0F172A',
  verticalAlign: 'middle',
};

// The tint rides on the text, not on the cell. A table cell is as wide as
// the widest cell in its column, so tinting the cell made "Per building" a
// green bar as long as "Per building on 53 of 144, missing on 91" - a bar
// whose length meant nothing, next to one whose length meant nothing
// either. On the pill, the colour ends where the sentence does.
const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.15rem 0.5rem',
  borderRadius: 4,
};

function Cell({ row, right }) {
  const labelStyle = right ? rightLabelCellStyle : labelCellStyle;
  if (!row) {
    // The right-hand column runs out before the left one does. An empty
    // pair rather than a shorter table, so the rows on both sides stay on
    // the same baselines.
    return (
      <>
        <td style={labelStyle} />
        <td style={valueCellStyle} />
      </>
    );
  }
  const tone = TONES[row.tone] || null;
  return (
    <>
      <td style={labelStyle} title={row.title}>{row.label}</td>
      <td style={valueCellStyle} title={row.title}>
        {tone
          ? (
            <span style={{
              ...pillStyle,
              background: tone.background,
              color: tone.text,
              borderLeft: `3px solid ${tone.bar}`,
            }}
            >{row.value}</span>
          )
          : row.value}
      </td>
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
        padding: '0.5rem 0.75rem',
        // The card ends where the table does. Left at full width it was a
        // box two thirds empty on a wide monitor, which reads as something
        // missing rather than as something short.
        width: 'fit-content',
        maxWidth: 'calc(100% - 2.5rem)',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, color: '#0F172A',
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem',
        }}
        title={'What this analysis is working from. Actual and mapped mean the upload carried it; estimated means the page worked it out, '
          + 'and every figure downstream of an estimate is only as good as the property type behind it.'}
      >
        Data summary
        <span style={{ fontWeight: 500, color: '#94A3B8', textTransform: 'none', letterSpacing: 0, marginLeft: '0.4rem' }}>
          {summary.total.toLocaleString()} site{summary.total === 1 ? '' : 's'}
        </span>
      </div>
      {/* Sized to what it says, not to the window. A four-column grid at
          fixed percentages of the full page width turned "100% estimated"
          into a tinted bar five hundred pixels long, with the sentence at
          one end of it and nothing at the other - on a wide monitor the
          panel read as a chart of bars whose lengths meant nothing. Auto
          layout gives each column its widest cell and stops, so a row is
          as wide as the longest thing in it. maxWidth keeps a long
          sentence from pushing the table past the panel. */}
      <table style={{
        width: 'auto',
        maxWidth: '100%',
        borderCollapse: 'separate',
        borderSpacing: '0 0.1rem',
      }}>
        <tbody>
          {lines.map(i => (
            <tr key={summary.left[i]?.key || summary.right[i]?.key || i}>
              <Cell row={summary.left[i]} />
              <Cell row={summary.right[i]} right />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataQualityTable;
