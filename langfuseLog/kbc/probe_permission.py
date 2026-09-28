#!/usr/bin/env python3
"""权限探测：对比谷钰/白桦在各核心表的可见行数，定位谷钰「灵基签约明细」0 行原因。"""
import json
import time
import urllib.request

URL = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute'
BAI = '1536230697407890389_Aco854NT4YLDbWrm3CHvquhMX8c68HmNTDbex5DC16HkIcbcU4XXnZdAaiekL1qmIHQoqXN3r2AWX5LW81j553sWAjrkAOFOOlgO06'
GUY = '1536230697407890389_16JUB0GdXx55pn58u46TQKV7EdCa41Ong518PvrptOWXXWKO2g5h6TnOo0OJW470D37C01AxA2vZV6OMoxp9x1do5spxrwp1QL3406'
SUB = '409207f5-8295-4330-8a0e-fa93cecdc2a4'


def run(token, sql, label):
    body = json.dumps({'dataSourceType': 'ABI', 'sql': sql, 'subjectId': SUB}).encode()
    req = urllib.request.Request(
        URL, data=body,
        headers={'access_token': token, 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read().decode())
            data = resp.get('data', '')
            # 压缩输出：只显示 rowCount 与数值
            line = data.replace('\n', ' | ')[:200]
            print(f'{label}: {line}')
    except Exception as e:
        msg = e.read().decode()[:200] if hasattr(e, 'read') else str(e)
        print(f'{label}: ERROR {msg}')
    time.sleep(0.8)


TABLES = ['灵基签约明细', '合同-模块分摊合同明细表', '收款-订阅模型新签客户明细表',
          '客户经营任务', '灵基租户使用信息', '老客户促活专项明细表',
          '灵基指标完成情况-机构维度']

print('===== 各表可见行数（谷钰） =====')
for t in TABLES:
    run(GUY, f'SELECT COUNT(*) AS "行数" FROM "{t}"', f'谷钰-{t}')

print()
print('===== 各表可见行数（白桦） =====')
for t in TABLES:
    run(BAI, f'SELECT COUNT(*) AS "行数" FROM "{t}"', f'白桦-{t}')

print()
print('===== 谷钰-签约明细带条件探测 =====')
run(GUY, 'SELECT COUNT(*) AS "行数" FROM "灵基签约明细" WHERE "forganname" = \'杭州\'', '谷钰-签约明细(杭州)')
run(GUY, 'SELECT COUNT(*) AS "行数" FROM "灵基签约明细" WHERE "salechannel" = \'直销\'', '谷钰-签约明细(直销)')

print()
print('===== 白桦-签约明细东区行数(对照基线) =====')
run(BAI, 'SELECT COUNT(*) AS "行数" FROM "灵基签约明细" WHERE "forganname" IN (\'上海\',\'南京\',\'南通\',\'台州\',\'合肥\',\'宁波\',\'无锡\',\'杭州\',\'温州\',\'苏中\',\'苏州\',\'金华\')', '白桦-签约明细(东区12机构)')
