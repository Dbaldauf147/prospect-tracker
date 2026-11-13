// The Relationship Strength read-out: the score in its tier's colours, the
// tier name, the trend arrow and the days since the last two-way touch.
//
// `compact` is the table-cell form (score, arrow, days); the full form
// spells the tier out and is what the contact and company popups show.

import { TREND_ARROWS, daysLabel } from '../../utils/relationshipStrength';

const TREND_LOOK = {
  up: { color: '#16A34A', label: 'Rising: more activity in the last 30 days than the 60 before' },
  down: { color: '#DC2626', label: 'Falling: less activity in the last 30 days than the 60 before' },
  flat: { color: '#94A3B8', label: 'Steady: about the same activity as the 60 days before' },
};

export function TrendArrow({ trend }) {
  const look = TREND_LOOK[trend] || TREND_LOOK.flat;
  return (
    <span title={look.label} aria-label={look.label} style={{ color: look.color, fontSize: '0.62rem', lineHeight: 1 }}>
      {TREND_ARROWS[trend] || TREND_ARROWS.flat}
    </span>
  );
}

export function ScorePill({ score, tier, showLabel = true, title }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999,
        fontSize: '0.68rem', fontWeight: 700, background: tier.bg, color: tier.color,
        border: `1px solid ${tier.border}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
      }}
    >
      {score}{showLabel && <span style={{ fontWeight: 600 }}>{tier.label}</span>}
    </span>
  );
}

function breakdownTitle(result, extra = '') {
  if (!result) return '';
  const c = result.components || {};
  const parts = [
    `Relationship Strength ${result.score} (${result.tier.label})`,
    c.engagement != null ? `Engagement ${c.engagement} · Reciprocity ${c.reciprocity} · Consistency ${c.consistency} · Opportunities ${c.opportunity}${c.tenure != null ? ` · Age ${c.tenure}` : ''}` : '',
    extra,
    `Last two-way touch: ${daysLabel(result.daysSinceTwoWay)}`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function RelationshipBadge({ result, compact = false, extraTitle = '' }) {
  if (!result) return <span style={{ color: '#CBD5E1' }}>-</span>;
  const title = breakdownTitle(result, extraTitle);
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <ScorePill score={result.score} tier={result.tier} showLabel={!compact} />
      <TrendArrow trend={result.trend} />
      <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>{daysLabel(result.daysSinceTwoWay)}</span>
    </span>
  );
}
