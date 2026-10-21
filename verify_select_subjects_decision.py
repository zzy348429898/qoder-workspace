#!/usr/bin/env python3
"""验证本地 selectSubjects 新增 decision、同档过滤与展示字段截断。token 从环境变量 ABI_TOKEN 读取。"""
import json
import os
import sys
import time
import urllib.request

URL = os.environ.get('ABI_URL', 'http://127.0.0.1:8080/ierp/kapi/v2/abi/ai/selectSubjects')
TOKEN = os.environ.get('ABI_TOKEN')
QUERIES = sys.argv[1:] or ['今年的销售额是多少', '销售主题分析里今年的销售额是多少', '今天北京天气怎么样']


def call(query):
    body = json.dumps({'userQuery': query}).encode()
    req = urllib.request.Request(URL, data=body, method='POST',
                                 headers={'access_token': TOKEN, 'Content-Type': 'application/json'})
    start = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode())
    return payload, time.time() - start


def main():
    if not TOKEN:
        sys.exit('请先设置环境变量 ABI_TOKEN')
    for query in QUERIES:
        print('=' * 20, query)
        try:
            payload, elapsed = call(query)
        except Exception as error:
            print('ERROR:', error, getattr(error, 'read', lambda: b'')().decode()[:500])
            continue
        data = payload.get('data')
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=1)
        # allSubjects 很长，只保留其前面的 decision / selectedSubjects / clarificationMessage
        head, _, tail = text.partition('allSubjects')
        message = tail[tail.find('clarificationMessage'):] if 'clarificationMessage' in tail else ''
        print(f'status={payload.get("status")} errorCode={payload.get("errorCode")} elapsed={elapsed:.1f}s')
        print(head.rstrip())
        print(message.strip()[:400])


if __name__ == '__main__':
    main()
