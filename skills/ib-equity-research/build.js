#!/usr/bin/env node
// MD 研究報告 -> 投行版式 .dc.html
// 用法: node build.js <input.md> <config.json> <output.dc.html> [--charts <charts.json>]
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
let chartsArg = null;
const chartsFlag = argv.indexOf('--charts');
if (chartsFlag >= 0) { chartsArg = argv[chartsFlag + 1]; argv.splice(chartsFlag, 2); }
const [mdPath, cfgPath, outPath] = argv;
if (!mdPath || !cfgPath || !outPath || (chartsFlag >= 0 && !chartsArg)) {
  console.error('用法: node build.js <input.md> <config.json> <output.dc.html> [--charts <charts.json>]');
  process.exit(1);
}

// ---------- 資料圖（charts.json）----------
// 未指定 --charts 時，找 MD 所在資料夾與上一層（MD 在 report/ 時即 AI 資料夾根層）。
// 繪圖程式在研究 repo 的 tools/charts.js，從 charts.json 往上找（研究 repo ADR 0011）；
// 找不到時用 skill 同層的 charts.js（公開版隨 skill 發布）。
function findUp(start, rel, maxUp) {
  let d = path.resolve(start);
  for (let k = 0; k <= maxUp; k++) {
    const f = path.join(d, rel);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function loadCharts() {
  const mdDir = path.dirname(path.resolve(mdPath));
  const roots = path.basename(mdDir) === 'report' ? [mdDir, path.dirname(mdDir)] : [mdDir];
  let file = chartsArg ? path.resolve(chartsArg) : null;
  if (!file) file = roots.map(r => path.join(r, 'charts.json')).find(f => fs.existsSync(f)) || null;
  if (!file) {
    // 只有個股研究的新報告要求 charts.json：檔名恰為 thesis.json 且非回填（回填 null）。
    // 主題研究的 thesis-<代號>.json 與 issue 03 回填的舊報告都不要求。
    const isNew = roots.some(r => {
      const f = path.join(r, 'thesis.json');
      if (!fs.existsSync(f)) return false;
      try { return JSON.parse(fs.readFileSync(f, 'utf8')).回填 == null; }
      catch (e) { console.error(`錯誤：${f} 無法解析（${e.message}），先修正論點檔`); process.exit(1); }
    });
    if (isNew) {
      console.error('錯誤：同層有非回填的 thesis.json 卻沒有 charts.json；新格式個股報告必須附圖表資料檔（研究 repo ADR 0010 第 2 點）。');
      process.exit(1);
    }
    console.log('未找到 charts.json，產出不含資料圖（舊格式報告）。');
    return [];
  }
  if (!fs.existsSync(file)) { console.error(`錯誤：找不到 ${file}`); process.exit(1); }
  const bundled = path.join(__dirname, 'charts.js');
  const lib = findUp(path.dirname(file), path.join('tools', 'charts.js'), 8)
    || (fs.existsSync(bundled) ? bundled : null);
  if (!lib) { console.error(`錯誤：從 ${file} 往上找不到 tools/charts.js，skill 資料夾也沒有 charts.js`); process.exit(1); }
  const C = require(lib);
  let obj;
  try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`錯誤：${file} 不是合法 JSON：${e.message}`); process.exit(1); }
  const { errors, warnings } = C.validate(obj, { file });
  warnings.forEach(w => console.log(`警告：${w}`));
  if (errors.length) {
    errors.forEach(e => console.error(`錯誤：${e}`));
    console.error(`charts.json 驗證失敗 ${errors.length} 項，未輸出 HTML。`);
    process.exit(1);
  }
  console.log(`讀入 ${file}`);
  // charts.json 標 隱藏: true 的圖保留給 AI，不進 HTML（issue 66）
  return C.render({ ...obj, 圖: obj.圖.filter(c => !c.隱藏) });
}
const charts = loadCharts();

const H = new Function(fs.readFileSync(path.join(__dirname, 'build-helpers.js'), 'utf8'))();

