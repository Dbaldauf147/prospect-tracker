// What the Vertical conflict popup (ProspectModal/VerticalConflictPopup)
// offers when a company's card and the Targets list disagree.

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The choices on offer, in the order shown.
//   conflict: { company, cardVertical, listVertical, source, onList }
//   suggestion: the Suggest result ({ vertical, confidence, reason }) or null
export function verticalConflictChoices(conflict, suggestion) {
  const card = String(conflict?.cardVertical || '').trim();
  const list = String(conflict?.listVertical || '').trim();
  const out = [];
  if (list) {
    out.push({
      id: 'targets', value: list, label: 'Targets list',
      detail: `${conflict.source ? `From ${conflict.source}. ` : ''}Sets this company's Vertical to ${list}.${conflict.onList === false ? ' It is not on your Dropdowns › Vertical list yet.' : ''}`,
    });
  }
  if (card) {
    out.push({
      id: 'card', value: card, label: 'This card',
      detail: `Keeps ${card} for this company and stops flagging the difference. The flag comes back if the Vertical changes.`,
    });
  }
  const suggested = String(suggestion?.vertical || '').trim();
  if (suggested && !sameText(suggested, card) && !sameText(suggested, list)) {
    out.push({
      id: 'suggested', value: suggested, label: 'Suggested by Claude',
      detail: `${suggestion.confidence && suggestion.confidence !== 'high' ? `${suggestion.confidence[0].toUpperCase()}${suggestion.confidence.slice(1)} confidence. ` : ''}${suggestion.reason || `Sets this company's Vertical to ${suggested}.`}`,
    });
  }
  if (card && list) {
    out.push({
      id: 'same', value: `${list} = ${card}`, label: 'They are the same thing',
      detail: `Keeps ${card} here and counts the Targets list's ${list} as ${card} from now on, for every company.`,
    });
  }
  return out;
}

