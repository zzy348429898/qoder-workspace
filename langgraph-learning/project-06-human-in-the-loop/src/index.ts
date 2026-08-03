/**
 * ============================================================================
 *  LangGraph.js 项目6：人机交互（Human-in-the-Loop）
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. interrupt()      — 在节点内暂停图执行，等待人工介入
 *    2. Command          — 用 Command({ resume }) 携带人工决策恢复执行
 *    3. 人审审批          — 工具执行前暂停，人工批准后才开始
 *    4. tasks[].interrupts — 通过 getState() 读取中断时保存的审批信息
 *    5. getState().next  — 查看中断后待恢复的节点位置
 *
 *  为什么需要 Human-in-the-Loop？
 *    项目4的 ReAct Agent 可以自主调用工具，但某些工具是"危险操作"
 *    （删文件、发邮件、转账），必须让人类在执行前审批。
 *    interrupt 让图在关键节点"冻结"，把控制权交还给人类。
 *
 *  ★ 关键机制（与项目5的关系）：
 *    interrupt 能把"执行到一半"的现场完整保存下来，依赖的正是
 *    项目5的 checkpointer —— 没有 checkpointer 就无法恢复执行。
 *
 *  ★ interrupt 的重放语义（重要！）：
 *    恢复执行时，包含 interrupt 的节点会【从头重新执行】，
 *    但 interrupt() 调用点直接返回 resume 值（之前的 interrupt 调用
 *    不会再次中断）。因此 interrupt 之前的代码必须是幂等的
 *    （不要在 interrupt 前做写数据库等副作用操作）。
 *
 *  图结构：
 *
 *     START ──→ "agent" ──→ (有 tool_calls?) ──是──→ "review"（interrupt 审批）
 *                          │                            ├→ 批准 ──→ "tools" ──→ "agent" (循环)
 *                          │                            └→ 拒绝 ──→ END
 *                          └──否──→ END
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:06         （需要 API Key）
 *    4. pnpm verify:06        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import {
  StateGraph, START, END, Annotation, MessagesAnnotation,
  MemorySaver, interrupt, Command,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
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
// 1. 工具定义（calculator + get_weather，复用项目3的模式）
// ============================================================================

const calculatorTool = tool(
  async ({ expression }) => {
    console.log(`  🔧 [工具执行] calculator("${expression}")`);
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch {
      return `计算失败：无法解析表达式 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算，例如 '15 * 37'。",
    schema: z.object({
      expression: z.string().describe("要计算的数学表达式"),
    }),
  }
);

const getWeatherTool = tool(
  async ({ city }) => {
    console.log(`  🔧 [工具执行] getWeather("${city}")`);
    const mockData: Record<string, string> = {
      北京: "晴天，28°C", 上海: "多云，30°C", 广州: "雷阵雨，32°C",
    };
    for (const [key, info] of Object.entries(mockData)) {
      if (city.includes(key) || key.includes(city)) return `${key}今日天气：${info}`;
    }
    return `暂无 "${city}" 的天气数据。`;
  },
  {
    name: "get_weather",
    description: "查询城市天气，支持：北京、上海、广州。",
    schema: z.object({
      city: z.string().describe("城市名称"),
    }),
  }
);

const allTools = [calculatorTool, getWeatherTool];

// ============================================================================
// 2. 自定义 State —— messages + 审批决策
// ============================================================================
//
//  approvalDecision 记录人工审批结果：
//    - null      → 尚未审批
//    - "approve" → 批准执行工具
//    - "reject"  → 拒绝执行工具
//
// ============================================================================

const HitlAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  approvalDecision: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

// ============================================================================
// 3. LLM + agent 节点（与项目3/4 相同的模式）
// ============================================================================

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  topP: 1,
});

const SYSTEM_PROMPT = `你是一个有用的助手，可以使用 calculator 和 get_weather 两个工具。
获得工具结果后用中文给出最终回答。`;

async function agentNode(state: typeof HitlAnnotation.State) {
  const response = await model.bindTools(allTools).invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);
  return { messages: [response] };
}

// ============================================================================
// 4.【核心概念】review 节点 —— interrupt 人工审批点
// ============================================================================
//
//  interrupt(value) 的效果：
//    1. 首次执行到这里：抛出特殊的 GraphInterrupt，图"冻结"在当前位置，
//       value 被记录（可通过 getState().tasks[].interrupts[].value 读取），
//       invoke 的返回结果中包含 __interrupt__ 字段。
//    2. 用 Command({ resume: v }) 恢复：节点从头重新执行，
//       但本次 interrupt() 调用直接返回 v（不再中断）。
//
// ============================================================================

async function reviewNode(state: typeof HitlAnnotation.State) {
  const lastMessage = state.messages.at(-1) as AIMessage;

  // ★ interrupt 之前的代码在恢复时会重放（必须保持幂等，只做读取）
  const pendingCalls = (lastMessage.tool_calls ?? []).map((tc) => ({
    name: tc.name,
    args: tc.args,
  }));

  // 冻结图，把待审批信息暴露给人类；恢复时 resume 值成为 decision
  const decision = interrupt({
    message: "LLM 请求调用以下工具，请审批（approve / reject）：",
    toolCalls: pendingCalls,
  }) as string;

  return { approvalDecision: decision };
}

// ============================================================================
// 5. 路由函数
// ============================================================================

/** agent 之后：有工具调用 → review 审批；无 → END */
function routeAfterAgent(state: typeof HitlAnnotation.State): "review" | typeof END {
  const lastMessage = state.messages.at(-1) as AIMessage;
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "review";
  }
  return END;
}

