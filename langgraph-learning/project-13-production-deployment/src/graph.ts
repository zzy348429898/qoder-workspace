/**
 * ============================================================================
 *  LangGraph.js 项目13：生产部署与流式 UI
 * ============================================================================
 *
 *  本项目覆盖的核心概念：
 *    1. 图与服务分离    — graph.ts 只定义图，index.ts 只提供 HTTP 服务
 *    2. REST API 部署   — Express 把图包装为 HTTP 接口（JSON + SSE）
 *    3. 流式 UI         — streamMode: "messages" token 级流式输出对接 SSE
 *    4. 监控            — 请求日志中间件（计数 + 耗时）
 *    5. LangGraph Studio — langgraph.json 配置 + CLI 可视化调试（注释说明）
 *
 *  文件结构：
 *    src/graph.ts      — 图定义（本文件，导出编译后的 app）
 *    src/index.ts      — Express 服务（/health、/chat、/chat/stream、静态页）
 *    src/verify.ts     — Mock 模式验证脚本（无需 API Key）
 *    public/index.html — 聊天 UI（EventSource 接收 SSE）
 *    langgraph.json    — LangGraph Studio 配置
 *
 *  ★ LangGraph Studio 使用说明（真实环境）：
 *    npm install -g @langchain/langgraph-cli
 *    langgraph dev        # 启动 Studio 开发服务器，浏览器可视化调试图
 *    本项目的 langgraph.json 已把 chatbot 图注册进去。
 *
 *  架构：
 *
 *     浏览器（EventSource）⇄ Express 服务
 *                              ├─ GET  /health        → 健康检查
 *                              ├─ POST /chat          → 完整 JSON 响应
 *                              ├─ GET  /chat/stream   → SSE token 流
 *                              └─ 静态目录 public/     → 聊天 UI
 *                                   ↓
 *                              LangGraph app.stream({ streamMode: "messages" })
 * ============================================================================
 */

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
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
// 图定义：与项目1相同的单节点 chatbot（教学重点在部署而非图结构）
// ============================================================================

const model = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
  temperature: 0.7,
  topP: 1,
});

const SYSTEM_PROMPT = `你是一个友好的中文助手，回答简洁（3 句话以内）。`;

async function chatbotNode(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);
  return { messages: [response] };
}

/** 编译后的图应用（供 Express 服务与 LangGraph Studio 使用） */
export const app = new StateGraph(MessagesAnnotation)
  .addNode("chatbot", chatbotNode)
  .addEdge(START, "chatbot")
  .addEdge("chatbot", END)
  .compile();
