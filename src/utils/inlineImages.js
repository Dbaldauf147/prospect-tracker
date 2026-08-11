// Inline images in an outgoing email.
//
// The editors store a pasted image the way the browser hands it over: a
// `data:` URI sitting in the <img src>. That's right for the app — it's
// self-contained, survives autosave, and renders in the preview — but it is
// not how email carries a picture. Outlook (and most desktop clients) refuse
// to load `data:` image sources in a message, so a draft built by dropping
// the body HTML straight into a text/html part shows a broken image box
// however good it looked while composing.
//
// What email actually wants is multipart/related: the HTML in one part, each
// image in its own base64 part carrying a Content-ID, and the <img> pointing
// at that id with `cid:`. This module does that conversion — pull the data
// URIs out of the HTML, hand back the rewritten HTML plus the parts to send
// alongside it.
//
// Only `data:image/*` sources are touched. An <img> pointing at a real URL
// is left exactly as it is, which matters because the open-tracking pixel is
// one of those and must keep its http src to do its job.

// RFC 2045 caps an encoded line at 76 characters. Long base64 runs on one
// line are the kind of thing that survives a direct file open and then gets
// mangled the first time a message crosses a server that enforces it.
const B64_LINE = 76;

/** Base64 payload split into RFC-legal lines. */
export function base64Body(b64) {
  const s = String(b64 || '');
  const out = [];
  for (let i = 0; i < s.length; i += B64_LINE) out.push(s.slice(i, i + B64_LINE));
  return out.join('\r\n');
}

/** A MIME boundary that can't collide with base64 content. */
export function makeBoundary(tag) {
  return `----=_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const EXT_FOR = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
};

/**
 * Pull every inline `data:image/*` out of `html`.
 *
 * Returns the HTML with each of those sources rewritten to `cid:<id>`, and
 * the images themselves as { cid, contentType, base64, name }. Identical
 * images (the same data URI used twice) share one part and one cid rather
 * than being carried twice.
 *
 * A data URI that isn't base64, or isn't an image, is left alone — better a
 * broken image in one message than a mangled part in every one.
 */
export function splitInlineImages(html) {
  const images = [];
  const byData = new Map();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const rewritten = String(html || '').replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:[^"']+)\2/gi,
    (match, pre, quote, uri) => {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(uri);
      if (!m) return match;
      const [, contentType, base64] = m;
      if (!base64) return match;
      let cid = byData.get(uri);
      if (!cid) {
        const n = images.length + 1;
        cid = `img${n}.${stamp}@prospect-tracker`;
        byData.set(uri, cid);
        images.push({
          cid,
          contentType: contentType.toLowerCase(),
          base64,
          name: `image${n}.${EXT_FOR[contentType.toLowerCase()] || 'png'}`,
        });
      }
      return `${pre}${quote}cid:${cid}${quote}`;
    },
  );

  return { html: rewritten, images };
}

/**
 * The message's HTML section, ready to drop into a message either on its own
 * or as one part of a multipart/mixed.
 *
 * With no inline images this is just the text/html part. With them it's a
 * multipart/related carrying the HTML and every image, which is the shape
 * that makes `cid:` references resolve.
 *
 * Returns { contentType, body } — `contentType` is the value for the
 * Content-Type header of the section, `body` everything below it.
 */
export function buildHtmlSection(htmlContent) {
  const { html, images } = splitInlineImages(htmlContent);
  if (images.length === 0) {
    return {
      contentType: 'text/html; charset=UTF-8',
      transferEncoding: 'Content-Transfer-Encoding: 8bit',
      body: html,
      imageCount: 0,
    };
  }

  const boundary = makeBoundary('Related');
  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ];
  for (const img of images) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${img.contentType}; name="${img.name}"`,
      'Content-Transfer-Encoding: base64',
      // The angle brackets are part of the syntax: the header is <id>, the
      // reference in the HTML is cid:id without them.
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.name}"`,
      '',
      base64Body(img.base64),
    );
  }
  parts.push(`--${boundary}--`);

  return {
    // `type="text/html"` tells the client which part is the one to render.
    contentType: `multipart/related; boundary="${boundary}"; type="text/html"`,
    transferEncoding: null,
    body: parts.join('\r\n'),
    imageCount: images.length,
  };
}

/** The header + body lines for a section, ready to join into a message. */
export function htmlSectionLines(htmlContent) {
  const section = buildHtmlSection(htmlContent);
  return {
    lines: [
      `Content-Type: ${section.contentType}`,
      ...(section.transferEncoding ? [section.transferEncoding] : []),
      '',
      section.body,
    ],
    imageCount: section.imageCount,
  };
}
