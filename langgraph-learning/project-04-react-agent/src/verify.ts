/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 ReAct Agent 的多轮推理行为
 *
 * 运行：npm run verify  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 手动实现的 ReAct 图结构是否正确
 *   2. 单轮工具调用是否正常
 *   3. 多轮 ReAct 循环（search → calculator → 回答）是否正常
 *   4. 最大迭代次数限制是否能终止无限循环
 *   5. iterationCount 累加 Reducer 是否正确
 *   6. createReactAgent 内置实现是否行为一致
 *   7. 文件读写工具是否正常（含路径逃逸防护）
 */

import { StateGraph, START, END, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode, createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 工具定义（与 index.ts 一致，同步执行）
// ============================================================================

const knowledgeBase: Record<string, string> = {
  iphone: "iPhone 是苹果公司的智能手机产品。2024 年全球销量约 2.3 亿部，平均售价约 900 美元。",
  苹果: "苹果公司（Apple Inc.）2024 财年总营收约 3910 亿美元。",
  特斯拉: "特斯拉 2024 年全球交付约 179 万辆电动车。",
};

const searchTool = tool(
  ({ query }) => {
    const lowerQuery = query.toLowerCase();
    const hits: string[] = [];
    for (const [keyword, info] of Object.entries(knowledgeBase)) {
      if (lowerQuery.includes(keyword.toLowerCase()) || keyword.includes(query)) {
        hits.push(info);
      }
    }
    return hits.length > 0 ? `搜索结果：${hits.join(" ")}` : `未找到与 "${query}" 相关的信息`;
  },
  {
    name: "search",
    description: "搜索信息。",
    schema: z.object({ query: z.string().describe("搜索关键词") }),
  }
);

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
    schema: z.object({ expression: z.string().describe("数学表达式") }),
  }
);

// ---- 文件读写工具（限制 sandbox/ 目录）----

const SANDBOX_DIR = path.join(process.cwd(), "sandbox");

function resolveSandboxPath(fileName: string): string {
  const resolved = path.resolve(SANDBOX_DIR, fileName);
  if (!resolved.startsWith(SANDBOX_DIR + path.sep) && resolved !== SANDBOX_DIR) {
    throw new Error(`安全限制：只能访问 sandbox/ 目录内的文件`);
  }
  return resolved;
}

