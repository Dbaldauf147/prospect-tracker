import { useEffect, useState } from 'react';
import styles from './DailySuccess.module.css';
import {
  DEFAULT_COACHING_RULES,
  subscribeToCoachingRules,
  saveCoachingRules,
} from './coachingRulesStore';

// Inline panel that lets the user edit the structured thresholds +
// free-form notes that shape Claude's morning suggestions.
//
// Lives inside the morning modal body. Subscribes to Firestore so an
// edit on another device updates the panel live. Writes are debounced
// at the field level via blur — no save button required.
export function CoachingRulesPanel({ user, onClose }) {
  const uid = user?.uid;
  const [rules, setRules] = useState(DEFAULT_COACHING_RULES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToCoachingRules(uid, (r) => {
      setRules(r);
      setLoaded(true);
    });
    return () => unsub();
  }, [uid]);

  function patchThreshold(key, value) {
    const next = {
      ...rules,
      thresholds: { ...rules.thresholds, [key]: Number(value) || 0 },
    };
    setRules(next);
    saveCoachingRules(uid, next).catch(err => console.warn('saveCoachingRules', err));
  }

  function patchNotes(value) {
    const next = { ...rules, notes: value };
    setRules(next);
  }

  function commitNotes() {
    saveCoachingRules(uid, rules).catch(err => console.warn('saveCoachingRules', err));
  }

  if (!uid) return null;

  return (
    <div className={styles.rulesBox}>
      <div className={styles.rulesHead}>
        <strong>Coaching rules</strong>
        <span className={styles.smallNote} style={{ flex: 1, marginLeft: 8 }}>
          Saved to your account — Claude reads these every morning.
        </span>
        {onClose && (
          <button type="button" className={styles.btnGhost} onClick={onClose} title="Hide rules editor">×</button>
        )}
      </div>

      {!loaded && <div className={styles.smallNote}>Loading rules…</div>}

      {loaded && (
        <>
          <div className={styles.rulesGrid}>
            <ThresholdField
              label="Skip lead-gen when active opps ≥"
              hint="e.g. 15 means: if you have 15+ active opps, Claude won't push prospecting today. 0 = always allow lead-gen."
              suffix="opps"
              value={rules.thresholds.leadGenPauseAtActiveOpps}
              onChange={(v) => patchThreshold('leadGenPauseAtActiveOpps', v)}
            />
            <ThresholdField
              label="Skip lead-gen when total quoted ≥"
              hint="Dollars. If total quoted across active opps hits this, Claude prioritizes closing over prospecting. 0 = ignore."
              prefix="$"
              value={rules.thresholds.leadGenPauseAtQuotedTotal}
              onChange={(v) => patchThreshold('leadGenPauseAtQuotedTotal', v)}
            />
            <ThresholdField
              label="Follow-ups become urgent after"
              hint="Days past their Follow-Up date before Claude flags them as top-priority barriers."
              suffix="days"
              value={rules.thresholds.followUpUrgencyDays}
              onChange={(v) => patchThreshold('followUpUrgencyDays', v)}
            />
            <ThresholdField
              label="Quote is 'stuck' after no contact for"
              hint="Days since 'Last Client Heard From Us' on a Quoting/Quoted/Verbal opp before Claude treats it as stuck."
              suffix="days"
              value={rules.thresholds.stuckQuoteDays}
              onChange={(v) => patchThreshold('stuckQuoteDays', v)}
            />
          </div>

          <label className={styles.rulesNotesLabel}>
            Additional rules / context for Claude
          </label>
          <textarea
            className={styles.rulesNotes}
            value={rules.notes}
            placeholder={'• Q2 focus is energy clients, deprioritize healthcare suggestions\n• Friday afternoons skip outreach goals\n• If Acme Corp shows up in stuck quotes, escalate to call (not email)'}
            onChange={(e) => patchNotes(e.target.value)}
            onBlur={commitNotes}
          />
          <p className={styles.smallNote}>Free-form. Claude reads this as standing instructions every morning. Saves on blur.</p>
        </>
      )}
    </div>
  );
}

function ThresholdField({ label, hint, prefix, suffix, value, onChange }) {
  return (
    <label className={styles.rulesField} title={hint}>
      <span className={styles.rulesFieldLabel}>{label}</span>
      <span className={styles.rulesFieldInputWrap}>
        {prefix && <span className={styles.rulesAffix}>{prefix}</span>}
        <input
          type="number"
          min="0"
          step="1"
          className={styles.rulesInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className={styles.rulesAffix}>{suffix}</span>}
      </span>
    </label>
  );
}