/** review 之后：批准 → tools；拒绝 → END */
function routeAfterReview(state: typeof HitlAnnotation.State): "tools" | typeof END {
  return state.approvalDecision === "approve" ? "tools" : END;
}

// ============================================================================
// 6. 组装图（必须配 checkpointer，否则 interrupt 无法保存现场）
// ============================================================================

const checkpointer = new MemorySaver();

const app = new StateGraph(HitlAnnotation)
  .addNode("agent", agentNode)
  .addNode("review", reviewNode)
  .addNode("tools", new ToolNode(allTools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addConditionalEdges("review", routeAfterReview)
  .addEdge("tools", "agent")
  .compile({ checkpointer });

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

// ============================================================================
// 7. 图结构可视化
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化");
  console.log("═".repeat(70));

  const mermaidStr = app.getGraph().drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await app.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

// ============================================================================
// 8. 演示：完整的"中断 → 人工审批 → 恢复"流程
// ============================================================================

/**
 * 演示一次工具调用审批流程
 *
 * @param decision 模拟人工决策："approve" 或 "reject"
 */
async function demoApprovalFlow(userInput: string, decision: "approve" | "reject") {
  console.log("═".repeat(70));
  console.log(`  演示：用户提问 → 中断审批 → 人工${decision === "approve" ? "批准" : "拒绝"} → 恢复执行`);
  console.log("═".repeat(70));

  const threadId = `demo-${decision}-${Date.now()}`;
  const cfg = threadConfig(threadId);

  console.log(`\n👤 用户：${userInput}\n`);

  // 第一步：invoke 启动图 —— 将在 review 节点的 interrupt 处冻结
  const result = await app.invoke({ messages: [new HumanMessage(userInput)] }, cfg);

  // ★ 通过 getState() 读取中断现场：tasks[].interrupts 保存了 interrupt(value) 的 value
  const state = await app.getState(cfg);
  const interrupts = state.tasks.flatMap((t) => t.interrupts ?? []);

  if (interrupts.length === 0) {
    console.log("  （本次调用未触发审批：LLM 没有请求工具调用，直接回答了）");
    const lastMsg = result.messages.at(-1) as AIMessage;
    console.log(`🤖 AI: ${lastMsg.content}\n`);
    return;
  }

  // 展示待审批信息
  const pending = interrupts[0].value as {
    message: string;
    toolCalls: Array<{ name: string; args: unknown }>;
  };
  console.log(`  ⏸️  图已冻结，等待人工审批：`);
  console.log(`     ${pending.message}`);
  for (const tc of pending.toolCalls) {
    console.log(`     → ${tc.name}(${JSON.stringify(tc.args)})`);
  }
  console.log(`     getState().next = ${JSON.stringify(state.next)}（恢复时将重新执行该节点）\n`);

  // 第二步：人工决策 → Command 恢复执行
  console.log(`🧑‍⚖️ 人工决策：${decision === "approve" ? "批准执行" : "拒绝执行"}\n`);
  const resumed = await app.invoke(new Command({ resume: decision }), cfg);

  // 展示恢复后的执行结果
  const toolMsg = resumed.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage | undefined;
  if (toolMsg) {
    console.log(`  👁️  Observation [${toolMsg.name}]: "${(toolMsg.content as string).slice(0, 80)}"`);
  } else if (decision === "reject") {
    console.log(`  🚫 工具未被执行（审批拒绝），流程直接结束`);
  }

  const lastMsg = resumed.messages.at(-1) as AIMessage;
  if (lastMsg.content) {
    console.log(`🤖 AI: ${(lastMsg.content as string).slice(0, 200)}\n`);
  }
  console.log(`${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:06 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目6：人机交互（Human-in-the-Loop）".padEnd(50) + "║");
  console.log("║" + "  核心概念：interrupt · Command · 人审审批 · 恢复执行".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();

  // 演示1：批准路径 —— 工具被执行，LLM 基于结果回答
  await demoApprovalFlow("请帮我计算 15 * 37 等于多少？", "approve");

  // 演示2：拒绝路径 —— 工具不执行，流程结束
  await demoApprovalFlow("北京今天天气怎么样？", "reject");
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
