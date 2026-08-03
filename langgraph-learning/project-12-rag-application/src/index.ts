/**
 * ============================================================================
 *  LangGraph.js 项目12：RAG 检索增强生成
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. 检索节点        — 从向量库检索相关文档
 *    2. 向量存储        — MemoryVectorStore + Embeddings（语义搜索）
 *    3. 文档评分        — LLM 判断检索结果相关性（withStructuredOutput + zod）
 *    4. 查询重写        — 不相关时改写查询重新检索（自适应 RAG）
 *    5. 循环安全        — rewriteCount 限制重写次数，防止无限循环
 *
 *  ★ 自适应 RAG（Adaptive RAG）流程：
 *    检索 → 评分 → 相关？→ 生成回答
 *              └ 不相关 → 重写查询 → 重新检索（最多 2 次）
 *
 *  ★ 关于 Embeddings 的说明：
 *    Anthropic 没有 embedding API，本项目实现一个确定性的
 *    DeterministicEmbeddings（基于词表的词频向量）：
 *    - 教学透明：向量=关键词出现次数，检索行为完全可解释
 *    - verify 无需 API Key 也能得到稳定的检索结果
 *    - 生产替换：把 embeddings 换成 OpenAIEmbeddings 等即可，图结构不变
 *
 *  图结构：
 *
 *     START → "retrieve" → "grade_documents" → (相关?) ──是→ "generate" → END
 *                                               └─否→ "rewrite_query" → "retrieve" (循环)
 *
 *  运行方式：
 *    1. 复制 .env.example 为 .env，填入 ANTHROPIC_API_KEY
 *    2. pnpm install（在 langgraph-learning/ 根目录）
 *    3. pnpm start:12         （需要 API Key）
 *    4. pnpm verify:12        （Mock 模式，无需 API Key）
 * ============================================================================
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
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
// 1. DeterministicEmbeddings —— 确定性的词表词频向量（教学用 Mock）
// ============================================================================
//
//  原理：预先定义一个领域词表（VOCAB），文本的向量 = 各词出现次数。
//  语义相近的文本共享更多词表词 → 余弦相似度更高 → 检索可预测。
//
// ============================================================================

/** 领域词表（覆盖本项目语料的核心术语） */
const VOCAB = [
  "state", "reducer", "node", "edge", "conditional", "tool", "react", "agent",
  "checkpoint", "memory", "thread", "interrupt", "human", "subgraph", "parallel",
  "send", "mapreduce", "supervisor", "multi", "rag", "vector", "embedding",
  "retrieve", "stream", "deploy", "langgraph",
  "状态", "节点", "边", "路由", "工具", "智能体", "检查点", "记忆", "中断",
  "子图", "并行", "向量", "检索", "部署", "流式",
];

export class DeterministicEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  /** 文本 → 词频向量（VOCAB 各词的出现次数，不区分大小写） */
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

// ============================================================================
// 2. 语料库 —— LangGraph 学习笔记（呼应前 11 个项目的知识点）
// ============================================================================

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
    pageContent: "ToolNode 自动执行 LLM 请求的 tool_calls 并返回 ToolMessage，bindTools 让模型知道可调用哪些工具。",
    metadata: { title: "工具调用", topic: "tool agent 工具" },
  }),
  new Document({
    pageContent: "ReAct 智能体交替进行推理与行动：agent 节点调用 LLM 决定工具调用，tools 节点执行后回到 agent 循环，直到给出最终回答。",
    metadata: { title: "ReAct 智能体", topic: "react agent 智能体" },
  }),
  new Document({
    pageContent: "Checkpoint 检查点在每个节点执行后保存状态快照，MemorySaver 是内存存储器，thread_id 标识会话实现多轮记忆与状态恢复。",
    metadata: { title: "记忆与持久化", topic: "checkpoint memory thread 记忆 检查点" },
  }),
  new Document({
    pageContent: "interrupt 在节点内暂停图执行等待人工审批，Command({ resume }) 携带人工决策恢复执行，必须配合 checkpointer。",
    metadata: { title: "人机交互", topic: "interrupt human 中断" },
  }),
  new Document({
    pageContent: "子图是编译后的图作为父图节点，同名字段自动共享；Send 在条件边中动态扇出并行任务实现 Map-Reduce。",
    metadata: { title: "子图与并行", topic: "subgraph parallel send 子图 并行" },
  }),
  new Document({
    pageContent: "Supervisor 模式中中心 Agent 决定调用哪个专业 Agent，协作模式中 Agent 通过共享 messages 直接对话。",
    metadata: { title: "多智能体", topic: "supervisor multi agent 智能体" },
  }),
];

// ============================================================================
// 3. 构建向量库
// ============================================================================

const embeddings = new DeterministicEmbeddings();
const vectorStore = await MemoryVectorStore.fromDocuments(LEARNING_NOTES, embeddings);

// ============================================================================
// 4. RAG 图 State
// ============================================================================

const RagAnnotation = Annotation.Root({
  question: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  documents: Annotation<Document[]>({ reducer: (_, u) => u, default: () => [] }),
  relevant: Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
  answer: Annotation<string>({ reducer: (_, u) => u, default: () => "" }),
  rewriteCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

const MAX_REWRITES = 2;

// ============================================================================
// 5. 节点实现
// ============================================================================

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.3,
  topP: 1,
});

