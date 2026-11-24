import { criteriaText, type CriteriaBlock, type CriteriaDoc } from './criteria.js';
import { zipWrite } from './zip-write.js';

/**
 * '채점 기준 안내문'을 HWPX(한글 문서, OWPML)로. 외부 부품·남의 서식 파일 없이 여기서 쓴 XML만 넣는다.
 * 한글에서 열어 고칠 문서라 꾸밈은 단순하게: 한글 기본 글꼴(함초롬바탕·함초롬돋움)을 이름으로만 쓰고 넣지 않는다.
 * 줄 배치 정보(linesegarray)는 두지 않는다: 한글이 열 때 다시 배치한다
 */

/** 길이 단위 HWPUNIT(1/7200인치). A4 210×297mm */
const MM = 7200 / 25.4;
const mm = (v: number): number => Math.round(v * MM);
const PAGE = { w: 59528, h: 84188, left: mm(15), right: mm(15), top: mm(16), bottom: mm(12), header: 0, footer: mm(8) };
const TEXT_W = PAGE.w - PAGE.left - PAGE.right;

/** header.xml의 글자 모양(charPr) 번호 */
const CH = { body: 0, title: 1, heading: 2, cell: 3, head: 4, note: 5, made: 6 } as const;
/** 문단 모양(paraPr) 번호 */
const PA = { body: 0, title: 1, heading: 2, cellLeft: 3, cellCenter: 4, note: 5, made: 6, list: 7 } as const;
/** 테두리·배경(borderFill) 번호: 1 없음, 2 표 칸, 3 머리 칸(옅은 배경) */
const BF = { none: 1, cell: 2, head: 3 } as const;

const NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';

/** XML 글·속성. XML 1.0에 넣을 수 없는 제어 문자는 버린다(내용 만들기가 이미 지우지만 한 번 더) */
export const escapeXml = (s: string): string =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'] as const;
const all = (v: number | string): string => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;

function fontfaces(): string {
  const fonts = '<hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_MYUNJO" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>'
    + '<hh:font id="1" face="함초롬돋움" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>';
  return `<hh:fontfaces itemCnt="${LANGS.length}">${LANGS.map(l => `<hh:fontface lang="${l}" fontCnt="2">${fonts}</hh:fontface>`).join('')}</hh:fontfaces>`;
}

function border(id: number, line: boolean, fill?: string): string {
  const b = (side: string) => `<hh:${side} type="${line ? 'SOLID' : 'NONE'}" width="0.12 mm" color="#7F8A9C"/>`;
  return `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">`
    + '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
    + `${b('leftBorder')}${b('rightBorder')}${b('topBorder')}${b('bottomBorder')}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>`
    + (fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : '')
    + '</hh:borderFill>';
}

/** 글자 모양: height는 1/100pt, font는 fontfaces의 번호(0 바탕, 1 돋움) */
function charPr(id: number, height: number, font: 0 | 1, bold: boolean, color = '#000000'): string {
  return `<hh:charPr id="${id}" height="${height}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${BF.none}">`
    + `<hh:fontRef ${all(font)}/><hh:ratio ${all(100)}/><hh:spacing ${all(0)}/><hh:relSz ${all(100)}/><hh:offset ${all(0)}/>`
    + (bold ? '<hh:bold/>' : '')
    + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>'
    + '</hh:charPr>';
}

/** 문단 모양: 간격은 HWPUNIT, 줄 간격은 글자 크기에 대한 %. keepWithNext: 다음 문단(제목 밑의 표)과 같은 쪽에 */
function paraPr(id: number, o: { align: 'JUSTIFY' | 'LEFT' | 'CENTER' | 'RIGHT'; line: number; prev?: number; next?: number; left?: number; indent?: number; keepWithNext?: boolean }): string {
  const m = (tag: string, v = 0) => `<hc:${tag} value="${v}" unit="HWPUNIT"/>`;
  return `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">`
    + `<hh:align horizontal="${o.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>`
    + `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${o.keepWithNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>`
    + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
    + `<hh:margin>${m('intent', o.indent ?? 0)}${m('left', o.left ?? 0)}${m('right')}${m('prev', o.prev ?? 0)}${m('next', o.next ?? 0)}</hh:margin>`
    + `<hh:lineSpacing type="PERCENT" value="${o.line}" unit="HWPUNIT"/>`
    + `<hh:border borderFillIDRef="${BF.none}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>`
    + '</hh:paraPr>';
}

