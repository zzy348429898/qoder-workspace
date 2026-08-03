/**
 * ============================================================================
 *  LangGraph.js 项目10：多智能体 Supervisor
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. Supervisor 模式 — 中心调度 Agent 决定"下一步调用哪个专业 Agent"
 *    2. Agent 分工      — 每个 Agent 专注一个领域（研究/写作/审校）
 *    3. 任务分发        — Supervisor 输出约定格式决策，路由函数解析执行
 *    4. 循环回环        — 每个 Agent 完成后回到 Supervisor 重新决策
 *
 *  ★ 与前面项目的关系：
 *    - 专业 Agent 用项目4的 createReactAgent 快速构建（标准工具调用 Agent）
 *    - 子 Agent 作为父图节点，复用项目7的子图机制（MessagesAnnotation 天然兼容）
 *    - Supervisor 回环复用项目9的循环图 + 退出条件设计
 *
 *  ★ Supervisor 的决策协议（教学点）：
 *    Supervisor 是 LLM 节点，输出约定格式的一行文本：
 *      NEXT: researcher | NEXT: writer | NEXT: reviewer | FINISH
 *    路由函数用正则解析 —— 这是最简单的"结构化输出"方案
 *    （生产环境可用 withStructuredOutput 获得更可靠的决策）。
 *
 *  图结构：
 *
 *                      ┌→ "researcher"（createReactAgent + 搜索工具）─┐
 *     START ──→ "supervisor" ──┼→ "writer"（LLM 节点）──────────────────┼──→ "supervisor"（回环）
 *                      └→ "reviewer"（LLM 节点）───────────────┘            └─ FINISH ──→ END
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:10         （需要 API Key）
 *    4. pnpm verify:10        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

// ============================================================================
// 加载 .env 文件
// ============================================================================
try {
  process.loadEnvFile();
} catch {
  // .env 文件不存在时忽略
}

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  topP: 1,
});

// ============================================================================
// 1. researcher Agent —— createReactAgent + 搜索工具（复用项目4模式）
// ============================================================================
//
//  createReactAgent 返回的是 CompiledStateGraph（State = MessagesAnnotation），
//  可以直接作为父图节点：接收 { messages }，返回 { messages }。
//
// ============================================================================

const searchTool = tool(
  async ({ query }) => {
    console.log(`    🔧 [researcher 工具] search("${query}")`);
    const kb: Record<string, string> = {
      langgraph: "LangGraph 核心概念：State（全局状态）、Node（处理单元）、Edge（路由）、Checkpoint（持久化）。",
      rag: "RAG 关键实践：文档切块、向量检索、相关性评分、查询重写、答案引用来源。",
    };
    const lowerQuery = query.toLowerCase();
    for (const [k, v] of Object.entries(kb)) {
      if (lowerQuery.includes(k)) return `搜索结果：${v}`;
    }
    return `搜索结果：关于"${query}"的通用资料摘要。`;
  },
  {
    name: "search",
    description: "搜索技术资料，返回相关知识点摘要。",
    schema: z.object({ query: z.string().describe("搜索关键词") }),
  }
);

const researcherAgent = createReactAgent({
  llm: model,
  tools: [searchTool],
  prompt: "你是研究员。先用 search 工具搜索资料，然后输出 3 条以内的研究笔记（中文）。",
});

/** 包装为父图节点：给产出消息打上 name 标记，便于 Supervisor 识别 */
async function researcherNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [Agent] researcher：搜索并整理研究笔记`);
  const result = await researcherAgent.invoke({ messages: state.messages });
  const lastMsg = result.messages.at(-1) as AIMessage;
  // ★ name 标记：标识本条消息来自哪个 Agent（多智能体的常用实践）
  return { messages: [new AIMessage({ content: lastMsg.content, name: "researcher" })] };
}

// ============================================================================
// 2. writer / reviewer Agent —— 手写 LLM 节点
// ============================================================================

async function writerNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [Agent] writer：基于研究笔记撰写报告`);
  const r = await model.invoke([
    new SystemMessage("你是作者。根据对话中的研究笔记写一段 150 字以内的中文报告。只输出报告正文。"),
    ...state.messages,
  ]);
  return { messages: [new AIMessage({ content: r.content, name: "writer" })] };
}

