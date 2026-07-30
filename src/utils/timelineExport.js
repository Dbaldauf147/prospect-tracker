// Schneider-Electric-formatted exports for a timeline template.
//
// Three outputs, all off the one SVG renderer in timelineGraphic:
//   • openTimelineReport   — branded page in a new tab (green band, graphic,
//                            stage table), sized to print / save as PDF
//   • downloadTimelineSvg  — vector file, drops straight into a deck
//   • downloadTimelinePng  — raster at 2× for email and slide pastes
//
// Follows the same shape as the compliance report: build a self-contained
// HTML string, hand it to a new window, and let the browser print it.

import { buildTimelineSvg, ownerColor } from './timelineGraphic';
import { schneiderLogoSvg, SE_GREEN, SE_GREEN_DARK } from './schneiderLogo';

const SE_INK = '#0F172A';
const SE_SLATE = '#475569';
const SE_MUTE = '#94A3B8';
const SE_LINE = '#E2E8F0';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Slug for the download filename: "Budget timeline" → "Budget-timeline".
function fileSlug(template) {
  const base = String(template?.name || 'timeline').trim() || 'timeline';
  return base.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has taken effect first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// The stage table that sits under the graphic in the report — the same data,
// readable when the timeline is too wide to print at a legible size.
function stageTable(stages) {
  const rows = stages.map((stage, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="stage">${esc(stage.name || 'Untitled stage')}</td>
      <td><span class="ownerPill" style="border-color:${ownerColor(stage.owner)};color:${ownerColor(stage.owner)}">${esc(stage.owner || '')}</span></td>
      <td class="timing">${esc(stage.timing || '—')}</td>
      <td class="desc">${esc(stage.description || '')}</td>
    </tr>`).join('');
  return `<table class="stages">
    <thead><tr><th>#</th><th>Stage</th><th>Owner</th><th>Timing</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Build the standalone, self-contained report document.
export function buildTimelineReportHtml(template, meta = {}) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const svg = buildTimelineSvg(template, { branded: false });
  const title = template?.name?.trim() || 'Timeline';
  const services = (template?.services || []).filter(Boolean);
  const generatedAt = meta.generatedAt || '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — Schneider Electric</title>
<style>
  @page { size: landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F1F5F9; color: ${SE_INK};
    font-family: 'Nunito Sans','Segoe UI',Arial,Helvetica,sans-serif;
  }
  .page {
    max-width: 1600px; margin: 24px auto; background: #fff;
    border-radius: 10px; overflow: hidden;
    box-shadow: 0 2px 18px rgba(15,23,42,0.10);
  }
  .band {
    background: ${SE_GREEN_DARK}; color: #fff;
    padding: 18px 28px; display: flex; align-items: center;
    justify-content: space-between; gap: 24px;
  }
  .bandTitle { font-size: 26px; font-weight: 900; letter-spacing: -0.4px; }
  .bandSub { font-size: 13px; font-weight: 600; opacity: 0.92; margin-top: 3px; }
  .body { padding: 24px 28px 28px; }
  .graphic { width: 100%; overflow-x: auto; margin-bottom: 18px; }
  /* Direct child only — a descendant selector would also hit the Schneider
     lockup nested inside the graphic and stretch it to the full width. */
  .graphic > svg { width: 100%; height: auto; min-width: 900px; }
  h2 {
    font-size: 12px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.06em; color: ${SE_MUTE};
    margin: 22px 0 8px; padding-bottom: 6px; border-bottom: 1px solid ${SE_LINE};
  }
  table.stages { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.stages th {
    text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.05em; color: ${SE_SLATE};
    background: #F8FAFC; border-bottom: 2px solid ${SE_LINE};
  }
  table.stages td { padding: 9px 10px; border-bottom: 1px solid ${SE_LINE}; vertical-align: top; }
  table.stages td.num { width: 34px; text-align: center; font-weight: 800; color: ${SE_MUTE}; }
  table.stages td.stage { font-weight: 700; width: 20%; }
  table.stages td.timing { font-weight: 700; white-space: nowrap; width: 14%; }
  table.stages td.desc { color: ${SE_SLATE}; }
  .ownerPill {
    display: inline-block; padding: 1px 9px; border: 1px solid; border-radius: 999px;
    font-size: 11px; font-weight: 800; white-space: nowrap;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
  .chip {
    padding: 2px 10px; border: 1px solid ${SE_LINE}; border-radius: 999px;
    background: #F8FAFC; font-size: 11.5px; font-weight: 700; color: ${SE_SLATE};
  }
  .foot {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    margin-top: 22px; padding-top: 12px; border-top: 1px solid ${SE_LINE};
    font-size: 11px; color: ${SE_MUTE};
  }
  .noPrint { text-align: center; margin: 14px 0 0; }
  .noPrint button {
    padding: 8px 18px; border: none; border-radius: 6px; background: ${SE_GREEN_DARK};
    color: #fff; font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
  }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: none; border-radius: 0; }
    .noPrint { display: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="band">
      <div>
        <div class="bandTitle">${esc(title)}</div>
        <div class="bandSub">Engagement timeline${services.length ? ` — ${esc(services.join(' · '))}` : ''}</div>
      </div>
      ${schneiderLogoSvg({ onDark: true, width: 190 })}
    </div>
    <div class="body">
      ${svg ? `<div class="graphic">${svg}</div>` : '<p>This timeline has no stages yet.</p>'}
      <h2>Stages &amp; ownership</h2>
      ${stages.length ? stageTable(stages) : ''}
      ${services.length ? `<h2>Applies to</h2><div class="chips">${services.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="foot">
        <span>Schneider Electric — Life Is On</span>
        <span>${generatedAt ? `Generated ${esc(generatedAt)}` : ''}</span>
      </div>
    </div>
  </div>
  <div class="noPrint"><button onclick="window.print()">Print / Save as PDF</button></div>
</body>
</html>`;
}

// Open the branded report in a new tab. Returns false when the pop-up was
// blocked so the caller can tell the user why nothing happened.
export function openTimelineReport(template, meta = {}) {
  const html = buildTimelineReportHtml(template, {
    generatedAt: new Date().toLocaleString(),
    ...meta,
  });
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

// Vector export — the file to drop into a slide.
export function downloadTimelineSvg(template) {
  const svg = buildTimelineSvg(template, { branded: true });
  if (!svg) return false;
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileSlug(template)}.svg`);
  return true;
}

// Raster export. Draws the SVG onto a canvas at `scale`× so the PNG stays
// sharp when pasted into a deck or an email at full width.
export function downloadTimelinePng(template, { scale = 2 } = {}) {
  const svg = buildTimelineSvg(template, { branded: true });
  if (!svg) return Promise.resolve(false);

  // Encode as a data URL rather than a blob URL: a blob-URL <img> taints the
  // canvas in some browsers, which would make toBlob throw.
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const width = match ? Number(match[1]) : 1200;
  const height = match ? Number(match[2]) : 646;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Could not rasterize the timeline')); return; }
        triggerDownload(blob, `${fileSlug(template)}.png`);
        resolve(true);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Could not load the timeline graphic'));
    img.src = encoded;
  });
}
