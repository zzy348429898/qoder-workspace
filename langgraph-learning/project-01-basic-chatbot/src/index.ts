/**
 * ============================================================================
 *  LangGraph.js 项目1：基础聊天机器人
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. State       — 图的全局状态（数据容器），在节点间流转
 *    2. Annotation  — 定义 State 的结构和每个字段的合并策略（Reducer）
 *    3. Node        — 图中的处理单元（一个函数：接收 state → 返回更新）
 *    4. Edge        — 节点间的连接（声明式路由）
 *    5. StateGraph  — 把 Node 和 Edge 组装成图
 *    6. compile     — 编译图为可执行应用
 *    7. invoke      — 单次调用
 *    8. stream      — 流式调用（逐步获取结果）
 *
 *  图结构示意：
 *
 *     START ──▶ "chatbot" ──▶ END
 *
 *  虽然只有一个节点，但这是理解 LangGraph 一切的基础。
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. npm install
 *    3. npm start
 * ============================================================================
 */

// ============================================================================
// 0. 导入依赖
// ============================================================================

// LangGraph 核心：StateGraph（图构建器）、Annotation（状态注解）、START/END（特殊节点）
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
// LangChain 消息类型：用于构造对话消息
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
// Anthropic 聊天模型
import { ChatAnthropic } from "@langchain/anthropic";
// Node.js 内置 readline：用于交互式终端输入
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
// 概念1：State —— 图的全局状态
// ============================================================================
//
//  State 是 LangGraph 的核心数据结构，它在节点之间流转。
//  你可以把它想象成一个大号的"共享变量"，每个 Node 都能读取和更新它。
//
//  在 LangGraph.js 中，State 通过 Annotation 定义：
//    - 每个"字段"有自己的类型和合并策略（Reducer）
//    - Reducer 决定当多个 Node 返回同一个字段时如何合并
//
//  对比传统写法：
//    传统：你需要手动传递变量，手动处理状态合并
//    LangGraph：State + Reducer 自动处理这一切
//
// ============================================================================

/**
 * ★ 概念2：Reducer —— 状态合并策略
 *
 * Reducer 是一个函数：(当前值, 更新值) => 新值
 *
 * 对于消息列表，我们用 concat（拼接）策略：
 *   当前有 [msg1, msg2]，Node 返回 [msg3]
 *   Reducer 结果：[msg1, msg2, msg3]
 *
 * 对于简单字段（如语言偏好），我们用"覆盖"策略：
 *   (_, newValue) => newValue  —— 直接用新值替换旧值
 */
const StateAnnotation = Annotation.Root({
  /**
   * messages：对话消息列表
   * - 类型：BaseMessage[]
   * - Reducer：拼接策略，Node 返回的新消息会追加到列表末尾
   * - default：初始值为空数组
   */
  messages: Annotation<BaseMessage[]>({
    reducer: (currentState, update) => currentState.concat(update),
    default: () => [],
  }),

  /**
   * language：对话语言偏好
   * - 类型：string
   * - Reducer：覆盖策略，直接替换
   * - default：初始值为 "中文"
   */
  language: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => "中文",
  }),
});

// 从 Annotation 中提取类型，供 Node 函数使用
type GraphState = typeof StateAnnotation.State;

// ============================================================================
// LLM 实例初始化
// ============================================================================
//
//  ChatAnthropic 是 LangChain 对 Anthropic Claude API 的封装。
//  它实现了 Runnable 接口，可以用 .invoke() / .stream() 调用。
//  在实际项目中，你可以将它作为依赖注入到 Node 中。
//
// ============================================================================
// 所有配置从 .env 文件读取，显式传给 ChatAnthropic
const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  // 显式设置 topP 为合法值（默认 -1 会被某些 API 代理拒绝）
  topP: 1,
});

