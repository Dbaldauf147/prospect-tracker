// How a contact reads on a deal: champion, neutral, or detractor.
//
// Set on the contact popup and stored per user, keyed by contact id:
//   settings.contactSentiment[contactId] = 'champion' | 'detractor'
//
// Neutral is the absence of a value rather than a stored 'neutral' — it's
// the default for every contact anyone has never touched, so writing it
// down would mean a key per contact in the tracker to say nothing. Clearing
// the field deletes the key, which is the same thing read back.
//
// HubSpot has nowhere to put this, so it lives in settings alongside the
// other local-only contact fields (team name, met-in-person, …).

export const CHAMPION = 'champion';
export const DETRACTOR = 'detractor';

// The picker's three choices, in the order they read: for us, neither,
// against us. Neutral carries the empty value, which is what clears the key.
export const SENTIMENT_OPTIONS = [
  { value: CHAMPION, label: 'Champion' },
  { value: '', label: 'Neutral' },
  { value: DETRACTOR, label: 'Detractor' },
];

// Anything that isn't one of the two stored values reads as neutral —
// including the legacy-looking 'neutral' string, should one ever be written.
export function normalizeSentiment(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === CHAMPION || v === DETRACTOR ? v : '';
}

export function sentimentFor(map, contactId) {
  if (contactId == null) return '';
  return normalizeSentiment((map || {})[String(contactId)]);
}

// What to draw next to a name, or null for neutral — neutral is deliberately
// unmarked, so a chart of untouched contacts stays quiet and the marks that
// are there mean something.
export function sentimentMark(value) {
  const v = normalizeSentiment(value);
  if (v === CHAMPION) return { symbol: '★', color: '#D97706', label: 'Champion' };
  if (v === DETRACTOR) return { symbol: '!', color: '#DC2626', label: 'Detractor' };
  return null;
}
