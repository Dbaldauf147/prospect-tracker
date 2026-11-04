// A legend swatch that is also a colour picker: click the dot, pick a
// colour, and onChange gets the '#rrggbb'. The native colour input sits
// under the dot (invisible), so the browser's own picker opens and the
// keyboard can reach it. Kept out of any <button> (an input can't nest in
// one), so a legend chip puts this beside its toggle button.
export function ColourPickDot({ colour, onChange, label, size = 10, shape = 'dot' }) {
  const style = shape === 'bar'
    ? { width: 14, height: 4, borderRadius: 2 }
    : { width: size, height: size, borderRadius: 999 };
  return (
    <label
      title={`Change the colour of ${label}`}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 3, margin: -3, cursor: 'pointer', flex: 'none' }}
    >
      <span style={{ ...style, display: 'inline-block', background: colour, boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.15)' }} />
      <input
        type="color"
        value={colour}
        aria-label={`Colour for ${label}`}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0 }}
      />
    </label>
  );
}
