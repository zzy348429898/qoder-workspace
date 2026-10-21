---
name: claude-style-ppt
description: Generate a Claude-design-style HTML slide deck presentation from a markdown document or content. Produces a self-contained HTML file with warm terracotta-orange theme, left sidebar navigation, HTML/CSS flowchart diagrams (no mermaid), collapsible Q&A, and keyboard/touch navigation. Use when the user asks to create a PPT, presentation, slide deck, or HTML presentation from a markdown file or document content.
---

# Claude-Style HTML Presentation Generator

Generate a **self-contained HTML slide deck** that replaces PPT, using Claude's warm design language. No external dependencies (no Mermaid, no frameworks) — pure HTML/CSS/JS in one file.

## Design Tokens

```css
:root {
  --bg: #F4F3EE;        /* 奶油米白背景 */
  --card: #FFFFFF;       /* 卡片白 */
  --primary: #C15F3C;    /* 陶土橙（主品牌色） */
  --accent: #D97757;     /* 橙色强调 */
  --text: #141413;       /* 近黑文字 */
  --sub: #6B6A65;        /* 次级灰 */
  --border: #E8E6DC;     /* 暖灰边框 */
  --blue: #6A9BCC;       /* 蓝色辅助 */
  --green: #788C5D;      /* 绿色辅助 */
  --code-bg: #1C1A17;    /* 代码块暗色底 */
  --shadow: 0 2px 16px rgba(193, 95, 60, 0.07);
  --r: 14px; --rs: 8px;
}
```

Fonts: **Poppins** (headings) + **Lora** (body) + **JetBrains Mono** (code). Load from Google Fonts.

## Architecture

```
sidebar (240px fixed left)
└── deck (margin-left: 240px)
    └── slide × N (position: absolute, only .active visible)
        └── slide-content (max-width: 920px, scrollable)
```

Key layout offsets: `.deck` margin-left 240px, `.progress-bar` left 240px, `.nav` left calc(50% + 120px).

## Component Catalog

| Component | Class | Purpose |
|---|---|---|
| Part badge | `.part-badge` | 小圆角标签，标注当前 Part 主题，如 `Part 0 · 概念基础` |
| Section divider | `.slide.section-divider` | 全屏陶土橙背景的章节分隔页 |
| Title slide | `.title-slide` | 居中大标题 + 副标题 + app 卡片列表 |
| Question cards | `.q-cards > .q-card` | 编号问题卡片，左侧陶土橙边框 |
| Table | `.tbl` | 陶土橙表头 + 斑马纹 + hover 效果 |
| Code block | `pre.code` + spans `.cm/.kw/.st/.fn/.pn` | 暗色底代码块，手动语法高亮 |
| Callout | `.callout` / `.callout-blue` / `.callout-green` | 左边框强调框 |
| Info cards | `.cards.cards-2/3 > .info-card` | 网格卡片，可放 icon |
| Collapsible Q&A | `details.qa > summary + .qa-body` | 默认折叠，点击展开，旋转箭头 |
| Phase flow | `.phase-flow > .phase-item` | 水平流程药丸 |
| Tags | `.tag.tag-primary/blue/green/gray` | 小标签 |
| Steps | `.steps > .step-pill + .step-arrow` | 步骤流 |
| Highlight text | `.hl` / `.hl-blue` / `.hl-green` | 行内高亮 |

## HTML/CSS Flowchart System (No Mermaid)

**禁止使用 Mermaid 或任何图表库。** 全部用 HTML/CSS flexbox 手绘。

### Node Types

| Class | Style | 用途 |
|---|---|---|
| `.flow-node` | 白底圆角卡片 | 普通节点 |
| `.flow-node-sm` | 小号卡片 | 紧凑图表 |
| `.flow-node-start` | 绿色圆角药丸 | 起始节点 |
| `.flow-node-end` | 陶土橙圆角药丸 | 结束节点 |
| `.flow-node-highlight` | 橙色边框 | 高亮节点 |
| `.flow-node-decision` | 蓝色边框 | 判断节点 |

### Layout Classes

| Class | Direction | 用途 |
|---|---|---|
| `.flow-v` / `.flow-v-sm` | 垂直 | 从上到下流程 |
| `.flow-h` / `.flow-h-sm` | 水平 | 从左到右流程 |
| `.flow-branch` + `.flow-branch-col` | 分支 | if/else 分叉 |
| `.flow-pairs` + `.flow-pair` | 对照 | 左右对比（如差距总览） |
| `.flow-connector` | 连接器 | 带标签的箭头（如 `emit →`） |

### Arrows

