// HTML builders for the IB equity research template. Loaded by run_script via new Function().
const NUM = "'IBM Plex Sans','Noto Sans TC',sans-serif";
const SANS = "'Noto Sans TC',sans-serif";
const SERIF = "'Noto Serif TC',serif";
const INK = "#24364F", NAVY = "#0A2440", MID = "#123A63", BLUE = "#1B6AA8", GREY = "#3C506B";

function inline(s) {
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => `<a href="${u.replace(/&/g, '&amp;')}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (m, t) => `<strong style="color:#10203A;">${t}</strong>`);
  s = s.replace(/`([^`]+)`/g, (m, t) => `<span style="font-family:${NUM};font-size:0.95em;background:#F1F5F9;padding:1px 5px;">${t}</span>`);
  return s;
}

function h2(n, title) {
  return `    <div style="border-bottom:1.5px solid ${NAVY};padding-bottom:6px;display:flex;align-items:baseline;gap:12px;">
      <span style="font-family:${NUM};font-size:12px;font-weight:600;letter-spacing:0.06em;color:${BLUE};">${n}</span>
      <h2 style="font-family:'Crimson Pro','Noto Serif TC',serif;font-size:23px;font-weight:600;color:#10203A;">${title}</h2>
    </div>`;
}

function p(s, opt) {
  opt = opt || {};
  const size = opt.size || 13.5;
  return `    <p style="font-family:${SERIF};font-size:${size}px;line-height:1.8;color:${INK};margin-top:${opt.mt || 12}px;max-width:54em;text-indent:2em;">${inline(s)}</p>`;
}

function callout(s) {
  return `    <div style="margin-top:14px;border-left:3px solid ${BLUE};background:#F1F5F9;padding:12px 16px;break-inside:avoid;">
      <p style="font-family:${SERIF};font-size:14px;line-height:1.7;color:${MID};text-indent:2em;">${inline(s)}</p>
    </div>`;
}

function quote(s) {
  return `    <blockquote style="margin:16px 0 0;padding:16px 20px;background:${NAVY};break-inside:avoid;">
      <p style="font-family:'Crimson Pro','Noto Serif TC',serif;font-size:19px;line-height:1.6;color:#FFFFFF;font-style:italic;">「${inline(s)}」</p>
    </blockquote>`;
}

function formula(s) {
  return `    <div style="margin-top:12px;border-left:3px solid ${MID};background:#F1F5F9;padding:10px 16px;font-family:${NUM};font-size:12.5px;color:#10203A;break-inside:avoid;">${s}</div>`;
}

function label(s) {
  return `    <h3 style="font-family:${SANS};font-size:11.5px;letter-spacing:0.07em;text-transform:uppercase;color:${BLUE};font-weight:700;margin-top:22px;">${s}</h3>`;
}

function src(s) {
  return `    <p style="margin-top:7px;font-family:${SANS};font-size:11px;line-height:1.7;color:${GREY};max-width:60em;">${inline(s)}</p>`;
}

function isNum(c) {
  return /^[\s\d.,%()／/x＝+\-−–—$]*$/.test(c.replace(/\*\*/g, '')) && /\d/.test(c);
}

// md: markdown pipe table (string). opts.firstColWidth, opts.lastRowRule
function table(md, opts) {
  opts = opts || {};
  const lines = md.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const cells = l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const colRight = head.map((_, i) => {
    if (i === 0) return false;
    const vals = rows.map(r => r[i]).filter(c => c && c.length);
    if (!vals.length) return false;
    return vals.every(c => isNum(c));
  });
  const th = (c, i) => {
    const right = colRight[i];
    const w = (i === 0 && opts.firstColWidth) ? `width:${opts.firstColWidth};` : '';
    const nw = shortCol[i] ? 'white-space:nowrap;' : '';
    return `<th style="text-align:${right ? 'right' : 'left'};${w}${nw}font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.03em;color:${MID};padding:7px 8px;border-top:2.5px solid ${NAVY};border-bottom:1px solid ${NAVY};">${inline(c)}</th>`;
  };
  // 第一欄全是短標籤時不斷行（issue 66 R20），長標籤沿用原本的寬度與換行
  const nowrap0 = opts.firstColNowrapMax && rows.every(r => (r[0] || '').replace(/\*\*/g, '').length <= opts.firstColNowrapMax);
  // 任一欄連表頭在內每格都不超過 8 字時不斷行，長文字欄才吃換行（issue 66 R119）
  const plain = c => (c || '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const shortCol = head.map((h, i) => [h, ...rows.map(r => r[i])].every(c => plain(c).length <= 8));
  const body = rows.map((r, ri) => {
    const last = ri === rows.length - 1;
    const bb = last ? `2.5px solid ${NAVY}` : '1px solid #E4EAF0';
    const emph = /\*\*/.test(r.join('')) && opts.highlightBold !== false ? r.join('') : null;
    const bg = (last && opts.shadeLast) ? 'background:#F1F5F9;' : '';
    const tds = r.map((c, i) => {
      const right = colRight[i];
      const fam = right ? NUM : SERIF;
      const sz = right ? '11.5px' : '12px';
      const nw = ((i === 0 && nowrap0) || shortCol[i]) ? 'white-space:nowrap;' : '';
      return `<td style="text-align:${right ? 'right' : 'left'};${nw}font-family:${fam};font-size:${sz};padding:6px 8px;border-bottom:${bb};${bg}">${inline(c)}</td>`;
    }).join('');
    return `        <tr>${tds}</tr>`;
  }).join('\n');
  return `    <table style="width:100%;border-collapse:collapse;margin-top:8px;color:${INK};">
      <thead>
        <tr>${head.map(th).join('')}</tr>
      </thead>
      <tbody>
${body}
      </tbody>
    </table>`;
}

function list(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  return `    <${tag} style="margin:12px 0 0;padding-left:26px;font-family:${SERIF};font-size:13.5px;line-height:1.8;color:${INK};max-width:54em;">
${items.map(i => `      <li style="margin-bottom:7px;">${inline(i)}</li>`).join('\n')}
    </${tag}>`;
}

function section(n, title, blocks) {
  return `  <section style="margin-top:30px;">
${h2(n, title)}
${blocks.join('\n')}
  </section>`;
}

return { inline, h2, p, callout, quote, formula, label, src, table, list, section, NUM, SANS, SERIF, INK, NAVY, MID, BLUE, GREY };