// ```timeline 區塊 -> 橫向時程軸（issue 66 R47）。每行「時點 | 事件 | 說明（可省）| 證實或報導」；
// 實心點為公司證實，空心點為供應鏈或媒體報導，軸線與字體沿用版式色票，無圓角卡片。
function timeline(code) {
  const items = code.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const f = l.split('|').map(s => s.trim());
    const status = /^(證實|報導)$/.test(f[f.length - 1]) ? f.pop() : '報導';
    return { when: f[0] || '', what: f[1] || '', note: f[2] || '', firm: status === '證實' };
  });
  const n = items.length;
  if (!n) return '';
  const edge = `calc(100% / ${2 * n})`;
  const cols = items.map(it => `
        <div style="flex:1 1 0;min-width:0;padding:0 6px;text-align:center;">
          <div style="height:20px;font-family:${H.NUM};font-size:12.5px;font-weight:600;color:${H.MID};white-space:nowrap;">${H.inline(it.when)}</div>
          <div style="height:16px;display:flex;align-items:center;justify-content:center;"><span style="display:inline-block;width:11px;height:11px;border-radius:50%;box-sizing:border-box;border:2px solid ${H.NAVY};background:${it.firm ? H.NAVY : '#FFFFFF'};position:relative;z-index:1;"></span></div>
          <div style="margin-top:8px;font-family:${H.SANS};font-size:12px;font-weight:700;line-height:1.45;color:#10203A;">${H.inline(it.what)}</div>
          ${it.note ? `<div style="margin-top:3px;font-family:${H.SANS};font-size:11px;line-height:1.5;color:${H.GREY};">${H.inline(it.note)}</div>` : ''}
        </div>`).join('');
  const key = (fill, label) => `<span style="white-space:nowrap;margin-right:14px;"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:2px solid ${H.NAVY};background:${fill};vertical-align:-1px;margin-right:5px;"></span>${label}</span>`;
  return `    <div style="margin-top:12px;break-inside:avoid;">
      <div style="position:relative;display:flex;">
        <div style="position:absolute;top:27px;left:${edge};right:${edge};border-top:2px solid ${H.NAVY};"></div>${cols}
      </div>
      <div style="margin-top:10px;font-family:${H.SANS};font-size:10.5px;color:${H.GREY};">${key(H.NAVY, '公司證實')}${key('#FFFFFF', '供應鏈或媒體報導')}</div>
    </div>`;
}
// Mermaid flowchart -> SVG 分層圖（SKILL.md 3：無漸層／圓角／陰影）
// 實線 --> 畫實線；虛線 -.-> 畫虛線，只有虛線連入的節點排在來源下一層
function flowchart(code) {
  const labels = {}, solid = [], dashed = [];
  const clean = t => (t || '').replace(/^["']|["']$/g, '').trim();
  const firstId = seg => {
    const m = /([A-Za-z0-9_]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?/.exec(seg);
    if (!m) return null;
    const lab = m[2] || m[3] || m[4];
    if (lab) labels[m[1]] = clean(lab);
    else if (!(m[1] in labels)) labels[m[1]] = m[1];
    return m[1];
  };
  let colHeads = [];
  code.split('\n').forEach(raw => {
    let l = raw.trim();
    // 選用欄標題：%% 欄：能力與供應鏈｜產品線｜客戶（mermaid 註解，不影響其他渲染器）
    const hm = /^%%\s*欄[:：]\s*(.+)$/.exec(l);
    if (hm) { colHeads = hm[1].split(/[｜|]/).map(s => s.trim()); return; }
    if (!l || l.startsWith('%%') || /^(flowchart|graph|subgraph|end|classDef|class|style|linkStyle)\b/.test(l)) return;
    // 邊標籤 |text|
    // 帶字的邊 -.字.-> 與 -- 字 --> 先轉成 |字| 寫法
    l = l.replace(/-\.([^.>|]+?)\.->/g, '-.->|$1|').replace(/--\s+([^>|-][^>|]*?)\s+-->/g, '-->|$1|');
    const parts = l.split(/(-\.->|-->|==>)/);
    if (parts.length < 3) { firstId(l); return; }
    let prev = firstId(parts[0]);
    for (let k = 1; k < parts.length; k += 2) {
      const kind = parts[k];
      let seg = parts[k + 1] || '';
      let edgeLabel = '';
      const lm = /^\s*\|([^|]*)\|/.exec(seg);
      if (lm) { edgeLabel = clean(lm[1]); seg = seg.slice(lm[0].length); }
      const next = firstId(seg);
      if (prev && next) (kind === '-.->' ? dashed : solid).push([prev, next, edgeLabel]);
      prev = next;
    }
  });
  const ids = Object.keys(labels);
  if (!ids.length) return null;

  // DFS 找回邊，排除後才分層，否則迴圈會推出無限層
  const adj = {};
  ids.forEach(n => adj[n] = []);
  solid.forEach((e, i) => { if (adj[e[0]]) adj[e[0]].push(i); });
  const state = {}, back = new Set();
  const dfs = n => {
    state[n] = 1;
    adj[n].forEach(ei => {
      const b = solid[ei][1];
      if (state[b] === 1) back.add(ei);
      else if (!state[b]) dfs(b);
    });
    state[n] = 2;
  };
  ids.forEach(n => { if (!state[n]) dfs(n); });
  const dag = solid.filter((_, i) => !back.has(i));
  const backEdges = solid.filter((_, i) => back.has(i));

  // 分層納入虛線邊：只有虛線連入的節點放在來源的下一層，不再擠在第一欄
  const layer = {};
  ids.forEach(n => layer[n] = 0);
  // 虛線只在目標沒有任何實線時參與分層（例：第二款 ASIC），否則照實線位置排，虛線改畫或列註記
  const touched = new Set(solid.flatMap(([a, b]) => [a, b]));
  const layerEdges = dag.concat(dashed.filter(([, b]) => !touched.has(b)));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    layerEdges.forEach(([a, b]) => { if (layer[b] < layer[a] + 1) { layer[b] = layer[a] + 1; moved = true; } });
    if (!moved) break;
  }
  const maxL = Math.max(...ids.map(n => layer[n]));
  const cols = [];
  for (let L = 0; L <= maxL; L++) cols.push(ids.filter(n => layer[n] === L));
  // 相鄰兩層的邊走欄間通道；其餘虛線列成圖下註記，其餘實線畫斜線
  const fwd = dag.concat(dashed).filter(([a, b]) => layer[b] === layer[a] + 1);
  const noteEdges = dashed.filter(([a, b]) => layer[b] !== layer[a] + 1);

  const main = n => clean(labels[n]).split(/<br\s*\/?>/i)[0];
  const sub = n => clean(labels[n]).split(/<br\s*\/?>/i).slice(1).join(' ');
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // SVG 價值鏈圖（issue 66 R55）：實際連線、核心節點深色、占比節點附比例條；直角、無漸層與陰影（SKILL.md 3）
  const W = 680, GAP = 54, PADX = 10, FS1 = 12, FS2 = 10.5, LH1 = 16, LH2 = 14, VGAP = 12;
  const colW = (W - GAP * maxL) / (maxL + 1);
  const textW = (s, fs) => [...s].reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? fs : fs * 0.56), 0);
  const wrap = (s, fs, maxW) => {
    if (!s) return [];
    const out = []; let cur = '';
    // 以空白、頓號、逗號為優先斷點，放不下才逐字斷
    const tokens = s.match(/[^\s、，,]+[、，,]?\s*|\s+/g) || [s];
    tokens.forEach(tok => {
      if (textW(cur + tok, fs) <= maxW) { cur += tok; return; }
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      [...tok].forEach(ch => {
        if (textW(cur + ch, fs) > maxW && cur) { out.push(cur.trim()); cur = ''; }
        cur += ch;
      });
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const outDeg = {};
  ids.forEach(n => outDeg[n] = 0);
  solid.forEach(([a]) => outDeg[a]++);
  const maxOut = Math.max(...ids.map(n => outDeg[n]));
  const hub = n => maxOut >= 3 && outDeg[n] === maxOut;
  const shareOf = n => { const m = /占營收\s*([\d.]+)%/.exec(sub(n)); return m ? +m[1] : null; };

  const node = {};
  ids.forEach(n => {
    const inner = colW - PADX * 2;
    const l1 = wrap(main(n), FS1, inner), l2 = wrap(sub(n), FS2, inner);
    const bar = shareOf(n) !== null ? 10 : 0;
    node[n] = { l1, l2, h: 10 + l1.length * LH1 + l2.length * LH2 + bar + 8, x: layer[n] * (colW + GAP) };
  });
  // 欄內排序：依上游節點的平均位置（一次重心法），減少交叉
  const preds = {};
  ids.forEach(n => preds[n] = []);
  layerEdges.forEach(([a, b]) => preds[b].push(a));
  const colH = c => c.reduce((s, n) => s + node[n].h, 0) + VGAP * (c.length - 1);
  const H0 = Math.max(...cols.map(colH));
  const HEAD = colHeads.length ? 26 : 0;
  const place = c => { let y = HEAD + (H0 - colH(c)) / 2; c.forEach(n => { node[n].y = y; y += node[n].h + VGAP; }); };
  cols.forEach((c, L) => {
    if (L > 0) {
      const bc = n => preds[n].length ? preds[n].reduce((s, p) => s + node[p].y + node[p].h / 2, 0) / preds[n].length : 1e9;
      c.sort((a, b) => bc(a) - bc(b));
    }
    place(c);
  });

  const mid = n => node[n].y + node[n].h / 2;
  const svg = [];
  const mk = `fc-arr-${++flowchartSeq}`;
  svg.push(`<defs><marker id="${mk}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${H.BLUE}"/></marker></defs>`);
  // 每個來源在欄間通道有自己的直線位置，不同來源的線不重疊
  for (let L = 0; L < maxL; L++) {
    const srcs = cols[L].filter(n => fwd.some(([a, b]) => a === n && layer[b] === L + 1));
    const gx = (L + 1) * colW + L * GAP;
    srcs.forEach((s, k) => {
      const xm = gx + GAP * (k + 1) / (srcs.length + 1);
      const x1 = node[s].x + colW, y1 = mid(s);
      const outs = fwd.filter(([a, b]) => a === s && layer[b] === L + 1);
      outs.forEach(([, t, lab]) => {
        const isDash = dashed.some(([a, b]) => a === s && b === t);
        const x2 = node[t].x, y2 = mid(t);
        svg.push(`<path d="M${x1},${y1} H${xm} V${y2} H${x2 - 1}" fill="none" stroke="${H.BLUE}" stroke-width="1.2"${isDash ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#${mk})"/>`);
        if (lab) svg.push(`<text x="${xm + 4}" y="${y2 - 4}" font-family="${H.SANS.replace(/"/g, "'")}" font-size="${FS2}" fill="${H.GREY}">${xmlEsc(lab)}</text>`);
      });
    });
  }
  // 跨多層的邊（少見）：直接畫斜線
  dag.concat(backEdges).filter(([a, b]) => layer[b] !== layer[a] + 1).forEach(([a, b]) => {
    svg.push(`<path d="M${node[a].x + colW},${mid(a)} L${node[b].x - 1},${mid(b)}" fill="none" stroke="${H.BLUE}" stroke-width="1" stroke-dasharray="2 3" marker-end="url(#${mk})"/>`);
  });
  ids.forEach(n => {
    const { x, y, h, l1, l2 } = node[n];
    const dark = hub(n);
    svg.push(`<rect x="${x}" y="${y}" width="${colW}" height="${h}" fill="${dark ? H.NAVY : '#F1F5F9'}" stroke="${dark ? H.NAVY : H.MID}" stroke-width="1"/>`);
    if (!dark) svg.push(`<rect x="${x}" y="${y}" width="3" height="${h}" fill="${H.MID}"/>`);
    let ty = y + 10;
    l1.forEach(s => { ty += LH1; svg.push(`<text x="${x + PADX}" y="${ty - 4}" font-family="'Noto Sans TC',sans-serif" font-size="${FS1}" font-weight="700" fill="${dark ? '#FFFFFF' : '#10203A'}">${xmlEsc(s)}</text>`); });
    l2.forEach(s => { ty += LH2; svg.push(`<text x="${x + PADX}" y="${ty - 3}" font-family="'Noto Sans TC',sans-serif" font-size="${FS2}" fill="${dark ? '#BDD3E6' : H.GREY}">${xmlEsc(s)}</text>`); });
    const sh = shareOf(n);
    if (sh !== null) {
      const bw = colW - PADX * 2;
      svg.push(`<rect x="${x + PADX}" y="${ty + 4}" width="${bw}" height="4" fill="#E4EAF0"/>`);
      svg.push(`<rect x="${x + PADX}" y="${ty + 4}" width="${bw * Math.min(sh, 100) / 100}" height="4" fill="${H.BLUE}"/>`);
    }
  });
  colHeads.slice(0, maxL + 1).forEach((s, L) => {
    const x = L * (colW + GAP);
    svg.push(`<text x="${x}" y="11" font-family="'Noto Sans TC',sans-serif" font-size="10.5" font-weight="700" letter-spacing="0.06em" fill="${H.BLUE}">${xmlEsc(s)}</text>`);
    svg.push(`<line x1="${x}" y1="17" x2="${x + colW}" y2="17" stroke="${H.NAVY}" stroke-width="1.5"/>`);
  });
  const totalH = Math.ceil(H0 + HEAD) + 2;
  return `    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${totalH}" width="${W + 2}" height="${totalH}" style="display:block;width:100%;max-width:${W + 2}px;height:auto;margin-top:12px;break-inside:avoid;" role="img" aria-label="${xmlEsc(ids.map(main).join('、'))}">${svg.join('')}</svg>${dashed.length ? `
    <div style="margin-top:6px;font-family:'Noto Sans TC',sans-serif;font-size:10.5px;line-height:1.6;color:${H.GREY};">實線：既有關係；虛線：預期或條件式關係${noteEdges.map(([a, b, t]) => `<br>— — &#9656;　${xmlEsc(main(a))} → ${xmlEsc(main(b))}${t ? '：' + xmlEsc(t) : ''}`).join('')}</div>` : ''}`;
}
let flowchartSeq = 0;

// ### 小標：層級介於 h2 與 Exhibit 標籤之間
function subhead(t) {
  return `    <h3 style="font-family:'Crimson Pro','Noto Serif TC',serif;font-size:17px;font-weight:600;color:#10203A;margin-top:26px;padding-left:9px;border-left:3px solid #123A63;line-height:1.3;">${t}</h3>`;
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
// MD 是完整研究；<!-- html:skip --> 與 <!-- /html:skip --> 之間的內容只給 AI 讀，HTML 不顯示（issue 66）。
// 在解析前移除，所以區塊編號、Exhibit 編號與圖的錨點都以 HTML 實際內容計算。
const md = fs.readFileSync(mdPath, 'utf8')
  .replace(/<!-- html:skip -->[\s\S]*?<!-- \/html:skip -->\n?/g, '')
  .replace(/\n{3,}/g, '\n\n');
if (/<!-- \/?html:skip -->/.test(md)) { console.error('錯誤：html:skip 標記未成對。'); process.exit(1); }

// ---------- 解析 MD ----------
const lines = md.split('\n');
const chapters = [];
let cur = null;
let i = 0;
// <!-- html:appendix --> 與 <!-- /html:appendix --> 之間的表格與來源註移到 HTML 末尾的附錄，
// 正文原位留一行指引，圖仍依錨點留在正文（issue 66 R43）
let inAppendix = false;
// <!-- html:cols --> … <!-- html:col --> … <!-- /html:cols -->：之間的區塊排成並排欄（如有利／不利對照，issue 66 R69）。
// 標記只掛在相鄰區塊的旗標上，不新增區塊，避免 config 的「章.塊」索引位移。
let pendingCol = null;
const push = b => {
  if (inAppendix) { b.app = true; if (inAppendix === 'quiet') b.quiet = true; }
  if (pendingCol) { b.col = pendingCol; pendingCol = null; }
  cur.blocks.push(b);
};

// 跳過 H1
while (i < lines.length && !/^## /.test(lines[i])) i++;

for (; i < lines.length; i++) {
  const line = lines[i];
  if (/^## /.test(line)) {
    if (inAppendix) { console.error(`錯誤：html:appendix 標記跨章（${line.trim()}）。`); process.exit(1); }
    cur = { title: line.replace(/^##\s+/, '').trim(), blocks: [] };
    chapters.push(cur);
    continue;
  }
  if (!cur) continue;
  if (!line.trim()) continue;
  if (line.trim() === '<!-- html:appendix -->') { inAppendix = true; continue; }
  // quiet：正文已有句子引用「附錄 AN」，不再自動插「完整數字見附錄」那一行（issue 66 R76）
  if (line.trim() === '<!-- html:appendix quiet -->') { inAppendix = 'quiet'; continue; }
  if (line.trim() === '<!-- /html:appendix -->') { inAppendix = false; continue; }
  if (line.trim() === '<!-- html:cols -->') { pendingCol = 'start'; continue; }
  if (line.trim() === '<!-- html:col -->') { pendingCol = 'break'; continue; }
  if (line.trim() === '<!-- /html:cols -->') {
    const last = cur.blocks[cur.blocks.length - 1];
    if (!last) { console.error('錯誤：/html:cols 前沒有區塊。'); process.exit(1); }
    last.colEnd = true;
    continue;
  }

  // code fence
  if (/^```/.test(line)) {
    const lang = line.replace(/^```/, '').trim();
    const buf = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
    push({ type: 'fence', lang, code: buf.join('\n') });
    continue;
  }

  // 表格：連續 | 開頭
  if (/^\|/.test(line)) {
    const tbl = [];
    while (i < lines.length && /^\|/.test(lines[i])) { tbl.push(lines[i]); i++; }
    i--;
    push({ type: 'table', md: tbl.join('\n') });
    continue;
  }

  // 清單
  if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
    const items = [];
    const ordered = /^\s*\d+\./.test(line);
    while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
      items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim());
      i++;
    }
    i--;
    push({ type: 'list', items, ordered });
    continue;
  }

  // 小標題 ### -> label
  if (/^### /.test(line)) {
    push({ type: 'subhead', text: line.replace(/^###\s+/, '').trim() });
    continue;
  }

  // 來源註
  if (/^(資料來源|來源|註)[：:]/.test(line.trim())) {
    push({ type: 'src', text: line.trim() });
    continue;
  }

  // 水平分隔線 --- / *** / ___：MD 的章節分隔，版式已有章規線，不輸出
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue;

  // Pull quote：MD 的 > 引言（SKILL.md 4.7，全篇最多一次，放結論前）
  if (/^>\s+/.test(line)) {
    push({ type: 'quote', text: line.replace(/^>\s*/, '').trim() });
    continue;
  }

  push({ type: 'p', text: line.trim() });
}

// ---------- 套用 config 覆寫 ----------
// cfg.skip: ["1.0"] 章.塊 索引，跳過該塊（資訊已在頭部）
// cfg.callout / cfg.quote: 同格式，改變呈現
const mark = (c, b) => `${c}.${b}`;
const skip = new Set(cfg.skip || []);
const callouts = new Set(cfg.callout || []);
const quotes = new Set(cfg.quote || []);
const exhibitTitles = cfg.exhibits || {};
// 次要表格縮成三分之一側欄，與緊接其後（沒有則前一段）的正文並排（issue 66 R19）
const sideEx = new Set((cfg.sideExhibits || []).map(Number));
const SIDE_MARK = '<!--side-exhibit-->';
function applySide(blocks) {
  for (let i = blocks.indexOf(SIDE_MARK); i >= 0; i = blocks.indexOf(SIDE_MARK)) {
    const hasSrc = /^    <p style="margin-top:7px/.test(blocks[i + 3] || '');
    const end = i + (hasSrc ? 4 : 3);
    const right = blocks.slice(i + 1, end).join('\n');
    const isP = (b) => typeof b === 'string' && /^    <p /.test(b) && !/^    <p style="margin-top:7px/.test(b);
    const pair = (left) => `    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;">\n      <div style="flex:2 1 360px;min-width:0;">\n${left}\n      </div>\n      <div style="flex:1 1 220px;min-width:0;">\n${right}\n      </div>\n    </div>`;
    // 表後緊接的段落都排進左欄，避免只並排一段時左欄下方留白（issue 66 R42）
    if (isP(blocks[end])) {
      let k = end;
      while (isP(blocks[k])) k++;
      blocks.splice(i, k - i, pair(blocks.slice(end, k).join('\n')));
    }
    else if (i > 0 && isP(blocks[i - 1])) blocks.splice(i - 1, end - i + 1, pair(blocks[i - 1]));
    else blocks.splice(i, 1);
  }
  return blocks;
}

// ---------- 資料圖的插入位置 ----------
// 章節：第一個標題包含該字串的章。錨點：該章第一個原文包含該字串的區塊，圖插在其後；
// 表格緊接的來源註視為同一塊，圖放在來源註之後。未給錨點時放章末。
const rawText = b => b.type === 'table' ? b.md : b.type === 'list' ? b.items.join('\n')
  : b.type === 'fence' ? b.code : b.type === 'subhead' ? '### ' + b.text : b.text;
const placed = {};
const placeErr = [];
charts.forEach(c => {
  const ci = chapters.findIndex(ch => ch.title.includes(c.章節));
  if (ci < 0) { placeErr.push(`圖[${c.id}]：找不到標題包含「${c.章節}」的章`); return; }
  let key = `${ci}.end`;
  if (c.錨點) {
    const bs = chapters[ci].blocks;
    let bi = bs.findIndex(b => rawText(b).includes(c.錨點));
    if (bi < 0) { placeErr.push(`圖[${c.id}]：第 ${ci + 1} 章找不到錨點「${c.錨點}」`); return; }
    if (bs[bi].type === 'table' && bs[bi + 1] && bs[bi + 1].type === 'src') bi++;
    key = `${ci}.${bi}`;
  }
  (placed[key] = placed[key] || []).push(c);
});
if (placeErr.length) {
  placeErr.forEach(e => console.error(`錯誤：${e}`));
  console.error('資料圖的插入位置有誤，未輸出 HTML。');
  process.exit(1);
}

// ---------- 產生 body ----------
// exhibitNo 是顯示編號（表格、流程圖、資料圖混合依序）；mdExNo 只數 MD 的表格與流程圖，
// 是 config.exhibits 的鍵，所以加入資料圖不會讓既有 config 錯位。
let exhibitNo = 0;
let mdExNo = 0;
const missingEx = [];
const stats = { p: 0, table: 0, src: 0, list: 0, label: 0, chart: 0, data: 0, skipped: 0 };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 版面分級（SKILL.md 第 3 節）：全寬逐張；半欄兩張並排；落單的半欄與前一段正文並排
function chartBlock(c) {
  exhibitNo++; stats.data++;
  // 圖下只放單位與來源名稱（issue 66 R16）；口徑與括號內的工具說明留在 charts.json 給 AI 讀
  const unit = c.單位 && c.單位 !== '混合' ? `單位：${c.單位}　` : '';
  const src = c.來源簡稱 || String(c.來源 || '').split(/[（(]/)[0].trim();
  const legend = (c.圖例 || []).map(l => `<span style="white-space:nowrap;"><span style="display:inline-block;width:14px;height:0;border-top:2px solid ${l.色};vertical-align:middle;margin-right:4px;"></span>${esc(l.名稱)}</span>　`).join('');
  const note = `${legend}${unit}資料來源：${src}`;
  return [H.label(`Exhibit ${exhibitNo}　${esc(c.標題)}`), c.svg, H.src(note)].join('\n');
}
// config.chartNotes[圖 id]：圖右側的產品與合作對象註記，每項「粗體名稱：內容」；
// 有註記的圖不與正文並排，改為「圖｜註記」一列（issue 66 R39）
const chartNotes = id => (cfg.chartNotes || {})[id] || [];
const notesList = notes => `    <ul style="padding-left:0;list-style:none;font-family:${H.SANS};font-size:12.5px;line-height:1.6;color:${H.INK};">\n${notes.map(n => `      <li style="margin-bottom:10px;padding-left:10px;border-left:3px solid ${H.NAVY};">${H.inline(n)}</li>`).join('\n')}\n    </ul>`;
const side = (html, basis) => `      <div style="flex:${basis};min-width:220px;">\n${html}\n      </div>`;
const row = (cells, align = 'flex-start') => `    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:${align};">\n${cells.join('\n')}\n    </div>`;
// config.chartBesideTable：錨點在表格來源註的圖改與該表並排（表左、半欄圖右，issue 66 R106）
const besideTable = new Set(cfg.chartBesideTable || []);
function emitCharts(list, blocks, prevIsP) {
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (besideTable.has(c.id) && blocks.length >= 3 && /^    <table/.test(blocks[blocks.length - 2]) && /^    <p style="margin-top:7px/.test(blocks[blocks.length - 1])) {
      const tbl = blocks.splice(blocks.length - 3, 3).join('\n');
      blocks.push(row([side(tbl, '1 1 300px'), side(chartBlock(c), '0 1 330px')]));
      continue;
    }
    if (chartNotes(c.id).length) {
      blocks.push(row([side(chartBlock(c), c.類型 === '組成' ? '0 1 240px' : '0 1 330px'), side(notesList(chartNotes(c.id)), '1 1 300px')], 'center'));
      // 錨點後緊接的段落移到圖前，正文不被圖切斷
      if (prevIsP) pendingSide = { idx: blocks.length - 1, before: true };
      continue;
    }
    if (c.版面 !== '半欄') { blocks.push(chartBlock(c)); continue; }
    if (list[k + 1] && list[k + 1].版面 === '半欄') {
      blocks.push(row([side(chartBlock(c), '1 1 300px'), side(chartBlock(list[k + 1]), '1 1 300px')]));
      k++;
    } else if (k === 0 && prevIsP) {
      const para = blocks.pop();
      // 組成圖原生寬 240，與正文 2:1 並排（issue 66 R15）；緊接的段落也併進左欄（R38）
      const narrow = c.類型 === '組成';
      const chart = chartBlock(c);
      const build = paras => row([side(paras.join('\n'), narrow ? '2 1 360px' : '1 1 300px'), side(chart, narrow ? '0 1 240px' : '0 1 330px')]);
      blocks.push(build([para]));
      // 一般半欄圖（高約 300px，左欄約 24 字一行）：左欄文字不到約 250 字時，緊接的段落也併進左欄，
      // 避免圖旁只有一段、下方留白（issue 66 R74）；超過就停，免得反過來變成圖下方留白
      const room = narrow ? Infinity : 250;
      pendingSide = { idx: blocks.length - 1, paras: [para], build, room };
    } else {
      blocks.push(row([side(chartBlock(c), '0 1 330px')]));
    }
  }
}

const COLS_START = '<!--cols-start-->';
const COL_BREAK = '<!--col-break-->';
const COLS_END = '<!--cols-end-->';
function applyCols(blocks) {
  for (let s = blocks.indexOf(COLS_START); s >= 0; s = blocks.indexOf(COLS_START)) {
    const e = blocks.indexOf(COLS_END, s);
    if (e < 0) { console.error('錯誤：html:cols 未以 /html:cols 收尾（需在同一章內）。'); process.exit(1); }
    const cols = [[]];
    blocks.slice(s + 1, e).forEach((b) => { if (b === COL_BREAK) cols.push([]); else cols[cols.length - 1].push(b); });
    const html = `    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;">\n${cols.map((c) => `      <div style="flex:1 1 260px;min-width:0;">\n${c.join('\n')}\n      </div>`).join('\n')}\n    </div>`;
    blocks.splice(s, e - s + 1, html);
  }
  return blocks;
}

let pendingSide = null;
const appendixBlocks = [];
let appendixNo = 0;
const sections = chapters.map((ch, ci) => {
  const blocks = [];
  pendingSide = null;
  ch.blocks.forEach((b, bi) => {
    const key = mark(ci + 1, bi);
    if (b.col) { blocks.push(b.col === 'start' ? COLS_START : COL_BREAK); pendingSide = null; }
    const n0 = blocks.length;
    if (skip.has(key)) stats.skipped++;
    else if (b.app) emitAppendix(b, blocks);
    else emitBlock(b, key, blocks);
    if (pendingSide && !placed[`${ci}.${bi}`] && b.type === 'p' && blocks.length === n0 + 1 && /^    <p /.test(blocks[n0])) {
      const textLen = (h) => h.replace(/<[^>]+>/g, '').trim().length;
      if (pendingSide.before) blocks.splice(pendingSide.idx++, 0, blocks.pop());
      else if (pendingSide.paras.reduce((s, h) => s + textLen(h), 0) >= pendingSide.room) pendingSide = null;
      else {
        pendingSide.paras.push(blocks.pop());
        blocks[pendingSide.idx] = pendingSide.build(pendingSide.paras);
      }
    } else if (pendingSide && blocks.length > n0) pendingSide = null;
    // 並排欄先收尾，錨點在欄內最後一塊的圖排在欄外，不被擠進半欄
    if (b.colEnd) { blocks.push(COLS_END); pendingSide = null; }
    const here = placed[`${ci}.${bi}`];
    if (here) emitCharts(here, blocks, !b.colEnd && blocks.length > n0 && b.type === 'p' && /^    <p /.test(blocks[blocks.length - 1]));
  });
  applyCols(blocks);
  applySide(blocks);
  if (placed[`${ci}.end`]) emitCharts(placed[`${ci}.end`], blocks, false);
  return finishSection(ch, ci, blocks);
});
if (appendixBlocks.length) sections.push(H.section('附錄', '附錄：完整報表', appendixBlocks));

// 附錄表格不佔正文 Exhibit 編號（改用 A1、A2），但仍計入 mdExNo，config.exhibits 的鍵不因移動而錯位
function emitAppendix(b, blocks) {
  if (b.type === 'table') {
    mdExNo++; appendixNo++;
    const head = b.md.split('\n')[0].replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    const title = exhibitTitles[String(mdExNo)] || (missingEx.push(mdExNo), head.slice(0, 2).filter(Boolean).join('與'));
    appendixBlocks.push(H.label(`附錄 A${appendixNo}　${title}`), H.table(b.md));
    if (!b.quiet) blocks.push(H.src(`完整數字見附錄 A${appendixNo}「${title}」。`));
    stats.table++;
  } else if (b.type === 'src') {
    appendixBlocks.push(H.src(b.text)); stats.src++;
  } else {
    console.error(`錯誤：html:appendix 只收表格與來源註，收到 ${b.type}。`); process.exit(1);
  }
}

function emitBlock(b, key, blocks) {
    const ci = +key.split('.')[0] - 1;
    if (b.type === 'table') {
      exhibitNo++; mdExNo++;
      const head = b.md.split('\n')[0].replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const auto = head.slice(0, 2).filter(Boolean).join('與');
      const title = exhibitTitles[String(mdExNo)] || (missingEx.push(mdExNo), auto);
      if (sideEx.has(mdExNo)) blocks.push(SIDE_MARK);
      blocks.push(H.label(`Exhibit ${exhibitNo}　${title}`));
      blocks.push(H.table(b.md, ci === 0 ? { firstColWidth: '34%', firstColNowrapMax: 10 } : {}));
      stats.table++;
    } else if (b.type === 'src') {
      blocks.push(H.src(b.text)); stats.src++;
    } else if (b.type === 'list') {
      blocks.push(H.list(b.items, b.ordered)); stats.list++;
    } else if (b.type === 'fence') {
      if (/^timeline$/i.test(b.lang)) {
        exhibitNo++; mdExNo++;
        const t = exhibitTitles[String(mdExNo)] || (missingEx.push(mdExNo), '時程');
        blocks.push(H.label(`Exhibit ${exhibitNo}　${t}`));
        blocks.push(timeline(b.code));
        stats.chart++;
        return;
      }
      if (/^(mermaid)?$/i.test(b.lang) && /^\s*(flowchart|graph)\b/m.test(b.code)) {
        const fc = flowchart(b.code);
        if (fc) {
          exhibitNo++; mdExNo++;
          const t = exhibitTitles[String(mdExNo)] || (missingEx.push(mdExNo), '示意圖');
          blocks.push(H.label(`Exhibit ${exhibitNo}　${t}`));
          blocks.push(fc);
          stats.chart++;
          return;
        }
      }
      blocks.push(H.formula(b.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')));
      stats.chart++;
    } else if (b.type === 'subhead') {
      blocks.push(subhead(H.inline(b.text))); stats.label++;
    } else if (b.type === 'label') {
      blocks.push(H.label(b.text)); stats.label++;
    } else if (b.type === 'quote') {
      blocks.push(H.quote(b.text.replace(/\*\*/g, ''))); stats.p++;
    } else {
      if (quotes.has(key)) blocks.push(H.quote(b.text.replace(/\*\*/g, '')));
      else if (callouts.has(key)) blocks.push(H.callout(b.text));
      else blocks.push(H.p(b.text));
      stats.p++;
    }
}

function finishSection(ch, ci, blocks) {
  const n = String(ci + 1).padStart(2, '0');
  // 第 1 章：執行摘要正文與 Exhibit 1 並排（SKILL.md 4.5）
  if (ci === 0 && cfg.splitFirstChapter !== false) {
    const firstTable = blocks.findIndex(b => /<table /.test(b));
    // 資料圖在第一張表之前時不並排：左欄只有半寬，全寬圖會被縮到字級低於下限
    const chartBefore = firstTable > 0 && blocks.slice(0, firstTable).some(b => /<svg /.test(b));
    if (chartBefore) console.log('提示：第 1 章第一張表之前有資料圖，本章不做正文與 Exhibit 1 並排。');
    if (firstTable > 0 && !chartBefore) {
      const left = blocks.slice(0, firstTable - 1);          // label 在 table 前一格
      const right = blocks.slice(firstTable - 1, firstTable + 2); // label + table + src
      const tail = blocks.slice(firstTable + 2);
      const hasSrc = /<p style="margin-top:7px/.test(blocks[firstTable + 1] || '');
      const rightEnd = hasSrc ? firstTable + 2 : firstTable + 1;
      const r2 = blocks.slice(firstTable - 1, rightEnd);
      const t2 = blocks.slice(rightEnd);
      const split = `    <div style="display:flex;flex-wrap:wrap;gap:30px;margin-top:4px;">
      <div style="flex:2 1 400px;min-width:0;">
${left.join('\n')}
      </div>
      <div style="flex:1 1 220px;min-width:0;">
${r2.join('\n')}
      </div>
    </div>`;
      return H.section(n, ch.title, [split, ...t2]);
    }
  }
  return H.section(n, ch.title, blocks);
}

// ---------- 外殼 ----------
const m = cfg.masthead, r = cfg.rating;
const num = (v) => `<span style="font-family:'IBM Plex Sans','Noto Sans TC',sans-serif;">${v}</span>`;

const ratingCell = (lab, val, sub, color) => `
      <div style="flex:1 1 150px;padding:12px 16px 11px;border-right:1px solid #E4EAF0;">
        <div style="font-family:'Noto Sans TC',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#123A63;white-space:nowrap;">${lab}</div>
        <div style="font-family:'IBM Plex Sans','Noto Sans TC',sans-serif;font-size:27px;font-weight:600;color:#10203A;line-height:1.15;margin-top:3px;">${val}</div>
        <div style="font-family:'Noto Sans TC',sans-serif;font-size:10.5px;color:${color || '#3C506B'};margin-top:2px;">${sub}</div>
      </div>`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<meta name="omelette-owns-print" content="1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;0,700;1,400&family=Noto+Serif+TC:wght@400;600;700&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  doc-page:not(:defined){visibility:hidden}
  body{margin:0;font-variant-numeric:tabular-nums}
  a{color:#1B6AA8;text-decoration:none;border-bottom:1px solid #BDD3E6}
  a:hover{color:#0A2440;border-bottom-color:#0A2440}
  h1,h2,h3{margin:0}
  p{margin:0}
  table{break-inside:auto}
  tr,figure{break-inside:avoid}
</style>
<script src="./doc-page.js"></script>
</helmet>
<doc-page margin="0.7in">
  <div slot="header" style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 20px;background:#0A2440;padding:7px 12px;font-family:'Noto Sans TC',sans-serif;font-size:9.5px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#FFFFFF;">
    <span style="white-space:nowrap;">Equity Research　·　${m.name} (${m.ticker})</span>
    <span style="font-weight:600;white-space:nowrap;color:#BDD3E6;">${m.sector}　·　${m.kind}　·　${m.date}</span>
  </div>
  <div slot="footer" style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:3px 20px;border-top:1px solid #D6DEE7;padding-top:6px;font-family:'Noto Sans TC',sans-serif;font-size:11px;letter-spacing:0.02em;color:#3C506B;">
    <span style="white-space:nowrap;">${cfg.footerNote || ''}</span>
    <span style="font-family:'IBM Plex Sans','Noto Sans TC',sans-serif;">${m.ticker} · ${m.market}</span>
  </div>

  <header style="padding-top:18px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:28px;">
      <div>
        <h1 style="font-family:'Crimson Pro','Noto Serif TC',serif;font-weight:600;font-size:38px;line-height:1.05;letter-spacing:-0.015em;color:#10203A;word-break:keep-all;">${m.name}</h1>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
          <span style="font-family:'IBM Plex Sans','Noto Sans TC',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#0A2440;border:1px solid #0A2440;padding:2px 8px;">${m.ticker}</span>
          <span style="font-family:'Noto Sans TC',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#24364F;white-space:nowrap;">${m.exchange}　·　${m.assetClass}　·　${m.currency}</span>
        </div>
      </div>
      <div style="text-align:right;flex:0 0 auto;">
        <div style="font-family:'Noto Sans TC',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#24364F;">Rating</div>
        <div style="display:flex;align-items:baseline;justify-content:flex-end;gap:9px;margin-top:3px;">
          <span style="font-family:'Crimson Pro',serif;font-size:30px;font-weight:700;letter-spacing:0.03em;color:#0A2440;line-height:1;">${r.call}</span>
          <span style="font-family:'Noto Sans TC',sans-serif;font-size:11px;color:#3C506B;">${r.qualifier}</span>
        </div>
      </div>
    </div>

    <div style="margin-top:16px;border-left:4px solid #0A2440;background:#EAF1F7;padding:14px 20px;break-inside:avoid;">
      <p style="font-family:'Crimson Pro','Noto Serif TC',serif;font-size:19px;font-weight:600;font-style:italic;line-height:1.35;color:#0A2440;">${cfg.tagline}</p>
      <p style="font-family:'Crimson Pro','Noto Serif TC',serif;font-size:15px;font-style:italic;line-height:1.7;color:#123A63;margin-top:5px;max-width:52em;">${cfg.taglineSub}</p>
    </div>

    <div style="margin-top:20px;border-top:2.5px solid #0A2440;border-bottom:2.5px solid #0A2440;break-inside:avoid;">
      <div style="display:flex;flex-wrap:wrap;">
${ratingCell(r.cells[0].label, r.cells[0].value, r.cells[0].sub)}
${ratingCell(r.cells[1].label, r.cells[1].value, r.cells[1].sub, r.cells[1].color)}
${ratingCell(r.cells[2].label, r.cells[2].value, r.cells[2].sub, r.cells[2].color)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 22px;border-top:1px solid #E4EAF0;padding:8px 16px;font-family:'Noto Sans TC',sans-serif;font-size:10.5px;color:#3C506B;">
${(r.infoRow || []).map(s => `        <span style="white-space:nowrap;">${s}</span>`).join('\n')}
      </div>
    </div>
  </header>

${sections.join('\n')}

${cfg.disclaimer ? `  <footer style="margin-top:30px;border-top:2.5px solid #0A2440;padding-top:10px;">
    <p style="font-family:'Noto Sans TC',sans-serif;font-size:10.5px;line-height:1.75;color:#3C506B;text-indent:2em;">${cfg.disclaimer}</p>
  </footer>` : ''}
</doc-page>
</x-dc>
</body>
</html>
`;

// 交叉引用改成可點連結（issue 66 R59）：章、小標、Exhibit、附錄加 id，
// 正文與來源註提到「附錄 A3」「Exhibit 12」「第 4 章」或用「」括住的小標名稱時連過去。
function linkify(doc) {
  const sub = {};
  let sk = 0;
  doc = doc.replace(/(<span style="[^"]*">)(\d{2})(<\/span>\s*<h2 )/g, (m, a, n, b) => `${a}${n}${b}id="ch-${+n}" `);
  doc = doc.replace(/<h3 (style="[^"]*")>(Exhibit (\d+)|附錄 A(\d+))　/g,
    (m, st, all, ex, ap) => `<h3 id="${ex ? 'ex-' + ex : 'app-A' + ap}" ${st}>${all}　`);
  doc = doc.replace(/<h3 (style="font-family:'Crimson Pro'[^"]*")>([^<]+)<\/h3>/g, (m, st, t) => {
    const id = `sh-${++sk}`;
    if (!(t in sub)) sub[t] = id;
    return `<h3 id="${id}" ${st}>${t}</h3>`;
  });
  const ids = new Set([...doc.matchAll(/ id="((?:ch|ex|app|sh)-[^"]+)"/g)].map((m) => m[1]));
  const a = (id, s) => (ids.has(id) ? `<a href="#${id}">${s}</a>` : s);
  const skipTags = /^<\/?(a|h2|h3|svg|script|style|title|text|thead|th)\b/i;
  let skip = 0;
  return doc.split(/(<[^>]+>)/).map((seg) => {
    if (seg.startsWith('<')) {
      const m = skipTags.exec(seg);
      if (m && !seg.endsWith('/>')) skip += seg.startsWith('</') ? -1 : 1;
      return seg;
    }
    if (skip > 0 || !seg.trim()) return seg;
    return seg
      .replace(/附錄 A(\d+)/g, (m, n) => a(`app-A${n}`, m))
      .replace(/Exhibit (\d+)/g, (m, n) => a(`ex-${n}`, m))
      .replace(/第 (\d+) 章/g, (m, n) => a(`ch-${n}`, m))
      .replace(/「([^」<]+)」/g, (m, t) => (sub[t] ? `「${a(sub[t], t)}」` : m));
  }).join('');
}

fs.writeFileSync(outPath, linkify(html));

// runtime 必須與 .dc.html 同層；輸出到報告資料夾時自動帶過去
const outDir = path.dirname(path.resolve(outPath));
const runtime = ['support.js', 'doc-page.js', 'build-helpers.js'];
const copied = [];
runtime.forEach(f => {
  const src = path.join(__dirname, f);
  const dst = path.join(outDir, f);
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size) return;
  fs.copyFileSync(src, dst);
  copied.push(f);
});

console.log(`輸出 ${outPath}`);
if (copied.length) console.log(`已帶入 runtime：${copied.join('、')}`);
console.log(`章節 ${chapters.length}｜段落 ${stats.p}｜表格 ${stats.table}｜來源註 ${stats.src}｜清單 ${stats.list}｜小標 ${stats.label}｜圖 ${stats.chart}｜資料圖 ${stats.data}｜跳過 ${stats.skipped}`);

// Exhibit 標題完整性：缺或多都會讓編號與內容錯位，且不修正時靜默降級
const extraEx = Object.keys(exhibitTitles).filter((k) => +k > mdExNo || !/^\d+$/.test(k));
if (missingEx.length || extraEx.length) {
  if (missingEx.length) {
    console.error(`錯誤：config.exhibits 缺少編號 ${missingEx.join('、')}，該幾張已用自動拼接標題降級。`);
  }
  if (extraEx.length) {
    console.error(`錯誤：config.exhibits 多出編號 ${extraEx.join('、')}，本報告 MD 實際只有 ${mdExNo} 個表格與流程圖。`);
  }
  console.error('HTML 已寫出，補齊 config 後重跑。');
  process.exit(1);
}
