// Commissions > Earlier versions: the copies of the roster the cloud kept
// each time it was replaced, and a Restore beside each. The popup itself is
// common/MirrorVersionsModal; this names the roster and how to put it back.
import { MirrorVersionsModal } from '../common/MirrorVersionsModal';
import { COMMISSIONS_MIRROR_KEY, restoreCommissions } from '../../utils/commissionsStore';

const CHOICES = [{ key: COMMISSIONS_MIRROR_KEY, label: 'commissions roster' }];

export function CommissionsVersionsModal({ currentRows = 0, onClose }) {
  return (
    <MirrorVersionsModal
      choices={CHOICES}
      noun="roster"
      unit="rows"
      defaultDatabase="commissions-recovery"
      currentCount={() => currentRows}
      onRestore={(_key, json) => {
        const rows = JSON.parse(json);
        if (!Array.isArray(rows)) throw new Error('That version could not be read.');
        restoreCommissions(rows);
      }}
      onClose={onClose}
    />
  );
}
