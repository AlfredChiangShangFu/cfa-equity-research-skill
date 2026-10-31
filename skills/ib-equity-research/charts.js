#!/usr/bin/env node
/**
 * 圖表資料檔（charts.json）驗證與 SVG 繪圖。
 *
 * 規格正本：docs/研究輸出格式.md 第七節「charts.json」。純 Node 內建，無第三方套件。
 * 介面（build.js 依賴，不可改）：REQUIRED_TYPES、validate(obj, {file})、render(obj)。
 *
 * CLI：
 *   node tools/charts.js validate <charts.json>
 *   node tools/charts.js fill-prices <charts.json>
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

const REQUIRED_TYPES = ['估值區間', '日K', '倍數河流', '營收利益率', '現金流', '同業散佈', '敏感度', '反向估值'];
const OPTIONAL_TYPES = ['柱線', '組成', '風險矩陣'];
const ALL_TYPES = new Set([...REQUIRED_TYPES, ...OPTIONAL_TYPES]);

const DEFAULT_LAYOUT = {
  '估值區間': '全寬',
  '日K': '全寬',
  '倍數河流': '全寬',
  '營收利益率': '半欄',
  '現金流': '半欄',
  '同業散佈': '全寬',
  '敏感度': '全寬',
  '反向估值': '全寬',
  '柱線': '半欄',
  '組成': '半欄',
  '風險矩陣': '全寬',
};

const FULL_WIDTH = 680;
const COMPOSITION_WIDTH = 240; // 組成圖與正文並排時佔約三分之一欄，原生寬度小才不會縮字
const HALF_WIDTH = 330;

const COLORS = {
  navy: '#0A2440',
  blue: '#123A63',
  brand: '#1B6AA8',
  paleBlue: '#C7D6E4',
  faint: '#F1F5F9',
  gridFaint: '#E4EAF0',
  gridAxis: '#D6DEE7',
  ink: '#10203A',
  body: '#24364F',
  muted: '#3C506B',
  red: '#A32A1D',
  green: '#17624A',
  white: '#FFFFFF',
  highlight: '#D7263D', // 現價線紅色、不螢光（issue 66 R30–R32）
};

const SENS_COLORS = ['#F1F5F9', '#E4EAF0', '#C7D6E4', '#9DB9D5', '#6F97C0'];
const RIVER_COLORS = ['#F1F5F9', '#E4EAF0', '#C7D6E4', '#BDD3E6'];
const BAR_GROUP_COLORS = [COLORS.paleBlue, COLORS.blue, COLORS.brand];
const LINE_COLORS = [COLORS.navy, COLORS.red];

const FONT_NUM = "'IBM Plex Sans','Noto Sans TC',sans-serif";
const FONT_LABEL = "'Noto Sans TC',sans-serif";

const FS_MIN = 10.5;
const FS_TICK = 11;
const FS_LABEL = 11;
const FS_ANNOT = 12;

const ID_RE = /^[A-Za-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 共用小工具
// ---------------------------------------------------------------------------

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}
function isNumOrNull(x) {
  return x === null || isNum(x);
}
function isDate(x) {
  if (typeof x !== 'string' || !DATE_RE.test(x)) return false;
  const d = new Date(x + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === x;
}
function isStr(x) {
  return typeof x === 'string' && x !== '';
}
function isBool(x) {
  return typeof x === 'boolean';
}
function isPlainObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isArr(x) {
  return Array.isArray(x);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 千分位數字格式化。decimals 為小數位數，四捨五入。 */
function fmtNum(n, decimals = 0) {
  if (!isNum(n)) return String(n);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + parts.join('.');
}

/** 智慧格式化：整數不顯示小數；否則四捨五入到小數 2 位並去尾零（29.60 → 29.6）。仍加千分位。 */
function fmtSmart(n) {
  if (!isNum(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return fmtNum(rounded, 0);
  const full = fmtNum(rounded, 2);
  const [ip, dp] = full.split('.');
  const trimmed = dp.replace(/0+$/, '');
  return trimmed ? `${ip}.${trimmed}` : ip;
}

/** 比率轉百分比顯示（0.191 → 19.1%）。資料標註固定 1 位小數。 */
function fmtPct(x, decimals = 1) {
  if (!isNum(x)) return String(x);
  return (x * 100).toFixed(decimals) + '%';
}

/** 百分比刻度：全為整數時不帶小數（0% 而非 0.0%），否則 1 位小數。僅供軸刻度使用。 */
function fmtPctTick(x) {
  if (!isNum(x)) return String(x);
  const v = Math.round(x * 1000) / 10; // 保留 1 位小數的精度
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + '%';
}

/** 依欄位單位慣例格式化刻度／標註（比率→%，倍→20x，其他→千分位）。 */
function fmtByUnit(x, unit) {
  if (unit === '比率') return fmtPctTick(x);
  if (unit === '倍') return fmtSmart(x) + 'x';
  return fmtSmart(x);
}

/** 「好看的」刻度間距：1 / 2 / 2.5 / 5 × 10^n。 */
function niceStep(rough) {
  if (rough <= 0 || !Number.isFinite(rough)) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = rough / Math.pow(10, exp);
  let niceBase;
  if (base < 1.5) niceBase = 1;
  else if (base < 2.25) niceBase = 2;
  else if (base < 3.75) niceBase = 2.5;
  else if (base < 7.5) niceBase = 5;
  else niceBase = 10;
  return niceBase * Math.pow(10, exp);
}

/** 產生涵蓋 [min,max] 的好看刻度陣列（含端點外的整齊刻度）。 */
function makeTicks(min, max, targetCount = 5) {
  let lo = min, hi = max;
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep((hi - lo) / targetCount);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round((v + Number.EPSILON) * 1e8) / 1e8);
  }
  return ticks;
}

/** 相對誤差容許的數字相等比較（預設容許 0.0005 = 0.05%），供收盤價一致性檢查使用。 */
function approxEqual(a, b, relTol = 0.0005) {
  if (!isNum(a) || !isNum(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale <= relTol;
}

function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = (domainMax - domainMin) || 1;
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

/** 均勻抽樣索引，最多 maxLabels 個，含頭尾。 */
function subsampleIndices(n, maxLabels = 8) {
  if (n <= 0) return [];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const idx = [];
  const step = (n - 1) / (maxLabels - 1);
  for (let k = 0; k < maxLabels; k++) idx.push(Math.round(k * step));
  return Array.from(new Set(idx)).sort((a, b) => a - b);
}

/** 粗略估計文字寬度（無 canvas 可量測）：CJK／全形字視為 1em，其餘（英數、半形符號）視為 0.6em。 */
function estimateTextWidth(str, fontSize = FS_TICK) {
  let w = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    const isWide = (code >= 0x2E80 && code <= 0x9FFF) || (code >= 0x3000 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF);
    w += isWide ? fontSize : fontSize * 0.6;
  }
  return w;
}

/**
 * 依文字寬度與可視邊界決定 anchor／繪製 x，確保文字整段留在 [minX,maxX] 內
 * （置中放不下就貼左緣 anchor=start，貼右緣就 anchor=end）。回傳同時附上
 * 實際佔用的 [left,right]，供呼叫端拿去做碰撞判斷（而非用置中假設的對稱寬度）。
 */
function anchorInBounds(x, w, minX, maxX) {
  if (x - w / 2 < minX) return { anchor: 'start', x: minX, left: minX, right: minX + w };
  if (x + w / 2 > maxX) return { anchor: 'end', x: maxX, left: maxX - w, right: maxX };
  return { anchor: 'middle', x, left: x - w / 2, right: x + w / 2 };
}

/**
 * 依字寬估算決定 x 軸類別標籤要顯示哪些索引：用該軸最寬的標籤估計需要的間距，
 * 換算成「每隔幾個類別標一個」，放不下就跳著標；一律保留首尾兩個索引。
 */
function pickCategoryLabelIndices(labels, bandW, fontSize = FS_TICK) {
  const n = labels.length;
  if (n <= 1) return Array.from({ length: n }, (_, i) => i);
  const maxWidth = Math.max(...labels.map((l) => estimateTextWidth(l, fontSize)));
  const minSpacing = maxWidth + 6;
  const step = Math.max(1, Math.ceil(minSpacing / bandW));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  const last = idx[idx.length - 1];
  if (last !== n - 1) {
    // 保留首尾：若最後一個已標的索引離真正的最後一格太近（放不下兩個標籤），
    // 直接把它換成最後一格，而不是兩個都標造成互疊。
    if ((n - 1 - last) * bandW < minSpacing) idx[idx.length - 1] = n - 1;
    else idx.push(n - 1);
  }
  return idx;
}

/**
 * 期間類 X 軸標籤：8 期以內每期都標，放不下時縮寫成賣方慣用寫法（FY2021→FY21、2026H1→1H26），
 * 縮寫後仍放不下或期數多才抽樣（issue 66 R73）。回傳 [{i, s}]。
 */
function periodAxisLabels(periods, bandW, fontSize = FS_TICK) {
  const strs = periods.map(String);
  // 數字字寬估 0.6em 偏寬（實際約 0.55em），留 2px 間距即可
  const fits = (arr) => arr.every((s) => estimateTextWidth(s, fontSize) <= bandW - 2);
  if (strs.length <= 8) {
    if (fits(strs)) return strs.map((s, i) => ({ i, s }));
    const short = strs.map((s) => s.replace(/^FY20(\d\d)/, 'FY$1').replace(/^20(\d\d)H([12])$/, '$2H$1').replace(/^20(\d\d)Q([1-4])$/, '$2Q$1'));
    if (fits(short)) return short.map((s, i) => ({ i, s }));
    // 再放不下就拿掉 FY，只留兩位年份（標題已寫明會計年度）
    const shorter = short.map((s) => s.replace(/^FY(\d\d)/, '$1'));
    if (fits(shorter)) return shorter.map((s, i) => ({ i, s }));
  }
  return pickCategoryLabelIndices(strs, bandW, fontSize).map((i) => ({ i, s: strs[i] }));
}

/**
 * 依索引序列的值把折線拆成多段座標點陣列：null／undefined／非數字視為斷點，
 * 斷點不畫線、也不畫點標值；斷點前後兩段各自獨立（不跨過斷點連線）。
 * @param {number} n 序列長度（沿用外層的期間數）
 * @param {(i:number)=>*} getVal 取得第 i 個原始值（可能是 null）
 * @param {(v:number,i:number)=>[number,number]} toXY 把有效值轉成 [x,y] 座標
 * @returns {Array<Array<[number,number]>>} 已拆好的多段座標點陣列
 */
function buildLineSegments(n, getVal, toXY) {
  const segs = [];
  let seg = [];
  for (let i = 0; i < n; i++) {
    const v = getVal(i);
    if (!isNum(v)) {
      if (seg.length) { segs.push(seg); seg = []; }
      continue;
    }
    seg.push(toXY(v, i));
  }
  if (seg.length) segs.push(seg);
  return segs;
}

/** 反向估值項目名的粗略換行（無 canvas 可量測，用字元數近似）。 */
function wrapLabel(str, maxCharsPerLine = 13) {
  if (!str || str.length <= maxCharsPerLine) return [str || ''];
  const breakChars = ['、', ' ', '（', '(', '，'];
  const mid = Math.ceil(str.length / 2);
  let bestIdx = -1;
  for (let i = Math.max(1, mid - 4); i <= Math.min(str.length - 1, mid + 4); i++) {
    if (breakChars.includes(str[i])) { bestIdx = i + 1; break; }
  }
  if (bestIdx === -1) bestIdx = mid;
  return [str.slice(0, bestIdx), str.slice(bestIdx)];
}

function text(x, y, str, opts = {}) {
  const {
    size = FS_LABEL, color = COLORS.body, family = FONT_LABEL,
    anchor = 'start', weight = null, transform = null,
  } = opts;
  const w = weight ? ` font-weight="${weight}"` : '';
  const t = transform ? ` transform="${transform}"` : '';
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${color}" text-anchor="${anchor}"${w}${t}>${esc(str)}</text>`;
}

function line(x1, y1, x2, y2, opts = {}) {
  const { color = COLORS.gridAxis, width = 1, dash = null } = opts;
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${d}/>`;
}

function rect(x, y, w, h, opts = {}) {
  const { fill = 'none', stroke = null, strokeWidth = 1, dash = null } = opts;
  const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : '';
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}"${s}${d}/>`;
}

function circle(cx, cy, r, opts = {}) {
  const { fill = COLORS.brand, stroke = null, strokeWidth = 1 } = opts;
  const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : '';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${s}/>`;
}

function polyline(points, opts = {}) {
  const { color = COLORS.navy, width = 1.5, dash = null, fill = 'none' } = opts;
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  const pts = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  return `<polyline points="${pts}" fill="${fill}" stroke="${color}" stroke-width="${width}"${d}/>`;
}

function polygon(points, opts = {}) {
  const { fill = COLORS.faint, fillOpacity = null } = opts;
  const fo = fillOpacity != null ? ` fill-opacity="${fillOpacity}"` : '';
  const pts = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  return `<polygon points="${pts}" fill="${fill}"${fo}/>`;
}

function upTriangle(cx, cy, size = 7, color = COLORS.navy) {
  const h = size, w = size * 1.1;
  return `<path d="M ${cx - w / 2} ${cy + h / 2} L ${cx + w / 2} ${cy + h / 2} L ${cx} ${cy - h / 2} Z" fill="${color}"/>`;
}
function downTriangle(cx, cy, size = 7, color = COLORS.navy) {
  const h = size, w = size * 1.1;
  return `<path d="M ${cx - w / 2} ${cy - h / 2} L ${cx + w / 2} ${cy - h / 2} L ${cx} ${cy + h / 2} Z" fill="${color}"/>`;
}
function rightTriangle(cx, cy, size = 6, color = COLORS.navy) {
  const h = size, w = size;
  return `<path d="M ${cx - w / 2} ${cy - h / 2} L ${cx - w / 2} ${cy + h / 2} L ${cx + w / 2} ${cy} Z" fill="${color}"/>`;
}

function svgOpen(width, height, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block;width:100%;max-width:${width}px;height:auto;margin-top:8px;" role="img" aria-label="${esc(title)}">`;
}
const SVG_CLOSE = '</svg>';

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/**
 * 驗證 charts.json 物件。
 * @param {object} obj 已解析的 charts.json 內容
 * @param {{file?: string}} opts file 為 charts.json 絕對路徑，給定時檢查同層 thesis.json
 * @returns {{errors: string[], warnings: string[]}}
 */
function validate(obj, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!isPlainObject(obj)) {
    err('charts.json 頂層必須是物件');
    return { errors, warnings };
  }

  // --- 頂層欄位 ---
  if (obj.版本 !== 1) err(`版本 不是 1（實際為 ${JSON.stringify(obj.版本)}）`);

  if (!isPlainObject(obj.標的)) {
    err('標的 缺少或型別錯誤');
  } else {
    if (!isStr(obj.標的.代號)) err('標的.代號 缺少或型別錯誤');
    if (!isStr(obj.標的.幣別)) err('標的.幣別 缺少或型別錯誤');
  }

  if (!isDate(obj.研究基準日)) err('研究基準日 缺少或日期格式錯誤');
  if (!('基準日收盤價' in obj) || !isNum(obj.基準日收盤價)) err('基準日收盤價 缺少或型別錯誤');

  if (!isArr(obj.圖) || obj.圖.length === 0) {
    err('圖 缺少或型別錯誤（必須是非空陣列）');
    return { errors, warnings };
  }

  // --- 同層 thesis.json 一致性 ---
  if (opts.file) {
    const dir = path.dirname(path.resolve(opts.file));
    const thesisPath = path.join(dir, 'thesis.json');
    if (fs.existsSync(thesisPath)) {
      try {
        const raw = fs.readFileSync(thesisPath, 'utf8');
        const thesisObj = JSON.parse(raw);
        const thesisDate = thesisObj && thesisObj.報告 ? thesisObj.報告.研究基準日 : undefined;
        const thesisPrice = thesisObj ? thesisObj.基準日收盤價 : undefined;
        if (thesisDate !== undefined && thesisDate !== obj.研究基準日) {
          err(`研究基準日與同層 thesis.json 不一致（charts.json ${JSON.stringify(obj.研究基準日)} vs thesis.json ${JSON.stringify(thesisDate)}）`);
        }
        if (thesisPrice !== undefined && thesisPrice !== obj.基準日收盤價) {
          err(`基準日收盤價與同層 thesis.json 不一致（charts.json ${JSON.stringify(obj.基準日收盤價)} vs thesis.json ${JSON.stringify(thesisPrice)}）`);
        }
      } catch (e) {
        err(`同層 thesis.json 無法讀取或解析（${e.message}）`);
      }
    }
  }

  // --- 逐圖驗證 ---
  const seenIds = new Set();
  const seenTypes = new Set();

  obj.圖.forEach((chart, idx) => {
    const idLabel = isStr(chart && chart.id) ? chart.id : `#${idx}`;
    const p = `圖[${idLabel}]`;

    if (!isPlainObject(chart)) { err(`${p}：不是物件`); return; }

    // id
    if (!isStr(chart.id)) {
      err(`${p}.id 缺少或型別錯誤`);
    } else {
      if (!ID_RE.test(chart.id)) err(`${p}.id 含英數與 - 以外的字元`);
      if (seenIds.has(chart.id)) err(`圖[${chart.id}]：id 重複`);
      seenIds.add(chart.id);
    }

    // 類型
    const type = chart.類型;
    if (!isStr(type)) {
      err(`${p}.類型 缺少或型別錯誤`);
      return;
    }
    if (!ALL_TYPES.has(type)) {
      err(`${p}.類型 不在允許的類型表中（實際為 ${JSON.stringify(type)}）`);
      return;
    }
    seenTypes.add(type);

    // 共用欄位
    if (!isStr(chart.標題)) err(`${p}.標題 缺少或型別錯誤`);
    if (!isStr(chart.章節)) err(`${p}.章節 缺少或型別錯誤`);
    if ('錨點' in chart && chart.錨點 !== null && chart.錨點 !== undefined && !isStr(chart.錨點)) {
      err(`${p}.錨點 型別錯誤（須為字串或省略）`);
    }
    if ('版面' in chart && chart.版面 !== null && chart.版面 !== '全寬' && chart.版面 !== '半欄') {
      err(`${p}.版面 必須是 全寬、半欄 或 null`);
    }
    if (!isStr(chart.單位)) err(`${p}.單位 缺少或型別錯誤`);
    if (!isStr(chart.口徑)) err(`${p}.口徑 缺少或型別錯誤`);
    if (!isStr(chart.來源)) err(`${p}.來源 缺少或型別錯誤`);

    if (!isPlainObject(chart.資料)) {
      err(`${p}.資料 缺少或型別錯誤`);
      return;
    }

    validateChartData(type, chart.資料, p, obj, err, warn);
  });

  REQUIRED_TYPES.forEach((t) => {
    if (!seenTypes.has(t)) err(`缺少必有類型：${t}`);
  });

  return { errors, warnings };
}

