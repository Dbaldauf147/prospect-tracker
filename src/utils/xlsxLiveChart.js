// Inject a native Excel chart into an .xlsx buffer produced by
// ExcelJS. ExcelJS has no chart API (only addImage for static PNGs),
// so the workbook is opened as a zip, chart + drawing XML files are
// appended, the worksheet is wired up to the new drawing, and
// [Content_Types].xml is updated. The resulting chart references
// live cell ranges, so edits in Excel recompute it.
//
// Supports two chart types layered in one plot area: an optional
// stacked area chart (for "fill between curves" effects) plus a line
// chart. Both share the same category and value axes.

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

function lineSeriesXml(s, idx, catRef) {
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
    <c:idx val="${idx}"/>
    <c:order val="${idx}"/>
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
}

function areaSeriesXml(s, idx, catRef) {
  const fillBlock = s.noFill
    ? `<a:noFill/>`
    : `<a:solidFill><a:srgbClr val="${s.color}"/>${s.alpha != null ? `<a:alpha val="${s.alpha}"/>` : ''}</a:solidFill>`;
  return `<c:ser>
    <c:idx val="${idx}"/>
    <c:order val="${idx}"/>
    <c:tx><c:v>${escapeXml(s.name || '')}</c:v></c:tx>
    <c:spPr>
      ${fillBlock}
      <a:ln><a:noFill/></a:ln>
    </c:spPr>
    <c:cat><c:strRef><c:f>${escapeXml(catRef)}</c:f></c:strRef></c:cat>
    <c:val><c:numRef><c:f>${escapeXml(s.valRef)}</c:f></c:numRef></c:val>
  </c:ser>`;
}

