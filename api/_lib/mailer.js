// Generic Gmail SMTP sender, shared by jobs that need to email a
// notification. Uses the same GMAIL_USER / GMAIL_APP_PASSWORD App
// Password setup as the PE Opps digest (peOpps.sendPeOppsEmail), but
// without forcing a PE-specific body or attachment.

export async function sendEmail({ to, subject, html, attachments, replyTo }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('Email not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)');

  const recipients = (Array.isArray(to) ? to : [to])
    .map(e => String(e || '').trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error('No recipients');

  const nm = await import('nodemailer');
  const nodemailer = nm.default || nm;
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  const fromName = process.env.GMAIL_FROM_NAME || 'Prospect Tracker';
  const result = await transporter.sendMail({
    from: `${fromName} <${user}>`,
    to: recipients,
    // Digests are sent from the shared mailbox, so replies should land
    // with whoever scheduled them rather than in the app's inbox.
    ...(replyTo ? { replyTo } : {}),
    subject: subject || 'Prospect Tracker',
    html,
    ...(attachments ? { attachments } : {}),
  });
  return { id: result.messageId };
}
