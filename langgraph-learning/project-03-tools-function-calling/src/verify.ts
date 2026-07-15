/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 的工具调用行为
 *
 * 运行：pnpm verify  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 图结构是否正确构建
 *   2. 工具定义是否正确
 *   3. 工具调用循环是否正常工作
 *   4. ToolNode 是否正确执行工具并返回 ToolMessage
 *   5. 条件边路由是否正确
 *   6. 多轮工具调用是否正常
 */

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 工具定义（与 index.ts 一致，但同步执行）
// ============================================================================

const calculatorTool = tool(
  ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch {
      return `计算失败：无法解析表达式 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算。",
    schema: z.object({
      expression: z.string().describe("要计算的数学表达式"),
    }),
  }
);

const getCurrentTimeTool = tool(
  () => {
    const now = new Date();
    return `当前时间：${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
  },
  {
    name: "get_current_time",
    description: "获取当前时间。",
    schema: z.object({}),
  }
);

const getWeatherTool = tool(
  ({ city }) => {
    const mockWeatherData: Record<string, string> = {
      北京: "晴天，28°C",
      上海: "多云，30°C",
      广州: "雷阵雨，32°C",
    };
    for (const [key, info] of Object.entries(mockWeatherData)) {
      if (city.includes(key) || key.includes(city)) {
        return `${key}今日天气：${info}`;
      }
    }
    return `暂无 "${city}" 的天气数据。支持：${Object.keys(mockWeatherData).join("、")}`;
  },
  {
    name: "get_weather",
    description: "查询城市天气。",
    schema: z.object({
      city: z.string().describe("城市名称"),
    }),
  }
);

const allTools = [calculatorTool, getCurrentTimeTool, getWeatherTool];

// ============================================================================
// 2. Mock Agent —— 模拟 LLM 的工具调用决策（不需要 API Key）
// ============================================================================
//
//  真实的 LLM 会根据用户输入决定是否调用工具。
//  这里我们用关键词匹配来模拟这个决策过程。
//
//  模拟逻辑：
//    - 包含"计算/等于/多少" + 数学表达式 → 调用 calculator
//    - 包含"时间/几点/日期" → 调用 get_current_time
//    - 包含"天气" + 城市名 → 调用 get_weather
//    - 其他 → 直接回复（不调用工具）
//
// ============================================================================

function mockLLMResponse(messages: BaseMessage[]): AIMessage {
  // 找到最后一条 HumanMessage
  const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
  const userText = lastHuman ? (lastHuman.content as string) : "";

  // 检查是否已有 ToolMessage（说明工具已执行，应该给出最终回复）
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg._getType() === "tool") {
    // 工具已执行，LLM 根据工具结果给出最终回复
    const toolMsg = lastMsg as ToolMessage;
    return new AIMessage(`根据查询结果：${toolMsg.content}`);
  }

  // 模拟 LLM 的工具调用决策
  // 数学计算
  const mathMatch = userText.match(/(\d+\s*[+\-*/×÷]\s*\d+)/);
  if (mathMatch && /(计算|等于|多少|算)/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "calculator",
        args: { expression: mathMatch[1].replace(/×/g, "*").replace(/÷/g, "/") },
        id: "mock_call_calc",
        type: "tool_call",
      }],
    });
  }

  // 时间查询
  if (/(时间|几点|日期|现在)/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "get_current_time",
        args: {},
        id: "mock_call_time",
        type: "tool_call",
      }],
    });
  }

  // 天气查询
  if (/天气/.test(userText)) {
    const cityMatch = userText.match(/(北京|上海|广州|深圳|杭州)/);
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "get_weather",
        args: { city: cityMatch ? cityMatch[1] : "未知" },
        id: "mock_call_weather",
        type: "tool_call",
      }],
    });
  }

  // 不需要工具，直接回复
  return new AIMessage(`[Mock回复] 我收到了你的消息："${userText.slice(0, 30)}..."。这是一个不需要工具调用的回复。`);
}

// ============================================================================
// 3. Agent 节点（使用 Mock LLM）
// ============================================================================

async function agentNode(state: typeof MessagesAnnotation.State): Promise<Partial<typeof MessagesAnnotation.State>> {
  const { messages } = state;
  const response = mockLLMResponse(messages);
  return { messages: [response] };
}

// ============================================================================
// 4. ToolNode 实例
// ============================================================================

const toolNode = new ToolNode(allTools);

// ============================================================================
// 5. 构建并编译图
// ============================================================================

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition)
  .addEdge("tools", "agent");

const app = workflow.compile();

