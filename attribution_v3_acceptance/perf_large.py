# 万级主题（应收单表头 5,000 / 收款计划明细 ~5 万）归因性能与结果基准
# 用法：python3 perf_large.py [输出文件名]   结果 JSON 写入该文件，用于优化前后逐字段比对
import copy
import json
import statistics
import sys
import time

import abi_call

SUBJECT = "252887e2-e059-4925-928c-bdb8d9fd947e"
DATASET_SQL = ('SELECT d."行ID", d."费用类型", d."未结算金额", d."计划收款日期", h."客户名称", h."销售组织", '
               'h."产品线", h."签订年份", h."签订日期" '
               'FROM "收款计划明细_万级" d JOIN "应收单表头_万级" h ON d."单据编号" = h."单据编号" '
               "WHERE h.\"单据状态\" = '已审核' AND h.\"币种\" = '人民币'")
V3 = {
    "version": "v3", "sessionId": "perf-large", "subjectId": SUBJECT,
    "dataset": {"sql": DATASET_SQL, "grainKey": "行ID"},
    "metric": {"kind": "absolute", "field": "未结算金额", "aggregation": "sum"},
    "comparison": {"type": "time_period", "field": "签订年份", "periodA": "2026", "periodB": "2025"},
    "dimensionAttribution": {"candidates": ["销售组织", "产品线", "费用类型", "客户名称"]},
    "factorAttribution": False,
}


def variant(**kw):
    body = copy.deepcopy(V3)
    body.update(kw)
    return body


CASES = [
    ("v3 4 维度 + 下钻", V3),
    ("v3 4 维度，关闭下钻", variant(drillDown=False)),
    ("v3 1 维度，关闭下钻", variant(dimensionAttribution={"candidates": ["销售组织"]}, drillDown=False)),
    ("v3 4 维度 + 下钻 + 构成项", variant(factorAttribution={
        "formula_type": "additive", "dimension": "费用类型",
        "terms": [{"value": "货款"}, {"value": "运费"}, {"value": "服务费"}, {"value": "安装费"}]})),
    ("v3 ratio（金额/行数）4 维度", variant(metric={
        "kind": "ratio", "numerator": {"field": "未结算金额", "aggregation": "sum"},
        "denominator": {"field": "*", "aggregation": "count"}})),
    ("v3 DATE 列 time_range", variant(comparison={
        "type": "time_range", "field": "签订日期",
        "periodA": {"start": "2026-01-01", "end": "2027-01-01"},
        "periodB": {"start": "2025-01-01", "end": "2026-01-01"}})),
    ("v2 单表（表头）count 3 维度", {
        "sessionId": "perf-large", "subjectId": SUBJECT, "table": "应收单表头_万级",
        "metric": {"kind": "absolute", "field": "*", "aggregation": "count"},
        "comparison": {"type": "category", "field": "签订年份", "groupA": "2026", "groupB": "2025"},
        "dimensionAttribution": {"candidates": ["销售组织", "产品线", "客户名称"]}, "factorAttribution": False}),
]


def strip_volatile(data):
    """去掉每次都会变的字段（chart_id、性能告警），只留可比对的归因结论。"""
    result = copy.deepcopy(data.get("data") or {})
    factor = result.get("factor") or {}
    if factor.get("chart_id"):
        factor["chart_id"] = "<chart>"
    result["warnings"] = [w for w in (result.get("warnings") or []) if w.get("kind") != "performance_budget_exceeded"]
    return {"status": data.get("status"), "errorCode": data.get("errorCode"), "result": result}


def main(out_file, rounds=3):
    snapshot = {}
    for name, body in CASES:
        costs, data = [], None
        for _ in range(rounds):
            start = time.time()
            _, text = abi_call.call("analyzeAttribution", body)
            costs.append((time.time() - start) * 1000)
            data = json.loads(text)
        base = (data.get("data") or {}).get("base") or {}
        print("%-34s ok=%-5s 每次(ms)=%-22s 中位=%6.0f  A=%s B=%s" % (
            name, data.get("status"), [int(c) for c in costs], statistics.median(costs),
            base.get("value_a"), base.get("value_b")))
        if not data.get("status"):
            print("   ", (data.get("message") or "")[:300])
        snapshot[name] = {"median_ms": statistics.median(costs), "payload": strip_volatile(data)}
    json.dump(snapshot, open(out_file, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "perf_large_result.json")
