#!/usr/bin/env python3
"""用白桦/谷钰两个 token 重查灵基主题，验证 trace 诊断结论（数据时点差 + 行级权限）。"""
import json
import urllib.request

URL = 'https://ierp.kingdee.com/ierp/kapi/v2/abi/ai/sqlExecute'
BAI = '1536230697407890389_Aco854NT4YLDbWrm3CHvquhMX8c68HmNTDbex5DC16HkIcbcU4XXnZdAaiekL1qmIHQoqXN3r2AWX5LW81j553sWAjrkAOFOOlgO06'
GUY = '1536230697407890389_16JUB0GdXx55pn58u46TQKV7EdCa41Ong518PvrptOWXXWKO2g5h6TnOo0OJW470D37C01AxA2vZV6OMoxp9x1do5spxrwp1QL3406'
SUB = '409207f5-8295-4330-8a0e-fa93cecdc2a4'


def run(token, sql, label, limit=4000):
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


# 1. 核心验证：东区机构完成数（两条 trace 的原始口径）
SQL1 = ('SELECT "机构", "f17880932803661" AS "整体实际完成数", "f17880932803660" AS "整体签约金额", '
        '"f17880955402600" AS "老客户增购完成数", "f17885080489340" AS "组合新签完成数" '
        'FROM "灵基指标完成情况-机构维度" WHERE "区域" LIKE \'东区%\' ORDER BY "f17880932803661" DESC')

# 2. 权限验证：指标表无过滤（谷钰预期只见东区，白桦预期全国 64 行）
SQL2 = 'SELECT "机构", "区域" FROM "灵基指标完成情况-机构维度" ORDER BY "机构"'

# 3. 权限验证：签约明细计数（谷钰预期 0，白桦预期 ~687）
SQL3 = 'SELECT COUNT(*) AS "行数" FROM "灵基签约明细"'

# 4. 促活漏斗（东区，两条 trace 的促活口径）
SQL4 = ('SELECT COUNT(DISTINCT "kded_sn_customer_number") AS "开通数", '
        'COUNT(DISTINCT CASE WHEN ("f17878298373861" > 0 OR "f17878298373863" > 0) '
        'THEN "kded_sn_customer_number" END) AS "使用客户数", '
        'COUNT(DISTINCT CASE WHEN "增购客户" IS NOT NULL AND "增购客户" != \'\' '
        'THEN "kded_sn_customer_number" END) AS "增购数" '
        'FROM "老客户促活专项明细表" WHERE "区域" LIKE \'东区%\'')

run(BAI, SQL1, '白桦-东区机构完成数')
run(GUY, SQL1, '谷钰-东区机构完成数')
run(GUY, SQL2, '谷钰-指标表无过滤(看权限范围)')
run(BAI, SQL2, '白桦-指标表无过滤(看权限范围)')
run(GUY, SQL3, '谷钰-灵基签约明细计数')
run(BAI, SQL3, '白桦-灵基签约明细计数')
run(BAI, SQL4, '白桦-促活漏斗(东区)')
run(GUY, SQL4, '谷钰-促活漏斗(东区)')
