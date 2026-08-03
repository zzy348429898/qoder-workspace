/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 Supervisor 决策与各 Agent 产出
 *
 * 运行：pnpm verify:10  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 图结构包含 supervisor + 3 个 Agent 节点
 *   2. 决策序列正确：researcher → writer → reviewer → FINISH
 *   3. researcher 是 createReactAgent（内部 agent ⇄ tools 循环，搜索工具被调用）
 *   4. 每个 Agent 完成后回环到 supervisor
 *   5. FINISH 终止，最终产出审校结论
 */

import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. researcher Agent —— createReactAgent + Mock 搜索工具 + MockChatModel
// ============================================================================

let searchCallCount = 0;

const searchTool = tool(
  () => {
    searchCallCount++;
    return "搜索结果：LangGraph 核心概念包括 State、Node、Edge、Checkpoint。";
  },
  {
    name: "search",
    description: "搜索技术资料。",
    schema: z.object({ query: z.string().describe("搜索关键词") }),
  }
);

/** MockChatModel：第一次调用返回工具调用，之后返回研究笔记（供 createReactAgent 使用） */
class MockResearcherModel extends BaseChatModel {
  _llmType(): string {
    return "mock-researcher";
  }

  override bindTools(): this {
    return this;
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const lastMsg = messages.at(-1);
    let aiMessage: AIMessage;
    if (lastMsg && lastMsg._getType() === "tool") {
      aiMessage = new AIMessage("研究笔记：1. State 是全局状态 2. Node 是处理单元 3. Edge 控制路由");
    } else {
      aiMessage = new AIMessage({
        content: "",
        tool_calls: [{ name: "search", args: { query: "LangGraph" }, id: "mock_search_1", type: "tool_call" }],
      });
    }
    return {
      generations: [{ message: aiMessage, text: typeof aiMessage.content === "string" ? aiMessage.content : "" }],
      llmOutput: {},
    };
  }
}

const researcherAgent = createReactAgent({
  llm: new MockResearcherModel({}),
  tools: [searchTool],
});

// ============================================================================
// 2. 各 Agent 节点（Mock 产出，带 name 标记）
// ============================================================================

async function researcherNode(state: typeof MessagesAnnotation.State) {
  const result = await researcherAgent.invoke({ messages: state.messages });
  const lastMsg = result.messages.at(-1) as AIMessage;
  return { messages: [new AIMessage({ content: lastMsg.content, name: "researcher" })] };
}

async function writerNode(_state: typeof MessagesAnnotation.State) {
  return { messages: [new AIMessage({ content: "报告：LangGraph 通过图编排让 LLM 应用结构化……", name: "writer" })] };
}

async function reviewerNode(_state: typeof MessagesAnnotation.State) {
  return { messages: [new AIMessage({ content: "审校通过：报告结构清晰、内容准确。", name: "reviewer" })] };
}

// ============================================================================
// 3. Supervisor（Mock 决策：按消息历史中的 name 标记推进流程）
// ============================================================================

function mockSupervisorDecision(messages: BaseMessage[]): string {
  const names = messages.map((m) => (m as AIMessage).name).filter(Boolean);
  if (!names.includes("researcher")) return "NEXT: researcher";
  if (!names.includes("writer")) return "NEXT: writer";
  if (!names.includes("reviewer")) return "NEXT: reviewer";
  return "FINISH";
}

async function supervisorNode(state: typeof MessagesAnnotation.State) {
  return { messages: [new AIMessage(mockSupervisorDecision(state.messages))] };
}

function routeFromSupervisor(state: typeof MessagesAnnotation.State): string {
  const content = (state.messages.at(-1) as AIMessage).content as string;
  const match = content.match(/NEXT:\s*(researcher|writer|reviewer)/);
  return match ? match[1] : END;
}

// ============================================================================
// 4. 组装图（与 index.ts 结构一致）
// ============================================================================