/** 依類型分派到各類型專屬的 資料 驗證。 */
function validateChartData(type, data, p, obj, err, warn) {
  switch (type) {
    case '估值區間': return validateValuationRange(data, p, err, warn);
    case '日K': return validateKline(data, p, obj, err, warn);
    case '倍數河流': return validateMultipleRiver(data, p, obj, err, warn);
    case '營收利益率': return validateRevenueMargin(data, p, err, warn);
    case '現金流': return validateCashFlow(data, p, err, warn);
    case '同業散佈': return validatePeerScatter(data, p, err, warn);
    case '敏感度': return validateSensitivity(data, p, err, warn);
    case '反向估值': return validateReverseValuation(data, p, err, warn);
    case '柱線': return validateBarLine(data, p, err, warn);
    case '組成': return validateComposition(data, p, err, warn);
    case '風險矩陣': return validateRiskMatrix(data, p, err, warn);
    default: return;
  }
}

function validateValuationRange(data, p, err, warn) {
  if (!isArr(data.列) || data.列.length === 0) { err(`${p}.資料.列 缺少或型別錯誤（須為非空陣列）`); return; }
  data.列.forEach((row, i) => {
    const rp = `${p}.資料.列[${i}]`;
    if (!isPlainObject(row)) { err(`${rp}：不是物件`); return; }
    if (!isStr(row.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
    if (!isNum(row.下緣)) err(`${rp}.下緣 缺少或型別錯誤`);
    if (!isNum(row.上緣)) err(`${rp}.上緣 缺少或型別錯誤`);
    if (!('中值' in row) || !isNumOrNull(row.中值)) err(`${rp}.中值 型別錯誤（須為數字或 null）`);
    if (isNum(row.下緣) && isNum(row.上緣)) {
      if (row.下緣 > row.上緣) err(`${rp}：下緣大於上緣`);
      if (isNum(row.中值) && (row.中值 < Math.min(row.下緣, row.上緣) || row.中值 > Math.max(row.下緣, row.上緣))) {
        err(`${rp}：中值落在區間外`);
      }
    }
  });
  if ('參考線' in data) {
    if (!isArr(data.參考線)) { err(`${p}.資料.參考線 型別錯誤（須為陣列）`); }
    else data.參考線.forEach((r, i) => {
      const rp = `${p}.資料.參考線[${i}]`;
      if (!isPlainObject(r)) { err(`${rp}：不是物件`); return; }
      if (!isStr(r.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (!isNum(r.值)) err(`${rp}.值 缺少或型別錯誤`);
    });
  }
}

function validateKline(data, p, obj, err, warn) {
  if (!isDate(data.顯示起日)) err(`${p}.資料.顯示起日 缺少或日期格式錯誤`);
  if (!isArr(data.均線) || data.均線.some((m) => !Number.isInteger(m) || m <= 0)) {
    err(`${p}.資料.均線 缺少或型別錯誤（須為正整數陣列）`);
  }
  if (!isArr(data.K線) || data.K線.length === 0) {
    err(`${p}.資料.K線 缺少或型別錯誤（須為非空陣列）`);
  } else {
    let prevDate = null;
    data.K線.forEach((row, i) => {
      const rp = `${p}.資料.K線[${i}]`;
      if (!isArr(row) || (row.length !== 5 && row.length !== 6)) { err(`${rp}：型別錯誤（須為 [日期,開,高,低,收] 或 [日期,開,高,低,收,量]）`); return; }
      const [d, o, h, l, c] = row;
      if (!isDate(d)) { err(`${rp}：日期格式錯誤`); return; }
      if (![o, h, l, c].every(isNum)) { err(`${rp}：開高低收須為數字`); return; }
      if (row.length === 6 && !(isNum(row[5]) && row[5] >= 0)) err(`${rp}：成交量須為非負數字`);
      if (prevDate !== null && !(d > prevDate)) err(`${rp}：日期未遞增`);
      prevDate = d;
      if (h < Math.max(o, c)) err(`${rp}：高 < max(開,收)`);
      if (l > Math.min(o, c)) err(`${rp}：低 > min(開,收)`);
    });
    const lastRow = data.K線[data.K線.length - 1];
    if (isArr(lastRow) && isDate(lastRow[0]) && lastRow[0] !== obj.研究基準日) {
      err(`${p}.資料.K線：最後一筆不是研究基準日（實際為 ${lastRow[0]}，研究基準日 ${obj.研究基準日}）`);
    }
    if (isArr(lastRow) && isNum(lastRow[4]) && isNum(obj.基準日收盤價) && !approxEqual(lastRow[4], obj.基準日收盤價)) {
      err(`${p}.資料.K線：最後一筆收盤（${lastRow[4]}）與基準日收盤價（${obj.基準日收盤價}）不一致`);
    }
    if (isDate(data.顯示起日) && isArr(data.均線) && data.均線.length) {
      const maxMa = Math.max(...data.均線.filter((m) => Number.isInteger(m) && m > 0));
      const beforeCount = data.K線.filter((row) => isArr(row) && isDate(row[0]) && row[0] < data.顯示起日).length;
      if (Number.isFinite(maxMa) && beforeCount < maxMa) {
        warn(`${p}.資料：顯示起日之前的 K 棒（${beforeCount} 根）少於最長均線天數（${maxMa} 天）`);
      }
    }
  }
  if ('關鍵價位' in data) {
    if (!isArr(data.關鍵價位)) { err(`${p}.資料.關鍵價位 型別錯誤（須為陣列）`); }
    else data.關鍵價位.forEach((k, i) => {
      const rp = `${p}.資料.關鍵價位[${i}]`;
      if (!isPlainObject(k)) { err(`${rp}：不是物件`); return; }
      if (!isStr(k.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (!isNum(k.價格)) err(`${rp}.價格 缺少或型別錯誤`);
    });
  }
  if ('事件' in data && data.事件 != null) {
    if (!isArr(data.事件)) { err(`${p}.資料.事件 型別錯誤（須為陣列）`); }
    else data.事件.forEach((ev, i) => {
      const rp = `${p}.資料.事件[${i}]`;
      if (!isPlainObject(ev)) { err(`${rp}：不是物件`); return; }
      if (!isDate(ev.日期)) err(`${rp}.日期 缺少或日期格式錯誤`);
      if (!isStr(ev.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (isDate(ev.日期) && isDate(data.顯示起日) && ev.日期 < data.顯示起日) warn(`${rp}：日期早於顯示起日，不會畫出`);
    });
  }
  if (isArr(data.關鍵價位)) {
    data.關鍵價位.forEach((k, i) => {
      if (isPlainObject(k) && '右標' in k && typeof k.右標 !== 'boolean') err(`${p}.資料.關鍵價位[${i}].右標 型別錯誤（須為 true／false）`);
    });
    const storyMode = data.關鍵價位.some((k) => isPlainObject(k) && k.右標 === true) || (isArr(data.價位區) && data.價位區.length > 0);
    const hidden = data.關鍵價位.filter((k) => isPlainObject(k) && k.右標 !== true).map((k) => k.名稱);
    if (storyMode && hidden.length) warn(`${p}.資料.關鍵價位：${hidden.join('、')} 未標右標，圖上不畫，價位應寫進價位區名稱`);
  }
  if ('分段' in data && data.分段 != null) {
    if (!isArr(data.分段)) { err(`${p}.資料.分段 型別錯誤（須為陣列）`); }
    else {
      let prevEnd = null;
      data.分段.forEach((s, i) => {
        const rp = `${p}.資料.分段[${i}]`;
        if (!isPlainObject(s)) { err(`${rp}：不是物件`); return; }
        if (!isDate(s.起日) || !isDate(s.迄日)) { err(`${rp}.起日／迄日 缺少或日期格式錯誤`); return; }
        if (s.起日 > s.迄日) err(`${rp}：起日晚於迄日`);
        if (prevEnd !== null && s.起日 <= prevEnd) err(`${rp}：與前一段重疊或未依時間排序`);
        prevEnd = s.迄日;
        if (!isStr(s.標題)) err(`${rp}.標題 缺少或型別錯誤`);
        else if (s.標題.length > 10) warn(`${rp}.標題 超過 10 字，窄段可能放不下`);
      });
    }
  }
  if ('價位區' in data && data.價位區 != null) {
    if (!isArr(data.價位區)) { err(`${p}.資料.價位區 型別錯誤（須為陣列）`); }
    else data.價位區.forEach((z, i) => {
      const rp = `${p}.資料.價位區[${i}]`;
      if (!isPlainObject(z)) { err(`${rp}：不是物件`); return; }
      if (!isStr(z.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (!isNum(z.下緣) && !isNum(z.上緣)) err(`${rp}：下緣與上緣至少要有一個數字`);
      if (isNum(z.下緣) && isNum(z.上緣) && z.下緣 >= z.上緣) err(`${rp}：下緣須小於上緣`);
      if (!['暖', '中性', '冷'].includes(z.色調)) err(`${rp}.色調 須為 暖／中性／冷`);
    });
  }
}

function validateMultipleRiver(data, p, obj, err, warn) {
  if (!isStr(data.倍數名稱)) err(`${p}.資料.倍數名稱 缺少或型別錯誤`);
  if (!isArr(data.倍數帶) || data.倍數帶.length === 0 || !data.倍數帶.every(isNum)) {
    err(`${p}.資料.倍數帶 缺少或型別錯誤（須為非空數字陣列）`);
  } else {
    for (let i = 1; i < data.倍數帶.length; i++) {
      if (!(data.倍數帶[i] > data.倍數帶[i - 1])) { err(`${p}.資料.倍數帶：未遞增`); break; }
    }
  }
  if (!isArr(data.每股指標) || data.每股指標.length === 0) {
    err(`${p}.資料.每股指標 缺少或型別錯誤（須為非空陣列）`);
  } else {
    data.每股指標.forEach((row, i) => {
      const rp = `${p}.資料.每股指標[${i}]`;
      if (!isArr(row) || row.length !== 2 || !isDate(row[0]) || !isNum(row[1])) {
        err(`${rp}：型別錯誤（須為 [日期,數字]）`);
      }
    });
  }
  // 「auto」或空陣列代表尚未跑 fill-prices，現在一律視為錯誤（不再是合法的中繼狀態）。
  if (data.價格 === 'auto' || (isArr(data.價格) && data.價格.length === 0)) {
    err(`${p}.資料.價格 尚未填值（"auto" 或空陣列），請先執行 node tools/charts.js fill-prices`);
  } else if (!isArr(data.價格) || !data.價格.every((row) => isArr(row) && row.length === 2 && isDate(row[0]) && isNum(row[1]))) {
    err(`${p}.資料.價格 型別錯誤（須為非空的 [日期,數字] 陣列）`);
  } else {
    const last = data.價格[data.價格.length - 1];
    if (isDate(obj.研究基準日) && last[0] > obj.研究基準日) {
      err(`${p}.資料.價格：最後一筆日期（${last[0]}）晚於研究基準日（${obj.研究基準日}）`);
    }
    if (isNum(obj.基準日收盤價) && !approxEqual(last[1], obj.基準日收盤價)) {
      err(`${p}.資料.價格：最後一筆收盤（${last[1]}）與基準日收盤價（${obj.基準日收盤價}）不一致`);
    }
  }
}

function validateRevenueMargin(data, p, err, warn) {
  if (!isArr(data.期間) || data.期間.length === 0) { err(`${p}.資料.期間 缺少或型別錯誤（須為非空陣列）`); return; }
  data.期間.forEach((row, i) => {
    const rp = `${p}.資料.期間[${i}]`;
    if (!isPlainObject(row)) { err(`${rp}：不是物件`); return; }
    if (!isStr(row.期間)) err(`${rp}.期間 缺少或型別錯誤`);
    if (!isNumOrNull(row.營收)) err(`${rp}.營收 型別錯誤`);
    if (!isNumOrNull(row.營業利益率)) err(`${rp}.營業利益率 型別錯誤`);
    if ('毛利率' in row && !isNumOrNull(row.毛利率)) err(`${rp}.毛利率 型別錯誤`);
    if (!isBool(row.預估)) err(`${rp}.預估 缺少或型別錯誤`);
  });
}

function validateCashFlow(data, p, err, warn) {
  if (!isArr(data.期間) || data.期間.length === 0) { err(`${p}.資料.期間 缺少或型別錯誤（須為非空陣列）`); return; }
  data.期間.forEach((row, i) => {
    const rp = `${p}.資料.期間[${i}]`;
    if (!isPlainObject(row)) { err(`${rp}：不是物件`); return; }
    if (!isStr(row.期間)) err(`${rp}.期間 缺少或型別錯誤`);
    if (!isNumOrNull(row.營業現金流)) err(`${rp}.營業現金流 型別錯誤`);
    if (!isNumOrNull(row.資本支出)) err(`${rp}.資本支出 型別錯誤`);
    if (!isNumOrNull(row.自由現金流)) err(`${rp}.自由現金流 型別錯誤`);
    if (!isBool(row.預估)) err(`${rp}.預估 缺少或型別錯誤`);
    if (isNum(row.營業現金流) && isNum(row.資本支出) && isNum(row.自由現金流)) {
      const implied = row.營業現金流 - row.資本支出;
      const base = Math.max(Math.abs(implied), 1e-9);
      if (Math.abs(row.自由現金流 - implied) / base > 0.01) {
        warn(`${rp}：自由現金流與「營業現金流 − 資本支出」相差超過 1%`);
      }
    }
  });
}

function validatePeerScatter(data, p, err, warn) {
  if (!isStr(data.x軸)) err(`${p}.資料.x軸 缺少或型別錯誤`);
  if (!isStr(data.x單位)) err(`${p}.資料.x單位 缺少或型別錯誤`);
  if (!isStr(data.y軸)) err(`${p}.資料.y軸 缺少或型別錯誤`);
  if (!isStr(data.y單位)) err(`${p}.資料.y單位 缺少或型別錯誤`);
  if ('y上限' in data && !isNum(data.y上限)) err(`${p}.資料.y上限 型別錯誤（須為數字）`);
  if (!isArr(data.點) || data.點.length === 0) { err(`${p}.資料.點 缺少或型別錯誤（須為非空陣列）`); return; }
  let benchCount = 0;
  data.點.forEach((pt, i) => {
    const rp = `${p}.資料.點[${i}]`;
    if (!isPlainObject(pt)) { err(`${rp}：不是物件`); return; }
    if (!isStr(pt.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
    if (!isNum(pt.x)) err(`${rp}.x 缺少或型別錯誤`);
    if (!isNum(pt.y)) err(`${rp}.y 缺少或型別錯誤`);
    if ('y區間' in pt && pt.y區間 != null) {
      if (!isArr(pt.y區間) || pt.y區間.length !== 2 || !pt.y區間.every(isNum)) {
        err(`${rp}.y區間 型別錯誤（須為 [數字,數字]）`);
      }
    }
    if (pt.本標的 === true) benchCount++;
  });
  if (benchCount !== 1) err(`${p}.資料.點：本標的 必須恰好一點（實際 ${benchCount} 點）`);
}

function validateSensitivity(data, p, err, warn) {
  if (!isStr(data.列名)) err(`${p}.資料.列名 缺少或型別錯誤`);
  if (!isStr(data.欄名)) err(`${p}.資料.欄名 缺少或型別錯誤`);
  if (!isArr(data.列) || data.列.length === 0 || !data.列.every(isStr)) {
    err(`${p}.資料.列 缺少或型別錯誤（須為非空字串陣列）`);
  }
  if (!isArr(data.欄) || data.欄.length === 0 || !data.欄.every(isStr)) {
    err(`${p}.資料.欄 缺少或型別錯誤（須為非空字串陣列）`);
  }
  const rows = isArr(data.列) ? data.列.length : 0;
  const cols = isArr(data.欄) ? data.欄.length : 0;
  if (!isArr(data.值)) {
    err(`${p}.資料.值 缺少或型別錯誤（須為二維陣列）`);
  } else if (rows && cols) {
    const dimOk = data.值.length === rows && data.值.every((r) => isArr(r) && r.length === cols && r.every(isNum));
    if (!dimOk) err(`${p}.資料.值：維度不符（須為 ${rows} × ${cols}）`);
  }
  if ('主情境' in data && data.主情境 !== null) {
    if (!isArr(data.主情境) || data.主情境.length !== 2 || !data.主情境.every((v) => Number.isInteger(v))) {
      err(`${p}.資料.主情境 型別錯誤（須為 [列索引,欄索引] 或 null）`);
    } else {
      const [ri, ci] = data.主情境;
      if (ri < 0 || ri >= rows || ci < 0 || ci >= cols) err(`${p}.資料.主情境：越界（${ri},${ci}）`);
    }
  } else {
    warn(`${p}.資料：無主情境`);
  }
}

function validateReverseValuation(data, p, err, warn) {
  if (!isArr(data.列) || data.列.length === 0) { err(`${p}.資料.列 缺少或型別錯誤（須為非空陣列）`); return; }
  data.列.forEach((row, i) => {
    const rp = `${p}.資料.列[${i}]`;
    if (!isPlainObject(row)) { err(`${rp}：不是物件`); return; }
    if (!isStr(row.項目)) err(`${rp}.項目 缺少或型別錯誤`);
    if (!isStr(row.單位)) err(`${rp}.單位 缺少或型別錯誤`);
    if (!isNum(row.市場隱含)) err(`${rp}.市場隱含 缺少或型別錯誤`);
    if (!isBool(row.隱含為下限)) err(`${rp}.隱含為下限 缺少或型別錯誤`);
    if (!isNum(row.本報告)) err(`${rp}.本報告 缺少或型別錯誤`);
    if ('對照' in row && row.對照 != null) {
      if (!isArr(row.對照)) { err(`${rp}.對照 型別錯誤（須為陣列）`); }
      else row.對照.forEach((c, j) => {
        const cp = `${rp}.對照[${j}]`;
        if (!isPlainObject(c)) { err(`${cp}：不是物件`); return; }
        if (!isStr(c.名稱)) err(`${cp}.名稱 缺少或型別錯誤`);
        if (!isNum(c.值)) err(`${cp}.值 缺少或型別錯誤`);
      });
    }
  });
}

function validateBarLine(data, p, err, warn) {
  if (!isArr(data.期間) || data.期間.length === 0 || !data.期間.every(isStr)) {
    err(`${p}.資料.期間 缺少或型別錯誤（須為非空字串陣列）`);
    return;
  }
  const n = data.期間.length;
  if ('預估' in data && data.預估 != null) {
    if (!isArr(data.預估) || data.預估.length !== n || !data.預估.every(isBool)) {
      err(`${p}.資料.預估：長度與期間數不符或型別錯誤`);
    }
  }
  if (!isArr(data.柱) || data.柱.length === 0) {
    err(`${p}.資料.柱 缺少或型別錯誤（須為非空陣列）`);
  } else {
    data.柱.forEach((b, i) => {
      const rp = `${p}.資料.柱[${i}]`;
      if (!isPlainObject(b)) { err(`${rp}：不是物件`); return; }
      if (!isStr(b.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (!isArr(b.值) || b.值.length !== n || !b.值.every(isNumOrNull)) {
        err(`${rp}.值：長度與期間數不符或型別錯誤`);
      }
    });
  }
  if ('線' in data && data.線 != null) {
    if (!isArr(data.線)) { err(`${p}.資料.線 型別錯誤（須為陣列）`); }
    else data.線.forEach((l, i) => {
      const rp = `${p}.資料.線[${i}]`;
      if (!isPlainObject(l)) { err(`${rp}：不是物件`); return; }
      if (!isStr(l.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
      if (!isStr(l.單位)) err(`${rp}.單位 缺少或型別錯誤`);
      if (!isArr(l.值) || l.值.length !== n || !l.值.every(isNumOrNull)) {
        err(`${rp}.值：長度與期間數不符或型別錯誤`);
      }
    });
  }
  if (!isStr(data.左軸單位)) err(`${p}.資料.左軸單位 缺少或型別錯誤`);
}

// 風險矩陣：機率（橫軸，低到高）× 衝擊（縱軸，低到高），項目依兩個等級落格（issue 66 R83）
function validateRiskMatrix(data, p, err, warn) {
  ['機率', '衝擊'].forEach((k) => {
    if (!isArr(data[k]) || data[k].length < 2 || !data[k].every(isStr)) err(`${p}.資料.${k} 缺少或型別錯誤（須為至少兩個等級字串，由低到高）`);
  });
  if (!isArr(data.項目) || data.項目.length === 0) { err(`${p}.資料.項目 缺少或型別錯誤（須為非空陣列）`); return; }
  data.項目.forEach((it, i) => {
    const rp = `${p}.資料.項目[${i}]`;
    if (!isPlainObject(it)) { err(`${rp}：不是物件`); return; }
    if (!isStr(it.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
    if (it.簡稱 !== undefined && !isStr(it.簡稱)) err(`${rp}.簡稱 型別錯誤（須為字串）`);
    if (it.編號 !== undefined && !isStr(it.編號)) err(`${rp}.編號 型別錯誤（須為字串，例如 R1）`);
    if (it.說明 !== undefined && !isStr(it.說明)) err(`${rp}.說明 型別錯誤（須為字串）`);
    if (isArr(data.機率) && !data.機率.includes(it.機率)) err(`${rp}.機率「${it.機率}」不在 資料.機率 等級內`);
    if (isArr(data.衝擊) && !data.衝擊.includes(it.衝擊)) err(`${rp}.衝擊「${it.衝擊}」不在 資料.衝擊 等級內`);
  });
}

function validateComposition(data, p, err, warn) {
  if (!isStr(data.期間)) err(`${p}.資料.期間 缺少或型別錯誤（須為字串）`);
  if (!isArr(data.項目) || data.項目.length < 2) {
    err(`${p}.資料.項目 缺少或型別錯誤（須為至少兩項的陣列）`);
    return;
  }
  data.項目.forEach((it, i) => {
    const rp = `${p}.資料.項目[${i}]`;
    if (!isPlainObject(it)) { err(`${rp}：不是物件`); return; }
    if (!isStr(it.名稱)) err(`${rp}.名稱 缺少或型別錯誤`);
    if (!isNum(it.值) || it.值 < 0) err(`${rp}.值 缺少或為負數`);
  });
  const sum = data.項目.reduce((a, it) => a + (isNum(it && it.值) ? it.值 : 0), 0);
  if (sum <= 0) err(`${p}.資料.項目 合計須大於 0`);
  else if (Math.abs(sum - 1) > 0.05) warn(`${p}.資料.項目 合計 ${fmtNum(sum, 2)}，以比率解讀時與 1 差距超過 5%，繪圖時按合計正規化`);
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function chartHeight(type, data, width = FULL_WIDTH) {
  switch (type) {
    case '估值區間': return (isArr(data.列) ? data.列.length : 1) * 34 + 70;
    case '日K': return 320;
    case '倍數河流': return 290;
    case '敏感度': return (isArr(data.列) ? data.列.length : 1) * 30 + 40;
    case '反向估值': return (isArr(data.列) ? data.列.length : 1) * 58 + 30;
    case '營收利益率':
    case '現金流':
    case '柱線':
      return 230;
    case '組成': return 150 + (isArr(data.項目) ? data.項目.length : 2) * 24;
    case '風險矩陣': return riskMatrixLayout(data, width).height;
    case '同業散佈':
      // 規格未給固定高度（全寬散佈圖），取可容納軸標題與標籤錯開的高度。
      return 400;
    default:
      return 230;
  }
}

/**
 * 依 obj.圖 順序畫出每張圖的 SVG。呼叫前不自行 validate，呼叫端負責。
 * @param {object} obj charts.json 內容
 * @returns {Array<object>} [{id,類型,標題,章節,錨點,版面,口徑,來源,svg}]
 */
function render(obj) {
  return obj.圖.map((chart) => {
    const layout = chart.版面 || DEFAULT_LAYOUT[chart.類型] || '全寬';
    const width = chart.類型 === '組成' ? COMPOSITION_WIDTH : layout === '半欄' ? HALF_WIDTH : FULL_WIDTH;
    const height = chartHeight(chart.類型, chart.資料, width);
    let svg;
    switch (chart.類型) {
      case '估值區間': svg = renderValuationRange(chart, obj, width, height); break;
      case '日K': svg = renderKline(chart, obj, width, height); break;
      case '倍數河流': svg = renderMultipleRiver(chart, obj, width, height); break;
      case '營收利益率': svg = renderRevenueMargin(chart, obj, width, height); break;
      case '現金流': svg = renderCashFlow(chart, obj, width, height); break;
      case '同業散佈': svg = renderPeerScatter(chart, obj, width, height); break;
      case '敏感度': svg = renderSensitivity(chart, obj, width, height); break;
      case '反向估值': svg = renderReverseValuation(chart, obj, width, height); break;
      case '柱線': svg = renderBarLine(chart, obj, width, height); break;
      case '組成': svg = renderComposition(chart, obj, width, height); break;
      case '風險矩陣': svg = renderRiskMatrix(chart, obj, width, height); break;
      default: throw new Error(`render：未知類型 ${chart.類型}`);
    }
    return {
      id: chart.id,
      類型: chart.類型,
      標題: chart.標題,
      章節: chart.章節,
      錨點: chart.錨點 !== undefined && chart.錨點 !== null ? chart.錨點 : null,
      版面: layout,
      單位: chart.單位,
      口徑: chart.口徑,
      來源: chart.來源,
      來源簡稱: isStr(chart.來源簡稱) ? chart.來源簡稱 : null,
      圖例: chart.類型 === '日K' && isArr(chart.資料.均線) ? chart.資料.均線.map((p) => ({ 名稱: `${p} 日均線`, 色: klineMaColor(p) })) : [],
      svg,
    };
  });
}

// --- 1. 估值區間 ---
function renderValuationRange(chart, obj, width, height) {
  const data = chart.資料;
  const rows = data.列;
  const refLines = isArr(data.參考線) ? data.參考線 : [];
  const basePrice = obj.基準日收盤價;

  const nameColW = 150;
  const rightMargin = 60;
  const plotLeft = nameColW;
  const plotRight = width - rightMargin;
  const rowH = 34;
  const bottomMargin = 30;

  const values = [];
  rows.forEach((r) => { values.push(r.下緣, r.上緣); if (isNum(r.中值)) values.push(r.中值); });
  values.push(basePrice);
  refLines.forEach((r) => values.push(r.值));
  let domainMin = Math.min(...values);
  let domainMax = Math.max(...values);
  const pad = (domainMax - domainMin) * 0.05 || Math.abs(domainMax) * 0.05 || 1;
  domainMin -= pad;
  domainMax += pad;
  const sx = scaleLinear(domainMin, domainMax, plotLeft, plotRight);
  const xBase = sx(basePrice);

  // 頂端標籤：基準日收盤價與各參考線一起做碰撞排開（依 x 區間重疊判斷，不是各自獨立），
  // 層距 ≥13px；貨架式排放，同一層放不下（實際渲染後的區間重疊）就疊到上一層。
  // 靠邊界時用 anchorInBounds 切換 anchor，任何標籤都不能被 viewBox 裁掉。
  const viewMinX = 4, viewMaxX = width - 4;
  const shelfH = 13;
  const baseText = `基準日收盤價 ${fmtSmart(basePrice)}`;
  const topItems = [
    { text: baseText, x: xBase, w: estimateTextWidth(baseText, FS_ANNOT), size: FS_ANNOT, color: COLORS.red, weight: 'bold' },
    ...refLines.map((r) => {
      const t = `${r.名稱} ${fmtSmart(r.值)}`;
      return { text: t, x: sx(r.值), w: estimateTextWidth(t, FS_TICK), size: FS_TICK, color: COLORS.navy, weight: null };
    }),
  ];
  topItems.sort((a, b) => a.x - b.x);
  const shelves = []; // { left, right, level }
  topItems.forEach((item) => {
    const pos = anchorInBounds(item.x, item.w, viewMinX, viewMaxX);
    let lvl = 0;
    // eslint-disable-next-line no-loop-func
    while (shelves.some((s) => s.level === lvl && !(pos.right < s.left - 4 || pos.left > s.right + 4))) lvl++;
    shelves.push({ left: pos.left, right: pos.right, level: lvl });
    item.pos = pos;
    item.level = lvl;
  });
  const maxLevel = Math.max(0, ...topItems.map((i) => i.level));

  // 所需層數決定 plot 上緣留白：層數越多，圖高隨之增加，確保任何標籤都不會被 viewBox 裁掉。
  const topMargin = 40 + maxLevel * shelfH;
  const plotTop = topMargin;
  const plotBottom = topMargin + rows.length * rowH;
  height = topMargin + rows.length * rowH + bottomMargin;

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  // 參考線與基準日收盤價的「豎線」先畫（在最底層），列的橫條與中值標籤之後才畫在上面，
  // 這樣文字才不會被豎線從中間切過；頂端的文字標籤留到最後一起畫（層級已排好）。
  parts.push(line(xBase, plotTop, xBase, plotBottom, { color: COLORS.red, width: 1.5 }));
  refLines.forEach((r) => {
    const x = sx(r.值);
    parts.push(line(x, plotTop, x, plotBottom, { color: COLORS.navy, width: 1, dash: '4 3' }));
  });

  rows.forEach((r, i) => {
    const cy = topMargin + i * rowH + rowH / 2;
    parts.push(text(4, cy + 4, r.名稱, { size: FS_LABEL, color: COLORS.body }));
    const x0 = sx(r.下緣), x1 = sx(r.上緣);
    parts.push(rect(Math.min(x0, x1), cy - 8, Math.abs(x1 - x0), 16, { fill: COLORS.paleBlue }));
    parts.push(text(x0 - 6, cy + 4, fmtSmart(r.下緣), { size: FS_TICK, color: COLORS.muted, anchor: 'end' }));
    parts.push(text(x1 + 6, cy + 4, fmtSmart(r.上緣), { size: FS_TICK, color: COLORS.muted, anchor: 'start' }));
    if (isNum(r.中值)) {
      const xm = sx(r.中值);
      parts.push(`<path d="M ${xm - 4} ${cy} L ${xm} ${cy - 6} L ${xm + 4} ${cy} L ${xm} ${cy + 6} Z" fill="${COLORS.blue}"/>`);
      // 中值標籤放菱形「下方」（而非上方），避免跟頂端的參考線／基準日收盤價標籤搶位置。
      parts.push(text(xm, cy + 18, fmtSmart(r.中值), { size: FS_TICK, color: COLORS.blue, anchor: 'middle' }));
    }
  });

  // 依排好的層級畫頂端標籤：level 0 在最下（最靠近列），層級越高越往上疊。
  topItems.forEach((item) => {
    const y = (plotTop - 10) - item.level * shelfH;
    parts.push(text(item.pos.x, y, item.text, {
      size: item.size, color: item.color, anchor: item.pos.anchor, weight: item.weight,
    }));
  });

  // 底軸與刻度
  const axisY = plotBottom + 8;
  parts.push(line(plotLeft, axisY, plotRight, axisY, { color: COLORS.gridAxis, width: 1 }));
  makeTicks(domainMin, domainMax, 5).forEach((t) => {
    if (t < domainMin || t > domainMax) return;
    const x = sx(t);
    parts.push(text(x, axisY + 14, fmtNum(t, 0), { size: FS_TICK, color: COLORS.muted, anchor: 'middle', family: FONT_NUM }));
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 2. 日K ---
function klineMaColor(p) {
  return p === 20 ? COLORS.brand : p === 60 ? COLORS.navy : COLORS.blue;
}

// 價位區底色：刻意避開紅綠（K 棒已用紅漲綠跌），只用極淡的暖色／冷色區分，區名寫在左緣（issue 66 R31）
const KLINE_ZONE_FILL = { 暖: '#F6EADB', 中性: '#EEF1F4', 冷: '#E2ECF5' };
const KLINE_EVENT_WEEK = 5; // 事件「一週漲跌」＝事件前一日收盤到含事件日在內第 5 根收盤，事件當天的跳空也算進去（issue 66 R54）

/** 台股代號（.TW／.TWO）成交量以張（1,000 股）顯示，其他市場以股顯示。 */
function klineVolumeUnit(obj) {
  const sym = obj && obj.標的 && obj.標的.代號;
  return isStr(sym) && /\.TWO?$/i.test(sym) ? { div: 1000, name: '張' } : { div: 1, name: '股' };
}

function fmtVolume(v, unitName) {
  if (v >= 1e8) return `${fmtSmart(Math.round(v / 1e7) / 10)} 億${unitName}`;
  if (v >= 1e4) return `${fmtSmart(Math.round(v / 1e3) / 10)} 萬${unitName}`;
  return `${fmtNum(v, 0)} ${unitName}`;
}

function fmtSignedPct(x, decimals = 0) {
  return `${x >= 0 ? '+' : '−'}${fmtPct(Math.abs(x), decimals)}`;
}

function md(dateStr) {
  return `${parseInt(dateStr.slice(5, 7), 10)}/${parseInt(dateStr.slice(8, 10), 10)}`;
}

function renderKline(chart, obj, width, height) {
  const data = chart.資料;
  const full = data.K線;
  const maPeriods = data.均線;
  const startDate = data.顯示起日;
  const keyLevels = isArr(data.關鍵價位) ? data.關鍵價位 : [];
  const zones = isArr(data.價位區) ? data.價位區 : [];
  const segments = isArr(data.分段) ? data.分段 : [];

  let startIdx = full.findIndex((row) => row[0] >= startDate);
  if (startIdx === -1) startIdx = 0;
  const disp = full.slice(startIdx);
  const hasVolume = disp.every((r) => r.length >= 6 && isNum(r[5]));

  const closesFull = full.map((r) => r[4]);
  const maSeries = {};
  maPeriods.forEach((p) => {
    const arr = new Array(full.length).fill(undefined);
    for (let i = p - 1; i < full.length; i++) {
      let sum = 0;
      for (let k = i - p + 1; k <= i; k++) sum += closesFull[k];
      arr[i] = sum / p;
    }
    maSeries[p] = arr.slice(startIdx);
  });

  // 右側標籤欄：有標 右標 的價位時只放現價與這些價位（issue 66 R31），欄寬可以收窄。
  const flagged = keyLevels.filter((k) => k.右標 === true);
  const labelLevels = flagged.length ? flagged : (zones.length ? [] : keyLevels);
  // 有右標時不留標籤欄，K 棒區滿版、分段底色延伸到右緣，現價與價位標籤改畫在圖內左側（issue 66 R45）
  const labelColW = flagged.length ? 0 : zones.length ? 112 : 130;
  const outerRight = width - 8;
  const plotRight = outerRight - labelColW;

  const highs = disp.map((r) => r[2]);
  const lows = disp.map((r) => r[3]);
  let yMin = Math.min(...lows);
  let yMax = Math.max(...highs);
  const yPad = (yMax - yMin) * 0.06 || Math.abs(yMax) * 0.06 || 1;
  yMin -= yPad;
  yMax += yPad;
  // 左緣依刻度字寬決定，避免「2,000,000」這類長刻度被裁掉
  const plotLeft = leftForTicks(makeTicks(yMin, yMax, 5), 50);

  // 畫面外價位：只處理會出標籤的價位，上方由低到高、下方由高到低往外疊。
  const aboveItems = labelLevels.filter((k) => k.價格 > yMax).sort((a, b) => a.價格 - b.價格);
  const belowItems = labelLevels.filter((k) => k.價格 < yMin).sort((a, b) => b.價格 - a.價格);
  const levelItems = labelLevels.filter((k) => k.價格 >= yMin && k.價格 <= yMax);
  const stackGap = 14;
  const topExtra = aboveItems.length ? 12 + (aboveItems.length - 1) * stackGap : 0;

  // 縱向配置：摘要列 → 分段標題帶 → K 棒區 → 成交量區 → 月份標籤 → 畫面外下方價位
  const colW = (plotRight - plotLeft) / disp.length;
  const cx = (i) => plotLeft + colW * (i + 0.5);
  // 分段先算出實際落在畫面內的段，標題帶高度依此決定；漲跌＝段內首根開盤到末根收盤
  const segLayout = [];
  segments.forEach((s, k) => {
    const i0 = disp.findIndex((r) => r[0] >= s.起日);
    let i1 = -1;
    for (let i = disp.length - 1; i >= 0; i--) if (disp[i][0] <= s.迄日) { i1 = i; break; }
    if (i0 < 0 || i1 < i0) return;
    const x0 = plotLeft + colW * i0;
    const x1 = plotLeft + colW * (i1 + 1);
    const chg = disp[i1][4] / disp[i0][1] - 1;
    segLayout.push({ k, i0, i1, x0, x1, chg, title: s.標題 });
  });
  const drawnEvents = (isArr(data.事件) ? data.事件 : []).filter((ev) => ev.日期 >= startDate && disp.some((r) => r[0] >= ev.日期));
  const segBandH = segLayout.length ? 34 : 0;
  const plotTop = 26 + topExtra + segBandH;
  const candleAreaH = segLayout.length || drawnEvents.length ? 420 : 260;
  const plotBottom = plotTop + candleAreaH;
  const volGap = 6;
  const volH = hasVolume ? 64 : 0;
  const volTop = plotBottom + (hasVolume ? volGap : 0);
  const volBottom = volTop + volH;
  const axisBottom = hasVolume ? volBottom : plotBottom;
  const bottomExtra = belowItems.length ? 12 + (belowItems.length - 1) * stackGap + 14 : 0;
  height = axisBottom + 34 + bottomExtra;

  const sy = scaleLinear(yMin, yMax, plotBottom, plotTop);
  const bodyW = Math.max(1, Math.min(6, colW * 0.6));

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));
  const clipId = `kclip-${(chart.id || 'c').replace(/[^A-Za-z0-9-]/g, '')}`;
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${plotLeft}" y="${plotTop}" width="${plotRight - plotLeft}" height="${plotBottom - plotTop}"/></clipPath>`
    + `<marker id="${clipId}-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="${COLORS.navy}"/></marker></defs>`);

  // 價位區：K 棒區內的水平底色帶，區名與價位寫在區塊左上角
  const zoneLabels = [];
  zones.forEach((z) => {
    const lo = isNum(z.下緣) ? Math.max(z.下緣, yMin) : yMin;
    const hi = isNum(z.上緣) ? Math.min(z.上緣, yMax) : yMax;
    if (hi <= lo) return;
    const yTop = sy(hi);
    const yBot = sy(lo);
    parts.push(rect(plotLeft, yTop, plotRight - plotLeft, yBot - yTop, { fill: KLINE_ZONE_FILL[z.色調] || KLINE_ZONE_FILL.中性 }));
    zoneLabels.push({ x: plotLeft + 4, y: yTop + 12, name: z.名稱, room: yBot - yTop });
  });

  // y 軸格線與刻度（左軸）
  makeTicks(yMin, yMax, 5).forEach((t) => {
    if (t < yMin || t > yMax) return;
    const y = sy(t);
    parts.push(line(plotLeft, y, plotRight, y, { color: COLORS.gridFaint, width: 1 }));
    parts.push(text(plotLeft - 6, y + 3, fmtNum(t, 0), { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });

  // 每月第一個交易日：極淡刻度 + x 軸月份標籤
  const monthStarts = [];
  let lastMonth = null;
  disp.forEach((r, i) => {
    const ym = r[0].slice(0, 7);
    if (ym !== lastMonth) { monthStarts.push(i); lastMonth = ym; }
  });
  const monthLabelIdx = subsampleIndices(monthStarts.length, 8).map((k) => monthStarts[k]);
  const body = [];
  if (!segments.length) {
    monthStarts.forEach((i) => {
      body.push(line(cx(i), plotTop, cx(i), plotBottom, { color: COLORS.gridFaint, width: 1 }));
    });
  }
  // 月份標籤在 K 棒區（與成交量區）之外，不能放進裁切區，否則會被裁掉。
  const monthLabelParts = [];
  monthLabelIdx.forEach((i) => {
    const month = parseInt(disp[i][0].slice(5, 7), 10);
    monthLabelParts.push(text(cx(i), axisBottom + 16, `${month}月`, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
  });

  // 分段：標題帶交替底色，段界用細虛線貫穿 K 棒區與成交量區
  segLayout.forEach((s, n) => {
    const bandTop = plotTop - segBandH;
    parts.push(rect(s.x0, bandTop, s.x1 - s.x0, segBandH - 2, { fill: n % 2 === 0 ? COLORS.faint : COLORS.gridFaint }));
    if (n > 0) {
      parts.push(line(s.x0, bandTop, s.x0, axisBottom, { color: COLORS.paleBlue, width: 1, dash: '3 3' }));
    }
    const mid = (s.x0 + s.x1) / 2;
    const segW = s.x1 - s.x0;
    const titleSize = estimateTextWidth(s.title, FS_LABEL) <= segW - 4 ? FS_LABEL : FS_MIN;
    parts.push(text(mid, bandTop + 13, s.title, { size: titleSize, color: COLORS.ink, anchor: 'middle' }));
    parts.push(text(mid, bandTop + 27, fmtSignedPct(s.chg), {
      size: FS_LABEL, color: s.chg >= 0 ? COLORS.red : COLORS.green, anchor: 'middle', family: FONT_NUM,
    }));
  });

  // K 棒
  disp.forEach((row, i) => {
    const [, o, h, l, c] = row;
    const up = c >= o;
    const color = up ? COLORS.red : COLORS.green;
    body.push(line(cx(i), sy(h), cx(i), sy(l), { color, width: 1 }));
    const yTop = sy(Math.max(o, c));
    const yBot = sy(Math.min(o, c));
    body.push(rect(cx(i) - bodyW / 2, yTop, bodyW, Math.max(1, yBot - yTop), { fill: color }));
  });

  // 均線
  const maWidth = (p) => (p === 20 ? 1.2 : p === 60 ? 1.5 : 1.2);
  maPeriods.forEach((p) => {
    const series = maSeries[p];
    let seg = [];
    const segs = [];
    series.forEach((v, i) => {
      if (v === undefined) { if (seg.length) { segs.push(seg); seg = []; } return; }
      seg.push([cx(i), sy(v)]);
    });
    if (seg.length) segs.push(seg);
    segs.forEach((s) => {
      if (s.length < 2) return;
      body.push(polyline(s, { color: klineMaColor(p), width: maWidth(p), dash: (p !== 20 && p !== 60) ? '4 3' : null }));
    });
  });

  parts.push(`<g clip-path="url(#${clipId})">${body.join('')}</g>`);
  parts.push(...monthLabelParts);

  // 價位區名稱畫在 K 棒之上（區塊太窄放不下就不寫）
  zoneLabels.forEach((z) => {
    if (z.room < 14) return;
    parts.push(text(z.x, z.y, z.name, { size: FS_MIN, color: COLORS.muted }));
  });

  // 成交量：K 棒區下方獨立面板，柱色跟當日 K 棒漲跌一致，左側標一條刻度
  if (hasVolume) {
    const unit = klineVolumeUnit(obj);
    const vols = disp.map((r) => r[5] / unit.div);
    const vMax = Math.max(...vols) || 1;
    const vy = (v) => volBottom - (v / vMax) * volH;
    parts.push(line(plotLeft, volBottom, plotRight, volBottom, { color: COLORS.gridAxis, width: 1 }));
    const tick = makeTicks(0, vMax, 2).filter((t) => t > 0 && t < vMax).pop();
    if (tick) {
      parts.push(line(plotLeft, vy(tick), plotRight, vy(tick), { color: COLORS.gridFaint, width: 1 }));
      // 刻度標籤放在面板內左側，美股千萬股級的長字串也不會超出左緣被裁掉
      parts.push(text(plotLeft + 4, vy(tick) - 3, `成交量 ${fmtVolume(tick, unit.name).replace(/ /g, '')}`, { size: FS_MIN, color: COLORS.muted }));
    }
    disp.forEach((row, i) => {
      const color = row[4] >= row[1] ? COLORS.red : COLORS.green;
      const y = vy(vols[i]);
      parts.push(`<rect x="${cx(i) - bodyW / 2}" y="${y}" width="${bodyW}" height="${Math.max(0.5, volBottom - y)}" fill="${color}" fill-opacity="0.55"/>`);
    });
  }

  // 左上角：顯示期間漲跌幅（第一根開盤到最後一根收盤）與期間高點
  const firstOpen = disp[0][1];
  const lastCloseV = disp[disp.length - 1][4];
  const chg = lastCloseV / firstOpen - 1;
  const hiIdx = highs.indexOf(Math.max(...highs));
  parts.push(text(plotLeft, 16, `期間漲跌 ${chg >= 0 ? '+' : ''}${fmtPct(chg, 0)}　高點 ${fmtSmart(highs[hiIdx])}（${md(disp[hiIdx][0])}）`, { size: FS_LABEL, color: COLORS.ink }));

  // 事件：小文字框放在 K 棒旁邊，箭頭指到當日 K 棒；框內第二行為事件後一週漲跌。
  // 在 K 棒區內掃描候選位置，排除會蓋到 K 棒、其他事件框或價位區名稱的位置，取箭頭最短者。
  const boxes = [];
  const boxH = 30;
  const overlaps = (a, b) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 4 && b.y < a.y + a.h + 4;
  const obstacles = zoneLabels.filter((z) => z.room >= 14)
    .map((z) => ({ x: z.x, y: z.y - 10, w: estimateTextWidth(z.name, FS_MIN), h: 13 }));
  const coversCandle = (c) => {
    const lo = Math.max(0, Math.floor((c.x - plotLeft) / colW));
    const hi = Math.min(disp.length - 1, Math.floor((c.x + c.w - plotLeft) / colW));
    for (let q = lo; q <= hi; q++) {
      if (sy(disp[q][2]) - 4 < c.y + c.h && sy(disp[q][3]) + 4 > c.y) return true;
    }
    return false;
  };
  (isArr(data.事件) ? data.事件 : []).forEach((ev) => {
    if (ev.日期 < startDate) return;
    const i = disp.findIndex((r) => r[0] >= ev.日期);
    if (i < 0) return;
    const j = i + KLINE_EVENT_WEEK - 1;
    const base = i > 0 ? disp[i - 1][4] : disp[i][1];
    const weekChg = j < disp.length ? disp[j][4] / base - 1 : null;
    // 當日漲跌與一週並列：事件當天大跌、之後跟著大盤反彈時，只看一週會誤讀成利多（issue 66 R63）
    const dayChg = disp[i][4] / base - 1;
    const line2 = weekChg === null ? md(disp[i][0])
      : `${md(disp[i][0])}　當日 ${fmtSignedPct(dayChg, 1)}　一週 ${fmtSignedPct(weekChg, 1)}`;
    const w = Math.max(estimateTextWidth(ev.名稱, FS_LABEL), estimateTextWidth(line2, FS_MIN)) + 12;
    const x = cx(i);
    const yHi = sy(disp[i][2]);
    const yLo = sy(disp[i][3]);
    let best = null;
    let fallback = null;
    for (let dx = -1.5 * w; dx <= 1.5 * w; dx += w / 4) {
      const bx = Math.min(Math.max(x - w / 2 + dx, plotLeft + 2), plotRight - w - 2);
      for (let by = plotTop + 2; by + boxH <= plotBottom - 2; by += 6) {
        const cand = { x: bx, y: by, w, h: boxH };
        if (boxes.some((b) => overlaps(b, cand)) || obstacles.some((o) => overlaps(o, cand))) continue;
        const side = by + boxH / 2 < (yHi + yLo) / 2 ? 'above' : 'below';
        const fromX = Math.min(Math.max(x, bx + 6), bx + w - 6);
        const fromY = side === 'above' ? by + boxH : by;
        const tipY = side === 'above' ? yHi - 3 : yLo + 3;
        // 箭頭太短看不出指向，低於 10px 加罰分
        const len = Math.hypot(fromX - x, fromY - tipY);
        const score = len < 10 ? len + 40 : len;
        const option = { ...cand, side, score };
        if (coversCandle(cand)) {
          if (!fallback || score < fallback.score) fallback = option;
          continue;
        }
        if (!best || score < best.score) best = option;
      }
    }
    // 退路：找不到不蓋 K 棒的位置時，取不與其他框重疊中箭頭最短者；再不行貼 K 棒區頂端
    const placed = best || fallback
      || { x: Math.min(Math.max(x - w / 2, plotLeft + 2), plotRight - w - 2), y: plotTop + 2, w, h: boxH, side: 'above' };
    boxes.push({ ...placed, i, name: ev.名稱, line2, weekChg, dayChg });
  });
  // 事件框最後才畫（見函式尾），蓋在現價線與價位虛線之上
  const boxParts = [];
  boxes.forEach((b) => {
    const x = cx(b.i);
    const tipY = b.side === 'above' ? sy(disp[b.i][2]) - 3 : sy(disp[b.i][3]) + 3;
    const fromX = Math.min(Math.max(x, b.x + 6), b.x + b.w - 6);
    const fromY = b.side === 'above' ? b.y + b.h : b.y;
    boxParts.push(`<line x1="${fromX}" y1="${fromY}" x2="${x}" y2="${tipY}" stroke="${COLORS.navy}" stroke-width="1" marker-end="url(#${clipId}-arr)"/>`);
    boxParts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${COLORS.white}" fill-opacity="0.94" stroke="${COLORS.navy}" stroke-width="0.8"/>`);
    boxParts.push(text(b.x + 6, b.y + 13, b.name, { size: FS_LABEL, color: COLORS.navy }));
    if (b.weekChg === null) {
      boxParts.push(text(b.x + 6, b.y + 25, b.line2, { size: FS_MIN, color: COLORS.muted, family: FONT_NUM }));
    } else {
      const [d, day, wk] = b.line2.split('　');
      let tx = b.x + 6;
      boxParts.push(text(tx, b.y + 25, `${d}　`, { size: FS_MIN, color: COLORS.muted, family: FONT_NUM }));
      tx += estimateTextWidth(`${d}　`, FS_MIN);
      boxParts.push(text(tx, b.y + 25, `${day}　`, { size: FS_MIN, color: b.dayChg >= 0 ? COLORS.red : COLORS.green }));
      tx += estimateTextWidth(`${day}　`, FS_MIN);
      boxParts.push(text(tx, b.y + 25, wk, { size: FS_MIN, color: b.weekChg >= 0 ? COLORS.red : COLORS.green }));
    }
  });

  // 關鍵價位（範圍內、會出標籤者）：虛線只畫到 plot 右緣，標籤放右側標籤欄。
  const labelColX = plotRight + 10;
  const candidates = [];
  levelItems.forEach((k) => {
    const y = sy(k.價格);
    const col = flagged.length ? COLORS.navy : COLORS.muted;
    parts.push(line(plotLeft, y, plotRight, y, { color: col, width: 1, dash: '4 3' }));
    candidates.push({ dataY: y, naturalY: y, price: k.價格, text: `${k.名稱} ${fmtSmart(k.價格)}`, color: col, kind: 'level' });
  });

  // 現價：實線橫貫全圖，標籤寫明「現價」與日期（issue 66 R22、R32）
  const lastI = disp.length - 1;
  const lastClose = disp[lastI][4];
  const lastDate = disp[lastI][0];
  parts.push(line(plotLeft, sy(lastClose), plotRight, sy(lastClose), { color: COLORS.highlight, width: 2.5 }));
  candidates.push({
    dataY: sy(lastClose), naturalY: sy(lastClose), price: lastClose,
    text: `現價 ${fmtSmart(lastClose)}（${md(lastDate)}）`,
    color: COLORS.highlight, kind: 'close',
  });

  // 依 y 排序後由上而下做碰撞排開，最小間距 13px。
  candidates.sort((a, b) => a.naturalY - b.naturalY);
  const minGap = 13;
  let prevY = -Infinity;
  candidates.forEach((c) => {
    let ly = c.naturalY;
    if (ly - prevY < minGap) ly = prevY + minGap;
    c.labelY = ly;
    prevY = ly;
  });
  // 往下推超出底部時，由下而上再排一次，把整疊標籤往上收
  let nextY = axisBottom + 16 + minGap;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i].labelY > nextY - minGap) candidates[i].labelY = nextY - minGap;
    nextY = candidates[i].labelY;
  }

  // 一般模式文字 anchor='end' 貼齊 outerRight 往左長，不會超出 viewBox 被裁掉。
  // 有右標時只剩現價與少數價位，改成左緣對齊標籤欄起點，同字級同字型（issue 66 R38），只有現價加粗。
  candidates.forEach((c) => {
    const isClose = c.kind === 'close';
    if (flagged.length) {
      // 圖內左側、線的正上方；年初股價遠低於這些價位，左側是空白區。襯底用所在價位區的底色，
      // 只遮網格線、看不出色塊；不在任何價位區時用白色，與圖底相同（issue 66 R54）
      const tw = estimateTextWidth(c.text, FS_ANNOT);
      const zone = zones.find((z) => (!isNum(z.下緣) || c.price >= z.下緣) && (!isNum(z.上緣) || c.price <= z.上緣));
      const bg = zone ? (KLINE_ZONE_FILL[zone.色調] || KLINE_ZONE_FILL.中性) : '#FFFFFF';
      parts.push(rect(plotLeft + 4, c.dataY - 18, tw + 16, 15, { fill: bg }));
      parts.push(text(plotLeft + 8, c.dataY - 6, c.text, {
        size: FS_ANNOT, color: c.color, anchor: 'start', weight: isClose ? 'bold' : null, family: FONT_NUM,
      }));
      return;
    }
    parts.push(line(plotRight, c.dataY, labelColX - 6, c.labelY, { color: COLORS.gridAxis, width: 1 }));
    parts.push(text(outerRight, c.labelY + 3, c.text, {
      size: isClose ? FS_ANNOT : FS_TICK, color: c.color, anchor: 'end',
      weight: isClose ? 'bold' : null, family: isClose ? FONT_NUM : FONT_LABEL,
    }));
  });

  // 畫面外價位：上方（由低到高往上疊）、下方（由高到低往下疊）。
  aboveItems.forEach((k, i) => {
    const y = (plotTop - segBandH - 12) - i * stackGap;
    const t = `${k.名稱} ${fmtSmart(k.價格)}（畫面外）`;
    const textW = estimateTextWidth(t, FS_TICK);
    parts.push(line(plotRight, plotTop, labelColX - 6, y, { color: COLORS.gridAxis, width: 1 }));
    parts.push(upTriangle(outerRight - textW - 8, y, 7));
    parts.push(text(outerRight, y + 3, t, { size: FS_TICK, color: COLORS.navy, anchor: 'end' }));
  });
  belowItems.forEach((k, i) => {
    const y = (axisBottom + 34 + 12) + i * stackGap;
    const t = `${k.名稱} ${fmtSmart(k.價格)}（畫面外）`;
    const textW = estimateTextWidth(t, FS_TICK);
    parts.push(line(plotRight, plotBottom, labelColX - 6, y, { color: COLORS.gridAxis, width: 1 }));
    parts.push(downTriangle(outerRight - textW - 8, y, 7));
    parts.push(text(outerRight, y + 3, t, { size: FS_TICK, color: COLORS.navy, anchor: 'end' }));
  });

  parts.push(...boxParts);
  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 3. 倍數河流 ---
function renderMultipleRiver(chart, obj, width, height) {
  const data = chart.資料;
  const bands = data.倍數帶;
  const metric = data.每股指標; // [[date,val],...] 階梯序列
  const priceRaw = data.價格;
  const price = (priceRaw === 'auto' || !isArr(priceRaw)) ? [] : priceRaw;

  // 左緣依刻度字寬決定（與下方 y 範圍同算法），避免「2,000,000」這類長刻度被裁掉
  const preVals = [];
  bands.forEach((m) => metric.forEach((r) => preVals.push(m * r[1])));
  price.forEach((r) => preVals.push(r[1]));
  const preMin = Math.min(0, ...price.map((r) => r[1]), ...metric.map((r) => bands[0] * r[1]));
  const preSpan = (Math.max(...preVals) - preMin) || 1;
  const plotLeft = leftForTicks(makeTicks(preMin - preSpan * 0.03, Math.max(...preVals) + preSpan * 0.10, 5));
  const plotRight = width - 46;
  const plotTop = 20;
  const plotBottom = height - 30;

  const t0 = Date.parse(metric[0][0]);
  const lastMetricDate = metric[metric.length - 1][0];
  const lastPriceDate = price.length ? price[price.length - 1][0] : lastMetricDate;
  const endDateStr = [obj.研究基準日, lastMetricDate, lastPriceDate].reduce((a, b) => (b > a ? b : a));
  const t1 = Date.parse(endDateStr);
  const sx = scaleLinear(t0, t1 || t0 + 1, plotLeft, plotRight);

  // 階梯線資料點：對每個 m，於每個 metric 生效日產生 (x,y)，並延伸到 endDateStr
  function stepPoints(m) {
    const pts = [];
    metric.forEach((row, i) => {
      const x0 = sx(Date.parse(row[0]));
      const y = m * row[1];
      const xEnd = i + 1 < metric.length ? sx(Date.parse(metric[i + 1][0])) : sx(t1);
      pts.push([x0, y, xEnd]); // 段落：[起點x, 值, 結束x]
    });
    return pts;
  }
  const bandSteps = bands.map((m) => stepPoints(m));

  const allBandValues = [];
  bandSteps.forEach((steps) => steps.forEach((s) => allBandValues.push(s[1])));
  const priceValues = price.map((r) => r[1]);
  const lowestBandValues = bandSteps[0].map((s) => s[1]);
  // y 範圍涵蓋價格與最高倍數帶；下緣另納最低倍數帶，避免色帶底部貼齊 0。
  // 上緣留較多頭部空間（股價常在序列最右側創新高），避免最高點貼齊或視覺上頂到畫布邊界。
  const rawMin = Math.min(0, ...priceValues, ...lowestBandValues);
  const rawMax = Math.max(...allBandValues, ...priceValues);
  const span = rawMax - rawMin || 1;
  let yMin = rawMin - span * 0.03;
  let yMax = rawMax + span * 0.10;
  const sy = scaleLinear(yMin, yMax, plotBottom, plotTop);

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));
  const clipId = `rclip-${(chart.id || 'c').replace(/[^A-Za-z0-9-]/g, '')}`;
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${plotLeft}" y="${plotTop}" width="${plotRight - plotLeft}" height="${plotBottom - plotTop}"/></clipPath></defs>`);

  makeTicks(yMin, yMax, 5).forEach((t) => {
    if (t < yMin || t > yMax) return;
    const y = sy(t);
    parts.push(line(plotLeft, y, plotRight, y, { color: COLORS.gridFaint, width: 1 }));
    parts.push(text(plotLeft - 6, y + 3, fmtNum(t, 0), { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });

  const body = [];
  // 色帶：相鄰兩條倍數線之間填色
  for (let b = 0; b < bandSteps.length - 1; b++) {
    const lower = bandSteps[b];
    const upper = bandSteps[b + 1];
    const poly = [];
    lower.forEach((s) => { poly.push([s[0], sy(s[1])]); poly.push([s[2], sy(s[1])]); });
    for (let i = upper.length - 1; i >= 0; i--) {
      const s = upper[i];
      poly.push([s[2], sy(s[1])]);
      poly.push([s[0], sy(s[1])]);
    }
    body.push(polygon(poly, { fill: RIVER_COLORS[b % RIVER_COLORS.length] }));
  }
  // 倍數線本身
  bandSteps.forEach((steps, bi) => {
    const pts = [];
    steps.forEach((s) => { pts.push([s[0], sy(s[1])]); pts.push([s[2], sy(s[1])]); });
    body.push(polyline(pts, { color: COLORS.gridAxis, width: 0.8 }));
    const lastSeg = steps[steps.length - 1];
    parts.push(text(plotRight + 2, sy(lastSeg[1]) + 3, `${fmtSmart(bands[bi])}x`, { size: FS_TICK, color: COLORS.muted, anchor: 'start', family: FONT_NUM }));
  });
  // 股價線
  if (price.length) {
    const pricePts = price.map((r) => [sx(Date.parse(r[0])), sy(r[1])]);
    body.push(polyline(pricePts, { color: COLORS.navy, width: 1.6 }));
  }
  parts.push(`<g clip-path="url(#${clipId})">${body.join('')}</g>`);

  // x 軸：年份標籤（稀疏）
  const yearMarks = [];
  let lastYear = null;
  metric.concat(price).sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach((row) => {
    const y = row[0].slice(0, 4);
    if (y !== lastYear) { yearMarks.push(row[0]); lastYear = y; }
  });
  subsampleIndices(yearMarks.length, 8).forEach((i) => {
    const d = yearMarks[i];
    const x = sx(Date.parse(d));
    parts.push(text(x, plotBottom + 16, d.slice(0, 4), { size: FS_TICK, color: COLORS.muted, anchor: 'middle', family: FONT_NUM }));
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// 左軸刻度字寬決定 plot 左緣，避免「1,000,000」這類長刻度被 viewBox 裁掉
function leftForTicks(ticks, min = 46) {
  const w = Math.max(0, ...ticks.map((t) => estimateTextWidth(fmtNum(t, 0), FS_TICK)));
  return Math.max(min, Math.ceil(w) + 12);
}

// --- 4. 營收利益率（半欄） ---
function renderRevenueMargin(chart, obj, width, height) {
  const rows = chart.資料.期間;
  const n = rows.length;

  let plotLeft = 54;
  const plotRight = width - 18; // 右側無座標軸，只留末點標值的半寬（issue 66 R73）
  const plotTop = 26;
  const plotBottom = height - 30;

  const revenues = rows.map((r) => r.營收).filter(isNum);
  // 選用的毛利率畫成第二條線，兩線間距即營業費用率（issue 66 R70）
  const hasGm = rows.some((r) => isNum(r.毛利率));
  const margins = rows.flatMap((r) => [r.營業利益率, r.毛利率]).filter(isNum);
  const yMaxRev = Math.max(...revenues, 0) * 1.1 || 1;
  const yMinRev = Math.min(0, ...revenues);
  // 有毛利率時兩條線疊在柱上會互相遮擋：柱占下方 55%，兩條利益率線占上方 40%
  const revTop = hasGm ? plotTop + (plotBottom - plotTop) * 0.45 : plotTop;
  const syRev = scaleLinear(yMinRev, yMaxRev, plotBottom, revTop);
  plotLeft = leftForTicks(makeTicks(yMinRev, yMaxRev, 4));
  let yMinM = Math.min(...margins, 0);
  let yMaxM = Math.max(...margins, 0);
  if (hasGm) { yMinM = Math.min(...margins); yMaxM = Math.max(...margins); }
  const mPad = (yMaxM - yMinM) * 0.15 || 0.05;
  yMinM -= mPad; yMaxM += mPad;
  const syM = scaleLinear(yMinM, yMaxM, hasGm ? plotTop + (plotBottom - plotTop) * 0.4 : plotBottom, plotTop + (hasGm ? 8 : 0));

  const bandW = (plotRight - plotLeft) / n;
  const barW = Math.max(4, bandW * 0.5);
  const cx = (i) => plotLeft + bandW * (i + 0.5);

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  makeTicks(yMinRev, yMaxRev, 4).forEach((t) => {
    if (t < yMinRev || t > yMaxRev) return;
    const y = syRev(t);
    parts.push(line(plotLeft, y, plotRight, y, { color: COLORS.gridFaint, width: 1 }));
    parts.push(text(plotLeft - 6, y + 3, fmtNum(t, 0), { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });
  parts.push(line(plotLeft, syRev(0), plotRight, syRev(0), { color: COLORS.muted, width: 1 }));

  rows.forEach((r, i) => {
    if (!isNum(r.營收)) return;
    const x = cx(i) - barW / 2;
    const y0 = syRev(0), y1 = syRev(r.營收);
    const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
    if (r.預估) {
      parts.push(rect(x, top, barW, h, { fill: COLORS.gridFaint }));
      parts.push(line(x, top, x + barW, top, { color: COLORS.brand, width: 1.2, dash: '3 2' }));
    } else {
      parts.push(rect(x, top, barW, h, { fill: COLORS.paleBlue }));
    }
  });

  // null 斷線：遇缺值折成多段，不跨過缺值連線；缺值本身不畫點也不標值。
  const drawMargin = (key, color) => {
    buildLineSegments(n, (i) => rows[i][key], (v, i) => [cx(i), syM(v)])
      .forEach((seg) => { if (seg.length > 1) parts.push(polyline(seg, { color, width: 1.5 })); });
    rows.forEach((r, i) => {
      if (!isNum(r[key])) return;
      const x = cx(i), y = syM(r[key]);
      parts.push(circle(x, y, 3, { fill: color }));
      // 兩條線時半欄寬放不下一位小數，標整數百分比（精確值在表格）
      parts.push(text(x, y - 8, hasGm ? fmtPct(r[key], 0) : fmtPct(r[key]), { size: FS_TICK, color, anchor: 'middle', family: FONT_NUM }));
    });
  };
  if (hasGm) drawMargin('毛利率', COLORS.brand);
  drawMargin('營業利益率', COLORS.blue);

  periodAxisLabels(rows.map((r) => r.期間), bandW, FS_TICK).forEach(({ i, s }) => {
    parts.push(text(cx(i), plotBottom + 14, s, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
  });

  parts.push(rect(0, 4, 9, 9, { fill: COLORS.paleBlue }));
  parts.push(text(13, 12, '營收', { size: FS_MIN, color: COLORS.body }));
  parts.push(line(46, 8, 55, 8, { color: COLORS.blue, width: 1.5 }));
  parts.push(text(59, 12, '營業利益率', { size: FS_MIN, color: COLORS.body }));
  if (hasGm) {
    parts.push(line(122, 8, 131, 8, { color: COLORS.brand, width: 1.5 }));
    parts.push(text(135, 12, '毛利率', { size: FS_MIN, color: COLORS.body }));
  }

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 5. 現金流（半欄） ---
function renderCashFlow(chart, obj, width, height) {
  const rows = chart.資料.期間;
  const n = rows.length;

  let plotLeft = 54;
  const plotRight = width - 18;
  const plotTop = 26;
  const plotBottom = height - 30;

  const ocf = rows.map((r) => r.營業現金流).filter(isNum);
  const capexNeg = rows.map((r) => -r.資本支出).filter(isNum);
  const fcf = rows.map((r) => r.自由現金流).filter(isNum);
  let yMin = Math.min(0, ...capexNeg, ...fcf);
  let yMax = Math.max(0, ...ocf, ...fcf);
  const pad = (yMax - yMin) * 0.1 || 1;
  yMin -= pad; yMax += pad;
  const sy = scaleLinear(yMin, yMax, plotBottom, plotTop);
  plotLeft = leftForTicks(makeTicks(yMin, yMax, 4));

  const bandW = (plotRight - plotLeft) / n;
  const barW = Math.max(4, bandW * 0.5);
  const cx = (i) => plotLeft + bandW * (i + 0.5);

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  makeTicks(yMin, yMax, 4).forEach((t) => {
    if (t < yMin || t > yMax) return;
    parts.push(line(plotLeft, sy(t), plotRight, sy(t), { color: COLORS.gridFaint, width: 1 }));
    parts.push(text(plotLeft - 6, sy(t) + 3, fmtNum(t, 0), { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });

  rows.forEach((r, i) => {
    const x = cx(i) - barW / 2;
    if (isNum(r.營業現金流)) {
      const y0 = sy(0), y1 = sy(r.營業現金流);
      const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
      if (r.預估) {
        parts.push(rect(x, top, barW, h, { fill: COLORS.gridFaint, stroke: COLORS.brand, strokeWidth: 1, dash: '3 2' }));
      } else {
        parts.push(rect(x, top, barW, h, { fill: COLORS.paleBlue }));
      }
    }
    if (isNum(r.資本支出)) {
      const y0 = sy(0), y1 = sy(-r.資本支出);
      const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
      if (r.預估) {
        parts.push(rect(x, top, barW, h, { fill: COLORS.gridFaint, stroke: COLORS.brand, strokeWidth: 1, dash: '3 2' }));
      } else {
        parts.push(rect(x, top, barW, h, { fill: COLORS.blue }));
      }
    }
  });

  parts.push(line(plotLeft, sy(0), plotRight, sy(0), { color: COLORS.muted, width: 1 }));

  // null 斷線：遇缺值折成多段，不跨過缺值連線；缺值本身不畫點也不標值。
  buildLineSegments(n, (i) => rows[i].自由現金流, (v, i) => [cx(i), sy(v)])
    .forEach((seg) => { if (seg.length > 1) parts.push(polyline(seg, { color: COLORS.navy, width: 1.5 })); });
  rows.forEach((r, i) => {
    if (!isNum(r.自由現金流)) return;
    const x = cx(i), y = sy(r.自由現金流);
    parts.push(circle(x, y, 3, { fill: COLORS.navy }));
    const label = fmtSmart(r.自由現金流);
    // 負值落在深色資本支出柱上：標籤墊白底並以跌色標示，避免看不出轉負（issue 66 R71）
    if (r.自由現金流 < 0) {
      const w = estimateTextWidth(label, FS_TICK) + 6;
      parts.push(rect(x - w / 2, y + 5, w, 13, { fill: COLORS.white }));
      parts.push(text(x, y + 15, label, { size: FS_TICK, color: COLORS.green, anchor: 'middle', family: FONT_NUM }));
    } else {
      parts.push(text(x, y - 8, label, { size: FS_TICK, color: COLORS.navy, anchor: 'middle', family: FONT_NUM }));
    }
  });

  periodAxisLabels(rows.map((r) => r.期間), bandW, FS_TICK).forEach(({ i, s }) => {
    parts.push(text(cx(i), plotBottom + 14, s, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
  });

  parts.push(rect(0, 4, 9, 9, { fill: COLORS.paleBlue }));
  parts.push(text(13, 12, '營業現金流', { size: FS_MIN, color: COLORS.body }));
  parts.push(rect(78, 4, 9, 9, { fill: COLORS.blue }));
  parts.push(text(91, 12, '資本支出', { size: FS_MIN, color: COLORS.body }));
  parts.push(line(146, 8, 155, 8, { color: COLORS.navy, width: 1.5 }));
  parts.push(circle(150.5, 8, 2.5, { fill: COLORS.navy }));
  parts.push(text(159, 12, '自由現金流', { size: FS_MIN, color: COLORS.body }));

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 6. 同業散佈 ---
function renderPeerScatter(chart, obj, width, height) {
  const data = chart.資料;
  const pts = data.點;

  const plotLeft = 60;
  const plotRight = width - 20;
  const plotTop = 20;
  const plotBottom = height - 46;

  // 選用「y上限」：極端值（例如創意 75 倍）不再拉長縱軸，超過上限的點畫在頂端並標實際值（issue 66 R110）
  const yCap = isNum(data.y上限) ? data.y上限 : Infinity;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => Math.min(p.y, yCap));
  pts.forEach((p) => { if (isArr(p.y區間)) ys.push(Math.min(p.y區間[0], yCap), Math.min(p.y區間[1], yCap)); });
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || Math.abs(xMax) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || Math.abs(yMax) * 0.1 || 1;
  xMin -= xPad; xMax += xPad; yMin -= yPad;
  yMax = Number.isFinite(yCap) ? yCap : yMax + yPad;
  const sx = scaleLinear(xMin, xMax, plotLeft, plotRight);
  const sy = scaleLinear(yMin, yMax, plotBottom, plotTop);

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  makeTicks(yMin, yMax, 5).forEach((t) => {
    if (t < yMin || t > yMax) return;
    const y = sy(t);
    parts.push(line(plotLeft, y, plotRight, y, { color: COLORS.gridFaint, width: 1 }));
    parts.push(text(plotLeft - 6, y + 3, fmtByUnit(t, data.y單位), { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });
  makeTicks(xMin, xMax, 5).forEach((t) => {
    if (t < xMin || t > xMax) return;
    const x = sx(t);
    parts.push(text(x, plotBottom + 14, fmtByUnit(t, data.x單位), { size: FS_TICK, color: COLORS.muted, anchor: 'middle', family: FONT_NUM }));
  });
  parts.push(line(plotLeft, plotBottom, plotRight, plotBottom, { color: COLORS.gridAxis, width: 1 }));
  parts.push(line(plotLeft, plotTop, plotLeft, plotBottom, { color: COLORS.gridAxis, width: 1 }));
  parts.push(text((plotLeft + plotRight) / 2, height - 6, data.x軸, { size: FS_LABEL, color: COLORS.body, anchor: 'middle' }));
  parts.push(text(12, (plotTop + plotBottom) / 2, data.y軸, { size: FS_LABEL, color: COLORS.body, anchor: 'middle', transform: `rotate(-90 12 ${(plotTop + plotBottom) / 2})` }));

  // y 區間（垂直線段加兩端短橫）
  pts.forEach((p) => {
    if (isArr(p.y區間)) {
      const x = sx(p.x);
      const y0 = sy(p.y區間[0]), y1 = sy(p.y區間[1]);
      parts.push(line(x, y0, x, y1, { color: COLORS.navy, width: 1 }));
      parts.push(line(x - 4, y0, x + 4, y0, { color: COLORS.navy, width: 1 }));
      parts.push(line(x - 4, y1, x + 4, y1, { color: COLORS.navy, width: 1 }));
    }
  });

  // 點與標籤（依 y 排序後錯開避免重疊）
  const ordered = pts.map((p, i) => ({ p, i, sx: sx(p.x), sy: sy(Math.min(p.y, yCap)), over: p.y > yCap })).sort((a, b) => a.sy - b.sy);
  let lastLabelY = -Infinity;
  ordered.forEach((o) => {
    let ly = o.sy;
    if (ly - lastLabelY < 12) ly = lastLabelY + 12;
    lastLabelY = ly;
    o.labelY = ly;
  });
  ordered.forEach((o) => {
    const isBench = o.p.本標的 === true;
    if (o.over) {
      // 超出上限：頂端畫向上三角形，標籤附實際值
      const c = isBench ? COLORS.navy : COLORS.brand;
      parts.push(`<path d="M ${o.sx - 5} ${o.sy + 4} L ${o.sx + 5} ${o.sy + 4} L ${o.sx} ${o.sy - 5} Z" fill="${c}"/>`);
      parts.push(text(o.sx - 8, o.labelY + 3, `${o.p.名稱} ${fmtByUnit(o.p.y, data.y單位)}↑`, { size: FS_TICK, color: COLORS.body, anchor: 'end' }));
      return;
    }
    parts.push(circle(o.sx, o.sy, isBench ? 5.5 : 4, { fill: isBench ? COLORS.navy : COLORS.brand }));
    parts.push(text(o.sx + 8, o.labelY + 3, o.p.名稱, {
      size: FS_TICK, color: isBench ? COLORS.navy : COLORS.body, anchor: 'start', weight: isBench ? 'bold' : null,
    }));
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 7. 敏感度 ---
function renderSensitivity(chart, obj, width, height) {
  const data = chart.資料;
  const rowLabels = data.列;
  const colLabels = data.欄;
  const values = data.值;
  const main = isArr(data.主情境) ? data.主情境 : null;
  const basePrice = obj.基準日收盤價;

  // 左欄寬依列標籤與左上角字串的估算字寬決定，上限 200px；放不下時角落改兩行顯示。
  const cornerText = `${data.列名}＼${data.欄名}`;
  const maxRowLabelW = Math.max(...rowLabels.map((r) => estimateTextWidth(r, FS_TICK)));
  const cornerW = estimateTextWidth(cornerText, FS_MIN);
  const rowLabelW = Math.min(200, Math.max(60, maxRowLabelW + 8, cornerW + 8));
  const cornerFitsOneLine = cornerW + 8 <= rowLabelW;
  const headerH = 40;
  const rowH = 30;
  const colW = (width - rowLabelW) / colLabels.length;

  const flat = values.flat();
  const vMin = Math.min(...flat), vMax = Math.max(...flat);
  const bucket = (v) => {
    if (vMax === vMin) return 0;
    return Math.min(4, Math.floor(((v - vMin) / (vMax - vMin)) * 5));
  };

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  parts.push(rect(0, 0, rowLabelW, headerH, { fill: COLORS.faint }));
  if (cornerFitsOneLine) {
    parts.push(text(4, headerH / 2 + 4, cornerText, { size: FS_MIN, color: COLORS.body }));
  } else {
    parts.push(text(4, headerH / 2 - 3, data.列名, { size: FS_MIN, color: COLORS.body }));
    parts.push(text(4, headerH / 2 + 11, `＼${data.欄名}`, { size: FS_MIN, color: COLORS.body }));
  }
  colLabels.forEach((c, j) => {
    const x = rowLabelW + j * colW;
    parts.push(rect(x, 0, colW, headerH, { fill: COLORS.faint, stroke: COLORS.white, strokeWidth: 1 }));
    parts.push(text(x + colW / 2, headerH / 2 + 4, c, { size: FS_TICK, color: COLORS.body, anchor: 'middle' }));
  });

  rowLabels.forEach((r, i) => {
    const y = headerH + i * rowH;
    parts.push(rect(0, y, rowLabelW, rowH, { fill: COLORS.faint, stroke: COLORS.white, strokeWidth: 1 }));
    parts.push(text(4, y + rowH / 2 + 4, r, { size: FS_TICK, color: COLORS.body }));
    colLabels.forEach((c, j) => {
      const x = rowLabelW + j * colW;
      const v = values[i][j];
      const isMain = main && main[0] === i && main[1] === j;
      const fill = isMain ? COLORS.navy : SENS_COLORS[bucket(v)];
      parts.push(rect(x, y, colW, rowH, { fill, stroke: COLORS.white, strokeWidth: 1 }));
      if (v >= basePrice) {
        parts.push(rect(x + 1.5, y + 1.5, colW - 3, rowH - 3, { stroke: COLORS.red, strokeWidth: 2 }));
      }
      parts.push(text(x + colW / 2, y + rowH / 2 + 4, fmtNum(v, 0), {
        size: FS_TICK, color: isMain ? COLORS.white : COLORS.ink, anchor: 'middle', weight: isMain ? 'bold' : null, family: FONT_NUM,
      }));
    });
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 8. 反向估值 ---
function renderReverseValuation(chart, obj, width, height) {
  const rows = chart.資料.列;
  const labelW = 180;
  const plotLeft = labelW + 10;
  const plotRight = width - 16;
  const rowH = 58;
  const legendH = 30;
  const viewMinX = 4;
  const viewMaxX = width - 4;

  // 靠邊界時切換 anchor，確保文字一律收在 viewBox 內（不用置中硬切）。
  function place(x, str, size) {
    const w = estimateTextWidth(str, size);
    if (x - w / 2 < viewMinX) return { anchor: 'start', x: viewMinX };
    if (x + w / 2 > viewMaxX) return { anchor: 'end', x: viewMaxX };
    return { anchor: 'middle', x };
  }

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  parts.push(circle(plotLeft, 14, 4, { fill: COLORS.brand }));
  parts.push(text(plotLeft + 8, 18, '本報告 Base', { size: FS_MIN, color: COLORS.body }));
  parts.push(circle(plotLeft + 110, 14, 4, { fill: COLORS.red }));
  parts.push(text(plotLeft + 118, 18, '市場隱含', { size: FS_MIN, color: COLORS.body }));

  rows.forEach((r, i) => {
    const rowTop = legendH + i * rowH;
    const axisY = rowTop + rowH / 2 + 6;

    const vals = [r.市場隱含, r.本報告];
    if (isArr(r.對照)) r.對照.forEach((c) => vals.push(c.值));
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    const pad = (vMax - vMin) * 0.08 || Math.abs(vMax) * 0.08 || 1;
    vMin -= pad; vMax += pad;
    const sx = scaleLinear(vMin, vMax, plotLeft, plotRight);

    // 單位為「比率」時一律顯示百分比，不再顯示「比率」字樣；其他單位才加空格後綴。
    const fmtVal = (v) => (r.單位 === '比率' ? fmtPct(v) : fmtSmart(v));
    const fmtValUnit = (v) => {
      if (r.單位 === '比率') return fmtPct(v);
      return r.單位 ? `${fmtSmart(v)} ${r.單位}` : fmtSmart(v);
    };

    wrapLabel(r.項目).forEach((line1, li) => {
      parts.push(text(0, rowTop + 20 + li * 13, line1, { size: FS_TICK, color: COLORS.body }));
    });

    parts.push(line(plotLeft, axisY, plotRight, axisY, { color: COLORS.gridAxis, width: 1 }));

    // 對照點：依 x 排序，水平重疊（估計寬度相交）時把後一個往下錯開一層。
    const compare = (isArr(r.對照) ? r.對照 : []).map((c) => {
      const t = `${c.名稱} ${fmtVal(c.值)}`;
      return { x: sx(c.值), text: t, w: estimateTextWidth(t, FS_MIN) };
    });
    compare.sort((a, b) => a.x - b.x);
    let prevRight = -Infinity;
    compare.forEach((c) => {
      c.yOffset = (c.x - c.w / 2 < prevRight + 4) ? 12 : 0;
      prevRight = c.x + c.w / 2;
    });
    compare.forEach((c) => {
      parts.push(line(c.x, axisY - 5, c.x, axisY + 5, { color: COLORS.muted, width: 1.5 }));
      const p = place(c.x, c.text, FS_MIN);
      parts.push(text(p.x, axisY + 18 + c.yOffset, c.text, { size: FS_MIN, color: COLORS.muted, anchor: p.anchor }));
    });

    const xImplied = sx(r.市場隱含);
    const xBase = sx(r.本報告);
    parts.push(line(xBase, axisY, xImplied, axisY, { color: COLORS.gridAxis, width: 3 }));
    parts.push(circle(xBase, axisY, 4, { fill: COLORS.brand }));
    parts.push(circle(xImplied, axisY, 4, { fill: COLORS.red }));
    if (r.隱含為下限) parts.push(rightTriangle(xImplied + 9, axisY, 6, COLORS.navy));

    const baseLabel = fmtValUnit(r.本報告);
    const impliedLabel = (r.隱含為下限 ? '＞' : '') + fmtValUnit(r.市場隱含);
    const baseW = estimateTextWidth(baseLabel, FS_TICK);
    const impliedW = estimateTextWidth(impliedLabel, FS_TICK);
    // 本報告／市場隱含兩個標籤水平重疊時，市場隱含改疊到更上一層。
    const overlap = Math.abs(xImplied - xBase) < (baseW / 2 + impliedW / 2 + 6);
    const basePos = place(xBase, baseLabel, FS_TICK);
    const impliedPos = place(xImplied, impliedLabel, FS_TICK);
    parts.push(text(basePos.x, axisY - 10, baseLabel, { size: FS_TICK, color: COLORS.brand, anchor: basePos.anchor, family: FONT_NUM }));
    parts.push(text(impliedPos.x, axisY - (overlap ? 22 : 10), impliedLabel, { size: FS_TICK, color: COLORS.red, anchor: impliedPos.anchor, family: FONT_NUM }));
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// --- 9. 柱線（半欄） ---
// --- 組成（甜甜圈圖，單一期間的占比） ---
const COMPOSITION_COLORS = [COLORS.blue, COLORS.brand, COLORS.paleBlue, '#9DB9D5', COLORS.navy];
// 深淺藍表示機率與衝擊合計越高（外資報告慣用）；不用紅綠，避免與漲跌色混淆；
// 最深一級仍淺到能放深色字，全圖只用一種字色（issue 66 R83、R87、R88）
const RISK_COLORS = ['#F1F5F9', '#DCE7F2', '#BED2E6', '#9DB9D5', '#7FA3C8'];
const RISK_LABEL_W = 40;
const RISK_CODE_ROW_H = 44;
const RISK_PAD = 8;
const RISK_LEGEND_INDENT = 30;

/** 依像素寬度換行：英數連續字不拆開；同一行內有空白、頓號、「與」、全形左括號時，優先在其前後斷行（issue 66 R87）。 */
function wrapToWidth(str, maxW, fontSize = FS_LABEL, restW = maxW) {
  const tokens = String(str).match(/[A-Za-z0-9.%$+\-]+|./gu) || [''];
  const lines = [];
  let cur = '';
  tokens.forEach((tk) => {
    if (cur && estimateTextWidth(cur + tk, fontSize) > (lines.length ? restW : maxW)) {
      let cut = -1;
      for (let i = cur.length - 1; i >= Math.ceil(cur.length / 2); i--) {
        if ([' ', '、', '與', '（'].includes(cur[i])) { cut = cur[i] === ' ' || cur[i] === '、' ? i + 1 : i; break; }
      }
      if (cut > 0) { lines.push(cur.slice(0, cut).trimEnd()); cur = cur.slice(cut).trimStart() + tk; }
      else { lines.push(cur.trimEnd()); cur = tk.trimStart(); }
    } else cur += tk;
  });
  lines.push(cur);
  return lines;
}

/** 首行全寬、續行內縮 14px；末行只剩一兩個字時縮窄行寬重排，避免「下／修」這種孤字行。 */
function riskItemLines(it, colW) {
  const s = `${it.n}. ${it.名稱}`;
  const maxW = colW - RISK_PAD * 2;
  let lines = wrapToWidth(s, maxW, FS_LABEL, maxW - 14);
  for (let w = maxW - FS_LABEL; lines.length > 1 && estimateTextWidth(lines[lines.length - 1], FS_LABEL) < FS_LABEL * 3 && w > maxW * 0.5; w -= FS_LABEL) {
    const alt = wrapToWidth(s, w, FS_LABEL, w - 14);
    if (alt.length === lines.length) lines = alt;
  }
  return lines;
}

/** 「X 風險」放不下一行時，「風險」兩字整組換行，不拆成「毛利率風／險」（issue 66 R98）。 */
function wrapRiskName(name, maxW) {
  const m = /^(.+?)\s*(風險)$/.exec(name);
  if (!m || estimateTextWidth(name, FS_LABEL) <= maxW) return wrapToWidth(name, maxW);
  const lines = wrapToWidth(m[1], maxW);
  const last = lines[lines.length - 1] + m[2];
  if (estimateTextWidth(last, FS_LABEL) <= maxW) lines[lines.length - 1] = last;
  else lines.push(m[2]);
  return lines;
}

function riskMatrixLayout(data, width = FULL_WIDTH) {
  const probs = isArr(data.機率) ? data.機率 : [];
  const imps = isArr(data.衝擊) ? data.衝擊 : [];
  const colW = (width - RISK_LABEL_W) / Math.max(1, probs.length);
  const cell = {};
  (isArr(data.項目) ? data.項目 : []).forEach((it, i) => {
    const k = `${probs.indexOf(it.機率)}|${imps.indexOf(it.衝擊)}`;
    (cell[k] = cell[k] || []).push({ ...it, n: i + 1 });
  });
  // 項目都有「編號」（R1、R2…）時，格內只放編號，格線下方加圖例逐項寫完整風險名稱與說明；
  // 年報與風險管理實務的熱圖都是格內放編號、旁邊或下方列對照表（issue 66 R96）。
  // 否則項目都有「簡稱」時格內只放簡稱、每項一行置中（issue 66 R89）
  const items = isArr(data.項目) ? data.項目 : [];
  const useNo = items.length > 0 && items.every((it) => isStr(it.編號));
  const useCode = useNo || (items.length > 0 && items.every((it) => isStr(it.簡稱)));
  const cellLines = (a) => (useNo
    ? wrapToWidth(a.map((it) => it.編號).join(' '), colW - 8)
    : useCode
      ? a.flatMap((it) => wrapRiskName(it.簡稱, colW - 8))
      : a.flatMap((it) => riskItemLines(it, colW)));
  const lines = Object.values(cell).map((a) => (useCode ? cellLines(a).length : cellLines(a).length + (a.length - 1) * 0.4));
  const minH = useCode ? RISK_CODE_ROW_H : 44;
  const rowH = Math.max(minH, Math.ceil(Math.max(1, ...lines) * 15 + 14));
  const legend = useNo
    ? items.map((it) => ({ 編號: it.編號, lines: wrapToWidth(it.說明 ? `${it.名稱}：${it.說明}` : it.名稱, width - RISK_LEGEND_INDENT - 4) }))
    : [];
  const legendH = legend.length ? 14 + legend.reduce((s, g) => s + g.lines.length * 15 + 4, 0) : 0;
  return { probs, imps, cell, rowH, colW, useCode, cellLines, legend, height: imps.length * rowH + 40 + legendH };
}

function renderRiskMatrix(chart, obj, width, height) {
  const { probs, imps, cell, rowH, colW, useCode, cellLines, legend } = riskMatrixLayout(chart.資料, width);
  const labelW = RISK_LABEL_W;
  const nx = Math.max(1, probs.length - 1);
  const ny = Math.max(1, imps.length - 1);
  const parts = [svgOpen(width, height, chart.標題)];
  imps.forEach((imp, yi) => {
    const y = (imps.length - 1 - yi) * rowH; // 衝擊高的在上
    parts.push(text(labelW - 8, y + rowH / 2 + 4, imp, { size: FS_TICK, color: COLORS.body, anchor: 'end' }));
    probs.forEach((pr, xi) => {
      const x = labelW + xi * colW;
      const score = (xi / nx + yi / ny) / 2;
      const level = Math.min(RISK_COLORS.length - 1, Math.round(score * (RISK_COLORS.length - 1)));
      parts.push(rect(x, y, colW, rowH, { fill: RISK_COLORS[level], stroke: COLORS.white, strokeWidth: 2 }));
      const items = cell[`${xi}|${yi}`] || [];
      if (useCode && items.length) {
        const ls = cellLines(items);
        let ty = y + rowH / 2 - ((ls.length - 1) * 15) / 2 + 4;
        ls.forEach((ln) => {
          parts.push(text(x + colW / 2, ty, ln, { size: FS_LABEL, color: COLORS.ink, anchor: 'middle', weight: 600 }));
          ty += 15;
        });
      } else {
        let ty = y + 18;
        items.forEach((it) => {
          riskItemLines(it, colW).forEach((ln, li) => {
            parts.push(text(x + RISK_PAD + (li === 0 ? 0 : 14), ty, ln, { size: FS_LABEL, color: COLORS.ink }));
            ty += 15;
          });
          ty += 6;
        });
      }
    });
  });
  const gridBottom = imps.length * rowH;
  probs.forEach((pr, xi) => {
    parts.push(text(labelW + xi * colW + colW / 2, gridBottom + 16, pr, { size: FS_TICK, color: COLORS.body, anchor: 'middle' }));
  });
  parts.push(text(labelW + (width - labelW) / 2, gridBottom + 33, '發生機率 →', { size: FS_MIN, color: COLORS.muted, anchor: 'middle' }));
  parts.push(text(4, gridBottom + 33, '↑ 衝擊', { size: FS_MIN, color: COLORS.muted }));
  let ly = gridBottom + 40 + 14 + 11;
  legend.forEach((g) => {
    parts.push(text(4, ly, g.編號, { size: FS_LABEL, color: COLORS.ink, family: FONT_NUM, weight: 600 }));
    g.lines.forEach((ln) => {
      parts.push(text(RISK_LEGEND_INDENT, ly, ln, { size: FS_LABEL, color: COLORS.ink }));
      ly += 15;
    });
    ly += 4;
  });
  parts.push(SVG_CLOSE);
  return parts.join('');
}

function renderComposition(chart, obj, width, height) {
  const items = chart.資料.項目;
  const sum = items.reduce((a, it) => a + it.值, 0);
  const cx = width / 2;
  const cy = 70;
  const rOut = 60;
  const rIn = 36;
  const parts = [svgOpen(width, height, chart.標題)];
  let a0 = -Math.PI / 2;
  const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  items.forEach((it, i) => {
    const frac = it.值 / sum;
    const a1 = a0 + frac * 2 * Math.PI;
    const color = COMPOSITION_COLORS[i % COMPOSITION_COLORS.length];
    if (frac >= 0.9999) {
      parts.push(circle(cx, cy, rOut, { fill: color }));
    } else if (frac > 0) {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(rOut, a0), [x1, y1] = pt(rOut, a1);
      const [x2, y2] = pt(rIn, a1), [x3, y3] = pt(rIn, a0);
      parts.push(`<path d="M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z" fill="${color}" stroke="${COLORS.white}" stroke-width="1.5"/>`);
    }
    a0 = a1;
  });
  parts.push(circle(cx, cy, rIn - 0.5, { fill: COLORS.white }));
  parts.push(text(cx, cy + 4, chart.資料.期間, { size: FS_ANNOT, color: COLORS.ink, family: FONT_NUM, anchor: 'middle', weight: 600 }));
  items.forEach((it, i) => {
    const y = 158 + i * 24;
    parts.push(rect(8, y - 9, 10, 10, { fill: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length] }));
    parts.push(text(24, y, it.名稱, { size: FS_LABEL, color: COLORS.body }));
    parts.push(text(width - 8, y, fmtPct(it.值 / sum, 0), { size: FS_ANNOT, color: COLORS.ink, family: FONT_NUM, anchor: 'end', weight: 600 }));
  });
  parts.push(SVG_CLOSE);
  return parts.join('');
}

function renderBarLine(chart, obj, width, height) {
  const data = chart.資料;
  const periods = data.期間;
  const n = periods.length;
  const forecast = isArr(data.預估) ? data.預估 : new Array(n).fill(false);
  const bars = data.柱;
  const lines = isArr(data.線) ? data.線 : [];

  let plotLeft = 54;
  const plotRight = width - (lines.length ? 34 : 14);
  const plotTop = 26;
  const plotBottom = height - 30;

  const barVals = [];
  bars.forEach((b) => b.值.forEach((v) => { if (isNum(v)) barVals.push(v); }));
  let yMin = Math.min(0, ...barVals);
  let yMax = Math.max(0, ...barVals);
  const pad = (yMax - yMin) * 0.1 || 1;
  yMin -= pad; yMax += pad;
  const sy = scaleLinear(yMin, yMax, plotBottom, plotTop);
  plotLeft = leftForTicks(makeTicks(yMin, yMax, 4));

  const lineVals = [];
  lines.forEach((l) => l.值.forEach((v) => { if (isNum(v)) lineVals.push(v); }));
  // 右軸範圍（issue 36）：線值全為正且最小值遠離 0 時，範圍只依資料（水位線不會擠在圖的上緣）；
  // 「遠離」= 最小值 > 資料全距的 50%（全距 0 的常數線也算遠離）。其餘情況（含 0 或負值、貼近 0）仍強制含 0。
  // 左軸柱圖不受影響，維持含 0。
  const loL = lineVals.length ? Math.min(...lineVals) : 0;
  const hiL = lineVals.length ? Math.max(...lineVals) : 0;
  const lineAwayFromZero = lineVals.length > 0 && loL > 0 && loL > (hiL - loL) * 0.5;
  let yMinL = lineAwayFromZero ? loL : Math.min(0, ...lineVals);
  let yMaxL = lineAwayFromZero ? hiL : Math.max(0, ...lineVals);
  const padL = (yMaxL - yMinL) * 0.15 || (lineAwayFromZero ? Math.abs(loL) * 0.05 : 0) || 0.05;
  yMinL -= padL; yMaxL += padL;
  const syL = scaleLinear(yMinL, yMaxL, plotBottom, plotTop);

  const bandW = (plotRight - plotLeft) / n;
  const groupW = bandW * 0.6;
  const barW = groupW / Math.max(1, bars.length);
  const cx = (i) => plotLeft + bandW * (i + 0.5);

  const parts = [];
  parts.push(svgOpen(width, height, chart.標題));

  makeTicks(yMin, yMax, 4).forEach((t) => {
    if (t < yMin || t > yMax) return;
    parts.push(line(plotLeft, sy(t), plotRight, sy(t), { color: COLORS.gridFaint, width: 1 }));
    const tickLabel = data.左軸單位 === '比率' ? fmtPctTick(t) : fmtNum(t, 0);
    parts.push(text(plotLeft - 6, sy(t) + 3, tickLabel, { size: FS_TICK, color: COLORS.muted, anchor: 'end', family: FONT_NUM }));
  });

  bars.forEach((b, bi) => {
    b.值.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const x = cx(i) - groupW / 2 + bi * barW;
      const y0 = sy(0), y1 = sy(v);
      const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
      if (forecast[i]) {
        parts.push(rect(x, top, barW * 0.9, h, { fill: COLORS.gridFaint, stroke: COLORS.brand, strokeWidth: 1, dash: '3 2' }));
      } else {
        parts.push(rect(x, top, barW * 0.9, h, { fill: BAR_GROUP_COLORS[bi % BAR_GROUP_COLORS.length] }));
      }
      // 選用 標值：柱頂標數值（負值標在柱底下方），issue 66 R57
      if (data.標值 === true && v !== 0) {
        const ly = v >= 0 ? top - 3 : top + h + 10;
        parts.push(text(x + barW * 0.45, ly, fmtSmart(v), { size: FS_MIN, color: COLORS.ink, anchor: 'middle', family: FONT_NUM }));
      }
    });
  });
  parts.push(line(plotLeft, sy(0), plotRight, sy(0), { color: COLORS.muted, width: 1 }));

  lines.forEach((l, li) => {
    // null 斷線：遇缺值折成多段，不跨過缺值連線；缺值本身不畫點。
    buildLineSegments(n, (i) => l.值[i], (v, i) => [cx(i), syL(v)])
      .forEach((seg) => { if (seg.length > 1) parts.push(polyline(seg, { color: LINE_COLORS[li % LINE_COLORS.length], width: 1.5 })); });
    l.值.forEach((v, i) => {
      if (!isNum(v)) return;
      parts.push(circle(cx(i), syL(v), 3, { fill: LINE_COLORS[li % LINE_COLORS.length] }));
    });
  });

  if (lines.length) {
    makeTicks(yMinL, yMaxL, 4).forEach((t) => {
      if (t < yMinL || t > yMaxL) return;
      parts.push(text(plotRight + 4, syL(t) + 3, fmtByUnit(t, lines[0].單位), { size: FS_TICK, color: COLORS.muted, anchor: 'start', family: FONT_NUM }));
    });
  }

  // 類別少（8 個以內）時每個都標，放不下就斷成兩行；期間多時才抽樣（issue 66 R57）
  const labelIdx = n <= 8 ? periods.map((_, i) => i) : pickCategoryLabelIndices(periods, bandW, FS_TICK);
  // 期間型標籤先試縮寫（2024Q3→3Q24），縮寫放得下就不斷行，避免「202／4Q3」這種斷法（issue 66 R74）
  const axisLabels = n <= 8 ? periodAxisLabels(periods, bandW, FS_TICK) : [];
  const shortOk = axisLabels.length === n;
  labelIdx.forEach((i) => {
    const s = shortOk ? axisLabels[i].s : String(periods[i]);
    if (n <= 8 && !shortOk && estimateTextWidth(s, FS_TICK) > bandW - 4) {
      const cut = s.includes(' ') ? s.indexOf(' ') : Math.ceil([...s].length / 2);
      const chars = [...s];
      const a = s.includes(' ') ? s.slice(0, cut) : chars.slice(0, cut).join('');
      const b = s.includes(' ') ? s.slice(cut + 1) : chars.slice(cut).join('');
      parts.push(text(cx(i), plotBottom + 13, a, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
      parts.push(text(cx(i), plotBottom + 25, b, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
      return;
    }
    parts.push(text(cx(i), plotBottom + 14, s, { size: FS_TICK, color: COLORS.muted, anchor: 'middle' }));
  });

  let lx = 0;
  bars.forEach((b, i) => {
    parts.push(rect(lx, 4, 9, 9, { fill: BAR_GROUP_COLORS[i % BAR_GROUP_COLORS.length] }));
    parts.push(text(lx + 13, 12, b.名稱, { size: FS_MIN, color: COLORS.body }));
    lx += b.名稱.length * 8 + 26;
  });
  lines.forEach((l, i) => {
    parts.push(line(lx, 8, lx + 9, 8, { color: LINE_COLORS[i % LINE_COLORS.length], width: 1.5 }));
    parts.push(text(lx + 13, 12, l.名稱, { size: FS_MIN, color: COLORS.body }));
    lx += l.名稱.length * 8 + 26;
  });

  parts.push(SVG_CLOSE);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// fill-prices：從 Yahoo Chart API 取價
// ---------------------------------------------------------------------------

const YAHOO_UA = 'Mozilla/5.0 (research)';

/** 依 gmtoffset 將 UTC 秒數時間戳換成交易所當地日期字串（YYYY-MM-DD）。 */
function localDateStr(epochSec, gmtoffsetSec) {
  const d = new Date((epochSec + (gmtoffsetSec || 0)) * 1000);
  return d.toISOString().slice(0, 10);
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * 純函式：把 Yahoo Chart API 的回應 JSON 轉成 [日期,開,高,低,收] 陣列。
 * 未還原價、gmtoffset 換算當地日期。刻意保留 close 為 null 的列（不在此丟棄），
 * 交給 finalizeDailyRows 依研究基準日決定要不要補值或報錯——因為只有在那裡才知道
 * 哪一列是「研究基準日當天」，不能在這支通用轉換函式裡就先丟掉。
 * 匯出供測試使用（不含網路請求本身）。
 */
function parseYahooChartResponse(json) {
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error('Yahoo 回應格式錯誤：缺少 chart.result[0]');
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const timestamps = result.timestamp || [];
  const gmtoffset = meta.gmtoffset || 0;

  const rows = timestamps.map((t, i) => [
    localDateStr(t, gmtoffset),
    quote.open ? (quote.open[i] === undefined ? null : quote.open[i]) : null,
    quote.high ? (quote.high[i] === undefined ? null : quote.high[i]) : null,
    quote.low ? (quote.low[i] === undefined ? null : quote.low[i]) : null,
    quote.close ? (quote.close[i] === undefined ? null : quote.close[i]) : null,
    quote.volume && isNum(quote.volume[i]) ? quote.volume[i] : null,
  ]);
  return { rows, meta };
}

/**
 * 確保研究基準日當天有完整可用的 OHLC，並把其餘（非基準日）close 為 null 的列丟掉：
 * - 研究基準日那列存在、close 為 null、但 open/high/low 都有值：用 meta.regularMarketPrice
 *   補 close（不動 open/high/low，不是拿 regularMarketPrice 假冒開盤價）。
 * - 研究基準日那列不存在，或 open 也是 null（無法判斷當天走勢），或 meta 也沒有可用價格：
 *   丟出錯誤，呼叫端應以非零退出、不寫檔，稍後重跑。
 * 回傳只含完整 OHLC 的 rows，依日期遞增排序。
 */
function finalizeDailyRows(rawRows, meta, asOfDate) {
  const idx = rawRows.findIndex((r) => r[0] === asOfDate);
  if (idx === -1) {
    // 已有更晚的交易日卻沒有基準日：基準日不是交易日，重跑也不會好
    if (rawRows.some((r) => r[0] > asOfDate && isNum(r[4]))) {
      throw new Error(`研究基準日 ${asOfDate} 不是交易日（Yahoo 日線沒有這天，但有更晚的交易日），請改用最近完成收盤日`);
    }
    throw new Error(`Yahoo 日線尚未含研究基準日 K 棒，稍後重跑（找不到 ${asOfDate}）`);
  }
  const basisRow = rawRows[idx];
  const [d, o, h, l, c] = basisRow;
  const vol = basisRow.length >= 6 ? [basisRow[5]] : [];
  let finalBasisRow;
  if (isNum(c)) {
    finalBasisRow = [d, o, h, l, c, ...vol];
  } else if (isNum(o) && isNum(h) && isNum(l) && isNum(meta.regularMarketPrice)
    && metaLocalDate(meta) === asOfDate) {
    finalBasisRow = [d, o, h, l, meta.regularMarketPrice, ...vol];
  } else {
    throw new Error('Yahoo 日線尚未含研究基準日 K 棒，稍後重跑');
  }
  const rows = rawRows
    .filter((r) => r[0] !== asOfDate && isNum(r[1]) && isNum(r[2]) && isNum(r[3]) && isNum(r[4]))
    .concat([finalBasisRow])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

/** meta.regularMarketTime 換成交易所當地日期；缺值回 null。 */
function metaLocalDate(meta) {
  if (!meta || !isNum(meta.regularMarketTime)) return null;
  const off = isNum(meta.gmtoffset) ? meta.gmtoffset : 0;
  return new Date((meta.regularMarketTime + off) * 1000).toISOString().slice(0, 10);
}

/** 日期字串加減天數，回傳 epoch 秒。 */
function epochOf(dateStr, addDays = 0) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000) + addDays * 86400;
}

// 一律用 period1／period2 指定日期區間：range=max 會被 Yahoo 降成月線或季線，
// 而 range=2y／10y 從「今天」往回算，事後重跑會截短資料。
async function fetchYahooDaily(symbol, startDate, asOfDate) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?interval=1d&period1=${epochOf(startDate)}&period2=${epochOf(asOfDate, 2)}`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) throw new Error(`Yahoo 回應非 200（${res.status}）：${url}`);
  const json = await res.json();
  return parseYahooChartResponse(json);
}

/** 從完整日線 rows 中，依顯示起日與均線長度取出要保留的區間，並檢查最後一筆是否為研究基準日。 */
function trimDailyRows(rows, { 研究基準日, 顯示起日, 均線 }) {
  const filtered = rows.filter((r) => r[0] <= 研究基準日);
  let startIdx = filtered.findIndex((r) => r[0] >= 顯示起日);
  if (startIdx === -1) startIdx = filtered.length;
  const maxMa = (均線 && 均線.length) ? Math.max(...均線) : 0;
  const from = Math.max(0, startIdx - (maxMa + 5));
  const kept = filtered.slice(from);
  // 成交量（第 6 欄）整段都有值才保留；缺任何一根就整段只留開高低收，圖上不畫量
  const withVol = kept.length > 0 && kept.every((r) => isNum(r[5]));
  return kept.map((r) => {
    const ohlc = [r[0], round2(r[1]), round2(r[2]), round2(r[3]), round2(r[4])];
    return withVol ? ohlc.concat([Math.round(r[5])]) : ohlc;
  });
}

/** 該日期所屬 ISO 週（週一為起始）的日期字串，用來把日線分組成週。純日期運算，正確跨年。 */
function isoWeekMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=週日 .. 6=週六
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * 純函式：把完整日線 rows（[日期,開,高,低,收]）依 ISO 週取樣成週線 [日期,收]。
 * 每個 ISO 週取「該週不晚於 asOfDate 的最後一個交易日」；只保留 <= asOfDate 的列，
 * 所以只要 asOfDate 當天在 rows 裡，輸出的最後一筆一定就是 asOfDate 本身。
 * 取代舊版直接打 Yahoo interval=1wk 的做法——Yahoo 週線用週一當時間戳、但收盤價是
 * 該週最後一個交易日的，會把研究基準日之後的價格混進來。
 */
function dailyToWeeklySamples(rows, asOfDate) {
  const byWeek = new Map();
  rows.forEach((r) => {
    if (r[0] > asOfDate) return;
    const wk = isoWeekMonday(r[0]);
    const existing = byWeek.get(wk);
    if (!existing || r[0] > existing[0]) byWeek.set(wk, r);
  });
  return Array.from(byWeek.values())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((r) => [r[0], r[4]]);
}

async function fillPricesFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const obj = JSON.parse(raw);
  const symbol = obj.標的 && obj.標的.代號;
  if (!isStr(symbol)) throw new Error('標的.代號 缺少，無法查詢 Yahoo');
  const 研究基準日 = obj.研究基準日;

  const klineCharts = (obj.圖 || []).filter((c) => c.類型 === '日K');
  const riverCharts = (obj.圖 || []).filter((c) => c.類型 === '倍數河流').filter((c) => {
    const p = c.資料 && c.資料.價格;
    return p === 'auto' || (isArr(p) && p.length === 0);
  });

  let dailyCache = null;
  for (const chart of klineCharts) {
    if (!dailyCache) {
      const raw2y = await fetchYahooDaily(symbol, new Date((epochOf(研究基準日) - 730 * 86400) * 1000).toISOString().slice(0, 10), 研究基準日);
      dailyCache = finalizeDailyRows(raw2y.rows, raw2y.meta, 研究基準日);
    }
    const kept = trimDailyRows(dailyCache, {
      研究基準日, 顯示起日: chart.資料.顯示起日, 均線: chart.資料.均線,
    });
    const lastDate = kept.length ? kept[kept.length - 1][0] : null;
    if (lastDate !== 研究基準日) {
      throw new Error(
        `圖[${chart.id}]：K 棒最後一筆（${lastDate || '無資料'}）不是研究基準日 ${研究基準日}，`
        + '可能是 Yahoo 尚未更新當日收盤或顯示起日設定有誤',
      );
    }
    chart.資料.K線 = kept;
  }

  // 每張河流圖的第一筆每股指標日期可能不同，各自決定要抓的 range 再各自快取。
  const riverDailyCache = new Map(); // 起日 -> finalized rows
  for (const chart of riverCharts) {
    const firstMetricDate = chart.資料.每股指標[0][0];
    if (!riverDailyCache.has(firstMetricDate)) {
      const rawDaily = await fetchYahooDaily(symbol, firstMetricDate, 研究基準日);
      riverDailyCache.set(firstMetricDate, finalizeDailyRows(rawDaily.rows, rawDaily.meta, 研究基準日));
    }
    const weekly = dailyToWeeklySamples(riverDailyCache.get(firstMetricDate), 研究基準日)
      .filter((r) => r[0] >= firstMetricDate)
      .map((r) => [r[0], round2(r[1])]);
    chart.資料.價格 = weekly;
  }

  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  return obj;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log([
    '用法：',
    '  node tools/charts.js validate <charts.json>',
    '  node tools/charts.js fill-prices <charts.json>',
  ].join('\n'));
}

function cmdValidate(file) {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`錯誤 ${file}: 無法讀取或解析 JSON（${e.message}）`);
    return 1;
  }
  const { errors, warnings } = validate(obj, { file });
  warnings.forEach((w) => console.log(`警告 ${file}: ${w}`));
  errors.forEach((e) => console.log(`錯誤 ${file}: ${e}`));
  return errors.length ? 1 : 0;
}

async function cmdFillPrices(file) {
  try {
    await fillPricesFile(file);
    console.log(`已寫入 ${file}`);
    return 0;
  } catch (e) {
    console.error(`錯誤：${e.message}`);
    return 1;
  }
}

async function main(argv) {
  const [cmd, file] = argv;
  if (!cmd) { printUsage(); process.exitCode = 2; return; }
  if (cmd === 'validate') {
    if (!file) { printUsage(); process.exitCode = 2; return; }
    process.exitCode = cmdValidate(file);
    return;
  }
  if (cmd === 'fill-prices') {
    if (!file) { printUsage(); process.exitCode = 2; return; }
    process.exitCode = await cmdFillPrices(file);
    return;
  }
  printUsage();
  process.exitCode = 2;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  REQUIRED_TYPES,
  DEFAULT_LAYOUT,
  FULL_WIDTH,
  HALF_WIDTH,
  COLORS,
  validate,
  render,
  // 供測試使用的內部函式（不屬於 build.js 依賴的固定介面）
  _parseYahooChartResponse: parseYahooChartResponse,
  _finalizeDailyRows: finalizeDailyRows,
  _trimDailyRows: trimDailyRows,
  _isoWeekMonday: isoWeekMonday,
  _dailyToWeeklySamples: dailyToWeeklySamples,
  _fillPricesFile: fillPricesFile,
  _wrapToWidth: wrapToWidth,
  _estimateTextWidth: estimateTextWidth,
  _riskMatrixLayout: riskMatrixLayout,
  _wrapRiskName: wrapRiskName,
};
