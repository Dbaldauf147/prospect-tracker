// The ESG News daily roundup scheduled task's door into the app
// (Prospecting > News; see src/utils/esgNews.js for the whole picture).
//
//   GET  /api/esg-news           -> { filters: [string] }
//        the things Dan wants left out of future roundups
//   POST /api/esg-news           { date, title, markdown, docUrl }
//        stores the finished roundup under esgNews/settings/roundups/{date}
//
// The caller is a Claude session, not a signed-in browser, so it proves
// itself with a key in the x-esg-news-key header. Only the key's SHA-256 is
// here; the key itself is in the scheduled task's prompt. It can do nothing
// but these two things: read the filter list and save a roundup.
import { createHash, timingSafeEqual } from 'node:crypto';
import { adminDb } from './_lib/firebaseAdmin.js';
import { ESG_NEWS_COLLECTION, ESG_NEWS_SETTINGS_DOC, ESG_NEWS_ROUNDUPS, normalizeFilters, normalizeRoundup } from '../src/utils/esgNews.js';

const KEY_SHA256 = '9ad795b1086207e111692fd97a7074a3839ec0cf57259b41f9503d990a4dd132';

function keyOk(req) {
  const key = String(req.headers['x-esg-news-key'] || '');
  if (!key) return false;
  const got = createHash('sha256').update(key).digest();
  const want = Buffer.from(KEY_SHA256, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET or POST only' });
  }
  if (!keyOk(req)) return res.status(401).json({ error: 'Missing or wrong x-esg-news-key' });

  try {
    const settingsRef = adminDb().collection(ESG_NEWS_COLLECTION).doc(ESG_NEWS_SETTINGS_DOC);
    if (req.method === 'GET') {
      const snap = await settingsRef.get();
      const filters = normalizeFilters(snap.exists ? snap.data().filters : []);
      return res.status(200).json({ filters, updatedAt: (snap.exists && snap.data().updatedAt) || null });
    }
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Body must be JSON' }); }
    }
    const { roundup, error } = normalizeRoundup(body);
    if (error) return res.status(400).json({ error });
    await settingsRef.collection(ESG_NEWS_ROUNDUPS).doc(roundup.date).set(roundup);
    return res.status(200).json({ ok: true, date: roundup.date });
  } catch (err) {
    console.error('esg-news error:', err);
    return res.status(500).json({ error: err?.message || 'Failed' });
  }
}
