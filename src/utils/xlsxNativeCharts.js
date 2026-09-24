// Native Excel charts, added to a workbook ExcelJS has already written.
//
// ExcelJS writes images but not charts, and a picture of a chart is a dead
// end in a spreadsheet: nobody can restyle it, retitle it or see the number
// under a point. So the workbook is written first, with the chart data in
// ordinary cells, and the charts are added afterwards as the DrawingML parts
// Excel itself would write: a chart part per chart, a drawing that anchors
// them on the sheet, and the relationships and content types that tie the
// three together. The charts point at the cells, so they stay live.
//
// Only what the savings export needs: clustered columns and plain lines,
// one category axis and one value axis.
//
// Pure apart from the zip library, which is handed in, so a test can open
// the result and read the parts back.

const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_CHART = `${NS_R}/chart`;
const REL_DRAWING = `${NS_R}/drawing`;
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 0-based column index to letters: 0 -> A, 26 -> AA.
export function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** An absolute reference to a run of cells down one column (0-based col, 1-based rows). */
export function colRef(sheet, col, fromRow, toRow) {
  const c = colName(col);
  return `'${String(sheet).replace(/'/g, "''")}'!$${c}$${fromRow}:$${c}$${toRow}`;
}

const DASH = { solid: 'solid', dash: 'dash', dot: 'sysDot' };
const PT = 12700; // EMU per point

function lineProps(color, { width = 2.25, dash = 'solid' } = {}) {
  return `<a:ln w="${Math.round(width * PT)}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
    + `<a:prstDash val="${DASH[dash] || 'solid'}"/><a:round/></a:ln>`;
}

function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')
  }</c:strCache>`;
}

function numCache(values) {
  const pts = values
    .map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : ''))
    .join('');
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

function text(runs, { size = 900, bold = false, color = '64748B' } = {}) {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}">`
    + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Nunito Sans"/></a:defRPr></a:pPr>`
    + `<a:endParaRPr lang="en-US"/></a:p></c:txPr>${runs || ''}`;
}

function series(s, i, type, categories) {
  const spPr = type === 'bar'
    ? `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`
    : `<c:spPr>${lineProps(s.color, s)}</c:spPr>`;
  const body = [
    `<c:idx val="${i}"/><c:order val="${i}"/>`,
    `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`,
    spPr,
    type === 'bar' ? '<c:invertIfNegative val="0"/>' : '<c:marker><c:symbol val="none"/></c:marker>',
    `<c:cat><c:strRef><c:f>${esc(categories.ref)}</c:f>${strCache(categories.values)}</c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f>${numCache(s.values)}</c:numRef></c:val>`,
    type === 'line' ? '<c:smooth val="0"/>' : '',
  ];
  return `<c:ser>${body.join('')}</c:ser>`;
}

/**
 * One chart part. `spec`:
 *   type: 'bar' | 'line'
 *   title: string
 *   categories: { ref, values }   the month labels
 *   series: [{ name, ref, values, color, width?, dash? }]
 *   yFormat: the value axis number format
 */
export function chartXml(spec) {
  const CAT = 500000001;
  const VAL = 500000002;
  const plot = spec.type === 'bar'
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${
      spec.series.map((s, i) => series(s, i, 'bar', spec.categories)).join('')
    }<c:gapWidth val="40"/><c:overlap val="100"/><c:axId val="${CAT}"/><c:axId val="${VAL}"/></c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${
      spec.series.map((s, i) => series(s, i, 'line', spec.categories)).join('')
    }<c:marker val="1"/><c:axId val="${CAT}"/><c:axId val="${VAL}"/></c:lineChart>`;

  const axisLine = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>';
  const catAx = `<c:catAx><c:axId val="${CAT}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>`
    + '<c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/>'
    + `<c:minorTickMark val="none"/><c:tickLblPos val="low"/>${axisLine}${text()}`
    + `<c:crossAx val="${VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>`
    + '<c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
  const valAx = `<c:valAx><c:axId val="${VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>`
    + '<c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
    + `<c:numFmt formatCode="${esc(spec.yFormat || 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/>`
    + `<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text()}`
    + `<c:crossAx val="${CAT}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;

  const title = '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>'
    + `<a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill>`
    + `<a:latin typeface="Nunito Sans"/></a:rPr><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx>`
    + '<c:overlay val="0"/></c:title>';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">`
    + '<c:roundedCorners val="0"/>'
    + `<c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${catAx}${valAx}</c:plotArea>`
    + `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${text('', { size: 1000, color: '1E293B' })}</c:legend>`
    // Hidden helper columns still plot, and an empty cell is a break in
    // the line rather than a drop to zero.
    + '<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/></c:chart>'
    + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'
    + '</c:chartSpace>';
}

