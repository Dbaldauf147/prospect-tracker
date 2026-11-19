// A one-page PDF holding one JPEG, full bleed. Written by hand so a PDF
// export does not bring a PDF library into the bundle: a page whose whole
// content is a picture is a handful of objects, and a JPEG goes into a PDF
// as it is (DCTDecode), with no re-encoding.
//
//   jpeg    Uint8Array of the JPEG file
//   imgW/H  its pixel size
//   pageW/H the page, in points (1/72 inch)
//   title   the document title a viewer shows
//
// Returns the PDF as a Uint8Array.
const enc = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
// A PDF literal string: ASCII only, with the three characters that would end or bend it escaped.
const pdfText = (s) => String(s || '').replace(/[^\x20-\x7e]/g, ' ').replace(/([\\()])/g, '\\$1');
const n = (v) => Number(v).toFixed(2).replace(/\.?0+$/, '');

export function buildJpegPdf({ jpeg, imgW, imgH, pageW, pageH, title = '' }) {
  if (!(jpeg instanceof Uint8Array) || jpeg.length === 0) throw new Error('No image to put in the PDF');
  const content = `q ${n(pageW)} 0 0 ${n(pageH)} 0 0 cm /Im0 Do Q`;
  const objects = [
    enc('<< /Type /Catalog /Pages 2 0 R >>'),
    enc('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    [enc(`<< /Type /XObject /Subtype /Image /Width ${Math.round(imgW)} /Height ${Math.round(imgH)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc('\nendstream')],
    enc(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
    enc(`<< /Title (${pdfText(title)}) /Producer (Prospect Tracker) >>`),
  ];
  const parts = [enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunks = [enc(`${i + 1} 0 obj\n`), ...(Array.isArray(body) ? body : [body]), enc('\nendobj\n')];
    for (const c of chunks) { parts.push(c); offset += c.length; }
  });
  const xref = offset;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(enc(tail));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
