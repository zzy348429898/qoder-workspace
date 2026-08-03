/**
 * ============================================================================
 *  LangGraph.js 项目8：并行执行与 Map-Reduce
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. 并行边          — 一个节点连出多条边，下游节点并行执行
 *    2. 聚合 Reducer     — 并行分支写同一字段时，用 Reducer 合并结果
 *    3. 隐式同步点       — 所有并行分支完成后，才进入下游汇聚节点
 *    4. Send             — 条件边返回 Send 列表，按输入动态扇出并行任务
 *    5. Map-Reduce 模式  — 扇出并行处理（Map）→ 聚合结果（Reduce）
 *
 *  两种并行方式对比：
 *    静态并行：编译时确定分支数量（addEdge 写死 worker_1/2/3）
 *    动态并行：运行时根据输入决定分支数量（Send 按文章列表扇出）
 *
 *  ★ 为什么并行写同一字段需要 Reducer？
 *    3 个 worker 同时返回 { summaries: [...] }，如果没有 Reducer，
 *    LangGraph 不知道保留哪个 —— 拼接 Reducer 让所有结果都被收集。
 *
 *  图结构（动态 Map-Reduce）：
 *
 *                   ┌→ "summarize"(文章1) ─┐
 *     START ──→ "prepare" ──┼→ "summarize"(文章2) ──┼──→ "aggregate" ──→ END
 *                   └→ "summarize"(文章3) ─┘   (Send 动态扇出)
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:08         （需要 API Key）
 *    4. pnpm verify:08        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, Annotation, Send } from "@langchain/langgraph";
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

// ============================================================================
// 第一部分：静态并行 —— addEdge 固定扇出 3 个 worker
// ============================================================================
//
//  State 设计：
//    - summaries：拼接 Reducer（所有 worker 的结果按顺序拼接收集）
//    - aggregated：最终聚合文本（覆盖 Reducer）
//
// ============================================================================

const StaticAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  summaries: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),  // ★ 拼接聚合
    default: () => [],
  }),
  aggregated: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
});

/** 三个静态 worker：分别从三个角度分析同一主题 */
function makeWorker(aspect: string) {
  return async (state: typeof StaticAnnotation.State) => {
    console.log(`  [静态并行] worker(${aspect}) 开始`);
    const r = await model.invoke([
      new SystemMessage(`你是${aspect}分析师，用 2 句话从${aspect}角度分析主题（中文）。`),
      new HumanMessage(state.topic),
    ]);
    console.log(`  [静态并行] worker(${aspect}) 完成`);
    return { summaries: [`【${aspect}】${r.content as string}`] };
  };
}

async function aggregateNode(state: typeof StaticAnnotation.State) {
  console.log(`  [汇聚] aggregate：收到 ${state.summaries.length} 份分析`);
  return { aggregated: state.summaries.join("\n\n") };
}

const staticApp = new StateGraph(StaticAnnotation)
  .addNode("worker_tech", makeWorker("技术"))
  .addNode("worker_business", makeWorker("商业"))
  .addNode("worker_risk", makeWorker("风险"))
  .addNode("aggregate", aggregateNode)
  // ★ 静态并行：START 同时连向 3 个 worker
  .addEdge(START, "worker_tech")
  .addEdge(START, "worker_business")
  .addEdge(START, "worker_risk")
  // ★ 3 个 worker 都汇聚到 aggregate（隐式同步点：全部完成才执行）
  .addEdge("worker_tech", "aggregate")
  .addEdge("worker_business", "aggregate")
  .addEdge("worker_risk", "aggregate")
  .addEdge("aggregate", END)
  .compile();

// ============================================================================
// 第二部分：动态并行（Send + Map-Reduce）—— 按文章列表动态扇出
// ============================================================================
//
//  ★ Send 的用法（核心概念）：
//    条件边不返回节点名，而是返回 Send 对象数组：
//      (state) => state.articles.map(a => new Send("summarize", { article: a }))
//    每个 Send 都会创建一次 summarize 节点的独立执行，
//    其 state 就是 Send 的第二个参数（可以是完整 State 的子集形状）。
//
// ============================================================================

interface Article {
  title: string;
  content: string;
}

const MapReduceAnnotation = Annotation.Root({
  articles: Annotation<Article[]>({ reducer: (_, u) => u, default: () => [] }),
  summaries: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  finalReport: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
});

/** summarize worker 的输入 State（Send 传入的形状） */
interface SummarizeInputState {
  article: Article;
}

async function prepareNode(state: typeof MapReduceAnnotation.State) {
  console.log(`  [Map] prepare：收到 ${state.articles.length} 篇文章，准备扇出`);
  return {};
}

/** ★ 动态扇出：每篇文章生成一个 Send("summarize", { article }) */
function fanoutToSummarize(state: typeof MapReduceAnnotation.State): Send[] {
  return state.articles.map((article) => new Send("summarize", { article }));
}

