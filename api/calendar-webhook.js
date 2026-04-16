// Receives today's calendar events from Power Automate and stores them in
// Firestore under calendarWebhook/{token}. The frontend reads from the same
// Firestore doc to display the meetings in the Today's Meetings panel.
//
// Power Automate POST body:
//   { "token": "<user-webhook-token>", "meetings": [ { subject, start, end, attendees, location } ] }

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getDb() {
  if (getApps().length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
    const cred = JSON.parse(raw);
    initializeApp({ credential: cert(cred) });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  // Allow CORS for Power Automate
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { token, meetings } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }
  if (!Array.isArray(meetings)) {
    return res.status(400).json({ error: 'meetings must be an array' });
  }

  // Normalize each meeting
  const normalized = meetings.slice(0, 100).map(m => ({
    subject: String(m.subject || m.Subject || '').slice(0, 500),
    start: m.start || m.Start || m.startDateTime || '',
    end: m.end || m.End || m.endDateTime || '',
    location: String(m.location || m.Location || '').slice(0, 300),
    attendees: Array.isArray(m.attendees || m.Attendees)
      ? (m.attendees || m.Attendees).slice(0, 50).map(a => ({
          name: String(a.name || a.Name || a.emailAddress?.name || '').trim(),
          email: String(a.email || a.Email || a.emailAddress?.address || '').trim(),
        }))
      : typeof (m.attendees || m.Attendees) === 'string'
        ? (m.attendees || m.Attendees).split(/[;,]/).map(s => s.trim()).filter(Boolean).map(s => ({ name: s, email: '' }))
        : [],
    organizer: m.organizer || m.Organizer || '',
    isAllDay: !!(m.isAllDay || m.IsAllDay),
  }));

  try {
    const db = getDb();
    await db.collection('calendarWebhook').doc(token).set({
      meetings: normalized,
      updatedAt: new Date().toISOString(),
      count: normalized.length,
    });
    return res.status(200).json({ ok: true, count: normalized.length });
  } catch (err) {
    console.error('calendar-webhook error:', err);
    return res.status(500).json({ error: err.message || 'Failed to store meetings' });
  }
}
