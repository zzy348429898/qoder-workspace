/**
 * 验证脚本：不需要 API Key，用 Mock 模拟多智能体对话协作
 *
 * 运行：pnpm verify:11  或  npx tsx src/verify.ts
 *
 * 验证内容：
 *   1. 对话协作：pm ⇄ dev 按最后发言者交替接管
 *   2. name 标记正确标识发言者
 *   3. 轮数上限：达到 MAX_AGENT_TURNS 后结束
 *   4. 层级模式：顶层图经 dev_team 子图执行，子图内部轨迹可见
 */

import { StateGraph, START, END, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 1. 图1：双 Agent 对话协作（Mock 版本）
// ============================================================================

const MAX_AGENT_TURNS = 6;

/** 协作图 State：turnCount 为子图私有字段，避免外层 name 消息污染轮次统计 */
const CollabAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  turnCount: Annotation<number>({ reducer: (c, u) => c + u, default: () => 0 }),
});

function makeMockAgentNode(name: string, line: string) {
  return async (state: typeof CollabAnnotation.State) => {
    const turn = state.messages.filter((m) => (m as AIMessage).name === name).length + 1;
    return { messages: [new AIMessage({ content: `[${name} 第${turn}次发言] ${line}`, name })], turnCount: 1 };
  };
}

/** 与 index.ts 相同的协作路由：最后发言者轮换；达到上限结束 */
function routeCollaboration(state: typeof CollabAnnotation.State): "pm" | "dev" | typeof END {
  if (state.turnCount >= MAX_AGENT_TURNS) return END;
  const lastNamed = [...state.messages].reverse().find((m) => (m as AIMessage).name) as AIMessage | undefined;
  return lastNamed?.name === "pm" ? "dev" : "pm";
}

const collabGraph = new StateGraph(CollabAnnotation)
  .addNode("pm", makeMockAgentNode("pm", "这是需求/追问/验收"))
  .addNode("dev", makeMockAgentNode("dev", "这是方案/答疑"))
  .addEdge(START, "pm")
  .addConditionalEdges("pm", routeCollaboration, ["dev", END])
  .addConditionalEdges("dev", routeCollaboration, ["pm", END])
  .compile();

// ============================================================================
// 2. 图2：层级模式（Mock 版本）
// ============================================================================

const hierarchyApp = new StateGraph(MessagesAnnotation)
  .addNode("boss_kickoff", async () => ({
    messages: [new AIMessage({ content: "[boss] 布置任务", name: "boss" })],
  }))
  .addNode("dev_team", collabGraph)
  .addNode("boss_wrapup", async () => ({
    messages: [new AIMessage({ content: "[boss] 最终决策", name: "boss" })],
  }))
  .addEdge(START, "boss_kickoff")
  .addEdge("boss_kickoff", "dev_team")
  .addEdge("dev_team", "boss_wrapup")
  .addEdge("boss_wrapup", END)
  .compile();

// ============================================================================
// 3. 验证测试
// ============================================================================