// ============================================================================
// 概念3：Node —— 图中的处理单元
// ============================================================================
//
//  Node 就是一个普通函数：
//    输入：当前的 State（只读访问）
//    输出：State 的部分更新（Partial<State>）
//
//  关键理解：
//    - Node 不需要返回完整的 State，只需返回"变更的部分"
//    - 返回值会通过 Reducer 合并到当前 State 中
//    - 这让 Node 之间解耦：每个 Node 只关心自己负责的字段
//
//  类比：
//    传统函数：f(x) → y（输入输出显式传递）
//    LangGraph Node：f(state) → partial_state（状态自动合并）
//
// ============================================================================

/**
 * chatbot 节点：调用 LLM 生成回复
 *
 * @param state - 当前图状态（包含 messages 和 language）
 * @returns - 部分状态更新（返回新的 AI 消息，会通过 reducer 拼接到 messages）
 */
async function chatbotNode(state: GraphState): Promise<Partial<GraphState>> {
  // 1. 创建系统提示，根据 language 字段来设定回复语言
  const systemPrompt = `你是一个友好的助手。请用${state.language}回答用户的问题。
保持回答简洁、有帮助。`;

  // 2. 调用 LLM
  // model 在全局已初始化，state.messages 包含完整对话历史
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages,
  ]);

  // 3. 返回部分状态更新
  // 注意：这里只返回 messages 字段，language 字段不会被修改
  // 返回值会经过 reducer：currentState.messages.concat([response])
  console.log(`\n🤖 AI: ${response.content}`);
  console.log(); // 空行分隔

  return { messages: [response] };
}

// ============================================================================
// 概念4：StateGraph + Edge —— 组装图
// ============================================================================
//
//  StateGraph 是图的构建器，你通过链式调用组装图：
//
//    1. new StateGraph(StateAnnotation)
//       → 创建一个使用指定 State 结构的图
//
//    2. .addNode("name", fn)
//       → 注册一个 Node，给它取个名字
//
//    3. .addEdge("from", "to")
//       → 添加一条边，定义执行顺序
//       → START 和 END 是特殊的内置节点
//       → START 是图的入口，END 是图的出口
//
//  图的本质：
//    START → chatbot → END
//    用户输入 → LLM处理 → 返回结果
//
//  vs 条件边（后续项目会学）：
//    普通边：A 一定走向 B（静态路由）
//    条件边：A 走向 B 还是 C？取决于 State（动态路由）
//
// ============================================================================

const workflow = new StateGraph(StateAnnotation)
  // 注册 chatbot 节点
  .addNode("chatbot", chatbotNode)
  // 添加边：START → chatbot（图的入口指向 chatbot 节点）
  .addEdge(START, "chatbot")
  // 添加边：chatbot → END（chatbot 执行完毕后结束）
  .addEdge("chatbot", END);

// ============================================================================
// 概念5：compile —— 编译图为可执行应用
// ============================================================================
//
//  compile() 做了什么：
//    - 验证图结构是否合法（如：所有节点是否可达、是否有环等）
//    - 生成执行计划
//    - 返回一个可执行的 CompiledGraph 对象
//
//  编译后的图支持：
//    - invoke(input)：同步执行，返回最终结果
//    - stream(input)：流式执行，逐步返回中间结果
//    - getState()：获取当前状态
//    - 以及更多（后续项目会探索）
//
// ============================================================================

const app = workflow.compile();

// ============================================================================
// 概念6：invoke —— 单次调用
// ============================================================================
//
//  invoke() 是最简单的调用方式：
//    输入：初始 State（或部分 State）
//    输出：最终 State
//
//  它会按照图的定义，从 START 开始执行，直到到达 END。
//
// ============================================================================

/**
 * 演示：单次调用
 */
async function demoSingleInvoke() {
  console.log("═".repeat(70));
  console.log("  演示1：单次调用 (invoke)");
  console.log("═".repeat(70));

  const result = await app.invoke({
    messages: [new HumanMessage("你好！请用一句话解释什么是 LangGraph。")],
    language: "中文",
  });

  // result 是执行完毕后的完整 State
  // result.messages 包含了 HumanMessage + AIMessage（因为 reducer 是拼接策略）
  console.log(`\n📋 最终状态中的消息数量：${result.messages.length}`);
  console.log(`   - 消息1：${result.messages[0]._getType()} → "${(result.messages[0].content as string).slice(0, 50)}..."`);
  console.log(`   - 消息2：${result.messages[1]._getType()} → "${(result.messages[1].content as string).slice(0, 50)}..."`);
  console.log();
}

