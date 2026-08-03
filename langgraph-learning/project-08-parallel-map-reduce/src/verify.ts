/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 验证并行执行与 Map-Reduce
 *
 * 运行：pnpm verify:08  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 静态并行：3 个 worker 并行执行并聚合
 *   2. 拼接 Reducer 正确收集所有并行分支结果
 *   3. 隐式同步点：aggregate 在所有 worker 完成后才执行
 *   4. Send 动态扇出：任务数随输入文章数变化
 *   5. Map-Reduce 端到端结果
 */

import { StateGraph, START, END, Annotation, Send } from "@langchain/langgraph";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 静态并行图（Mock 版本，结构与 index.ts 一致）
// ============================================================================

const StaticAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  summaries: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  aggregated: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
});

/** 带 50ms 延迟的 Mock worker（用于观察并行效果） */
function makeMockWorker(aspect: string) {
  return async (state: typeof StaticAnnotation.State) => {
    await new Promise((r) => setTimeout(r, 50));
    return { summaries: [`【${aspect}】关于"${state.topic}"的Mock分析`] };
  };
}

const staticApp = new StateGraph(StaticAnnotation)
  .addNode("worker_tech", makeMockWorker("技术"))
  .addNode("worker_business", makeMockWorker("商业"))
  .addNode("worker_risk", makeMockWorker("风险"))
  .addNode("aggregate", async (state) => ({ aggregated: state.summaries.join("\n") }))
  .addEdge(START, "worker_tech")
  .addEdge(START, "worker_business")
  .addEdge(START, "worker_risk")
  .addEdge("worker_tech", "aggregate")
  .addEdge("worker_business", "aggregate")
  .addEdge("worker_risk", "aggregate")
  .addEdge("aggregate", END)
  .compile();

// ============================================================================
// 2. 动态 Map-Reduce 图（Mock 版本）
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

const mapReduceApp = new StateGraph(MapReduceAnnotation)
  .addNode("prepare", async () => ({}))
  .addNode("summarize", async (state: { article: Article }) => ({
    summaries: [`《${state.article.title}》Mock摘要`],
  }))
  .addNode("aggregate", async (state) => ({
    finalReport: `综合报道：共 ${state.summaries.length} 篇 → ${state.summaries.join(" / ")}`,
  }))
  .addEdge(START, "prepare")
  .addConditionalEdges(
    "prepare",
    (state) => state.articles.map((article) => new Send("summarize", { article })),
    ["summarize"],
  )
  .addEdge("summarize", "aggregate")
  .addEdge("aggregate", END)
  .compile();

// ============================================================================
// 3. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目8 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：并行执行与 Map-Reduce".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化（Map-Reduce 图）");
  const mermaidStr = mapReduceApp.getGraph().drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr.split("\n").map((line) => `  ${line}`).join("\n"));
  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await mapReduceApp.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：静态并行 —— 3 个 worker 结果全部聚合 ----
  {
    total++;
    console.log("▶ 测试0：静态并行（3 个 worker 并行 + 拼接 Reducer 聚合）");

    const result = await staticApp.invoke({ topic: "LangGraph" });

    console.log(`  summaries 数量：${result.summaries.length}（预期 3）`);
    console.log(`  内容：${result.summaries.map((s) => s.slice(0, 8)).join(" / ")}`);
    console.log(`  aggregated 包含全部分析：${result.aggregated.includes("技术") && result.aggregated.includes("商业") && result.aggregated.includes("风险") ? "是" : "否"}`);

    const ok = result.summaries.length === 3
      && ["技术", "商业", "风险"].every((a) => result.aggregated.includes(a));
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：隐式同步点 —— aggregate 最后执行且只执行一次 ----
  {
    total++;
    console.log("▶ 测试1：隐式同步点（aggregate 等待全部 worker 完成）");

    const streamResult = await staticApp.stream({ topic: "同步测试" });
    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      executedNodes.push(Object.keys(chunk)[0]);
    }

    console.log(`  执行顺序：${executedNodes.join(" → ")}`);
    const aggregateCount = executedNodes.filter((n) => n === "aggregate").length;
    const aggregateIsLast = executedNodes.at(-1) === "aggregate";
    const workerCount = executedNodes.filter((n) => n.startsWith("worker_")).length;

    console.log(`  worker 执行数：${workerCount}（预期 3）`);
    console.log(`  aggregate 执行次数：${aggregateCount}（预期 1）且最后执行：${aggregateIsLast ? "是" : "否"}`);

    const ok = workerCount === 3 && aggregateCount === 1 && aggregateIsLast;
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：并行耗时 —— 总耗时接近最慢分支而非分支之和 ----
  {
    total++;
    console.log("▶ 测试2：并行耗时验证（3 × 50ms 延迟 worker）");

    const start = Date.now();
    await staticApp.invoke({ topic: "耗时测试" });
    const elapsed = Date.now() - start;

    // 串行需 ≥150ms，并行应明显小于（考虑调度开销，阈值放宽到 140ms）
    console.log(`  总耗时：${elapsed}ms（并行应 < 140ms，串行需 ≥150ms）`);
    const ok = elapsed < 140;
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：Send 动态扇出 —— 任务数随输入变化 ----
  {
    total++;
    console.log("▶ 测试3：Send 动态扇出（4 篇文章 → 4 个并行任务）");

    const articles = [
      { title: "文章A", content: "内容A" },
      { title: "文章B", content: "内容B" },
      { title: "文章C", content: "内容C" },
      { title: "文章D", content: "内容D" },
    ];

    const streamResult = await mapReduceApp.stream({ articles });
    const executedNodes: string[] = [];
    for await (const chunk of streamResult) {
      executedNodes.push(Object.keys(chunk)[0]);
    }

    const summarizeCount = executedNodes.filter((n) => n === "summarize").length;
    console.log(`  summarize 执行次数：${summarizeCount}（预期 4）`);
    console.log(`  执行轨迹：${executedNodes.join(" → ")}`);

    const ok = summarizeCount === 4 && executedNodes.at(-1) === "aggregate";
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：Send 数量随输入变化（2 篇 → 2 任务）+ 端到端结果 ----
  {
    total++;
    console.log("▶ 测试4：Send 数量随输入变化（2 篇 → 2 任务）+ Map-Reduce 端到端");

    const result = await mapReduceApp.invoke({
      articles: [
        { title: "短文甲", content: "内容甲" },
        { title: "短文乙", content: "内容乙" },
      ],
    });

    console.log(`  summaries 数量：${result.summaries.length}（预期 2）`);
    console.log(`  finalReport：${result.finalReport.slice(0, 60)}...`);

    const ok = result.summaries.length === 2
      && result.finalReport.includes("2 篇")
      && result.finalReport.includes("短文甲")
      && result.finalReport.includes("短文乙");
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  静态并行：多 addEdge 扇出，worker 并行执行");
    console.log("  拼接 Reducer 正确聚合所有分支结果");
    console.log("  隐式同步点：aggregate 等待全部并行分支完成");
    console.log("  Send 动态扇出：任务数随输入动态变化");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:08 体验真实并行总结\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
