/**
 * ============================================================================
 *  LangGraph.js 项目4：ReAct 智能体
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. ReAct 模式        — Reasoning + Acting，推理与行动交替循环
 *    2. Agent 循环        — LLM 思考 → 调用工具 → 观察结果 → 再思考...直到完成
 *    3. 终止条件          — LLM 不再请求工具调用 → 结束循环
 *    4. 最大迭代次数限制   — 防止 Agent 陷入无限循环（重要防线！）
 *    5. createReactAgent  — LangGraph 内置的 ReAct Agent 工厂函数
 *    6. recursionLimit    — LangGraph 层面的步数限制（与迭代次数对比）
 *
 *  ReAct 模式详解（论文：ReAct: Synergizing Reasoning and Acting in LMs）：
 *
 *    ReAct 让 LLM 交替生成"推理（Thought）"和"行动（Action）"：
 *
 *      Thought（思考）  → LLM 分析当前状态，决定下一步做什么
 *      Action（行动）   → LLM 请求调用某个工具（AIMessage.tool_calls）
 *      Observation（观察）→ 工具执行结果返回给 LLM（ToolMessage）
 *      ... 循环 ...
 *      Answer（回答）   → LLM 认为信息足够，输出最终答案（无 tool_calls）
 *
 *    在现代 tool-calling LLM 中，Thought 通常隐含在模型内部（或 content 中），
 *    Action = tool_calls，Observation = ToolMessage.content。
 *
 *  与项目3的对比：
 *    项目3：agent ⇄ tools 循环已能工作，但它是"工具调用的最小实现"
 *    项目4：把它升级为完整的 ReAct Agent —
 *          ① 显式的迭代计数（iterationCount）与最大迭代限制
 *          ② 手写路由函数替代 toolsCondition，理解终止条件的本质
 *          ③ 支持多步推理任务（搜索 → 计算 → 回答）
 *          ④ 与内置 createReactAgent() 对比，理解框架帮你做了什么
 *
 *  图结构示意（手动实现与内置实现结构相同）：
 *
 *     START ──→ "agent" ──→ (有 tool_calls 且未超迭代上限?) ──是──→ "tools" ──→ "agent" (循环)
 *                          └──否──→ END
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. npm install
 *    3. npm start           （需要 API Key）
 *    4. npm run verify      （Mock 模式，无需 API Key）
 * ============================================================================
 */

// ============================================================================
// 0. 导入依赖
// ============================================================================

