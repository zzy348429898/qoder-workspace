# 面试速记：ABI 智能体四大机制与两套安全答法

> 依据：abi-platform 当前代码（已核对关键类）。标「⚠ 缺口」的是代码里没有、面试时别说成已落地的点。

## 0. 先避坑：最容易穿帮的 4 句话

| 别这么说 | 实际情况 |
| --- | --- |
| "SQL 由 DirectSqlQueryValidator 校验" | 它**没有任何调用方**，也没有测试。主链路实际用的是 abi-data-table 的 **Calcite 管线**（`SqlQueryProcessor` → `SqlGuard`） |
| "DuckDB 关了外部访问" | 全仓库没有 `enable_external_access` / `lock_configuration`。外部访问目前靠 AST 层拦表函数和敏感函数 |
| "用 epoch 做了完整 fencing" | 只有**节点自我降级**（self-fencing）。OpenCode 进程和下游请求都不校验 epoch |
| "每个会话一个沙箱" | 隔离方式是**约定的 cwd 目录**，不是 OS 沙箱。兜底靠 opencode.json 里的 `bash: deny`、`external_directory: deny` |

主动讲出这些缺口和改进方案，比被追问后才承认要加分很多。

---

## 1. EmbeddedHarnessServer：leader 选举与 fencing

**30 秒版**：多节点部署时，整个集群只允许一个节点拉起 OpenCode 子进程。分布式锁只用来让竞选者串行化，真正代表"谁是 leader"的是缓存里一条带 TTL 的记录 `{epoch, url}`。epoch 由 `INCR` 发号、单调递增，当 fencing token 用：旧 leader 看到更大的 epoch 就自己下台。

### 画图

```
            ┌──────────── 中间件 ─────────────┐
            │ DLock  abi...embedded.startup  │  ← 只在选举临界区持有
            │ Cache  endpoint={epoch,url} 300s│  ← 真正的 "leader 租约"
            │ Cache  epoch (INCR, 永不过期)   │  ← fencing token 发号器
            └───────▲──────────────▲──────────┘
     竞选/每60s续约 │              │ 每60s读取 + 健康检查
   ┌────────────────┴──┐     ┌────┴───────────────┐
   │ 节点A  Leader      │     │ 节点B/C  Follower   │
   │ opencode serve:4096│◄────│ OpenCodeClient 直连 │ 业务流量（不转发）
   │ control:4097       │◄────│ status/restart/... │ 管理流量
   └────────────────────┘     └────────────────────┘
```

### 竞选流程（`LockBasedLeaderElection.tryElect`）

1. `tryLock(300s)` 拿到全局锁。
2. **二次检查**：注册表里已经有健康 leader，就让位。
3. `nextEpoch()` = `incrBy(epoch, 1)`，拿到新任期。
4. `becomeLeader(epoch)`：迁移目录 → 解压 → 清理孤儿进程 → 拉起 opencode → `waitForReady`（最长 300s）→ 设置角色 → 启动控制端口 → `publish({epoch,url})`。
5. finally 中释放锁。整个进程启动过程都在锁内完成。

### 关键数字

| 项 | 值 |
| --- | ---: |
| 心跳周期 | 60s |
| endpoint TTL | 300s（可容忍错过 4 次续约） |
| follower 判定故障 | 连续 3 次健康检查失败（约 3 分钟） |
| 锁等待 / 进程就绪超时 | 300s / 300s |
| 自重启限流 | 300s 内最多 3 次 |

### 三处 epoch 守卫

- **自我降级**：`LeaderRole.onHeartbeat` 中，若 `current.epoch > myEpoch`，执行 `demote()`：停控制端口 → 杀进程 → 变为 Follower。
- **写守卫**：`publish` 时，若注册表里的 epoch 比自己大，就不覆盖。
- **删守卫**：`release(epoch)` 只删除 epoch 等于自己的记录。

### GC 停顿时间线（必讲）

