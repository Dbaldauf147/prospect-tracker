// The Services subtab's bucket editor: add, rename, reorder and delete the
// boxes of the services board.
//
// The boxes used to be editable only from a company card's Edit Services
// mode, which is a strange place to go looking for a setting that every
// board shares. This is the same layout (settings.customServiceCategories),
// edited through the same helpers, so the Scope picker, the company card and
// the Service Bucket column all follow.
//
// Filing a service into a bucket stays where it was: the Service Bucket
// column on each row.

import { useState } from 'react';
import {
  addServiceBox, renameServiceBox, deleteServiceBox, moveServiceBox, UNGROUPED_SERVICES,
} from '../../utils/serviceCategoriesStore';
import { isGraveyardBucket } from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

function BucketRow({ cat, index, categories, onSave }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const editing = draft !== null;
  const count = cat.items.length;
  const dead = isGraveyardBucket(cat.name);
  // The graveyard always sinks to the bottom of the board, so moving a live
  // bucket below it (or the graveyard above one) would save and change
  // nothing on screen.
  const prev = categories[index - 1];
  const next = categories[index + 1];
  const canUp = !!prev && isGraveyardBucket(prev.name) === dead;
  const canDown = !!next && isGraveyardBucket(next.name) === dead;

  function commit() {
    const result = renameServiceBox(categories, cat.name, draft);
    if (result.error) { setError(result.error); return; }
    if (result.categories) onSave(result.categories);
    setDraft(null);
    setError('');
  }
  function cancel() { setDraft(null); setError(''); }
  function move(delta) {
    const result = moveServiceBox(categories, cat.name, delta);
    if (result.categories) onSave(result.categories);
  }
  function remove() {
    const msg = count
      ? `Delete the "${cat.name}" bucket? Its ${count} service${count === 1 ? '' : 's'} will move to "${UNGROUPED_SERVICES}" until you file them somewhere else. Nothing is deleted from a company.`
      : `Delete the empty "${cat.name}" bucket?`;
    if (!window.confirm(msg)) return;
    const result = deleteServiceBox(categories, cat.name);
    if (result.categories) onSave(result.categories);
  }

  return (
    <li className={styles.bucketRow}>
      <div className={styles.bucketMoves}>
        <button type="button" className={styles.bucketIconBtn} onClick={() => move(-1)} disabled={!canUp} title="Move up the board" aria-label={`Move ${cat.name} up`}>▲</button>
        <button type="button" className={styles.bucketIconBtn} onClick={() => move(1)} disabled={!canDown} title="Move down the board" aria-label={`Move ${cat.name} down`}>▼</button>
      </div>
      {editing ? (
        <input
          autoFocus
          className={styles.bucketNameInput}
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          aria-label="Bucket name"
        />
      ) : (
        <button
          type="button"
          className={dead ? `${styles.bucketName} ${styles.bucketNameDead}` : styles.bucketName}
          onClick={() => setDraft(cat.name)}
          title="Click to rename"
        >{cat.name}</button>
      )}
      <span className={styles.bucketCount}>{count} service{count === 1 ? '' : 's'}</span>
      <span className={styles.bucketActions}>
        {editing ? (
          <>
            <button type="button" className={styles.addServiceSave} onClick={commit}>Save</button>
            <button type="button" className={styles.showHiddenBtn} onClick={cancel}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className={styles.showHiddenBtn} onClick={() => setDraft(cat.name)}>Rename</button>
            <button type="button" className={styles.bucketDeleteBtn} onClick={remove}>Delete</button>
          </>
        )}
      </span>
      {error && <span className={styles.bucketError}>{error}</span>}
    </li>
  );
}

export default function ServiceBucketsPanel({ categories, unfiledCount, onSave, onClose }) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  function add() {
    const result = addServiceBox(categories, newName);
    if (result.error) { setError(result.error); return; }
    onSave(result.categories);
    setNewName('');
    setError('');
  }

  return (
    <div className={styles.bucketPanel}>
      <div className={styles.bucketPanelHead}>
        <strong>Service buckets</strong>
        <span className={styles.addServiceNote}>
          The boxes on the services board, in board order. To put a service in a bucket, use its Service Bucket column below.
          {unfiledCount > 0 && ` ${unfiledCount} service${unfiledCount === 1 ? ' is' : 's are'} in no bucket and show under "${UNGROUPED_SERVICES}".`}
        </span>
        <button type="button" className={styles.showHiddenBtn} onClick={onClose}>Done</button>
      </div>
      <ul className={styles.bucketList}>
        {categories.map((cat, i) => (
          <BucketRow key={cat.name} cat={cat} index={i} categories={categories} onSave={onSave} />
        ))}
      </ul>
      <div className={styles.bucketAddRow}>
        <input
          className={styles.addServiceInput}
          placeholder="New bucket name"
          value={newName}
          onChange={e => { setNewName(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" className={styles.addServiceSave} onClick={add} disabled={!newName.trim()}>+ Add bucket</button>
        {error && <span className={styles.bucketError}>{error}</span>}
      </div>
    </div>
  );
}
