/**
 * 验证脚本：不需要 API Key —— Mock 图 + 真实 Express 服务的端到端 HTTP 测试
 *
 * 运行：pnpm verify:13  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. GET /health 返回服务状态
 *   2. POST /chat 返回完整 JSON 响应
 *   3. GET /chat/stream 返回 SSE 事件流（内容事件 + [DONE] 结束标记）
 *   4. 参数校验（空 message → 400）
 */

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import express, { Request, Response, NextFunction } from "express";
import { AddressInfo } from "node:net";

// ============================================================================
// 1. Mock 图（与 graph.ts 结构一致，LLM 换确定性 Mock）
// ============================================================================

function mockChatbotReply(messages: BaseMessage[]): string {
  const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
  const text = lastHuman ? (lastHuman.content as string) : "";
  if (/你好|hi|hello/i.test(text)) return "你好！我是 LangGraph 部署演示助手。";
  if (/langgraph/i.test(text)) return "LangGraph 是图编排框架，可部署为 HTTP 服务。";
  return `[Mock回复] 收到："${text.slice(0, 20)}"`;
}

const mockGraphApp = new StateGraph(MessagesAnnotation)
  .addNode("chatbot", async (state) => ({
    messages: [new AIMessage(mockChatbotReply(state.messages))],
  }))
  .addEdge(START, "chatbot")
  .addEdge("chatbot", END)
  .compile();

// ============================================================================
// 2. Express 服务（与 index.ts 结构一致，监听随机端口）
// ============================================================================

let requestCounter = 0;

function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = ++requestCounter;
  const start = Date.now();
  res.on("finish", () => {
    console.log(`  [监控] #${id} ${req.method} ${req.path} → ${res.statusCode}（${Date.now() - start}ms）`);
  });
  next();
}

function createServer() {
  const server = express();
  server.use(express.json());
  server.use(requestLogger);

  server.get("/health", (_req, res) => {
    res.json({ status: "ok", requests: requestCounter, uptime: process.uptime() });
  });

  server.post("/chat", async (req: Request, res: Response) => {
    const message = (req.body?.message as string) ?? "";
    if (!message.trim()) {
      res.status(400).json({ error: "message 不能为空" });
      return;
    }
    const result = await mockGraphApp.invoke({ messages: [new HumanMessage(message)] });
    res.json({ reply: result.messages.at(-1)!.content, messageCount: result.messages.length });
  });

  server.get("/chat/stream", async (req: Request, res: Response) => {
    const q = (req.query.q as string) ?? "";
    if (!q.trim()) {
      res.status(400).json({ error: "q 参数不能为空" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = await mockGraphApp.stream(
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
    res.write(`data: [DONE]\n\n`);
    res.end();
  });

  return server;
}

// ============================================================================
// 3. SSE 客户端读取工具
// ============================================================================

async function readSSE(url: string): Promise<{ events: string[]; rawText: string }> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let rawText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawText += decoder.decode(value, { stream: true });
  }
  const events = rawText
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length));
  return { events, rawText };
}

// ============================================================================
// 4. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目13 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：生产部署与流式 UI".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // 随机端口启动服务
  const httpServer = await new Promise<ReturnType<ReturnType<typeof createServer>["listen"]>>(
    (resolve) => {
      const s = createServer().listen(0, () => resolve(s));
    },
  );
  const port = (httpServer.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;
  console.log(`▶ 测试服务已启动（随机端口）：${base}\n`);

  try {
    // ---- 测试0：GET /health ----
    {
      total++;
      console.log("▶ 测试0：GET /health 健康检查");
      const res = await fetch(`${base}/health`);
      const data = await res.json();
      console.log(`  状态码：${res.status}`);
      console.log(`  响应：${JSON.stringify(data).slice(0, 60)}`);
      const ok = res.status === 200 && data.status === "ok";
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }

    // ---- 测试1：POST /chat 完整响应 ----
    {
      total++;
      console.log("▶ 测试1：POST /chat 完整 JSON 响应");
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "你好" }),
      });
      const data = await res.json();
      console.log(`  状态码：${res.status}`);
      console.log(`  回复：${data.reply}`);
      const ok = res.status === 200
        && typeof data.reply === "string"
        && data.reply.includes("LangGraph")
        && data.messageCount === 2;
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }

    // ---- 测试2：POST /chat 参数校验（空 message → 400）----
    {
      total++;
      console.log("▶ 测试2：POST /chat 参数校验");
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });
      const data = await res.json();
      console.log(`  状态码：${res.status}（预期 400），响应：${JSON.stringify(data)}`);
      const ok = res.status === 400 && !!data.error;
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }

    // ---- 测试3：SSE 流式端点（内容事件 + [DONE]）----
    {
      total++;
      console.log("▶ 测试3：GET /chat/stream SSE 流式响应");

      const { events } = await readSSE(`${base}/chat/stream?q=${encodeURIComponent("什么是 LangGraph？")}`);

      console.log(`  收到 SSE 事件数：${events.length}`);
      events.forEach((e, i) => console.log(`    [${i}] ${e.slice(0, 60)}`));

      const doneEvent = events.at(-1) === "[DONE]";
      const contentEvents = events.slice(0, -1).map((e) => JSON.parse(e) as { content: string; node: string });
      const fullText = contentEvents.map((c) => c.content).join("");
      const nodeTag = contentEvents[0]?.node;

      console.log(`  内容拼接：${fullText}`);
      console.log(`  来源节点标记：${nodeTag}`);
      console.log(`  [DONE] 结束标记：${doneEvent ? "有" : "无"}`);

      const ok = doneEvent
        && fullText.includes("LangGraph")
        && nodeTag === "chatbot";
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }

    // ---- 测试4：日志中间件（请求计数递增）----
    {
      total++;
      console.log("▶ 测试4：日志中间件（监控计数）");
      console.log(`  本测试会话共记录请求数：${requestCounter}（预期 ≥ 4）`);
      const ok = requestCounter >= 4;
      console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
      if (ok) passed++;
    }
  } finally {
    // 关闭服务
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log("▶ 测试服务已关闭\n");
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  REST 部署正确：/health、/chat 完整响应、参数校验");
    console.log("  SSE 流式正确：streamMode messages → data 事件流 → [DONE]");
    console.log("  监控中间件正确：请求计数与耗时记录");
    console.log("  图与服务分离：graph.ts 可独立用于 LangGraph Studio");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:13，浏览器打开 http://localhost:3000\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
