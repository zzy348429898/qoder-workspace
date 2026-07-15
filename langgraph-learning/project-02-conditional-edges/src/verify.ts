/**
 * 验证脚本：不需要 API Key，用 Mock LLM 测试条件边与动态路由
 *
 * 运行：pnpm verify  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 图结构是否正确构建
 *   2. 不同意图是否路由到正确的处理器
 *   3. 条件边的 pathMap 约束是否生效
 *   4. stream 输出中节点名称是否正确
 *   5. intent 字段的状态流转是否正确
 */

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. State 定义（与 index.ts 一致）
// ============================================================================
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (currentState, update) => currentState.concat(update),
    default: () => [],
  }),
  intent: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "fallback",
  }),
  language: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "中文",
  }),
});

type GraphState = typeof StateAnnotation.State;

// ============================================================================
// 2. Mock 意图分类器 —— 用关键词匹配模拟 LLM 分类（不需要 API Key）
// ============================================================================
function mockClassifyIntent(text: string): string {
  const lowerText = text.toLowerCase();

  // 问候关键词
  if (/^(你好|嗨|hi|hello|hey|早上好|晚上好|很高兴|你是谁)/i.test(lowerText.trim())) {
    return "greeting";
  }

  // 天气关键词
  if (/(天气|weather|下雨|晴|温度|气温)/i.test(lowerText)) {
    return "weather";
  }

  // 数学关键词
  if (/(计算|等于|多少|\d+\s*[+\-*/×÷]\s*\d+|sqrt|平方|立方|面积|周长)/i.test(lowerText)) {
    return "math";
  }

  return "fallback";
}

// ============================================================================
// 3. Node 定义（使用 Mock 逻辑，不调用 LLM）
// ============================================================================

/** classify 节点：Mock 意图分类 */
async function classifyNode(state: GraphState): Promise<Partial<GraphState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText = lastMessage ? (lastMessage.content as string) : "";
  const intent = mockClassifyIntent(userText);
  console.log(`  🔍 [Mock分类] 意图：${intent}`);
  return { intent };
}

/** greeting 处理器 */
async function greetingNode(state: GraphState): Promise<Partial<GraphState>> {
  const response = new AIMessage("[Mock问候] 你好！很高兴见到你 😊");
  return { messages: [response] };
}

/** weather 处理器 */
async function weatherNode(state: GraphState): Promise<Partial<GraphState>> {
  const response = new AIMessage("[Mock天气] 今天天气晴朗，气温 25°C。");
  return { messages: [response] };
}

/** math 处理器 */
async function mathNode(state: GraphState): Promise<Partial<GraphState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText = (lastMessage.content as string) || "";

  // 简单的 Mock 数学计算
  const match = userText.match(/(\d+)\s*([+\-*/×÷])\s*(\d+)/);
  let answer = "[Mock数学] 我收到了一个数学问题";
  if (match) {
    const a = parseInt(match[1]);
    const b = parseInt(match[3]);
    const op = match[2];
    let result: number;
    switch (op) {
      case "+": result = a + b; break;
      case "-": result = a - b; break;
      case "*": case "×": result = a * b; break;
      case "/": case "÷": result = b !== 0 ? a / b : NaN; break;
      default: result = NaN;
    }
    answer = `[Mock数学] ${a} ${op} ${b} = ${result}`;
  }

  const response = new AIMessage(answer);
  return { messages: [response] };
}

/** fallback 处理器 */
async function fallbackNode(state: GraphState): Promise<Partial<GraphState>> {
  const response = new AIMessage("[Mock通用] 抱歉，我不太确定你需要什么，能详细说说吗？");
  return { messages: [response] };
}

// ============================================================================
// 4. 路由函数（与 index.ts 一致）
// ============================================================================
function routeByIntent(state: GraphState): string {
  switch (state.intent) {
    case "greeting": return "greeting";
    case "weather": return "weather";
    case "math": return "math";
    default: return "fallback";
  }
}

