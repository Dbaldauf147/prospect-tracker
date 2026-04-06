// Serves a page that opens multiple Outlook compose windows sequentially
// Copies formatted HTML body to clipboard before each draft opens
export default function handler(req, res) {
  const { drafts } = req.query;
  if (!drafts) return res.status(400).send('Missing drafts');

  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(drafts));
  } catch {
    return res.status(400).send('Invalid drafts data');
  }

  const links = parsed.map((d, i) => {
    // Put plain text body in the Outlook URL (deeplinks only support plain text)
    let url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(d.to)}&subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body || '')}`;
    if (d.cc && d.cc.length > 0) {
      url += `&cc=${encodeURIComponent(d.cc.join(';'))}`;
    }
    const ccLabel = d.cc && d.cc.length > 0 ? ` (CC: ${d.cc.length})` : '';
    return { url, name: (d.name || d.to) + ccLabel, index: i + 1, htmlBody: d.htmlBody || '' };
  });

  const html = `<!DOCTYPE html>
<html><head><title>Opening Outlook Drafts...</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F8FAFC; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border-radius: 12px; padding: 2rem; max-width: 480px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
  h1 { font-size: 1.3rem; color: #1a1a1a; margin: 0 0 0.5rem; }
  p { color: #525252; font-size: 0.9rem; margin: 0 0 1.5rem; }
  .list { text-align: left; margin-bottom: 1.5rem; }
  .item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 0.25rem; font-size: 0.85rem; }
  .item.done { background: #DCFCE7; color: #166534; }
  .item.pending { background: #F3F4F6; color: #6B7280; }
  .item.current { background: #DBEAFE; color: #1E40AF; font-weight: 600; }
  .check { font-size: 0.75rem; }
  .btn { display: inline-block; padding: 0.75rem 2rem; background: #0078D4; color: #fff; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn:hover { background: #106EBE; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .done-msg { color: #166534; font-weight: 600; font-size: 1rem; }
</style>
</head><body>
<div class="card">
  <h1>Outlook Drafts</h1>
  <p>Click the button to open each draft. The formatted body is copied to your clipboard — in Outlook press <strong>Ctrl+A</strong> then <strong>Ctrl+V</strong> to replace with formatted text.</p>
  <div class="list" id="list">
    ${links.map(l => `<div class="item pending" id="item-${l.index}"><span class="check">&#9744;</span> ${l.name}</div>`).join('')}
  </div>
  <button class="btn" id="btn" onclick="openNext()">Open All Drafts (${links.length})</button>
  <div id="done" style="display:none;margin-top:1rem" class="done-msg">All drafts opened! You can close this tab.</div>
</div>
<script>
  const links = ${JSON.stringify(links)};
  let current = 0;
  async function openNext() {
    if (current >= links.length) return;
    const link = links[current];
    // Copy formatted HTML body to clipboard so user can paste with Ctrl+V in Outlook
    if (link.htmlBody) {
      try {
        const blob = new Blob([link.htmlBody], { type: 'text/html' });
        const textBlob = new Blob([link.htmlBody.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })]);
      } catch (e) {
        // Fallback: copy plain text
        try { await navigator.clipboard.writeText(link.htmlBody.replace(/<[^>]+>/g, '')); } catch {}
      }
    }
    window.open(link.url, '_blank');
    document.getElementById('item-' + link.index).className = 'item done';
    document.getElementById('item-' + link.index).innerHTML = '<span class="check">&#9745;</span> ' + link.name + ' — opened (body copied to clipboard)';
    current++;
    if (current < links.length) {
      document.getElementById('item-' + links[current].index).className = 'item current';
      document.getElementById('btn').textContent = 'Open Next: ' + links[current].name + ' (' + (links.length - current) + ' left)';
    } else {
      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'All Done!';
      document.getElementById('done').style.display = 'block';
    }
  }
  if (links.length > 0) {
    document.getElementById('item-1').className = 'item current';
  }
</script>
</body></html>`;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}
