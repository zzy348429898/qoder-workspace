#!/usr/bin/env python3
"""用新 token 复放最新 trace(652f99cb) 的关键 SQL，验证当前库值与回答是否一致。"""
import json
import urllib.request

TOKEN = '1536230697407890389_zEtCO4aJheWUe5my0TvS3etYYaq4mAcNz1BFYSqY916kU4HsyvgXOzdQr9Wg7T855DaJ5myJS63G1jy0tnz6Duwt3fG9t4wQcVxn02'
URL = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute'
SUB = '61fd1502-6b48-470f-b00d-1aa91f43afb8'


def run(sql, label, limit=3000):
    body = json.dumps({'dataSourceType': 'ABI', 'sql': sql, 'subjectId': SUB}).encode()
    req = urllib.request.Request(URL, data=body,
        headers={'access_token': TOKEN, 'Content-Type': 'application/json'}, method='POST')
    print(f'===== {label} =====')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print(r.read().decode()[:limit])
    except Exception as e:
        print(f'ERROR: {e}')
        if hasattr(e, 'read'):
            print(e.read().decode()[:600])
    print()


TPL = ('SELECT ROUND(SUM("annualindiceslastm")/1000) AS 年度指标_千元, '
       'ROUND(SUM("annualactualthism")/1000) AS 年度实际_千元, '
       'ROUND(SUM("sametermthism")/1000) AS 累计同期实际_千元, '
       'ROUND(SUM("predictamounthy")/1000) AS 年度累计预测_千元, '
       'ROUND(SUM("annualactualthism")/NULLIF(SUM("annualindiceslastm"),0)*100,1) AS 年度完成率, '
       'ROUND((SUM("annualactualthism")-SUM("sametermthism"))/NULLIF(SUM("sametermthism"),0)*100,1) AS 年度增长率, '
       'ROUND(SUM("predictamounthy")/NULLIF(SUM("annualindiceslastm"),0)*100,1) AS 年度预测完成率 '
       'FROM "收款--RBU{kind}业绩构成" '
       "WHERE \"ymonthfordate\" >= '2026-09-01' AND \"ymonthfordate\" < '2026-10-01' "
       "AND \"productline\" = '金蝶AI套件（基础/专业/高级）' AND \"salechannel\" = '直销'")

# 1. 订阅总体（trace: 255920/152343/73352/169241/59.5/107.7/66.1）
run(TPL.format(kind='云订阅'), '1. 订阅收款总体（单线/直销/2026-09）')

# 2. 考核总体（trace: 621040/346300/185019/400822/55.8/87.2/64.5）
run(TPL.format(kind='整体'), '2. 考核收款总体（单线/直销/2026-09）')

# 3. 订阅南京（trace: 4490/2112/1217/2340/47/73.5/52.1）
run(TPL.format(kind='云订阅') + ' AND "organname" = \'南京\'', '3. 订阅-南京')

# 4. 考核南京（trace: 12090/6695/3908/7864/55.4/71.3/65.0）
run(TPL.format(kind='整体') + ' AND "organname" = \'南京\'', '4. 考核-南京')
