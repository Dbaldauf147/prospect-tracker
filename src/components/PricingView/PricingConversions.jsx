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

  // 1) Cost + GM% -> Revenue (monthly) and Annual Retail (Revenue * 12)
  const c1Revenue = c1Cost != null && c1Gm != null && c1Gm < 100
    ? c1Cost / (1 - c1Gm / 100)
    : null;
  const c1Annual = c1Revenue != null ? c1Revenue * 12 : null;

  // 2) Revenue (annual) + GM% -> Annual Cost and Monthly Cost
  const c2AnnualCost = c2Rev != null && c2Gm != null
    ? c2Rev * (1 - c2Gm / 100)
    : null;
  const c2MonthlyCost = c2AnnualCost != null ? c2AnnualCost / 12 : null;

  // 3) Cost + Revenue -> GM%
  const c3Gm = c3Cost != null && c3Rev != null && c3Rev !== 0
    ? (c3Rev - c3Cost) / c3Rev
    : null;

  // 4) Revenue + Cost -> GM% (same math, kept as a separate card per
  //    the request — different ordering of inputs is what users will
  //    actually have in front of them).
  const c4Gm = c4Rev != null && c4Cost != null && c4Rev !== 0
    ? (c4Rev - c4Cost) / c4Rev
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
        <div className={styles.cards}>
          <Card title="Cost → Revenue (with GM%)">
            <Row label="Cost"><NumInput value={c1Cost} onChange={setC1Cost} prefix="$" /></Row>
            <Row label="Gross Margin"><NumInput value={c1Gm} onChange={setC1Gm} suffix="%" width="5rem" /></Row>
            <Row label="Revenue"><Output>{fmtMoney(c1Revenue)}</Output></Row>
            <Row label="Annual retail"><Output strong>{fmtMoney(c1Annual)}</Output></Row>
          </Card>

          <Card title="Revenue → Cost (with GM%)">
            <Row label="Revenue"><NumInput value={c2Rev} onChange={setC2Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><NumInput value={c2Gm} onChange={setC2Gm} suffix="%" width="5rem" /></Row>
            <Row label="Annual cost"><Output>{fmtMoney(c2AnnualCost)}</Output></Row>
            <Row label="Monthly cost"><Output strong>{fmtMoney(c2MonthlyCost)}</Output></Row>
          </Card>

          <Card title="Cost + Revenue → GM%">
            <Row label="Cost"><NumInput value={c3Cost} onChange={setC3Cost} prefix="$" /></Row>
            <Row label="Revenue"><NumInput value={c3Rev} onChange={setC3Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><Output strong>{fmtPct(c3Gm)}</Output></Row>
          </Card>

          <Card title="Revenue + Cost → GM%">
            <Row label="Revenue"><NumInput value={c4Rev} onChange={setC4Rev} prefix="$" /></Row>
            <Row label="Cost"><NumInput value={c4Cost} onChange={setC4Cost} prefix="$" /></Row>
            <Row label="Gross Margin"><Output strong>{fmtPct(c4Gm)}</Output></Row>
          </Card>

          <Card title="Starting → Ending → % Increase">
            <Row label="Starting"><NumInput value={c5Start} onChange={setC5Start} prefix="$" /></Row>
            <Row label="Ending"><NumInput value={c5End} onChange={setC5End} prefix="$" /></Row>
            <Row label="Increase"><Output strong>{fmtPct(c5Increase, 0)}</Output></Row>
          </Card>
        </div>
      )}
    </div>
  );
}
