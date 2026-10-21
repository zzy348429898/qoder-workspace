# 归因 analyzeAttribution 按 version 分流（v2 单表 + v3 数据集）及维度合并查询

本次发布把归因 V3 数据集模式并进同一个 `analyzeAttribution` 接口，用 `version` 分流：不传或 `v2` 走原 `AttributionAnalysisDomain`，`v3` 走 `AttributionAnalysisDomainV3`，把 `dataset.sql` 包成虚拟表 `t`，并在执行前做列探测和粒度键校验。v2 同时带上几项有意的行为变化：A/B 都无命中时报参数错误、纯年份列期间条件修复、factor term 级 `dimension` 生效，以及维度切片（含下钻 base）合成一条 `UNION ALL`，失败时退回逐条查询。预插 SQL 重建了 v2 接口参数树并更新 MCP 描述。

Watch for：`Dataset` 同时有 `setSql` / `setSQL`，Jackson 绑定会直接报错，而且 v2 请求也受影响（确认冲突，影响面取决于网关绑定用的 JSON 库）；重复的维度候选在合并路径下切片行会翻倍，结果和回退路径不一致（确认）；MCP 描述上线当天就把 v3 暴露给模型，和"窗口期全部走 v2"的目标有冲突（可能）。

**Verdict**: NEEDS_CHANGES

## High-level view

合并查询的列对齐、dim_idx 拆分、base 分支、ratio 列都已在真实 DuckDB 1.4.3 上与逐条查询逐行比对一致（覆盖 6 种聚合 × 2 种 null 处理 × 有无 base），SqlGuard 也会把每个分支改写到权限视图。各分支表达式相同、slice 已显式 VARCHAR，PG/StarRocks 下 UNION 类型分歧风险低（未实跑）。问题在边界上：重复候选会让切片行翻倍；合并查询如果因为超时或资源不足失败，回退会把整条链路再跑一遍。

请求模型层面，`AttributionAnalysisRequest.Dataset` 用别名 setter 兼容 `SQL` / `grain_key`。FastJSON 能用，但 FastJSON 的 smartMatch 本来就能匹配这两个别名，这两个 setter 是多余的；而在 Jackson 下，`setSql` 和 `setSQL` 会归一成同一个属性 `sql`，构建反序列化器时直接抛异常。因为 `Dataset` 是顶层请求的属性，不带 `dataset` 的 v2 请求同样会失败。

V3 解析复用了 v2 的 metric/comparison 解析，但绕过了 `validateRawRequest`，因此丢掉了"ratio 指标不接受显式 factorAttribution"这条拒绝规则。V3 的探测层把所有异常统一包成参数错误，权限、连接、超时这类问题也会提示"检查 dataset SQL"。factor term 过滤落在对比字段上时被静默丢弃，不像 v2 那样给出冲突 warning。

期间条件重构对 v2 是等价改写，但年份编码忽略了 `end` 边界，跨年的 time_range 落到年份列上会被截断到起始年。

预插 SQL 可重复执行、在 abi.xml 中的顺序正确，非 TAG 列 248/250 字节未超过 0714 惯例的上限。需要确认：`_L` 按 FENTRYID 删除会连带删掉所有语种的行。

<details>
<summary>Issues (12)</summary>