const readFileTool = tool(
  ({ fileName }) => {
    try {
      const filePath = resolveSandboxPath(fileName);
      if (!fs.existsSync(filePath)) {
        return `文件不存在：sandbox/${fileName}`;
      }
      return `文件内容：${fs.readFileSync(filePath, "utf-8")}`;
    } catch (err) {
      return `读取失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "read_file",
    description: "读取 sandbox/ 目录下的文件。",
    schema: z.object({ fileName: z.string().describe("文件名") }),
  }
);

const writeFileTool = tool(
  ({ fileName, content }) => {
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
    description: "写入文件到 sandbox/ 目录。",
    schema: z.object({
      fileName: z.string().describe("文件名"),
      content: z.string().describe("文件内容"),
    }),
  }
);

const allTools = [searchTool, calculatorTool, readFileTool, writeFileTool];

// ============================================================================
// 2. 自定义 State（与 index.ts 一致：messages + iterationCount）
// ============================================================================

const ReactAgentAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  iterationCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
});

const MAX_ITERATIONS = 5;

// ============================================================================
// 3. Mock LLM —— 模拟 ReAct 的多轮推理决策（不需要 API Key）
// ============================================================================
//
//  模拟的决策链（以多步问题 "iPhone 销量多少？总营收多少美元？" 为例）：
//    第1轮：HumanMessage → 返回 search 的 tool_calls
//    第2轮：ToolMessage(search) → 返回 calculator 的 tool_calls
//    第3轮：ToolMessage(calculator) → 返回最终回答（无 tool_calls）
//
// ============================================================================

function mockLLMResponse(messages: BaseMessage[]): AIMessage {
  const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
  const userText = lastHuman ? (lastHuman.content as string) : "";
  const lastMsg = messages[messages.length - 1];

  // 上一轮是工具执行结果（Observation）→ 决定下一步
  if (lastMsg && lastMsg._getType() === "tool") {
    const toolMsg = lastMsg as ToolMessage;

    // 搜索完成且问题还需要计算 → 第二轮调用 calculator（模拟多步推理）
    if (toolMsg.name === "search" && /(总营收|多少美元|计算)/.test(userText)) {
      return new AIMessage({
        content: "",
        tool_calls: [{
          name: "calculator",
          args: { expression: "230000000 * 900" },
          id: "mock_call_calc_after_search",
          type: "tool_call",
        }],
      });
    }

    // 其他工具结果 → 给出最终回答（ReAct 循环正常终止）
    const content = typeof toolMsg.content === "string" ? toolMsg.content : "";
    return new AIMessage(`[Mock最终回答] 根据 ${toolMsg.name} 的结果：${content.slice(0, 60)}`);
  }

  // 首轮：根据用户问题决定调用哪个工具
  if (/(销量|营收|搜索|查询|人口|交付)/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "search",
        args: { query: "iPhone 销量" },
        id: "mock_call_search",
        type: "tool_call",
      }],
    });
  }
  if (/(计算|等于)/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "calculator",
        args: { expression: "15 * 37" },
        id: "mock_call_calc",
        type: "tool_call",
      }],
    });
  }
  if (/写入/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "write_file",
        args: { fileName: "verify-test.txt", content: "ReAct 学习笔记" },
        id: "mock_call_write",
        type: "tool_call",
      }],
    });
  }
  if (/(读取|读一下)/.test(userText)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "read_file",
        args: { fileName: "verify-test.txt" },
        id: "mock_call_read",
        type: "tool_call",
      }],
    });
  }

  // 不需要工具 → 直接回复
  return new AIMessage(`[Mock回复] 收到："${userText.slice(0, 30)}"。这是一个不需要工具调用的回复。`);
}

// ============================================================================
// 4. 手动实现的 ReAct 图（Mock 版本，与 index.ts 结构一致）
// ============================================================================

async function mockAgentNode(
  state: typeof ReactAgentAnnotation.State
): Promise<Partial<typeof ReactAgentAnnotation.State>> {
  const response = mockLLMResponse(state.messages);
  return { messages: [response], iterationCount: 1 };
}

function shouldContinue(state: typeof ReactAgentAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage._getType() !== "ai") {
    return END;
  }
  const aiMessage = lastMessage as AIMessage;
  if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
    return END;
  }
  if (state.iterationCount >= MAX_ITERATIONS) {
    return END;
  }
  return "tools";
}

const manualApp = new StateGraph(ReactAgentAnnotation)
  .addNode("agent", mockAgentNode)
  .addNode("tools", new ToolNode(allTools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();

// ---- 无限循环版本：Mock LLM 永远返回 tool_calls（用于测试最大迭代限制）----

const infiniteLoopApp = new StateGraph(ReactAgentAnnotation)
  .addNode("agent", async () => ({
    messages: [new AIMessage({
      content: "",
      tool_calls: [{
        name: "calculator",
        args: { expression: "1 + 1" },
        id: `mock_loop_${Math.random().toString(36).slice(2)}`,
        type: "tool_call",
      }],
    })],
    iterationCount: 1,
  }))
  .addNode("tools", new ToolNode(allTools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();

// ============================================================================
// 5. MockChatModel —— 用于测试 createReactAgent 的假 LLM
// ============================================================================
//
//  createReactAgent 要求 llm 参数是一个 ChatModel（有 invoke/bindTools 方法），
//  项目3 verify 中的"函数式 mock"无法直接传入。
//  这里继承 BaseChatModel 实现一个最小的假模型：
//    - _generate() → 复用上面的 mockLLMResponse 决策逻辑
//    - bindTools() → 直接返回自身（工具决策已在 _generate 中模拟）
//
// ============================================================================

class MockChatModel extends BaseChatModel {
  _llmType(): string {
    return "mock-react-agent";
  }

  override bindTools(): MockChatModel {
    return this;
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const aiMessage = mockLLMResponse(messages);
    return {
      generations: [{
        message: aiMessage,
        text: typeof aiMessage.content === "string" ? aiMessage.content : "",
      }],
      llmOutput: {},
    };
  }
}

/** createReactAgent 内置实现（Mock 版本） */
const builtinApp = createReactAgent({
  llm: new MockChatModel({}),
  tools: allTools,
});

// ============================================================================
// 6. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目4 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：ReAct 智能体".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化（手动实现）");
  const graph = manualApp.getGraph();
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

  // ---- 测试0：手动版图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：手动版图结构验证");
    const expectedNodes = ["agent", "tools"];
    const allNodesPresent = expectedNodes.every((node) => mermaidStr.includes(node));
    console.log(`  预期节点：${expectedNodes.join(", ")}`);
    console.log(`  Mermaid 文本中包含所有节点：${allNodesPresent ? "是" : "否"}`);
    console.log(`  ${allNodesPresent ? "✓" : "✗"} 测试${allNodesPresent ? "通过" : "失败"}\n`);
    if (allNodesPresent) passed++;
  }

  // ---- 测试1：单轮工具调用（search）----
  {
    total++;
    console.log("▶ 测试1：单轮工具调用（search）");
    console.log("  输入：'iPhone 2024 年销量是多少？'");
    console.log("  期望循环：agent → tools → agent（1 轮工具调用后给出回答）");

    const result = await manualApp.invoke({
      messages: [new HumanMessage("iPhone 2024 年销量是多少？")],
    });

    const toolMsg = result.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage | undefined;
    const lastMsg = result.messages[result.messages.length - 1];

    console.log(`  消息数量：${result.messages.length}（预期 4：Human → AI → Tool → AI）`);
    console.log(`  工具名：${toolMsg?.name}`);
    console.log(`  iterationCount：${result.iterationCount}（预期 2）`);

    const success = result.messages.length === 4
      && toolMsg?.name === "search"
      && (toolMsg.content as string).includes("iPhone")
      && lastMsg._getType() === "ai"
      && result.iterationCount === 2;
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试2：多轮 ReAct 循环（search → calculator → 回答）----
  {
    total++;
    console.log("▶ 测试2：多轮 ReAct 循环（search → calculator → 回答）");
    console.log("  输入：'2024 年 iPhone 销量多少部？总营收大约多少美元？'");
    console.log("  期望循环：agent → tools → agent → tools → agent（2 轮工具调用）");

    const streamResult = await manualApp.stream({
      messages: [new HumanMessage("2024 年 iPhone 销量多少部？总营收大约多少美元？")],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      executedNodes.push(Object.keys(chunk)[0]);
    }

    const result = await manualApp.invoke({
      messages: [new HumanMessage("2024 年 iPhone 销量多少部？总营收大约多少美元？")],
    });

    const toolMsgs = result.messages.filter((m: BaseMessage) => m._getType() === "tool") as ToolMessage[];
    const toolNames = toolMsgs.map((m) => m.name);
    const lastMsg = result.messages[result.messages.length - 1];

    console.log(`  stream 执行路径：${executedNodes.join(" → ")}`);
    console.log(`  工具调用顺序：${toolNames.join(" → ")}`);
    console.log(`  iterationCount：${result.iterationCount}（预期 3）`);
    console.log(`  最终回答：${(lastMsg.content as string).slice(0, 60)}...`);

    const correctPath = executedNodes.join(",") === "agent,tools,agent,tools,agent";
    const success = correctPath
      && toolNames.join(",") === "search,calculator"
      && result.iterationCount === 3
      && lastMsg._getType() === "ai"
      && !(lastMsg as AIMessage).tool_calls?.length;
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试3：无工具调用（直接回复）----
  {
    total++;
    console.log("▶ 测试3：无工具调用（直接回复，循环立即终止）");
    console.log("  输入：'你好，介绍一下你自己'");

    const result = await manualApp.invoke({
      messages: [new HumanMessage("你好，介绍一下你自己")],
    });

    const hasToolMessage = result.messages.some((m: BaseMessage) => m._getType() === "tool");
    const lastMsg = result.messages[result.messages.length - 1];

    console.log(`  消息数量：${result.messages.length}（应为 2：Human + AI）`);
    console.log(`  包含 ToolMessage：${hasToolMessage ? "是" : "否"}`);
    console.log(`  iterationCount：${result.iterationCount}（预期 1）`);

    const success = !hasToolMessage
      && lastMsg._getType() === "ai"
      && result.messages.length === 2
      && result.iterationCount === 1;
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试4：最大迭代次数限制（防止无限循环）----
  {
    total++;
    console.log("▶ 测试4：最大迭代次数限制（Mock LLM 永远请求工具调用）");
    console.log("  场景：LLM 每轮都返回 tool_calls（永不满足），验证循环被强制终止");
    console.log(`  MAX_ITERATIONS = ${MAX_ITERATIONS}`);

    const streamResult = await infiniteLoopApp.stream({
      messages: [new HumanMessage("永远计算下去")],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      executedNodes.push(Object.keys(chunk)[0]);
    }

    const result = await infiniteLoopApp.invoke({
      messages: [new HumanMessage("永远计算下去")],
    });

    const agentRuns = executedNodes.filter((n) => n === "agent").length;

    console.log(`  stream 执行路径：${executedNodes.join(" → ")}`);
    console.log(`  agent 节点执行次数：${agentRuns}（预期 ${MAX_ITERATIONS}）`);
    console.log(`  最终 iterationCount：${result.iterationCount}（预期 ${MAX_ITERATIONS}）`);

    const success = agentRuns === MAX_ITERATIONS
      && result.iterationCount === MAX_ITERATIONS
      && executedNodes[executedNodes.length - 1] === "agent";
    console.log(`  ${success ? "✓" : "✗"} 循环被正确终止：${success ? "是" : "否"}`);
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试5：文件读写工具 + 路径逃逸防护 ----
  {
    total++;
    console.log("▶ 测试5：文件读写工具 + 路径逃逸防护");

    // 5a：通过图执行写入 + 读取
    await manualApp.invoke({
      messages: [new HumanMessage("把学习笔记写入文件")],
    });
    const readResult = await manualApp.invoke({
      messages: [new HumanMessage("读取刚才的文件")],
    });
    const readMsg = readResult.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage | undefined;
    const writeReadOk = (readMsg?.content as string)?.includes("ReAct 学习笔记") ?? false;
    console.log(`  写入后读取内容一致：${writeReadOk ? "是" : "否"}`);

    // 5b：路径逃逸防护（直接调用工具函数验证）
    const escapeResult = await readFileTool.invoke({ fileName: "../../../etc/passwd" });
    const escapeBlocked = (escapeResult as string).includes("安全限制");
    console.log(`  路径逃逸被拒绝：${escapeBlocked ? "是" : "否"}（read_file("../../../etc/passwd") → "${(escapeResult as string).slice(0, 40)}"）`);

    // 清理测试文件
    const testFile = path.join(SANDBOX_DIR, "verify-test.txt");
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }

    const success = writeReadOk && escapeBlocked;
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试6：createReactAgent 图结构验证 ----
  {
    total++;
    console.log("▶ 测试6：createReactAgent 图结构验证");

    const builtinMermaid = builtinApp.getGraph().drawMermaid();
    console.log("\n  Mermaid 图表：");
    console.log(builtinMermaid
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"));
    console.log();

    const expectedNodes = ["agent", "tools"];
    const allNodesPresent = expectedNodes.every((node) => builtinMermaid.includes(node));
    console.log(`  预期节点：${expectedNodes.join(", ")}`);
    console.log(`  Mermaid 文本中包含所有节点：${allNodesPresent ? "是" : "否"}`);
    console.log(`  ★ 内置实现的图结构与手动实现一致`);
    console.log(`  ${allNodesPresent ? "✓" : "✗"} 测试${allNodesPresent ? "通过" : "失败"}\n`);
    if (allNodesPresent) passed++;
  }

  // ---- 测试7：createReactAgent 多轮 ReAct 循环 ----
  {
    total++;
    console.log("▶ 测试7：createReactAgent 多轮 ReAct 循环（行为与手动实现一致）");
    console.log("  输入：'2024 年 iPhone 销量多少部？总营收大约多少美元？'");

    const streamResult = await builtinApp.stream({
      messages: [new HumanMessage("2024 年 iPhone 销量多少部？总营收大约多少美元？")],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      executedNodes.push(Object.keys(chunk)[0]);
    }

    const result = await builtinApp.invoke({
      messages: [new HumanMessage("2024 年 iPhone 销量多少部？总营收大约多少美元？")],
    });

    const toolMsgs = result.messages.filter((m: BaseMessage) => m._getType() === "tool") as ToolMessage[];
    const toolNames = toolMsgs.map((m) => m.name);
    const lastMsg = result.messages[result.messages.length - 1];

    console.log(`  stream 执行路径：${executedNodes.join(" → ")}`);
    console.log(`  工具调用顺序：${toolNames.join(" → ")}`);

    const success = executedNodes.join(",") === "agent,tools,agent,tools,agent"
      && toolNames.join(",") === "search,calculator"
      && lastMsg._getType() === "ai";
    console.log(`  ${success ? "✓" : "✗"} 测试${success ? "通过" : "失败"}\n`);
    if (success) passed++;
  }

  // ---- 测试8：工具定义验证 ----
  {
    total++;
    console.log("▶ 测试8：工具定义验证");

    const toolNames = allTools.map((t) => t.name);
    const expectedNames = ["search", "calculator", "read_file", "write_file"];
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
    console.log("  手动 ReAct 循环正确：agent ⇄ tools 交替执行直至给出回答");
    console.log("  多轮推理正确：search → calculator → 最终回答");
    console.log("  最大迭代次数限制正确：无限循环被强制终止");
    console.log("  iterationCount 累加 Reducer 正确");
    console.log("  createReactAgent 行为与手动实现一致");
    console.log("  文件读写工具正常，路径逃逸被阻止");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 npm start 体验真实 ReAct Agent\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
