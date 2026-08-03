/**
 * ============================================================================
 *  LangGraph.js 项目11：多智能体协作
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. Agent 通信     — Agent 之间通过共享 messages 直接对话
 *    2. name 标记      — AIMessage.name 标识发言者（对话协作的基础设施）
 *    3. 协作模式       — 无中心调度，Agent 按"最后发言者"轮流接管
 *    4. 层级模式       — 子团队图作为顶层图节点（子图 + 多智能体的组合）
 *
 *  ★ Supervisor 模式（项目10）vs 协作模式（本项目）：
 *    Supervisor：中心节点统一调度，Agent 之间不直接通信
 *    协作模式：Agent 直接对话，路由只看"最后谁发言了"——
 *              适合需要反复讨论、互相追问的场景
 *
 *  图结构：
 *    图1 对话协作：START → "pm" ⇄ "dev" → END（达到轮数上限）
 *    图2 层级模式：START → "boss" → "dev_team"(子图=图1) → "boss" → END
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:11         （需要 API Key）
 *    4. pnpm verify:11        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
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
// 1. 图1：双 Agent 对话协作（pm ⇄ dev）
// ============================================================================
//
//  ★ 协作模式的路由设计（核心教学点）：
//    没有 Supervisor，路由函数只看两件事：
//      ① 最后一条带 name 的消息是谁发的 → 交给对方发言
//      ② 对话轮数是否达到上限 → 结束
//    "轮流发言"完全由消息历史驱动，无需额外的状态字段。
//
// ============================================================================

/**
 * 协作图 State：messages + turnCount（轮次计数）
 *
 * ★ 为什么轮次统计要用独立的 turnCount 字段？
 *   如果靠"带 name 的消息数"计算轮次，当本图作为子图嵌入层级模式时，
 *   外层 Agent（如 boss）的 name 消息会污染计数，导致提前结束。
 *   turnCount 是本子图的私有字段（顶层图没有），天然隔离外部影响——
 *   这正是项目7"子图私有字段隔离"的实战应用。
 */
const CollabAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  turnCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

/** 对话轮数上限（pm+dev 合计发言数） */
const MAX_AGENT_TURNS = 6;

function makeAgentNode(name: string, rolePrompt: string) {
  return async (state: typeof CollabAnnotation.State) => {
    console.log(`  [协作] ${name} 发言（第 ${state.turnCount + 1} 轮）`);
    const r = await model.invoke([
      new SystemMessage(rolePrompt),
      ...state.messages,
    ]);
    // ★ name 标记：让对方和路由函数知道这条消息是谁说的
    return { messages: [new AIMessage({ content: r.content, name })], turnCount: 1 };
  };
}

const pmNode = makeAgentNode(
  "pm",
  `你是产品经理 pm。先提出一个简短的功能需求（如"写一个待办事项列表函数"），
然后根据 dev 的方案追问 1-2 个细节（边界条件、错误处理），
最后确认验收。每次发言不超过 2 句话。`,
);

const devNode = makeAgentNode(
  "dev",
  `你是开发者 dev。针对 pm 的需求给出简洁的实现方案（伪代码或要点），
并回答 pm 的追问。每次发言不超过 3 句话。`,
);

/** ★ 协作路由：最后发言者轮换；达到轮数上限则结束 */
function routeCollaboration(state: typeof CollabAnnotation.State): "pm" | "dev" | typeof END {
  if (state.turnCount >= MAX_AGENT_TURNS) {
    console.log(`  [协作] 已达轮数上限 ${MAX_AGENT_TURNS}，结束对话`);
    return END;
  }
  const lastNamed = [...state.messages].reverse().find((m) => (m as AIMessage).name) as AIMessage | undefined;
  // 最后发言者 → 对方
  return lastNamed?.name === "pm" ? "dev" : "pm";
}

const collabGraph = new StateGraph(CollabAnnotation)
  .addNode("pm", pmNode)
  .addNode("dev", devNode)
  .addEdge(START, "pm")
  .addConditionalEdges("pm", routeCollaboration, ["dev", END])
  .addConditionalEdges("dev", routeCollaboration, ["pm", END])
  .compile();

