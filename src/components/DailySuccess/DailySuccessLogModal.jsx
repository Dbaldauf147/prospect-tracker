import { useEffect, useState } from 'react';
import styles from './DailySuccess.module.css';
import { getAllEntries, upsertEntry, deleteEntry, completionStats, newBullet } from './dailySuccessStore';

export function DailySuccessLogModal({ open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [expanded, setExpanded] = useState(null); // date string

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAllEntries().then(list => {
      if (!cancelled) setEntries(list);
    });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  async function refresh() {
    const list = await getAllEntries();
    setEntries(list);
  }

  async function patch(date, patchObj) {
    await upsertEntry(date, patchObj);
    await refresh();
  }

  async function remove(date) {
    if (!confirm(`Delete the log for ${date}?`)) return;
    await deleteEntry(date);
    await refresh();
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.logModal}>
        <div className={styles.head}>
          <div className={styles.title}>Daily Success Log</div>
          <div className={styles.sub}>Click a date to view or edit. Numbers show what was checked off at 1 PM and 5 PM.</div>
        </div>
        <div className={styles.body}>
          {entries.length === 0 && (
            <p className={styles.smallNote}>No entries yet — write your first plan in the morning prompt.</p>
          )}
          {entries.length > 0 && (
            <table className={styles.logTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bullets</th>
                  <th>1 PM</th>
                  <th>5 PM</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const s = completionStats(e);
                  const pctMid = s.total ? Math.round((s.doneMid / s.total) * 100) : 0;
                  const pctEnd = s.total ? Math.round((s.doneEnd / s.total) * 100) : 0;
                  const isOpen = expanded === e.date;
                  return (
                    <ExpandableRow
                      key={e.date}
                      entry={e}
                      stats={s}
                      pctMid={pctMid}
                      pctEnd={pctEnd}
                      open={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : e.date)}
                      onPatch={(patchObj) => patch(e.date, patchObj)}
                      onDelete={() => remove(e.date)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className={styles.foot}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('daily-success:open-morning'));
              onClose();
            }}
            title="Reopen the 'What does success look like today?' prompt"
          >Open morning prompt</button>
          <div style={{ flex: 1 }} />
          <button type="button" className={styles.btnPrimary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ExpandableRow({ entry, stats, pctMid, pctEnd, open, onToggle, onPatch, onDelete }) {
  const fmt = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  function setBulletText(id, text) {
    const next = entry.bullets.map(b => (b.id === id ? { ...b, text } : b));
    onPatch({ bullets: next });
  }
  function toggleBullet(id, field) {
    const next = entry.bullets.map(b => (b.id === id ? { ...b, [field]: !b[field] } : b));
    onPatch({ bullets: next });
  }
  function deleteBullet(id) {
    onPatch({ bullets: entry.bullets.filter(b => b.id !== id) });
  }
  function addBullet(text) {
    const cleaned = (text || '').trim();
    if (!cleaned) return;
    onPatch({ bullets: [...entry.bullets, newBullet(cleaned)] });
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={styles.logExpandBtn} onClick={onToggle}>
            {open ? '▾' : '▸'} {fmt(entry.date)}
          </button>
        </td>
        <td>{stats.total}</td>
        <td>
          {stats.doneMid} / {stats.total}
          <span className={styles.statBar}><span className={styles.statFill} style={{ width: `${pctMid}%` }} /></span>
          {pctMid}%
        </td>
        <td>
          {stats.doneEnd} / {stats.total}
          <span className={styles.statBar}><span className={styles.statFill} style={{ width: `${pctEnd}%` }} /></span>
          {pctEnd}%
        </td>
        <td>
          <button type="button" className={styles.delBtn} onClick={onDelete} title="Delete this day">×</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: '#f8fafc' }}>
            {entry.bullets.length === 0 && <div className={styles.smallNote}>No bullets recorded for this day.</div>}
            {entry.bullets.map(b => (
              <div key={b.id} className={styles.bullet}>
                <label title="1 PM checked" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={!!b.doneMid}
                    onChange={() => toggleBullet(b.id, 'doneMid')}
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>1p</span>
                </label>
                <label title="5 PM checked" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={!!b.doneEnd}
                    onChange={() => toggleBullet(b.id, 'doneEnd')}
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>5p</span>
                </label>
                <input
                  className={styles.bulletText}
                  value={b.text}
                  onChange={(e) => setBulletText(b.id, e.target.value)}
                />
                <button type="button" className={styles.delBtn} onClick={() => deleteBullet(b.id)} title="Remove bullet">×</button>
              </div>
            ))}
            <AddBulletRow onAdd={addBullet} />
          </td>
        </tr>
      )}
    </>
  );
}

function AddBulletRow({ onAdd }) {
  const [v, setV] = useState('');
  return (
    <div className={styles.addRow}>
      <input
        className={styles.addInput}
        placeholder="Add a bullet…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(v); setV(''); } }}
      />
      <button type="button" className={styles.btn} onClick={() => { onAdd(v); setV(''); }}>Add</button>
    </div>
  );
}
