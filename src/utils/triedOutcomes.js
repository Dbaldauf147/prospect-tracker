// "What I Tried" and the two buckets it feeds on the Pipeline page.
//
// Each thing tried is its own bullet, with an id, so it can be tagged into
// What Went Well, What Didn't Go Well, or both, and the tag survives the
// bullet being reworded. A tagged item carries its own note per bucket
// (wellNote / notWellNote), and each bucket also keeps its own bulleted
// notes for anything that isn't one of the tried items.
//
// Kept out of the component so the record cleanup and the export text can
// be asserted under plain Node - see scripts/triedOutcomes.test.mjs.

export const TRIED_BUCKETS = [
  { key: 'well', title: 'What Went Well', notesKey: 'wentWellNotes', noteKey: 'wellNote', tag: 'Went well' },
  { key: 'notWell', title: "What Didn't Go Well", notesKey: 'notWellNotes', noteKey: 'notWellNote', tag: "Didn't go well" },
];

let seq = 0;
export function newTriedItem(text = '') {
  seq += 1;
  return { id: `t${Date.now().toString(36)}${seq.toString(36)}`, text, well: false, notWell: false, wellNote: '', notWellNote: '' };
}

/** A stored triedItems value as something the page can render. */
export function sanitizeTriedItems(saved) {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  const out = [];
  for (const it of saved) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({
      id: it.id,
      text: typeof it.text === 'string' ? it.text : '',
      well: it.well === true,
      notWell: it.notWell === true,
      wellNote: typeof it.wellNote === 'string' ? it.wellNote : '',
      notWellNote: typeof it.notWellNote === 'string' ? it.notWellNote : '',
    });
  }
  return out;
}

const bullet = (s) => `• ${s}`;
// Notes typed in a bulleted box already carry their glyph; a line typed
// without one still reads as a bullet in the export.
const notesLines = (text) => String(text || '')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && l !== '•')
  .map(l => (l.startsWith('•') ? l : bullet(l)));

/**
 * The three sections as { title, text } notes for the Excel exports, which
 * already draw the page's strategy notes that way. Empty items are left
 * out; a section with nothing in it still exports its title so the report
 * shows the box was there.
 */
export function triedOutcomeNotes(state = {}, titles = {}) {
  const items = sanitizeTriedItems(state.triedItems).filter(it => it.text.trim());
  const tried = items.map((it) => {
    const tags = TRIED_BUCKETS.filter(b => it[b.key]).map(b => b.tag);
    return bullet(it.text.trim()) + (tags.length ? `  [${tags.join(', ')}]` : '');
  });
  return [
    { title: titles.tried || 'What I Tried', text: tried.join('\n') },
    ...TRIED_BUCKETS.map(b => ({
      title: titles[b.key] || b.title,
      text: [
        ...items.filter(it => it[b.key]).map((it) => {
          // A multi-line note reads as one line beside its item.
          const note = String(it[b.noteKey] || '').split('\n').map(l => l.replace(/^•\s*/, '').trim()).filter(Boolean).join('; ');
          return bullet(`Tried: ${it.text.trim()}${note ? ` - ${note}` : ''}`);
        }),
        ...notesLines(state[b.notesKey]),
      ].join('\n'),
    })),
  ];
}
