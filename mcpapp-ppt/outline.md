# 灵基 MCP App 功能介绍 · PPT 大纲

> 受众：研发 / 产品 / 技术负责人
> 主线：为什么需要 → 是什么 → 能做什么 → 落地案例 → 怎么开发上架
> 素材：`abi-skills/mcpapps` 下的主题澄清组件 + lingee-mcpapps-guide 开发规范

## Part 0 · 开篇
1. **封面**：灵基 MCP App，让对话里长出可交互的界面
2. **纯文本对话的三个局限**：选项靠打字回复、图表 JSON 挤占上下文、复杂交互无从表达

## Part 1 · 概念与架构
3. 分隔页
4. **MCP App 是什么**：沙箱 iframe 里的静态前端 + AppBridge 双向通信 + 虚拟入口工具
5. **运行架构（泳道时序图）**：模型 / 宿主 / App / 工具层，①~⑨ 一次完整调用
6. **一次调用的生命周期**：握手 → hostContext → ontoolinput → 渲染/交互 → 回传/落库 → teardown
7. **三件交付物，一个 appCode**：info.json / dist / SKILL.md
8. **智能体 / Skill / MCP App / 连接器的关系**：智能体绑定连接器、关联 skill → skill 关联 MCP App → MCP App 关联连接器工具

## Part 2 · 能力全景
9. 分隔页
10. **宿主 → App 回调**
11. **hostContext**
12. **App → 宿主出站能力**
13. **平台工具集 platform_\***
14. **两种 runMode**
15. **安全与边界**

## Part 3 · 案例：主题澄清组件
16. 分隔页
17. **业务场景**：评分四档 + 三段式决策
18. **界面与交互**：卡片 UI 示意 + 选中 / 失败 / 都不是
19. **数据流**：selectSubjects → 调组件 → 用户点选 → updateModelContext → 模型继续查数
20. **info.json 与入参契约**

## Part 4 · 落地
21. 分隔页
22. **开发流程**
23. **我们的交付流水线**
24. **踩坑清单 Top 10**
25. **Q&A**（折叠）
26. **目前上线前的问题**：新版流水线跑不通；私有化环境只有 XH / XK 其中一个
