# LangGraph.js 学习路线

> 本路线基于 LangGraph.js 官方教程与最佳实践，按由浅入深的原则划分为 6 个阶段、13 个项目。
> 每个项目聚焦 2-3 个核心概念，通过动手编码加深理解。

---

## 进度总览

| 阶段 | 项目编号 | 项目名称 | 核心概念 | 状态 |
|------|---------|---------|---------|------|
| 一 | 01 | 基础聊天机器人 | State · Reducer · Node · Edge · compile · invoke · stream | ✅ 已完成 |
| 二 | 02 | 条件边与动态路由 | ConditionalEdge · 路由函数 · 动态分支 | ⬜ 未开始 |
| 二 | 03 | 工具调用与 Function Calling | ToolNode · ToolMessage · bindTools | ⬜ 未开始 |
| 二 | 04 | ReAct 智能体 | Agent 循环 · 工具调用循环 · ToolNode 集成 | ⬜ 未开始 |
| 三 | 05 | 记忆与持久化 | Checkpoint · MemorySaver · 线程ID · 状态恢复 | ⬜ 未开始 |
| 三 | 06 | 人机交互（Human-in-the-Loop） | interrupt · Command · 人审审批 · 恢复执行 | ⬜ 未开始 |
| 四 | 07 | 子图与组合 | Subgraph · 图嵌套 · 状态映射 | ⬜ 未开始 |
| 四 | 08 | 并行执行与 Map-Reduce | 并行边 · Send · 动态扇出 · 结果聚合 | ⬜ 未开始 |
| 四 | 09 | 复杂路由与状态机 | 多条件路由 · 循环图 · 状态机模式 | ⬜ 未开始 |
| 五 | 10 | 多智能体 Supervisor | Supervisor 模式 · Agent 分工 · 任务分发 | ⬜ 未开始 |
| 五 | 11 | 多智能体协作 | Agent 通信 · 消息传递 · 协作模式 | ⬜ 未开始 |
| 六 | 12 | RAG 检索增强生成 | 检索节点 · 向量存储 · 知识图谱集成 | ⬜ 未开始 |
| 六 | 13 | 生产部署与流式 UI | LangGraph Studio · 流式 UI · 部署 · 监控 | ⬜ 未开始 |

---

## 阶段一：基础概念 ✅

### 项目 01：基础聊天机器人 ✅ 已完成

**目录**：`project-01-basic-chatbot/`

**已掌握的核心概念**：
- **State** — 图的全局状态（数据容器），在节点间流转
- **Annotation & Reducer** — 定义 State 结构和字段合并策略（拼接 vs 覆盖）
- **Node** — 图中的处理单元（函数：接收 state → 返回部分更新）
- **Edge** — 节点间的静态连接（声明式路由）
- **StateGraph** — 把 Node 和 Edge 组装成图
- **compile** — 编译图为可执行应用
- **invoke** — 单次同步调用
- **stream** — 流式调用（逐步获取中间结果）

**图结构**：
```
START → chatbot → END
```

**关键文件**：
- `src/index.ts` — 完整实现（含交互式聊天）
- `src/verify.ts` — Mock 模式验证脚本（无需 API Key）

---

## 阶段二：路由与工具 ⬜

### 项目 02：条件边与动态路由

**目录**：`project-02-conditional-edges/`

**核心概念**：
- **ConditionalEdge（条件边）** — 根据当前 State 动态决定下一个执行的节点
- **路由函数** — `(state) => "nodeName"`，返回目标节点名
- **动态分支** — 一个节点根据条件走向不同的后续节点

**学习目标**：
- 理解普通边（静态路由）与条件边（动态路由）的区别
- 掌握 `addConditionalEdges()` 的用法
- 实现一个根据用户意图路由到不同处理节点的图

**图结构**：
```
                    ┌→ "greeting"  → END
START → "router" ──┼→ "weather"   → END
                    └→ "fallback"  → END
```

