/**
 * 验证脚本：不需要 API Key，用 Mock 模拟 LLM 验证 Human-in-the-Loop 审批流程
 *
 * 运行：pnpm verify:06  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 图结构包含 agent / review / tools 三个节点
 *   2. interrupt 冻结图执行，__interrupt__ 信息正确
 *   3. getState().next 指向恢复点
 *   4. 批准路径：Command resume 后工具执行并给出回答
 *   5. 拒绝路径：工具不执行，流程直接结束
 *   6. 无工具调用时不触发审批
 */

import {
  StateGraph, START, END, Annotation, MessagesAnnotation,
  MemorySaver, interrupt, Command,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 工具定义（同步执行版本）
// ============================================================================

const calculatorTool = tool(
  ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return `计算结果：${expression} = ${result}`;
    } catch {
      return `计算失败：无法解析表达式 "${expression}"`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算。",
    schema: z.object({ expression: z.string().describe("数学表达式") }),
  }
);

const allTools = [calculatorTool];

// ============================================================================
// 2. State 与 Mock LLM
// ============================================================================

const HitlAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  approvalDecision: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

function mockLLMResponse(messages: BaseMessage[]): AIMessage {
  const lastMsg = messages.at(-1);

  // 工具已执行 → 最终回答
  if (lastMsg && lastMsg._getType() === "tool") {
    return new AIMessage(`根据工具结果：${(lastMsg as ToolMessage).content}`);
  }

  const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
  const text = lastHuman ? (lastHuman.content as string) : "";

  if (/(计算|等于|多少)/.test(text)) {
    return new AIMessage({
      content: "",
      tool_calls: [{
        name: "calculator",
        args: { expression: "15 * 37" },
        id: "mock_call_1",
        type: "tool_call",
      }],
    });
  }
  return new AIMessage(`[Mock回复] 收到："${text.slice(0, 20)}"，无需工具。`);
}

// ============================================================================
// 3. 构建图（与 index.ts 结构一致）
// ============================================================================

async function mockAgentNode(state: typeof HitlAnnotation.State) {
  return { messages: [mockLLMResponse(state.messages)] };
}

async function reviewNode(state: typeof HitlAnnotation.State) {
  const lastMessage = state.messages.at(-1) as AIMessage;
  const pendingCalls = (lastMessage.tool_calls ?? []).map((tc) => ({
    name: tc.name,
    args: tc.args,
  }));
  const decision = interrupt({
    message: "LLM 请求调用以下工具，请审批（approve / reject）：",
    toolCalls: pendingCalls,
  }) as string;
  return { approvalDecision: decision };
}

function routeAfterAgent(state: typeof HitlAnnotation.State): "review" | typeof END {
  const lastMessage = state.messages.at(-1) as AIMessage;
  return lastMessage.tool_calls?.length ? "review" : END;
}

function routeAfterReview(state: typeof HitlAnnotation.State): "tools" | typeof END {
  return state.approvalDecision === "approve" ? "tools" : END;
}