function buildChartXml({ title, catRef, lineSeries = [], areaSeries = [], yMin, yMax, yMajorUnit, hideLegendIndices = [], numFmt }) {
  // Series indices are global across chart types. Areas come first
  // (drawn underneath) so they get the leading indices.
  let idx = 0;
  const areaSerialised = areaSeries.map((s) => areaSeriesXml(s, idx++, catRef)).join('');
  const lineSerialised = lineSeries.map((s) => lineSeriesXml(s, idx++, catRef)).join('');

  const areaBlock = areaSeries.length
    ? `<c:areaChart>
        <c:grouping val="stacked"/>
        <c:varyColors val="0"/>
        ${areaSerialised}
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:areaChart>`
    : '';

  const lineBlock = lineSeries.length
    ? `<c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${lineSerialised}
        <c:marker val="1"/>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:lineChart>`
    : '';

  const yScaling = `<c:scaling>
        <c:orientation val="minMax"/>
        ${yMax != null ? `<c:max val="${yMax}"/>` : ''}
        ${yMin != null ? `<c:min val="${yMin}"/>` : ''}
      </c:scaling>`;

  const legendEntryDeletions = hideLegendIndices
    .map((i) => `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>`)
    .join('');

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
      ${areaBlock}
      ${lineBlock}
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
        ${yScaling}
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:numFmt formatCode="${escapeXml(numFmt || '"$"#,##0')}" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:crossAx val="111111111"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
        ${yMajorUnit != null ? `<c:majorUnit val="${yMajorUnit}"/>` : ''}
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="t"/>
      ${legendEntryDeletions}
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="0"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

function anchorBlockXml({ anchor, relId, frameId, frameName }) {
  const { col, colOff, row, rowOff, cx, cy } = anchor;
  return `<xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>${col}</xdr:col>
      <xdr:colOff>${colOff}</xdr:colOff>
      <xdr:row>${row}</xdr:row>
      <xdr:rowOff>${rowOff}</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${cx}" cy="${cy}"/>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${frameId}" name="${escapeXml(frameName)}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
      </xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${NS.c}">
          <c:chart xmlns:c="${NS.c}" r:id="${relId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:oneCellAnchor>`;
}

function buildDrawingXmlMulti(anchors) {
  const blocks = anchors.map((a, i) => anchorBlockXml({
    anchor: a.anchor,
    relId: a.relId,
    frameId: 2 + i,
    frameName: `Chart ${i + 1}`,
  })).join('\n  ');
  return `${XML_HEADER}
<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
  ${blocks}
</xdr:wsDr>`;
}

function buildDrawingRelsXmlMulti(rels) {
  const lines = rels.map(r => `  <Relationship Id="${r.relId}" Type="${NS.r}/chart" Target="${r.chartTarget}"/>`).join('\n');
  return `${XML_HEADER}
<Relationships xmlns="${NS.rel}">
${lines}
</Relationships>`;
}

// `buffer` is whatever ExcelJS's writeBuffer returned (ArrayBuffer in
// the browser). Returns a new ArrayBuffer with the chart injected. On
// any failure the original buffer is returned and a warning logged —
// the caller's export still produces a valid (chart-less) workbook.
//
// Single-chart options (back-compat):
//   sheetName  — target worksheet (must already exist)
//   title      — chart title
//   catRef     — fully-qualified range for category axis labels
//   lineSeries — array of { name, color, marker?, markerSize?, dash?, valRef }
//   areaSeries — array of { name?, color, alpha?, noFill?, valRef } (rendered as a stacked area chart)
//   yMin, yMax — explicit value-axis bounds (optional)
//   hideLegendIndices — series indices to suppress from the legend
//   numFmt     — Excel format string for the value axis labels (default "$"#,##0)
//   anchor     — { col, colOff, row, rowOff, cx, cy } in EMU
//
// Multi-chart shape (preferred when stacking charts on one sheet):
//   sheetName + charts: [{ title, catRef, lineSeries, areaSeries,
//                          yMin, yMax, hideLegendIndices, numFmt, anchor }, …]
// All charts on a sheet share one drawing file (OOXML allows only
// one <drawing> element per worksheet); each gets its own chart XML.
export async function injectLiveLineChart(buffer, options) {
  const { sheetName } = options;
  const charts = Array.isArray(options.charts) && options.charts.length > 0
    ? options.charts
    : [{
        title: options.title,
        catRef: options.catRef,
        lineSeries: options.lineSeries ?? options.series ?? [],
        areaSeries: options.areaSeries ?? [],
        yMin: options.yMin,
        yMax: options.yMax,
        yMajorUnit: options.yMajorUnit,
        hideLegendIndices: options.hideLegendIndices ?? [],
        numFmt: options.numFmt,
        anchor: options.anchor,
      }];
  try {
    const { default: JSZip } = await import('jszip');
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
    const sheetRelTarget = sheetTargetMatch[1];

    const sheetXmlPath = `xl/${sheetRelTarget}`;
    const sheetFileBase = sheetRelTarget.replace(/^worksheets\//, '');
    const sheetRelsPath = `xl/worksheets/_rels/${sheetFileBase}.rels`;

    // One drawing file holds N graphic frames, one per chart. Each
    // chart still gets its own chart XML part.
    const drawingIdx = pickFreeIndex(zip, 'xl/drawings/drawing', '.xml');
    const drawingFile = `xl/drawings/drawing${drawingIdx}.xml`;
    const drawingRelsFile = `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`;

    let nextChartIdx = pickFreeIndex(zip, 'xl/charts/chart', '.xml');
    const chartFiles = [];
    const drawingRels = [];
    const drawingAnchors = [];
    for (let i = 0; i < charts.length; i++) {
      const c = charts[i];
      const idx = nextChartIdx + i;
      const chartFile = `xl/charts/chart${idx}.xml`;
      chartFiles.push(chartFile);
      zip.file(chartFile, buildChartXml({
        title: c.title,
        catRef: c.catRef,
        lineSeries: c.lineSeries ?? c.series ?? [],
        areaSeries: c.areaSeries ?? [],
        yMin: c.yMin,
        yMax: c.yMax,
        yMajorUnit: c.yMajorUnit,
        hideLegendIndices: c.hideLegendIndices ?? [],
        numFmt: c.numFmt,
      }));
      const relId = `rId${i + 1}`;
      drawingRels.push({ relId, chartTarget: `../charts/chart${idx}.xml` });
      drawingAnchors.push({ relId, anchor: c.anchor });
    }
    zip.file(drawingFile, buildDrawingXmlMulti(drawingAnchors));
    zip.file(drawingRelsFile, buildDrawingRelsXmlMulti(drawingRels));

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

    // Worksheet XML: insert <drawing r:id="..."/> at the correct
    // schema-mandated position. Per CT_Worksheet, `<drawing>` must
    // come AFTER pageSetup/headerFooter/etc. and BEFORE legacyDrawing
    // / picture / oleObjects / controls / webPublishItems /
    // tableParts / extLst at the worksheet top level. ExcelJS emits a
    // worksheet-level <extLst> when x14 conditional-formatting
    // features are used (data bars produce an inner extLst inside
    // <cfRule> AND a worksheet-level extLst for the
    // <x14:conditionalFormattings> block) — a naive "insert before
    // </worksheet>" puts <drawing> after that extLst, and a naive
    // "insert before first <extLst>" puts <drawing> *inside* the
    // dataBar cfRule. Excel rejects both → the entire sheet renders
    // blank.
    let sheetXml = await zip.file(sheetXmlPath).async('string');
    sheetXml = sheetXml.replace(/<drawing\s+[^/>]*\/>/g, '');
    const drawingTag = `<drawing r:id="rId${drawingRid}"/>`;

    const candidates = [];
    const wsExtLstCloseIdx = sheetXml.search(/<\/extLst>\s*<\/worksheet>/);
    if (wsExtLstCloseIdx !== -1) {
      const wsExtLstOpenIdx = sheetXml.lastIndexOf('<extLst>', wsExtLstCloseIdx);
      if (wsExtLstOpenIdx !== -1) candidates.push(wsExtLstOpenIdx);
    }
    for (const name of ['legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts']) {
      const re = new RegExp(`<${name}\\b`);
      const m = re.exec(sheetXml);
      if (m) candidates.push(m.index);
    }
    if (candidates.length > 0) {
      const insertAt = Math.min(...candidates);
      sheetXml = sheetXml.slice(0, insertAt) + drawingTag + sheetXml.slice(insertAt);
    } else {
      sheetXml = sheetXml.replace(/<\/worksheet>\s*$/, `${drawingTag}</worksheet>`);
    }
    zip.file(sheetXmlPath, sheetXml);

    // [Content_Types].xml: register chart + drawing overrides.
    let ctXml = await zip.file('[Content_Types].xml').async('string');
    const drawingOverride = `<Override PartName="/${drawingFile}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    const additions = [];
    for (const chartFile of chartFiles) {
      const chartOverride = `<Override PartName="/${chartFile}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
      if (!ctXml.includes(chartOverride)) additions.push(chartOverride);
    }
    if (!ctXml.includes(drawingOverride)) additions.push(drawingOverride);
    if (additions.length) {
      ctXml = ctXml.replace('</Types>', `${additions.join('')}</Types>`);
      zip.file('[Content_Types].xml', ctXml);
    }

    // DEFLATE, explicitly: JSZip's generateAsync defaults to STORE, so the
    // re-zip here was writing back every part the workbook already had —
    // all the per-site detail sheets included — uncompressed. An 8,300-site
    // Master Analysis came out of ExcelJS around 5 MB and left this
    // function at 100 MB+, over the save-to-company ceiling, on a workbook
    // whose only change was a few KB of chart XML.
    //
    // It is also the faster option, not a trade: parts loaded from the
    // incoming (deflated) zip and left untouched are passed straight
    // through as their existing compressed bytes when the output
    // compression matches, so asking for DEFLATE skips the inflate that
    // STORE forces on every part.
    return await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  } catch (err) {
    console.warn('injectLiveLineChart: falling back to chart-less workbook -', err);
    return buffer;
  }
}