**实践内容**：
1. 扩展 State，增加 `intent` 字段（用户意图）
2. 编写意图判断节点 + 路由函数
3. 为不同意图编写不同处理节点
4. 用 `addConditionalEdges` 连接路由

---

### 项目 03：工具调用与 Function Calling

**目录**：`project-03-tools-function-calling/`

**核心概念**：
- **Tool（工具）** — 定义 LLM 可以调用的外部函数
- **ToolMessage** — 工具执行结果的特殊消息类型
- **bindTools()** — 将工具绑定到 LLM，让模型知道可以调用哪些工具
- **ToolNode** — LangGraph 内置的工具执行节点

**学习目标**：
- 理解 LLM Function Calling 的工作原理
- 学会用 `tool()` 函数定义工具
- 掌握 `model.bindTools()` 的用法
- 理解 `AIMessage.tool_calls` 和 `ToolMessage` 的关系

**图结构**：
```
START → "agent" → (有工具调用?) ──是→ "tools" → "agent" (循环)
                              └─否→ END
```

**实践内容**：
1. 定义 2-3 个简单工具（如：计算器、获取时间、查天气 Mock）
2. 将工具绑定到 LLM
3. 编写 agent 节点（调用 LLM，检查是否有 tool_calls）
4. 使用 ToolNode 执行工具
5. 用条件边实现 agent ↔ tools 的循环

---

### 项目 04：ReAct 智能体

**目录**：`project-04-react-agent/`

**核心概念**：
- **ReAct 模式** — Reasoning + Acting，推理与行动交替循环
- **Agent 循环** — LLM 思考 → 调用工具 → 观察结果 → 再思考...直到完成
- **createReactAgent** — LangGraph 内置的 ReAct Agent 工厂函数

**学习目标**：
- 深入理解 ReAct 循环的原理
- 手动实现一个完整的 ReAct Agent（不用 `createReactAgent`）
- 对比手动实现与 `createReactAgent()` 的差异

**图结构**：
```
START → "agent" ⇄ "tools"
                └→ END (当 LLM 不再请求工具时)
```

**实践内容**：
1. 定义一组实用工具（搜索、计算、文件读写等）
2. 手动搭建 agent ↔ tools 循环图
3. 实现终止条件判断（LLM 不再请求工具 → 结束）
4. 用 `createReactAgent()` 快速实现同样功能，对比差异
5. 增加最大迭代次数限制（防止无限循环）

---

## 阶段三：记忆与状态管理 ⬜

### 项目 05：记忆与持久化

**目录**：`project-05-checkpoint-memory/`

**核心概念**：
- **Checkpoint（检查点）** — 自动保存图的执行状态
- **MemorySaver** — 内存级 Checkpoint 存储器
- **thread_id（线程ID）** — 标识一个对话会话
- **状态恢复** — 从 Checkpoint 恢复之前的对话状态

**学习目标**：
- 理解"手动维护消息列表" vs "Checkpoint 自动持久化"的区别
- 掌握 `compile({ checkpointer })` 的用法
- 学会用 `thread_id` 管理多会话
- 理解 `getState()` 和 `getStateHistory()` 的用法

**实践内容**：
1. 用 `MemorySaver` 编译图
2. 通过 `thread_id` 实现自动多轮记忆（对比项目1的手动方式）
3. 实现"多会话管理"——不同 thread_id 互相隔离
4. 用 `getStateHistory()` 查看状态历史
5. 实现时间旅行——从历史状态恢复执行

---

### 项目 06：人机交互（Human-in-the-Loop）

**目录**：`project-06-human-in-the-loop/`

**核心概念**：
- **interrupt()** — 在图执行过程中暂停，等待人工介入
- **Command** — 封装恢复执行时的指令（如：审批结果、修改后的数据）
- **人审审批** — 在关键步骤暂停，等待人工确认后继续
- **状态编辑** — 人工修改 State 后恢复执行

