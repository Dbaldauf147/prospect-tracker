// Transcribes a OneDrive call recording with AssemblyAI.
//
//   POST ?itemId=<driveItemId>  — start a job, returns { id, status }
//   GET  ?id=<transcriptId>     — poll it, returns { status, text, ... }
//
// The audio never passes through this function. Graph hands out a
// short-lived pre-authenticated download URL for the item; that URL goes
// to AssemblyAI, which fetches the file itself. That keeps a 300-second
// serverless function from having to stream a two-hour call recording.
import { withAuth } from './_lib/http.js';

const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';

function apiKey() {
  return process.env.ASSEMBLYAI_API_KEY || '';
}

// Fetch a fresh download URL for the item. The one the listing endpoint
// returned may have expired by the time the user clicks Transcribe.
async function downloadUrlFor(itemId, accessToken) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`
    + '?$select=id,name,@microsoft.graph.downloadUrl';
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status === 401) {
    return { error: 'OneDrive token expired or invalid: reconnect OneDrive.', status: 401 };
  }
  if (!resp.ok) {
    return { error: `Microsoft Graph error: ${await resp.text()}`, status: resp.status };
  }
  const item = await resp.json();
  const downloadUrl = item['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) {
    return { error: 'OneDrive did not return a download link for this file.', status: 502 };
  }
  return { downloadUrl, name: item.name || '' };
}

async function startJob(req, res) {
  const accessToken = req.headers['x-ms-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-MS-Token (OneDrive access token)' });
  }
  const itemId = String(req.query?.itemId || '');
  if (!itemId) {
    return res.status(400).json({ error: 'Missing itemId' });
  }
  const link = await downloadUrlFor(itemId, accessToken);
  if (link.error) return res.status(link.status).json({ error: link.error });

  const resp = await fetch(`${ASSEMBLY_BASE}/transcript`, {
    method: 'POST',
    headers: { Authorization: apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: link.downloadUrl,
      // Call recordings are conversations — labelling who said what is
      // most of the value of having a transcript at all.
      speaker_labels: true,
    }),
  });
  const job = await resp.json();
  if (!resp.ok || job.error) {
    return res.status(resp.ok ? 502 : resp.status).json({ error: job.error || `Transcription service error (HTTP ${resp.status})` });
  }
  return res.status(200).json({ id: job.id, status: job.status || 'queued', name: link.name });
}

async function pollJob(req, res) {
  const id = String(req.query?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const resp = await fetch(`${ASSEMBLY_BASE}/transcript/${encodeURIComponent(id)}`, {
    headers: { Authorization: apiKey() },
  });
  const job = await resp.json();
  if (!resp.ok) {
    return res.status(resp.status).json({ error: job.error || `Transcription service error (HTTP ${resp.status})` });
  }
  if (job.status === 'error') {
    return res.status(200).json({ id, status: 'error', error: job.error || 'Transcription failed' });
  }
  return res.status(200).json({
    id,
    status: job.status, // queued | processing | completed
    text: job.text || '',
    // Speaker-labelled turns when they came back, so the page can lay the
    // transcript out as a conversation rather than one wall of text.
    utterances: Array.isArray(job.utterances)
      ? job.utterances.map(u => ({ speaker: u.speaker, text: u.text, start: u.start, end: u.end }))
      : [],
    audioDuration: job.audio_duration ?? null,
  });
}

async function handler(req, res) {
  if (!apiKey()) {
    return res.status(501).json({
      error: 'Transcription is not configured. Set ASSEMBLYAI_API_KEY in the deployment environment to enable it.',
    });
  }
  if (req.method === 'POST') return startJob(req, res);
  if (req.method === 'GET') return pollJob(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
