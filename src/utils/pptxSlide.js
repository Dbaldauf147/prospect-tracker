// A one-slide widescreen PowerPoint file holding one picture, full slide.
//
// The picture goes in twice, the way PowerPoint itself saves an inserted
// SVG: the vector SVG, plus a PNG of it for anything that can't draw SVG
// (older PowerPoint, Keynote, Google Slides, the thumbnail). In current
// PowerPoint that makes the slide sharp at any zoom, and Graphics Format >
// Convert to Shape turns it into ordinary editable shapes and text boxes.
//
// A .pptx is a zip of XML parts. `pptxParts` builds them (pure, so it can be
// tested without a browser); `buildPicturePptx` zips them with JSZip, which
// the app already ships for its other exports.

// A widescreen slide, in EMU (914400 to the inch): 13.333in x 7.5in.
export const SLIDE_W = 12192000;
export const SLIDE_H = 6858000;

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rels = (items) => `${HEAD}<Relationships xmlns="${PKG_REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;

// Where a picture of imgW x imgH sits on the slide: as large as fits, centred.
// A 16:9 picture covers the slide exactly.
export function fitToSlide(imgW, imgH) {
  const w = Number(imgW) > 0 ? Number(imgW) : 16;
  const h = Number(imgH) > 0 ? Number(imgH) : 9;
  const scale = Math.min(SLIDE_W / w, SLIDE_H / h);
  const cx = Math.round(w * scale);
  const cy = Math.round(h * scale);
  return { x: Math.round((SLIDE_W - cx) / 2), y: Math.round((SLIDE_H - cy) / 2), cx, cy };
}

const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const COLOR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

// Schneider green leads the accent colours, so anything added to the slide
// in PowerPoint picks up the house palette.
const THEME = `${HEAD}<a:theme xmlns:a="${NS_A}" name="Schneider Electric"><a:themeElements>`
  + '<a:clrScheme name="Schneider Electric"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="475569"/></a:dk2><a:lt2><a:srgbClr val="F1F5F9"/></a:lt2>'
  + '<a:accent1><a:srgbClr val="3DCD58"/></a:accent1><a:accent2><a:srgbClr val="009530"/></a:accent2><a:accent3><a:srgbClr val="29ABE2"/></a:accent3><a:accent4><a:srgbClr val="1FA9A0"/></a:accent4><a:accent5><a:srgbClr val="5F5F5F"/></a:accent5><a:accent6><a:srgbClr val="E4002B"/></a:accent6>'
  + '<a:hlink><a:srgbClr val="009530"/></a:hlink><a:folHlink><a:srgbClr val="5F5F5F"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Schneider Electric"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
  + '</a:themeElements></a:theme>';

/**
 * The parts of the file, as { path: string | Uint8Array }.
 *   png          Uint8Array, the picture every program can draw
 *   svg          the same picture as SVG text; '' leaves it out
 *   imgW, imgH   the picture's proportions (any unit)
 *   title        the slide's name, and the picture's alt text
 */
export function pptxParts({ png, svg = '', imgW, imgH, title = 'Timeline' }) {
  if (!(png instanceof Uint8Array) || png.length === 0) throw new Error('No picture to put on the slide');
  const box = fitToSlide(imgW, imgH);
  const hasSvg = !!String(svg || '').trim();
  const name = xml(String(title || 'Timeline').trim() || 'Timeline');
  const svgExt = hasSvg
    ? '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId3"/></a:ext></a:extLst>'
    : '';
  const slide = `${HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld name="${name}"><p:spTree>${EMPTY_TREE}`
    + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="rId2">${svgExt}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  const parts = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
      + (hasSvg ? '<Default Extension="svg" ContentType="image/svg+xml"/>' : '')
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>',
    '_rels/.rels': rels([
      ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ]),
    'docProps/core.xml': `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${name}</dc:title><dc:creator>Prospect Tracker</dc:creator></cp:coreProperties>`,
    'ppt/presentation.xml': `${HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
      ['rId2', `${REL}/slide`, 'slides/slide1.xml'],
      ['rId3', `${REL}/theme`, 'theme/theme1.xml'],
    ]),
    'ppt/theme/theme1.xml': THEME,
    'ppt/slideMasters/slideMaster1.xml': `${HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>${COLOR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml': `${HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]),
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}/image`, '../media/image1.png'],
      ...(hasSvg ? [['rId3', `${REL}/image`, '../media/image2.svg']] : []),
    ]),
    'ppt/media/image1.png': png,
  };
  if (hasSvg) parts['ppt/media/image2.svg'] = String(svg);
  return parts;
}

/** The .pptx as a Uint8Array. `JSZip` is passed in so this file stays free of the import. */
export async function buildPicturePptx(JSZip, options) {
  const zip = new JSZip();
  const parts = pptxParts(options);
  // Files only, no folder entries, the way Office writes the package; the
  // content types part goes in first.
  for (const [path, body] of Object.entries(parts)) zip.file(path, body, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
