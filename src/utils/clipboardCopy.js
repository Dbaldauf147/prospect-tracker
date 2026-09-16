// Putting a copy on the clipboard in two flavours at once.
//
// Every Copy button in here has the same problem: the useful paste is a
// rich one (a bulleted scope in Word, a real table in Excel) and the
// reliable paste is plain text. Writing both flavours together lets each
// destination take the one it understands, so nothing has to guess where
// the paste is going.
//
// Lives on its own rather than beside any one button's payload: the
// Scope picker and the Follow Up notes table build completely different
// markup and share this last step.

/**
 * Puts a copy on the clipboard, both flavours where the browser allows it.
 *
 * Falls back to the plain text alone, and then to the legacy execCommand
 * path, because a blocked async clipboard is an ordinary state in a few of
 * the browsers this runs in and losing the markup beats copying nothing.
 *
 * @param {string} plain The text flavour. Nothing is copied without it.
 * @param {string} [html] The markup flavour, when the caller has one.
 * @returns {Promise<boolean>} whether anything reached the clipboard, so
 *          the button can tell a copy that worked from one that did not.
 */
export async function writeRichCopy(plain, html) {
  if (!plain) return false;
  try {
    if (navigator.clipboard && window.ClipboardItem && html) {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch { /* fall through to the text-only paths */ }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
  } catch { /* fall through to execCommand */ }
  try {
    const box = document.createElement('textarea');
    box.value = plain;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.top = '-1000px';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(box);
    return ok;
  } catch { return false; }
}
