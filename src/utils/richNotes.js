// Service notes are rich text: the Services popup edits them in Quill, so
// what is stored is Quill's own markup (bold, italic, underline, lists,
// links). Notes written before that are plain text with \n line breaks, and
// nothing rewrote them, so every reader has to accept both shapes.

// Tags Quill emits. A stored note containing any of them is markup; anything
// else is legacy plain text, including text that merely mentions "<5 sites".
const MARKUP_RE = /<\/?(p|br|strong|em|u|s|ol|ul|li|a|h[1-6]|blockquote|pre|span)\b[^>]*>/i;

export function isNotesHtml(value) {
  return MARKUP_RE.test(String(value || ''));
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// What to load into the editor. Legacy plain text becomes one paragraph per
// line, with blank lines kept, so it opens looking the way it was typed.
export function toNotesHtml(value) {
  const str = String(value || '');
  if (!str) return '';
  if (isNotesHtml(str)) return str;
  return str.split('\n').map(line => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('');
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

// The words alone, for search and for telling an emptied editor from a note.
// Block ends become line breaks so words either side of one don't fuse.
export function notesPlainText(value) {
  const str = String(value || '');
  if (!isNotesHtml(str)) return str;
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m])
    .replace(/\n+$/, '');
}