旧 leader（epoch=5）停顿 → follower 连续 3 次健康检查失败 → 拿锁、二次检查仍不健康 → INCR 得到 6、拉起进程、publish 6 → 旧 leader 恢复，下一次心跳读到 6 > 5，自杀并降级。
**双进程窗口最长约 60s。**

### 缺陷与改进（主动讲）

| 缺陷 | 改进 |
| --- | --- |
| `publish`/`release` 先读再写，不是 CAS，存在旧记录覆盖新记录的窗口（最终会收敛） | 用 Lua 脚本做"比较 epoch 后再 SET/DEL" |
| 缓存不可达时 `current()` 返回 null，被当作"未被取代"，网络分区下旧 leader 永不下台 | 改成租约语义：续约连续失败超过 TTL 减去安全余量，就主动下台 |
| fencing 只在节点侧，资源侧不校验 token | 请求和共享存储写入带上 epoch，由资源侧拒绝旧 token（OpenCode 不支持，需要在网关层做） |
| 切换期没有 drain，SSE 会话直接断 | 前端断线重连，再加上会话状态从 data 目录恢复 |
| 控制端口 4097 无鉴权 | 加内部签名或 mTLS |
| 启动失败后进入永久 FAILED，心跳不启动 | FAILED 状态下仍保持 Follower 心跳，允许后续重新竞选 |

---

## 2. OpenCodeDirectoryResolver：目录隔离

**30 秒版**：所有租户共用一个 OpenCode 进程。每个会话通过 `?directory=` 查询参数指定独立的 cwd，OpenCode 按 directory 区分 Instance、工具 cwd 和事件总线。路径从服务端 `RequestContext` 计算，客户端无法指定。

### 画图

```
{abi.ai.harness.directory}            (默认 .../ABIStorage/ABIHarness，需共享存储)
 ├─ config/   AGENTS.md, skills/, opencode.json   全局共享，对 agent 只读（skills edit=deny）
 ├─ data/     XDG_DATA_HOME  OpenCode 的 session/message 存储（全局）
 ├─ cache/    XDG_CACHE_HOME
 └─ workspace/{tenantId}/{accountId}/{userId}/          ← resolve()：createSession 用
                                         └─{ses_xxx}/   ← resolve(sessionId)：prompt/事件流/文件等
```

### 防护分层（resolver 本身只拼字符串，安全由周边类分担）

1. **身份不可伪造**：tenant、account、user 取自 `RequestContext`，请求参数里只带 sessionId。
2. **归属校验**：`assertSessionOwnership` 在 DB 中查询"当前用户 + sessionId"是否存在。
3. **读文件防穿越**（`HarnessFileDomain`）：依次执行 `restore`（脱敏路径还原）→ `rebaseToCurrentSession` → `normalize` → `startsWith(base)`（按路径段比较），最后只把相对路径传给 OpenCode。
4. **出站脱敏**（`PathDesensitizer`）：真实路径改写成 `/mnt/workspace`，前端看不到租户和用户 ID。
5. **工具权限**（opencode.json）：`bash`、`task`、`webfetch`、`websearch`、`lsp` 全部 deny；`external_directory: {"*": deny}`，只放行读取 skills。

### 缺陷（主动讲）

- sessionId 未经白名单校验（例如 `^ses_[A-Za-z0-9]+$`）就拼进路径。
- 归属校验覆盖不全：SSE 对话、status、revert、replyPermission 等接口没做，存在水平越权风险。
- 读文件用 `normalize` 而不是 `toRealPath`，符号链接能绕过（导出功能已经用了 realPath，两处不一致）。
- 删除会话时不删目录，也没有 TTL 清理，每个 directory 都是常驻 Instance，靠内存超限重启兜底。

---

## 3. SQL 校验层次（主链路实际生效的版本）

**链路**：LLM → `sql_execute.ts` → `/kapi/v2/abi/ai/sqlExecute` → `AiService.sqlExecute` → `ABIRecallDomain`（主题权限）→ `DefaultDataTableEngine.executeQueryByBizTag` → DuckDB

