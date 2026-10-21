# 本地归因接口验证辅助脚本：python3 abi_call.py <api> '<json body>'
# token 从环境变量 ABI_TOKEN 读取，不写入文件
import json
import os
import sys
import urllib.request

BASE = "http://localhost:8080/ierp/kapi/v2/abi/ai/"


def call(api, body):
    req = urllib.request.Request(
        BASE + api,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"access_token": os.environ["ABI_TOKEN"], "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as ex:
        return ex.code, ex.read().decode("utf-8", "ignore")


if __name__ == "__main__":
    status, text = call(sys.argv[1], json.loads(sys.argv[2]))
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
    print("HTTP", status)
    print(text[:limit])
