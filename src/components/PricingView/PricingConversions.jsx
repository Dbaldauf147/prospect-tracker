import { useState } from 'react';
import styles from './PricingConversions.module.css';

const fmtMoney = (n, dp = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtPct = (n, dp = 1) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// The pricing model above folds a 4% tech-depreciation uplift into every
// non-pass-through cost (PricingView: cts × (1 + techDeprPct), techDeprPct
// = 0.04). These quick conversions mirror that assumption so a cost typed
// here lands on the same revenue / margin the full model would produce.
const COST_UPLIFT = 0.04;
const upCost = (c) => (c == null ? null : c * (1 + COST_UPLIFT));

// Editable number cell. Local-draft so re-renders don't fight typing;
// commits on blur / Enter.
function NumInput({ value, onChange, prefix, suffix, width = '6rem' }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <span className={styles.numInputWrap} style={{ width }}>
      {prefix && <span className={styles.affix}>{prefix}</span>}
      <input
        type="text"
        className={styles.numInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = toNum(draft);
          onChange(n);
          setDraft(n == null ? '' : String(n));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
        }}
      />
      {suffix && <span className={styles.affix}>{suffix}</span>}
    </span>
  );
}

function Card({ title, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  );
}

function Output({ children, strong }) {
  return <span className={`${styles.output} ${strong ? styles.outputStrong : ''}`}>{children}</span>;
}

// Muted helper line — shows the derived value (e.g. the +4% adjusted cost)
// that feeds the card's real outputs, so the assumption stays visible.
function HintRow({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.hintValue}>{children}</span>
    </div>
  );
}

