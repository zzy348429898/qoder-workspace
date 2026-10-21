# analyzeAttribution 接口参数说明

接口：`POST /kapi/v2/abi/ai/analyzeAttribution`（MCP 工具 `data_abi_post_v2_abi_ai_analyzeattribution`）

一个接口，按 `version` 分两种模式：

| 模式 | 触发 | 分析对象 | 过滤写在哪 |
| --- | --- | --- | --- |
| v2 单表 | 不传 `version` 或传 `v2` | `table` 指定的一张表 | `filters` |
| v3 数据集 | `version: "v3"`（大小写不敏感） | `dataset.sql` 的结果集，可跨表 JOIN | `dataset.sql` 的 WHERE |

## 一、顶层参数

| 参数 | v2 | v3 | 作用 |
| --- | --- | --- | --- |
| `version` | 不传 / `v2` | `v3` | 选择模式；其他值报参数错误 |
| `sessionId` | 必传 | 必传 | 会话 ID，用于图表缓存 |
| `subjectId` | 必传 | 必传 | ABI 为主题 ID；DC 为目录 ID |
| `dataSourceType` | 可选 | 可选 | `ABI`（默认）/ `DC` |
| `spaceId` | DC 必传 | DC 必传 | DC 空间 ID |
| `table` | **必传** | **不得传** | 归因的数据表 |
| `filters` | 可选 | **不得传** | 全局过滤条件 |
| `dataset` | **不得传** | **必传** | 见第二节 |
| `metric` | 必传 | 必传 | 分析什么指标，见第三节 |
| `comparison` | 必传 | 必传 | A 和 B 怎么分，见第四节 |
| `dimensionAttribution` | 可选 | **candidates 必传** | 按哪些维度找原因，见第五节 |
| `factorAttribution` | 可选 | 可选 | 按指标构成找原因，见第六节 |
| `drillDown` | 可选 | 可选 | 一层下钻，见第七节 |
| `thresholds` | 可选 | 可选 | 判定显著的阈值，见第八节 |
| `channel` | 不传 | 不传 | 渠道 ABI/KWORK，空则按 KWORK；skill 约定不传 |
| `userIdentityTag` | 可选 | 可选 | 用户身份标识，透传给图表缓存做鉴权 |

## 二、dataset（仅 v3）

| 字段 | 作用 |
| --- | --- |
| `sql` | 明细查询 SQL，后端包成子查询 `(...) AS t` 当虚拟表；只能是单条 SELECT / WITH，结尾分号会自动去掉，有长度上限 |
| `grainKey` | 行粒度键列名（`sql` 的输出列）；后端校验 `COUNT(*) = COUNT(DISTINCT grainKey)`，不等报 `ABI_AI_ATTRIBUTION_DATASET_GRAIN_ERROR`，用来拦截 JOIN 方向错误导致的金额放大 |

v3 下，`metric`、`comparison`、`candidates`、`factorAttribution` 里出现的字段名，都必须是 `sql` 的输出列名。后端执行前会探测输出列，写错时会给出「你是不是想写 X」的提示。

## 三、metric：分析什么指标

两种类型，由 `kind` 指定；不传时，有 `numerator` / `denominator` 就按 ratio，否则按 absolute。

**absolute（可加总的量，如金额、数量）**

```json
{ "kind": "absolute", "field": "未结算金额", "aggregation": "sum" }
```

| 字段 | 作用 |
| --- | --- |
| `field` | 指标列 |
| `aggregation` | `sum`（默认）/ `avg` / `median` / `count` / `count_distinct`；`field: "*"` 只能配 `count` |
| `terms` | 多字段组合，如 `[{field:"收入"}, {field:"成本", operator:"-"}]`，可带 `coefficient` |
| `label` | 指标显示名，不传时用「字段(聚合)」 |

**ratio（比率，如毛利率、单价）**

```json
{ "kind": "ratio", "numerator": {"field": "毛利"}, "denominator": {"field": "收入"} }
```

分子和分母各自可以是字段名字符串、`{field, aggregation}` 或 `{terms}`。ratio 不能再传 `factorAttribution`，构成解释会自动走「结构效应 / 个体效应」拆解。

## 四、comparison：A 和 B 怎么分

它是对比轴，不是过滤条件。结果里 A 是当前值（`value_a`），B 是参照值（`value_b`）。

| type | 写法 | 例子 |
| --- | --- | --- |
| `category` | `groupA` / `groupB` | `{type:"category", field:"区域", groupA:"华东", groupB:"华南"}` |
| `time_period` | `periodA` / `periodB` | `{type:"time_period", field:"签订年份", periodA:"2026", periodB:"2025"}` |
| `time_range` | `periodA` / `periodB` 为 `{start, end, label?}` | `{type:"time_range", field:"业务日期", periodA:{start:"2026-01-01", end:"2026-04-01"}, ...}` |

- `time_period` 支持四种格式：`2026`、`2026Q1` 或 `2026-Q1`、`2026-03`、`2026-03-15`。都会转成左闭右开区间。
- `time_range` 的日期格式是 `yyyy-MM-dd`，区间左闭右开，`start` 必须早于 `end`。
- 对比字段可以是日期列、`YYYYMM` / `YYYYMMDD` 数字编码列，也可以是纯年份列，后端按字段类型和样例值生成条件。

## 五、dimensionAttribution：按维度找原因