import { StateGraph, START, END, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode, createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import * as readline from "node:readline/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";

// ============================================================================
// 加载 .env 文件
// ============================================================================
try {
  process.loadEnvFile();
} catch {
  // .env 文件不存在时忽略
}

// ============================================================================
// 1. 工具定义 —— 为 ReAct Agent 配备"手脚"
// ============================================================================
//
//  ReAct Agent 的能力上限取决于工具集。本项目定义 4 个实用工具：
//    - search      → 检索信息（Mock 知识库，替代真实搜索引擎）
//    - calculator  → 数学计算
//    - read_file   → 读取文件（限制在 sandbox/ 目录）
//    - write_file  → 写入文件（限制在 sandbox/ 目录）
//
//  ★ 多步推理的关键：
//    单个工具往往不够用，ReAct Agent 会把多个工具串联起来：
//    例如 "iPhone 今年卖了多少部？按平均售价算总营收多少？"
//      第1轮：search("iPhone 2024 销量")  → 得到销量和均价
//      第2轮：calculator("2.3亿 * 900")   → 得到总营收
//      第3轮：LLM 综合两个 Observation 给出最终 Answer
//
// ============================================================================

/** Mock 知识库 —— 模拟搜索引擎的返回结果 */
const knowledgeBase: Record<string, string> = {
  iphone: "iPhone 是苹果公司的智能手机产品。2024 年全球销量约 2.3 亿部，平均售价约 900 美元。",
  苹果: "苹果公司（Apple Inc.）2024 财年总营收约 3910 亿美元，其中 iPhone 贡献约一半。",
  华为: "华为 2024 年营收约 8600 亿元人民币，同比增长约 22%。",
  特斯拉: "特斯拉 2024 年全球交付约 179 万辆电动车，Model Y 是销量最高的车型。",
  人口: "截至 2024 年，中国人口约 14.1 亿，印度人口约 14.3 亿，是世界人口最多的两个国家。",
};

/**
 * 工具1：搜索 —— 从 Mock 知识库检索信息
 *
 * 真实场景中会对接 Google/Bing/向量数据库，这里用内置知识库模拟。
 */
const searchTool = tool(
  async ({ query }) => {
    console.log(`  🔧 [工具执行] search("${query}")`);

    const lowerQuery = query.toLowerCase();
    const hits: string[] = [];
    for (const [keyword, info] of Object.entries(knowledgeBase)) {
      if (lowerQuery.includes(keyword.toLowerCase()) || keyword.includes(query)) {
        hits.push(info);
      }
    }

    if (hits.length > 0) {
      return `搜索结果：\n${hits.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
    }
    return `未找到与 "${query}" 相关的信息。知识库包含的主题：${Object.keys(knowledgeBase).join("、")}`;
  },
  {
    name: "search",
    description: "搜索信息，返回与查询相关的知识片段。适合查询公司、产品、销量、人口等事实性信息。",
    schema: z.object({
      query: z.string().describe("搜索关键词，例如 'iPhone 销量'、'苹果公司营收'"),
    }),
  }
);

/**
 * 工具2：计算器 —— 执行数学运算
 */
const calculatorTool = tool(
  async ({ expression }) => {
    console.log(`  🔧 [工具执行] calculator("${expression}")`);

    try {
      // 注意：生产环境中应使用更安全的表达式解析器（如 mathjs）
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch {
      return `计算失败：无法解析表达式 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算。支持加减乘除、括号等基本运算。例如：'15 * 37'、'230000000 * 900'。",
    schema: z.object({
      expression: z.string().describe("要计算的数学表达式，例如 '15 * 37'"),
    }),
  }
);

// ============================================================================
// 文件读写工具的安全限制
// ============================================================================
//
//  给 LLM 提供文件操作能力时必须限制访问范围，
//  否则 Agent 可能读写系统任意文件（路径逃逸攻击）。
//  这里把所有文件操作限制在项目下的 sandbox/ 目录。
//
// ============================================================================

const SANDBOX_DIR = path.join(process.cwd(), "sandbox");

/** 把 LLM 传入的文件名解析为 sandbox 内的绝对路径，并阻止路径逃逸 */
function resolveSandboxPath(fileName: string): string {
  const resolved = path.resolve(SANDBOX_DIR, fileName);
  if (!resolved.startsWith(SANDBOX_DIR + path.sep) && resolved !== SANDBOX_DIR) {
    throw new Error(`安全限制：只能访问 sandbox/ 目录内的文件，拒绝访问 "${fileName}"`);
  }
  return resolved;
}

/**
 * 工具3：读取文件（仅限 sandbox/ 目录）
 */
const readFileTool = tool(
  async ({ fileName }) => {
    console.log(`  🔧 [工具执行] read_file("${fileName}")`);

    try {
      const filePath = resolveSandboxPath(fileName);
      if (!fs.existsSync(filePath)) {
        return `文件不存在：sandbox/${fileName}。可以先用 write_file 创建。`;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return `文件 sandbox/${fileName} 的内容：\n${content}`;
    } catch (err) {
      return `读取失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "read_file",
    description: "读取 sandbox/ 目录下的文件内容。",
    schema: z.object({
      fileName: z.string().describe("文件名（相对于 sandbox/ 目录），例如 'notes.txt'"),
    }),
  }
);

/**
 * 工具4：写入文件（仅限 sandbox/ 目录）
 */
const writeFileTool = tool(
  async ({ fileName, content }) => {
    console.log(`  🔧 [工具执行] write_file("${fileName}", ${content.length} 字符)`);

    try {
      const filePath = resolveSandboxPath(fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return `已写入文件 sandbox/${fileName}（${content.length} 字符）`;
    } catch (err) {
      return `写入失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "write_file",
    description: "把内容写入 sandbox/ 目录下的文件。文件已存在时会被覆盖。",
    schema: z.object({
      fileName: z.string().describe("文件名（相对于 sandbox/ 目录），例如 'report.md'"),
      content: z.string().describe("要写入的文件内容"),
    }),
  }
);

// 所有工具的列表
const allTools = [searchTool, calculatorTool, readFileTool, writeFileTool];

// ============================================================================
// 2. LLM 实例初始化
// ============================================================================

const baseModel = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  // 显式设置 topP 为合法值（默认 -1 会被某些 API 代理拒绝）
  topP: 1,
});

// ============================================================================
// 3.【手动实现】自定义 State —— 在消息列表之外增加迭代计数
// ============================================================================
//
//  对比项目3：
//    项目3：直接用 MessagesAnnotation（只有 messages 字段）
//    项目4：Annotation.Root({ ...MessagesAnnotation.spec, iterationCount })
//      - 通过展开 MessagesAnnotation.spec 继承 messages 字段及其 Reducer
//      - 新增 iterationCount 字段，记录 LLM 已被调用的次数
//
//  iterationCount 的 Reducer 是"累加"策略：
//    agent 节点每次返回 { iterationCount: 1 }，自动累加到当前值上。
//    这样每一轮 Thought 都会让计数 +1，路由函数据此判断是否超限。
//
// ============================================================================

const ReactAgentAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  iterationCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
});