export function PricingConversions() {
  // Each calculator owns its own little state. Sensible defaults that
  // match the worked example values from the request so the panel
  // shows the right answers on first open.
  const [c1Cost, setC1Cost] = useState(4960);
  const [c1Gm, setC1Gm] = useState(45);

  const [c2Rev, setC2Rev] = useState(4000);
  const [c2Gm, setC2Gm] = useState(50);

  const [c3Cost, setC3Cost] = useState(1500);
  const [c3Rev, setC3Rev] = useState(3000);

  const [c4Rev, setC4Rev] = useState(4688);
  const [c4Cost, setC4Cost] = useState(1500);

  const [c5Start, setC5Start] = useState(1500);
  const [c5End, setC5End] = useState(4687.56);

  const [open, setOpen] = useState(true);

  // Optional extra decimal places on the displayed conversion results.
  // This is purely a view control and is deliberately kept in local
  // state (not persisted), so refreshing the page returns to the
  // standard precision rather than making a wider view the new default.
  const [extraDp, setExtraDp] = useState(0);
  const money = (n) => fmtMoney(n, 2 + extraDp);
  const pct = (n, base = 1) => fmtPct(n, base + extraDp);

  // Costs are bumped 4% before every calculation to match the pricing
  // model above (tech-depreciation uplift). The adjusted figure is shown
  // on its own muted line so the assumption stays transparent.

  // 1) Cost + GM% -> Revenue (monthly) and Annual Retail (Revenue * 12)
  const c1CostAdj = upCost(c1Cost);
  const c1Revenue = c1CostAdj != null && c1Gm != null && c1Gm < 100
    ? c1CostAdj / (1 - c1Gm / 100)
    : null;
  const c1Annual = c1Revenue != null ? c1Revenue * 12 : null;

  // 2) Revenue (annual) + GM% -> Annual Cost and Monthly Cost. The derived
  //    cost is uplifted 4%, so it reflects the same higher cost the model
  //    books rather than the bare GM-implied figure.
  const c2BaseAnnualCost = c2Rev != null && c2Gm != null
    ? c2Rev * (1 - c2Gm / 100)
    : null;
  const c2AnnualCost = upCost(c2BaseAnnualCost);
  const c2MonthlyCost = c2AnnualCost != null ? c2AnnualCost / 12 : null;

  // 3) Cost + Revenue -> GM%
  const c3CostAdj = upCost(c3Cost);
  const c3Gm = c3CostAdj != null && c3Rev != null && c3Rev !== 0
    ? (c3Rev - c3CostAdj) / c3Rev
    : null;

  // 4) Revenue + Cost -> GM% (same math, kept as a separate card per
  //    the request — different ordering of inputs is what users will
  //    actually have in front of them).
  const c4CostAdj = upCost(c4Cost);
  const c4Gm = c4Rev != null && c4CostAdj != null && c4Rev !== 0
    ? (c4Rev - c4CostAdj) / c4Rev
    : null;

  // 5) Starting + Ending -> % Increase
  const c5Increase = c5Start != null && c5End != null && c5Start !== 0
    ? (c5End - c5Start) / c5Start
    : null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen(o => !o)}
        title={open ? 'Hide quick conversions' : 'Show quick conversions'}
      >
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        Quick conversions
      </button>
      {open && (
        <>
        <div className={styles.captionRow}>
          <span className={styles.caption}>
            Cost figures assume a 4% higher cost (tech-depreciation uplift), matching the pricing model above.
          </span>
          <div className={styles.dpControl} title="Add decimal places to the results below. This is a temporary view — it resets to the standard 2 places on refresh.">
            <span className={styles.dpLabel}>Decimals</span>
            <button
              type="button"
              className={styles.dpBtn}
              onClick={() => setExtraDp(d => Math.max(0, d - 1))}
              disabled={extraDp <= 0}
              aria-label="Fewer decimal places"
            >&minus;</button>
            <span className={styles.dpValue}>{2 + extraDp}</span>
            <button
              type="button"
              className={styles.dpBtn}
              onClick={() => setExtraDp(d => Math.min(6, d + 1))}
              disabled={extraDp >= 6}
              aria-label="More decimal places"
            >+</button>
          </div>
        </div>
        <div className={styles.cards}>
          <Card title="Cost → Revenue (with GM%)">
            <Row label="Cost"><NumInput value={c1Cost} onChange={setC1Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{money(c1CostAdj)}</HintRow>
            <Row label="Gross Margin"><NumInput value={c1Gm} onChange={setC1Gm} suffix="%" width="5rem" /></Row>
            <Row label="Revenue"><Output>{money(c1Revenue)}</Output></Row>
            <Row label="Annual retail"><Output strong>{money(c1Annual)}</Output></Row>
          </Card>

          <Card title="Revenue → Cost (with GM%)">
            <Row label="Revenue"><NumInput value={c2Rev} onChange={setC2Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><NumInput value={c2Gm} onChange={setC2Gm} suffix="%" width="5rem" /></Row>
            <HintRow label="Base cost">{money(c2BaseAnnualCost)}</HintRow>
            <Row label="Annual cost +4%"><Output>{money(c2AnnualCost)}</Output></Row>
            <Row label="Monthly cost +4%"><Output strong>{money(c2MonthlyCost)}</Output></Row>
          </Card>

          <Card title="Cost + Revenue → GM%">
            <Row label="Cost"><NumInput value={c3Cost} onChange={setC3Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{money(c3CostAdj)}</HintRow>
            <Row label="Revenue"><NumInput value={c3Rev} onChange={setC3Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><Output strong>{pct(c3Gm)}</Output></Row>
          </Card>

          <Card title="Revenue + Cost → GM%">
            <Row label="Revenue"><NumInput value={c4Rev} onChange={setC4Rev} prefix="$" /></Row>
            <Row label="Cost"><NumInput value={c4Cost} onChange={setC4Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{money(c4CostAdj)}</HintRow>
            <Row label="Gross Margin"><Output strong>{pct(c4Gm)}</Output></Row>
          </Card>

          <Card title="Starting → Ending → % Increase">
            <Row label="Starting"><NumInput value={c5Start} onChange={setC5Start} prefix="$" /></Row>
            <Row label="Ending"><NumInput value={c5End} onChange={setC5End} prefix="$" /></Row>
            <Row label="Increase"><Output strong>{pct(c5Increase, 0)}</Output></Row>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}
