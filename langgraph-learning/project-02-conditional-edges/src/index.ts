/**
 * ============================================================================
 *  LangGraph.js 项目2：条件边与动态路由
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. ConditionalEdge  — 条件边，根据 State 动态决定下一个执行的节点
 *    2. 路由函数         — (state) => "nodeName"，返回目标节点名
 *    3. 动态分支         — 一个节点根据条件走向不同的后续节点
 *    4. addConditionalEdges — 注册条件边的 API
 *    5. pathMap          — 条件边的目标映射表（可选，用于约束+文档化）
 *
 *  与项目1的对比：
 *    项目1：START → chatbot → END（静态边，路径固定）
 *    项目2：START → classify → (条件边) → 不同处理器 → END（动态路由）
 *
 *  图结构示意：
 *
 *                        ┌──→ "greeting"  ──→ END
 *                        ├──→ "weather"   ──→ END
 *     START ──→ "classify" ──┼──→ "math"     ──→ END
 *                        └──→ "fallback"  ──→ END
 *
 *  classify 节点用 LLM 判断用户意图，将结果写入 state.intent，
 *  条件边根据 intent 的值决定路由到哪个处理器。
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

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import * as readline from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

// ============================================================================
// 加载 .env 文件 —— 所有配置都从这里读取，不依赖系统环境变量
// ============================================================================
try {
  process.loadEnvFile();
} catch {
  // .env 文件不存在时忽略
}

// ============================================================================
// 概念1：State —— 扩展状态，增加 intent 字段
// ============================================================================
//
//  与项目1相比，我们在 State 中增加了一个 `intent` 字段。
//  这个字段由 classify 节点写入，然后被条件边读取来决定路由。
//
//  这就是条件边的核心思想：
//    节点通过修改 State 来"表达意图"，条件边通过读取 State 来"执行路由"。
//    节点和路由之间通过 State 解耦，互不直接依赖。
//
// ============================================================================

const StateAnnotation = Annotation.Root({
  /** 对话消息列表（与项目1相同：拼接策略） */
  messages: Annotation<BaseMessage[]>({
    reducer: (currentState, update) => currentState.concat(update),
    default: () => [],
  }),

  /**
   * ★ 新增：用户意图分类
   * - 类型：string
   * - Reducer：覆盖策略（每次分类都替换旧值）
   * - 取值："greeting" | "weather" | "math" | "fallback"
   * - 由 classify 节点写入，条件边读取
   */
  intent: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "fallback",
  }),

  /** 对话语言偏好（与项目1相同） */
  language: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "中文",
  }),
});

type GraphState = typeof StateAnnotation.State;

// ============================================================================
// LLM 实例初始化
// ============================================================================
const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  // 显式设置 topP 为合法值（默认 -1 会被某些 API 代理拒绝）
  topP: 1,
});

// ============================================================================
// 概念2：Node —— 各个处理节点
// ============================================================================
//
//  本项目有 5 个节点：
//    1. classify       — 意图分类节点（用 LLM 判断用户意图）
//    2. greeting       — 问候处理器
//    3. weather        — 天气查询处理器（Mock 数据）
//    4. math           — 数学计算处理器
//    5. fallback       — 兜底处理器
//
//  每个处理器节点都接收完整的 State，返回部分状态更新。
//  注意：处理器节点可以选择性地使用 LLM，也可以纯逻辑处理。
//
// ============================================================================

/**
 * classify 节点：用 LLM 对用户消息进行意图分类
 *
 * 这是整个图的"大脑"——它分析用户输入，判断意图，
 * 将结果写入 state.intent，后续条件边据此路由。
 *
 * @param state - 当前图状态
 * @returns - 部分状态更新（写入 intent 字段）
 */
async function classifyNode(state: GraphState): Promise<Partial<GraphState>> {
  // 取最后一条用户消息
  const lastMessage = state.messages[state.messages.length - 1];
  const userText = lastMessage ? (lastMessage.content as string) : "";

  // 构造分类提示词
  // 要求 LLM 只返回一个单词：greeting / weather / math / fallback
  const classifyPrompt = `你是一个意图分类器。请分析用户的输入，判断其意图类别。
只返回以下四个类别之一，不要返回任何其他内容：

- greeting：问候、打招呼、闲聊（如"你好"、"嗨"、"你是谁"）
- weather：询问天气（如"今天天气怎么样"、"北京下雨吗"）
- math：数学计算（如"1+1等于几"、"计算 3*5"、"sqrt(16) 是多少"）
- fallback：不属于以上任何类别

用户输入："${userText}"

意图类别：`;

  const response = await model.invoke([new HumanMessage(classifyPrompt)]);
  const intent = (response.content as string).trim().toLowerCase();

  // 简单的容错：如果 LLM 返回了非预期值，降级为 fallback
  const validIntents = ["greeting", "weather", "math", "fallback"];
  const finalIntent = validIntents.includes(intent) ? intent : "fallback";

  console.log(`  🔍 意图分类结果：${finalIntent}`);

  // 只返回 intent 字段的更新，不修改 messages
  return { intent: finalIntent };
}

