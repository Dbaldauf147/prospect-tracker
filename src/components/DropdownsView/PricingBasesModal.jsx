import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASIS_KINDS, PRICING_BASES, makeBasisKey, makeUnitKey } from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Edit the Pricing Basis picklist behind Dropdowns › Services Pricing.
//
// A basis is a label plus how it works out a fee: a flat figure, a rate
// times a count, or a cut of the deal size. The per-unit ones also name the
// count they multiply ("Trucks"), and that name is what the estimator's box
// asks for — so adding "Per truck" here is all it takes for a service to be
// priced per truck and for the bar above the table to ask how many there are.
//
// Keys are generated once, from the label, and never change afterwards:
// renaming a basis keeps every service already priced on it. Deleting one is
// the only edit that costs anything, so it says how many services it would
// take the pricing off first — and because the key follows the name, adding
// a deleted basis back under the same name puts those rates back to work.

// A draft row's identity for React — its key once it has one, otherwise a
// per-row id that survives edits (a new row has no key until it's saved).
let nextDraftId = 1;

function toDraft(basis) {
  return {
    id: `saved:${basis.key}`,
    key: basis.key,
    label: basis.label,
    kind: basis.kind,
    unit: basis.unit || '',
    unitLabel: basis.unitLabel || '',
  };
}

function blankDraft() {
  return { id: `new:${nextDraftId++}`, key: '', label: '', kind: 'unit', unit: '', unitLabel: '' };
}