async function reviewerNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [Agent] reviewer：审校报告`);
  const r = await model.invoke([
    new SystemMessage("你是审校。检查对话中的报告，输出「审校通过」加一句总评（中文）。"),
    ...state.messages,
  ]);
  return { messages: [new AIMessage({ content: r.content, name: "reviewer" })] };
}

// ============================================================================
// 3. Supervisor 节点 —— LLM 决策"下一步调用谁"
// ============================================================================

const SUPERVISOR_PROMPT = `你是团队主管，指挥 researcher、writer、reviewer 三个 Agent 完成"研究并撰写报告"的任务。

标准流程：researcher（收集资料）→ writer（撰写报告）→ reviewer（审校）→ 完成。

根据对话历史中各 Agent 的产出（消息带有来源标记），决定下一步，只输出一行：
- 还没有研究笔记 → 输出：NEXT: researcher
- 有研究笔记但还没有报告 → 输出：NEXT: writer
- 有报告但还没有审校 → 输出：NEXT: reviewer
- 已有审校结论 → 输出：FINISH`;

async function supervisorNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [Supervisor] 决策中...（当前消息数 ${state.messages.length}）`);
  const r = await model.invoke([
    new SystemMessage(SUPERVISOR_PROMPT),
    ...state.messages,
  ]);
  console.log(`  [Supervisor] 决策：${(r.content as string).trim()}`);
  return { messages: [r] };
}

/** ★ 路由函数：解析 Supervisor 的决策文本 */
function routeFromSupervisor(state: typeof MessagesAnnotation.State): string {
  const lastMsg = state.messages.at(-1) as AIMessage;
  const content = (lastMsg.content as string).trim();
  const match = content.match(/NEXT:\s*(researcher|writer|reviewer)/);
  if (match) return match[1];
  return END; // FINISH 或无法解析时结束
}

// ============================================================================
// 4. 组装图
// ============================================================================

const app = new StateGraph(MessagesAnnotation)
  .addNode("supervisor", supervisorNode)
  .addNode("researcher", researcherNode)
  .addNode("writer", writerNode)
  .addNode("reviewer", reviewerNode)
  .addEdge(START, "supervisor")
  // ★ Supervisor → 各 Agent 的条件分发
  .addConditionalEdges("supervisor", routeFromSupervisor, ["researcher", "writer", "reviewer", END])
  // ★ 每个 Agent 完成后回到 Supervisor 重新决策（回环）
  .addEdge("researcher", "supervisor")
  .addEdge("writer", "supervisor")
  .addEdge("reviewer", "supervisor")
  .compile();

// ============================================================================
// 5. 可视化 + 演示
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化");
  console.log("═".repeat(70));

  const mermaidStr = app.getGraph().drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await app.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

async function demoSupervisorTeam() {
  console.log("═".repeat(70));
  console.log("  演示：Supervisor 指挥三个 Agent 完成研究报告");
  console.log("═".repeat(70));

  const task = "研究 LangGraph 的核心概念，并撰写一段介绍报告。";
  console.log(`\n👤 任务：${task}\n`);

  const streamResult = await app.stream({ messages: [new HumanMessage(task)] });
  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    console.log(`  [stream 事件] 节点 "${nodeName}" 完成`);
  }

  const result = await app.invoke({ messages: [new HumanMessage(task)] });
  const finalMsg = result.messages.at(-1) as AIMessage;
  console.log(`\n  ── 任务完成 ──`);
  console.log(`  最终消息来源：${finalMsg.name ?? "supervisor"}`);
  console.log(`  内容：${(finalMsg.content as string).slice(0, 200)}`);
  console.log(`\n${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:10 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目10：多智能体 Supervisor".padEnd(50) + "║");
  console.log("║" + "  核心概念：Supervisor 模式 · Agent 分工 · 任务分发".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoSupervisorTeam();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