const app = new StateGraph(MessagesAnnotation)
  .addNode("supervisor", supervisorNode)
  .addNode("researcher", researcherNode)
  .addNode("writer", writerNode)
  .addNode("reviewer", reviewerNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", routeFromSupervisor, ["researcher", "writer", "reviewer", END])
  .addEdge("researcher", "supervisor")
  .addEdge("writer", "supervisor")
  .addEdge("reviewer", "supervisor")
  .compile();

// ============================================================================
// 5. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目10 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：多智能体 Supervisor".padEnd(56) + "║");
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
    const expected = ["supervisor", "researcher", "writer", "reviewer"];
    const ok = expected.every((n) => mermaidStr.includes(n));
    console.log(`  预期节点：${expected.join(", ")}`);
    console.log(`  全部存在：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：决策序列与回环（stream 观察执行轨迹）----
  let streamNodes: string[] = [];
  {
    total++;
    console.log("▶ 测试1：决策序列与回环");
    console.log("  期望：supervisor ⇄ researcher/writer/reviewer 交替，最后 FINISH");

    const streamResult = await app.stream({ messages: [new HumanMessage("研究 LangGraph 并写报告")] });
    for await (const chunk of streamResult) {
      streamNodes.push(Object.keys(chunk)[0]);
    }

    console.log(`  执行轨迹：${streamNodes.join(" → ")}`);

    // 期望轨迹：supervisor → researcher → supervisor → writer → supervisor → reviewer → supervisor
    const expected = "supervisor,researcher,supervisor,writer,supervisor,reviewer,supervisor";
    const ok = streamNodes.join(",") === expected;
    console.log(`  ${ok ? "✓" : "✗"} 决策序列与回环正确`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：researcher 内部 ReAct 循环（createReactAgent 调用搜索工具）----
  {
    total++;
    console.log("▶ 测试2：researcher 内部 ReAct 循环（createReactAgent + 工具）");
    console.log(`  搜索工具被调用次数：${searchCallCount}（预期 ≥ 1）`);

    const ok = searchCallCount >= 1;
    console.log(`  ${ok ? "✓" : "✗"} researcher 作为子 Agent 完整执行了 agent ⇄ tools 循环`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：Agent 产出的 name 标记 ----
  let finalResult: typeof MessagesAnnotation.State | null = null;
  {
    total++;
    console.log("▶ 测试3：Agent 产出的 name 标记");

    finalResult = await app.invoke({ messages: [new HumanMessage("研究 LangGraph 并写报告")] });

    const agentNames = finalResult.messages
      .filter((m: BaseMessage) => m._getType() === "ai" && (m as AIMessage).name)
      .map((m: BaseMessage) => (m as AIMessage).name);

    console.log(`  带 name 标记的消息来源：${[...new Set(agentNames)].join(", ")}`);

    const ok = ["researcher", "writer", "reviewer"].every((n) => agentNames.includes(n));
    console.log(`  ${ok ? "✓" : "✗"} 三个 Agent 的产出均有 name 标记`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：FINISH 终止，最终产出审校结论 ----
  {
    total++;
    console.log("▶ 测试4：FINISH 终止");

    const supervisorMsgs = finalResult!.messages.filter(
      (m: BaseMessage) => m._getType() === "ai" && !(m as AIMessage).name
    );
    const lastDecision = (supervisorMsgs.at(-1)!.content as string).trim();
    const reviewerMsg = finalResult!.messages.find(
      (m: BaseMessage) => (m as AIMessage).name === "reviewer"
    ) as AIMessage;

    console.log(`  最后一次 Supervisor 决策：${lastDecision}`);
    console.log(`  审校结论：${(reviewerMsg.content as string).slice(0, 40)}`);

    const ok = lastDecision === "FINISH" && (reviewerMsg.content as string).includes("审校通过");
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  Supervisor 决策序列正确：researcher → writer → reviewer → FINISH");
    console.log("  Agent 回环正确：每个 Agent 完成后回到 Supervisor");
    console.log("  createReactAgent 子 Agent 完整执行 ReAct 循环");
    console.log("  name 标记正确标识各 Agent 产出");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:10 体验真实多智能体协作\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
