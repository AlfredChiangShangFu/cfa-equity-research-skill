#!/usr/bin/env python3
"""技術面指標：Yahoo Chart API 取 OHLCV，純 Python 計算，無第三方依賴。"""
import argparse, json, os, sys, urllib.request, datetime

UA = {"User-Agent": "Mozilla/5.0 (research)"}

def default_bench(sym):
    if sym.startswith("^") or sym.endswith("-USD"): return None
    return "^TWII" if sym.endswith((".TW", ".TWO")) else "^GSPC"

def fetch(sym, rng="1y", adj=False):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range={rng}&events=div,split"
    raw = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20).read()
    if not raw: raise RuntimeError(f"{sym}: Yahoo 回傳 0 bytes")
    r = json.loads(raw)
    d = r["chart"]["result"][0]; q = d["indicators"]["quote"][0]; m = d["meta"]
    closes = d["indicators"]["adjclose"][0]["adjclose"] if adj else q["close"]
    off = datetime.timezone(datetime.timedelta(seconds=m.get("gmtoffset") or 0))
    rows = [(datetime.datetime.fromtimestamp(t, off).date(), o, h, l, c, v)
            for t, o, h, l, c, v in zip(d["timestamp"], q["open"], q["high"], q["low"], closes, q["volume"])
            if c is not None]
    # Yahoo 的日線序列會比 meta 慢一根：最新交易日的 K 棒 close 常為 None，
    # 但 meta.regularMarketPrice 已是該日收盤。補上，否則指標基準日落後一天。
    mt = m.get("regularMarketTime"); mp = m.get("regularMarketPrice")
    if mt and mp:
        md = datetime.datetime.fromtimestamp(mt, off).date()
        if md > rows[-1][0]:
            rows.append((md, mp, m.get("regularMarketDayHigh") or mp,
                         m.get("regularMarketDayLow") or mp, mp, m.get("regularMarketVolume") or 0))
    return rows, m, r

def sma(x, p): return sum(x[-p:]) / p
def ema(x, p):
    k = 2 / (p + 1); e = [x[0]]
    for v in x[1:]: e.append(v * k + e[-1] * (1 - k))
    return e

def ret(rows, n):
    return (rows[-1][4] / rows[-n-1][4] - 1) * 100 if len(rows) > n else None

def rel(rows, brows, n):
    """同一日期窗口的超額報酬：標的報酬減基準報酬，基準取窗口起點當日或之前最近的收盤。"""
    if not brows or len(rows) <= n: return None
    d0, d1 = rows[-n-1][0], rows[-1][0]
    b0 = [r[4] for r in brows if r[0] <= d0]; b1 = [r[4] for r in brows if r[0] <= d1]
    if not b0 or not b1: return None
    return ret(rows, n) - (b1[-1] / b0[-1] - 1) * 100

def analyze(sym, bench=None, adj=False):
    rows, meta, raw = fetch(sym, adj=adj)
    try:
        brows = fetch(bench)[0] if bench else None
    except Exception as e:  # 基準抓不到不影響標的本身；Yahoo 沒有櫃買指數，上櫃股也用 ^TWII
        print(f"  ⚠ 基準 {bench} 取得失敗（{e}），略過相對報酬", file=sys.stderr); brows = None; bench = None
    C = [r[4] for r in rows]; H = [r[2] for r in rows]; L = [r[3] for r in rows]; V = [r[5] for r in rows]
    n = len(C)
    g = [max(C[i] - C[i-1], 0) for i in range(1, n)]; l_ = [max(C[i-1] - C[i], 0) for i in range(1, n)]
    ag = sum(g[:14]) / 14; al = sum(l_[:14]) / 14
    for i in range(14, len(g)): ag = (ag*13 + g[i]) / 14; al = (al*13 + l_[i]) / 14
    rsi = 100 if al == 0 else 100 - 100 / (1 + ag / al)
    e12, e26 = ema(C, 12), ema(C, 26)
    macd = [a - b for a, b in zip(e12, e26)]; sig = ema(macd, 9)
    m20 = sma(C, 20); sd = (sum((c - m20) ** 2 for c in C[-20:]) / 20) ** 0.5
    up, dn = m20 + 2*sd, m20 - 2*sd
    trs = [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, n)]
    atr = sum(trs[:14]) / 14
    for t in trs[14:]: atr = (atr*13 + t) / 14
    hi, lo = max(H[-252:]), min(L[-252:])
    # 盤中判定：用 Yahoo 給的當日正規交易時段，現在落在時段內就是盤中價。
    # 盤中算的布林、RSI、%B 會隨價格跳動，收盤後重跑數字會變。
    off = datetime.timezone(datetime.timedelta(seconds=meta.get("gmtoffset") or 0))
    mt = meta.get("regularMarketTime")
    qt = datetime.datetime.fromtimestamp(mt, off) if mt else None
    reg = meta.get("currentTradingPeriod", {}).get("regular", {})
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    intraday = bool(reg) and reg["start"] <= now < reg["end"]
    return dict(sym=sym, date=rows[-1][0], px=C[-1], n=n, basis="還原除權息" if adj else "分割調整、未還原除息",
        qt=qt, tz=meta.get("exchangeTimezoneName"), intraday=intraday, bench=bench,
        s20=sma(C,20), s50=sma(C,50), s200=sma(C,200) if n>=200 else None,
        rsi=rsi, macd=macd[-1], sig=sig[-1], hist=macd[-1]-sig[-1], hist_p=macd[-2]-sig[-2],
        bb_up=up, bb_mid=m20, bb_dn=dn, pctb=(C[-1]-dn)/(up-dn)*100, width=(up-dn)/m20*100,
        atr=atr, atr_pct=atr/C[-1]*100, hi52=hi, lo52=lo,
        pos=(C[-1]-lo)/(hi-lo)*100, from_hi=(C[-1]/hi-1)*100,
        r1=ret(rows,1), r5=ret(rows,5), r20=ret(rows,20), r60=ret(rows,60), r120=ret(rows,120),
        x20=rel(rows,brows,20), x60=rel(rows,brows,60), x120=rel(rows,brows,120),
        vr=V[-1]/sma(V,60) if sma(V,60) else None), raw