function headerXml(): string {
  const chars = [charPr(CH.body, 1000, 0, false), charPr(CH.title, 1600, 1, true), charPr(CH.heading, 1200, 1, true), charPr(CH.cell, 950, 1, false),
    charPr(CH.head, 950, 1, true), charPr(CH.note, 900, 0, false, '#444444'), charPr(CH.made, 850, 0, false, '#666666')];
  const paras = [paraPr(PA.body, { align: 'JUSTIFY', line: 160, next: 400 }), paraPr(PA.title, { align: 'LEFT', line: 130, next: 600 }),
    paraPr(PA.heading, { align: 'LEFT', line: 130, prev: 1400, next: 500, keepWithNext: true }), paraPr(PA.cellLeft, { align: 'LEFT', line: 130 }),
    paraPr(PA.cellCenter, { align: 'CENTER', line: 130 }), paraPr(PA.note, { align: 'JUSTIFY', line: 150, prev: 300 }),
    paraPr(PA.made, { align: 'RIGHT', line: 130, prev: 1600 }), paraPr(PA.list, { align: 'JUSTIFY', line: 160, next: 200, left: 1000, indent: -1000 })];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
    + `<hh:head ${NS} version="1.4" secCnt="1">`
    + '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>'
    + `<hh:refList>${fontfaces()}`
    + `<hh:borderFills itemCnt="3">${border(BF.none, false)}${border(BF.cell, true)}${border(BF.head, true, '#E3E9F3')}</hh:borderFills>`
    + `<hh:charProperties itemCnt="${chars.length}">${chars.join('')}</hh:charProperties>`
    + '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>'
    + `<hh:paraProperties itemCnt="${paras.length}">${paras.join('')}</hh:paraProperties>`
    + `<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="${PA.body}" charPrIDRef="${CH.body}" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>`
    + '</hh:refList>'
    + '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>'
    + '</hh:head>';
}

const run = (ch: number, text: string): string => (text ? `<hp:run charPrIDRef="${ch}"><hp:t>${escapeXml(text)}</hp:t></hp:run>` : `<hp:run charPrIDRef="${ch}"/>`);
const para = (pa: number, ch: number, text: string, inner = ''): string => `<hp:p paraPrIDRef="${pa}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}${run(ch, text)}</hp:p>`;

/** 첫 문단에 붙는 구역 설정(용지·여백)과 쪽 번호(아래 가운데) */
function sectionStart(): string {
  const p = PAGE;
  return `<hp:run charPrIDRef="${CH.body}"><hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">`
    + '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
    + '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
    + `<hp:pagePr landscape="WIDELY" width="${p.w}" height="${p.h}" gutterType="LEFT_ONLY"><hp:margin header="${p.header}" footer="${p.footer}" gutter="0" left="${p.left}" right="${p.right}" top="${p.top}" bottom="${p.bottom}"/></hp:pagePr>`
    + '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
    + '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>'
    + '</hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run>'
    + `<hp:run charPrIDRef="${CH.body}"><hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl></hp:run>`;
}

/** 칸 안의 글: 줄마다 문단 하나 */
const cellParas = (text: string, pa: number, ch: number): string => text.split('\n').map(line => para(pa, ch, line)).join('');

/** 표 칸 하나. 높이는 최소값이고 한글이 글에 맞게 늘린다 */
function cell(text: string, col: number, row: number, width: number, head: boolean, center: boolean): string {
  const pa = head || center ? PA.cellCenter : PA.cellLeft;
  return `<hp:tc name="" header="${head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${head ? BF.head : BF.cell}">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${head ? 'CENTER' : 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + cellParas(text, pa, head ? CH.head : CH.cell)
    + `</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${ROW_H}"/>`
    + `<hp:cellMargin left="${IN.lr}" right="${IN.lr}" top="${IN.tb}" bottom="${IN.tb}"/></hp:tc>`;
}
const ROW_H = mm(7);
const IN = { lr: mm(1.8), tb: mm(1.2) };

