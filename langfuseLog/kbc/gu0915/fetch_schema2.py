#!/usr/bin/env python3
"""补全主题概述原文 + 对比两主题下订阅表语义。"""
import json
import urllib.request

TOKEN = '1536230697407890389_dTwttlzZ576txaJl20yqZRH9wTRkrHRpc6eLa9R7iNnI41MY5GHSIoK24KP2lHW0V2IhX3V4wJxS4dKr7ynVezWjV3rmectLomLk10'
BASE = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/'
SUB_SESSION = '61fd1502-6b48-470f-b00d-1aa91f43afb8'
SUB_CURL = 'b355e270-7660-47b0-babc-7acc6cdba9dd'


def call(path, body, label):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={'access_token': TOKEN, 'Content-Type': 'application/json'}, method='POST')
    print(f'===== {label} =====')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = r.read().decode()
            # 只保留 data 中 usageScenario/tableNotice/subjectNotice 部分，剥掉字段清单
            return resp
    except Exception as e:
        print(f'ERROR: {e}')
        if hasattr(e, 'read'):
            print(e.read().decode()[:1500])
        return None


# 1. 完整主题概述（判断分页）
resp1 = call('getSubjectSchemaOverview', {'subjectId': SUB_SESSION, 'dataSourceType': 'ABI'},
             '1. 规模战业务分析 完整概述')
if resp1:
    obj = json.loads(resp1)
    print('pagination:', obj.get('pagination'))
    data = obj.get('data', '')
    # 打印 subjectNotice 完整段落（到 tables[ 之前）
    i = data.find('subjectNotice: ')
    j = data.find('tables[')
    print(data[i:j if j > 0 else len(data)])
    print()
    # 表清单
    k = 0
    for part in data[j:].split('- tableName: '):
        if k > 0:
            name = part.split('\n')[0]
            src = ''
            if 'tableSourceType: ' in part:
                src = part.split('tableSourceType: ')[1].split('\n')[0]
            print(f'  表: {name}  ({src})')
        k += 1

print()
# 2. KBC收款主题下的订阅表语义
resp2 = call('getTableSchemaDetails',
             {'subjectId': SUB_CURL, 'dataSourceType': 'ABI',
              'tables': ['收款-RBU云订阅业绩构成'],
              'options': {'needStats': False, 'needSample': False}},
             '2. KBC收款主题(b355e270) 订阅表语义')
if resp2:
    obj = json.loads(resp2)
    data = obj.get('data', '')
    # 打印 usageScenario + tableNotice 部分
    i = data.find('usageScenario: ')
    j = data.find('rowCount:')
    print(data[i:j if j > 0 else len(data)])