async function summarizeNode(state: SummarizeInputState) {
  console.log(`  [Map] summarize：《${state.article.title}》`);
  const r = await model.invoke([
    new SystemMessage("你是编辑，用 1-2 句话总结文章要点（中文）。缩写输出，只给总结。"),
    new HumanMessage(`标题：${state.article.title}\n\n正文：${state.article.content}`),
  ]);
  return { summaries: [`《${state.article.title}》${r.content as string}`] };
}

async function reduceNode(state: typeof MapReduceAnnotation.State) {
  console.log(`  [Reduce] aggregate：聚合 ${state.summaries.length} 份摘要`);
  const r = await model.invoke([
    new SystemMessage("你是主编，把多份文章摘要综合成一段 100 字以内的综合报道（中文）。"),
    new HumanMessage(state.summaries.join("\n")),
  ]);
  return { finalReport: r.content as string };
}

const mapReduceApp = new StateGraph(MapReduceAnnotation)
  .addNode("prepare", prepareNode)
  .addNode("summarize", summarizeNode)
  .addNode("aggregate", reduceNode)
  .addEdge(START, "prepare")
  // ★ 条件边返回 Send[]：动态并行
  .addConditionalEdges("prepare", fanoutToSummarize, ["summarize"])
  .addEdge("summarize", "aggregate")
  .addEdge("aggregate", END)
  .compile();

// ============================================================================
// 演示数据：LangGraph 学习主题短文
// ============================================================================

const demoArticles: Article[] = [
  { title: "State 与 Reducer", content: "LangGraph 的 State 是全局状态容器，Reducer 定义字段合并策略，节点返回部分更新由 Reducer 合并进 State。" },
  { title: "条件边与路由", content: "条件边让图根据当前 State 动态选择下一个节点，路由函数返回节点名或 Send 列表实现分支与扇出。" },
  { title: "Checkpoint 持久化", content: "checkpointer 在每个节点后保存状态快照，配合 thread_id 实现会话记忆、人机交互中断与时间旅行。" },
  { title: "ReAct 智能体", content: "ReAct 模式让 LLM 交替推理与调用工具，agent 与 tools 节点循环直到 LLM 给出最终回答。" },
];

// ============================================================================
// 可视化 + 演示
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化（动态 Map-Reduce 图）");
  console.log("═".repeat(70));

  const mermaidStr = mapReduceApp.getGraph().drawMermaid();
  console.log("\n📐 Mermaid 图表：\n");
  console.log(mermaidStr);
  console.log();

  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`📄 Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await mapReduceApp.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`🖼️  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`⚠️  PNG 生成失败（需要网络连接），不影响后续功能。`);
  }
  console.log();
}

/** 演示1：静态并行（3 个固定 worker） */
async function demoStaticParallel() {
  console.log("═".repeat(70));
  console.log("  演示1：静态并行（技术/商业/风险 三视角并行分析）");
  console.log("═".repeat(70));

  const topic = "LangGraph 在企业知识库中的应用";
  console.log(`\n👤 主题：${topic}\n`);

  const start = Date.now();
  const result = await staticApp.invoke({ topic });
  const elapsed = Date.now() - start;

  console.log(`\n  聚合结果（${result.summaries.length} 份，耗时 ${elapsed}ms）：\n`);
  console.log(result.aggregated.split("\n").map((l: string) => `  ${l}`).join("\n"));
  console.log(`\n  ★ 3 个 worker 并行执行，总耗时 ≈ 最慢的一个（而非三者相加）`);
  console.log(`\n${"═".repeat(70)}\n`);
}

/** 演示2：动态 Map-Reduce（Send 按文章数扇出） */
async function demoDynamicMapReduce() {
  console.log("═".repeat(70));
  console.log("  演示2：动态 Map-Reduce（Send 扇出并行总结 → 聚合报道）");
  console.log("═".repeat(70));

  console.log(`\n👤 输入：${demoArticles.length} 篇 LangGraph 学习短文\n`);

  const streamResult = await mapReduceApp.stream({ articles: demoArticles });
  for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    const summary = chunk[nodeName].summaries?.[0];
    console.log(`  [stream] 节点 "${nodeName}"${summary ? ` → ${summary.slice(0, 50)}...` : ""}`);
  }

  const result = await mapReduceApp.invoke({ articles: demoArticles });
  console.log(`\n  ── 综合报道（Reduce 结果）──\n`);
  console.log(`  ${result.finalReport}\n`);
  console.log(`  ★ Send 按输入动态创建 ${demoArticles.length} 个并行 summarize 任务`);
  console.log(`\n${"═".repeat(70)}\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:08 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目8：并行执行与 Map-Reduce".padEnd(50) + "║");
  console.log("║" + "  核心概念：并行边 · Send · 动态扇出 · 结果聚合".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoStaticParallel();
  await demoDynamicMapReduce();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
