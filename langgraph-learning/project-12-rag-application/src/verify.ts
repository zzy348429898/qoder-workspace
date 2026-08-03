/**
 * 验证脚本：不需要 API Key —— 确定性 embedding + Mock 评分/生成
 *
 * 运行：pnpm verify:12  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 图结构包含 retrieve / grade_documents / rewrite_query / generate
 *   2. DeterministicEmbeddings：同文本同向量，相关文本相似度更高
 *   3. 向量检索质量：相关文档排在 top1
 *   4. 相关查询一次命中（无 rewrite）
 *   5. 不相关查询触发 rewrite 循环后命中
 *   6. 重写上限：循环达到 MAX_REWRITES 后兜底生成
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. DeterministicEmbeddings 与语料（与 index.ts 相同）
// ============================================================================

const VOCAB = [
  "state", "reducer", "node", "edge", "conditional", "tool", "react", "agent",
  "checkpoint", "memory", "thread", "interrupt", "human", "subgraph", "parallel",
  "send", "mapreduce", "supervisor", "multi", "rag", "vector", "embedding",
  "retrieve", "stream", "deploy", "langgraph",
  "状态", "节点", "边", "路由", "工具", "智能体", "检查点", "记忆", "中断",
  "子图", "并行", "向量", "检索", "部署", "流式",
];

class DeterministicEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  private vectorize(text: string): number[] {
    const lower = text.toLowerCase();
    return VOCAB.map((word) => {
      let count = 0;
      let idx = lower.indexOf(word.toLowerCase());
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(word.toLowerCase(), idx + word.length);
      }
      return count;
    });
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((d) => this.vectorize(d));
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.vectorize(document);
  }
}

const LEARNING_NOTES = [
  new Document({
    pageContent: "LangGraph 的 State 是图的全局状态容器，Reducer 定义字段合并策略（拼接 vs 覆盖），节点返回部分更新由 Reducer 合并进 State。",
    metadata: { title: "State 与 Reducer", topic: "state reducer" },
  }),
  new Document({
    pageContent: "条件边（ConditionalEdge）让图根据当前 State 动态路由到不同节点，路由函数返回目标节点名或 Send 列表。",
    metadata: { title: "条件边与动态路由", topic: "edge conditional 路由" },
  }),
  new Document({
    pageContent: "Checkpoint 检查点在每个节点执行后保存状态快照，MemorySaver 是内存存储器，thread_id 标识会话实现多轮记忆与状态恢复。",
    metadata: { title: "记忆与持久化", topic: "checkpoint memory thread 记忆 检查点" },
  }),
  new Document({
    pageContent: "ReAct 智能体交替进行推理与行动：agent 节点调用 LLM 决定工具调用，tools 节点执行后回到 agent 循环。",
    metadata: { title: "ReAct 智能体", topic: "react agent 智能体" },
  }),
];

const embeddings = new DeterministicEmbeddings();
const vectorStore = await MemoryVectorStore.fromDocuments(LEARNING_NOTES, embeddings);

// ============================================================================
// 2. RAG 图（Mock 评分/重写/生成，注入 gradeFn 以覆盖不同路径）
// ============================================================================

const RagAnnotation = Annotation.Root({
  question: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  documents: Annotation<Document[]>({ reducer: (_, u) => u, default: () => [] }),
  relevant: Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
  answer: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  rewriteCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

const MAX_REWRITES = 2;

/** Mock 相关性判断：查询中的 VOCAB 词是否出现在检索文档中 */
function mockGrade(question: string, docs: Document[]): boolean {
  const docsText = docs.map((d) => `${d.metadata.title} ${d.metadata.topic} ${d.pageContent}`).join(" ").toLowerCase();
  return VOCAB.some(
    (w) => question.toLowerCase().includes(w.toLowerCase()) && docsText.includes(w.toLowerCase())
  );
}

function buildRagGraph(gradeFn: (question: string, docs: Document[]) => boolean) {
  return new StateGraph(RagAnnotation)
    .addNode("retrieve", async (state) => ({
      documents: await vectorStore.similaritySearch(state.question, 2),
    }))
    .addNode("grade_documents", async (state) => ({
      relevant: gradeFn(state.question, state.documents),
    }))
    .addNode("rewrite_query", async (state) => ({
      // Mock 改写：附加领域术语，使下一轮评分必为相关
      question: `LangGraph State 状态管理：${state.question}`,
      rewriteCount: 1,
    }))
    .addNode("generate", async (state) => ({
      answer: `根据文档[${state.documents.map((d) => d.metadata.title).join("、")}]的回答（rewriteCount=${state.rewriteCount}）`,
    }))
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "grade_documents")
    .addConditionalEdges("grade_documents", (state) => {
      if (state.relevant) return "generate";
      if (state.rewriteCount >= MAX_REWRITES) return "generate";
      return "rewrite_query";
    })
    .addEdge("rewrite_query", "retrieve")
    .addEdge("generate", END)
    .compile();
}

const app = buildRagGraph(mockGrade);