回答「差距集中在哪个分组」。传 `false` 跳过。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `candidates` | — | 候选维度列。v2 不传时自动发现；**v3 必传**，后端不做自动发现 |
| `top_k` | 2 | 每个维度取贡献最大的前几个切片 |
| `min_group_size` | 5 | 切片两期样本行数都小于该值时剔除 |
| `max_cardinality` | 100 | 只在 v2 自动发现时用于排除高基数字段；显式传 candidates 时不生效 |
| `null_handling` | `exclude` | 维度值为空的行：`exclude` 剔除，`as_group` 归为一组 |

重复的候选维度会自动去重。

## 六、factorAttribution：按指标构成找原因

回答「哪个构成项在带动变化」。不传或传 `false` 时跳过，至少需要 2 个构成项。

| 字段 | 作用 |
| --- | --- |
| `formula_type` | `additive`（默认，A = B + C）/ `multiplicative`（A = B × C，用 LMDI 拆解；构成项不能带 `operator` 或 `coefficient`） |
| `terms` | 构成项列表（也接受 `factors` 这个键名） |
| `dimension` | 按某个分类列的取值拆分构成，所有 terms 共用 |

**terms 的两种写法**

- 字段公式：每项是一个指标字段，比如 `[{field:"收入"}, {field:"成本", operator:"-"}]`。
- 分类取值：主指标按某列的取值拆开，比如：

```json
{ "formula_type": "additive", "dimension": "费用类型",
  "terms": [{"value": "货款"}, {"value": "运费"}, {"value": "服务费"}] }
```

这种写法要求 `metric` 是单字段 absolute。`value` 必须配合 `dimension` 使用：可以写在 `factorAttribution` 上让所有项共用，也可以写在每个 term 上，term 上的优先。缺 `dimension` 会报错。

返回里的 `passed_threshold` 只会标记贡献绝对值最大的前 2 项，图表也只高亮这 2 项。

## 七、drillDown：一层下钻

默认开启。找到显著维度后，在贡献最大的切片里，再用其余候选维度拆一层。传 `false` 关闭。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | true | 开关 |
| `min_explained_share` | 0.3 | 上层维度的解释度达到 30% 才下钻 |
| `min_slice_size` | 20 | 目标切片的样本行数不足时返回 `skipped_small_sample` |

## 八、thresholds：判定「显著」的阈值

同时满足下面两条，维度或构成项才判为 `found`；否则返回 `fallback_*`，表示没找到集中的原因。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `concentration_min` | 0.6 | 前几个切片（构成项）的贡献绝对值合计至少占总变化的 60% |
| `deviation_ratio` | 0.5 | 前几个里至少一个的变化率，和整体变化率的差距不小于「0.5 × 整体变化率的绝对值」；用来排除「各组同比例变化」的情况 |

## 九、完整示例

**v2（单表）**

```json
{
  "sessionId": "...", "subjectId": "...", "dataSourceType": "ABI",
  "table": "销售订单",
  "filters": [{"field": "单据状态", "op": "=", "value": "已审核"}],
  "metric": {"kind": "absolute", "field": "价税合计", "aggregation": "sum"},
  "comparison": {"type": "time_period", "field": "业务日期", "periodA": "2026", "periodB": "2025"},
  "dimensionAttribution": {"candidates": ["销售组织", "客户"]}
}
```

`filters` 的 `op` 支持 `=`、`!=`、`in`、`not_in`、`>`、`>=`、`<`、`<=`、`between`、`like`。也可以写成 `{conditions:[...], relation:"and"}` 条件树，或 `{字段: 值}` 简写。

**v3（数据集，跨表）**

```json
{
  "version": "v3",
  "sessionId": "...", "subjectId": "...", "dataSourceType": "ABI",
  "dataset": {
    "sql": "SELECT d.\"行ID\", h.\"客户名称\", h.\"销售组织\", h.\"签订年份\", d.\"费用类型\", d.\"未结算金额\" FROM \"收款计划明细\" d JOIN \"收款计划表头\" h ON d.\"单据编号\" = h.\"单据编号\" WHERE h.\"签订年份\" IN (2025, 2026) AND h.\"单据状态\" = '已审核'",
    "grainKey": "行ID"
  },
  "metric": {"kind": "absolute", "field": "未结算金额", "aggregation": "sum"},
  "comparison": {"type": "time_period", "field": "签订年份", "periodA": "2026", "periodB": "2025"},
  "dimensionAttribution": {"candidates": ["费用类型", "销售组织", "客户名称"]},
  "factorAttribution": {"formula_type": "additive", "dimension": "费用类型",
                        "terms": [{"value": "货款"}, {"value": "运费"}, {"value": "服务费"}]}
}
```

## 十、常见报错对照

| 报错片段 | 原因 |
| --- | --- |
| `version only supports v2/v3` | `version` 值非法 |
| `dataset is only supported when version=v3` | 没传 `version: "v3"` 却带了 dataset |
| `table is not supported when version=v3` / `filters is not supported...` | v3 传了 v2 专用参数 |
| `dataset.grainKey is required` | v3 缺粒度键 |
| `ABI_AI_ATTRIBUTION_DATASET_GRAIN_ERROR` | 粒度键不唯一，通常是 JOIN 方向反了，导致金额被放大 |
| `Comparison matched no rows` | A、B 两组都没命中数据，一般是对比值格式不对 |
| `ratio metric does not support explicit factor_attribution` | ratio 指标传了 factorAttribution（目前只有 v2 会拦） |
| `value requires a dimension` | 构成项写了 `value` 但没给 `dimension` |
