import { useEffect, useMemo, useState } from 'react';
import styles from './EscAnalysisTab.module.css';

// Esc Analysis subtab: how one annual fee grows over five years at a given
// escalator. The escalator first applies in Year 2, the same way the
// Pricing subtab escalates recurring fees. A start year is optional: left
// blank the rows read Year 1 to Year 5, filled in (e.g. 2022) they read as
// calendar years from there.
//
// The inputs are a scratch calculation, so they live in this browser only.
const LS_KEY = 'pricing-esc-analysis';
const YEARS = 5;

function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (n) => `${(n * 100).toFixed(2)}%`;
const toNumber = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function EscAnalysisTab() {
  const [fee, setFee] = useState(() => readSaved()?.fee ?? '100000');
  const [escalator, setEscalator] = useState(() => readSaved()?.escalator ?? '3');
  const [startYear, setStartYear] = useState(() => readSaved()?.startYear ?? '');

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ fee, escalator, startYear })); } catch { /* private window */ }
  }, [fee, escalator, startYear]);

  const feeNum = toNumber(fee);
  const escRate = (toNumber(escalator) ?? 0) / 100;
  const yearNum = toNumber(startYear);
  const firstYear = yearNum != null && yearNum >= 1900 && yearNum <= 2200 ? Math.round(yearNum) : null;

  const rows = useMemo(() => {
    if (feeNum == null) return [];
    const out = [];
    for (let i = 0; i < YEARS; i++) {
      const amount = feeNum * (1 + escRate) ** i;
      const prior = i ? out[i - 1].amount : null;
      out.push({
        label: firstYear != null ? String(firstYear + i) : `Year ${i + 1}`,
        amount,
        change: prior == null ? null : amount - prior,
        cumulative: amount - feeNum,
        cumulativePct: feeNum ? amount / feeNum - 1 : 0,
      });
    }
    return out;
  }, [feeNum, escRate, firstYear]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const flatTotal = feeNum == null ? 0 : feeNum * YEARS;

  return (
    <div className={styles.wrap}>
      <div className={styles.inputs}>
        <label className={styles.field}>
          <span>Starting fee ($)</span>
          <input inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} placeholder="100000" />
        </label>
        <label className={styles.field}>
          <span>Fee escalator (% / yr)</span>
          <input
            type="number"
            step="0.25"
            value={escalator}
            onChange={e => setEscalator(e.target.value)}
            title="Applied each year from Year 2 on, compounding."
          />
        </label>
        <label className={styles.field}>
          <span>Start year (optional)</span>
          <input
            type="number"
            value={startYear}
            onChange={e => setStartYear(e.target.value)}
            placeholder="Year 1"
            title="Leave blank to read Year 1 to Year 5, or enter a calendar year such as 2022."
          />
        </label>
        {startYear !== '' && (
          <button type="button" className={styles.clearBtn} onClick={() => setStartYear('')}>Use Year 1</button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>Enter a starting fee to see how it escalates.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Year</th>
              <th>Annual fee</th>
              <th>Increase vs prior year</th>
              <th>Increase vs {rows[0].label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{money(r.amount)}</td>
                <td>{r.change == null ? '-' : money(r.change)}</td>
                <td>{r.cumulative ? `${money(r.cumulative)} (${pct(r.cumulativePct)})` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>5-year total</td>
              <td>{money(total)}</td>
              <td colSpan={2} className={styles.note}>
                {money(total - flatTotal)} more than {YEARS} flat years at {money(feeNum)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
