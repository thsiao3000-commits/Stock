#!/usr/bin/env python3
"""台股即時報價輪詢 — 證交所 mis.twse.com.tw 快照介面（免帳號、免金鑰）

用法:
  python3 twse_realtime.py                # 查一次預設清單
  python3 twse_realtime.py 2330 2317      # 查指定股票（一次）
  python3 twse_realtime.py --loop 2330    # 每 5 秒輪詢，Ctrl+C 停止

上市自動帶 tse_ 前綴；上櫃請寫成 otc_5483 這種格式。
"""
import json
import ssl
import sys
import time
import urllib.request
from http.cookiejar import CookieJar

MIS = "https://mis.twse.com.tw"
DEFAULT_STOCKS = ["2330", "2317", "0050"]
POLL_SECONDS = 5  # 官方頁面本身就是 5 秒更新，再快沒有意義

# python.org 版 Python 不讀 macOS 系統憑證，改用 certifi 的 CA 庫
try:
    import certifi
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    ssl_ctx = ssl.create_default_context()

# mis 需要先拿到 session cookie，否則 API 會回空資料
opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=ssl_ctx),
    urllib.request.HTTPCookieProcessor(CookieJar()))
opener.addheaders = [("User-Agent", "Mozilla/5.0")]


def warm_up():
    # 拿 session cookie；目前 API 不帶 cookie 也通，失敗就略過
    try:
        opener.open(f"{MIS}/stock/", timeout=10).read()
    except OSError:
        pass


def fetch(codes):
    def full(c):
        if "_" not in c:
            c = f"tse_{c}"
        return c if c.endswith(".tw") else f"{c}.tw"
    ex_ch = "|".join(full(c) for c in codes)
    url = f"{MIS}/stock/api/getStockInfo.jsp?ex_ch={ex_ch}&json=1&delay=0"
    with opener.open(url, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8")).get("msgArray", [])


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def show(rows):
    print(f"{'代號':<6} {'名稱':<6} {'成交':>8} {'漲跌':>8} {'幅度':>7} {'總量':>8}  時間")
    for r in rows:
        last = num(r.get("z"))          # z='-' 表示這 5 秒內沒新成交
        if last is None:
            last = num((r.get("b") or "").split("_")[0])  # 退而求其次用買一價
        prev = num(r.get("y"))
        chg = pct = "-"
        if last is not None and prev:
            chg = f"{last - prev:+.2f}"
            pct = f"{(last - prev) / prev * 100:+.2f}%"
        price = f"{last:.2f}" if last is not None else "-"
        print(f"{r.get('c', ''):<6} {r.get('n', ''):<6} {price:>8} {chg:>8} {pct:>7} "
              f"{r.get('v', '-'):>8}  {r.get('t', '-')}")


def main():
    args = [a for a in sys.argv[1:] if a != "--loop"]
    loop = "--loop" in sys.argv
    codes = args or DEFAULT_STOCKS
    warm_up()
    while True:
        rows = fetch(codes)
        print(f"\n--- {time.strftime('%H:%M:%S')} ---")
        if rows:
            show(rows)
        else:
            print("(無資料 — 檢查代號是否正確，上櫃要用 otc_ 前綴)")
        if not loop:
            break
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