// ============================================================================
// 2. 图2：层级模式 —— dev_team 子图（图1）作为顶层图节点
// ============================================================================
//
//  ★ 层级模式（核心教学点）：
//    把"一个团队"封装成子图，顶层 Supervisor 把团队当作一个节点调度。
//    这就是项目7（子图）+ 项目10/11（多智能体）的组合：
//    层级深度可以任意嵌套（顶层 boss → 团队 → 团队成员）。
//
// ============================================================================

async function bossKickoffNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [层级] boss：向 dev_team 布置任务`);
  const r = await model.invoke([
    new SystemMessage("你是技术总监 boss。把用户的需求转述为一句明确的团队任务（中文，一句话）。"),
    ...state.messages,
  ]);
  return { messages: [new AIMessage({ content: r.content, name: "boss" })] };
}

async function bossWrapUpNode(state: typeof MessagesAnnotation.State) {
  console.log(`  [层级] boss：听取团队讨论结果，做总结`);
  const r = await model.invoke([
    new SystemMessage("你是技术总监 boss。总结 pm 和 dev 讨论的结论，输出 2 句话的最终决策（中文）。"),
    ...state.messages,
  ]);
  return { messages: [new AIMessage({ content: r.content, name: "boss" })] };
}

const hierarchyApp = new StateGraph(MessagesAnnotation)
  .addNode("boss_kickoff", bossKickoffNode)
  // ★ 子图即节点：整个 dev_team（pm ⇄ dev 对话）作为一个节点
  .addNode("dev_team", collabGraph)
  .addNode("boss_wrapup", bossWrapUpNode)
  .addEdge(START, "boss_kickoff")
  .addEdge("boss_kickoff", "dev_team")
  .addEdge("dev_team", "boss_wrapup")
  .addEdge("boss_wrapup", END)
  .compile();

// ============================================================================
// 3. 可视化 + 演示
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化（层级图）");
  console.log("═".repeat(70));

  const mermaidStr = hierarchyApp.getGraph().drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await hierarchyApp.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

/** 演示1：双 Agent 直接对话协作 */
async function demoCollaboration() {
  console.log("═".repeat(70));
  console.log("  演示1：pm ⇄ dev 对话协作（无中心调度）");
  console.log("═".repeat(70));

  const task = "我们想做一个小工具：输入一段文字，统计其中的关键词频率。";
  console.log(`\n👤 用户：${task}\n`);

  const result = await collabGraph.invoke({ messages: [new HumanMessage(task)] });

  console.log();
  for (const m of result.messages) {
    const name = (m as AIMessage).name;
    if (name) {
      const content = (m.content as string).replace(/\n/g, " ").slice(0, 80);
      console.log(`  💬 [${name}] ${content}${(m.content as string).length > 80 ? "..." : ""}`);
    }
  }
  console.log(`\n  ★ 没有 Supervisor：pm 和 dev 按"最后发言者"轮流接管对话`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/** 演示2：层级模式（顶层 boss → 子团队 → 顶层 boss） */
async function demoHierarchy() {
  console.log("═".repeat(70));
  console.log("  演示2：层级模式（boss → dev_team 子图 → boss）");
  console.log("═".repeat(70));

  const task = "给客户做一个 LangGraph 入门演示。";
  console.log(`\n👤 用户：${task}\n`);

  // subgraphs: true 可以看到顶层节点与子图内部节点的完整轨迹
  const streamResult = await hierarchyApp.stream(
    { messages: [new HumanMessage(task)] },
    { subgraphs: true },
  );

  for await (const [namespace, chunk] of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    const fromSub = namespace.length > 0 ? "（dev_team 子图内部）" : "（顶层图）";
    console.log(`  [stream 事件] "${nodeName}" ${fromSub}`);
  }

  const result = await hierarchyApp.invoke({ messages: [new HumanMessage(task)] });
  const finalMsg = result.messages.at(-1) as AIMessage;
  console.log(`\n  ── 最终决策 ──`);
  console.log(`  来源：${finalMsg.name}`);
  console.log(`  内容：${(finalMsg.content as string).slice(0, 150)}`);
  console.log(`\n${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:11 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目11：多智能体协作".padEnd(50) + "║");
  console.log("║" + "  核心概念：Agent 通信 · 消息传递 · 协作模式 · 层级模式".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoCollaboration();
  await demoHierarchy();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
