import { useState } from 'react';
import { downloadSavedAnalysis } from '../utils/savedAnalysisDownload';
import { formatAnalysisDate } from '../hooks/useSavedAnalyses';

// The "✓ Aug 31" a saved Master Analysis shows in a table cell, as a link
// that downloads the workbook. The click stays in the cell, so it never
// also opens the row's company popup.
export default function SavedAnalysisLink({ prospectId, meta, companyName, style }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !prospectId) return;
    setBusy(true);
    setError('');
    try {
      await downloadSavedAnalysis(prospectId, { fallbackName: `${companyName || 'Company'} Master Analysis.xlsx` });
    } catch (err) {
      console.error('Master Analysis download failed:', err);
      setError(err?.message || 'Download failed.');
    } finally {
      setBusy(false);
    }
  };

  const title = error
    ? `Could not download: ${error}`
    : [
      `${companyName} has a Master Analysis saved${meta?.savedAt ? ` on ${new Date(meta.savedAt).toLocaleString()}` : ''}.`,
      meta?.fileName || '',
      meta?.sizeBytes ? `${(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '',
      'Click to download it.',
    ].filter(Boolean).join('\n');

  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      onClick={download}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') download(e); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 700,
        color: error ? '#B91C1C' : '#166534', cursor: busy ? 'progress' : 'pointer', textDecoration: 'underline',
        ...style,
      }}
    >{busy ? 'Downloading...' : error ? '⚠ Retry' : `⬇ ${formatAnalysisDate(meta?.savedAt)}`}</span>
  );
}
