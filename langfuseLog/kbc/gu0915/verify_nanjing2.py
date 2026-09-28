#!/usr/bin/env python3
"""南京行深挖：全月份快照 + 分产品线，判断数据是否中途变更。"""
import json
import urllib.request

URL = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute'
TOKEN = '1536230697407890389_dTwttlzZ576txaJl20yqZRH9wTRkrHRpc6eLa9R7iNnI41MY5GHSIoK24KP2lHW0V2IhX3V4wJxS4dKr7ynVezWjV3rmectLomLk10'
SUB = '61fd1502-6b48-470f-b00d-1aa91f43afb8'


def run(token, sql, label, limit=15000):
    body = json.dumps({'dataSourceType': 'ABI', 'sql': sql, 'subjectId': SUB}).encode()
    req = urllib.request.Request(
        URL, data=body,
        headers={'access_token': token, 'Content-Type': 'application/json'},
        method='POST')
    print(f'===== {label} =====')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print(r.read().decode()[:limit])
    except Exception as e:
        print(f'ERROR: {e}')
        if hasattr(e, 'read'):
            print(e.read().decode()[:1500])
    print()


# 1. 南京全月份、全产品线快照（不过滤时间，看表里存了几个月的快照）
SQL1 = ("SELECT t.ymonth AS 数据时间, t.productline AS 产品线, t.salechannel AS 业务线, "
        "t.annualindiceslastm AS 年度指标, t.annualactualthism AS 年度实际, "
        "t.sametermthism AS 累计同期, t.predictamounthy AS 年度预测, t.gapthism AS 缺口 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.organname = '南京' ORDER BY t.ymonth, t.productline, t.salechannel")

# 2. 全表有哪些数据时间（快照月份分布）
SQL2 = ("SELECT t.ymonth AS 数据时间, COUNT(*) AS 行数, "
        "ROUND(SUM(t.annualactualthism)/1000) AS 年度实际合计_千元 "
        "FROM \"收款--RBU云订阅业绩构成\" t GROUP BY t.ymonth ORDER BY t.ymonth")

# 3. 单产品线口径（表注意事项中"AI套件订阅业绩"的口径）下的南京
SQL3 = ("SELECT t.organname AS 机构, t.organrank AS 机构等级, "
        "ROUND(SUM(t.annualindiceslastm)/1000) AS 年度指标_千元, "
        "ROUND(SUM(t.annualactualthism)/1000) AS 年度实际_千元, "
        "ROUND(SUM(t.sametermthism)/1000) AS 累计同期实际_千元, "
        "ROUND(SUM(t.annualactualthism)/NULLIF(SUM(t.annualindiceslastm),0)*100,1) AS 年度完成率, "
        "ROUND((SUM(t.annualactualthism)-SUM(t.sametermthism))/NULLIF(SUM(t.sametermthism),0)*100,1) AS 年度增长率, "
        "ROUND(SUM(t.gapthism)/1000) AS 累计缺口_千元 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.productline = '金蝶AI套件（基础/专业/高级）' "
        "AND t.salechannel = '直销' "
        "AND t.ymonthfordate >= '2026-09-01' AND t.ymonthfordate < '2026-10-01' "
        "AND t.organname = '南京' GROUP BY t.organname, t.organrank")

run(TOKEN, SQL1, '1. 南京-全月份全产品线快照')
run(TOKEN, SQL2, '2. 全表快照月份分布')
run(TOKEN, SQL3, '3. 单产品线口径(AI套件)下的南京(直销/2026-09)')
