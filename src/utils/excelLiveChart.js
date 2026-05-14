// Post-processes an ExcelJS-produced .xlsx buffer to inject a native
// Excel line chart that references cells on a named worksheet.
// ExcelJS doesn't write chart XML, so for charts that need to
// recompute live as the user edits the table we hand-roll the
// chart / drawing / relationship XML and stitch it into the zip
// alongside ExcelJS's output.
//
// The injected chart is anchored on the SAME drawing as any image
// the sheet already carries (a worksheet can only own one drawing).
// If the drawing's _rels file doesn't exist yet, it's created.

import JSZip from 'jszip';

const NS_OXR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// In a worksheet-qualified cell reference the sheet name uses single
// quotes; literal single quotes inside the name are doubled. Excel
// uses this same convention.
function escapeSheetName(s) {
  return String(s).replace(/'/g, "''");
}

function buildChartXml({ sheetName, categories, series1, series2, titleText }) {
  const esc = escapeSheetName(sheetName);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${escapeXml(titleText)}</a:t></a:r></a:p></c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>${escapeXml(series1.name)}</c:v></c:tx>
          <c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="F97316"/></a:solidFill></a:ln></c:spPr>
          <c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="F97316"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="F97316"/></a:solidFill></a:ln></c:spPr></c:marker>
          <c:cat><c:strRef><c:f>'${esc}'!${categories}</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>'${esc}'!${series1.range}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>
        <c:ser>
          <c:idx val="1"/>
          <c:order val="1"/>
          <c:tx><c:v>${escapeXml(series2.name)}</c:v></c:tx>
          <c:spPr><a:ln w="22225"><a:prstDash val="dash"/><a:solidFill><a:srgbClr val="1E40AF"/></a:solidFill></a:ln></c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
          <c:cat><c:strRef><c:f>'${esc}'!${categories}</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>'${esc}'!${series2.range}</c:f></c:numRef></c:val>
          <c:smooth val="0"/>
        </c:ser>
        <c:marker val="1"/>
        <c:axId val="111"/>
        <c:axId val="222"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="111"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="222"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="222"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:numFmt formatCode="&quot;$&quot;#,##0" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:crossAx val="111"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="t"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

// Two-cell anchor for the chart inside the drawing XML. cols/rows
// are 0-indexed (twoCellAnchor convention).
function buildChartAnchor({ fromCol, fromRow, toCol, toRow, chartRid, frameId }) {
  return `<xdr:twoCellAnchor>
    <xdr:from>
      <xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${frameId}" name="Chart ${frameId}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${NS_OXR}" r:id="${chartRid}"/>
        </a:graphicData>
      </a:graphic>
      <xdr:clientData/>
    </xdr:graphicFrame>
  </xdr:twoCellAnchor>`;
}

// Locate the worksheet XML path for a given sheet name. Walks
// workbook.xml → workbook.xml.rels. Attribute extraction happens in
// two steps (match element, then pull attribute) so the regex
// doesn't have to deal with URL-style values like the
// `http://schemas.openxmlformats.org/.../worksheet` Type — those
// contain `/` characters that a single-pass `[^/>]*` regex rejects.
async function findSheetPath(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetRe = new RegExp(`<sheet[^>]*?name="${escapeXml(sheetName)}"[^>]*?/>`);
  const sheetEl = workbookXml.match(sheetRe);
  if (!sheetEl) throw new Error(`Sheet not found in workbook.xml: ${sheetName}`);
  const ridMatch = sheetEl[0].match(/r:id="(rId\d+)"/);
  if (!ridMatch) throw new Error(`Sheet has no r:id attribute: ${sheetName}`);
  const ridStr = ridMatch[1];
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relRe = new RegExp(`<Relationship[^>]*?Id="${ridStr}"[^>]*?/>`);
  const relEl = relsXml.match(relRe);
  if (!relEl) throw new Error(`Sheet relationship not found: ${ridStr}`);
  const targetMatch = relEl[0].match(/Target="([^"]+)"/);
  if (!targetMatch) throw new Error(`Sheet relationship missing Target: ${ridStr}`);
  const target = targetMatch[1]; // worksheets/sheetN.xml
  return {
    fullPath: 'xl/' + target,
    fileName: target.split('/').pop(), // sheetN.xml
    baseName: target.split('/').pop().replace(/\.xml$/, ''), // sheetN
  };
}

// Read or create the relationships file for a worksheet / drawing.
// Returns the raw XML string; caller appends Relationship elements
// before </Relationships> and writes it back.
async function readOrCreateRels(zip, path) {
  const file = zip.file(path);
  if (file) return await file.async('string');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
}

function nextRid(relsXml) {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
  return `rId${Math.max(0, ...ids) + 1}`;
}

// Append a new relationship element before </Relationships>.
function appendRel(relsXml, rel) {
  return relsXml.replace(/<\/Relationships>/, `${rel}</Relationships>`);
}

// Append a child element just inside the drawing's <xdr:wsDr> root.
function appendDrawingChild(drawingXml, child) {
  return drawingXml.replace(/<\/xdr:wsDr>/, `${child}</xdr:wsDr>`);
}

// Main entry point. Mutates the in-memory zip and returns a fresh
// xlsx ArrayBuffer.
export async function injectLineChart(workbookBuffer, opts) {
  const {
    sheetName,
    categoriesRange,       // e.g., '$B$7:$B$18'
    series1,               // { name, range }
    series2,               // { name, range }
    titleText,
    anchor,                // { fromCol, fromRow, toCol, toRow }
  } = opts;
  const zip = await JSZip.loadAsync(workbookBuffer);

  // 1. Locate the worksheet XML and its rels.
  const sheet = await findSheetPath(zip, sheetName);
  const sheetRelsPath = `xl/worksheets/_rels/${sheet.baseName}.xml.rels`;

  // 2. Find or create the drawing this sheet uses. ExcelJS already
  //    produced one if the sheet has an image; otherwise we add a
  //    fresh drawingN.xml and wire it into the sheet.
  let sheetRelsXml = await readOrCreateRels(zip, sheetRelsPath);
  // Find an existing drawing relationship (if any). Same two-step
  // approach used in findSheetPath — match the element, then extract
  // Target — so URL-style Type values don't trip the regex.
  const drawingRelEl = sheetRelsXml.match(/<Relationship[^>]*?Type="[^"]*\/drawing"[^>]*?\/>/);
  let drawingPath, drawingBase;
  if (drawingRelEl) {
    const target = drawingRelEl[0].match(/Target="([^"]+)"/)?.[1]; // ../drawings/drawingN.xml
    if (!target) throw new Error('Drawing relationship missing Target');
    drawingPath = 'xl/' + target.replace(/^\.\.\//, '');
    drawingBase = drawingPath.split('/').pop().replace(/\.xml$/, '');
  } else {
    // No drawing yet — create drawingN.xml with a fresh number.
    let n = 1;
    while (zip.file(`xl/drawings/drawing${n}.xml`)) n++;
    drawingBase = `drawing${n}`;
    drawingPath = `xl/drawings/${drawingBase}.xml`;
    zip.file(drawingPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>');
    // Wire the new drawing into the worksheet's _rels + the
    // worksheet XML itself.
    const newRid = nextRid(sheetRelsXml);
    sheetRelsXml = appendRel(
      sheetRelsXml,
      `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingBase}.xml"/>`,
    );
    let sheetXml = await zip.file(sheet.fullPath).async('string');
    if (!/<drawing\s/i.test(sheetXml)) {
      sheetXml = sheetXml.replace(/<\/worksheet>/, `<drawing r:id="${newRid}"/></worksheet>`);
      zip.file(sheet.fullPath, sheetXml);
    }
  }

  // 3. Write the chart XML at the next unused chartN.xml slot.
  let cn = 1;
  while (zip.file(`xl/charts/chart${cn}.xml`)) cn++;
  const chartFile = `chart${cn}.xml`;
  const chartPath = `xl/charts/${chartFile}`;
  zip.file(chartPath, buildChartXml({ sheetName, categories: categoriesRange, series1, series2, titleText }));

  // 4. Add the chart relationship to the drawing's _rels.
  const drawingRelsPath = `xl/drawings/_rels/${drawingBase}.xml.rels`;
  let drawingRelsXml = await readOrCreateRels(zip, drawingRelsPath);
  const chartRid = nextRid(drawingRelsXml);
  drawingRelsXml = appendRel(
    drawingRelsXml,
    `<Relationship Id="${chartRid}" Type="${NS_OXR}/chart" Target="../charts/${chartFile}"/>`,
  );
  zip.file(drawingRelsPath, drawingRelsXml);

  // 5. Append the chart anchor to the drawing XML.
  let drawingXml = await zip.file(drawingPath).async('string');
  // Unique id within the drawing — count existing nvGraphicFramePr +
  // nvPicPr elements and use the next integer.
  const existingNv = (drawingXml.match(/<xdr:cNvPr\s+id="(\d+)"/g) || [])
    .map(m => parseInt(m.match(/id="(\d+)"/)[1], 10));
  const frameId = (existingNv.length ? Math.max(...existingNv) : 0) + 1;
  drawingXml = appendDrawingChild(drawingXml, buildChartAnchor({
    fromCol: anchor.fromCol, fromRow: anchor.fromRow,
    toCol:   anchor.toCol,   toRow:   anchor.toRow,
    chartRid, frameId,
  }));
  zip.file(drawingPath, drawingXml);

  // 6. Register the chart content type in [Content_Types].xml.
  // Also register the drawing content type if we created a new
  // drawing — ExcelJS only writes that override when it produces a
  // drawing itself.
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath).async('string');
  const chartCt = `<Override PartName="/${chartPath}" ContentType="${NS_CHART}"/>`;
  if (!ct.includes(`PartName="/${chartPath}"`)) {
    ct = ct.replace(/<\/Types>/, `${chartCt}</Types>`);
  }
  const drawingCt = `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
  if (!ct.includes(`PartName="/${drawingPath}"`)) {
    ct = ct.replace(/<\/Types>/, `${drawingCt}</Types>`);
  }
  zip.file(ctPath, ct);
  // Also make sure the worksheet-rels-to-sheet update we may have
  // done above is persisted.
  zip.file(sheetRelsPath, sheetRelsXml);

  return await zip.generateAsync({ type: 'arraybuffer' });
}
