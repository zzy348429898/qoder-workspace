# 验证 analyzeAttribution 的 version 分流与 v3 参数校验（本地服务）
import copy
import json

import abi_call

SUBJECT = "f740f54e-66fa-4e02-b31e-8cd6655e5558"
TABLE = "KBC_ABI_4_1"

V2 = {
    "sessionId": "verify-v3",
    "subjectId": SUBJECT,
    "table": TABLE,
    "metric": {"kind": "absolute", "field": "同类平均考核收款年度完成率", "aggregation": "sum"},
    "comparison": {"type": "time_period", "field": "业务日期", "periodA": "2025", "periodB": "2024"},
    "dimensionAttribution": {"candidates": ["机构等级"]},
    "factorAttribution": False,
}

V3 = {
    "version": "v3",
    "sessionId": "verify-v3",
    "subjectId": SUBJECT,
    "dataset": {"sql": 'SELECT * FROM "KBC_ABI_4_1"', "grainKey": "__etl_row_seq__"},
    "metric": {"kind": "absolute", "field": "同类平均考核收款年度完成率", "aggregation": "sum"},
    "comparison": {"type": "time_period", "field": "业务日期", "periodA": "2025", "periodB": "2024"},
    "dimensionAttribution": {"candidates": ["机构等级"]},
    "factorAttribution": False,
}


def case(name, body, api="analyzeAttribution"):
    status, text = abi_call.call(api, body)
    try:
        data = json.loads(text)
        brief = {k: data.get(k) for k in ("status", "errorCode", "message")}
        if data.get("status") and data.get("data"):
            brief["data.base"] = data["data"].get("base")
    except ValueError:
        brief = text[:300]
    print("=" * 100)
    print(name, "| HTTP", status)
    print(json.dumps(brief, ensure_ascii=False)[:900])


def with_(base, **kwargs):
    body = copy.deepcopy(base)
    for key, value in kwargs.items():
        if value is None:
            body.pop(key, None)
        else:
            body[key] = value
    return body


case("1. v2 不传 version（schema 新增嵌套必填不应拦截）", V2)
case("2. v2 显式 version=v2", with_(V2, version="v2"))
case("3. 不传 version 却带 dataset", with_(V2, dataset=V3["dataset"]))
case("4. version=v4 非法", with_(V2, version="v4"))
case("5. v3 合法参数（进入 V3 Domain 探测）", V3)
case("6. v3 传 filters", with_(V3, filters={"机构等级": "一级"}))
case("7. v3 传 table", with_(V3, table=TABLE))
case("8. v3 空 filters 视为未传", with_(V3, filters=[]))
case("9. v3 缺 dataset", with_(V3, dataset=None))
case("10. v3 缺 candidates", with_(V3, dimensionAttribution=False))
case("11. v3 大写 V3 + 下划线 grain_key", with_(V3, version="V3",
                                            dataset={"sql": V3["dataset"]["sql"], "grain_key": "__etl_row_seq__"}))
case("12. 已删除的 /analyzeAttributionV3", V3, api="analyzeAttributionV3")
