// Inject a native Excel line chart into an .xlsx buffer produced by
// ExcelJS. ExcelJS has no chart API (only addImage for static PNGs),
// so the workbook is opened as a zip, chart + drawing XML files are
// appended, the worksheet is wired up to the new drawing, and
// [Content_Types].xml is updated. The resulting chart references
// live cell ranges, so edits in Excel recompute it.
//
// Limitations: this helper writes one line chart per call, targeted at
// a single sheet. It picks free chart{N}.xml / drawing{N}.xml indices
// so it co-exists with any drawings ExcelJS already created (e.g.
// addImage outputs on other sheets).

import JSZip from 'jszip';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS = {
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickFreeIndex(zip, prefix, suffix) {
  let n = 1;
  while (zip.file(`${prefix}${n}${suffix}`)) n++;
  return n;
}

function buildChartXml({ title, catRef, series }) {
  const seriesXml = series.map((s, i) => {
    const markerBlock = s.marker
      ? `<c:marker>
          <c:symbol val="${s.marker}"/>
          <c:size val="${s.markerSize || 6}"/>
          <c:spPr>
            <a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>
            <a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
          </c:spPr>
        </c:marker>`
      : `<c:marker><c:symbol val="none"/></c:marker>`;
    const dashBlock = s.dash ? `<a:prstDash val="${s.dash}"/>` : '';
    return `<c:ser>
      <c:idx val="${i}"/>
      <c:order val="${i}"/>
      <c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>
      <c:spPr>
        <a:ln w="28575" cap="rnd">
          <a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>
          ${dashBlock}
          <a:round/>
        </a:ln>
      </c:spPr>
      ${markerBlock}
      <c:cat><c:strRef><c:f>${escapeXml(catRef)}</c:f></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${escapeXml(s.valRef)}</c:f></c:numRef></c:val>
      <c:smooth val="0"/>
    </c:ser>`;
  }).join('');

  return `${XML_HEADER}
<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:defRPr></a:pPr>
            <a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${escapeXml(title)}</a:t></a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:marker val="1"/>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="111111111"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="222222222"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="222222222"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:numFmt formatCode="&quot;$&quot;#,##0" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:crossAx val="111111111"/>
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

function buildDrawingXml({ col, colOff, row, rowOff, cx, cy }) {
  return `${XML_HEADER}
<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>${col}</xdr:col>
      <xdr:colOff>${colOff}</xdr:colOff>
      <xdr:row>${row}</xdr:row>
      <xdr:rowOff>${rowOff}</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${cx}" cy="${cy}"/>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${NS.c}">
          <c:chart xmlns:c="${NS.c}" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

function buildDrawingRelsXml({ chartTarget }) {
  return `${XML_HEADER}
<Relationships xmlns="${NS.rel}">
  <Relationship Id="rId1" Type="${NS.r}/chart" Target="${chartTarget}"/>
</Relationships>`;
}

// `buffer` is whatever ExcelJS's writeBuffer returned (ArrayBuffer in
// the browser). Returns a new ArrayBuffer with the chart injected. On
// any failure the original buffer is returned and a warning logged —
// the caller's export still produces a valid (chart-less) workbook.
export async function injectLiveLineChart(buffer, { sheetName, title, catRef, series, anchor }) {
  try {
    const zip = await JSZip.loadAsync(buffer);

    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    const workbookRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

    const sheetRidMatch = new RegExp(
      `<sheet[^>]*name="${escapeRegex(sheetName)}"[^>]*r:id="([^"]+)"`,
      'i'
    ).exec(workbookXml);
    if (!sheetRidMatch) throw new Error(`Sheet "${sheetName}" not found in workbook.xml`);
    const sheetRid = sheetRidMatch[1];

    const sheetTargetMatch = new RegExp(
      `<Relationship[^>]*Id="${escapeRegex(sheetRid)}"[^>]*Target="([^"]+)"`,
      'i'
    ).exec(workbookRelsXml);
    if (!sheetTargetMatch) throw new Error(`Relationship ${sheetRid} not found in workbook.xml.rels`);
    const sheetRelTarget = sheetTargetMatch[1]; // e.g. "worksheets/sheet3.xml"

    const sheetXmlPath = `xl/${sheetRelTarget}`;
    const sheetFileBase = sheetRelTarget.replace(/^worksheets\//, ''); // sheet3.xml
    const sheetRelsPath = `xl/worksheets/_rels/${sheetFileBase}.rels`;

    const chartIdx = pickFreeIndex(zip, 'xl/charts/chart', '.xml');
    const drawingIdx = pickFreeIndex(zip, 'xl/drawings/drawing', '.xml');

    const chartFile = `xl/charts/chart${chartIdx}.xml`;
    const drawingFile = `xl/drawings/drawing${drawingIdx}.xml`;
    const drawingRelsFile = `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`;

    zip.file(chartFile, buildChartXml({ title, catRef, series }));
    zip.file(drawingFile, buildDrawingXml(anchor));
    zip.file(drawingRelsFile, buildDrawingRelsXml({ chartTarget: `../charts/chart${chartIdx}.xml` }));

    // Sheet -> drawing relationship.
    let sheetRelsContent;
    let drawingRid;
    if (zip.file(sheetRelsPath)) {
      sheetRelsContent = await zip.file(sheetRelsPath).async('string');
      const ids = [...sheetRelsContent.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
      drawingRid = (ids.length ? Math.max(...ids) : 0) + 1;
      const newRel = `<Relationship Id="rId${drawingRid}" Type="${NS.r}/drawing" Target="../drawings/drawing${drawingIdx}.xml"/>`;
      sheetRelsContent = sheetRelsContent.replace('</Relationships>', `${newRel}</Relationships>`);
    } else {
      drawingRid = 1;
      sheetRelsContent = `${XML_HEADER}
<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${NS.r}/drawing" Target="../drawings/drawing${drawingIdx}.xml"/></Relationships>`;
    }
    zip.file(sheetRelsPath, sheetRelsContent);

    // Worksheet XML: insert <drawing r:id="..."/> before </worksheet>.
    // Strip any existing drawing element first so we don't end up with
    // two (e.g. if a previous pass left one behind).
    let sheetXml = await zip.file(sheetXmlPath).async('string');
    sheetXml = sheetXml.replace(/<drawing\s+[^/>]*\/>/g, '');
    sheetXml = sheetXml.replace(/<\/worksheet>\s*$/, `<drawing r:id="rId${drawingRid}"/></worksheet>`);
    zip.file(sheetXmlPath, sheetXml);

    // [Content_Types].xml: register chart + drawing overrides.
    let ctXml = await zip.file('[Content_Types].xml').async('string');
    const chartOverride = `<Override PartName="/${chartFile}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    const drawingOverride = `<Override PartName="/${drawingFile}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    const additions = [];
    if (!ctXml.includes(chartOverride)) additions.push(chartOverride);
    if (!ctXml.includes(drawingOverride)) additions.push(drawingOverride);
    if (additions.length) {
      ctXml = ctXml.replace('</Types>', `${additions.join('')}</Types>`);
      zip.file('[Content_Types].xml', ctXml);
    }

    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch (err) {
    console.warn('injectLiveLineChart: falling back to chart-less workbook —', err);
    return buffer;
  }
}
