/**
 * ============================================================================
 *  LangGraph.js 项目9：复杂路由与状态机
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. 多条件路由     — 路由函数组合多个条件（评分 + 轮数上限）决定去向
 *    2. 循环图         — 节点可以回到上游节点（evaluate ⇄ improve 循环）
 *    3. 循环安全       — 循环必须有明确的退出条件 + 轮数上限（复用项目4模式）
 *    4. 状态机模式     — State 中显式维护 status 字段，由各节点推进、路由分发
 *
 *  两个图示例：
 *    图1 迭代优化：generate → evaluate → (达标?) → improve → evaluate → ...
 *    图2 客服状态机：waiting → processing → (需人工?) → human → processing → resolved
 *
 *  ★ 状态机模式 vs 普通条件路由：
 *    普通路由：路由函数临时计算条件（如"有没有 tool_calls"）
 *    状态机：State 中有专门的 status 字段表示"当前处于哪个阶段"，
 *            节点只负责推进 status，路由函数只是 status 的"分发器"——
 *            业务状态一目了然，适合多阶段业务流程。
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:09         （需要 API Key）
 *    4. pnpm verify:09        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
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

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  topP: 1,
});

async function askLLM(system: string, user: string): Promise<string> {
  const r = await model.invoke([new SystemMessage(system), new HumanMessage(user)]);
  return r.content as string;
}

// ============================================================================
// 图1：迭代优化循环 —— 生成 → 评估 → 改进 → 再评估 → ... 直到达标
// ============================================================================
//
//  ★ 多条件路由（核心教学点）：
//    evaluate 之后的路由同时考虑两个条件：
//      ① score >= SCORE_THRESHOLD（质量达标 → 正常结束）
//      ② iteration >= MAX_ITERATIONS（轮数上限 → 强制结束，防无限循环）
//    只有两个条件都不满足时才进入 improve 继续迭代。
//
// ============================================================================

const IterationAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  draft: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  feedback: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  score: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
  iteration: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

const SCORE_THRESHOLD = 8;
const MAX_ITERATIONS = 3;

async function generateNode(state: typeof IterationAnnotation.State) {
  console.log(`  [迭代优化] generate：生成《${state.topic}》初稿`);
  const draft = await askLLM(
    "你是作者，就给定主题写一段 80 字以内的中文短文。",
    `主题：${state.topic}`,
  );
  return { draft, iteration: 1 };
}

async function evaluateNode(state: typeof IterationAnnotation.State) {
  console.log(`  [迭代优化] evaluate：评估第 ${state.iteration} 轮稿件`);
  const feedback = await askLLM(
    `你是严格的编辑，给稿件打分（1-10 的整数）并给出一句改进建议。
输出格式严格为：分数|建议
例如：6|论点需要更具体`,
    `主题：${state.topic}\n\n稿件：${state.draft}`,
  );
  // 解析"分数|建议"格式
  const [scoreText, ...rest] = feedback.split("|");
  const score = parseInt(scoreText.trim(), 10);
  console.log(`  [迭代优化] 评分：${score}/10，建议：${rest.join("|").slice(0, 40)}`);
  return { score: Number.isNaN(score) ? 5 : score, feedback };
}

/** ★ 多条件路由：达标 或 达上限 → END；否则 → improve 继续循环 */
function routeAfterEvaluate(state: typeof IterationAnnotation.State): "improve" | typeof END {
  if (state.score >= SCORE_THRESHOLD) {
    console.log(`  [路由] 评分 ${state.score} ≥ ${SCORE_THRESHOLD}，达标结束`);
    return END;
  }
  if (state.iteration >= MAX_ITERATIONS) {
    console.log(`  [路由] 已达最大迭代次数 ${MAX_ITERATIONS}，强制结束（当前评分 ${state.score}）`);
    return END;
  }
  console.log(`  [路由] 评分不足且未达上限，进入 improve 继续迭代`);
  return "improve";
}

async function improveNode(state: typeof IterationAnnotation.State) {
  console.log(`  [迭代优化] improve：根据反馈改进稿件`);
  const draft = await askLLM(
    "你是作者，根据编辑的改进建议修改稿件，输出修改后的完整稿件（80 字以内）。",
    `主题：${state.topic}\n\n原稿：${state.draft}\n\n改进建议：${state.feedback}`,
  );
  return { draft, iteration: 1 };
}

const iterativeApp = new StateGraph(IterationAnnotation)
  .addNode("generate", generateNode)
  .addNode("evaluate", evaluateNode)
  .addNode("improve", improveNode)
  .addEdge(START, "generate")
  .addEdge("generate", "evaluate")
  .addConditionalEdges("evaluate", routeAfterEvaluate)
  // ★ 循环边：improve 完成后回到 evaluate 重新评估
  .addEdge("improve", "evaluate")
  .compile();

// ============================================================================
// 图2：客服状态机 —— status 字段驱动的有限状态机
// ============================================================================
//
//  ★ 状态机模式（核心教学点）：
//    State 中的 status 字段就是状态机的"当前状态"：
//      waiting → processing → (human ⇄ processing) → resolved
//    每个节点只做两件事：处理业务 + 推进 status；
//    路由函数是纯粹的 status → 节点名 映射表。
//
// ============================================================================

