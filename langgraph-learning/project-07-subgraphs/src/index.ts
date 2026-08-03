/**
 * ============================================================================
 *  LangGraph.js 项目7：子图与组合
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. Subgraph（子图） — 编译后的图可以作为另一个图的节点
 *    2. 图嵌套           — 大图中包含小图，复杂逻辑模块化
 *    3. 状态共享         — 父子图同名 State 字段自动互通
 *    4. 状态隔离         — 子图私有字段不会泄漏到父图
 *    5. subgraphs 选项   — stream 时观察子图内部节点的执行
 *
 *  为什么需要子图？
 *    - 复杂系统拆分：每个子图专注一个职责（研究、写作），独立开发和测试
 *    - 复用：同一个子图可以被多个父图使用（项目11的层级多智能体也会用到）
 *    - 团队协作：不同成员维护不同子图
 *
 *  ★ 状态映射规则（核心教学点）：
 *    父图调用子图节点时：
 *      - 父图 State 中与子图 State【同名】的字段 → 自动传入子图
 *      - 子图返回的更新中【同名】字段 → 自动写回父图 State
 *      - 子图【私有】字段（父图没有）→ 不泄漏到父图（隔离）
 *      - 若字段名不同，需用包装函数手动做映射（本项目注释中说明）
 *
 *  图结构：
 *
 *                          ┌→ "research_subgraph"（search → summarize）─┐
 *     START ──→ "coordinator" ──┤                                          ├──→ "finalize" ──→ END
 *                          └→ "writing_subgraph"（outline → draft）───┘
 *     （本项目中两个子图串行执行：先研究、后写作）
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:07         （需要 API Key）
 *    4. pnpm verify:07        （Mock 模式，无需 API Key）
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

// ============================================================================
// 1. LLM 实例
// ============================================================================

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
// 2. research 子图 —— 负责"研究"：搜索资料并总结成研究笔记
// ============================================================================
//
//  子图 State 设计（教学点）：
//    - topic / researchNotes：与父图同名 → 自动共享（读父图 topic，写回 researchNotes）
//    - searchCount：子图私有 → 不会泄漏到父图（隔离演示）
//
// ============================================================================

const ResearchAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  // 私有字段：父图 State 中没有同名字段（不会泄漏到父图）
  rawResults: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  searchCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

/** Mock 知识库（真实项目中替换为搜索 API） */
const knowledgeBase: Record<string, string> = {
  langgraph: "LangGraph 是 LangChain 出品的图编排框架，核心概念包括 State、Node、Edge、Checkpoint。",
  rag: "RAG（检索增强生成）= 检索相关文档 + 注入 Prompt + LLM 生成，解决 LLM 知识 cutoff 与幻觉问题。",
  agent: "Agent 模式让 LLM 自主决定调用工具（ReAct 循环），适合开放域多步任务。",
};

async function searchNode(state: typeof ResearchAnnotation.State) {
  console.log(`    [子图:research] search 节点执行（主题："${state.topic}"）`);
  const hits: string[] = [];
  const lowerTopic = state.topic.toLowerCase();
  for (const [keyword, info] of Object.entries(knowledgeBase)) {
    if (lowerTopic.includes(keyword) || keyword.includes(state.topic)) {
      hits.push(info);
    }
  }
  const rawResults = hits.length > 0 ? hits.join("\n") : `未找到"${state.topic}"的直接资料，给出通用介绍。`;
  return { rawResults, searchCount: 1 };
}

async function summarizeNode(state: typeof ResearchAnnotation.State) {
  console.log(`    [子图:research] summarize 节点执行`);
  const notes = await askLLM(
    "你是研究助理，把原始资料整理成 3-5 条要点笔记（中文，每条一行）。",
    `主题：${state.topic}\n\n原始资料：\n${state.rawResults}`,
  );
  return { researchNotes: notes };
}

const researchSubgraph = new StateGraph(ResearchAnnotation)
  .addNode("search", searchNode)
  .addNode("summarize", summarizeNode)
  .addEdge(START, "search")
  .addEdge("search", "summarize")
  .addEdge("summarize", END)
  .compile();

// ============================================================================
// 3. writing 子图 —— 负责"写作"：基于研究笔记先列大纲再写正文
// ============================================================================
//
//  子图 State 设计：
//    - topic / researchNotes：与父图同名 → 自动从父图读入
//    - outline / article：与父图同名 → 写回父图
//    - draftRound：私有字段 → 隔离演示
//
// ============================================================================

const WritingAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  outline: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  article: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  draftRound: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

async function outlineNode(state: typeof WritingAnnotation.State) {
  console.log(`    [子图:writing] outline 节点执行`);
  const outline = await askLLM(
    "你是写作策划，根据研究笔记为短文拟定 3 段式大纲（中文，每段一行）。",
    `主题：${state.topic}\n\n研究笔记：\n${state.researchNotes}`,
  );
  return { outline };
}

