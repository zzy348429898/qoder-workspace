/**
 * ============================================================================
 *  LangGraph.js 项目3：工具调用与 Function Calling
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. Tool（工具）       — 定义 LLM 可以调用的外部函数
 *    2. tool() 函数        — 用 zod schema 定义工具的输入参数
 *    3. bindTools()        — 将工具绑定到 LLM，让模型知道可以调用哪些工具
 *    4. AIMessage.tool_calls — LLM 返回的工具调用请求
 *    5. ToolMessage        — 工具执行结果的特殊消息类型
 *    6. ToolNode           — LangGraph 内置的工具执行节点
 *    7. toolsCondition     — LangGraph 内置的路由函数（判断是否需要调用工具）
 *    8. MessagesAnnotation — LangGraph 内置的消息列表 State（无需手写 Reducer）
 *
 *  与项目2的对比：
 *    项目2：classify 节点用 LLM 做意图分类，条件边路由到不同处理器（LLM 只做分类）
 *    项目3：agent 节点用 LLM 决定是否调用工具，ToolNode 执行工具后回到 agent（循环）
 *
 *  图结构示意：
 *
 *     START ──→ "agent" ──→ (有 tool_calls?) ──是──→ "tools" ──→ "agent" (循环)
 *                          └──否──→ END
 *
 *  工作流程：
 *    1. 用户输入 → agent 节点调用 LLM（已绑定工具）
 *    2. LLM 决定是否调用工具：
 *       - 是 → 返回 AIMessage.tool_calls → 条件边路由到 tools 节点
 *       - 否 → 返回普通 AIMessage → 条件边路由到 END
 *    3. tools 节点执行工具，返回 ToolMessage → 回到 agent 节点
 *    4. agent 节点再次调用 LLM（此时 LLM 能看到工具返回的结果）
 *    5. 重复 2-4，直到 LLM 不再请求工具调用
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install
 *    3. pnpm start          （需要 API Key）
 *    4. pnpm verify         （Mock 模式，无需 API Key）
 * ============================================================================
 */

// ============================================================================
// 0. 导入依赖
// ============================================================================

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
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
// 概念1：Tool（工具）—— 定义 LLM 可以调用的外部函数
// ============================================================================
//
//  Tool 是 LangGraph/LangChain 中"工具调用"的基础。
//  你可以把任何函数包装成 Tool，让 LLM 决定何时、如何调用它。
//
//  定义工具需要三要素：
//    1. 执行函数 — 实际的逻辑（接收参数，返回结果字符串）
//    2. name      — 工具名称（LLM 用这个名字来调用工具）
//    3. description — 工具描述（LLM 根据描述判断何时使用此工具）
//    4. schema    — 用 zod 定义输入参数的结构和类型
//
//  ★ 关键理解：
//    LLM 不会直接执行你的函数！
//    LLM 只是根据 description 判断"应该调用哪个工具"，然后返回工具名 + 参数。
//    你的代码（ToolNode）负责真正执行函数，把结果返回给 LLM。
//
//  对比项目2：
//    项目2：我们用条件边手动路由到不同处理器
//    项目3：LLM 自己决定调用哪个工具，ToolNode 自动执行
//
// ============================================================================

/**
 * 工具1：计算器 —— 执行数学运算
 *
 * LLM 看到用户问 "计算 15 * 37" 时，会调用此工具，
 * 传入 { expression: "15 * 37" }，工具返回计算结果。
 */
