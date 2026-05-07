// Creates draft emails in the user's Outlook via Microsoft Graph API.
//
// Optional folderName: when provided, the batch is placed in a
// subfolder of the well-known "Drafts" folder (created on first use,
// reused on subsequent runs with the same name). The Draft Emails UI
// passes this for any batch that produces more than 3 drafts so the
// user's main Drafts folder doesn't get flooded.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, drafts, folderName } = req.body;
  if (!accessToken || !drafts || !Array.isArray(drafts)) {
    return res.status(400).json({ error: 'Missing accessToken or drafts array' });
  }

  // Resolve the target folder id once. When no folderName is passed
  // (or folder creation fails), fall back to the standard endpoint
  // which writes to the default Drafts folder — same as before.
  let folderId = null;
  let folderError = null;
  if (folderName && typeof folderName === 'string' && folderName.trim()) {
    try {
      folderId = await ensureSubfolder(accessToken, 'drafts', folderName.trim());
    } catch (err) {
      folderError = err.message || 'folder creation failed';
      // Don't fail the whole batch — fall through to default Drafts.
    }
  }

  const messagesPath = folderId
    ? `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`
    : 'https://graph.microsoft.com/v1.0/me/messages';

  const results = [];
  for (const draft of drafts) {
    try {
      const response = await fetch(messagesPath, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: draft.subject,
          body: {
            contentType: 'HTML',
            content: draft.body,
          },
          toRecipients: (draft.to || '').split(';').filter(Boolean).map((addr, i) => ({
            emailAddress: {
              address: addr.trim(),
              name: i === 0 ? (draft.name || '') : '',
            },
          })),
          ccRecipients: (draft.cc || []).map(addr => ({
            emailAddress: { address: addr.trim() },
          })),
          isDraft: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        results.push({ to: draft.to, success: true, id: data.id });
      } else {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return res.status(200).json({ success: false, needsAuth: true, error: 'Token expired. Please reconnect Outlook.' });
        }
        results.push({ to: draft.to, success: false, error: err.error?.message || `HTTP ${response.status}` });
      }
    } catch (err) {
      results.push({ to: draft.to, success: false, error: err.message });
    }
  }

  const created = results.filter(r => r.success).length;
  return res.status(200).json({
    success: created > 0,
    created,
    total: drafts.length,
    results,
    folder: folderId ? folderName : null,
    folderError,
  });
}

// Look up or create a subfolder of the named parent (e.g. "drafts")
// by displayName. Returns the folder id.
async function ensureSubfolder(accessToken, parentWellKnown, displayName) {
  // Microsoft Graph $filter quoting: a single quote inside the value
  // needs to be doubled. Names with double quotes / control chars are
  // also stripped here so the folder name is always something Outlook
  // will accept.
  const safeName = displayName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '').slice(0, 240).trim();
  if (!safeName) throw new Error('folderName resolved to empty after sanitisation');
  const filterValue = safeName.replace(/'/g, "''");
  const listUrl = `https://graph.microsoft.com/v1.0/me/mailFolders('${parentWellKnown}')/childFolders?$filter=${encodeURIComponent(`displayName eq '${filterValue}'`)}&$select=id,displayName&$top=1`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (listRes.ok) {
    const list = await listRes.json();
    if (Array.isArray(list.value) && list.value.length > 0 && list.value[0].id) {
      return list.value[0].id;
    }
  }

  // Not found → create.
  const createUrl = `https://graph.microsoft.com/v1.0/me/mailFolders('${parentWellKnown}')/childFolders`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: safeName }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error('Failed to create folder: ' + (err.error?.message || `HTTP ${createRes.status}`));
  }
  const data = await createRes.json();
  if (!data.id) throw new Error('Folder create returned no id');
  return data.id;
}