**学习目标**：
- 理解 Human-in-the-Loop 的应用场景
- 掌握 `interrupt()` 的用法
- 学会用 `Command` 恢复被中断的执行
- 实现工具调用前的人工审批

**图结构**：
```
START → "agent" → "review" (interrupt) → 等待人工审批
                                            ├→ 批准 → "tools" → "agent"
                                            └→ 拒绝 → END
```

**实践内容**：
1. 在工具执行前加入 `interrupt()` 暂停点
2. 读取中断状态，展示待审批的工具调用信息
3. 用 `Command({ resume: ... })` 传递审批结果
4. 实现审批通过/拒绝两种恢复路径
5. （进阶）实现人工编辑 State 后恢复

---

## 阶段四：高级图模式 ⬜

### 项目 07：子图与组合

**目录**：`project-07-subgraphs/`

**核心概念**：
- **Subgraph（子图）** — 将一个编译好的图作为另一个图的节点
- **图嵌套** — 大图中包含小图，实现复杂逻辑的模块化
- **状态映射** — 父图与子图之间的状态传递

**学习目标**：
- 理解何时需要子图（复杂逻辑拆分、团队协作、复用）
- 掌握将编译图作为节点使用的技巧
- 处理父子图之间的状态对齐

**实践内容**：
1. 构建一个"研究子图"（搜索 + 总结）
2. 构建一个"写作子图"（大纲 + 正文）
3. 将两个子图组合到父图中
4. 处理子图与父图的 State 共享与隔离

---

### 项目 08：并行执行与 Map-Reduce

**目录**：`project-08-parallel-map-reduce/`

**核心概念**：
- **并行边** — 一个节点同时连接多个节点（扇出）
- **Send** — 动态创建并行任务，每个任务携带不同输入
- **Map-Reduce 模式** — 扇出并行处理 → 聚合结果

**学习目标**：
- 理解 LangGraph 中的并行执行机制
- 掌握 `Send()` 实现动态扇出
- 实现 Map-Reduce 模式的图

**图结构**：
```
                 ┌→ "worker_1" ─┐
START → "fanout" ┼→ "worker_2" ─┼→ "aggregate" → END
                 └→ "worker_3" ─┘
```

**实践内容**：
1. 实现静态并行（多个固定节点并行执行）
2. 用 `Send()` 实现动态并行（根据输入动态创建并行任务）
3. 实现 Map-Reduce：多个 worker 并行处理 → 聚合结果
4. 实践场景：并行总结多篇文章

---

### 项目 09：复杂路由与状态机

**目录**：`project-09-complex-routing/`

**核心概念**：
- **多条件路由** — 一个节点根据多个条件动态路由
- **循环图** — 图中包含环（节点可以回到之前的状态）
- **状态机模式** — 用 LangGraph 实现有限状态机

**学习目标**：
- 掌握复杂条件路由的组合使用
- 理解图中循环的用途和风险
- 用 LangGraph 实现状态机

**实践内容**：
1. 实现一个多轮迭代优化流程（生成 → 评估 → 改进 → 重复直到满意）
2. 用条件边控制循环退出
3. 实现一个简单的客服状态机（等待 → 处理 → 转人工 → 结束）

---

## 阶段五：多智能体 ⬜

### 项目 10：多智能体 Supervisor

**目录**：`project-10-multi-agent-supervisor/`

**核心概念**：
- **Supervisor 模式** — 一个中心 Supervisor Agent 负责分配任务给多个专业 Agent
- **Agent 分工** — 每个 Agent 专注于一个领域
- **任务分发** — Supervisor 根据用户请求决定调用哪个 Agent

**学习目标**：
- 理解多智能体架构的几种模式
- 掌握 Supervisor 模式的实现
- 实现多 Agent 协作完成复杂任务

