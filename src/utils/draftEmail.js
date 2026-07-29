import { DEFAULT_EMAIL_SIGNATURE } from '../data/emailSignature';

// Shared draft-email helpers. The Draft Emails page composes rich HTML
// bodies; this module covers the simpler "plain-text body + shared
// signature → Outlook .eml draft" path other pages (e.g. Marketing Leads)
// need, using the same X-Unsent .eml format and signature block so the
// drafts look identical in Outlook.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The signature the drafts should carry: the user's saved signature, or —
// for the admin account only — the bundled default, matching how the
// Draft Emails page resolves it. Non-admins with no saved signature get
// none rather than Dan's personal block.
export function resolveSignature(settings, isAdmin) {
  return settings?.emailSignature || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : '');
}

// Plain-text body → HTML. Each newline becomes a <br> so the spacing the
// user typed is preserved; text is escaped so stray < & etc. don't break
// the markup.
export function plainBodyToHtml(text) {
  const t = String(text || '');
  if (!t) return '';
  return t.split(/\r?\n/).map(escapeHtml).join('<br>\n');
}

// Substitute the {token} placeholders a per-recipient draft supports.
export function personalizeDraftText(text, c = {}) {
  const first = c.firstName || String(c.name || '').split(' ')[0] || '';
  return String(text || '')
    .replace(/\{firstName\}/gi, first)
    .replace(/\{fullName\}/gi, c.name || '')
    .replace(/\{name\}/gi, c.name || '')
    .replace(/\{company\}/gi, c.company || '')
    .replace(/\{title\}/gi, c.title || '')
    .replace(/\{email\}/gi, c.email || '');
}

// Wrap the body HTML in the same Word/Outlook-friendly shell the Draft
// Emails page uses, appending the signature one blank line below.
export function buildStyledBodyHtml(bodyHtml, { signature = '' } = {}) {
  const sigBlock = signature ? `<br>\n<div style="margin-left:24px;">\n${signature}\n</div>` : '';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n<head>\n<!--[if gte mso 9]><xml><w:WordDocument><w:DontHyphenate/><w:DoNotHyphenateCaps/></w:WordDocument></xml><![endif]-->\n<style>\np{margin:0pt;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\nul,ol{margin:0pt;padding-left:1.5em;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\nli{margin:0pt;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\ndiv{mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;}\n</style>\n</head>\n<body style="margin:0;padding:0;">\n<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;">\n${bodyHtml}\n</div>${sigBlock}\n</body>\n</html>`;
}

// Build one X-Unsent .eml (Outlook opens it as an editable draft). cc is
// an array of bare addresses.
export function buildUnsentEml({ toName, toEmail, subject, bodyHtml, signature = '', cc = [] }) {
  const htmlContent = buildStyledBodyHtml(bodyHtml, { signature });
  const toHeader = toName ? `${toName} <${toEmail}>` : `<${toEmail}>`;
  const ccHeader = cc.length ? `Cc: ${cc.join(', ')}` : null;
  return [
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    `To: ${toHeader}`,
    ccHeader,
    'X-Unsent: 1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlContent,
  ].filter(line => line !== null).join('\r\n');
}

// Download a list of { fileName, eml } as individual .eml files, deduping
// filenames and staggering the clicks so the browser doesn't drop rapid
// repeat downloads.
export function downloadDrafts(drafts) {
  const seen = new Map();
  drafts.forEach((d, i) => {
    let name = d.fileName;
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (count > 1) {
      const dot = name.lastIndexOf('.');
      name = dot >= 0 ? `${name.slice(0, dot)}_${count}${name.slice(dot)}` : `${name}_${count}`;
    }
    const blob = new Blob([d.eml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    setTimeout(() => { a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }, i * 300);
  });
}

export function safeFileName(s) {
  return String(s || 'draft').replace(/[^a-zA-Z0-9]/g, '_');
}
