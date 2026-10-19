#!/usr/bin/env bash
# 一键跑全部 verify：先在 8080 起一个临时数据目录的本地服务器（ADMIN_KEY=test-admin-key-verify、价格 mock），再依次运行全部 verify*.js。
# 用法：bash scripts/verify-all.sh [verify-xxx ...]   （需先 npm ci 与 npx playwright install chromium-headless-shell）
set -u; cd "$(dirname "$0")/.."; D=$PWD
T=$(mktemp -d /tmp/wt-verify-XXXX); for f in *.js *.json; do case $f in verify*|package-lock.json) ;; *) cp "$f" "$T/";; esac; done
ln -s "$D/node_modules" "$T/node_modules"; ln -s "$D/public" "$T/public"; mkdir "$T/data"
if curl -s -o /dev/null --max-time 2 http://localhost:8080/; then echo "8080 已被占用，请先停掉旧服务器"; exit 2; fi
(cd "$T" && PORT=8080 D1_API_TOKEN= PRICE_MOCK=1 ADMIN_KEY=test-admin-key-verify exec node server.js > "$T/server.log" 2>&1) & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8080/api/health && break; sleep 0.5; done
export BASE=http://localhost:8080/ WT_DATA="$T/data" ADMIN_KEY=test-admin-key-verify
LIST=${*:-$(ls verify*.js | sed 's/\.js$//')}; fail=0
for v in $LIST; do s=$(date +%s); node "$v.js" > "$T/$v.log" 2>&1; c=$?; last=$(grep -v '^\s*$' "$T/$v.log" | tail -1 | cut -c1-90)
  printf '%-20s %s  %3ss  %s\n' "$v" "$([ $c = 0 ] && echo PASS || echo FAIL)" "$(( $(date +%s) - s ))" "$last"; [ $c = 0 ] || fail=1; done
echo "logs: $T"; git checkout -q -- screenshot.png 2>/dev/null; exit $fail
