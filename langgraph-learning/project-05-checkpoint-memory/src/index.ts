/**
 * ============================================================================
 *  LangGraph.js 项目5：记忆与持久化
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. Checkpoint（检查点） — 每个节点执行后自动保存的状态快照
 *    2. MemorySaver          — 内存级 Checkpoint 存储器（生产可用 SQLite/Postgres）
 *    3. thread_id（线程ID）  — 标识一个对话会话，不同会话的状态完全隔离
 *    4. 状态恢复             — 同一 thread_id 再次调用时自动加载历史状态
 *    5. getStateHistory()    — 查看会话的全部历史快照
 *    6. 时间旅行             — 从任意历史 checkpoint 恢复执行，产生新分支
 *
 *  与项目1的对比（核心教学点）：
 *    项目1：多轮对话需要手动维护 conversationHistory 数组，
 *           每次 invoke 都把完整历史传入 —— 状态管理完全靠开发者。
 *    项目5：compile 时附加 checkpointer，调用时只传 thread_id 和新消息，
 *           LangGraph 自动加载历史、追加新消息、保存快照 —— 状态托管给框架。
 *
 *  图结构：
 *
 *     START ──→ "chatbot" ──→ END
 *               （每个节点执行后自动写入 checkpoint）
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录，一次安装全 workspace 共享）
 *    3. pnpm start:05         （需要 API Key）
 *    4. pnpm verify:05        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, MessagesAnnotation, MemorySaver, StateSnapshot } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
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

// ============================================================================
// 1. LLM 实例初始化
// ============================================================================

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  topP: 1,
});

// ============================================================================
// 2. 构建图 —— 与项目1完全相同的单节点结构
// ============================================================================
//
//  本项目刻意使用最简单的图（START → chatbot → END），
//  因为教学重点不在图结构，而在 compile() 的 checkpointer 参数。
//
// ============================================================================

const SYSTEM_PROMPT = `你是一个友好的中文助手，回答简洁。
请利用对话历史中用户提供的信息（如姓名、偏好）来个性化回答。`;

async function chatbotNode(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);
  return { messages: [response] };
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("chatbot", chatbotNode)
  .addEdge(START, "chatbot")
  .addEdge("chatbot", END);

// ============================================================================
// 3.【核心概念】MemorySaver + checkpointer
// ============================================================================
//
//  MemorySaver 是一个 Checkpoint 存储器（保存在内存中，进程退出即失）。
//  LangGraph 还提供 SqliteSaver / PostgresSaver（在独立的官方包中）用于生产环境。
//
//  compile({ checkpointer }) 之后，图的行为发生本质变化：
//    - 每次 invoke/stream 必须传入 config.configurable.thread_id
//    - 每个节点执行完毕，当前 State 自动保存为一个 checkpoint（快照）
//    - 同一 thread_id 再次调用时，自动从最新 checkpoint 恢复 State 继续执行
//
// ============================================================================

const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

/** 便捷构造带 thread_id 的调用配置 */
function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