function anchorXml(a, i) {
  const pt = (tag, p) => `<xdr:${tag}><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff>`
    + `<xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  return `<xdr:twoCellAnchor editAs="oneCell">${pt('from', a.from)}${pt('to', a.to)}`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>`
    + '<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
    + `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/>`
    + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
}

function nextFree(zip, dir, stem) {
  let n = 1;
  while (zip.file(`${dir}/${stem}${n}.xml`)) n += 1;
  return n;
}

function addOverride(types, part, contentType) {
  if (types.includes(`PartName="${part}"`)) return types;
  return types.replace('</Types>', `<Override PartName="${part}" ContentType="${contentType}"/></Types>`);
}

// The worksheet part a sheet name lives in, via workbook.xml and its rels.
async function sheetPath(zip, name) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheet = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0])
    .find(tag => tag.includes(`name="${esc(name)}"`));
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  const rel = rid && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => t.includes(`Id="${rid}"`));
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error(`No sheet named ${name}`);
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/**
 * Add `charts` ({ anchor: { from: {col,row}, to: {col,row} }, ...chartXml spec },
 * 0-based cells) to the sheet called `sheetName` in an xlsx `buffer`.
 * The sheet must not already carry a drawing. Returns the new buffer.
 */
export async function addNativeCharts(JSZip, buffer, sheetName, charts) {
  if (!charts?.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const sheet = await sheetPath(zip, sheetName);
  const sheetDir = sheet.slice(0, sheet.lastIndexOf('/'));
  const sheetFile = sheet.slice(sheet.lastIndexOf('/') + 1);
  let types = await zip.file('[Content_Types].xml').async('string');

  const d = nextFree(zip, 'xl/drawings', 'drawing');
  const drawingRels = [];
  let c = nextFree(zip, 'xl/charts', 'chart');
  charts.forEach((spec, i) => {
    zip.file(`xl/charts/chart${c}.xml`, chartXml(spec));
    types = addOverride(types, `/xl/charts/chart${c}.xml`, CT_CHART);
    drawingRels.push(`<Relationship Id="rId${i + 1}" Type="${REL_CHART}" Target="../charts/chart${c}.xml"/>`);
    c += 1;
  });
  zip.file(`xl/drawings/drawing${d}.xml`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${charts.map((s, i) => anchorXml(s.anchor, i)).join('')}</xdr:wsDr>`);
  zip.file(`xl/drawings/_rels/drawing${d}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<Relationships xmlns="${NS_PKG_REL}">${drawingRels.join('')}</Relationships>`);
  types = addOverride(types, `/xl/drawings/drawing${d}.xml`, CT_DRAWING);
  zip.file('[Content_Types].xml', types);

  // The sheet's own relationship to the drawing, next to whatever it has.
  const relsPath = `${sheetDir}/_rels/${sheetFile}.rels`;
  let rels = zip.file(relsPath)
    ? await zip.file(relsPath).async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_REL}"></Relationships>`;
  let rid = 1;
  while (rels.includes(`Id="rIdChart${rid}"`)) rid += 1;
  const drawingRid = `rIdChart${rid}`;
  rels = rels.replace('</Relationships>',
    `<Relationship Id="${drawingRid}" Type="${REL_DRAWING}" Target="../drawings/drawing${d}.xml"/></Relationships>`);
  zip.file(relsPath, rels);

  // <drawing> goes after the page setup and before anything the schema
  // lists later, or Excel calls the file corrupt.
  let xml = await zip.file(sheet).async('string');
  if (/<drawing\b/.test(xml)) throw new Error(`${sheetName} already has a drawing`);
  if (!/xmlns:r=/.test(xml)) xml = xml.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
  const tag = `<drawing r:id="${drawingRid}"/>`;
  const later = xml.search(/<(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  xml = later >= 0 ? `${xml.slice(0, later)}${tag}${xml.slice(later)}` : xml.replace('</worksheet>', `${tag}</worksheet>`);
  zip.file(sheet, xml);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
