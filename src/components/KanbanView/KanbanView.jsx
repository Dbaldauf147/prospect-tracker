import { useState } from 'react';
import { STATUSES, STATUS_COLORS } from '../../data/enums';
import { Badge } from '../common/Badge';
import { tierColor, formatAum } from '../../utils/formatters';
import styles from './KanbanView.module.css';

function KanbanCard({ prospect, onSelect, onDragStart }) {
  return (
    <div
      className={styles.card}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', prospect.id);
        onDragStart(prospect.id);
      }}
    >
      <div className={styles.cardCompany} onClick={() => onSelect(prospect)}>
        {prospect.company}
      </div>
      <div className={styles.cardMeta}>
        {prospect.tier && <Badge label={prospect.tier} color={tierColor(prospect.tier)} />}
        {prospect.type && <span className={styles.cardMetaText}>{prospect.type}</span>}
        {(prospect.reAum || prospect.peAum) && (
          <span className={styles.cardMetaText}>
            {prospect.reAum ? `RE ${formatAum(prospect.reAum)}` : `PE ${formatAum(prospect.peAum)}`}
          </span>
        )}
      </div>
    </div>
  );
}

export function KanbanView({ prospects, onUpdate, onSelect }) {
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const grouped = {};
  for (const s of STATUSES) grouped[s] = [];
  for (const p of prospects) {
    const status = STATUSES.includes(p.status) ? p.status : 'Inside Sales';
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(p);
  }

  function handleDrop(e, status) {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    if (id) {
      onUpdate(id, { status });
    }
    setDraggingId(null);
  }

  return (
    <div className={styles.board}>
      {STATUSES.map(status => (
        <div
          key={status}
          className={`${styles.column} ${dragOverCol === status ? styles.columnDragOver : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOverCol(status); }}
          onDragLeave={() => setDragOverCol(null)}
          onDrop={e => handleDrop(e, status)}
        >
          <div className={styles.columnHeader} style={{ borderBottomColor: STATUS_COLORS[status] }}>
            <span className={styles.columnDot} style={{ background: STATUS_COLORS[status] }} />
            <span className={styles.columnTitle}>{status}</span>
            <span className={styles.columnCount}>{grouped[status]?.length || 0}</span>
          </div>
          <div className={styles.columnBody}>
            {(grouped[status] || []).map(p => (
              <KanbanCard
                key={p.id}
                prospect={p}
                onSelect={onSelect}
                onDragStart={setDraggingId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
