/**
 * 项目13：Express 服务 —— 把 LangGraph 图部署为 HTTP API（含 SSE 流式输出）
 *
 * 端点：
 *   GET  /health          健康检查
 *   POST /chat            { message } → 完整 JSON 响应
 *   GET  /chat/stream?q=  SSE token 级流式响应（streamMode: "messages"）
 *   GET  /                静态聊天 UI（public/index.html）
 *
 * 运行：pnpm start:13（需要 API Key），然后浏览器打开 http://localhost:3000
 */

import express, { Request, Response, NextFunction } from "express";
import { HumanMessage } from "@langchain/core/messages";
import * as path from "node:path";
import process from "node:process";
import { app as graphApp } from "./graph.js";

// ============================================================================
// 1. 日志中间件（监控：请求计数 + 耗时）
// ============================================================================
//
//  生产环境可替换为 pino/winston + OpenTelemetry，
//  这里用最小实现展示监控思路：每个请求记录方法、路径、状态码、耗时。
//
// ============================================================================

let requestCounter = 0;

function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = ++requestCounter;
  const start = Date.now();
  res.on("finish", () => {
    const elapsed = Date.now() - start;
    console.log(`  [监控] #${id} ${req.method} ${req.path} → ${res.statusCode}（${elapsed}ms）`);
  });
  next();
}

// ============================================================================
// 2. Express 应用
// ============================================================================

const server = express();
server.use(express.json());
server.use(requestLogger);
server.use(express.static(path.join(process.cwd(), "public")));

/** 健康检查 */
server.get("/health", (_req, res) => {
  res.json({ status: "ok", requests: requestCounter, uptime: process.uptime() });
});

/** POST /chat —— 一次性完整响应（invoke 模式） */
server.post("/chat", async (req: Request, res: Response) => {
  const message = (req.body?.message as string) ?? "";
  if (!message.trim()) {
    res.status(400).json({ error: "message 不能为空" });
    return;
  }
  try {
    const result = await graphApp.invoke({ messages: [new HumanMessage(message)] });
    const lastMsg = result.messages.at(-1)!;
    res.json({ reply: lastMsg.content, messageCount: result.messages.length });
  } catch (err) {
    console.error("  [错误] /chat 调用失败：", err);
    res.status(500).json({ error: "图执行失败" });
  }
});

// ============================================================================
// 3.【核心概念】SSE 流式端点 —— streamMode: "messages" 的 token 级推流
// ============================================================================
//
//  SSE（Server-Sent Events）协议格式极简：
//    Content-Type: text/event-stream
//    每个事件：data: <内容>\n\n
//
//  LangGraph 的 streamMode: "messages" 每次产出 [messageChunk, metadata]：
//    - messageChunk：LLM 的 token 级增量（AIMessageChunk）
//    - metadata：包含 langgraph_node 等（哪个节点产出的）
//
// ============================================================================

server.get("/chat/stream", async (req: Request, res: Response) => {
  const q = (req.query.q as string) ?? "";
  if (!q.trim()) {
    res.status(400).json({ error: "q 参数不能为空" });
    return;
  }

  // SSE 响应头
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    // ★ streamMode: "messages" —— token 级流式
    const stream = await graphApp.stream(
      { messages: [new HumanMessage(q)] },
      { streamMode: "messages" },
    );

    for await (const [messageChunk, metadata] of stream) {
      const content = typeof messageChunk.content === "string" ? messageChunk.content : "";
      if (content) {
        const node = (metadata as Record<string, unknown>).langgraph_node ?? "unknown";
        res.write(`data: ${JSON.stringify({ content, node })}\n\n`);
      }
    }

    // 结束标记
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("  [错误] /chat/stream 失败：", err);
    res.write(`data: ${JSON.stringify({ error: "图执行失败" })}\n\n`);
    res.end();
  }
});

// ============================================================================
// 4. 启动服务
// ============================================================================

const PORT = Number(process.env.PORT ?? 3000);

function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 未找到 ANTHROPIC_API_KEY！");
    console.error("   请复制 .env.example 为 .env 并填入你的 API Key");
    console.error("   或运行 pnpm verify:13 使用 Mock 模式验证");
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log("\n╔" + "═".repeat(68) + "╗");
    console.log("║" + "  LangGraph.js 项目13：生产部署与流式 UI".padEnd(50) + "║");
    console.log("╚" + "═".repeat(68) + "╝");
    console.log(`\n  🚀 服务已启动：http://localhost:${PORT}`);
    console.log(`     聊天 UI：http://localhost:${PORT}/`);
    console.log(`     健康检查：http://localhost:${PORT}/health`);
    console.log(`     流式接口：http://localhost:${PORT}/chat/stream?q=你好`);
    console.log(`\n  💡 LangGraph Studio：langgraph dev（需安装 @langchain/langgraph-cli）\n`);
  });
}

main();