/** 最大迭代次数 —— 防止 Agent 陷入无限循环的防线 */
const MAX_ITERATIONS = 5;

// ============================================================================
// 4.【手动实现】agent 节点 —— ReAct 循环的"大脑"
// ============================================================================

const SYSTEM_PROMPT = `你是一个采用 ReAct 模式工作的智能助手。你可以使用以下工具：
- search：搜索事实性信息（公司、产品、销量、人口等）
- calculator：执行数学计算
- read_file / write_file：读写 sandbox/ 目录下的文件

工作方式：
1. 分析用户的问题，如果缺少信息就先调用 search 搜索
2. 如果需要数学计算，调用 calculator
3. 复杂问题可以分多步解决：先搜索获取数据，再计算，最后总结
4. 当你获得了足够的信息后，用中文给出完整、准确的最终回答`;

/**
 * agent 节点：调用 LLM 进行一轮"思考"
 *
 * 每一轮循环中 LLM 会看到完整的对话历史：
 *   HumanMessage（原始问题）
 *   → AIMessage（第1轮 tool_calls）
 *   → ToolMessage（第1轮工具结果，即 Observation）
 *   → AIMessage（第2轮 tool_calls 或最终回答）
 *   → ...
 *
 * @returns 部分状态更新：LLM 的响应 + 迭代计数 +1
 */
async function agentNode(
  state: typeof ReactAgentAnnotation.State
): Promise<Partial<typeof ReactAgentAnnotation.State>> {
  const { messages, iterationCount } = state;

  console.log(`\n  🧠 [ReAct 第 ${iterationCount + 1} 轮思考]`);

  const response = await baseModel.bindTools(allTools).invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...messages,
  ]);

  // iterationCount 使用累加 Reducer，返回 1 即表示本轮计数 +1
  return { messages: [response], iterationCount: 1 };
}

// ============================================================================
// 5.【手动实现】路由函数 —— ReAct 循环的终止条件
// ============================================================================
//
//  对比项目3：
//    项目3：用内置的 toolsCondition（只判断有无 tool_calls）
//    项目4：手写 shouldContinue，增加第二个终止条件——最大迭代次数
//
//  两个终止条件（缺一不可）：
//    ① 正常终止：LLM 不再请求工具调用 → 说明它认为信息足够 → END
//    ② 强制终止：iterationCount >= MAX_ITERATIONS → 防止无限循环 → END
//
//  ★ 为什么需要条件②？
//    LLM 可能因为工具设计不当、问题无解、模型幻觉等原因
//    不断请求工具调用，导致循环永不结束（烧 API 费用！）。
//    生产级 Agent 必须有迭代上限。
//
// ============================================================================