// ============================================================================
// 概念7：stream —— 流式调用
// ============================================================================
//
//  stream() 让你能逐步获取执行过程中的中间结果：
//    - 每个 Node 执行完毕后，都会 yield 一个更新
//    - 格式：{ "nodeName": partialState }
//
//  对比 invoke：
//    invoke：等全部执行完，一次性返回
//    stream：每个节点执行完就返回，可以实时展示进度
//
//  这在多节点图中特别有用（后续项目会看到）
//
// ============================================================================

/**
 * 演示：流式调用
 */
async function demoStream() {
  console.log("═".repeat(70));
  console.log("  演示2：流式调用 (stream)");
  console.log("═".repeat(70));

  console.log("\n用户：请告诉我 TypeScript 和 JavaScript 的区别。\n");

  const streamResult = await app.stream({
    messages: [new HumanMessage("请告诉我 TypeScript 和 JavaScript 的区别。")],
    language: "中文",
  });

  // stream 返回一个 async generator，逐个 yield 每个节点的输出
  for await (const chunk of streamResult) {
    // chunk 的格式：{ "chatbot": { messages: [...] } }
    // key 是节点名，value 是该节点的状态更新
    const nodeName = Object.keys(chunk)[0];
    console.log(`  [stream 事件] 节点 "${nodeName}" 执行完毕`);
  }
  console.log();
}

// ============================================================================
// 概念8：带记忆的交互式聊天循环
// ============================================================================
//
//  在实际应用中，我们需要多轮对话。
//  由于 State 的 messages 字段使用了拼接 reducer，
//  我们只需要把完整的历史消息传给下一轮即可。
//
//  这是理解 LangGraph 状态管理的核心：
//    - 每次调用图，State 都是"从头开始"的（除非用 Checkpoint，后续项目会学）
//    - 但我们可以手动维护 messages 列表，实现"对话记忆"
//
// ============================================================================

async function interactiveChat() {
  console.log("═".repeat(70));
  console.log("  交互式聊天（输入 quit/退出 结束）");
  console.log("═".repeat(70));
  console.log();

  const rl = readline.createInterface({ input, output });

  // 手动维护对话历史（模拟"记忆"）
  // 注意：这是简化版，项目4会展示 LangGraph 的 Checkpoint 持久化记忆
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

    // 创建用户消息
    const userMessage = new HumanMessage(userInput);

    // 调用图：传入完整对话历史 + 新消息
    // 图会执行 START → chatbot → END
    const result = await app.invoke({
      messages: [...conversationHistory, userMessage],
      language: "中文",
    });

    // 更新对话历史（用户消息 + AI 回复）
    // result.messages 包含了完整的消息列表（历史 + 新消息）
    conversationHistory.length = 0;
    conversationHistory.push(...result.messages);
  }

  rl.close();
}

// ============================================================================
// 主函数：按顺序执行演示
// ============================================================================

async function main() {
  // 检查 API Key（.env 已在文件顶部加载）
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   获取 Key: https://console.anthropic.com/settings/keys");
    process.exit(1);
  }

  console.log("\n");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目1：基础聊天机器人".padEnd(56) + "║");
  console.log("║" + "".padEnd(68) + "║");
  console.log("║" + "  核心概念：State · Reducer · Node · Edge · compile · invoke".padEnd(68) + "║");
  console.log("╚" + "═".repeat(68) + "╝");
  console.log("\n");

  // 演示1：单次调用
  // await demoSingleInvoke();

  // 演示2：流式调用
  // await demoStream();

  // 演示3：交互式聊天
  await interactiveChat();
}

// 运行
main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