const app = new StateGraph(HitlAnnotation)
  .addNode("agent", mockAgentNode)
  .addNode("review", reviewNode)
  .addNode("tools", new ToolNode(allTools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addConditionalEdges("review", routeAfterReview)
  .addEdge("tools", "agent")
  .compile({ checkpointer: new MemorySaver() });

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

// ============================================================================
// 4. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目6 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：人机交互（Human-in-the-Loop）".padEnd(56) + "║");
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
    const expected = ["agent", "review", "tools"];
    const ok = expected.every((n) => mermaidStr.includes(n));
    console.log(`  预期节点：${expected.join(", ")}，全部存在：${ok ? "是" : "否"}`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：interrupt 冻结图 + 中断信息读取 ----
  let interruptCfg: ReturnType<typeof threadConfig>;
  {
    total++;
    console.log("▶ 测试1：interrupt 冻结图执行");
    console.log("  输入：'计算 15 * 37 等于多少？'（触发工具调用 → 审批中断）");

    interruptCfg = threadConfig("test-interrupt");
    const result = await app.invoke(
      { messages: [new HumanMessage("计算 15 * 37 等于多少？")] },
      interruptCfg,
    );

    // ★ 通过 getState().tasks[].interrupts 读取中断信息
    const state = await app.getState(interruptCfg);
    const interrupts = state.tasks.flatMap((t) => t.interrupts ?? []);
    const pending = interrupts[0]?.value as
      | { message: string; toolCalls: Array<{ name: string }> }
      | undefined;

    const frozen = state.next.length > 0;
    const toolName = pending?.toolCalls?.[0]?.name;
    const noToolMsg = !result.messages.some((m: BaseMessage) => m._getType() === "tool");

    console.log(`  图已冻结（next 非空）：${frozen ? "是" : "否"}`);
    console.log(`  中断值中的待审批工具：${toolName ?? "无"}`);
    console.log(`  中断时无 ToolMessage：${noToolMsg ? "是" : "否"}`);

    const ok = frozen && toolName === "calculator" && noToolMsg;
    console.log(`  ${ok ? "✓" : "✗"} 图在审批点冻结，工具尚未执行`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：getState().next 指向恢复点 ----
  {
    total++;
    console.log("▶ 测试2：getState().next 指向恢复点");

    const state = await app.getState(interruptCfg);
    console.log(`  getState().next = ${JSON.stringify(state.next)}（预期 ["review"]）`);

    const ok = state.next.length === 1 && state.next[0] === "review";
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：批准路径 —— 工具执行并给出最终回答 ----
  {
    total++;
    console.log("▶ 测试3：批准路径（Command resume 'approve'）");

    const resumed = await app.invoke(new Command({ resume: "approve" }), interruptCfg);
    const toolMsg = resumed.messages.find((m: BaseMessage) => m._getType() === "tool") as ToolMessage | undefined;
    const lastMsg = resumed.messages.at(-1)!;

    console.log(`  包含 ToolMessage：${toolMsg ? "是" : "否"}`);
    if (toolMsg) console.log(`  工具结果：${toolMsg.content}`);
    console.log(`  最终回复：${(lastMsg.content as string).slice(0, 50)}`);

    const ok = toolMsg?.name === "calculator"
      && (toolMsg.content as string).includes("555")
      && lastMsg._getType() === "ai"
      && (lastMsg.content as string).includes("555");
    console.log(`  ${ok ? "✓" : "✗"} 批准后工具执行，LLM 基于结果回答`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试4：拒绝路径 —— 工具不执行，流程结束 ----
  {
    total++;
    console.log("▶ 测试4：拒绝路径（Command resume 'reject'）");

    const cfg = threadConfig("test-reject");
    await app.invoke({ messages: [new HumanMessage("计算 15 * 37 等于多少？")] }, cfg);
    const resumed = await app.invoke(new Command({ resume: "reject" }), cfg);

    const hasToolMsg = resumed.messages.some((m: BaseMessage) => m._getType() === "tool");
    const state = await app.getState(cfg);

    console.log(`  包含 ToolMessage：${hasToolMsg ? "是" : "否"}（预期否）`);
    console.log(`  getState().next = ${JSON.stringify(state.next)}（图已结束，应为空）`);

    const ok = !hasToolMsg && state.next.length === 0;
    console.log(`  ${ok ? "✓" : "✗"} 拒绝后工具未执行，流程直接结束`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试5：无工具调用时不触发审批 ----
  {
    total++;
    console.log("▶ 测试5：无工具调用（直接回答，不触发审批）");
    console.log("  输入：'你好'");

    const result = await app.invoke(
      { messages: [new HumanMessage("你好")] },
      threadConfig("test-no-tool"),
    );

    const state = await app.getState(threadConfig("test-no-tool"));
    const hasInterrupt = state.next.length > 0;
    const lastMsg = result.messages.at(-1)!;

    console.log(`  图被冻结（next 非空）：${hasInterrupt ? "是" : "否"}（预期否）`);
    console.log(`  消息数：${result.messages.length}（预期 2）`);

    const ok = !hasInterrupt && result.messages.length === 2 && lastMsg._getType() === "ai";
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  interrupt 冻结/恢复机制正确");
    console.log("  批准路径：Command resume → 工具执行 → LLM 回答");
    console.log("  拒绝路径：工具不执行 → 流程结束");
    console.log("  无工具调用时不触发审批");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:06 体验真实审批流程\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
