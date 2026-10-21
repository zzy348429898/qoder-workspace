#!/bin/bash
# 轮询 recordSubjectSelection 鉴权是否放行：用非法 action 探测，不会写库。
# token 从环境变量 ABI_TOKEN 读取，不落盘；结果写入 ssr-auth-poll.log。
URL=http://localhost:8080/ierp/kapi/v2/abi/ai/recordSubjectSelection
LOG=/Users/kehua/Desktop/workspace/qoder-workspace/ssr-auth-poll.log
: > "$LOG"
for i in $(seq 1 26); do
  RESP=$(curl -s -m 30 -X POST "$URL" -H 'Content-Type: application/json' \
    -H "access_token: $ABI_TOKEN" -d '{"action":"pick"}' | tr -d '\n\t')
  echo "$(date '+%H:%M:%S') #$i $RESP" >> "$LOG"
  case "$RESP" in
    *'"errorCode":"403"'*) sleep 180 ;;
    *) echo "$(date '+%H:%M:%S') DONE: 鉴权状态已变化" >> "$LOG"; exit 0 ;;
  esac
done
echo "$(date '+%H:%M:%S') TIMEOUT: 78 分钟内仍为 403" >> "$LOG"
