// Shared Schneider Electric brand lockup, used across the Building Compliance
// Screening view, the Compliance Roadmap view, the printable HTML report, and
// the formatted Excel export so the branding is identical everywhere.
//
// NOTE: this is a clean wordmark RENDITION of the Schneider Electric lockup
// ("Schneider Electric" + the "Life Is On" tagline in brand green), not the
// exact trademarked vector — that artwork isn't bundled in the repo. To use
// the official asset, drop the real SVG/PNG in and return it from the two
// builders below; every surface reads from here, so it's a one-file swap.

export const SE_GREEN = '#3DCD58';       // "Life Is On" green
export const SE_GREEN_DARK = '#009530';  // deep green

// Inline SVG markup for the lockup. `onDark` renders it in white for the green
// brand band; otherwise it's brand green for light surfaces. `width` scales the
// whole lockup (viewBox is fixed, so it stays crisp at any size).
export function schneiderLogoSvg({ onDark = false, width = 168 } = {}) {
  const word = onDark ? '#FFFFFF' : SE_GREEN_DARK;
  const tag = onDark ? '#FFFFFF' : SE_GREEN;
  const height = Math.round(width * (46 / 200));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 46" width="${width}" height="${height}" role="img" aria-label="Schneider Electric — Life Is On">
  <text x="0" y="15" font-family="'Nunito Sans','Segoe UI',Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="0.3" fill="${tag}">Life Is On</text>
  <text x="0" y="40" font-family="'Nunito Sans','Segoe UI',Arial,sans-serif" font-size="23" font-weight="900" letter-spacing="-0.6" fill="${word}">Schneider Electric</text>
</svg>`;
}

// The same lockup as a base64 data URI, for <img src> in the self-contained
// HTML report or anywhere an <svg> element can't be inlined.
export function schneiderLogoDataUrl(opts = {}) {
  const svg = schneiderLogoSvg(opts);
  // btoa exists in the browser (where these surfaces render); guard for Node.
  const b64 = typeof btoa === 'function'
    ? btoa(svg)
    : (globalThis.Buffer ? globalThis.Buffer.from(svg).toString('base64') : '');
  return `data:image/svg+xml;base64,${b64}`;
}

// Rasterize the lockup to a PNG data URL via canvas — ExcelJS's addImage only
// takes raster formats, so the Excel export uses this. Browser-only (canvas).
// `scale` supersamples for a sharp image in the sheet.
export function schneiderLogoPngDataUrl({ onDark = false, width = 200, scale = 3 } = {}) {
  const height = Math.round(width * (46 / 200));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const word = onDark ? '#FFFFFF' : SE_GREEN_DARK;
  const tag = onDark ? '#FFFFFF' : SE_GREEN;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tag;
  ctx.font = '800 12px "Nunito Sans", "Segoe UI", Arial, sans-serif';
  ctx.fillText('Life Is On', 0, 13 * (width / 200));
  ctx.fillStyle = word;
  const bigPx = 23 * (width / 200);
  ctx.font = `900 ${bigPx}px "Nunito Sans", "Segoe UI", Arial, sans-serif`;
  ctx.fillText('Schneider Electric', 0, height - 4);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}