export function PricingBasesModal({ bases, usage, onSave, onClose }) {
  const [draft, setDraft] = useState(() => (bases || PRICING_BASES).map(toDraft));
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function editRow(id, patch) {
    setDraft(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(row) {
    const used = usage?.get(row.key) || 0;
    if (used > 0 && !window.confirm(
      `"${row.label}" prices ${used} service${used === 1 ? '' : 's'}. Deleting it leaves ${used === 1 ? 'that service' : 'those services'} `
      + 'with no pricing basis until you pick another. The rates stay on file, so adding it back under the same '
      + 'name picks them up again. Delete it?',
    )) return;
    setDraft(rows => rows.filter(r => r.id !== row.id));
  }

  function moveRow(index, delta) {
    setDraft(rows => {
      const to = index + delta;
      if (to < 0 || to >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  // What's wrong with the list as it stands, in the order worth fixing it.
  // Save is held back until there's nothing — a picklist with two options
  // reading the same thing is a bug, not a preference.
  const error = useMemo(() => {
    if (draft.length === 0) return 'Add at least one basis, or the Pricing Basis column has nothing to offer.';
    if (draft.some(r => !r.label.trim())) return 'Every basis needs a name.';
    const unitGap = draft.find(r => r.kind === 'unit' && !r.unitLabel.trim());
    if (unitGap) return `"${unitGap.label.trim()}" is per-unit, so it needs the name of the count it multiplies — Sites, Meters, Trucks.`;
    const seen = new Set();
    for (const r of draft) {
      const k = r.label.trim().toLowerCase();
      if (seen.has(k)) return `Two bases are both called "${r.label.trim()}".`;
      seen.add(k);
    }
    return '';
  }, [draft]);

  function save() {
    if (error) return;
    // Keys are minted here rather than when a row is added, so a row that
    // was typed and then renamed still gets a key that reads like its final
    // label. Existing rows keep theirs untouched.
    const takenKeys = new Set(draft.map(r => r.key).filter(Boolean));
    const takenUnits = new Set(draft.map(r => r.unit).filter(Boolean));
    const out = draft.map(row => {
      const label = row.label.trim();
      let key = row.key;
      if (!key) { key = makeBasisKey(label, takenKeys); takenKeys.add(key); }
      if (row.kind !== 'unit') return { key, label, kind: row.kind, unit: null, unitLabel: null };
      const unitLabel = row.unitLabel.trim();
      // The unit key outlives its label the same way a basis key does: the
      // counts already typed against "Sites" follow it when it's renamed.
      let unit = row.unit;
      if (!unit) { unit = makeUnitKey(unitLabel, takenUnits); takenUnits.add(unit); }
      return { key, label, kind: 'unit', unit, unitLabel };
    });
    onSave(out);
  }

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        className={styles.basesPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Pricing bases"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>Pricing bases</h3>
            <div className={styles.oppPickerSub}>
              The options in the Pricing Basis column. A per-unit basis names the count it multiplies, and
              the estimator asks for that count whenever a service in scope is priced on it.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.basesBody}>
          <div className={styles.basesHeadRow}>
            <span />
            <span>Name</span>
            <span>How it prices</span>
            <span>Counts</span>
            <span />
          </div>

          {draft.map((row, i) => {
            const used = usage?.get(row.key) || 0;
            return (
              <div key={row.id} className={styles.basesRow}>
                <div className={styles.basesMoveCol}>
                  <button
                    type="button"
                    className={styles.stageMoveBtn}
                    onClick={() => moveRow(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    aria-label={`Move ${row.label || 'basis'} up`}
                  >▲</button>
                  <button
                    type="button"
                    className={styles.stageMoveBtn}
                    onClick={() => moveRow(i, 1)}
                    disabled={i === draft.length - 1}
                    title="Move down"
                    aria-label={`Move ${row.label || 'basis'} down`}
                  >▼</button>
                </div>

                <div className={styles.basesNameCol}>
                  <input
                    ref={i === 0 ? firstInputRef : undefined}
                    type="text"
                    className={styles.basesInput}
                    value={row.label}
                    placeholder="Per truck"
                    onChange={e => editRow(row.id, { label: e.target.value })}
                    aria-label="Basis name"
                  />
                  {used > 0 && (
                    <span className={styles.basesUsage} title="Services priced on this basis today">
                      {used} service{used === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                <select
                  className={styles.basesSelect}
                  value={row.kind}
                  onChange={e => editRow(row.id, { kind: e.target.value })}
                  title={BASIS_KINDS.find(k => k.kind === row.kind)?.hint}
                  aria-label="How it prices"
                >
                  {BASIS_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>

                {row.kind === 'unit' ? (
                  <input
                    type="text"
                    className={styles.basesInput}
                    value={row.unitLabel}
                    placeholder="Trucks"
                    onChange={e => editRow(row.id, { unitLabel: e.target.value })}
                    title="What the estimator's count box is labelled, and what the Units column counts"
                    aria-label="Unit name"
                  />
                ) : (
                  <span className={styles.basesNoUnit}>
                    {row.kind === 'percent' ? 'Deal size' : 'Nothing'}
                  </span>
                )}

                <button
                  type="button"
                  className={styles.stageRemoveBtn}
                  onClick={() => removeRow(row)}
                  title={used > 0 ? `Delete — ${used} service${used === 1 ? '' : 's'} price on this` : 'Delete'}
                  aria-label={`Delete ${row.label || 'basis'}`}
                >×</button>
              </div>
            );
          })}

          <button
            type="button"
            className={styles.addStageBtn}
            onClick={() => setDraft(rows => [...rows, blankDraft()])}
          >+ Add a pricing basis</button>
        </div>

        <div className={styles.basesFooter}>
          <button
            type="button"
            className={styles.showHiddenBtn}
            onClick={() => setDraft(PRICING_BASES.map(toDraft))}
            title="Put the list back to the eight bases the tab ships with. Nothing is saved until you click Save."
          >Reset to defaults</button>
          {error && <span className={styles.basesError}>{error}</span>}
          <span className={styles.basesFooterSpacer} />
          <button type="button" className={styles.showHiddenBtn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={styles.importOppBtn}
            onClick={save}
            disabled={!!error}
            title={error || 'Save the list — services keep the basis they’re already on'}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