// ============================================================================
// 6. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目3 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：工具调用与 Function Calling".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化");
  const graph = app.getGraph();
  const mermaidStr = graph.drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"));

  const mermaidFilePath = path.join(process.cwd(), "graph.mmd");
  fs.writeFileSync(mermaidFilePath, mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${mermaidFilePath}`);

  try {
    const pngBlob = await graph.drawMermaidPng();
    const pngBuffer = Buffer.from(await pngBlob.arrayBuffer());
    const pngFilePath = path.join(process.cwd(), "graph.png");
    fs.writeFileSync(pngFilePath, pngBuffer);
    console.log(`  PNG 图片已保存到：${pngFilePath}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：图结构验证");
    const expectedNodes = ["agent", "tools"];
    const allNodesPresent = expectedNodes.every((node) => mermaidStr.includes(node));
    console.log(`  预期节点：${expectedNodes.join(", ")}`);
    console.log(`  Mermaid 文本中包含所有节点：${allNodesPresent ? "是" : "否"}`);
    console.log(`  ${allNodesPresent ? "✓" : "✗"} 测试${allNodesPresent ? "通过" : "失败"}\n`);
    if (allNodesPresent) passed++;
  }

  // ---- 测试1：calculator 工具调用 ----
  {
    total++;
    console.log("▶ 测试1：calculator 工具调用");
    console.log("  输入：'计算 15 * 37 等于多少？'");

    const result = await app.invoke({
      messages: [new HumanMessage("计算 15 * 37 等于多少？")],
    });

    // 应该有 3 条消息：HumanMessage + AIMessage(tool_calls) + ToolMessage + AIMessage(最终回复)
    const hasToolMessage = result.messages.some((m: BaseMessage) => m._getType() === "tool");
    const toolMsg = result.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage;

    console.log(`  消息数量：${result.messages.length}`);
    console.log(`  包含 ToolMessage：${hasToolMessage ? "是" : "否"}`);
    if (toolMsg) {
      console.log(`  工具名：${toolMsg.name}`);
      console.log(`  工具结果：${toolMsg.content}`);
    }

    const success = hasToolMessage && toolMsg?.name === "calculator" && (toolMsg.content as string).includes("555");
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试2：get_current_time 工具调用 ----
  {
    total++;
    console.log("▶ 测试2：get_current_time 工具调用");
    console.log("  输入：'现在几点了？'");

    const result = await app.invoke({
      messages: [new HumanMessage("现在几点了？")],
    });

    const hasToolMessage = result.messages.some((m: BaseMessage) => m._getType() === "tool");
    const toolMsg = result.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage;

    console.log(`  消息数量：${result.messages.length}`);
    console.log(`  包含 ToolMessage：${hasToolMessage ? "是" : "否"}`);
    if (toolMsg) {
      console.log(`  工具名：${toolMsg.name}`);
      console.log(`  工具结果：${toolMsg.content}`);
    }

    const success = hasToolMessage && toolMsg?.name === "get_current_time";
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试3：get_weather 工具调用 ----
  {
    total++;
    console.log("▶ 测试3：get_weather 工具调用");
    console.log("  输入：'北京天气怎么样？'");

    const result = await app.invoke({
      messages: [new HumanMessage("北京天气怎么样？")],
    });

    const hasToolMessage = result.messages.some((m: BaseMessage) => m._getType() === "tool");
    const toolMsg = result.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage;

    console.log(`  消息数量：${result.messages.length}`);
    console.log(`  包含 ToolMessage：${hasToolMessage ? "是" : "否"}`);
    if (toolMsg) {
      console.log(`  工具名：${toolMsg.name}`);
      console.log(`  工具结果：${toolMsg.content}`);
    }

    const success = hasToolMessage && toolMsg?.name === "get_weather" && (toolMsg.content as string).includes("北京");
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试4：无工具调用（直接回复）----
  {
    total++;
    console.log("▶ 测试4：无工具调用（直接回复）");
    console.log("  输入：'你好，介绍一下你自己'");

    const result = await app.invoke({
      messages: [new HumanMessage("你好，介绍一下你自己")],
    });

    // 应该只有 2 条消息：HumanMessage + AIMessage（无 tool_calls）
    const hasToolMessage = result.messages.some((m: BaseMessage) => m._getType() === "tool");
    const lastMsg = result.messages[result.messages.length - 1];

    console.log(`  消息数量：${result.messages.length}（应为 2：Human + AI）`);
    console.log(`  包含 ToolMessage：${hasToolMessage ? "是" : "否"}`);
    console.log(`  最后消息类型：${lastMsg._getType()}`);

    const success = !hasToolMessage && lastMsg._getType() === "ai" && result.messages.length === 2;
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试5：stream 观察执行路径（工具调用循环）----
  {
    total++;
    console.log("▶ 测试5：stream 观察执行路径");
    console.log("  输入：'计算 100 / 4 等于多少'");
    console.log("  期望路径：agent → tools → agent → END");

    const streamResult = await app.stream({
      messages: [new HumanMessage("计算 100 / 4 等于多少")],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      executedNodes.push(nodeName);
      console.log(`  [chunk] 节点 "${nodeName}" 执行完毕`);
    }

    console.log(`  执行路径：${executedNodes.join(" → ")}`);
    // 期望：agent → tools → agent（3个节点，最后agent输出后路由到END不产生chunk）
    const correctPath = executedNodes.length === 3
      && executedNodes[0] === "agent"
      && executedNodes[1] === "tools"
      && executedNodes[2] === "agent";
    console.log(`  ${correctPath ? "✓" : "✗"} 测试${correctPath ? "通过" : "失败"}\n`);
    if (correctPath) passed++;
  }

  // ---- 测试6：stream 观察执行路径（无工具调用）----
  {
    total++;
    console.log("▶ 测试6：stream 观察执行路径（无工具调用）");
    console.log("  输入：'你好'");
    console.log("  期望路径：agent → END（只有1个节点）");

    const streamResult = await app.stream({
      messages: [new HumanMessage("你好")],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      executedNodes.push(nodeName);
      console.log(`  [chunk] 节点 "${nodeName}" 执行完毕`);
    }

    console.log(`  执行路径：${executedNodes.join(" → ")}`);
    const correctPath = executedNodes.length === 1 && executedNodes[0] === "agent";
    console.log(`  ${correctPath ? "✓" : "✗"} 测试${correctPath ? "通过" : "失败"}\n`);
    if (correctPath) passed++;
  }

  // ---- 测试7：ToolMessage 的 tool_call_id 匹配 ----
  {
    total++;
    console.log("▶ 测试7：ToolMessage 的 tool_call_id 匹配验证");
    console.log("  输入：'计算 3 + 5 等于多少'");

    const result = await app.invoke({
      messages: [new HumanMessage("计算 3 + 5 等于多少")],
    });

    // 找到 AIMessage（带 tool_calls）和 ToolMessage
    const aiMsgWithToolCalls = result.messages.find(
      (m: BaseMessage) => m._getType() === "ai" && (m as AIMessage).tool_calls?.length
    ) as AIMessage;
    const toolMsg = result.messages.find(
      (m: BaseMessage) => m._getType() === "tool"
    ) as ToolMessage;

    let idMatches = false;
    if (aiMsgWithToolCalls && toolMsg && aiMsgWithToolCalls.tool_calls) {
      const callId = aiMsgWithToolCalls.tool_calls[0].id;
      idMatches = toolMsg.tool_call_id === callId;
      console.log(`  AIMessage.tool_calls[0].id: ${callId}`);
      console.log(`  ToolMessage.tool_call_id: ${toolMsg.tool_call_id}`);
      console.log(`  ID 匹配：${idMatches ? "是" : "否"}`);
    } else {
      console.log(`  ✗ 未找到带 tool_calls 的 AIMessage 或 ToolMessage`);
    }

    console.log(`  ${idMatches ? "✓" : "✗"} 测试${idMatches ? "通过" : "失败"}\n`);
    if (idMatches) passed++;
  }

  // ---- 测试8：工具定义验证 ----
  {
    total++;
    console.log("▶ 测试8：工具定义验证");

    const toolNames = allTools.map((t) => t.name);
    const expectedNames = ["calculator", "get_current_time", "get_weather"];
    const allDefined = expectedNames.every((name) => toolNames.includes(name));

    console.log(`  已定义工具：${toolNames.join(", ")}`);
    console.log(`  预期工具：${expectedNames.join(", ")}`);
    console.log(`  所有预期工具都已定义：${allDefined ? "是" : "否"}`);
    console.log(`  ${allDefined ? "✓" : "✗"} 测试${allDefined ? "通过" : "失败"}\n`);
    if (allDefined) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  图结构可视化：已生成 graph.mmd 和 graph.png");
    console.log("  图结构正确：START → agent → (条件边) → tools/END");
    console.log("  工具调用循环正确：agent ⇄ tools 循环");
    console.log("  ToolNode 正确执行工具并返回 ToolMessage");
    console.log("  toolsCondition 正确路由");
    console.log("  tool_call_id 匹配正确");
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
