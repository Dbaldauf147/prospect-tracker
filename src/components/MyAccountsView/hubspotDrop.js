// What the Hubspot Mapping subtabs that take a HubSpot export share: reading
// a dropped file (CSV, Excel or HubSpot's zip) and taking rows pasted from
// Excel. Used by the Activity and Contacts subtabs.
import { useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { pastedSheetRows, pickExportFromZip } from '../../utils/hubspotMapping';

// IDs are read as the numbers in the cells, not as Excel shows them, so a
// 12-digit Engagement ID keeps every digit (Excel shows 1.18921E+11). Dates
// come as Date objects from Excel and as text from a CSV.
export async function readHubspotSheet(file) {
  let name = file.name;
  let bytes = await file.arrayBuffer();
  if (/\.zip$/i.test(name)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const entry = pickExportFromZip(Object.keys(zip.files).filter(n => !zip.files[n].dir));
    if (!entry) throw new Error('No CSV or Excel file in that zip.');
    name = entry;
    bytes = await zip.files[entry].async('arraybuffer');
  }
  const csv = /\.csv$/i.test(name);
  const wb = XLSX.read(bytes, { type: 'array', raw: csv, cellDates: !csv });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
}

/**
 * Ctrl/Cmd+V of rows copied out of Excel (header row included), as on the
 * Mapping subtab: `onRows` gets them only when the last click was inside
 * `rootRef`, nothing is `busy` and no text box has focus.
 */
export function usePastedRows(rootRef, busy, onRows) {
  const clickedInside = useRef(true);
  const pasteRef = useRef(null);
  useEffect(() => { pasteRef.current = (e) => {
    if (e.defaultPrevented || busy || !clickedInside.current) return;
    const ae = document.activeElement;
    const tag = ae?.tagName?.toLowerCase() || '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || ae?.isContentEditable) return;
    const rows = pastedSheetRows(e.clipboardData?.getData('text/plain') || '');
    if (!rows.length) return;
    e.preventDefault();
    onRows(rows);
  }; });
  useEffect(() => {
    const onPaste = (e) => pasteRef.current?.(e);
    const onDown = (e) => { clickedInside.current = !!rootRef.current?.contains(e.target); };
    document.addEventListener('paste', onPaste);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('paste', onPaste); document.removeEventListener('pointerdown', onDown, true); };
  }, [rootRef]);
}

