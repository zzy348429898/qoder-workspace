# 对本地调试服务做 jstack 采样，统计归因请求线程的热点帧（定位每条查询的固定开销）
import collections
import re
import subprocess
import sys
import threading
import time

import abi_call
from perf_probe import V3

PID = sys.argv[1]
JSTACK = sys.argv[2] if len(sys.argv) > 2 else "jstack"
ROUNDS = 3

done = threading.Event()


def fire():
    for _ in range(ROUNDS):
        abi_call.call("analyzeAttribution", V3)
    done.set()


threading.Thread(target=fire, daemon=True).start()
frames = collections.Counter()
leaf_frames = collections.Counter()
samples = 0
while not done.is_set():
    out = subprocess.run([JSTACK, PID], capture_output=True, text=True).stdout
    for block in out.split("\n\n"):
        if "AttributionAnalysisDomainV3" not in block:
            continue
        samples += 1
        lines = [l.strip() for l in block.splitlines() if l.strip().startswith("at ")]
        # 取第一个 kingdee 业务帧以下最近的若干层，便于看清楚耗时落在哪一步
        seen = set()
        for l in lines:
            m = re.match(r"at ([\w.$]+)\.([\w$<>]+)\(", l)
            if not m:
                continue
            key = m.group(1).split(".")[-1] + "." + m.group(2)
            if key not in seen:
                frames[key] += 1
                seen.add(key)
        for l in lines[:1]:
            leaf_frames[l] += 1
    time.sleep(0.15)

print("samples:", samples)
print("== 业务相关帧（出现次数 / 占比）==")
for key, count in frames.most_common(200):
    if re.search(r"(abi|Abi|ABI|duckdb|DuckDB|calcite|Calcite|SqlGuard|Permission|Metadata|Catalog|Attach|Pool)", key):
        print("%5d %5.1f%%  %s" % (count, 100.0 * count / max(samples, 1), key))
print("== 栈顶帧 ==")
for key, count in leaf_frames.most_common(15):
    print("%5d  %s" % (count, key[:160]))
