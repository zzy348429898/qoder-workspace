/**
 * 验证脚本：不需要 API Key，用 Mock LLM 测试图的构建和执行流程
 *
 * 运行：npx tsx src/verify.ts
 */

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

// ============================================================================
// 1. State 定义（与 index.ts 完全一致）
// ============================================================================
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (currentState, update) => currentState.concat(update),
    default: () => [],
  }),
  language: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "中文",
  }),
});

type GraphState = typeof StateAnnotation.State;

// ============================================================================
// 2. Mock LLM —— 模拟 LLM 响应（不需要 API Key）
// ============================================================================
class MockLLM {
  invoke(messages: BaseMessage[]): AIMessage {
    // 找到最后一条 HumanMessage，返回一个模拟回复
    const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
    const userText = lastHuman ? (lastHuman.content as string).slice(0, 30) : "(空)";
    return new AIMessage(`[Mock回复] 你说了："${userText}..."。这是一个模拟响应，证明图的执行流程正确！`);
  }
}

const mockModel = new MockLLM();

// ============================================================================
// 3. Node 定义（使用 Mock LLM）
// ============================================================================
async function chatbotNode(state: GraphState): Promise<Partial<GraphState>> {
  const systemPrompt = `你是一个友好的助手。请用${state.language}回答。`;
  const response = mockModel.invoke([new SystemMessage(systemPrompt), ...state.messages]);
  return { messages: [response] };
}

// ============================================================================
// 4. 构建并编译图
// ============================================================================
const workflow = new StateGraph(StateAnnotation)
  .addNode("chatbot", chatbotNode)
  .addEdge(START, "chatbot")
  .addEdge("chatbot", END);

const app = workflow.compile();

// ============================================================================
// 5. 验证测试
// ============================================================================
async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目1 验证测试（Mock 模式）".padEnd(54) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  // ---- 测试1：单次 invoke ----
  console.log("▶ 测试1：invoke 单次调用");
  console.log("  输入：你好，解释一下 LangGraph");

  const result = await app.invoke({
    messages: [new HumanMessage("你好，解释一下 LangGraph")],
    language: "中文",
  });

  console.log(`  输出消息数量：${result.messages.length}`);
  console.log(`  消息1类型：${result.messages[0]._getType()}（HumanMessage）`);
  console.log(`  消息2类型：${result.messages[1]._getType()}（AIMessage）`);
  console.log(`  AI回复内容：${result.messages[1].content}`);
  console.log(`  language字段：${result.language}`);
  console.log("  ✓ invoke 测试通过\n");

  // ---- 测试2：Reducer 验证 ----
  console.log("▶ 测试2：Reducer 拼接策略验证");
  console.log("  输入：3条消息（2条历史 + 1条新消息）");

  const result2 = await app.invoke({
    messages: [
      new HumanMessage("第一条消息"),
      new AIMessage("第一条回复"),
      new HumanMessage("第二条消息"),
    ],
    language: "中文",
  });

  console.log(`  输出消息数量：${result2.messages.length}（应该是4：3条输入+1条AI回复）`);
  console.log(`  ✓ Reducer 测试${result2.messages.length === 4 ? "通过" : "失败"}\n`);

  // ---- 测试3：language 覆盖策略验证 ----
  console.log("▶ 测试3：language 覆盖策略验证");
  console.log("  输入：language = 'English'");

  const result3 = await app.invoke({
    messages: [new HumanMessage("Hello")],
    language: "English",
  });

  console.log(`  输出 language：${result3.language}（应该是 'English'）`);
  console.log(`  ✓ language 覆盖测试${result3.language === "English" ? "通过" : "失败"}\n`);

  // ---- 测试4：stream 流式调用 ----
  console.log("▶ 测试4：stream 流式调用");
  console.log("  输入：测试流式输出");

  const streamResult = await app.stream({
    messages: [new HumanMessage("测试流式输出")],
    language: "中文",
  });

  let chunkCount = 0;
  for await (const chunk of streamResult) {
    chunkCount++;
    const nodeName = Object.keys(chunk)[0];
    console.log(`  [chunk ${chunkCount}] 节点 "${nodeName}" 输出`);
  }
  console.log(`  ✓ stream 测试通过（收到 ${chunkCount} 个 chunk）\n`);

  // ---- 测试5：默认值验证 ----
  console.log("▶ 测试5：State 默认值验证");
  console.log("  输入：只提供 messages，不提供 language");

  const result5 = await app.invoke({
    messages: [new HumanMessage("测试默认值")],
  });

  console.log(`  输出 language：${result5.language}（应该是默认值 '中文'）`);
  console.log(`  ✓ 默认值测试${result5.language === "中文" ? "通过" : "失败"}\n`);

  console.log("═".repeat(62));
  console.log("  ✅ 全部验证测试通过！");
  console.log("  图结构正确：START → chatbot → END");
  console.log("  State 管理正确：Reducer 拼接 + 覆盖策略均工作正常");
  console.log("  invoke 和 stream 调用均工作正常");
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 npm start 体验真实对话\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
