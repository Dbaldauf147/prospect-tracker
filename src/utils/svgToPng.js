// Rasterise a chart the tab has already drawn, so it can be emailed.
//
// A mail client won't run JavaScript and won't render an inline <svg>:
// Outlook strips it outright and Gmail does the same. What every client
// does render is an image, so the funnel the Weekly Report tab draws is
// captured here as a PNG and attached to the message.
//
// The SVG is drawn onto a canvas rather than redrawn from its numbers.
// Redrawing would be a second copy of the chart, free to disagree with the
// one on screen — the same reason the report's figures travel as the text
// the tab formatted rather than being recomputed server-side.
//
// Two things have to be done to the clone before it can be rasterised. It
// needs an explicit pixel size, since a detached SVG has no box to inherit
// one from; and it needs a real font stack, because the chart's own CSS
// says `font-family: inherit` and there is nothing to inherit from once
// the node is out of the page. A web font wouldn't survive the trip
// anyway: an <img> renders its SVG with no access to the document's fonts,
// so the labels are asked for in the fonts every machine already has.

// What the labels are drawn in. Deliberately all system faces — see above.
const RASTER_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// UTF-8 safe base64: the chart's labels carry en dashes and multiplication
// signs, and btoa() alone throws on anything above U+00FF.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG could not be rasterised'));
    img.src = src;
  });
}

// The size the SVG is drawn at, from its viewBox. Falls back to the
// element's own box for an SVG that doesn't declare one.
function aspectOf(svg) {
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return vb[3] / vb[2];
  const box = svg.getBoundingClientRect();
  return box.width > 0 ? box.height / box.width : 0.5;
}

/**
 * Rasterise an <svg> element to a PNG data URL.
 *
 * Returns null rather than throwing: a picture that can't be captured is a
 * missing picture, and the email has a table of the same figures under it.
 *
 * `maxBytes` bounds what will be published — the snapshot carrying it is
 * rewritten on every visit to the tab and Firestore caps a document at
 * ~1 MB — so an oversized capture is retried smaller before it is dropped.
 */
export async function svgToPngDataUrl(svg, {
  widths = [1600, 1100],
  background = '#ffffff',
  maxBytes = 320_000,
} = {}) {
  if (!svg || typeof window === 'undefined' || typeof document === 'undefined') return null;
  try {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.style.fontFamily = RASTER_FONT;
    // The chart sets its own width in CSS; in a serialised clone that CSS
    // is gone, so the size has to be on the element.
    const ratio = aspectOf(svg);

    for (const width of widths) {
      const height = Math.round(width * ratio);
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      const markup = new XMLSerializer().serializeToString(clone);
      const img = await loadImage(`data:image/svg+xml;base64,${toBase64(markup)}`);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // Painted, not left transparent: a client that shows the message on
      // a dark ground would otherwise render the chart's dark text onto it.
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const src = canvas.toDataURL('image/png');
      if (src && src.length <= maxBytes) return { src, width, height };
    }
    return null;
  } catch {
    return null;
  }
}
