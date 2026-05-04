import { useEffect, useState } from 'react';
import styles from './DailySuccess.module.css';
import {
  DEFAULT_COACHING_RULES,
  subscribeToCoachingRules,
  saveCoachingRules,
} from './coachingRulesStore';

// Inline panel for the user's standing coaching rules. Subscribes to
// Firestore so an edit on another device updates the panel live.
// Saves on blur — no save button required.
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

  function patchNotes(value) {
    setRules(prev => ({ ...prev, notes: value }));
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
          <textarea
            className={styles.rulesNotes}
            value={rules.notes}
            placeholder={'• Skip lead-gen when I have 15+ active opps\n• Skip lead-gen when total quoted is over $500k\n• Treat follow-ups as urgent once they are 7+ days overdue\n• Treat a Quoting/Quoted/Verbal opp as stuck after 14 days of no client contact\n• Q2 focus is energy clients, deprioritize healthcare\n• Friday afternoons skip outreach goals'}
            onChange={(e) => patchNotes(e.target.value)}
            onBlur={commitNotes}
          />
          <p className={styles.smallNote}>Free-form. Claude reads this verbatim as standing instructions every morning. Saves when you click out of the box.</p>
        </>
      )}
    </div>
  );
}