def pct(v): return f"{v:+.1f}%" if v is not None else "n/a"

def fmt(a):
    s200 = f"{a['s200']:.2f}" if a['s200'] else "n/a"
    d200 = f"{(a['px']/a['s200']-1)*100:+.1f}%" if a['s200'] else "n/a"
    trend = "多頭排列" if a['s200'] and a['s20']>a['s50']>a['s200'] else "非多頭排列"
    cross = "柱體轉強" if a['hist']>a['hist_p'] else "柱體轉弱"
    qs = a['qt'].strftime('%Y-%m-%d %H:%M') if a['qt'] else '未知'
    warn = "　⚠ 盤中價，收盤後數字會變" if a['intraday'] else "　已收盤"
    rel_line = (f"\n  相對  超額報酬 vs {a['bench']}　20日 {pct(a['x20'])}　60日 {pct(a['x60'])}　120日 {pct(a['x120'])}"
                if a['bench'] else "")
    return f"""【{a['sym']}】基準日 {a['date']}　收盤 {a['px']:.2f}　樣本 {a['n']} 根日線　口徑 {a['basis']}
  報價  {qs} {a['tz']}{warn}
  趨勢  SMA20 {a['s20']:.2f} / SMA50 {a['s50']:.2f} / SMA200 {s200}　{trend}
        現價相對 SMA20 {(a['px']/a['s20']-1)*100:+.1f}%　SMA50 {(a['px']/a['s50']-1)*100:+.1f}%　SMA200 {d200}
  動能  RSI(14) {a['rsi']:.1f}　MACD {a['macd']:.2f} / 訊號 {a['sig']:.2f} / 柱 {a['hist']:+.2f}（前日 {a['hist_p']:+.2f}，{cross}）
  波動  布林(20,2) {a['bb_dn']:.2f} — {a['bb_mid']:.2f} — {a['bb_up']:.2f}　%B {a['pctb']:.0f}　帶寬 {a['width']:.1f}%
        ATR(14) {a['atr']:.2f}（現價的 {a['atr_pct']:.1f}%）→ 一倍 ATR 停損位 {a['px']-a['atr']:.2f}
  位置  52週 {a['lo52']:.2f} – {a['hi52']:.2f}　位於 {a['pos']:.0f}% 分位　距高點 {a['from_hi']:+.1f}%
  報酬  1日 {pct(a['r1'])}　5日 {pct(a['r5'])}　20日 {pct(a['r20'])}　60日 {pct(a['r60'])}　120日 {pct(a['r120'])}{rel_line}
  量能  基準日量／60日均量 {a['vr']:.2f}x"""

def main():
    p = argparse.ArgumentParser(description="技術面指標（Yahoo Chart API）")
    p.add_argument("syms", nargs="+")
    p.add_argument("--bench", help="比較基準；預設美股 ^GSPC、台股 ^TWII，指數與加密貨幣不比")
    p.add_argument("--no-bench", action="store_true")
    p.add_argument("--adj", action="store_true", help="改用還原除權息價（adjclose）")
    p.add_argument("--save", metavar="DIR", help="存原始回應與指標 JSON，供證據帳本引用")
    o = p.parse_args()
    for s in o.syms:
        b = None if o.no_bench else (o.bench or default_bench(s))
        a, raw = analyze(s, b, o.adj)
        print(fmt(a) + "\n")
        if o.save:
            os.makedirs(o.save, exist_ok=True)
            f = os.path.join(o.save, f"{s}-tech-{a['date']}.json")
            out = dict(a, qt=a['qt'].isoformat() if a['qt'] else None, date=str(a['date']),
                       retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       source_url=f"https://query1.finance.yahoo.com/v8/finance/chart/{s}?interval=1d&range=1y&events=div,split",
                       raw=raw)
            json.dump(out, open(f, "w", encoding="utf-8"), ensure_ascii=False, default=str)
            print(f"  已存 {f}\n")

if __name__ == "__main__":
    main()