1. **Dataset 双 setter 与 Jackson 冲突**（确认冲突 / 影响面待验证）：删除 `setSQL`（FastJSON 1.2.83 的 smartMatch 实测已能把 `SQL` 映射到 `sql`），`setGrain_key` 一并删掉；同时确认 OpenAPI 网关和 MCP schema 生成用的是哪个 JSON 库。
2. **重复候选维度在合并路径下行翻倍**（确认）：在 `fetchSlices` 里先对 candidates 做 LinkedHashSet 去重，或者按下标而不是维度名存放切片行。
3. **MCP 描述提前暴露 v3**（可能）：如果窗口期必须全部是 v2，可以把 version/dataset 的参数和描述放到 skill 切换时再发布，或者接受这个风险并在监控里按 version 统计。
4. **合并失败无差别回退**（需验证）：超时、OOM 这类失败会让整条链路重跑一遍，并多记一次 ERROR 日志。只对 SQL 校验或绑定类错误做回退，其余错误直接按逐条语义处理，或者给合并查询单独设超时。
5. **V3 未拒绝 ratio + factorAttribution**（确认）：在 `AttributionRequestParserV3` 补上与 v2 相同的校验。
6. **V3 探测层把所有异常映射成参数错误**（确认）：只包装 SQL 校验、解析、绑定错误，权限和基础设施异常原样抛出。
7. **V3 term 过滤与对比字段冲突时静默丢弃，且过滤字段不在白名单内**（确认）：返回冲突 warning，并把 term filters / `factorAttribution.dimension` 字段纳入 `validateColumns`。
8. **年份编码忽略 end 边界**（确认）：年份列上非整年的 time_range 会被截断到起始年。end 不在 1 月 1 日时按年向上取整，或者直接报参数错误。
9. **DatasetProbe 的 DATE 推断在 ABI 通道是死代码**（确认）：`convertTemporalToDate` 已经把时间值转成了字符串，日期列都会被推断为 STRING。要么修正注释，要么改用 ResultSet 元数据里的类型。
10. **下钻 base SQL 构建移出了 try**（确认，实际几乎不会触发）：构建异常不再降级为下钻 warning，而是让整个请求失败。把构建挪回 try 内即可。
11. **预插 SQL 删除 `_L` 时连带删掉其他语种**（需验证）：确认生产环境是否有翻译平台回灌的 en_US/zh_TW 行；如果有，改为按 FPKID 或 `FLOCALEID='zh_CN'` 删除。
12. **avg/median 指标在指标值全为空时报"没有命中行"**（确认，边界情况）：n_a/n_b 统计的是非空指标值，报错文案会误导；文案里补充"指标值全为空"这种可能。

</details>

<details>
<summary>Details</summary>

### Dataset 别名 setter 让 Jackson 绑定整体失败

`AttributionAnalysisRequest.Dataset`（abi-extension-api，第 73-91 行）同时声明了 `setSql(String)` 和 `setSQL(String)`。按 Jackson 默认的属性命名规则，二者都归一成 `sql`；参数类型相同，`resolveSetterConflict` 无法裁决，构建 `Dataset` 的反序列化器时会抛 `InvalidDefinitionException: Conflicting setter definitions for property "sql"`。我用插件模块 classpath 里的 jackson-databind 2.16.2 实测：不带 `dataset` 的 v2 请求体同样失败，因为顶层 BeanDeserializer 在 resolve 阶段就会构造属性 `dataset` 的反序列化器。FastJSON 1.2.83 下两种请求都能正常绑定。

影响面取决于 Cosmic OpenAPI 用什么 JSON 库绑定 `@ApiRequestBody`，仓库里查不到这部分代码。`attribution_v3_acceptance/verify_version_routing.py` 曾经在本地 kapi 上跑通过，说明本地这条链路大概率是 FastJSON。但只要网关、MCP 工具 schema 生成（插件 classpath 里有 jackson-module-jsonSchema）或其他中间层用 Jackson 去 introspect 这个类，就会在发布当天打断所有 v2 调用。这两个 setter 在 FastJSON 下本来就多余（smartMatch 已覆盖 `SQL` 和 `grain_key`，实测通过），直接删掉成本最低。

### 重复候选维度让合并结果与逐条结果不一致

`splitMergedRows`（DimensionAttributionAnalyzer 第 203-224 行）先按维度名执行 `rowsByDimension.put(dimension, new ArrayList)`，再按 `dimensions.get(index)` 取列表追加行。候选里出现同一个维度两次时（比如 `["客户","客户"]`），第二次 put 会覆盖第一次，于是 dim_idx=0 和 dim_idx=1 两个分支的切片都追加进同一个列表，每个 slice 出现两次。`evaluate` 对这两次候选使用的都是这份翻倍后的行。回退路径则是按名字覆盖、最后写入的生效，行数是正确的。所以同一个请求，走合并路径和走回退路径会得到不同的结论。

v2 的显式候选不去重：`DimensionCandidateSelector.selectExplicitCandidates` 原样保留，DC 数据源更是直接 `new ArrayList<>(candidates)`。V3 也不去重。模型偶尔会给出重复候选，这时切片贡献合计变成实际变化的两倍，集中度门槛更容易通过，`explained_share` 可能超过 1（数值影响为 likely，行翻倍为 confirmed）。

### 合并查询失败一律回退