const calculatorTool = tool(
  async ({ expression }) => {
    console.log(`  🔧 [工具执行] calculator("${expression}")`);

    try {
      // 安全地计算数学表达式
      // 注意：生产环境中应使用更安全的表达式解析器（如 mathjs）
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch {
      return `计算失败：无法解析表达式 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算。支持加减乘除、括号等基本运算。例如：'15 * 37'、'(2 + 3) * 4'、'sqrt(16)'。",
    schema: z.object({
      expression: z.string().describe("要计算的数学表达式，例如 '15 * 37' 或 '(2 + 3) * 4'"),
    }),
  }
);

/**
 * 工具2：获取当前时间
 *
 * LLM 看到用户问 "现在几点" 时，会调用此工具。
 */
const getCurrentTimeTool = tool(
  async () => {
    console.log(`  🔧 [工具执行] getCurrentTime()`);
    const now = new Date();
    const timeStr = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    return `当前时间：${timeStr}`;
  },
  {
    name: "get_current_time",
    description: "获取当前的日期和时间。",
    schema: z.object({}),  // 无参数
  }
);

/**
 * 工具3：查询天气（Mock 数据）
 *
 * LLM 看到用户问 "北京天气怎么样" 时，会调用此工具。
 */
const getWeatherTool = tool(
  async ({ city }) => {
    console.log(`  🔧 [工具执行] getWeather("${city}")`);

    // Mock 天气数据
    const mockWeatherData: Record<string, string> = {
      北京: "晴天，气温 28°C，湿度 40%，微风",
      上海: "多云，气温 30°C，湿度 65%，东南风 3 级",
      广州: "雷阵雨，气温 32°C，湿度 80%",
      深圳: "阴天，气温 31°C，湿度 70%",
      杭州: "晴转多云，气温 29°C，湿度 55%",
    };

    // 模糊匹配城市名
    let weatherInfo: string | null = null;
    for (const [key, info] of Object.entries(mockWeatherData)) {
      if (city.includes(key) || key.includes(city)) {
        weatherInfo = `${key}今日天气：${info}`;
        break;
      }
    }

    return weatherInfo || `抱歉，暂无 "${city}" 的天气数据。目前支持查询：${Object.keys(mockWeatherData).join("、")}`;
  },
  {
    name: "get_weather",
    description: "查询指定城市的天气情况。目前支持：北京、上海、广州、深圳、杭州。",
    schema: z.object({
      city: z.string().describe("要查询天气的城市名称，例如 '北京'、'上海'"),
    }),
  }
);

// 所有工具的列表
const allTools = [calculatorTool, getCurrentTimeTool, getWeatherTool];

// ============================================================================
// LLM 实例初始化 + bindTools
// ============================================================================
//
//  ★ 概念2：bindTools() —— 将工具绑定到 LLM
//
//  bindTools 做了什么：
//    - 把工具的 name、description、schema 转换为 LLM 能理解的格式
//    - 让 LLM 在生成回复时，知道有哪些工具可以使用
//    - LLM 会根据用户输入和工具描述，决定是否调用工具
//
//  绑定后，LLM 的 invoke() 返回的 AIMessage 可能包含 tool_calls 字段：
//    AIMessage {
//      content: "",           // 可能为空（LLM 决定调用工具时通常不输出文本）
//      tool_calls: [{         // 工具调用请求
//        name: "calculator",
//        args: { expression: "15 * 37" },
//        id: "tool_call_xxx"  // 唯一ID，用于匹配 ToolMessage
//      }]
//    }
//
// ============================================================================

const baseModel = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  // 显式设置 topP 为合法值（默认 -1 会被某些 API 代理拒绝）
  topP: 1,
});

// 将工具绑定到 LLM
const modelWithTools = baseModel.bindTools(allTools);

// ============================================================================
// 概念3：MessagesAnnotation —— 内置的消息列表 State
// ============================================================================
//
//  MessagesAnnotation 是 LangGraph 内置的 State 定义：
//    - 只有一个 messages 字段（BaseMessage[]）
//    - Reducer：智能拼接策略（自动处理消息去重和覆盖）
//    - 无需手写 Annotation.Root({ messages: ... })
//
//  对比项目1/2的手写 State：
//    项目1/2：Annotation.Root({ messages: Annotation<BaseMessage[]>({...}) })
//    项目3：直接用 MessagesAnnotation（一行搞定）
//
//  如果需要额外字段，可以组合：
//    const StateAnnotation = Annotation.Root({
//      ...MessagesAnnotation.spec,  // 继承 messages
//      myField: Annotation<string>({...}),  // 自定义字段
//    });
//
// ============================================================================

// ============================================================================
// 概念4：Node —— agent 节点
// ============================================================================
//
//  agent 节点是整个图的核心：
//    1. 读取 messages（完整对话历史，包括之前的 ToolMessage）
//    2. 调用 LLM（已绑定工具）
//    3. 返回 LLM 的响应（AIMessage，可能包含 tool_calls）
//
//  关键点：
//    - agent 不需要自己判断是否调用工具，LLM 自己决定
//    - agent 只负责把 messages 传给 LLM，把 LLM 的响应放回 messages
//    - 条件边（toolsCondition）负责判断是否需要路由到 tools 节点
//
// ============================================================================

const SYSTEM_PROMPT = `你是一个有用的助手。你可以使用以下工具来帮助用户：
- calculator：执行数学计算
- get_current_time：获取当前时间
- get_weather：查询城市天气

当用户的问题需要使用工具时，请调用合适的工具。
当你获得了足够的信息后，请用中文给出最终的回答。`;

/**
 * agent 节点：调用 LLM（已绑定工具）
 *
 * @param state - 当前图状态（包含 messages）
 * @returns - 部分状态更新（返回 LLM 的 AIMessage）
 */
async function agentNode(state: typeof MessagesAnnotation.State): Promise<Partial<typeof MessagesAnnotation.State>> {
  // 获取完整的消息列表
  const { messages } = state;

  // 调用 LLM（已绑定工具）
  // LLM 会根据消息历史决定：
  //   - 直接回复（如果不需要工具）
  //   - 调用工具（返回 AIMessage.tool_calls）
  const response = await modelWithTools.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...messages,
  ]);

  // 返回 LLM 的响应，它会通过 messages reducer 自动拼接到消息列表
  return { messages: [response] };
}

// ============================================================================
// 概念5：ToolNode —— 内置的工具执行节点
// ============================================================================
//
//  ToolNode 是 LangGraph 内置的节点，它：
//    1. 读取最后一条 AIMessage 的 tool_calls
//    2. 根据工具名找到对应的工具函数并执行
//    3. 为每个工具调用生成一个 ToolMessage（包含执行结果）
//    4. 返回 ToolMessage 列表
//
//  ToolMessage 的关键属性：
//    - content：工具执行的返回值
//    - tool_call_id：对应 AIMessage.tool_calls 中的 id（用于匹配）
//    - name：工具名称
//
//  如果 LLM 同时请求了多个工具调用，ToolNode 会并行执行它们。
//
// ============================================================================

const toolNode = new ToolNode(allTools);

// ============================================================================
// 概念6：组装图 —— agent ⇄ tools 循环
// ============================================================================
//
//  图结构：
//    START → agent → (条件边: toolsCondition) → tools → agent (循环)
//                                          → END
//
//  ★ toolsCondition 是 LangGraph 内置的路由函数：
//    - 检查最后一条消息是否有 tool_calls
//    - 有 → 返回 "tools"
//    - 无 → 返回 END
//
//  对比项目2的手写路由函数：
//    项目2：自己写 routeByIntent(state) → 返回节点名
//    项目3：直接用 toolsCondition（内置，一行搞定）
//
// ============================================================================

const workflow = new StateGraph(MessagesAnnotation)
  // 注册 agent 节点
  .addNode("agent", agentNode)
  // 注册 tools 节点（ToolNode 实例可以直接作为节点）
  .addNode("tools", toolNode)
  // 静态边：START → agent
  .addEdge(START, "agent")
  // ★ 条件边：agent → (有工具调用?) → tools 或 END
  // 使用内置的 toolsCondition 路由函数
  .addConditionalEdges("agent", toolsCondition)
  // 静态边：tools → agent（工具执行完毕后回到 agent）
  .addEdge("tools", "agent");

// ============================================================================
// 编译图
// ============================================================================
const app = workflow.compile();

// ============================================================================
// 图结构可视化
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
  } catch (err) {
    console.log(`⚠️  PNG 生成失败（需要网络连接访问 Mermaid.INK API）`);
    console.log(`   不影响后续功能，Mermaid 文本仍可使用。`);
  }

  console.log();
}

// ============================================================================
// 演示函数
// ============================================================================

/**
 * 演示1：单次工具调用
 *
 * 用户问一个数学问题，LLM 调用 calculator 工具
 */
async function demoSingleToolCall() {
  console.log("═".repeat(70));
  console.log("  演示1：单次工具调用（calculator）");
  console.log("═".repeat(70));

  const userInput = "请帮我计算 15 * 37 等于多少？";
  console.log(`\n👤 用户：${userInput}\n`);

  const streamResult = await app.stream({
    messages: [new HumanMessage(userInput)],
  });

  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    console.log(`  [stream 事件] 节点 "${nodeName}" 执行完毕`);

    // 打印节点返回的消息详情
    const messages = chunk[nodeName].messages;
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const msgType = msg._getType();
        if (msgType === "ai") {
          const aiMsg = msg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            console.log(`    → AIMessage: 请求调用工具 ${aiMsg.tool_calls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(", ")}`);
          } else {
            console.log(`    → AIMessage: "${(aiMsg.content as string).slice(0, 100)}..."`);
          }
        } else if (msgType === "tool") {
          const toolMsg = msg as ToolMessage;
          console.log(`    → ToolMessage [${toolMsg.name}]: "${(toolMsg.content as string).slice(0, 100)}"`);
        }
      }
    }
  }

  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示2：多次工具调用（不同工具）
 *
 * 用户连续问不同类型的问题，观察 LLM 调用不同的工具
 */
async function demoMultipleTools() {
  console.log("═".repeat(70));
  console.log("  演示2：不同工具的调用");
  console.log("═".repeat(70));

  const testCases = [
    "现在几点了？",
    "北京今天天气怎么样？",
    "计算 (100 + 200) / 3 等于多少？",
  ];

  for (const userInput of testCases) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`👤 用户：${userInput}`);
    console.log(`${"─".repeat(70)}\n`);

    const streamResult = await app.stream({
      messages: [new HumanMessage(userInput)],
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      executedNodes.push(nodeName);
      console.log(`  [stream 事件] 节点 "${nodeName}" 执行完毕`);
    }

    console.log(`\n  执行路径：${executedNodes.join(" → ")}`);
  }

  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示3：交互式聊天
 *
 * 用户可以输入任何消息，agent 会自动决定是否调用工具
 */
async function interactiveChat() {
  console.log("═".repeat(70));
  console.log("  交互式聊天（工具调用 Agent）");
  console.log("  试试问时间、查天气、做数学计算");
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

    const result = await app.invoke({
      messages: [...conversationHistory, userMessage],
    });

    // 打印最后的 AI 回复
    const lastMsg = result.messages[result.messages.length - 1];
    if (lastMsg._getType() === "ai") {
      console.log(`\n🤖 AI: ${(lastMsg as AIMessage).content}\n`);
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
    console.error("   或运行 pnpm verify 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目3：工具调用与 Function Calling".padEnd(50) + "║");
  console.log("║" + "".padEnd(68) + "║");
  console.log("║" + "  核心概念：Tool · bindTools · ToolNode · ToolMessage".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\n");

  // 图结构可视化
  await visualizeGraph();

  // 演示1：单次工具调用
  await demoSingleToolCall();

  // 演示2：不同工具的调用
  await demoMultipleTools();

  // 演示3：交互式聊天
  await interactiveChat();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