/** retrieve：向量检索 top-2 相关文档 */
async function retrieveNode(state: typeof RagAnnotation.State) {
  console.log(`  [RAG] retrieve：检索 "${state.question.slice(0, 40)}"`);
  const docs = await vectorStore.similaritySearch(state.question, 2);
  console.log(`  [RAG] 命中 ${docs.length} 篇：${docs.map((d) => d.metadata.title).join("、")}`);
  return { documents: docs };
}

/** 评分结果的结构化 schema（withStructuredOutput） */
const gradeSchema = z.object({
  relevant: z.boolean().describe("检索到的文档是否能回答用户问题"),
  reason: z.string().describe("一句话判断理由"),
});

/** grade_documents：LLM 结构化评分（真实模式演示 withStructuredOutput） */
async function gradeNode(state: typeof RagAnnotation.State) {
  console.log(`  [RAG] grade_documents：评估检索结果相关性`);
  const grader = model.withStructuredOutput(gradeSchema);
  const docsText = state.documents.map((d) => `《${d.metadata.title}》${d.pageContent}`).join("\n");
  const result = await grader.invoke([
    new SystemMessage("你是检索质量评估员。判断检索到的文档能否回答用户问题。"),
    new HumanMessage(`用户问题：${state.question}\n\n检索文档：\n${docsText}`),
  ]);
  console.log(`  [RAG] 评分：${result.relevant ? "相关" : "不相关"}（${result.reason.slice(0, 40)}）`);
  return { relevant: result.relevant };
}

/** ★ 多条件路由：相关 → generate；不相关且未达重写上限 → rewrite；达上限 → generate（兜底） */
function routeAfterGrade(state: typeof RagAnnotation.State): "generate" | "rewrite_query" {
  if (state.relevant) return "generate";
  if (state.rewriteCount >= MAX_REWRITES) {
    console.log(`  [RAG] 已达重写上限 ${MAX_REWRITES}，用现有文档兜底生成`);
    return "generate";
  }
  return "rewrite_query";
}

/** rewrite_query：LLM 改写查询（加入领域术语） */
async function rewriteNode(state: typeof RagAnnotation.State) {
  console.log(`  [RAG] rewrite_query：改写查询（第 ${state.rewriteCount + 1} 次）`);
  const r = await model.invoke([
    new SystemMessage(`你是查询优化器。用户的原始问题没有检索到相关文档。
知识库主题是 LangGraph 图编排框架（State、Node、Edge、工具、Agent、Checkpoint 等）。
把问题改写为包含 LangGraph 领域术语的查询，只输出改写后的查询。`),
    new HumanMessage(state.question),
  ]);
  console.log(`  [RAG] 改写为："${(r.content as string).slice(0, 50)}"`);
  return { question: r.content as string, rewriteCount: 1 };
}

/** generate：基于检索文档生成带引用的回答 */
async function generateNode(state: typeof RagAnnotation.State) {
  console.log(`  [RAG] generate：基于 ${state.documents.length} 篇文档生成回答`);
  const docsText = state.documents
    .map((d, i) => `[${i + 1}]《${d.metadata.title}》${d.pageContent}`)
    .join("\n");
  const r = await model.invoke([
    new SystemMessage(`你是助教。仅基于给定文档回答用户问题（中文，3 句话以内），
回答末尾用 [1][2] 标注引用来源。文档中没有的信息就说"文档中未提及"。`),
    new HumanMessage(`问题：${state.question}\n\n文档：\n${docsText}`),
  ]);
  return { answer: r.content as string };
}

// ============================================================================
// 6. 组装图
// ============================================================================

const app = new StateGraph(RagAnnotation)
  .addNode("retrieve", retrieveNode)
  .addNode("grade_documents", gradeNode)
  .addNode("rewrite_query", rewriteNode)
  .addNode("generate", generateNode)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "grade_documents")
  .addConditionalEdges("grade_documents", routeAfterGrade)
  .addEdge("rewrite_query", "retrieve")
  .addEdge("generate", END)
  .compile();

// ============================================================================
// 7. 可视化 + 演示
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

async function askQuestion(question: string) {
  console.log("═".repeat(70));
  console.log(`  👤 问题：${question}`);
  console.log("═".repeat(70) + "\n");

  const streamResult = await app.stream({ question });
  const path2: string[] = [];
  for await (const chunk of streamResult) {
    path2.push(Object.keys(chunk)[0]);
  }

  const result = await app.invoke({ question });
  console.log(`\n  执行路径：${path2.join(" → ")}`);
  console.log(`  重写次数：${result.rewriteCount}`);
  console.log(`\n🤖 回答：${result.answer}\n`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:12 使用 Mock 模式验证");
    process.exit(1);
  }

  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + "  LangGraph.js 项目12：RAG 检索增强生成".padEnd(50) + "║");
  console.log("║" + "  核心概念：检索节点 · 向量存储 · 自适应 RAG".padEnd(58) + "║");
  console.log("╚" + "═".repeat(68) + "╝\n");

  await visualizeGraph();

  // 演示1：领域相关问题（应一次命中）
  await askQuestion("LangGraph 中 Reducer 的作用是什么？");

  // 演示2：口语化问题（可能需要查询重写）
  await askQuestion("怎么让机器人记住我说过的话？");
}

main().catch((err) => {
  console.error("运行出错：", err);
  process.exit(1);
});
