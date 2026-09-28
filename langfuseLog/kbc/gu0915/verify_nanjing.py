#!/usr/bin/env python3
"""用新 token 重放 gu0915 turn5 的 SQL，验证南京订阅收款行数据。"""
import json
import urllib.request

URL = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute'
TOKEN = '1536230697407890389_dTwttlzZ576txaJl20yqZRH9wTRkrHRpc6eLa9R7iNnI41MY5GHSIoK24KP2lHW0V2IhX3V4wJxS4dKr7ynVezWjV3rmectLomLk10'
SUB = '61fd1502-6b48-470f-b00d-1aa91f43afb8'  # 规模战业务分析


def run(token, sql, label, limit=12000):
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


# 1. turn5 原始 SQL：三产品线合并、直销、2026-09，但只取南京（防分片 IO 错误）
SQL1 = ("SELECT t.organname AS 机构, t.organrank AS 机构等级, "
        "ROUND(SUM(t.annualindiceslastm)/1000) AS 年度指标_千元, "
        "ROUND(SUM(t.annualactualthism)/1000) AS 年度实际_千元, "
        "ROUND(SUM(t.sametermthism)/1000) AS 累计同期实际_千元, "
        "ROUND(SUM(t.predictamounthy)/1000) AS 年度累计预测_千元, "
        "ROUND(SUM(t.annualactualthism)/NULLIF(SUM(t.annualindiceslastm),0)*100,1) AS 年度完成率, "
        "ROUND((SUM(t.annualactualthism)-SUM(t.sametermthism))/NULLIF(SUM(t.sametermthism),0)*100,1) AS 年度增长率, "
        "ROUND(SUM(t.predictamounthy)/NULLIF(SUM(t.annualindiceslastm),0)*100,1) AS 年度预测完成率, "
        "ROUND(SUM(t.gapthism)/1000) AS 累计缺口_千元 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.productline IN ('Kingdee AI Suite', '金蝶AI套件（基础/专业/高级）', '金蝶AI星空企业版/标准版') "
        "AND t.salechannel = '直销' "
        "AND t.ymonthfordate >= '2026-09-01' AND t.ymonthfordate < '2026-10-01' "
        "AND t.organname = '南京' "
        "GROUP BY t.organname, t.organrank")

# 2. 南京分产品线明细（看三条产品线各贡献多少）
SQL2 = ("SELECT t.productline AS 产品线, t.salechannel AS 业务线, "
        "t.annualindiceslastm AS 年度指标, t.annualactualthism AS 年度实际, "
        "t.sametermthism AS 累计同期, t.predictamounthy AS 年度预测, t.gapthism AS 缺口, "
        "t.ymonth AS 数据时间 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.ymonthfordate >= '2026-09-01' AND t.ymonthfordate < '2026-10-01' "
        "AND t.organname = '南京' ORDER BY t.productline, t.salechannel")

# 3. 对照：turn5 输出中南京附近几行（青岛/南京/沈阳/西安），复核转写是否串行
SQL3 = ("SELECT t.organname AS 机构, t.organrank AS 机构等级, "
        "ROUND(SUM(t.annualindiceslastm)/1000) AS 年度指标_千元, "
        "ROUND(SUM(t.annualactualthism)/1000) AS 年度实际_千元, "
        "ROUND(SUM(t.sametermthism)/1000) AS 累计同期实际_千元, "
        "ROUND(SUM(t.predictamounthy)/1000) AS 年度累计预测_千元, "
        "ROUND(SUM(t.gapthism)/1000) AS 累计缺口_千元 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.productline IN ('Kingdee AI Suite', '金蝶AI套件（基础/专业/高级）', '金蝶AI星空企业版/标准版') "
        "AND t.salechannel = '直销' "
        "AND t.ymonthfordate >= '2026-09-01' AND t.ymonthfordate < '2026-10-01' "
        "AND t.organname IN ('青岛', '南京', '沈阳', '西安', '南宁', '重庆') "
        "GROUP BY t.organname, t.organrank ORDER BY t.organname")

# 4. 合计行复核
SQL4 = ("SELECT '合计' AS 机构, "
        "ROUND(SUM(t.annualindiceslastm)/1000) AS 年度指标_千元, "
        "ROUND(SUM(t.annualactualthism)/1000) AS 年度实际_千元, "
        "ROUND(SUM(t.sametermthism)/1000) AS 累计同期实际_千元, "
        "ROUND(SUM(t.predictamounthy)/1000) AS 年度累计预测_千元, "
        "ROUND(SUM(t.gapthism)/1000) AS 累计缺口_千元 "
        "FROM \"收款--RBU云订阅业绩构成\" t "
        "WHERE t.productline IN ('Kingdee AI Suite', '金蝶AI套件（基础/专业/高级）', '金蝶AI星空企业版/标准版') "
        "AND t.salechannel = '直销' "
        "AND t.ymonthfordate >= '2026-09-01' AND t.ymonthfordate < '2026-10-01'")

run(TOKEN, SQL1, '1. turn5口径-南京(三产品线合并/直销/2026-09)')
run(TOKEN, SQL2, '2. 南京分产品线明细')
run(TOKEN, SQL3, '3. 南京及相邻机构对照')
run(TOKEN, SQL4, '4. 合计行复核')
