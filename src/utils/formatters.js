export function formatAum(value) {
  if (value == null || value === 0) return '—';
  if (value >= 1) return `$${value.toFixed(1)}B`;
  return `$${(value * 1000).toFixed(0)}M`;
}

export function formatNumber(value) {
  if (value == null) return '—';
  return value.toLocaleString();
}

export function statusColor(status) {
  const map = {
    'Client': '#10B981',
    'Inside Sales': '#3B82F6',
    'Qualifying': '#F59E0B',
    'Hold Off': '#8B5CF6',
    'Lost - Not Sold': '#EF4444',
    'Old Client': '#6B7280',
    'Partnering w/Another CDM': '#06B6D4',
  };
  return map[status] || '#6B7280';
}

export function tierColor(tier) {
  return tier === 'Tier 1' ? '#DC2626' : '#3B82F6';
}
