// Make every link in an email body an absolute URL.
//
// Quill's link tool keeps whatever is typed into its box verbatim, so a link
// entered as "www.example.com" (no scheme) is stored as a RELATIVE href. In the
// app the browser quietly resolves it against the app's own origin, so it looks
// fine while composing. A downloaded .eml has no origin to resolve against, so
// Outlook drops the link and the text arrives as plain words. The click tracker
// only rewrites http(s) links too, so the same link was never tracked either.
//
// The fix is to supply the scheme the user meant: a bare address gets mailto:,
// a bare domain gets https://. Anything that already has a scheme (http, mailto,
// tel, ...), an in-page #anchor, or a {mergeField} is left exactly as written.

const BARE_EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i;
// A host with a dot and a letters-only TLD, optionally followed by a port,
// path, query or fragment: "example.com", "www.example.co.uk/pricing?x=1".
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i;

export function absoluteHref(href) {
  const raw = String(href ?? '').trim();
  if (!raw) return raw;
  if (raw.startsWith('#') || raw.startsWith('{')) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (BARE_EMAIL.test(raw)) return `mailto:${raw}`;
  // A real scheme can't contain a dot before its colon in practice, so
  // "https://..." and "mailto:..." never match here and pass through below.
  if (BARE_DOMAIN.test(raw)) return `https://${raw}`;
  return raw;
}

// Apply absoluteHref to every <a href> in a chunk of HTML.
export function absolutizeLinks(html) {
  return String(html ?? '').replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi,
    (_, pre, quote, url) => `${pre}${quote}${absoluteHref(url)}${quote}`,
  );
}
