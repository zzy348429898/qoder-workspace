# ABI 核心设计源码精读

四篇文档对应 ABI 智能体链路上的四个关键设计，均基于 abi-platform 源码逐行核对（基线写在各篇开头）。每篇结构一致：定位 → 代码地图与阅读顺序 → 核心模型 → 主流程精读 → 异常/入口追踪 → 配置 → 设计取舍 → 测试 → 已知问题 → 动手练习 → 自测题。

| 篇 | 主题 | 核心落点 |
| --- | --- | --- |
| [01](01-Leader选举与Fencing.md) | 嵌入式 OpenCode 的 Leader 选举与 Fencing | `EmbeddedHarnessServer`、`LockBasedLeaderElection`、`CacheLeaderEndpointRegistry` |
| [02](02-OpenCode目录隔离.md) | OpenCode 多租户目录隔离 | `OpenCodeDirectoryResolver`、`HarnessFileDomain`、`PathDesensitizer` |
| [03](03-SQL校验与执行管线.md) | NL2SQL 的 SQL 校验与执行管线 | `SqlQueryProcessor`、`SqlGuard`、`ReadOnlyAttachPool` |
| [04](04-行列数据权限.md) | 行级 / 列级数据权限 | `DefaultDataTableEngine.computeMergedRoot`、`createPermissionTempView`、`PermissionExprCompiler` |

建议阅读顺序：01 → 02（同属 Harness 运行时）→ 04 → 03（03 的改写目标是 04 的 `perm_` 视图）。

03 篇的「实测」结论来自 `../sql-pipeline-probe/` 下的探针代码（Calcite 1.41.0 / DuckDB JDBC 1.4.3），可复跑。
