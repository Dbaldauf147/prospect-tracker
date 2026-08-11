// Build an Outlook-openable .eml draft from a subject, an HTML body and a
// list of attachments.
//
// The Drafts tab builds its per-recipient .eml inline, wrapped in that page's
// merge/signature/recipient machinery. Market Updates needs the same file
// without any of that, so the message assembly lives here: same headers, same
// multipart/mixed shape, same X-Unsent flag that makes Outlook open the file
// as an editable draft rather than a received message.

import { htmlSectionLines } from './inlineImages.js';

// Fold a header value that would otherwise run past the line-length limit,
// and strip the CR/LFs that would end the header early — a subject pasted
// out of an email often carries them.
const headerValue = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();

/**
 * `attachments` are { name, type, dataUrl } — the shape emailDrop.js produces
 * and the Drafts tab's attachment picker already uses. `to` and `cc` are
 * optional; a market update is usually addressed when it's sent, not here.
 *
 * Returns the .eml text.
 */
export function buildEmlDraft({ subject = '', bodyHtml = '', to = '', cc = '', attachments = [] }) {
  const html = `<html><body style="font-family:Aptos,Calibri,sans-serif;font-size:11pt;color:#000;">${bodyHtml}</body></html>`;
  const base = [
    'MIME-Version: 1.0',
    `Subject: ${headerValue(subject)}`,
    `To: ${headerValue(to)}`,
    cc ? `Cc: ${headerValue(cc)}` : null,
    // Outlook opens a message carrying this as a composable draft. Without
    // it the file opens read-only, which is no use for editing and sending.
    'X-Unsent: 1',
  ].filter(l => l !== null);

  // Images pasted into the body arrive as `data:` URIs, which mail clients
  // won't load. htmlSectionLines turns them into a multipart/related carrying
  // each image as its own part with a Content-ID, and leaves the body as a
  // plain text/html part when there aren't any.
  const { lines: htmlLines } = htmlSectionLines(html);

  const usable = (attachments || []).filter(a => a?.dataUrl && a?.name);
  if (usable.length === 0) {
    return [...base, ...htmlLines].join('\r\n');
  }

  // Boundary has to be a string that can't occur inside any part. A random
  // suffix is enough — base64 payloads can't contain the '=_' sequence.
  const boundary = `----=_MarketUpdate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}`,
    ...htmlLines,
  ];
  for (const att of usable) {
    const base64Data = String(att.dataUrl).split(',')[1] || '';
    const name = headerValue(att.name).replace(/"/g, '');
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.type || 'application/octet-stream'}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      // Long base64 lines are legal but some clients baulk; wrap at 76.
      base64Data.replace(/(.{76})/g, '$1\r\n'),
    );
  }
  parts.push(`--${boundary}--`);

  return [
    ...base,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
  ].join('\r\n');
}

// Turn a subject into something safe to use as a download filename.
export function draftFileName(subject, fallback = 'market-update') {
  const safe = String(subject || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 60);
  return `${safe || fallback}.eml`;
}
