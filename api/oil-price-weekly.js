// Vercel Cron entry point. Runs once a week (see vercel.json `crons`) and
// emails the rolling 90-day crude oil price: the latest close, how it
// moved over the week / month / window, the window's high, low and
// average, and a week-by-week chart and table.
//
// Protected by CRON_SECRET exactly like daily-backup: Vercel attaches
// `Authorization: Bearer <CRON_SECRET>`; a `?secret=` query param works
// for a manual send, which is also how to test it:
//   curl "https://<host>/api/oil-price-weekly?secret=$CRON_SECRET"
// Add `&dry=1` to get the rendered HTML back without sending anything.
//
// Env:
//   GMAIL_USER / GMAIL_APP_PASSWORD — already set (the sender)
// Optional:
//   OIL_PRICE_EMAIL_TO — comma-separated recipients. Defaults to
//                        BACKUP_NOTIFY_EMAIL, then to GMAIL_USER, so it
//                        works with no configuration at all.
//   EIA_API_KEY        — use the official EIA WTI spot series as the
//                        first source instead of the keyless feeds.

import { fetchOilSeries, buildOilEmail } from './_lib/oilPrices.js';
import { sendEmail } from './_lib/mailer.js';

function recipients() {
  const raw = String(
    process.env.OIL_PRICE_EMAIL_TO
    || process.env.BACKUP_NOTIFY_EMAIL
    || process.env.GMAIL_USER
    || ''
  );
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query?.secret || '');
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const to = recipients();
  const dry = String(req.query?.dry || '') === '1';
  if (to.length === 0 && !dry) {
    return res.status(500).json({ error: 'No recipients (set OIL_PRICE_EMAIL_TO or GMAIL_USER)' });
  }

  let series;
  try {
    series = await fetchOilSeries();
  } catch (err) {
    // Every source failed. Say so in the response rather than sending a
    // mail with nothing in it — a weekly email that arrives empty is
    // worse than one that doesn't arrive, because it reads as "flat".
    return res.status(502).json({ error: String(err?.message || err) });
  }

  // The preview embeds the chart as a data: URI so it renders in a
  // browser; the sent mail attaches it and references it by cid.
  const { subject, html, attachments, chartError, stats } = buildOilEmail(series, { inlineImage: dry });

  // A dry run renders the mail and returns it, so the thing can be read
  // before anyone's inbox sees it.
  if (dry) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  try {
    await sendEmail({ to, subject, html, attachments: attachments.length ? attachments : undefined });
  } catch (err) {
    return res.status(500).json({ error: `Send failed: ${String(err?.message || err)}` });
  }

  return res.status(200).json({
    ok: true,
    sentTo: to,
    subject,
    source: series.source,
    attempts: series.attempts,
    // Present only when the chart failed to draw: the mail still went,
    // without its picture, and this says why.
    ...(chartError ? { chartError } : {}),
    days: stats.days,
    latest: { date: stats.latest.date, close: stats.latest.close },
  });
}