- 水平箭头: `<span class="flow-arrow">→</span>`
- 垂直箭头: `<div class="flow-arrow-d">↓</div>`
- 带标签连接: `<div class="flow-connector"><div class="flow-label">emit →</div></div>`

### 常见图表模式

**线性流程**: `.flow-v` 内嵌 `.flow-node` + `.flow-arrow-d`

**循环流程**: 线性流程 + `.flow-branch` 分叉，一支用 `↺ 回到` 表示回环

**水平流水线**: `.flow-h` 内嵌 node + connector 交替

**左右对照**: `.flow-pairs` 内多个 `.flow-pair`（grid: 1fr 30px 1fr）

**树形分叉**: `.flow-v` → `.flow-h` 内放多个子节点 → 回到 `.flow-v`

详细 CSS 和 HTML 模板见 [reference.md](reference.md)。

## Sidebar Navigation (Collapsible, Default Collapsed)

左侧 240px 固定导航栏，按 Part 分组。**默认折叠**，点击切换按钮展开/收起。

```html
<body class="collapsed"> <!-- 默认折叠 -->
<div class="sidebar">
  <div class="sidebar-header">📋 标题</div>
  <div class="sidebar-section">Part 0 · 主题</div>
  <div class="sidebar-item" data-slide="0" onclick="showSlide(0)">页面名</div>
  ...
</div>
<div class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()">▶</div>
```

折叠时：sidebar 滑出屏幕，主内容区占满全宽，切换按钮移至左边缘显示 `▶`。
展开时：sidebar 滑入，主内容区右移 240px，切换按钮显示 `◀`。

CSS 关键规则：
- `.sidebar` + `transition: transform 0.3s ease`
- `.deck` / `.progress-bar` / `.nav` + `transition: left/margin 0.3s ease`
- `.sidebar-toggle` 固定在 sidebar 右边缘，`transition: left 0.3s ease`
- `body.collapsed .sidebar { transform: translateX(-240px); }`
- `body.collapsed .deck { margin-left: 0; width: 100vw; }`
- `body.collapsed .nav { left: 50%; }`

JS 中 `toggleSidebar()` 切换 `body.collapsed` class，`updateUI()` 同步高亮当前页。

## Navigation JS

- 键盘: ←→ / Space / PageUp/Down / Home/End
- 触屏: 左右滑动
- 底部导航按钮 + 进度条 + 页码

完整 JS 代码见 [reference.md](reference.md)。

## Workflow

### 1. 分析源文档
- 识别 Part/章节结构 → 规划幻灯片数量（通常 25-35 页）
- 提取标题、表格、代码、图表、Q&A
- 移除所有代码链接（`file:///` 等）

### 2. 规划幻灯片
- 每个幻灯片一个主题，内容过多则拆分
- Part 之间插入 `.section-divider` 分隔页
- 为每个 Part 确定主题词（如"概念基础"、"基本版实现"）

### 3. 生成 HTML
- 写入完整 `<head>`（meta、fonts、CSS）
- 生成 sidebar（按 Part 分 section，每页一个 item）
- 逐页生成 slide HTML
- Part badge 格式: `Part X · 主题词` 或 `Part X · 主题词 · 子题`
- 大文件分批 `create_file` + `append`

### 4. 替换图表
- 将源文档中的 mermaid/图表描述转为 HTML/CSS flowchart
- 线性→`.flow-v`，水平→`.flow-h`，分叉→`.flow-branch`，对照→`.flow-pairs`

### 5. Q&A 折叠
- 使用 `<details class="qa">` + `<summary>` + `<div class="qa-body">`
- 默认折叠（不加 `open` 属性）

### 6. 导航 JS
- 复制 reference.md 中的完整 JS 代码
- 确认 `showSlide(0)` 在末尾调用

### 7. 验证
- 幻灯片数量与 sidebar item 数量一致
- 无 mermaid 残留
- 文件以 `</html>` 正确闭合
- 浏览器打开验证

## Key Rules

1. **零外部依赖** — 不用 Mermaid / 不用任何 JS 库 / 不用 CDN（仅 Google Fonts）
2. **图表全手绘** — 所有流程图用 HTML/CSS flowchart 系统
3. **Q&A 默认折叠** — `<details>` 不加 `open`
4. **代码链接移除** — 源文档中的 `[text](file:///...)` 只保留 text
5. **Part badge 带主题** — 每个 badge 包含 `Part X · 主题词`，有子题则追加
6. **侧边栏分组** — 按 Part 分 section，当前页高亮 + 自动滚动
7. **单文件输出** — 所有 CSS/JS 内联，一个 .html 文件搞定
