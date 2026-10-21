# 归因 v3 数据集模式端到端验证（主题：归因V3验收_收款计划）
# 基准（sqlExecute 直算）：2025=1,000,000 / 2026=1,300,000，变化 +300,000
#   客户：华东重工 +240,000、中部汽车 +40,000、华南电子 +20,000，其余 0
#   销售组织：华东 +280,000、华南 +20,000、北方 0
#   费用类型：货款 +396,000、服务费 -48,000、运费 -48,000
import copy
import json

import abi_call

SUBJECT = "f015e8ac-b0cd-495f-958b-137b417546f3"
DETAIL_BASE = ('SELECT d."_行ID" AS 行ID, d."费用类型", d."未结算金额", h."客户名称", h."销售组织", '
               'h."单据状态", h."币种", h."签订年份" '
               'FROM "收款计划明细" d JOIN "收款计划表头" h ON d."单据编号" = h."_单据编号"')
DETAIL_SQL = DETAIL_BASE + " WHERE h.\"单据状态\" = '已审核' AND h.\"币种\" = '人民币'"

V3 = {
    "version": "v3",
    "sessionId": "verify-v3-e2e",
    "subjectId": SUBJECT,
    "dataset": {"sql": DETAIL_SQL, "grainKey": "行ID"},
    "metric": {"kind": "absolute", "field": "未结算金额", "aggregation": "sum", "label": "未结算金额"},
    "comparison": {"type": "category", "field": "签订年份", "groupA": "2026", "groupB": "2025"},
    "dimensionAttribution": {"candidates": ["客户名称", "销售组织", "费用类型"]},
    "factorAttribution": False,
}


def run(name, body, api="analyzeAttribution"):
    status, text = abi_call.call(api, body)
    data = json.loads(text)
    print("=" * 110)
    print(name, "| HTTP", status, "| status", data.get("status"), "|", data.get("errorCode"))
    if not data.get("status"):
        print("  message:", (data.get("message") or "")[:700])
    return data


def brief_result(data):
    result = data.get("data") or {}
    base = result.get("base") or {}
    print("  base:", {k: base.get(k) for k in ("comparison_label", "value_a", "value_b", "total_change",
                                                "change_rate", "n_a", "n_b")})
    dim = result.get("dimension") or {}
    print("  dimension.status:", dim.get("status"), "| used:", (dim.get("auto_discovered") or {}).get("candidates_used"))
    for sig in dim.get("significant") or []:
        slices = [(t.get("slice"), t.get("value_a"), t.get("value_b"), t.get("change"),
                   t.get("contribution_share")) for t in sig.get("top_slices") or []]
        print("   -", sig.get("dimension"), "explained_share=", sig.get("explained_share"), slices)
        drill = sig.get("drill_down")
        if drill:
            print("     drill:", drill.get("status"), drill.get("target_slice"),
                  [(x.get("dimension"), x.get("explained_share")) for x in drill.get("significant") or []])
    factor = result.get("factor") or {}
    print("  factor:", factor.get("status"), factor.get("method"), "chart_id=", factor.get("chart_id"),
          [(f.get("name") or f.get("label"), f.get("value_a"), f.get("value_b"), f.get("change"))
           for f in factor.get("factors") or []])
    print("  warnings:", json.dumps(result.get("warnings"), ensure_ascii=False)[:500])
    return result


def variant(**changes):
    body = copy.deepcopy(V3)
    for key, value in changes.items():
        body[key] = value
    return body


# 1. 主子表正确方向：明细为行基准
r1 = brief_result(run("1. v3 主子表（明细 JOIN 表头），category 2026 vs 2025", V3))

# 2. time_period 对比轴（签订年份为 NUMBER）：修复前 A/B 全为 0，修复后应为 130 万 vs 100 万
brief_result(run("2. v3 time_period 对比轴（NUMBER 年份列）", variant(
    comparison={"type": "time_period", "field": "签订年份", "periodA": "2026", "periodB": "2025"})))

# 2b. 对比值在数据中不存在：应报 matched no rows，而不是返回 0 vs 0
run("2b. v3 对比值不存在（2030 vs 2029）", variant(
    comparison={"type": "category", "field": "签订年份", "groupA": "2030", "groupB": "2029"}))

