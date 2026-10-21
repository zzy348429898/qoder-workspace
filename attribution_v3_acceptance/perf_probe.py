# 归因性能拆解：整体耗时 vs 单条 sqlExecute 耗时（主题：归因V3验收_收款计划）
import copy
import json
import statistics
import time

import abi_call

SUBJECT = "f015e8ac-b0cd-495f-958b-137b417546f3"
DETAIL_SQL = ('SELECT d."_行ID" AS 行ID, d."费用类型", d."未结算金额", h."客户名称", h."销售组织", '
              'h."单据状态", h."币种", h."签订年份" '
              'FROM "收款计划明细" d JOIN "收款计划表头" h ON d."单据编号" = h."_单据编号" '
              "WHERE h.\"单据状态\" = '已审核' AND h.\"币种\" = '人民币'")
V3 = {
    "version": "v3", "sessionId": "perf", "subjectId": SUBJECT,
    "dataset": {"sql": DETAIL_SQL, "grainKey": "行ID"},
    "metric": {"kind": "absolute", "field": "未结算金额", "aggregation": "sum"},
    "comparison": {"type": "category", "field": "签订年份", "groupA": "2026", "groupB": "2025"},
    "dimensionAttribution": {"candidates": ["客户名称", "销售组织", "费用类型"]},
    "factorAttribution": False,
}


def bench(name, api, body, rounds=3):
    costs, data = [], None
    for _ in range(rounds):
        start = time.time()
        _, text = abi_call.call(api, body)
        costs.append((time.time() - start) * 1000)
        data = json.loads(text)
    print("%-52s ok=%-5s 每次(ms)=%-22s 中位=%6.0f" % (name, data.get("status"), [int(c) for c in costs],
                                                     statistics.median(costs)))
    return statistics.median(costs)


def sql(name, statement, rounds=3):
    return bench("sqlExecute: " + name, "sqlExecute",
                 {"sessionId": "perf", "subjectId": SUBJECT, "sql": statement}, rounds)


def with_(**kw):
    body = copy.deepcopy(V3)
    body.update(kw)
    return body


if __name__ == "__main__":
    print("—— 单条查询耗时 ——")
    sql("SELECT 1（通道固定开销）", "SELECT 1 AS x")
    sql("单表 COUNT", 'SELECT COUNT(*) AS n FROM "收款计划明细"')
    sql("探针 LIMIT 1（dataset 子查询）", "SELECT * FROM (\n" + DETAIL_SQL + "\n) AS t LIMIT 1")
    sql("粒度 COUNT DISTINCT", 'SELECT COUNT(*) AS a, COUNT(DISTINCT "行ID") AS b FROM (\n' + DETAIL_SQL + "\n) AS t")
    sql("维度切片 GROUP BY", 'SELECT "客户名称", SUM("未结算金额") AS v FROM (\n' + DETAIL_SQL + '\n) AS t GROUP BY 1')
    print("—— 归因整体耗时 ——")
    bench("v3 3 维度 + 下钻", "analyzeAttribution", V3)
    bench("v3 1 维度（无下钻）", "analyzeAttribution",
          with_(dimensionAttribution={"candidates": ["客户名称"]}, drillDown=False))
    bench("v3 3 维度，关闭下钻", "analyzeAttribution", with_(drillDown=False))
    bench("v3 3 维度 + 下钻 + 构成项", "analyzeAttribution", with_(factorAttribution={
        "formula_type": "additive", "dimension": "费用类型",
        "terms": [{"value": "货款"}, {"value": "运费"}, {"value": "服务费"}]}))
    bench("v2 单表（明细）1 维度", "analyzeAttribution", {
        "sessionId": "perf", "subjectId": SUBJECT, "table": "收款计划明细",
        "metric": {"kind": "absolute", "field": "未结算金额", "aggregation": "sum"},
        "comparison": {"type": "category", "field": "费用类型", "groupA": "货款", "groupB": "运费"},
        "dimensionAttribution": {"candidates": ["单据编号"]}, "factorAttribution": False})
