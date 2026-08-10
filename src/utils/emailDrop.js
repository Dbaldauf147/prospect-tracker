// Read an email file dropped from Outlook (or exported from this app) into a
// plain shape the Market Updates tab can edit, store and re-emit.
//
// Two formats, because they're what actually lands on the page:
//   .msg — Outlook desktop's native format, which is what a drag out of
//          Outlook produces (not .ics, and not .eml).
//   .eml — what this app's own Drafts tab downloads, plus what most other
//          mail clients export.
//
// Returns { subject, bodyHtml, bodyText, from, sentAt, attachments } where
// each attachment is { name, type, dataUrl, size } — the same shape the
// Drafts tab's .eml builder already takes, so a parsed attachment can go
// straight back out on a new draft.

import * as MsgReaderModule from '@kenjiuno/msgreader';

// Depending on how the bundler resolves this CJS/ESM package, the class can
// land at either .default or one level further down. Same unwrap the
// Opportunity form's meeting drop zone uses.
const MsgReader = (MsgReaderModule?.default?.default || MsgReaderModule?.default || MsgReaderModule);

const bytesToBase64 = (bytes) => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

// Guess a content type from the extension. Attachments carry one in .eml but
// often not in .msg, and Outlook cares enough about the type that
// application/octet-stream on a PDF shows up as an unopenable blob.
const TYPE_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', htm: 'text/html', html: 'text/html',
  zip: 'application/zip', msg: 'application/vnd.ms-outlook',
};
export function guessType(name, fallback = 'application/octet-stream') {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return TYPE_BY_EXT[ext] || fallback;
}

// ---- .msg ----------------------------------------------------------------

function parseMsg(buffer) {
  const reader = new MsgReader(buffer);
  const data = reader.getFileData() || {};
  const attachments = [];
  for (const [i, meta] of (data.attachments || []).entries()) {
    // Inline images pasted into the body are attachments too, but they're
    // part of the message's own rendering rather than something the sender
    // meant to send. Keep them out of the saved attachment list.
    if (meta?.pidContentId || meta?.attachmentHidden) continue;
    let content;
    try { content = reader.getAttachment(i); } catch { continue; }
    if (!content?.content?.length) continue;
    const name = content.fileName || meta?.fileName || meta?.fileNameShort || `attachment-${i + 1}`;
    const type = meta?.attachMimeTag || guessType(name);
    attachments.push({
      name,
      type,
      size: content.content.length,
      dataUrl: `data:${type};base64,${bytesToBase64(content.content)}`,
    });
  }
  const bodyHtml = String(data.bodyHtml || '').trim();
  const bodyText = String(data.body || '').trim();
  return {
    subject: String(data.subject || data.normalizedSubject || '').trim(),
    bodyHtml: bodyHtml || (bodyText ? textToHtml(bodyText) : ''),
    bodyText,
    from: String(data.senderEmail || data.senderName || '').trim(),
    sentAt: String(data.messageDeliveryTime || data.clientSubmitTime || '').trim(),
    attachments,
  };
}

// ---- .eml ----------------------------------------------------------------