`fetchSlices`（第 174-186 行）和 V3 的 `fetchGrainCheckedBase`（第 121-141 行）对合并查询的任何异常都回退到逐条查询。如果失败原因是合并 SQL 不被支持，这样做没问题；但如果是超时、内存或连接问题（合并后一条语句要扫 N+1 次表，V3 还要把 dataset SQL 内联 N+1 份，单条最长可达 ~20KB×(N+1)），回退会把整个工作量再跑一遍：总时延等于合并超时时间加原逐条耗时。另外，每次失败 `ABIRecallDomain.sqlExecute` 已经会 `LogUtil.error` 带堆栈，这里再记一条 warn。DuckDB 的绑定错误信息可能带出 SQL 里的字面量（对比值、切片值）。

我没有核实 DuckDB 读连接或 DC 通道上是否配置了语句级超时，这是性能风险而不是正确性问题。建议只在 `DataTableAccessException.SQL_INVALID` 或解析、绑定类错误时回退。

### V3 解析与 v2 的校验差异

`AttributionRequestParserV3.parse` 调用 `delegate.parseV3`，绕过了 `validateRawRequest`。metric/comparison/aggregation 的形态校验在 `parseMetric`/`validateTerm` 里仍然生效，但"ratio 指标不支持显式 factor_attribution"只存在于 `validateRawRequest`（AttributionRequestParser 第 104-106 行）。V3 收到 ratio + factorAttribution 时，`buildFactorOut` 直接走 ratio 拆解并忽略 factor 配置，调用方得不到提示。

`DatasetProbe.executeProbe`（第 97-106 行）捕获 `Exception` 后统一抛 `IllegalArgumentException("Dataset probe failed ... Verify the dataset SQL is a valid read-only query")`，`AiService` 据此映射为 `ABI_AI_ATTRIBUTION_PARAM_ERROR`。`SubjectPermissionDeniedException`、DW 连接失败、超时都会落到这条路径，调用方（AI）会被引导去改写 SQL。v2 对同类异常返回的是 `ABI_AI_ATTRIBUTION_ERROR`。

`combineTermConditionDataset`（AttributionSqlBuilder 第 565-590 行）在 term 过滤字段等于对比字段时直接返回 base 条件，`AttributionSql` 的 conflicts 始终为空，不会产生 v2 那样的 `filter_conflict_with_comparison` warning。该构成项会静默退化为总量。另外，`validateColumns` 只收集 metric/comparison/candidates/term.field，不包括 term filters 字段和 `factorAttribution.dimension`。这类字段写错时得到的是 `factor_query_failed` warning（status=skipped），而不是带 did-you-mean 的参数错误。

### 年份编码的边界不完整

`periodCodeLiteral` 在年份编码下只取 `value.getYear()`，`end` 参数没有使用（第 717-727 行）。季度、月、子年度 time_range 落到年份列上时得到 `>= 2025 AND < 2025`，空集会被新的 `requireMatchedRows` 拦成参数错误，这是可以接受的。但跨年区间（如 2024-07-01~2025-07-01）会被截断成 `>= 2024 AND < 2025`，结果非空、不报错，口径被悄悄缩小了。

### V3 列类型推断

ABI 通道的 `ABIRecallDomain.sqlExecute` 在返回前调用 `convertTemporalToDate`，把 Timestamp/Date/LocalDate 都转成了 String，所以 `DatasetProbe.inferColumnType` 里的 DATE 分支在 ABI 通道永远不会命中，日期列被推断为 STRING。当前的期间条件在 STRING + `yyyy-MM-dd` 样例下会走默认的字符串字面量分支，对 DATE 列仍然能得到正确条件，所以目前没有错误结果。但类型推断的注释（"Timestamp/Date→DATE"）与实际不符，后续如果有人依赖 DATE 类型做分支判断，会踩坑。

### 下钻与 base 校验的小差异

`DrillDownAnalyzer` 第 65-77 行把 base SQL 的构建移到了 try 之外。原实现中构建异常会降级成 `dimension_query_failed(drill_down...)`；现在会向上抛出，导致整个请求失败。由于主 base 用同样的输入已经构建成功，实际几乎不会触发。

`BaseFacts.requireMatchedRows` 在单一 avg/median 指标下读取的 n_a/n_b 是 `COUNT(非空指标值)`。数据行存在但指标值全为空时，也会报"Comparison matched no rows"，并建议检查对比值格式，方向是误导的。

### 预插 SQL