```
L0 工具侧(TS)   仅 SELECT/WITH 开头；字面量/注释感知的多语句检测
L1 Calcite解析  parseQuery 只收单条查询 → DML/DDL/ATTACH/COPY/PRAGMA/INSTALL 直接解析失败
                根节点 ∈ {Select, With, OrderBy, Union/Intersect/Except}
L2 SqlGuard     作用域递归(CTE/子查询/WHERE 子查询都扫)
                FROM 只允许 表名/JOIN/子查询 → read_csv/read_parquet/glob 等表函数一律拒
                表白名单 = 主题内资源；CTE/别名与 perm_ 同名冲突 → 拒(防绕过权限视图)
L3 函数黑名单   通用: CURRENT_USER/VERSION/CURRENT_SETTING...
                DuckDB: GETENV/READ_TEXT/READ_BLOB/CHECKPOINT/NEXTVAL... + 带引号的 "user" 回退绑定
L4 业务规则     必须字段（币别/单位等，语义正确性约束）
L5 定点改写     按 AST 坐标在原文上把虚拟表名换成 perm_<table>，其余字符不动
执行层          :memory: root + ATTACH READ_ONLY；60s 查询超时；memory_limit；JVM 侧截断 1000 行
```

**设计取舍**：
- 解析失败只返回通用的"SQL 语法无效"，不回显输入 token，安全优先于让模型自我修正。
- 白名单、表不存在等错误给出可操作的中文提示，让模型能自己修 SQL。

**缺口**：
- Calcite（BABEL 方言）负责校验，DuckDB 负责执行，存在方言差异，理论上有"校验看到的和执行的不一致"的空间。
- 标量函数只靠枚举黑名单。
- 没有注入 LIMIT，大查询靠超时和内存上限兜底。

---

## 4. 行级、列级权限在哪一层生效

**一句话**：两者都在**数据源层**生效，即 DuckDB 连接级的 TEMP VIEW（`DefaultDataTableEngine`）。不在 SQL 生成阶段拼 WHERE，也不在 abi-core 的 Cuboid 内存里过滤。上层 SQL 只看得到 `perm_` 视图，对权限完全无感。

```
图表/仪表板(abi-core) ┐
ChatBI NL2SQL         ├─→ hasTableAccess(空间/发布 资源级, fail-closed)
数据集预览/导出        ┘        │
                               ▼
               DefaultDataTableEngine.getConnection
               ├ computeMergedRoot
               │   Persist_Cfg(ABI 自配): 命中分组之间 OR；未命中走 defaultRule
               │   Runtime_Cfg(苍穹 SPI 实时 QFilter): 与 Persist 做 AND 收紧
               │   隐藏列: 各来源取并集
               └ createPermissionTempView
                   CREATE TEMP VIEW "perm_t" AS
                     SELECT a, b, CAST(NULL AS DECIMAL) AS "salary"   ← 列级: NULL 占位
                     FROM db.t WHERE dept_id IN (...)                 ← 行级: WHERE（denyAll 时 1=0）
                   + select 1 from perm_t 探测(提前暴露类型错误)
                               ▼
               上层 SQL: SELECT ... FROM perm_t ...
```

**为什么列级用 NULL 占位而不是删列**：列序、类型和 Schema 保持不变，计算字段和上层 SQL 不需要改。给 LLM 看的 schema 则相反，会直接移除不可读列（`AbiSchemaAccessService`）。

**fail-closed 设计点**：
- 系统变量缺失时报错。
- 列元数据查询失败时不降级为 `SELECT *`。
- `MACRO_VAR` 一律拒绝（防谓词注入）。
- 拒绝前端传入 subQuery。
- 权限结果不跨请求缓存。

**缺口**：
- AI 数据画像采集器走无上下文的重载，只过滤列、不过滤行，样本和 min/max 可能来自用户无权查看的行。
- CONST 值靠转义后拼接，不是参数化查询。

---

## 5. 标准答法：Agent 写操作安全

> 框架是通用设计。**幂等键、UNKNOWN 回填、读写串并行这三项在仓库里没找到实现**，面试时按"我们的设计原则 / 我会怎么做"来讲；工具分级和 HITL 可以拿本系统举例。