/** 状态机的全部合法状态 */
type ServiceStatus = "waiting" | "processing" | "human" | "resolved";

const ServiceAnnotation = Annotation.Root({
  issue: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  status: Annotation<ServiceStatus>({ reducer: (_, u) => u, default: () => "waiting" as ServiceStatus }),
  solution: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  humanAssisted: Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
});

async function waitingNode(state: typeof ServiceAnnotation.State) {
  console.log(`  [状态机] waiting：接收问题 "${state.issue}"，转入处理`);
  return { status: "processing" as ServiceStatus };
}

async function processingNode(state: typeof ServiceAnnotation.State) {
  // 人工协助过的问题，回来后直接解决
  if (state.humanAssisted) {
    console.log(`  [状态机] processing：人工已协助，直接给出解决方案`);
    return {
      status: "resolved" as ServiceStatus,
      solution: `【人工+AI 联合方案】针对"${state.issue}"：已按人工指导完成处理。`,
    };
  }
  // LLM 判断是否需要转人工
  const decision = await askLLM(
    `你是客服分流器。判断用户问题是否需要转人工。
只回答两个字：人工 或 自助。
涉及退款、投诉、法律、账号安全的问题必须转人工。`,
    state.issue,
  );
  const needHuman = decision.includes("人工") && !decision.includes("自助");
  if (needHuman) {
    console.log(`  [状态机] processing：问题需要人工介入，转 human`);
    return { status: "human" as ServiceStatus };
  }
  console.log(`  [状态机] processing：可自助解决`);
  const solution = await askLLM(
    "你是客服，用 2 句话给出解决方案（中文）。",
    state.issue,
  );
  return { status: "resolved" as ServiceStatus, solution: `【AI 自助方案】${solution}` };
}

async function humanNode(_state: typeof ServiceAnnotation.State) {
  // 真实场景：这里对接人工工作台（或 interrupt 等待人工输入，见项目6）
  console.log(`  [状态机] human：人工客服已介入处理（Mock），返回 processing 复核`);
  return { status: "processing" as ServiceStatus, humanAssisted: true };
}

async function resolvedNode(state: typeof ServiceAnnotation.State) {
  console.log(`  [状态机] resolved：输出解决方案`);
  return {};
}

/** ★ 状态机路由：status → 节点的纯映射 */
function routeByStatus(state: typeof ServiceAnnotation.State): string {
  const table: Record<ServiceStatus, string> = {
    waiting: "waiting",
    processing: "processing",
    human: "human",
    resolved: "resolved",
  };
  return table[state.status];
}

const serviceApp = new StateGraph(ServiceAnnotation)
  .addNode("waiting", waitingNode)
  .addNode("processing", processingNode)
  .addNode("human", humanNode)
  .addNode("resolved", resolvedNode)
  .addEdge(START, "waiting")
  // 每个节点之后都按 status 重新分发（状态机的标准接法）
  .addConditionalEdges("waiting", routeByStatus)
  .addConditionalEdges("processing", routeByStatus)
  .addConditionalEdges("human", routeByStatus)
  .addEdge("resolved", END)
  .compile();

// ============================================================================
// 可视化 + 演示
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化（迭代优化图）");
  console.log("═".repeat(70));

  const mermaidStr = iterativeApp.getGraph().drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await iterativeApp.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

async function demoIterativeOptimization() {
  console.log("═".repeat(70));
  console.log("  演示1：迭代优化循环（生成 → 评估 → 改进，直到评分 ≥ 8）");
  console.log("═".repeat(70));

  const result = await iterativeApp.invoke({ topic: "LangGraph 的核心价值" });

  console.log(`\n  ── 最终结果 ──`);
  console.log(`  迭代轮数：${result.iteration}`);
  console.log(`  最终评分：${result.score}/10`);
  console.log(`  最终稿件：${result.draft.slice(0, 120)}`);
  console.log(`\n${"═".repeat(70)}\n`);
}

async function demoServiceStateMachine() {
  console.log("═".repeat(70));
  console.log("  演示2：客服状态机（status 字段驱动路由）");
  console.log("═".repeat(70));

  const cases = [
    "我想修改账户绑定的邮箱地址",
    "我要投诉并申请退款！",
  ];

  for (const issue of cases) {
    console.log(`\n  ── 案例：${issue} ──`);
    const result = await serviceApp.invoke({ issue });
    console.log(`  最终 status：${result.status}`);
    console.log(`  经过人工：${result.humanAssisted ? "是" : "否"}`);
    console.log(`  解决方案：${result.solution.slice(0, 100)}`);
  }
  console.log(`\n${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:09 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目9：复杂路由与状态机".padEnd(50) + "║");
  console.log("║" + "  核心概念：多条件路由 · 循环图 · 状态机模式".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoIterativeOptimization();
  await demoServiceStateMachine();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