# 3. join 方向错误导致 fan-out：以单据编号作粒度键
run("3. v3 粒度校验：以单据编号为 grainKey（每单 4 行明细）", variant(
    dataset={"sql": DETAIL_SQL.replace('d."_行ID" AS 行ID', 'h."_单据编号" AS 单据编号'), "grainKey": "单据编号"}))

# 4. 列名拼写错误 → did-you-mean
run("4. v3 列名错误（客户名 / 未结算金额x）", variant(
    metric={"kind": "absolute", "field": "未结算金额x", "aggregation": "sum"},
    dimensionAttribution={"candidates": ["客户名", "销售组织"]}))

# 5. grainKey 不在输出列
run("5. v3 grainKey 不在输出列", variant(dataset={"sql": DETAIL_SQL, "grainKey": "_行ID"}))

# 6a. term 级 dimension 写法：此前被静默忽略（三项都等于总量），修复后应按费用类型拆分
brief_result(run("6a. v3 构成项 term 级 dimension 写法", variant(factorAttribution={
    "formula_type": "additive",
    "terms": [
        {"field": "未结算金额", "aggregation": "sum", "dimension": "费用类型", "value": "货款", "label": "货款"},
        {"field": "未结算金额", "aggregation": "sum", "dimension": "费用类型", "value": "运费", "label": "运费"},
        {"field": "未结算金额", "aggregation": "sum", "dimension": "费用类型", "value": "服务费", "label": "服务费"},
    ]})))

# 6b. term 带 value 但没有任何 dimension：应报参数错误
run("6b. v3 构成项 value 缺 dimension", variant(factorAttribution={
    "formula_type": "additive",
    "terms": [{"field": "未结算金额", "value": "货款"}, {"field": "未结算金额", "value": "运费"}]}))

# 6. 指标构成归因：factorAttribution.dimension 写法 + 图表缓存
r6 = brief_result(run("6. v3 指标构成归因（factorAttribution.dimension 写法）", variant(factorAttribution={
    "formula_type": "additive",
    "dimension": "费用类型",
    "terms": [{"value": "货款"}, {"value": "运费"}, {"value": "服务费"}]})))
chart_id = ((r6.get("factor") or {}).get("chart_id"))
if chart_id:
    status, text = abi_call.call("showAttributionChart", {"sessionId": "verify-v3-e2e", "chartId": chart_id,
                                                          "subjectId": SUBJECT})
    data = json.loads(text)
    option = data.get("data") or {}
    print("  showAttributionChart:", data.get("status"), data.get("errorCode"),
          "option keys=", list(option.keys())[:8] if isinstance(option, dict) else type(option))

# 7. ratio 指标：明细行均额 = sum(金额)/count(*)
brief_result(run("7. v3 ratio 指标（金额/行数）", variant(metric={
    "kind": "ratio",
    "numerator": {"field": "未结算金额", "aggregation": "sum"},
    "denominator": {"field": "*", "aggregation": "count"}})))

# 8. 结尾分号（已知问题复核）
run("8. v3 dataset.sql 结尾带分号", variant(dataset={"sql": DETAIL_SQL + ";", "grainKey": "行ID"}))

# 9. 行尾注释（已知问题复核）
run("9. v3 dataset.sql 末尾 -- 注释", variant(dataset={"sql": DETAIL_SQL + " -- 已审核人民币", "grainKey": "行ID"}))

# 10. 空数据集
run("10. v3 空数据集", variant(dataset={"sql": DETAIL_BASE + " WHERE 1 = 0", "grainKey": "行ID"}))

# 11. 非只读 SQL 被拒
run("11. v3 非 SELECT", variant(dataset={"sql": 'DELETE FROM "收款计划明细"', "grainKey": "行ID"}))

# 12. 访问主题外的表（SqlGuard 白名单）
run("12. v3 引用主题外的表", variant(dataset={"sql": 'SELECT * FROM "KBC_ABI_4_1"', "grainKey": "行ID"}))

# 13. v2 回归：表头单表，指标=单据数
brief_result(run("13. v2 回归（不传 version，表头单表 count）", {
    "sessionId": "verify-v3-e2e",
    "subjectId": SUBJECT,
    "table": "收款计划表头",
    "metric": {"kind": "absolute", "field": "*", "aggregation": "count"},
    "comparison": {"type": "category", "field": "签订年份", "groupA": "2026", "groupB": "2025"},
    "dimensionAttribution": {"candidates": ["客户名称"]},
    "factorAttribution": False,
}))
