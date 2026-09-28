#!/usr/bin/env python3
"""实测 getTableSchemaDetails / getSubjectSchemaOverview，取回完整语义配置原文。"""
import json
import urllib.request

TOKEN = '1536230697407890389_dTwttlzZ576txaJl20yqZRH9wTRkrHRpc6eLa9R7iNnI41MY5GHSIoK24KP2lHW0V2IhX3V4wJxS4dKr7ynVezWjV3rmectLomLk10'
BASE = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/'
SUB_SESSION = '61fd1502-6b48-470f-b00d-1aa91f43afb8'   # gu0915 会话实际主题：规模战业务分析
SUB_CURL = 'b355e270-7660-47b0-babc-7acc6cdba9dd'       # 用户 curl 里的 subjectId


def call(path, body, label, limit=20000):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={'access_token': TOKEN, 'Content-Type': 'application/json'}, method='POST')
    print(f'===== {label} =====')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print(r.read().decode()[:limit])
    except Exception as e:
        print(f'ERROR: {e}')
        if hasattr(e, 'read'):
            print(e.read().decode()[:1500])
    print()


# 1. 会话主题：订阅收款表的详情（单横线 + 双横线两种表名都试）
call('getTableSchemaDetails',
     {'subjectId': SUB_SESSION, 'dataSourceType': 'ABI',
      'tables': ['收款-RBU云订阅业绩构成', '收款--RBU云订阅业绩构成'],
      'options': {'needStats': False, 'needSample': False}},
     '1. getTableSchemaDetails @61fd1502 订阅收款表(单/双横线)')

# 2. 会话主题概述（取完整 subjectNotice）
call('getSubjectSchemaOverview',
     {'subjectId': SUB_SESSION, 'dataSourceType': 'ABI'},
     '2. getSubjectSchemaOverview @61fd1502(规模战业务分析)')

# 3. 用户 curl 的 subjectId 是什么主题
call('getSubjectSchemaOverview',
     {'subjectId': SUB_CURL, 'dataSourceType': 'ABI'},
     '3. getSubjectSchemaOverview @b355e270(用户curl的subjectId)')