/**
 * greeting 处理器：处理问候类消息
 */
async function greetingNode(state: GraphState): Promise<Partial<GraphState>> {
  const systemPrompt = `你是一个友好的助手。请用${state.language}热情地回应用户的问候。
保持回答简洁、温暖。`;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages,
  ]);

  console.log(`\n🤖 [问候处理器] AI: ${response.content}\n`);
  return { messages: [response] };
}

/**
 * weather 处理器：处理天气查询（Mock 数据，不调用真实天气 API）
 */
async function weatherNode(state: GraphState): Promise<Partial<GraphState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText = (lastMessage.content as string) || "";

  // Mock 天气数据（实际项目中可以调用真实天气 API）
  const mockWeatherData: Record<string, string> = {
    北京: "晴天，气温 28°C，湿度 40%",
    上海: "多云，气温 30°C，湿度 65%",
    广州: "雷阵雨，气温 32°C，湿度 80%",
    深圳: "阴天，气温 31°C，湿度 70%",
  };

  // 尝试匹配城市
  let weatherInfo = "抱歉，我暂时没有该城市的天气数据。";
  for (const [city, info] of Object.entries(mockWeatherData)) {
    if (userText.includes(city)) {
      weatherInfo = `${city}今日天气：${info}`;
      break;
    }
  }

  // 如果没匹配到城市，用 LLM 生成一个通用回复
  let responseContent: string;
  if (weatherInfo.startsWith("抱歉")) {
    const response = await model.invoke([
      new SystemMessage(`你是一个天气助手。请用${state.language}礼貌地告诉用户你目前支持查询的城市。`),
      ...state.messages,
    ]);
    responseContent = response.content as string;
  } else {
    responseContent = weatherInfo;
  }

  const aiMessage = new AIMessage(responseContent);
  console.log(`\n🌤️ [天气处理器] AI: ${responseContent}\n`);

  return { messages: [aiMessage] };
}

/**
 * math 处理器：处理数学计算
 *
 * 用 LLM 来做数学计算（实际项目中可以用工具/代码解释器更可靠）
 */
async function mathNode(state: GraphState): Promise<Partial<GraphState>> {
  const systemPrompt = `你是一个数学助手。请用${state.language}回答。
请仔细计算，给出清晰的步骤和最终答案。如果问题不是数学问题，请说明。`;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages,
  ]);

  console.log(`\n🧮 [数学处理器] AI: ${response.content}\n`);
  return { messages: [response] };
}

/**
 * fallback 处理器：兜底处理，无法分类意图时使用
 */
async function fallbackNode(state: GraphState): Promise<Partial<GraphState>> {
  const systemPrompt = `你是一个通用助手。请用${state.language}回答用户的问题。
如果你不确定用户想要什么，请礼貌地询问更多细节。`;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages,
  ]);

  console.log(`\n💬 [通用处理器] AI: ${response.content}\n`);
  return { messages: [response] };
}

// ============================================================================
// 概念3：路由函数 —— 条件边的核心
// ============================================================================
//
//  路由函数是一个普通函数：
//    输入：当前 State
//    输出：字符串（目标节点名）
//
//  它被 addConditionalEdges 调用，决定从当前节点走向哪个后续节点。
//  路由函数不修改 State，只读取 State 并返回一个路由决策。
//
//  ★ 关键区别：
//    普通边  addEdge(A, B)          → A 永远走向 B（静态）
//    条件边  addConditionalEdges(A, router) → A 走向哪由 router 决定（动态）
//
// ============================================================================

/**
 * ★ 路由函数：根据 state.intent 决定路由目标
 *
 * @param state - 当前图状态
 * @returns - 目标节点名（"greeting" | "weather" | "math" | "fallback"）
 */
function routeByIntent(state: GraphState): string {
  // 读取 classify 节点写入的 intent 字段
  const intent = state.intent;

  // 根据意图返回对应的节点名
  switch (intent) {
    case "greeting":
      return "greeting";
    case "weather":
      return "weather";
    case "math":
      return "math";
    default:
      return "fallback";
  }
}

// ============================================================================
// 概念4：StateGraph + 条件边 —— 组装图
// ============================================================================
//
//  与项目1对比：
//    项目1：addEdge("chatbot", END)  → 静态边，chatbot 永远走向 END
//    项目2：addConditionalEdges("classify", routeByIntent)  → 条件边
//
//  addConditionalEdges 的两种用法：
//
//  用法1（函数模式）：
//    .addConditionalEdges("classify", routeByIntent)
//    路由函数直接返回节点名字符串
//
//  用法2（映射表模式）—— 推荐用于生产环境：
//    .addConditionalEdges("classify", routeByIntent, {
//      "greeting": "greeting",
//      "weather": "weather",
//      "math": "math",
//      "fallback": "fallback",
//    })
//
//  pathMap 的好处：
//    1. 文档化：一眼看出所有可能的路由目标
//    2. 约束：如果路由函数返回了不在映射表中的值，会报错
//    3. 解耦：路由函数返回逻辑值，映射表决定实际节点名
//
// ============================================================================