1. **工具分级**：按副作用把工具分为只读、可逆写、不可逆或对外三级，默认最小权限。
   - 本系统例子：opencode.json 把 `bash`、`task`、`webfetch`、`websearch` 设为 deny，`external_directory` 设为 deny，skills 只读不可改。
   - 读工具（`sql_execute`）只读；写工具（注册仪表板、语义写回）单独管控。
2. **幂等键**：每次写调用由服务端生成 `idempotencyKey`（会话 ID + 工具调用 ID），写入去重表并加唯一约束。LLM 重试或网络重放时直接返回第一次的结果。
3. **超时回填 UNKNOWN 并提供状态查询**：超时不等于失败。把结果回填为 `UNKNOWN` 交给模型，同时提供 `get_operation_status(key)` 工具，并在提示词中约束"UNKNOWN 必须先查状态，禁止直接重试"。
4. **写串行、读并行**：同一会话（或同一资源）的写操作进入串行队列或加分布式锁；读操作允许并行（本系统的 AGENTS.md 也要求"独立工具并行调用"）。
5. **HITL 确认**：不可逆或对外的操作走"人工确认"。
   - 本系统例子：OpenCode 的 permission ask 配合 `replyPermission`、question 工具配合 `replyQuestion`，前端弹窗确认。
   - Prompt 层约束："破坏性操作前必须确认""查数过程中不得自动写回语义"。
   - 关键是**确认由服务端强制执行**，而不是只靠 prompt 约定。

**一句收尾**：prompt 约束是软防线，工具权限和服务端校验才是硬防线，两者都要有。

---

## 6. 标准答法：NL2SQL 安全

| 防线 | 本系统落地 | 状态 |
| --- | --- | --- |
| AST 白名单 | Calcite `parseQuery` 只接受单条查询；FROM 拦截表函数；表白名单 = 主题资源；敏感函数黑名单；CTE 遮蔽检测 | 已有 |
| 只读账号 | 不直连业务库，查的是物化文件。`:memory:` root 加 `ATTACH ... (READ_ONLY)` | 已有（形式是只读挂载，不是 DB 账号） |
| 关闭外部访问 | 目前只靠 L2/L3 拦截 | ⚠ 缺口。改进方向：ATTACH 完成后执行 `SET enable_external_access=false`（或用 `allowed_directories` 只放行数据目录）、`SET lock_configuration=true`、关闭 `autoinstall/autoload_known_extensions` |
| 执行层权限改写 | 表名改写为 `perm_` TEMP VIEW：行级 WHERE，列级 NULL 占位 | 已有 |
| 切断外泄通道 | agent 侧 webfetch/websearch/bash 都是 deny；`COPY TO` 无法通过解析；结果截断 1000 行；路径脱敏；错误信息不回显输入；schema 移除不可读列 | 已有（画像采集不过滤行是缺口） |

**讲法顺序**：先说"不信任 LLM 产出的 SQL，按纵深防御来做"，再从外到内讲 5 层，最后点出"外部访问配置是我们下一步要补的"。改进方案里，`enable_external_access` 和 ATTACH 的先后顺序要先在 DuckDB 1.4 上实测。

---

## 7. 高频追问速答

- **为什么不用 ZK 临时节点直接当 leader 锁？** 锁要跨越 300s 的进程启动，而且 DLock 是线程绑定的。拆成"短锁 + 带 TTL 的 endpoint 记录"之后，续约和锁解耦，follower 也能直接从记录里发现地址。
- **为什么 follower 不做转发？** OpenCode 绑定 0.0.0.0，客户端直连少一跳，SSE 也不需要代理。代价是 leader 切换时所有客户端都要重建。
- **权限为什么放在视图层而不在 SQL 生成层？** 三类入口（引擎、QueryDSL、NL2SQL）都会经过同一个 `getConnection`，只有一个落点，LLM 写的任意 SQL 也绕不过去。
- **列隐藏后，计算字段会怎样？** 结果变成 NULL，不报错也不泄露原值，但可能产生误导性的结果（比如 `coalesce` 之后看起来有值）。
