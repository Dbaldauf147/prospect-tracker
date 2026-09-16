// The HTML half of the Scope picker's Copy button.
//
// scopeCopyText.js builds the plain text, which is what most pastes land.
// This builds the same content as markup, so the two go on the clipboard
// together and a paste into Outlook or Word arrives as a real bulleted
// list under bold headings rather than as lines that happen to start with
// a hyphen. Anywhere that will not take markup falls back to the text and
// nothing is lost.
//
// Same content, deliberately: the two flavours are one copy in two
// spellings, so the format pinned by scopeCopyText.test.mjs stays the
// single answer to "what does Copy put on the clipboard".
//
// Styles are inline because Outlook drops <style> blocks, and the font
// stack matches the KTM mapping popup's payload so two pastes into the
// same email look like one document.

const FONT = 'font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;color:#1F2937';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Array<{category: string, items: Array<{label: string}>}>} groups
 *   The picker's `selectedGroups` - the same argument scopeCopyText takes.
 * @param {string[]} [commodities] What this scope is about, if anything.
 * @returns {string} The clipboard markup, or '' when there is nothing to
 *          copy. Empty for exactly the cases scopeCopyText is empty for,
 *          so the button can never offer one flavour without the other.
 */
export function scopeCopyHtml(groups, commodities) {
  const picks = (commodities || []).map(c => String(c || '').trim()).filter(Boolean);

  const blocks = [];
  for (const group of groups || []) {
    const names = (group?.items || [])
      .map(it => String(it?.label ?? '').trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    const heading = String(group?.category || '').trim();
    blocks.push(
      (heading ? `<div style="font-weight:700;margin:0 0 2px">${escapeHtml(heading)}</div>` : '')
      + '<ul style="margin:0 0 12px 0;padding-left:22px">'
      + names.map(n => `<li style="margin:0 0 2px">${escapeHtml(n)}</li>`).join('')
      + '</ul>',
    );
  }
  if (blocks.length === 0) return '';

  const lead = picks.length > 0
    ? `<div style="margin:0 0 10px">Commodities: ${escapeHtml(picks.join(', '))}</div>`
    : '';
  return `<div style="${FONT}">${lead}${blocks.join('')}</div>`;
}

/**
 * Puts a copy on the clipboard, both flavours where the browser allows it.
 *
 * Falls back to the plain text alone, and then to the legacy execCommand
 * path, because a blocked async clipboard is an ordinary state in a few of
 * the browsers this runs in and losing the bullets beats copying nothing.
 *
 * @returns {Promise<boolean>} whether anything reached the clipboard, so
 *          the button can tell a copy that worked from one that did not.
 */
export async function writeScopeCopy(plain, html) {
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