/**
 * 표: 글자처럼 취급하지 않아야(treatAsChar 0) 쪽을 넘어 나뉜다. 나눔은 칸 단위(pageBreak CELL),
 * 머리 줄은 쪽마다 반복(repeatHeader + 머리 줄 칸의 header)
 */
function table(b: Extract<CriteriaBlock, { kind: 'table' }>, id: number): string {
  const widths = b.columns.map(c => Math.floor(c.width * TEXT_W));
  widths[widths.length - 1]! += TEXT_W - widths.reduce((s, w) => s + w, 0); // 반올림 나머지는 끝 칸에
  const rows = [b.columns.map(c => c.label), ...b.rows];
  const trs = rows.map((r, ri) => `<hp:tr>${r.map((v, ci) => cell(v, ci, ri, widths[ci]!, ri === 0, b.columns[ci]?.align === 'center')).join('')}</hp:tr>`).join('');
  const tbl = `<hp:tbl id="${id}" zOrder="${id}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="${b.columns.length}" cellSpacing="0" borderFillIDRef="${BF.none}" noAdjust="0">`
    + `<hp:sz width="${TEXT_W}" widthRelTo="ABSOLUTE" height="${ROW_H * rows.length}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + `<hp:outMargin left="0" right="0" top="0" bottom="${mm(1)}"/><hp:inMargin left="${IN.lr}" right="${IN.lr}" top="${IN.tb}" bottom="${IN.tb}"/>`
    + trs + '</hp:tbl>';
  return `<hp:p paraPrIDRef="${PA.cellLeft}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${CH.cell}">${tbl}<hp:t/></hp:run></hp:p>`;
}

export function sectionXml(doc: CriteriaDoc): string {
  const body: string[] = [para(PA.title, CH.title, doc.제목, sectionStart())];
  body.push(para(PA.body, CH.body, doc.머리.map(([k, v]) => `${k}: ${v}`).join('    ')));
  let tableId = 1;
  for (const b of doc.blocks) {
    if (b.kind === 'heading') body.push(para(PA.heading, CH.heading, b.text));
    else if (b.kind === 'note') body.push(...b.text.split('\n').map(l => para(PA.note, CH.note, l)));
    else if (b.kind === 'list') body.push(...b.items.map(i => para(PA.list, CH.body, `• ${i.replace(/\n/g, ' ')}`)));
    else body.push(table(b, tableId++));
  }
  body.push(para(PA.made, CH.made, doc.끝));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${body.join('')}</hs:sec>`;
}

function contentHpf(doc: CriteriaDoc): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
    + '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" version="" unique-identifier="" id="">'
    + `<opf:metadata><opf:title>${escapeXml(doc.제목)}</opf:title><opf:language>${doc.lang}</opf:language><opf:meta name="generator" content="text">Geulnun</opf:meta></opf:metadata>`
    + '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
    + '<opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>'
    + '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>';
}

const VERSION_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Geulnun" appVersion="1"/>';
const SETTINGS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>';
const CONTAINER_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>';
const MANIFEST_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

/** HWPX 파일 내용. 첫 항목은 압축하지 않은 mimetype */
export function criteriaHwpx(doc: CriteriaDoc, now = new Date()): Buffer {
  return zipWrite([
    { name: 'mimetype', data: 'application/hwp+zip', store: true },
    { name: 'version.xml', data: VERSION_XML },
    { name: 'Contents/header.xml', data: headerXml() },
    { name: 'Contents/section0.xml', data: sectionXml(doc) },
    { name: 'Preview/PrvText.txt', data: [...criteriaText(doc)].slice(0, 1000).join('') },
    { name: 'settings.xml', data: SETTINGS_XML },
    { name: 'Contents/content.hpf', data: contentHpf(doc) },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'META-INF/manifest.xml', data: MANIFEST_XML },
  ], now);
}