function shouldContinue(state: typeof ReactAgentAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];

  // 终止条件①：最后一条消息不是"带工具调用的 AIMessage" → 正常结束
  if (lastMessage._getType() !== "ai") {
    return END;
  }
  const aiMessage = lastMessage as AIMessage;
  if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
    return END;
  }

  // 终止条件②：达到最大迭代次数 → 强制结束（兜底防线）
  if (state.iterationCount >= MAX_ITERATIONS) {
    console.log(`  ⛔ [安全限制] 已达最大迭代次数 ${MAX_ITERATIONS}，强制结束循环`);
    return END;
  }

  // 继续循环：LLM 请求了工具调用，且未超限
  return "tools";
}

// ============================================================================
// 6.【手动实现】组装图 —— 完整的 ReAct Agent
// ============================================================================

const manualWorkflow = new StateGraph(ReactAgentAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", new ToolNode(allTools))
  .addEdge(START, "agent")
  // ★ 用手写的 shouldContinue 替代项目3的内置 toolsCondition
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

/** 手动实现的 ReAct Agent */
const manualApp = manualWorkflow.compile();

// ============================================================================
// 7.【内置实现】createReactAgent —— 一行代码实现同样功能
// ============================================================================
//
//  createReactAgent 是 LangGraph 内置的 ReAct Agent 工厂函数，
//  它内部做的事情与我们手动实现的完全一致：
//    ✓ 创建 MessagesAnnotation State
//    ✓ 创建 agent 节点（自动 bindTools + 调用 LLM）
//    ✓ 创建 ToolNode
//    ✓ 添加 agent ⇄ tools 的条件边循环（内部用 toolsCondition）
//    ✓ 支持 prompt 参数注入系统提示词
//
//  ★ 对比总结：
//    ┌──────────────┬─────────────────────┬─────────────────────┐
//    │              │ 手动实现             │ createReactAgent    │
//    ├──────────────┼─────────────────────┼─────────────────────┤
//    │ 代码量        │ ~60 行              │ ~5 行               │
//    │ State 定制    │ 完全自由（可加字段） │ 需 stateSchema 参数  │
//    │ 路由逻辑      │ 完全自由（手写函数） │ 固定 toolsCondition │
//    │ 迭代限制      │ 自定义 iterationCount│ 用 recursionLimit  │
//    │ 适用场景      │ 学习/深度定制        │ 生产快速搭建        │
//    └──────────────┴─────────────────────┴─────────────────────┘
//
//  ★ recursionLimit vs iterationCount：
//    - recursionLimit 是 LangGraph 图级别的"执行步数"限制（默认 25 步）
//      一次 agent→tools→agent 循环消耗 2 步，超限时抛出 GraphRecursionError
//    - iterationCount 是我们自定义的"LLM 调用次数"限制
//      粒度更细，超限后可以优雅降级（而不是抛异常）
//
// ============================================================================

/** 内置实现的 ReAct Agent（与手动实现功能等价） */
const builtinApp = createReactAgent({
  llm: baseModel,      // 传入未绑定工具的模型，内部自动 bindTools
  tools: allTools,
  prompt: SYSTEM_PROMPT, // 字符串会自动转为 SystemMessage
});

// ============================================================================
// 8. 图结构可视化
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化（手动实现）");
  console.log("═".repeat(70));

  const graph = manualApp.getGraph();
  const mermaidStr = graph.drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  // 保存 Mermaid 文本到文件
  const mermaidFilePath = path.join(process.cwd(), "graph.mmd");
  fs.writeFileSync(mermaidFilePath, mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${mermaidFilePath}`);
  console.log(`   可用 Mermaid Live Editor 查看：https://mermaid.live`);

  // 生成 PNG 图片
  try {
    const pngBlob = await graph.drawMermaidPng();
    const pngBuffer = Buffer.from(await pngBlob.arrayBuffer());
    const pngFilePath = path.join(process.cwd(), "graph.png");
    fs.writeFileSync(pngFilePath, pngBuffer);
    console.log(`🖼️  PNG 图片已保存到：${pngFilePath}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接访问 Mermaid.INK API）`);
    console.log(`   不影响后续功能，Mermaid 文本仍可使用。`);
  }

  // 对比：内置版本的图结构
  console.log("\n" + "─".repeat(70));
  console.log("  图结构可视化（createReactAgent 内置实现）");
  console.log("─".repeat(70));
  const builtinGraph = builtinApp.getGraph();
  const builtinMermaid = builtinGraph.drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(builtinMermaid);
  console.log("\n  ★ 观察：两种实现的图结构几乎相同（agent ⇄ tools 循环）");
  console.log("    区别仅在节点命名和内部实现细节。\n");
}

// ============================================================================
// 9. 打印 ReAct 循环过程的辅助函数
// ============================================================================
//
//  把 stream 事件翻译成 ReAct 的四阶段术语，直观展示循环：
//    💭 Thought     → AIMessage.content（LLM 的推理文本，可能为空）
//    🎬 Action      → AIMessage.tool_calls（LLM 请求的工具调用）
//    👁️ Observation → ToolMessage.content（工具执行结果）
//    ✅ Answer      → 最终的 AIMessage.content（无 tool_calls）
//
// ============================================================================

function printReactSteps(nodeName: string, messages: BaseMessage[]) {
  for (const msg of messages) {
    const msgType = msg._getType();
    if (msgType === "ai") {
      const aiMsg = msg as AIMessage;
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        if (aiMsg.content && typeof aiMsg.content === "string") {
          console.log(`  💭 Thought: "${aiMsg.content.slice(0, 120)}"`);
        }
        const actions = aiMsg.tool_calls
          .map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`)
          .join(", ");
        console.log(`  🎬 Action: ${actions}`);
      } else {
        const content = typeof aiMsg.content === "string" ? aiMsg.content : JSON.stringify(aiMsg.content);
        console.log(`  ✅ Answer: "${content.slice(0, 200)}${content.length > 200 ? "..." : ""}"`);
      }
    } else if (msgType === "tool") {
      const toolMsg = msg as ToolMessage;
      const content = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content);
      console.log(`  👁️  Observation [${toolMsg.name}]: "${content.slice(0, 120)}${content.length > 120 ? "..." : ""}"`);
    }
  }
}

// ============================================================================
// 10. 演示函数
// ============================================================================

/** 多步推理测试问题（需要 search → calculator → 回答 三轮循环） */
const MULTI_STEP_QUESTION = "2024 年 iPhone 全球销量是多少部？按平均售价计算，这些 iPhone 的总营收大约是多少美元？";

/**
 * 演示1：手动实现的 ReAct Agent —— 观察多步推理循环
 *
 * 用户的问题需要两步才能解决：
 *   第1轮 Thought → Action: search("iPhone 2024 销量")
 *   第2轮 Thought → Action: calculator("230000000 * 900")
 *   第3轮 Thought → Answer: 综合给出最终回答
 */
async function demoManualReactAgent() {
  console.log("═".repeat(70));
  console.log("  演示1：手动实现的 ReAct Agent（多步推理）");
  console.log("═".repeat(70));

  console.log(`\n👤 用户：${MULTI_STEP_QUESTION}\n`);

  const streamResult = await manualApp.stream({
    messages: [new HumanMessage(MULTI_STEP_QUESTION)],
  });

  const executedNodes: string[] = [];
  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    executedNodes.push(nodeName);
    printReactSteps(nodeName, chunk[nodeName].messages ?? []);
  }

  console.log(`\n  执行路径：${executedNodes.join(" → ")}`);
  console.log(`  ★ 观察：agent 和 tools 交替执行，直到 LLM 给出 Answer`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示2：createReactAgent 内置实现 —— 同样的问题，对比行为
 */
async function demoBuiltinReactAgent() {
  console.log("═".repeat(70));
  console.log("  演示2：createReactAgent 内置实现（同样的问题）");
  console.log("═".repeat(70));

  console.log(`\n👤 用户：${MULTI_STEP_QUESTION}\n`);

  // recursionLimit：LangGraph 图级别的步数限制（默认 25）
  // 一次 agent→tools→agent 循环消耗 2 步
  const streamResult = await builtinApp.stream(
    { messages: [new HumanMessage(MULTI_STEP_QUESTION)] },
    { recursionLimit: 15 },
  );

  const executedNodes: string[] = [];
  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    executedNodes.push(nodeName);
    printReactSteps(nodeName, chunk[nodeName].messages ?? []);
  }

  console.log(`\n  执行路径：${executedNodes.join(" → ")}`);
  console.log(`  ★ 观察：行为与手动实现一致，但代码从 ~60 行缩减到 ~5 行`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示3：手动 vs 内置 —— 代码对比总结
 */
function demoComparison() {
  console.log("═".repeat(70));
  console.log("  演示3：手动实现 vs createReactAgent 对比");
  console.log("═".repeat(70));
  console.log(`
  【手动实现的核心代码】
    const workflow = new StateGraph(ReactAgentAnnotation)
      .addNode("agent", agentNode)              // 自己写的 LLM 调用
      .addNode("tools", new ToolNode(allTools)) // 内置 ToolNode
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue)  // 自己写的路由
      .addEdge("tools", "agent");

  【createReactAgent 的核心代码】
    const app = createReactAgent({
      llm: baseModel,
      tools: allTools,
      prompt: SYSTEM_PROMPT,
    });

  【什么时候用手动实现？】
    ✓ 需要自定义 State（如本项目的 iterationCount、项目5+的更多字段）
    ✓ 需要自定义路由逻辑（如本项目的最大迭代限制、项目6的人工审批）
    ✓ 需要在循环中插入额外节点（如日志、评估、人工审核）
    → 项目6（Human-in-the-Loop）、项目9（复杂路由）都会用到手动方式

  【什么时候用 createReactAgent？】
    ✓ 标准的"工具调用 Agent"，无需定制 State 和路由
    ✓ 快速搭建原型、生产环境的标准 Agent
    → 项目10/11（多智能体）中每个子 Agent 通常用 createReactAgent 快速构建
`);
  console.log("═".repeat(70) + "\n");
}

/**
 * 演示4：交互式聊天（使用手动实现版本）
 *
 * 可以尝试的问题：
 *   - "2024 年特斯拉交付了多少辆车？"（单轮搜索）
 *   - "中国和印度人口加起来大约多少？"（搜索 + 计算，多轮）
 *   - "把学习笔记写入 notes.txt"（文件写入）
 *   - "读一下 notes.txt 的内容"（文件读取）
 */
async function interactiveChat() {
  console.log("═".repeat(70));
  console.log("  交互式聊天（手动 ReAct Agent）");
  console.log("  可以问需要多步推理的问题，观察 Thought → Action → Observation 循环");
  console.log("  输入 quit/退出 结束");
  console.log("═".repeat(70));
  console.log();

  const rl = readline.createInterface({ input, output });
  const conversationHistory: BaseMessage[] = [];

  while (true) {
    const userInput = await rl.question("👤 你：");

    if (userInput.trim().toLowerCase() === "quit" || userInput.trim() === "退出") {
      console.log("\n👋 再见！");
      break;
    }

    if (!userInput.trim()) {
      continue;
    }

    const userMessage = new HumanMessage(userInput);

    // 注意：每轮对话 iterationCount 从 0 重新开始（default: () => 0）
    const result = await manualApp.invoke({
      messages: [...conversationHistory, userMessage],
    });

    // 打印最后的 AI 回复
    const lastMsg = result.messages[result.messages.length - 1];
    if (lastMsg._getType() === "ai") {
      const aiMsg = lastMsg as AIMessage;
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        // 达到最大迭代次数被强制结束时，最后的消息还带着未执行的 tool_calls
        console.log(`\n🤖 AI: [已达最大迭代次数 ${MAX_ITERATIONS}，无法完成任务。请换个方式提问或调大 MAX_ITERATIONS。]\n`);
      } else {
        console.log(`\n🤖 AI: ${aiMsg.content}\n`);
      }
    }

    // 更新对话历史
    conversationHistory.length = 0;
    conversationHistory.push(...result.messages);
  }

  rl.close();
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 npm run verify 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目4：ReAct 智能体".padEnd(50) + "║");
  console.log("║" + "".padEnd(68) + "║");
  console.log("║" + "  核心概念：ReAct 模式 · Agent 循环 · createReactAgent".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\n");

  // 图结构可视化（手动 vs 内置对比）
  await visualizeGraph();

  // 演示1：手动实现的 ReAct Agent（多步推理）
  await demoManualReactAgent();

  // 演示2：createReactAgent 内置实现
  await demoBuiltinReactAgent();

  // 演示3：手动 vs 内置代码对比
  demoComparison();

  // 演示4：交互式聊天
  await interactiveChat();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