async function draftNode(state: typeof WritingAnnotation.State) {
  console.log(`    [子图:writing] draft 节点执行`);
  const article = await askLLM(
    "你是作者，根据大纲和研究笔记写一篇 300 字以内的中文短文。",
    `主题：${state.topic}\n大纲：\n${state.outline}\n\n研究笔记：\n${state.researchNotes}`,
  );
  return { article, draftRound: 1 };
}

// ★ 注意：节点名不能与 State 字段同名（LangGraph 约束），
//   因此节点命名为 write_outline / write_draft，而非 outline / draft
const writingSubgraph = new StateGraph(WritingAnnotation)
  .addNode("write_outline", outlineNode)
  .addNode("write_draft", draftNode)
  .addEdge(START, "write_outline")
  .addEdge("write_outline", "write_draft")
  .addEdge("write_draft", END)
  .compile();

// ============================================================================
// 4. 父图 —— 组合两个子图
// ============================================================================
//
//  ★ 关键用法：编译后的子图（CompiledStateGraph）直接作为 addNode 的节点！
//    .addNode("research_subgraph", researchSubgraph)
//
//  父图 State 只声明自己关心的字段；与子图同名的字段自动互通，
//  子图私有字段（searchCount / draftRound）不会出现在父图 State 中。
//
//  若父子图字段名不同，需要包装函数手动映射，例如：
//    .addNode("research_subgraph", async (parentState) => {
//      const subResult = await researchSubgraph.invoke({ topic: parentState.subject });
//      return { researchNotes: subResult.researchNotes };
//    })
//
// ============================================================================

const ParentAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  researchNotes: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  outline: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  article: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  finalOutput: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
});

async function coordinatorNode(state: typeof ParentAnnotation.State) {
  console.log(`  [父图] coordinator：收到主题 "${state.topic}"，开始调度子图`);
  return {}; // 只透传，实际调度由边完成
}

async function finalizeNode(state: typeof ParentAnnotation.State) {
  console.log(`  [父图] finalize：汇总研究笔记与文章`);
  const finalOutput = [
    `=== 主题：${state.topic} ===`,
    `\n【研究笔记】\n${state.researchNotes}`,
    `\n【大纲】\n${state.outline}`,
    `\n【正文】\n${state.article}`,
  ].join("\n");
  return { finalOutput };
}

const app = new StateGraph(ParentAnnotation)
  .addNode("coordinator", coordinatorNode)
  // ★ 子图即节点
  .addNode("research_subgraph", researchSubgraph)
  .addNode("writing_subgraph", writingSubgraph)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "coordinator")
  .addEdge("coordinator", "research_subgraph")
  .addEdge("research_subgraph", "writing_subgraph")
  .addEdge("writing_subgraph", "finalize")
  .addEdge("finalize", END)
  .compile();

// ============================================================================
// 5. 图结构可视化 + 演示
// ============================================================================

async function visualizeGraph() {
  console.log("═".repeat(70));
  console.log("  图结构可视化（父图视角）");
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

/**
 * 演示：stream({ subgraphs: true }) 观察子图内部执行
 *
 * 不传 subgraphs 时，stream 只报告父图节点（research_subgraph 整体作为一个节点）；
 * 传入后，还能看到子图内部节点（search、summarize、outline、draft）的事件。
 */
async function demoSubgraphStream() {
  console.log("═".repeat(70));
  console.log("  演示：子图组合执行（stream with subgraphs: true）");
  console.log("═".repeat(70));

  const topic = "RAG";
  console.log(`\n👤 主题：${topic}\n`);

  const streamResult = await app.stream(
    { topic },
    { subgraphs: true },
  );

  for await (const [namespace, chunk] of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    // namespace 形如 ["research_subgraph:xxx"] 表示事件来自子图内部
    const fromSub = namespace.length > 0 ? `（子图 ${namespace[0].split(":")[0]} 内部）` : "（父图）";
    console.log(`  [stream 事件] 节点 "${nodeName}" 完成 ${fromSub}`);
  }

  const finalState = await app.invoke({ topic });
  console.log(`\n  ── 父图最终 State ──`);
  console.log(`  researchNotes 长度：${finalState.researchNotes.length} 字符（research 子图写入）`);
  console.log(`  outline 长度：${finalState.outline.length} 字符（writing 子图写入）`);
  console.log(`  article 长度：${finalState.article.length} 字符（writing 子图写入）`);
  console.log(`  ★ 父图 State 中不含子图私有字段：searchCount=${"searchCount" in finalState}，draftRound=${"draftRound" in finalState}`);
  console.log(`\n${"─".repeat(70)}\n${finalState.finalOutput.slice(0, 400)}...\n`);
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:07 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目7：子图与组合".padEnd(50) + "║");
  console.log("║" + "  核心概念：Subgraph · 图嵌套 · 状态共享与隔离".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();
  await demoSubgraphStream();
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
