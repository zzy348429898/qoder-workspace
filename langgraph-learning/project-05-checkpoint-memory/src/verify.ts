/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 验证 Checkpoint 记忆功能
 *
 * 运行：pnpm verify:05  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. checkpointer 编译后图结构不变
 *   2. 同一 thread_id 的自动多轮记忆
 *   3. 不同 thread_id 的会话隔离
 *   4. getStateHistory 历史快照递增
 *   5. 时间旅行（从历史 checkpoint 恢复产生新分支）
 */

import { StateGraph, START, END, MessagesAnnotation, MemorySaver, StateSnapshot } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. Mock Chatbot —— 基于完整消息历史的确定性回复（不需要 API Key）
// ============================================================================
//
//  模拟一个"能记住用户名字"的助手：
//    - 用户说"我叫X" → 记住并问候
//    - 用户问"我叫什么" → 从历史中查找名字回答；找不到则说不知道
//  它是否"记得"完全取决于传入的 messages 是否包含历史 —— 正好用来验证
//  checkpointer 是否自动恢复了会话状态。
//
// ============================================================================

// 名字正则：2-4 个汉字 + 必须以标点或结尾收尾（避免把"我叫什么名字？"误匹配为自我介绍）
const NAME_PATTERN = /我叫([一-龥]{2,4})(?=[。！，]|$)/;

function mockChatbotResponse(messages: BaseMessage[]): string {
  const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
  const text = lastHuman ? (lastHuman.content as string) : "";

  // 在完整历史中查找自我介绍
  const introMsg = messages.find(
    (m) => m._getType() === "human" && NAME_PATTERN.test(m.content as string)
  );
  const knownName = introMsg ? (introMsg.content as string).match(NAME_PATTERN)![1] : null;

  // 提问优先判断（否则"我叫什么名字？"会被误认为自我介绍）
  if (/我叫什么|我的名字|还记得我/.test(text)) {
    return knownName ? `你叫${knownName}，我当然记得。` : "抱歉，你还没有告诉我你的名字。";
  }
  const intro = text.match(NAME_PATTERN);
  if (intro) {
    return `你好，${intro[1]}！很高兴认识你，我已经记住你的名字了。`;
  }
  return `[Mock回复] 收到："${text.slice(0, 20)}"。`;
}

async function mockChatbotNode(state: typeof MessagesAnnotation.State) {
  return { messages: [new AIMessage(mockChatbotResponse(state.messages))] };
}

// ============================================================================
// 2. 构建图 + MemorySaver（与 index.ts 结构一致）
// ============================================================================

const checkpointer = new MemorySaver();
const app = new StateGraph(MessagesAnnotation)
  .addNode("chatbot", mockChatbotNode)
  .addEdge(START, "chatbot")
  .addEdge("chatbot", END)
  .compile({ checkpointer });

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