**图结构**：
```
                    ┌→ "research_agent" ─┐
START → "supervisor" ┼→ "writer_agent" ──┼→ "supervisor" → END
                    └→ "reviewer_agent" ─┘
```

**实践内容**：
1. 构建 3 个专业 Agent（研究、写作、审校）
2. 实现 Supervisor 节点（LLM 决定下一步调用哪个 Agent）
3. 实现 Supervisor ↔ Agents 的循环
4. 实现 Supervisor 决定何时结束任务

---

### 项目 11：多智能体协作

**目录**：`project-11-multi-agent-collaboration/`

**核心概念**：
- **Agent 通信** — Agent 之间直接传递消息
- **协作模式** — Agent 之间互相调用、协作完成任务
- **层级模式** — 多层 Supervisor 嵌套

**学习目标**：
- 理解 Supervisor 模式 vs 协作模式的区别
- 掌握 Agent 间的直接通信机制
- 实现层级式多智能体架构

**实践内容**：
1. 实现两个 Agent 的直接对话协作
2. 实现层级模式（顶层 Supervisor 管理子 Supervisor）
3. 实践场景：软件开发团队（PM → 开发 + 测试 → 部署）

---

## 阶段六：实战应用 ⬜

### 项目 12：RAG 检索增强生成

**目录**：`project-12-rag-application/`

**核心概念**：
- **检索节点** — 从向量数据库检索相关文档
- **向量存储** — 使用 embedding 进行语义搜索
- **知识图谱集成** — 在图中整合检索结果

**学习目标**：
- 理解 RAG 的完整流程
- 在 LangGraph 中实现检索增强
- 结合工具调用实现智能检索

**图结构**：
```
START → "retrieve" → "grade_documents" → (相关?) ──是→ "generate" → END
                                          └─否→ "rewrite_query" → "retrieve" (循环)
```

**实践内容**：
1. 实现文档检索节点（向量搜索）
2. 实现文档评分节点（LLM 判断相关性）
3. 实现查询重写节点（不相关时重写查询）
4. 实现生成节点（基于检索结果生成回答）
5. 用条件边和循环实现自适应 RAG

---

### 项目 13：生产部署与流式 UI

**目录**：`project-13-production-deployment/`

**核心概念**：
- **LangGraph Studio** — 可视化调试和监控工具
- **流式 UI** — 将流式输出对接到 Web 前端
- **部署** — 将 LangGraph 应用部署为 API 服务
- **监控** — 追踪、日志、状态管理

**学习目标**：
- 掌握 LangGraph 应用的生产部署
- 实现流式输出对接前端 UI
- 理解生产环境的状态管理和监控

**实践内容**：
1. 用 LangGraph Studio 可视化和调试图
2. 将图部署为 REST API（LangGraph Server / 自定义 Express）
3. 实现流式输出对接简单 Web UI
4. 添加日志和状态追踪

---

## 学习原则

1. **循序渐进** — 每个项目建立在前一个的基础上，不要跳过
2. **动手实践** — 每个概念都要写代码实现，不能只看不练
3. **先手动后内置** — 先手动实现，再对比 LangGraph 内置工具
4. **写验证脚本** — 每个项目都写一个 Mock 模式验证脚本（参考 project-01 的 verify.ts）
5. **注释即文档** — 代码中的注释就是学习笔记，保持详细

## 项目命名规范

```
project-XX-短描述/
├── src/
│   ├── index.ts      # 主实现
│   └── verify.ts     # Mock 验证脚本
├── .env.example      # 环境变量模板
├── package.json
└── tsconfig.json
```

## 版本信息

- **LangGraph.js**: ^0.2.0
- **LangChain Core**: ^0.3.0
- **LangChain Anthropic**: ^0.3.0
- **LLM**: Anthropic Claude (claude-sonnet-4-20250514)
- **运行时**: Node.js + tsx (TypeScript 直接执行)