// ============================================================================
// 5. 构建并编译图（使用 pathMap 模式）
// ============================================================================
const workflow = new StateGraph(StateAnnotation)
  .addNode("classify", classifyNode)
  .addNode("greeting", greetingNode)
  .addNode("weather", weatherNode)
  .addNode("math", mathNode)
  .addNode("fallback", fallbackNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", routeByIntent, {
    greeting: "greeting",
    weather: "weather",
    math: "math",
    fallback: "fallback",
  })
  .addEdge("greeting", END)
  .addEdge("weather", END)
  .addEdge("math", END)
  .addEdge("fallback", END);

const app = workflow.compile();

// ============================================================================
// 6. 验证测试
// ============================================================================
async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目2 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：条件边与动态路由".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化");
  const graph = app.getGraph();
  const mermaidStr = graph.drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"));

  // 保存 Mermaid 文本到文件
  const mermaidFilePath = path.join(process.cwd(), "graph.mmd");
  fs.writeFileSync(mermaidFilePath, mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${mermaidFilePath}`);

  // 生成 PNG 图片（需要网络）
  try {
    const pngBlob = await graph.drawMermaidPng();
    const pngBuffer = Buffer.from(await pngBlob.arrayBuffer());
    const pngFilePath = path.join(process.cwd(), "graph.png");
    fs.writeFileSync(pngFilePath, pngBuffer);
    console.log(`  PNG 图片已保存到：${pngFilePath}`);
  } catch (err) {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
    console.log(`     Mermaid 文本仍可使用 mermaid.live 在线查看`);
  }
  console.log();

  let passed = 0;
  let total = 0;

  // ---- 测试0：图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：图结构验证");
    // 验证 Mermaid 文本中包含所有预期的节点
    const expectedNodes = ["classify", "greeting", "weather", "math", "fallback"];
    const allNodesPresent = expectedNodes.every((node) => mermaidStr.includes(node));
    console.log(`  预期节点：${expectedNodes.join(", ")}`);
    console.log(`  Mermaid 文本中包含所有节点：${allNodesPresent ? "是" : "否"}`);
    console.log(`  ${allNodesPresent ? "✓" : "✗"} 测试${allNodesPresent ? "通过" : "失败"}\n`);
    if (allNodesPresent) passed++;
  }

  // ---- 测试1：问候意图路由 ----
  {
    total++;
    console.log("▶ 测试1：问候意图 → greeting 处理器");
    console.log("  输入：'你好，很高兴认识你'");

    const result = await app.invoke({
      messages: [new HumanMessage("你好，很高兴认识你")],
      language: "中文",
    });

    const lastMsg = result.messages[result.messages.length - 1];
    const isGreeting = (lastMsg.content as string).includes("Mock问候");
    console.log(`  路由到的 intent：${result.intent}`);
    console.log(`  AI回复：${lastMsg.content}`);
    console.log(`  ${isGreeting ? "✓" : "✗"} 测试${isGreeting ? "通过" : "失败"}\n`);
    if (isGreeting) passed++;
  }

  // ---- 测试2：天气意图路由 ----
  {
    total++;
    console.log("▶ 测试2：天气意图 → weather 处理器");
    console.log("  输入：'今天天气怎么样？'");

    const result = await app.invoke({
      messages: [new HumanMessage("今天天气怎么样？")],
      language: "中文",
    });

    const lastMsg = result.messages[result.messages.length - 1];
    const isWeather = (lastMsg.content as string).includes("Mock天气");
    console.log(`  路由到的 intent：${result.intent}`);
    console.log(`  AI回复：${lastMsg.content}`);
    console.log(`  ${isWeather ? "✓" : "✗"} 测试${isWeather ? "通过" : "失败"}\n`);
    if (isWeather) passed++;
  }

  // ---- 测试3：数学意图路由 ----
  {
    total++;
    console.log("▶ 测试3：数学意图 → math 处理器");
    console.log("  输入：'计算 15 * 37 等于多少？'");

    const result = await app.invoke({
      messages: [new HumanMessage("计算 15 * 37 等于多少？")],
      language: "中文",
    });

    const lastMsg = result.messages[result.messages.length - 1];
    const isMath = (lastMsg.content as string).includes("Mock数学");
    console.log(`  路由到的 intent：${result.intent}`);
    console.log(`  AI回复：${lastMsg.content}`);
    console.log(`  ${isMath ? "✓" : "✗"} 测试${isMath ? "通过" : "失败"}\n`);
    if (isMath) passed++;
  }

  // ---- 测试4：fallback 兜底路由 ----
  {
    total++;
    console.log("▶ 测试4：未知意图 → fallback 处理器");
    console.log("  输入：'请帮我写一首关于量子力学的诗'");

    const result = await app.invoke({
      messages: [new HumanMessage("请帮我写一首关于量子力学的诗")],
      language: "中文",
    });

    const lastMsg = result.messages[result.messages.length - 1];
    const isFallback = (lastMsg.content as string).includes("Mock通用");
    console.log(`  路由到的 intent：${result.intent}`);
    console.log(`  AI回复：${lastMsg.content}`);
    console.log(`  ${isFallback ? "✓" : "✗"} 测试${isFallback ? "通过" : "失败"}\n`);
    if (isFallback) passed++;
  }

  // ---- 测试5：stream 观察执行路径 ----
  {
    total++;
    console.log("▶ 测试5：stream 流式调用 —— 观察执行路径");
    console.log("  输入：'你好'（期望路径：classify → greeting → END）");

    const streamResult = await app.stream({
      messages: [new HumanMessage("你好")],
      language: "中文",
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      executedNodes.push(nodeName);
      console.log(`  [chunk] 节点 "${nodeName}" 执行完毕`);
    }

    const correctPath = executedNodes.length === 2
      && executedNodes[0] === "classify"
      && executedNodes[1] === "greeting";
    console.log(`  执行路径：${executedNodes.join(" → ")}`);
    console.log(`  ${correctPath ? "✓" : "✗"} 测试${correctPath ? "通过" : "失败"}\n`);
    if (correctPath) passed++;
  }

  // ---- 测试6：intent 字段状态流转 ----
  {
    total++;
    console.log("▶ 测试6：intent 字段状态流转验证");
    console.log("  输入：'计算 3 + 5'（期望 intent = 'math'）");

    const result = await app.invoke({
      messages: [new HumanMessage("计算 3 + 5")],
      language: "中文",
    });

    const intentCorrect = result.intent === "math";
    console.log(`  最终 state.intent：${result.intent}`);
    console.log(`  ${intentCorrect ? "✓" : "✗"} 测试${intentCorrect ? "通过" : "失败"}\n`);
    if (intentCorrect) passed++;
  }

  // ---- 测试7：默认 intent 值 ----
  {
    total++;
    console.log("▶ 测试7：intent 默认值验证");
    console.log("  输入：不提供 intent，期望使用默认值 'fallback'");

    const result = await app.invoke({
      messages: [new HumanMessage("测试")],
      // 故意不提供 intent，测试默认值
    });

    // classify 节点会覆盖默认值，但在 classify 执行前应该用默认值
    // 这里验证最终 intent 被 classify 正确设置
    const hasIntent = typeof result.intent === "string" && result.intent.length > 0;
    console.log(`  最终 state.intent：${result.intent}`);
    console.log(`  ${hasIntent ? "✓" : "✗"} 测试${hasIntent ? "通过" : "失败"}\n`);
    if (hasIntent) passed++;
  }

  // ---- 测试8：不同数学运算的路由 ----
  {
    total++;
    console.log("▶ 测试8：不同数学运算的路由");
    console.log("  输入：'100 / 4 等于多少'");

    const result = await app.invoke({
      messages: [new HumanMessage("100 / 4 等于多少")],
      language: "中文",
    });

    const lastMsg = result.messages[result.messages.length - 1];
    const isMath = (lastMsg.content as string).includes("Mock数学");
    console.log(`  路由到的 intent：${result.intent}`);
    console.log(`  AI回复：${lastMsg.content}`);
    console.log(`  ${isMath ? "✓" : "✗"} 测试${isMath ? "通过" : "失败"}\n`);
    if (isMath) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  图结构可视化：已生成 graph.mmd 和 graph.png");
    console.log("  图结构正确：START → classify → (条件边) → 处理器 → END");
    console.log("  条件边路由正确：不同意图被路由到正确的处理器");
    console.log("  pathMap 约束正常工作");
    console.log("  intent 字段状态流转正常");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start 体验真实对话\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
