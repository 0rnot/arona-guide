#!/usr/bin/env python3
"""汎用Arona の参加サーバー数と合計人数を Discord API から数えて stats.json に書く。

GitHub Actions（.github/workflows/stats.yml）から呼ばれる。手元で試すなら
    DISCORD_TOKEN=... python3 scripts/update_stats.py

出すのは合計だけ。サーバー名や個別の人数は公開ページに載せない。
数（guildCount / memberTotal）が前回と同じなら stats.json を書き換えない
（`at` だけ進んで毎回 commit されるのを避けるため）。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

API = "https://discord.com/api/v10"
TOKEN = os.environ.get("DISCORD_TOKEN", "").strip()
OUT = "stats.json"

if not TOKEN:
    print("DISCORD_TOKEN がありません", file=sys.stderr)
    sys.exit(1)


def get(path):
    req = urllib.request.Request(API + path, headers={
        "Authorization": "Bot " + TOKEN,
        "User-Agent": "AronaGuideStats/1.0 (https://arona-bot.com)",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = float(e.headers.get("Retry-After", "2"))
                print(f"429: {wait} 秒待つ", file=sys.stderr)
                time.sleep(wait + 0.5)
                continue
            print(f"HTTP {e.code} {path}: {e.read()[:200]!r}", file=sys.stderr)
            raise
    raise RuntimeError("429 が続いた: " + path)


# 参加サーバー一覧（200 件ずつ。22 件なら 1 回で終わる）
guilds = []
after = None
while True:
    page = get("/users/@me/guilds?limit=200" + (f"&after={after}" if after else ""))
    guilds.extend(page)
    if len(page) < 200:
        break
    after = page[-1]["id"]

# 人数は with_counts で 1 サーバーずつ。approximate_member_count は数分遅れの概算。
member_total = 0
for g in guilds:
    info = get(f"/guilds/{g['id']}?with_counts=true")
    member_total += int(info.get("approximate_member_count") or 0)
    time.sleep(0.25)   # 50 req / s の枠には余るが、行儀よく

new = {"guildCount": len(guilds), "memberTotal": member_total}
print(f"{new['guildCount']} サーバー / {new['memberTotal']} 人")

old = {}
if os.path.exists(OUT):
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        old = {}

if old.get("guildCount") == new["guildCount"] and old.get("memberTotal") == new["memberTotal"]:
    print("前回と同じなので書きません")
    sys.exit(0)

jst = timezone(timedelta(hours=9))
new["at"] = datetime.now(jst).replace(microsecond=0).isoformat()
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(new, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("書きました:", OUT)
