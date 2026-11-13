import { LIST_FLAG_BY_LABEL, COMPLIANCE_FLAG_MARK } from '../../utils/listFlags';

// One framework pill (CDP, GRESB, CA SB, ...) as the Frameworks columns draw
// it. `dan` adds the small DAN mark for a flag that came from Sites >
// Corporate Compliance rather than a Lists-page mapping.
export function FrameworkFlagPill({ label, dan = false, title }) {
  const color = LIST_FLAG_BY_LABEL[label]?.color || { bg: '#F1F5F9', text: '#334155' };
  return (
    <span
      title={dan ? `${label}: ${COMPLIANCE_FLAG_MARK.title}` : (title || label)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: color.bg, color: color.text, whiteSpace: 'nowrap' }}
    >
      {label}
      {dan && (
        <span style={{ padding: '0 4px', borderRadius: 999, fontSize: '0.5rem', letterSpacing: '0.03em', background: COMPLIANCE_FLAG_MARK.bg, color: COMPLIANCE_FLAG_MARK.text }}>
          {COMPLIANCE_FLAG_MARK.label}
        </span>
      )}
    </span>
  );
}