// ============================================================================
// 3. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目5 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：记忆与持久化".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化");
  const mermaidStr = app.getGraph().drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr.split("\n").map((line) => `  ${line}`).join("\n"));
  const mermaidFilePath = path.join(process.cwd(), "graph.mmd");
  fs.writeFileSync(mermaidFilePath, mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${mermaidFilePath}`);
  try {
    const pngBlob = await app.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：图结构验证");
    const ok = mermaidStr.includes("chatbot");
    console.log(`  包含 chatbot 节点：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：同一 thread_id 的自动多轮记忆 ----
  {
    total++;
    console.log("▶ 测试1：同一 thread_id 的自动多轮记忆");
    console.log("  第1轮输入：'我叫小明。' / 第2轮输入：'我叫什么名字？'（只传新消息）");

    const cfg = threadConfig("thread-memory");
    await app.invoke({ messages: [new HumanMessage("我叫小明。")] }, cfg);
    const r2 = await app.invoke({ messages: [new HumanMessage("我叫什么名字？")] }, cfg);

    const reply = r2.messages.at(-1)!.content as string;
    console.log(`  第2轮回复："${reply}"`);
    console.log(`  状态消息总数：${r2.messages.length}（预期 4：两轮 Human+AI）`);

    const ok = reply.includes("小明") && r2.messages.length === 4;
    console.log(`  ${ok ? "✓" : "✗"} checkpointer 自动恢复历史，Mock 基于完整历史回答正确`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：不同 thread_id 会话隔离 ----
  {
    total++;
    console.log("▶ 测试2：不同 thread_id 的会话隔离");
    console.log("  在新 thread 中直接问：'我叫什么名字？'");

    const r = await app.invoke(
      { messages: [new HumanMessage("我叫什么名字？")] },
      threadConfig("thread-isolated"),
    );

    const reply = r.messages.at(-1)!.content as string;
    console.log(`  回复："${reply}"`);
    console.log(`  状态消息总数：${r.messages.length}（预期 2：只有本轮）`);

    const ok = reply.includes("还没有告诉我") && r.messages.length === 2;
    console.log(`  ${ok ? "✓" : "✗"} 新会话没有旧会话的历史，隔离正确`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：getStateHistory 历史快照递增 ----
  {
    total++;
    console.log("▶ 测试3：getStateHistory 历史快照递增");

    const cfg = threadConfig("thread-history");
    await app.invoke({ messages: [new HumanMessage("我叫小红。")] }, cfg);

    const countAfter1: StateSnapshot[] = [];
    for await (const s of app.getStateHistory(cfg)) countAfter1.push(s);

    await app.invoke({ messages: [new HumanMessage("我叫什么名字？")] }, cfg);

    const countAfter2: StateSnapshot[] = [];
    for await (const s of app.getStateHistory(cfg)) countAfter2.push(s);

    console.log(`  1 轮对话后快照数：${countAfter1.length}`);
    console.log(`  2 轮对话后快照数：${countAfter2.length}`);
    console.log(`  快照递增：${countAfter2.length > countAfter1.length ? "是" : "否"}`);

    const ok = countAfter2.length > countAfter1.length;
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：getState 读取当前状态 ----
  {
    total++;
    console.log("▶ 测试4：getState 读取当前状态");

    const state = await app.getState(threadConfig("thread-memory"));
    const messages = state.values.messages as BaseMessage[];
    const hasIntro = messages.some((m) => (m.content as string).includes("我叫小明"));

    console.log(`  thread-memory 当前消息数：${messages.length}`);
    console.log(`  包含第1轮自我介绍消息：${hasIntro ? "是" : "否"}`);
    console.log(`  next（待执行节点）：${JSON.stringify(state.next)}（图已结束，应为空）`);

    const ok = hasIntro && state.next.length === 0;
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试5：时间旅行（从历史 checkpoint 恢复产生新分支）----
  {
    total++;
    console.log("▶ 测试5：时间旅行（从历史 checkpoint 恢复）");

    const cfg = threadConfig("thread-travel");
    await app.invoke({ messages: [new HumanMessage("我叫小明。")] }, cfg);
    await app.invoke({ messages: [new HumanMessage("随便聊聊")] }, cfg);

    // 找到"第1轮刚结束"的快照（消息数 = 2）
    const history: StateSnapshot[] = [];
    for await (const s of app.getStateHistory(cfg)) history.push(s);
    const target = history.find((s) => (s.values.messages as BaseMessage[]).length === 2);

    if (!target) {
      console.log("  ✗ 未找到消息数为 2 的历史快照");
      console.log("  ✗ 测试失败\n");
    } else {
      console.log(`  找到历史快照：checkpoint_id=${(target.config.configurable?.checkpoint_id as string).slice(0, 12)}...`);
      // 从该历史点用新输入恢复 → 新分支
      const r = await app.invoke(
        { messages: [new HumanMessage("我叫什么名字？")] },
        target.config,
      );
      const reply = r.messages.at(-1)!.content as string;
      console.log(`  从历史点恢复后提问，回复："${reply}"`);

      const ok = reply.includes("小明") && r.messages.length === 4;
      console.log(`  ${ok ? "✓" : "✗"} 从旧 checkpoint 成功恢复并长出新分支`);
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  thread_id 自动记忆正确：无需手动传递历史");
    console.log("  多会话隔离正确：不同 thread_id 互不影响");
    console.log("  getStateHistory / getState 读取正常");
    console.log("  时间旅行正确：可从历史 checkpoint 恢复并产生新分支");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:05 体验真实对话\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