async function runTests() {
  console.log("\n╔" + "═".repeat(60) + "╗");
  console.log("║  LangGraph.js 项目11 验证测试（Mock 模式）".padEnd(56) + "║");
  console.log("║  主题：多智能体协作".padEnd(56) + "║");
  console.log("╚" + "═".repeat(60) + "╝\n");

  let passed = 0;
  let total = 0;

  // ---- 图结构可视化 ----
  console.log("▶ 图结构可视化（层级图）");
  const mermaidStr = hierarchyApp.getGraph().drawMermaid();
  console.log("\n  Mermaid 图表：");
  console.log(mermaidStr.split("\n").map((line) => `  ${line}`).join("\n"));
  fs.writeFileSync(path.join(process.cwd(), "graph.mmd"), mermaidStr, "utf-8");
  console.log(`\n  Mermaid 文本已保存到：${path.join(process.cwd(), "graph.mmd")}`);
  try {
    const pngBlob = await hierarchyApp.getGraph().drawMermaidPng();
    fs.writeFileSync(path.join(process.cwd(), "graph.png"), Buffer.from(await pngBlob.arrayBuffer()));
    console.log(`  PNG 图片已保存到：${path.join(process.cwd(), "graph.png")}`);
  } catch {
    console.log(`  ⚠️  PNG 生成失败（需要网络连接）`);
  }
  console.log();

  // ---- 测试0：对话交替（pm ⇄ dev 轮流发言）----
  let collabResult: typeof CollabAnnotation.State | null = null;
  {
    total++;
    console.log("▶ 测试0：对话交替（pm ⇄ dev）");

    const streamResult = await collabGraph.stream({ messages: [new HumanMessage("做个关键词统计工具")] });
    const nodes: string[] = [];
    for await (const chunk of streamResult) nodes.push(Object.keys(chunk)[0]);

    collabResult = await collabGraph.invoke({ messages: [new HumanMessage("做个关键词统计工具")] });

    console.log(`  节点轨迹：${nodes.join(" → ")}`);
    const expected = "pm,dev,pm,dev,pm,dev";
    const ok = nodes.join(",") === expected;
    console.log(`  期望轨迹：${expected.split(",").join(" → ")}`);
    console.log(`  ${ok ? "✓" : "✗"} 严格按最后发言者交替`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试1：name 标记与轮数上限 ----
  {
    total++;
    console.log("▶ 测试1：name 标记与轮数上限");

    const agentMsgs = collabResult!.messages.filter((m: BaseMessage) => (m as AIMessage).name);
    const names = agentMsgs.map((m: BaseMessage) => (m as AIMessage).name);

    console.log(`  Agent 发言数：${agentMsgs.length}（预期 ${MAX_AGENT_TURNS}，达到上限自动结束）`);
    console.log(`  发言序列：${names.join(" → ")}`);
    console.log(`  首发为 pm：${names[0] === "pm" ? "是" : "否"}`);
    console.log(`  末次为 dev：${names.at(-1) === "dev" ? "是" : "否"}`);

    const ok = agentMsgs.length === MAX_AGENT_TURNS
      && names[0] === "pm"
      && names.every((n, i) => n === (i % 2 === 0 ? "pm" : "dev"));
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试2：层级模式 —— 顶层经子图执行，子图内部轨迹可见 ----
  {
    total++;
    console.log("▶ 测试2：层级模式（subgraphs: true 观察完整轨迹）");

    const streamResult = await hierarchyApp.stream(
      { messages: [new HumanMessage("给客户做演示")] },
      { subgraphs: true },
    );

    const topNodes: string[] = [];
    const subNodes: string[] = [];
    for await (const [namespace, chunk] of streamResult) {
      const nodeName = Object.keys(chunk)[0];
      if (namespace.length > 0) subNodes.push(nodeName);
      else topNodes.push(nodeName);
    }

    console.log(`  顶层节点：${topNodes.join(" → ")}`);
    console.log(`  子图内部：${subNodes.join(" → ")}`);

    const ok = topNodes.join(",") === "boss_kickoff,dev_team,boss_wrapup"
      && subNodes.join(",") === "pm,dev,pm,dev,pm,dev";
    console.log(`  ${ok ? "✓" : "✗"} boss → dev_team(pm⇄dev) → boss 层级执行正确`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 测试3：层级模式端到端消息流（消息在层级间传递）----
  {
    total++;
    console.log("▶ 测试3：层级模式端到端消息流");

    const result = await hierarchyApp.invoke({ messages: [new HumanMessage("给客户做演示")] });
    const names = result.messages
      .filter((m: BaseMessage) => (m as AIMessage).name)
      .map((m: BaseMessage) => (m as AIMessage).name);

    console.log(`  发言者序列：${names.join(" → ")}`);

    // boss 开场 → 子团队 pm/dev 交替 6 次 → boss 收尾
    const ok = names[0] === "boss"
      && names.at(-1) === "boss"
      && names.slice(1, -1).filter((n) => n === "pm").length === 3
      && names.slice(1, -1).filter((n) => n === "dev").length === 3;
    console.log(`  ${ok ? "✓" : "✗"} 消息在顶层与子图间完整传递`);
    console.log(`  ${ok ? "✓" : "✗"} 测试${ok ? "通过" : "失败"}\n`);
    if (ok) passed++;
  }

  // ---- 总结 ----
  console.log("═".repeat(62));
  console.log(`  测试结果：${passed}/${total} 通过`);
  if (passed === total) {
    console.log("  ✅ 全部验证测试通过！");
    console.log("  协作模式正确：按最后发言者交替接管，无中心调度");
    console.log("  name 标记正确：消息来源全程可追踪");
    console.log("  轮数上限正确：达到 MAX_AGENT_TURNS 自动结束");
    console.log("  层级模式正确：子团队图作为顶层节点，轨迹全程可见");
  } else {
    console.log(`  ⚠️ 有 ${total - passed} 个测试未通过`);
  }
  console.log("═".repeat(62));
  console.log("\n  下一步：设置 ANTHROPIC_API_KEY 后运行 pnpm start:11 体验真实 Agent 对话\n");
}

runTests().catch((err) => {
  console.error("❌ 测试失败：", err);
  process.exit(1);
});