// ============================================================================
// 3. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目12 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：RAG 检索增强生成".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化");
  const mermaidStr = app.getGraph().drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr.split("\n").map((line) => `  ${line}`).join("\n"));
  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await app.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：图结构验证");
    const expected = ["retrieve", "grade_documents", "rewrite_query", "generate"];
    const ok = expected.every((n) => mermaidStr.includes(n));
    console.log(`  预期节点：${expected.join(", ")}`);
    console.log(`  全部存在：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：embedding 确定性与区分度 ----
  {
    total++;
    console.log("▶ 测试1：DeterministicEmbeddings 确定性与区分度");

    const v1 = await embeddings.embedQuery("State 与 Reducer 的关系");
    const v2 = await embeddings.embedQuery("State 与 Reducer 的关系");
    const v3 = await embeddings.embedQuery("蛋糕的制作方法");

    const identical = v1.every((x, i) => x === v2[i]);
    // 余弦相似度
    const cosine = (a: number[], b: number[]) => {
      const dot = a.reduce((s, x, i) => s + x * b[i], 0);
      const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
      const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
      return na && nb ? dot / (na * nb) : 0;
    };
    const relatedVec = await embeddings.embedQuery("State 状态合并策略");
    const simRelated = cosine(v1, relatedVec);
    const simUnrelated = cosine(v1, v3);

    console.log(`  同文本同向量：${identical ? "是" : "否"}`);
    console.log(`  相关文本相似度：${simRelated.toFixed(3)}，不相关文本相似度：${simUnrelated.toFixed(3)}`);

    const ok = identical && simRelated > simUnrelated;
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：向量检索质量（top1 命中正确文档）----
  {
    total++;
    console.log("▶ 测试2：向量检索质量");

    const results = await vectorStore.similaritySearch("Reducer 如何合并状态更新？", 1);
    const top1 = results[0];

    console.log(`  查询："Reducer 如何合并状态更新？"`);
    console.log(`  top1 文档：《${top1.metadata.title}》`);

    const ok = top1.metadata.title === "State 与 Reducer";
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：相关查询一次命中（无 rewrite）----
  {
    total++;
    console.log("▶ 测试3：相关查询一次命中");
    console.log("  查询：'Reducer 的作用是什么？'");

    const streamResult = await app.stream({ question: "Reducer 的作用是什么？" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await app.invoke({ question: "Reducer 的作用是什么？" });

    console.log(`  执行路径：${nodes.join(" → ")}`);
    console.log(`  重写次数：${result.rewriteCount}（预期 0）`);
    console.log(`  回答：${result.answer}`);

    const ok = nodes.join(",") === "retrieve,grade_documents,generate"
      && result.rewriteCount === 0
      && result.answer.includes("State 与 Reducer");
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：不相关查询触发 rewrite 循环后命中 ----
  {
    total++;
    console.log("▶ 测试4：不相关查询触发 rewrite 循环");
    console.log("  查询：'怎么做蛋糕？'（领域外问题）");

    const streamResult = await app.stream({ question: "怎么做蛋糕？" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await app.invoke({ question: "怎么做蛋糕？" });

    console.log(`  执行路径：${nodes.join(" → ")}`);
    console.log(`  重写次数：${result.rewriteCount}（预期 1）`);
    console.log(`  回答：${result.answer}`);

    const ok = nodes.join(",") === "retrieve,grade_documents,rewrite_query,retrieve,grade_documents,generate"
      && result.rewriteCount === 1;
    console.log(`  ${ok ? "✓" : "✗"} 不相关 → 重写查询 → 重新检索 → 命中生成`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试5：重写上限兜底（评分恒不相关）----
  {
    total++;
    console.log("▶ 测试5：重写上限兜底（评分恒不相关，MAX=2）");

    const stubbornApp = buildRagGraph(() => false);
    const streamResult = await stubbornApp.stream({ question: "任何查询" });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    const result = await stubbornApp.invoke({ question: "任何查询" });

    const rewriteCount = nodes.filter((n) => n === "rewrite_query").length;
    console.log(`  rewrite_query 执行次数：${rewriteCount}（预期 ${MAX_REWRITES}）`);
    console.log(`  最终 rewriteCount：${result.rewriteCount}（预期 ${MAX_REWRITES}）`);
    console.log(`  最终到达 generate：${nodes.at(-1) === "generate" ? "是" : "否"}`);

    const ok = rewriteCount === MAX_REWRITES
      && result.rewriteCount === MAX_REWRITES
      && nodes.at(-1) === "generate";
    console.log(`  ${ok ? "✓" : "✗"} 达到上限后强制兜底生成，循环被终止`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  确定性 embedding 行为可预测：同文本同向量、相关文本更相似");
    console.log("  向量检索 top1 命中正确");
    console.log("  自适应 RAG 正确：相关 → 生成；不相关 → 重写 → 再检索");
    console.log("  重写上限正确：MAX_REWRITES 后兜底生成");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:12 体验真实 RAG 问答\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