// ============================================================================
// 4. 图结构可视化
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化");
  console.log("═".repeat(70));

  const graph = app.getGraph();
  const mermaidStr = graph.drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  const mermaidFilePath = path.join(process.cwd(), "graph.mmd");
  fs.writeFileSync(mermaidFilePath, mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${mermaidFilePath}`);

  try {
    const pngBlob = await graph.drawMermaidPng();
    const pngBuffer = Buffer.from(await pngBlob.arrayBuffer());
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), pngBuffer);
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

// ============================================================================
// 5. 演示函数
// ============================================================================

/** 打印某 thread 当前状态中的消息列表 */
async function printThreadMessages(threadId: string, label: string) {
  const state = await app.getState(threadConfig(threadId));
  console.log(`  [${label}] thread "${threadId}" 当前共 ${state.values.messages.length} 条消息：`);
  for (const m of state.values.messages as BaseMessage[]) {
    const role = m._getType() === "human" ? "👤" : "🤖";
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    console.log(`    ${role} ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`);
  }
}

/**
 * 演示1：thread_id 自动多轮记忆
 *
 * 对比项目1：不再手动传递 conversationHistory，
 * 只需要每次传入相同的 thread_id + 新消息。
 */
async function demoAutoMemory() {
  console.log("═".repeat(70));
  console.log("  演示1：thread_id 自动多轮记忆");
  console.log("═".repeat(70));

  const threadId = "user-alice";
  console.log(`\n  使用 thread_id = "${threadId}"（只传新消息，历史由 checkpointer 管理）\n`);

  // 第1轮：告诉 AI 名字
  console.log(`👤 第1轮：我叫小明，今年 28 岁。`);
  const r1 = await app.invoke(
    { messages: [new HumanMessage("我叫小明，今年 28 岁。")] },
    threadConfig(threadId),
  );
  console.log(`🤖 ${(r1.messages.at(-1) as AIMessage).content}\n`);

  // 第2轮：只问问题，不传历史 —— AI 仍记得名字
  console.log(`👤 第2轮：我叫什么名字？多大了？`);
  const r2 = await app.invoke(
    { messages: [new HumanMessage("我叫什么名字？多大了？")] },
    threadConfig(threadId),
  );
  console.log(`🤖 ${(r2.messages.at(-1) as AIMessage).content}\n`);

  await printThreadMessages(threadId, "记忆验证");
  console.log(`\n  ★ 注意：第2轮只传了 1 条新消息，但状态中已有 ${r2.messages.length} 条消息，`);
  console.log(`    说明 checkpointer 自动拼接了第1轮的历史。`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示2：多会话隔离 —— 不同 thread_id 互不影响
 */
async function demoSessionIsolation() {
  console.log("═".repeat(70));
  console.log("  演示2：多会话隔离（不同 thread_id）");
  console.log("═".repeat(70));

  // thread-B 是全新会话，问同样的问题，AI 应该不知道名字
  const threadB = "user-bob";
  console.log(`\n  使用新的 thread_id = "${threadB}"（全新会话）\n`);
  console.log(`👤 我叫什么名字？`);
  const r = await app.invoke(
    { messages: [new HumanMessage("我叫什么名字？")] },
    threadConfig(threadB),
  );
  console.log(`🤖 ${(r.messages.at(-1) as AIMessage).content}\n`);

  await printThreadMessages("user-alice", "会话A");
  console.log();
  await printThreadMessages(threadB, "会话B");
  console.log(`\n  ★ 会话B 没有会话A 的历史，说明 thread_id 实现了会话级隔离。`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示3：getStateHistory 查看历史 + 时间旅行
 *
 * 时间旅行 = 从历史 checkpoint 恢复状态，用新输入继续执行，
 * 从该历史点产生一条新的对话分支（原历史不会被修改）。
 */
async function demoTimeTravel() {
  console.log("═".repeat(70));
  console.log("  演示3：getStateHistory 历史快照 + 时间旅行");
  console.log("═".repeat(70));

  const threadId = "user-alice";

  // 查看历史快照
  console.log(`\n  thread "${threadId}" 的历史快照（新 → 旧）：\n`);
  const history: StateSnapshot[] = [];
  for await (const snapshot of app.getStateHistory(threadConfig(threadId))) {
    history.push(snapshot);
  }
  history.forEach((s, i) => {
    const msgCount = (s.values.messages as BaseMessage[]).length;
    const checkpointId = s.config.configurable?.checkpoint_id as string;
    console.log(`    [${i}] checkpoint=${checkpointId.slice(0, 8)}...  消息数=${msgCount}  next=${JSON.stringify(s.next)}`);
  });

  // 时间旅行：回到"只有第1轮对话"的历史点
  // history[0] 是最新快照，找到消息数为 2（第1轮 Human+AI）的那个
  const target = history.find((s) => (s.values.messages as BaseMessage[]).length === 2);
  if (!target) {
    console.log("  ⚠️ 未找到目标历史快照，跳过时间旅行演示");
    return;
  }

  console.log(`\n  选择历史点：消息数=2（第1轮刚结束），从此处用新输入继续 →\n`);
  console.log(`👤 （新分支）其实我骗你的，我真名叫张三！`);

  // ★ 用历史快照的 config（含 checkpoint_id）调用，即"从该点恢复"
  const r = await app.invoke(
    { messages: [new HumanMessage("其实我骗你的，我真名叫张三！")] },
    target.config,
  );
  console.log(`🤖 ${(r.messages.at(-1) as AIMessage).content}\n`);

  console.log(`  ★ 时间旅行的效果：从旧 checkpoint 长出了新分支，`);
  console.log(`    thread "${threadId}" 的最新状态现在走的是"张三"分支。`);
  console.log(`\n${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:05 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目5：记忆与持久化".padEnd(50) + "║");
  console.log("║" + "  核心概念：Checkpoint · MemorySaver · thread_id · 时间旅行".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoAutoMemory();
  await demoSessionIsolation();
  await demoTimeTravel();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