const workflow = new StateGraph(StateAnnotation)
  // 注册所有节点
  .addNode("classify", classifyNode)
  .addNode("greeting", greetingNode)
  .addNode("weather", weatherNode)
  .addNode("math", mathNode)
  .addNode("fallback", fallbackNode)
  // 静态边：START → classify（图的入口指向分类节点）
  .addEdge(START, "classify")
  // ★ 条件边：classify → (由 routeByIntent 决定走向哪个处理器)
  // 使用映射表模式（推荐），明确列出所有可能的路由目标
  .addConditionalEdges("classify", routeByIntent, {
    greeting: "greeting",
    weather: "weather",
    math: "math",
    fallback: "fallback",
  })
  // 所有处理器 → END（静态边，处理器执行完毕后结束）
  .addEdge("greeting", END)
  .addEdge("weather", END)
  .addEdge("math", END)
  .addEdge("fallback", END);

// ============================================================================
// 编译图
// ============================================================================
const app = workflow.compile();

// ============================================================================
// 概念5：用 invoke 和 stream 观察条件边的行为
// ============================================================================
//
//  条件边的好处在 stream 模式下特别明显：
//  你可以清楚地看到不同输入被路由到了不同的节点。
//
//  stream 输出的 chunk 格式：{ "nodeName": partialState }
//  通过观察 chunk 的 key，就能知道执行了哪个节点。
//
// ============================================================================

/**
 * 演示1：不同意图的路由
 *
 * 发送三条不同类型的消息，观察它们被路由到不同的处理器
 */
async function demoRouting() {
  console.log("═".repeat(70));
  console.log("  演示1：不同意图的路由");
  console.log("═".repeat(70));

  const testCases = [
    { input: "你好！很高兴认识你", expectedIntent: "greeting", expectedNode: "greeting" },
    { input: "北京今天天气怎么样？", expectedIntent: "weather", expectedNode: "weather" },
    { input: "计算 15 * 37 等于多少？", expectedIntent: "math", expectedNode: "math" },
  ];

  for (const tc of testCases) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  用户输入："${tc.input}"`);
    console.log(`  期望路由：classify → ${tc.expectedNode} → END`);
    console.log(`${"─".repeat(70)}\n`);

    const streamResult = await app.stream({
      messages: [new HumanMessage(tc.input)],
      language: "中文",
    });

    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      executedNodes.push(nodeName);
      console.log(`  [stream 事件] 节点 "${nodeName}" 执行完毕`);
    }

    console.log(`\n  执行路径：${executedNodes.join(" → ")}`);
    console.log(`  ✓ 路由到 "${executedNodes[1]}" 处理器`);
  }

  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示2：fallback 兜底路由
 *
 * 发送一条无法明确分类的消息，观察它被路由到 fallback 处理器
 */
async function demoFallback() {
  console.log("═".repeat(70));
  console.log("  演示2：fallback 兜底路由");
  console.log("═".repeat(70));

  const weirdInput = "请帮我写一首关于量子力学的诗，用十四行诗的格式";
  console.log(`\n  用户输入："${weirdInput}"`);
  console.log(`  期望路由：classify → fallback → END\n`);

  const streamResult = await app.stream({
    messages: [new HumanMessage(weirdInput)],
    language: "中文",
  });

  const executedNodes: string[] = [];
  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    executedNodes.push(nodeName);
    console.log(`  [stream 事件] 节点 "${nodeName}" 执行完毕`);
  }

  console.log(`\n  执行路径：${executedNodes.join(" → ")}`);
  console.log(`  ✓ 无法明确分类的消息被路由到 fallback 处理器`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * 演示3：交互式聊天
 *
 * 用户可以输入任何消息，图会自动分类并路由到合适的处理器
 */
async function interactiveChat() {
  console.log("═".repeat(70));
  console.log("  交互式聊天（条件边动态路由）");
  console.log("  试试问天气、做数学题、或者打招呼");
  console.log("  输入 quit/退出 结束");
  console.log("═".repeat(70));
  console.log();

  const rl = readline.createInterface({ input, output });

  // 手动维护对话历史
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

    // 调用图：传入完整对话历史 + 新消息
    const result = await app.invoke({
      messages: [...conversationHistory, userMessage],
      language: "中文",
    });

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
  console.log("║" + "  LangGraph.js 项目2：条件边与动态路由".padEnd(54) + "║");
  console.log("║" + "".padEnd(68) + "║");
  console.log("║" + "  核心概念：ConditionalEdge · 路由函数 · addConditionalEdges".padEnd(62) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\n");

  // 演示1：不同意图的路由
  // await demoRouting();

  // // 演示2：fallback 兜底路由
  // await demoFallback();

  // // 演示3：交互式聊天
  await interactiveChat();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