// Split a raw MIME part into its header block and body. Headers end at the
// first blank line; a header value continues onto following lines while they
// start with whitespace (RFC 5322 folding).
function splitPart(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  if (end < 0) return { headers: {}, body: raw };
  const headerBlock = raw.slice(0, end).replace(/\r?\n[ \t]+/g, ' ');
  const body = raw.slice(end).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of headerBlock.split(/\r?\n/)) {
    const m = /^([^:]+):\s*([\s\S]*)$/.exec(line);
    if (m) headers[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return { headers, body };
}

const paramOf = (headerValue, key) => {
  const re = new RegExp(`${key}\\s*=\\s*"([^"]*)"|${key}\\s*=\\s*([^;\\s]+)`, 'i');
  const m = re.exec(String(headerValue || ''));
  return m ? (m[1] ?? m[2] ?? '') : '';
};

function decodeQuotedPrintable(s) {
  return String(s)
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Decode a part's body to a byte array, honouring its transfer encoding.
function partBytes(headers, body) {
  const enc = String(headers['content-transfer-encoding'] || '').toLowerCase().trim();
  if (enc === 'base64') {
    const clean = body.replace(/\s+/g, '');
    try {
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch { return new Uint8Array(0); }
  }
  const text = enc === 'quoted-printable' ? decodeQuotedPrintable(body) : body;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const bytesToText = (bytes) => {
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch { return String.fromCharCode.apply(null, bytes); }
};

// Walk a MIME tree, collecting the best body and every attachment part.
function walkPart(raw, acc) {
  const { headers, body } = splitPart(raw);
  const ctype = String(headers['content-type'] || 'text/plain').toLowerCase();
  const disposition = String(headers['content-disposition'] || '').toLowerCase();
  const filename = paramOf(headers['content-disposition'], 'filename')
    || paramOf(headers['content-type'], 'name');

  if (ctype.startsWith('multipart/')) {
    const boundary = paramOf(headers['content-type'], 'boundary');
    if (!boundary) return;
    // Split on the boundary, dropping the preamble and the closing marker.
    const marker = `--${boundary}`;
    const segments = body.split(marker);
    for (const seg of segments.slice(1)) {
      if (/^--/.test(seg.trim().slice(0, 2))) break; // closing "--boundary--"
      walkPart(seg.replace(/^\r?\n/, ''), acc);
    }
    return;
  }

  // An attachment is anything explicitly dispositioned as one, or any
  // non-text part that carries a filename.
  const isAttachment = disposition.startsWith('attachment')
    || (!!filename && !ctype.startsWith('text/'));
  if (isAttachment) {
    const bytes = partBytes(headers, body);
    if (!bytes.length) return;
    const name = filename || 'attachment';
    const type = ctype.split(';')[0].trim() || guessType(name);
    acc.attachments.push({
      name, type, size: bytes.length,
      dataUrl: `data:${type};base64,${bytesToBase64(bytes)}`,
    });
    return;
  }

  const text = bytesToText(partBytes(headers, body));
  if (ctype.startsWith('text/html')) { if (!acc.bodyHtml) acc.bodyHtml = text.trim(); }
  else if (ctype.startsWith('text/')) { if (!acc.bodyText) acc.bodyText = text.trim(); }
}

function parseEml(text) {
  const acc = { bodyHtml: '', bodyText: '', attachments: [] };
  walkPart(text, acc);
  const { headers } = splitPart(text);
  return {
    subject: decodeHeaderWord(headers.subject || ''),
    bodyHtml: acc.bodyHtml || (acc.bodyText ? textToHtml(acc.bodyText) : ''),
    bodyText: acc.bodyText,
    from: decodeHeaderWord(headers.from || ''),
    sentAt: String(headers.date || '').trim(),
    attachments: acc.attachments,
  };
}

// RFC 2047 encoded-words ("=?UTF-8?B?...?=") appear in subjects from most
// clients. Decode the common base64 / quoted-printable forms; leave anything
// else as-is rather than showing the user raw encoding.
function decodeHeaderWord(value) {
  return String(value || '').trim().replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, _charset, enc, data) => {
      try {
        if (enc.toUpperCase() === 'B') return bytesToText(partBytes({ 'content-transfer-encoding': 'base64' }, data));
        return bytesToText(partBytes({ 'content-transfer-encoding': 'quoted-printable' }, data.replace(/_/g, ' ')));
      } catch { return whole; }
    },
  );
}

// ---- shared --------------------------------------------------------------

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Plain-text body → the HTML the editor works in, preserving line breaks.
export function textToHtml(text) {
  return escapeHtml(text)
    .split(/\r?\n/)
    .map(line => (line.trim() ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}

/**
 * Parse a dropped email File. Throws with a readable message when the file
 * isn't an email or can't be read.
 */
export async function parseEmailFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.msg')) {
    try {
      return parseMsg(await file.arrayBuffer());
    } catch (err) {
      throw new Error(`Could not read that .msg file: ${err?.message || err}`);
    }
  }
  if (name.endsWith('.eml') || name.endsWith('.mht') || name.endsWith('.mhtml')) {
    try {
      return parseEml(await file.text());
    } catch (err) {
      throw new Error(`Could not read that .eml file: ${err?.message || err}`);
    }
  }
  throw new Error(`${file?.name || 'That file'} isn't an email. Drag a message out of Outlook (.msg), or drop an exported .eml.`);
}