`kd_1.5_sys_openapi_ai_attribution_version_1015.sql` 第 11-15 行按 FENTRYID 删除 `t_open_apibodyentry_L`，会删掉所有语种。0513 原脚本按 FPKID 只删 zh_CN 行。如果生产环境由翻译平台回灌过这些参数的 en_US/zh_TW 描述，执行后这些描述会丢失，而且不会恢复。0921 脚本有同样的写法，所以团队里有先例，但需要确认这些参数是否存在多语种行。MCP 的 UPDATE 用 FID/FAPI_ID/工具名三重限定，但随后对 `_L` 的 DELETE + INSERT 没有限定；在没有该工具的环境里会留下一条孤儿 `_L` 行，影响很小。

上线节奏方面：参数树里新增的 `version`/`dataset` 以及 FDESCRIPTION 中对 v3 的说明，会在 Java 发布当天被 MCP 网关拉取，模型从这时起就能看到 v3 用法。描述里写了"仅在归因技能明确要求时使用"，但模型是否遵守无法保证；在 v2 报错后自行切到 v3 是比较典型的行为。如果"窗口期全部是 v2"是硬约束，参数树和描述应该等 skill 切换时再发布；如果不是硬约束，至少要在日志或监控里按 version 统计调用量。

### 验证记录

- `mvn -o test -pl bos-abi-mservice/code/abi-ai`，范围为 attribution 相关的 13 个测试类、70 个用例，全部通过（先 `install` 了当前暂存版本的 abi-extension-api 到本地仓库，否则会因 SNAPSHOT 过期报 NoSuchMethodError）。
- DuckDB 1.4.3 实测：v2 和 V3 合并 SQL 的结果与逐条 SQL 逐行一致，列 Java 类型一致；V3 dataset 以 `WITH` 开头并带结尾 `-- 注释;` 时可以正常嵌入。
- SqlGuard（`SqlQueryProcessor.getDuckDb()`）实测：合并 SQL 与粒度+base SQL 都能通过，每个分支各自改写为权限视图。开启必须字段规则（amount→region）时，合并 SQL 与单条 SQL 同样被拒绝，这是既有行为，不是本次引入的。
- 未验证：PostgreSQL/GreenPlum/StarRocks 上的 UNION ALL 实际执行（按 SQL 结构判断风险低）；OpenAPI 网关的 JSON 绑定库；语句级超时配置；生产 `_L` 表的语种分布。

</details>

<details>
<summary>File map</summary>

- `abi-extension-api/.../AttributionAnalysisRequest.java`：新增 `version`、`dataset{sql,grainKey}` 及别名 setter，更新参数说明。
- `abi-ai/.../algorithm/DimensionAttributionAnalyzer.java`：维度切片合并查询、按 dim_idx 拆分、失败回退；新增 `analyzeWithBase` 供下钻使用。
- `abi-ai/.../algorithm/DrillDownAnalyzer.java`：下钻 base 与剩余维度合成一次查询；支持 V3 dataset 形态。
- `abi-ai/.../sql/AttributionSqlBuilder.java`、`MetricSqlExpressionBuilder.java`：dataset 形态 SQL、合并 SQL、粒度+base SQL；期间条件改为带列引用的形态，新增纯年份编码。
- `abi-ai/.../support/AttributionRequestParser.java`：`parseV3`；v2 拒绝 dataset；term 级 dimension 生效，value 缺少 dimension 时报错。
- `abi-ai/.../support/AttributionRequestParserV3.java`、`AttributionVersion.java`：V3 校验与 version 解析。
- `abi-ai/.../domain/AttributionAnalysisDomainV3.java`、`dataset/*`：V3 编排、列探测、粒度校验、列名纠错建议。
- `abi-ai/.../domain/AttributionAnalysisDomain.java`、`model/BaseFacts.java`：A/B 都无命中时报参数错误。
- `mservice-abi/.../AiService.java`：按 version 分流；粒度错误使用独立错误码。
- `datamodel/.../abi.xml`、`kd_1.5_sys_openapi_ai_attribution_version_1015.sql`：参数树重建与 MCP 描述更新。
- 测试：ParserV3、SqlBuilder、Version、BaseFacts、DimensionMergedQuery、DatasetProbe、GrainKeyValidator。

完整 diff：`git diff --cached HEAD~1 -- '*attribution*' '*Attribution*' .../AiService.java bos-abi-plugin bos-abi-common/code/abi-extension-api bos-abi-mservice/datamodel`

</details>
