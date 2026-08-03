/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 验证复杂路由与状态机
 *
 * 运行：pnpm verify:09  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 迭代优化循环：评分不达标时进入 improve 循环
 *   2. 达标退出：评分 ≥ 阈值时正常结束
 *   3. 上限退出：达到最大迭代次数时强制结束
 *   4. 状态机：自助解决路径
 *   5. 状态机：转人工路径（human ⇄ processing）
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 迭代优化图（Mock：评分按轮次递增，可参数化阈值/上限/评分函数）
// ============================================================================

const IterationAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  draft: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  feedback: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  score: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
  iteration: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

/** 构建迭代优化图（注入不同的评分策略以覆盖达标/上限两条路径） */
function buildIterativeGraph(opts: {
  threshold: number;
  maxIterations: number;
  scoreFn: (iteration: number) => number;
}) {
  return new StateGraph(IterationAnnotation)
    .addNode("generate", async (state) => ({
      draft: `《${state.topic}》第1版稿件`,
      iteration: 1,
    }))
    .addNode("evaluate", async (state) => {
      const score = opts.scoreFn(state.iteration);
      return { score, feedback: `评分${score}|继续改进` };
    })
    .addNode("improve", async (state) => ({
      draft: `${state.draft}（第${state.iteration + 1}次改进）`,
      iteration: 1,
    }))
    .addEdge(START, "generate")
    .addEdge("generate", "evaluate")
    .addConditionalEdges("evaluate", (state) => {
      if (state.score >= opts.threshold) return END;
      if (state.iteration >= opts.maxIterations) return END;
      return "improve";
    })
    .addEdge("improve", "evaluate")
    .compile();
}

// ============================================================================
// 2. 客服状态机（Mock：含"退款/投诉"转人工）
// ============================================================================

type ServiceStatus = "waiting" | "processing" | "human" | "resolved";

const ServiceAnnotation = Annotation.Root({
  issue: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  status: Annotation<ServiceStatus>({ reducer: (_, u) => u, default: () => "waiting" as ServiceStatus }),
  solution: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  humanAssisted: Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
});

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
  .addNode("waiting", async () => ({ status: "processing" as ServiceStatus }))
  .addNode("processing", async (state) => {
    if (state.humanAssisted) {
      return {
        status: "resolved" as ServiceStatus,
        solution: `【人工+AI】已处理："${state.issue}"`,
      };
    }
    if (/(退款|投诉|人工)/.test(state.issue)) {
      return { status: "human" as ServiceStatus };
    }
    return {
      status: "resolved" as ServiceStatus,
      solution: `【AI 自助】已处理："${state.issue}"`,
    };
  })
  .addNode("human", async () => ({
    status: "processing" as ServiceStatus,
    humanAssisted: true,
  }))
  .addNode("resolved", async () => ({}))
  .addEdge(START, "waiting")
  .addConditionalEdges("waiting", routeByStatus)
  .addConditionalEdges("processing", routeByStatus)
  .addConditionalEdges("human", routeByStatus)
  .addEdge("resolved", END)
  .compile();

// ============================================================================
// 3. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目9 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：复杂路由与状态机".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  // 评分按 evaluate 时的 iteration 递增：第1轮 5 → 第2轮 7 → 第3轮 9（阈值 8）
  const iterGraph = buildIterativeGraph({ threshold: 8, maxIterations: 3, scoreFn: (i) => 3 + i * 2 });
  console.log("▶ 图结构可视化（迭代优化图）");
  const mermaidStr = iterGraph.getGraph().drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr.split("\n").map((line) => `  ${line}`).join("\n"));
  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await iterGraph.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：迭代循环直到达标（评分 5 → 7 → 9，第3轮达标）----
  {
    total++;
    console.log("▶ 测试0：迭代循环直到达标（Mock 评分 5→7→9，阈值 8）");

    const streamResult = await iterGraph.stream({ topic: "测试主题" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await iterGraph.invoke({ topic: "测试主题" });

    console.log(`  执行轨迹：${nodes.join(" → ")}`);
    console.log(`  迭代轮数：${result.iteration}（预期 3）`);
    console.log(`  最终评分：${result.score}（预期 9）`);

    const ok = result.iteration === 3
      && result.score === 9
      && nodes.filter((n) => n === "improve").length === 2
      && result.draft.includes("改进");
    console.log(`  ${ok ? "✓" : "✗"} 循环 2 次 improve 后达标退出`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：首轮即达标（评分 9，不进入 improve）----
  {
    total++;
    console.log("▶ 测试1：首轮即达标（Mock 评分恒 9）");

    const passFirst = buildIterativeGraph({ threshold: 8, maxIterations: 3, scoreFn: () => 9 });
    const streamResult = await passFirst.stream({ topic: "简单主题" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    console.log(`  执行轨迹：${nodes.join(" → ")}`);
    const ok = nodes.join(",") === "generate,evaluate" && !nodes.includes("improve");
    console.log(`  ${ok ? "✓" : "✗"} 未进入 improve，直接结束`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：达到最大迭代次数强制退出（评分恒 1，上限 3）----
  {
    total++;
    console.log("▶ 测试2：上限强制退出（Mock 评分恒 1，MAX=3）");

    const neverPass = buildIterativeGraph({ threshold: 8, maxIterations: 3, scoreFn: () => 1 });
    const result = await neverPass.invoke({ topic: "困难主题" });

    console.log(`  迭代轮数：${result.iteration}（预期 3）`);
    console.log(`  最终评分：${result.score}（仍不达标但被强制结束）`);

    const ok = result.iteration === 3 && result.score === 1;
    console.log(`  ${ok ? "✓" : "✗"} 达到上限后循环被强制终止`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：状态机自助解决路径 ----
  {
    total++;
    console.log("▶ 测试3：状态机自助路径（简单问题）");
    console.log("  输入：'如何修改密码？'");

    const streamResult = await serviceApp.stream({ issue: "如何修改密码？" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await serviceApp.invoke({ issue: "如何修改密码？" });

    console.log(`  执行轨迹：${nodes.join(" → ")}`);
    console.log(`  最终 status：${result.status}，经过人工：${result.humanAssisted}`);
    console.log(`  方案：${result.solution}`);

    const ok = result.status === "resolved"
      && !result.humanAssisted
      && result.solution.includes("AI 自助")
      && !nodes.includes("human");
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：状态机转人工路径（human ⇄ processing 循环）----
  {
    total++;
    console.log("▶ 测试4：状态机转人工路径（复杂问题）");
    console.log("  输入：'我要投诉并申请退款！'");

    const streamResult = await serviceApp.stream({ issue: "我要投诉并申请退款！" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await serviceApp.invoke({ issue: "我要投诉并申请退款！" });

    console.log(`  执行轨迹：${nodes.join(" → ")}`);
    console.log(`  最终 status：${result.status}，经过人工：${result.humanAssisted}`);
    console.log(`  方案：${result.solution}`);

    const ok = result.status === "resolved"
      && result.humanAssisted
      && result.solution.includes("人工+AI")
      && nodes.includes("human")
      && nodes.filter((n) => n === "processing").length === 2;
    console.log(`  ${ok ? "✓" : "✗"} processing → human → processing → resolved 路径正确`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  迭代优化循环正确：不达标 → improve → 再评估");
    console.log("  双退出条件正确：达标退出 + 上限强制退出");
    console.log("  状态机模式正确：status 字段驱动全部路由");
    console.log("  转人工循环正确：processing ⇄ human");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:09 体验真实迭代优化\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
