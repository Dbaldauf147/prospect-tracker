// Hands the Account MRI intake template back filled in for one company, as
// a download. Shared by the Account MRI table's export button and the
// Account MRI popup's.
import { fillAccountMriWorkbook, mriFileName } from './accountMri';
import templateUrl from '../assets/account-mri-intake-template.xlsx?url';

export async function downloadAccountMri({ company, profile, committee, sites, extra = null }) {
  const [{ default: JSZip }, res] = await Promise.all([import('jszip'), fetch(templateUrl)]);
  if (!res.ok) throw new Error(`The template could not be loaded (${res.status}).`);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const written = await fillAccountMriWorkbook(zip, { profile, committee, sites, extra });
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = mriFileName(company);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return written;
}
