/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 验证子图组合
 *
 * 运行：pnpm verify:07  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 父图结构包含子图节点
 *   2. stream({ subgraphs: true }) 能看到子图内部节点
 *   3. 状态共享：researchNotes 由 research 子图写入、writing 子图可读
 *   4. 状态隔离：子图私有字段不泄漏到父图
 *   5. 端到端流程产出 finalOutput
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. Mock LLM —— 按 system prompt 中的角色关键词返回确定性内容
// ============================================================================

function mockAskLLM(system: string, user: string): string {
  if (system.includes("研究助理")) {
    return `[Mock研究笔记]\n1. ${user.includes("RAG") ? "RAG = 检索 + 生成" : "主题要点A"}\n2. 要点B\n3. 要点C`;
  }
  if (system.includes("写作策划")) {
    return `[Mock大纲]\n第一段：引入\n第二段：展开\n第三段：总结`;
  }
  if (system.includes("作者")) {
    return `[Mock正文] 这是一篇根据大纲和研究笔记写成的短文……`;
  }
  return `[Mock回复] ${user.slice(0, 20)}`;
}

// ============================================================================
// 2. research 子图（结构与 index.ts 一致，LLM 换 Mock）
// ============================================================================

const ResearchAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  rawResults: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  searchCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

const researchSubgraph = new StateGraph(ResearchAnnotation)
  .addNode("search", async (state) => {
    const rawResults = `关于 ${state.topic} 的 Mock 原始资料：检索增强生成结合向量检索与 LLM。`;
    return { rawResults, searchCount: 1 };
  })
  .addNode("summarize", async (state) => ({
    researchNotes: mockAskLLM("你是研究助理", `主题：${state.topic}\n\n原始资料：\n${state.rawResults}`),
  }))
  .addEdge(START, "search")
  .addEdge("search", "summarize")
  .addEdge("summarize", END)
  .compile();

// ============================================================================
// 3. writing 子图
// ============================================================================

const WritingAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  outline: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  article: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  draftRound: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

// 节点名不能与 State 字段同名（LangGraph 约束），故用 write_outline / write_draft
const writingSubgraph = new StateGraph(WritingAnnotation)
  .addNode("write_outline", async (state) => ({
    outline: mockAskLLM("你是写作策划", `主题：${state.topic}\n研究笔记：${state.researchNotes}`),
  }))
  .addNode("write_draft", async (state) => ({
    article: mockAskLLM("你是作者", `大纲：${state.outline}\n研究笔记：${state.researchNotes}`),
    draftRound: 1,
  }))
  .addEdge(START, "write_outline")
  .addEdge("write_outline", "write_draft")
  .addEdge("write_draft", END)
  .compile();

// ============================================================================
// 4. 父图
// ============================================================================

const ParentAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  outline: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  article: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  finalOutput: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
});

const app = new StateGraph(ParentAnnotation)
  .addNode("coordinator", async () => ({}))
  .addNode("research_subgraph", researchSubgraph)
  .addNode("writing_subgraph", writingSubgraph)
  .addNode("finalize", async (state) => ({
    finalOutput: `主题：${state.topic}\n【笔记】${state.researchNotes}\n【大纲】${state.outline}\n【正文】${state.article}`,
  }))
  .addEdge(START, "coordinator")
  .addEdge("coordinator", "research_subgraph")
  .addEdge("research_subgraph", "writing_subgraph")
  .addEdge("writing_subgraph", "finalize")
  .addEdge("finalize", END)
  .compile();

// ============================================================================
// 5. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目7 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：子图与组合".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化（父图视角）");
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

  // ---- 测试0：父图结构验证 ----
  {
    total++;
    console.log("▶ 测试0：父图结构验证");
    const expected = ["coordinator", "research_subgraph", "writing_subgraph", "finalize"];
    const ok = expected.every((n) => mermaidStr.includes(n));
    console.log(`  预期节点：${expected.join(", ")}`);
    console.log(`  全部存在：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：subgraphs: true 观察子图内部节点 ----
  let streamNodes: string[] = [];
  {
    total++;
    console.log("▶ 测试1：stream({ subgraphs: true }) 观察子图内部节点");

    const streamResult = await app.stream({ topic: "RAG" }, { subgraphs: true });
    const parentNodes: string[] = [];
    const subNodes: string[] = [];
    for await (const [namespace, chunk] of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      if (namespace.length > 0) {
        subNodes.push(nodeName);
      } else {
        parentNodes.push(nodeName);
      }
      streamNodes.push(nodeName);
    }

    console.log(`  父图节点事件：${parentNodes.join(" → ")}`);
    console.log(`  子图内部节点事件：${subNodes.join(" → ")}`);

    const expectedSub = ["search", "summarize", "write_outline", "write_draft"];
    const ok = expectedSub.every((n) => subNodes.includes(n));
    console.log(`  子图内部节点全部可见：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：状态共享（researchNotes 跨子图传递）----
  let finalState: typeof ParentAnnotation.State | null = null;
  {
    total++;
    console.log("▶ 测试2：状态共享 —— research 子图写入，writing 子图可读");

    finalState = await app.invoke({ topic: "RAG" });

    const notesFromResearch = finalState.researchNotes.includes("Mock研究笔记");
    const articleUsesNotes = finalState.article.length > 0 && finalState.outline.includes("Mock大纲");

    console.log(`  父图 researchNotes 来自 research 子图：${notesFromResearch ? "是" : "否"}`);
    console.log(`  writing 子图产出 outline/article：${articleUsesNotes ? "是" : "否"}`);
    console.log(`  researchNotes 内容：${finalState.researchNotes.split("\n")[0]}...`);

    const ok = notesFromResearch && articleUsesNotes;
    console.log(`  ${ok ? "✓" : "✗"} 同名字段在父子图间自动互通`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：状态隔离（子图私有字段不泄漏）----
  {
    total++;
    console.log("▶ 测试3：状态隔离 —— 子图私有字段不泄漏到父图");

    const state = finalState as Record<string, unknown>;
    const leakedSearchCount = "searchCount" in state;
    const leakedRawResults = "rawResults" in state;
    const leakedDraftRound = "draftRound" in state;

    console.log(`  父图 State 包含 searchCount（research 私有）：${leakedSearchCount ? "是" : "否"}`);
    console.log(`  父图 State 包含 rawResults（research 私有）：${leakedRawResults ? "是" : "否"}`);
    console.log(`  父图 State 包含 draftRound（writing 私有）：${leakedDraftRound ? "是" : "否"}`);

    const ok = !leakedSearchCount && !leakedRawResults && !leakedDraftRound;
    console.log(`  ${ok ? "✓" : "✗"} 私有字段全部隔离`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：端到端 finalOutput ----
  {
    total++;
    console.log("▶ 测试4：端到端流程产出 finalOutput");

    const output = finalState!.finalOutput;
    const ok = output.includes("RAG") && output.includes("【笔记】")
      && output.includes("【大纲】") && output.includes("【正文】");
    console.log(`  finalOutput 包含主题与三个部分：${ok ? "是" : "否"}`);
    console.log(`  长度：${output.length} 字符`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  编译后的子图可直接作为父图节点");
    console.log("  同名字段自动共享：researchNotes / outline / article");
    console.log("  私有字段自动隔离：searchCount / rawResults / draftRound");
    console.log("  subgraphs: true 可观察子图内部执行");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:07 体验真实子图协作\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
