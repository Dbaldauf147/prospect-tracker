// The Pipeline page's KPI Trends table, as the Pipeline Report export
// writes it (utils/pipelineWorkbook.js). Every figure is the text the page
// shows, formatted by the same helpers, so the sheet can't disagree with
// the screen. The sparklines travel separately, rasterised off the page.
//
// Pure: takes computeKpiTrends' result and the saved targets.
import { formatKpi, formatKpiTarget, targetStatus } from './kpiTrends.js';

export function kpiTrendsForExport(trends, targets = {}) {
  if (!trends?.rows?.length) return null;
  return {
    months: trends.months.map(m => m.label),
    windows: trends.windows.map(w => w.short),
    rows: trends.rows.map(k => {
      const target = targets[k.key];
      const cell = (c) => ({ text: formatKpi(c.value, k.format), sub: c.value == null ? '' : (c.sub || '') });
      return {
        key: k.key,
        label: k.key === 'generation' ? 'Opportunity Generation (avg / month)' : k.label,
        cells: k.cells.map(cell),
        totals: k.totals.map(c => ({ ...cell(c), status: targetStatus(k, c.value, target) })),
        target: formatKpiTarget(k, target),
      };
    }),
  };
}
