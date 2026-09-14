// Vercel Cron entry point. Runs once a week (see vercel.json `crons`) and
// emails the rolling 90-day price of the commodities the report covers —
// WTI crude and Henry Hub natural gas: the latest close, how it moved
// over the week / month / window, the window's high, low and average, and
// a week-by-week chart and table for each.
//
// The path still says "oil" because it is a cron entry in vercel.json and
// the URL anyone tests by hand; gas was added underneath it rather than
// moving everybody's bookmark.
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
//   EIA_API_KEY        — use the official EIA spot series (WTI at
//                        Cushing, Henry Hub gas) as the first source
//                        instead of the keyless feeds.

import { fetchAllSeries, buildCommodityEmail } from './_lib/commodityPrices.js';
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
  let failures;
  try {
    // Both commodities, fetched together. One that fails every source is
    // reported inside the mail rather than thrown: the crude price the
    // reader came for must not be lost to a gas feed being down.
    ({ series, failures } = await fetchAllSeries());
  } catch (err) {
    // Nothing at all came back. Say so in the response rather than sending
    // a mail with nothing in it — a weekly email that arrives empty is
    // worse than one that doesn't arrive, because it reads as "flat".
    return res.status(502).json({ error: String(err?.message || err) });
  }

  // The preview embeds each chart as a data: URI so it renders in a
  // browser; the sent mail attaches them and references them by cid.
  const { subject, html, attachments, chartError, sections } =
    buildCommodityEmail(series, { inlineImage: dry, failures });

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
    // Per commodity, so a run that fell through to the backstop for one of
    // them says which one.
    commodities: sections.map(({ spec, stats }, i) => ({
      key: spec.key,
      name: spec.name,
      unit: spec.unit,
      source: series[i].source,
      attempts: series[i].attempts,
      days: stats.days,
      latest: { date: stats.latest.date, close: stats.latest.close },
    })),
    // Present only when a commodity's sources all failed. The mail still
    // went, naming it, and this says why.
    ...(failures.length ? { failures } : {}),
    // Present only when a chart failed to draw: the mail still went,
    // without that picture, and this says why.
    ...(chartError ? { chartError } : {}),
  });
}
