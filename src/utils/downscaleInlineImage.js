// Keep a pasted image to a size an email can carry.
//
// A screenshot off the clipboard arrives at the full pixel size of whatever
// was captured — a 4K grab is several megabytes once base64 has inflated it
// by a third. Left alone that causes two problems well before the message is
// sent: the compose autosave writes the body to localStorage, which has a
// low-single-digit-MB quota for the whole app, and Outlook opens a draft
// carrying a picture far larger than it will ever display.
//
// So an oversized image is redrawn at a sane width before it goes into the
// body. Anything already small enough is returned untouched — re-encoding a
// picture that didn't need it only costs quality.

// Wider than an email body ever renders. Outlook's reading pane tops out
// around 800px, so 1400 leaves room for a high-DPI screen without carrying a
// desktop's worth of pixels.
export const MAX_INLINE_IMAGE_WIDTH = 1400;

// Below this an image isn't worth touching whatever its dimensions — a small
// diagram can be wide and still cost nothing.
export const INLINE_IMAGE_SIZE_FLOOR = 200 * 1024;

/** Rough decoded byte count of a base64 data URI. */
export function dataUrlBytes(dataUrl) {
  const i = String(dataUrl || '').indexOf(',');
  if (i < 0) return 0;
  const b64 = String(dataUrl).slice(i + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** True when this data URI is worth redrawing smaller. */
export function needsDownscale(dataUrl) {
  return /^data:image\/(png|jpeg|jpg|webp|bmp)/i.test(String(dataUrl || ''))
    && dataUrlBytes(dataUrl) > INLINE_IMAGE_SIZE_FLOOR;
}

/**
 * Redraw `dataUrl` at no more than MAX_INLINE_IMAGE_WIDTH and return the new
 * data URI — or the original when it's already small enough, when it isn't a
 * raster image we can safely re-encode, or when anything goes wrong. Never
 * rejects: failing to shrink an image is not a reason to lose it.
 *
 * PNG screenshots are re-encoded as JPEG when that's a clear win, since a
 * photographic screenshot as PNG is usually several times larger than it
 * needs to be. A PNG that shrinks by re-encoding alone keeps its format, so
 * a screenshot of text or a diagram doesn't pick up JPEG artefacts.
 */
export async function downscaleInlineImage(dataUrl) {
  if (!needsDownscale(dataUrl)) return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_INLINE_IMAGE_WIDTH / (img.naturalWidth || img.width || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    // A transparent PNG flattened onto nothing turns black in a JPEG, so lay
    // white down first — an email body is white anyway.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const asPng = canvas.toDataURL('image/png');
    const asJpeg = canvas.toDataURL('image/jpeg', 0.82);
    // Whichever is smaller, but only take the original if it actually beat
    // both — a scale of 1 with no encoding win means there was nothing to do.
    const best = [dataUrl, asPng, asJpeg]
      .filter(Boolean)
      .reduce((a, b) => (dataUrlBytes(b) < dataUrlBytes(a) ? b : a));
    return best;
  } catch {
    return dataUrl;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
