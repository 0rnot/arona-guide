#!/usr/bin/env bash
# TL エディタをゲートの向こう（tl.arona-bot.com）へ送る。
#
# **公開サイトの push だけでは反映されない**（2026-09-03 の先生の指摘
# 「toolが改善されてる気がしないや、進んでんの？反映されてないだけ？」）。
# ゲートは Caddy ではなく tl-gate.service が /opt/tl/site を直に配っていて、
# そこは arona-guide の複製。**直したら必ずこれを走らせる。**
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/arona/cloud/id_arona_cloud"
HOST="ubuntu@161.33.204.156"
DST="/opt/tl/site"

# 送るのはツールが動くのに要るものだけ。ガイド本体（index.html や tl/）は
# 公開サイト側にあるので送らない
rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" \
  --include='tl/***' \
  --include='img/***' \
  --include='cost-timeline/***' \
  --include='tl-engine.js' --include='tool.css' \
  --include='hint.js' --include='share.js' --include='tour.js' \
  --exclude='*' \
  "$SRC/tools/" "$HOST:$DST/tools/"

rsync -az -e "ssh -i $KEY -o BatchMode=yes" \
  "$SRC/style.css" "$SRC/favicon.svg" "$HOST:$DST/"

echo "送りました: $HOST:$DST"
