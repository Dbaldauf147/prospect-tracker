import { useCallback, useEffect, useState } from 'react';
import styles from './CalculatorTab.module.css';

// Trim floating-point noise (0.1 + 0.2 → 0.3) and guard against the
// non-finite results a divide-by-zero produces.
const fmt = (n) => {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  return String(rounded);
};

const compute = (a, b, op) => {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
};

// A plain four-function calculator. Keeps the classic accumulator / pending
// operator / waiting-for-operand state machine so chained entries
// (e.g. 2 + 3 × 4 =) behave the way a desktop calculator does.
export function CalculatorTab() {
  const [display, setDisplay] = useState('0');
  const [accumulator, setAccumulator] = useState(null);
  const [op, setOp] = useState(null);
  const [waiting, setWaiting] = useState(false);

  // Standalone "multiply one item by another" helper shown beside the
  // calculator. Kept independent of the main calculator's state so the two
  // don't interfere. Inputs stay as free text so partial entries (e.g. a
  // lone "-" or trailing ".") don't get clobbered mid-typing.
  const [mulA, setMulA] = useState('');
  const [mulB, setMulB] = useState('');
  const mulValA = parseFloat(mulA);
  const mulValB = parseFloat(mulB);
  const mulProduct = Number.isFinite(mulValA) && Number.isFinite(mulValB)
    ? mulValA * mulValB
    : null;

  const clearAll = useCallback(() => {
    setDisplay('0');
    setAccumulator(null);
    setOp(null);
    setWaiting(false);
  }, []);

  const inputDigit = useCallback((d) => {
    setDisplay((cur) => {
      if (waiting) return d;
      if (cur === '0' || cur === 'Error') return d;
      if (cur.replace(/[-.]/g, '').length >= 15) return cur; // cap length
      return cur + d;
    });
    if (waiting) setWaiting(false);
  }, [waiting]);

  const inputDot = useCallback(() => {
    setDisplay((cur) => {
      if (waiting || cur === 'Error') return '0.';
      return cur.includes('.') ? cur : cur + '.';
    });
    if (waiting) setWaiting(false);
  }, [waiting]);

  const toggleSign = useCallback(() => {
    setDisplay((cur) => (cur === '0' || cur === 'Error' ? cur : fmt(parseFloat(cur) * -1)));
  }, []);

  const inputPercent = useCallback(() => {
    setDisplay((cur) => (cur === 'Error' ? '0' : fmt(parseFloat(cur) / 100)));
  }, []);

  const backspace = useCallback(() => {
    if (waiting) return;
    setDisplay((cur) => {
      if (cur === 'Error') return '0';
      const next = cur.length > 1 ? cur.slice(0, -1) : '0';
      return next === '-' || next === '' ? '0' : next;
    });
  }, [waiting]);

  const applyOp = useCallback((nextOp) => {
    const value = parseFloat(display);
    if (op != null && !waiting) {
      const result = compute(accumulator, value, op);
      setAccumulator(Number.isFinite(result) ? result : null);
      setDisplay(fmt(result));
    } else {
      setAccumulator(value);
    }
    setWaiting(true);
    setOp(nextOp);
  }, [display, op, waiting, accumulator]);

  const equals = useCallback(() => {
    if (op == null || accumulator == null) return;
    const result = compute(accumulator, parseFloat(display), op);
    setDisplay(fmt(result));
    setAccumulator(null);
    setOp(null);
    setWaiting(true);
  }, [op, accumulator, display]);

  // Keyboard support — calculators are muscle-memory tools, so mirror the
  // on-screen keys to the number row and operators.
  useEffect(() => {
    const onKey = (e) => {
      // Don't hijack typing in the Multiply inputs (or any other field).
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      const k = e.key;
      if (k >= '0' && k <= '9') { inputDigit(k); }
      else if (k === '.') { inputDot(); }
      else if (k === '+') { applyOp('+'); }
      else if (k === '-') { applyOp('−'); }
      else if (k === '*') { applyOp('×'); }
      else if (k === '/') { e.preventDefault(); applyOp('÷'); }
      else if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); }
      else if (k === 'Backspace') { backspace(); }
      else if (k === 'Escape') { clearAll(); }
      else if (k === '%') { inputPercent(); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputDigit, inputDot, applyOp, equals, backspace, clearAll, inputPercent]);

  const digit = (d) => (
    <button type="button" className={styles.key} onClick={() => inputDigit(d)}>{d}</button>
  );
  const opKey = (symbol) => (
    <button
      type="button"
      className={`${styles.key} ${styles.opKey} ${op === symbol && waiting ? styles.opKeyActive : ''}`}
      onClick={() => applyOp(symbol)}
    >{symbol}</button>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.calc}>
        <div className={styles.display} title={display}>{display}</div>
        <div className={styles.pad}>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={clearAll}>AC</button>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={toggleSign}>±</button>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={inputPercent}>%</button>
          {opKey('÷')}
          {digit('7')}{digit('8')}{digit('9')}{opKey('×')}
          {digit('4')}{digit('5')}{digit('6')}{opKey('−')}
          {digit('1')}{digit('2')}{digit('3')}{opKey('+')}
          <button type="button" className={`${styles.key} ${styles.zeroKey}`} onClick={() => inputDigit('0')}>0</button>
          <button type="button" className={styles.key} onClick={inputDot}>.</button>
          <button type="button" className={`${styles.key} ${styles.eqKey}`} onClick={equals}>=</button>
        </div>
        <div className={styles.hint}>Tip: your keyboard's number and operator keys work here too.</div>
      </div>

      <div className={styles.multiply}>
        <div className={styles.multiplyTitle}>Multiply</div>
        <div className={styles.multiplyBody}>
          <input
            type="text"
            inputMode="decimal"
            className={styles.multiplyInput}
            placeholder="0"
            value={mulA}
            onChange={(e) => setMulA(e.target.value)}
            aria-label="First value"
          />
          <span className={styles.multiplySign}>×</span>
          <input
            type="text"
            inputMode="decimal"
            className={styles.multiplyInput}
            placeholder="0"
            value={mulB}
            onChange={(e) => setMulB(e.target.value)}
            aria-label="Second value"
          />
          <div className={styles.multiplyResult}>
            <span className={styles.multiplyResultLabel}>=</span>
            <span className={styles.multiplyResultValue}>{mulProduct == null ? '-' : fmt(mulProduct)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
