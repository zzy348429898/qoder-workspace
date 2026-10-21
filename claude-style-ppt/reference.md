# Claude-Style PPT — Complete Reference

All CSS, HTML templates, and JS code for generating a Claude-design-style HTML slide deck.

## HTML Head Template

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[TITLE]</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* CSS goes here */
</style>
</head>
<body>
<!-- Sidebar -->
<!-- Progress bar -->
<!-- Slide deck -->
<!-- Navigation -->
<!-- Script -->
</body>
</html>
```

## Complete CSS

```css
:root {
  --bg: #F4F3EE; --card: #FFFFFF; --primary: #C15F3C; --accent: #D97757;
  --text: #141413; --sub: #6B6A65; --border: #E8E6DC; --blue: #6A9BCC;
  --green: #788C5D; --code-bg: #1C1A17; --code-text: #E8E6DC;
  --shadow: 0 2px 16px rgba(193, 95, 60, 0.07);
  --shadow-md: 0 4px 24px rgba(193, 95, 60, 0.10);
  --r: 14px; --rs: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Lora', Georgia, serif; background: var(--bg); color: var(--text); overflow: hidden; height: 100vh; -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4 { font-family: 'Poppins', Arial, sans-serif; font-weight: 600; line-height: 1.3; }

/* Progress bar */
.progress-bar { position: fixed; top: 0; left: 240px; right: 0; height: 4px; background: var(--border); z-index: 100; transition: left 0.3s ease; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent)); transition: width 0.4s ease; width: 0%; }

/* Deck */
.deck { position: relative; height: 100vh; width: calc(100vw - 240px); margin-left: 240px; transition: margin-left 0.3s ease, width 0.3s ease; }
.slide { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 50px 70px; opacity: 0; transition: opacity 0.45s ease; }
.slide.active { display: flex; opacity: 1; }
.slide-content { max-width: 920px; width: 100%; max-height: calc(100vh - 100px); overflow-y: auto; padding-right: 8px; }
.slide-content::-webkit-scrollbar { width: 6px; }
.slide-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Typography */
.part-badge { display: inline-block; background: var(--primary); color: #fff; padding: 5px 16px; border-radius: 20px; font-family: 'Poppins', sans-serif; font-size: 0.78rem; font-weight: 500; margin-bottom: 14px; letter-spacing: 0.5px; }
.slide-title { font-size: 2rem; margin-bottom: 6px; color: var(--text); }
.slide-subtitle { font-size: 1rem; color: var(--sub); margin-bottom: 28px; font-style: italic; }
.section-divider { background: var(--primary); }
.section-divider .slide-content { text-align: center; color: #fff; }
.section-divider h1 { font-size: 2.8rem; color: #fff; margin-bottom: 12px; }
.section-divider .part-badge { background: rgba(255,255,255,0.2); color: #fff; }
.section-divider p { color: rgba(255,255,255,0.85); font-size: 1.15rem; }

/* Title slide */
.title-slide { text-align: center; }
.hero-title { font-size: 3rem; font-weight: 700; margin-bottom: 12px; color: var(--text); }
.subtitle { font-size: 1.2rem; color: var(--sub); font-style: italic; margin-bottom: 36px; }
.app-list { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.app-card { background: var(--card); border-radius: var(--r); padding: 18px 22px; box-shadow: var(--shadow); text-align: left; min-width: 200px; border: 1px solid var(--border); }
.app-card strong { display: block; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--primary); margin-bottom: 4px; }
.app-card span { font-size: 0.85rem; color: var(--sub); }

/* Question cards */
.q-cards { display: flex; gap: 20px; margin-bottom: 30px; }
.q-card { flex: 1; background: var(--card); border-radius: var(--r); padding: 28px; box-shadow: var(--shadow); border-left: 4px solid var(--primary); border: 1px solid var(--border); }
.q-card .q-num { font-family: 'Poppins', sans-serif; font-size: 2.5rem; font-weight: 700; color: var(--accent); margin-bottom: 8px; }
.q-card p { font-size: 1.1rem; line-height: 1.6; }
.time-tags { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.time-tags span { background: var(--bg); border: 1px solid var(--border); padding: 5px 14px; border-radius: 20px; font-size: 0.82rem; color: var(--sub); font-family: 'Poppins', sans-serif; }

/* Tables */
.tbl { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.88rem; }
.tbl th { background: var(--primary); color: #fff; padding: 10px 14px; text-align: left; font-family: 'Poppins', sans-serif; font-weight: 500; font-size: 0.82rem; }
.tbl td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; line-height: 1.5; }
.tbl tr:nth-child(even) td { background: rgba(244, 243, 238, 0.5); }
.tbl tr:hover td { background: rgba(217, 119, 87, 0.04); }
.tbl code { font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; background: var(--bg); padding: 1px 6px; border-radius: 4px; color: var(--primary); }

/* Code blocks */
pre.code { background: var(--code-bg); color: var(--code-text); border-radius: var(--rs); padding: 18px 22px; overflow-x: auto; margin: 14px 0; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; line-height: 1.65; border: 1px solid #2a2724; }
pre.code .cm { color: #7a7568; }
pre.code .kw { color: #D97757; }
pre.code .st { color: #788C5D; }
pre.code .fn { color: #6A9BCC; }
pre.code .pn { color: #C15F3C; }
.code-label { font-family: 'Poppins', sans-serif; font-size: 0.75rem; color: var(--sub); margin-bottom: -8px; margin-top: 12px; font-weight: 500; }

/* Callout */
.callout { background: rgba(217, 119, 87, 0.06); border-left: 3px solid var(--accent); border-radius: 0 var(--rs) var(--rs) 0; padding: 14px 20px; margin: 16px 0; font-size: 0.92rem; line-height: 1.6; color: var(--text); }
.callout strong { color: var(--primary); }
.callout-blue { background: rgba(106, 155, 204, 0.07); border-left-color: var(--blue); }
.callout-blue strong { color: var(--blue); }
.callout-green { background: rgba(120, 140, 93, 0.07); border-left-color: var(--green); }
.callout-green strong { color: var(--green); }

/* Cards grid */
.cards { display: grid; gap: 16px; margin: 16px 0; }
.cards-2 { grid-template-columns: 1fr 1fr; }
.cards-3 { grid-template-columns: 1fr 1fr 1fr; }
.info-card { background: var(--card); border-radius: var(--r); padding: 20px; box-shadow: var(--shadow); border: 1px solid var(--border); }
.info-card h4 { font-size: 0.95rem; color: var(--primary); margin-bottom: 8px; }
.info-card p { font-size: 0.85rem; color: var(--sub); line-height: 1.55; }
.info-card .card-icon { font-size: 1.5rem; margin-bottom: 8px; display: block; }

/* Collapsible Q&A */
details.qa { background: var(--card); border-radius: var(--rs); margin: 12px 0; border: 1px solid var(--border); overflow: hidden; box-shadow: var(--shadow); }
details.qa summary { padding: 16px 22px; cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 500; font-size: 0.95rem; color: var(--text); list-style: none; display: flex; align-items: center; gap: 10px; transition: background 0.2s; }
details.qa summary::-webkit-details-marker { display: none; }
details.qa summary::before { content: '▶'; font-size: 0.7rem; color: var(--accent); transition: transform 0.25s ease; }
details.qa[open] summary::before { transform: rotate(90deg); }
details.qa summary:hover { background: rgba(217, 119, 87, 0.04); }
details.qa .qa-body { padding: 0 22px 18px 22px; font-size: 0.88rem; line-height: 1.7; color: var(--sub); }
details.qa .qa-body p { margin-bottom: 10px; }
details.qa .qa-body strong { color: var(--primary); }

/* Steps flow */
.steps { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.step-pill { background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 8px 18px; font-size: 0.85rem; font-family: 'Poppins', sans-serif; color: var(--text); box-shadow: var(--shadow); }
.step-arrow { color: var(--accent); font-size: 1.2rem; }

/* Badge tags */
.tag { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; font-family: 'Poppins', sans-serif; font-weight: 500; }
.tag-primary { background: rgba(193, 95, 60, 0.1); color: var(--primary); }
.tag-blue { background: rgba(106, 155, 204, 0.12); color: var(--blue); }
.tag-green { background: rgba(120, 140, 93, 0.12); color: var(--green); }
.tag-gray { background: var(--bg); color: var(--sub); border: 1px solid var(--border); }

/* Navigation */
.nav { position: fixed; bottom: 24px; left: calc(50% + 120px); transform: translateX(-50%); transition: left 0.3s ease; display: flex; align-items: center; gap: 16px; z-index: 100; background: var(--card); padding: 8px 16px; border-radius: 30px; box-shadow: var(--shadow-md); border: 1px solid var(--border); }
.nav button { border: none; background: var(--primary); color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: background 0.2s, transform 0.15s; }
.nav button:hover { background: var(--accent); transform: scale(1.08); }
.nav button:disabled { background: var(--border); color: var(--sub); cursor: not-allowed; transform: none; }
.nav .counter { font-family: 'Poppins', sans-serif; font-size: 0.85rem; color: var(--sub); min-width: 60px; text-align: center; }

/* Slide number */
.slide-num { position: fixed; top: 16px; right: 24px; font-family: 'Poppins', sans-serif; font-size: 0.78rem; color: var(--sub); z-index: 100; }

/* Inline code */
code.inline { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; background: var(--bg); padding: 2px 7px; border-radius: 4px; color: var(--primary); border: 1px solid var(--border); }

/* List */
ul.clean { list-style: none; padding: 0; }
ul.clean li { padding: 6px 0 6px 22px; position: relative; font-size: 0.9rem; line-height: 1.6; }
ul.clean li::before { content: '▸'; position: absolute; left: 0; color: var(--accent); font-weight: bold; }

/* Highlight text */
.hl { color: var(--primary); font-weight: 600; }
.hl-blue { color: var(--blue); font-weight: 600; }
.hl-green { color: var(--green); font-weight: 600; }

/* Phase flow */
.phase-flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 18px 0; justify-content: center; }
.phase-item { background: var(--card); border: 1px solid var(--border); border-radius: var(--rs); padding: 10px 16px; font-size: 0.82rem; font-family: 'Poppins', sans-serif; box-shadow: var(--shadow); }
.phase-item.active-phase { border-color: var(--primary); color: var(--primary); font-weight: 600; }

/* Sidebar */
.sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 240px; background: var(--card); border-right: 1px solid var(--border); overflow-y: auto; z-index: 200; box-shadow: 2px 0 16px rgba(0,0,0,0.04); transition: transform 0.3s ease; }
.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.sidebar-header { padding: 18px 20px 14px; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 0.92rem; color: var(--primary); border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--card); z-index: 1; }
.sidebar-section { padding: 12px 20px 4px; font-family: 'Poppins', sans-serif; font-size: 0.66rem; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: 0.6px; }
.sidebar-item { padding: 7px 20px 7px 28px; font-size: 0.8rem; cursor: pointer; color: var(--sub); transition: all 0.15s; border-left: 3px solid transparent; font-family: 'Lora', serif; line-height: 1.4; }
.sidebar-item:hover { background: rgba(217,119,87,0.04); color: var(--text); }
.sidebar-item.active { background: rgba(217,119,87,0.08); color: var(--primary); border-left-color: var(--primary); font-weight: 600; }

/* Sidebar toggle */
.sidebar-toggle { position: fixed; left: 240px; top: 50%; transform: translateY(-50%); z-index: 201; width: 20px; height: 48px; background: var(--card); border: 1px solid var(--border); border-left: none; border-radius: 0 6px 6px 0; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--primary); box-shadow: 2px 1px 8px rgba(0,0,0,0.06); transition: left 0.3s ease; }
.sidebar-toggle:hover { background: var(--bg); color: var(--accent); }

/* Collapsed state (default) */
body.collapsed .sidebar { transform: translateX(-240px); }
body.collapsed .sidebar-toggle { left: 0; }
body.collapsed .deck { margin-left: 0; width: 100vw; }
body.collapsed .progress-bar { left: 0; }
body.collapsed .nav { left: 50%; }

/* HTML Diagrams */
.diagram { margin: 16px 0; display: flex; justify-content: center; }
.flow-v { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.flow-h { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }
.flow-v-sm { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.flow-h-sm { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; }
.flow-node { background: var(--card); border: 1.5px solid var(--border); border-radius: 8px; padding: 10px 18px; font-family: 'Poppins', sans-serif; font-size: 0.82rem; box-shadow: 0 1px 6px rgba(193,95,60,0.05); text-align: center; color: var(--text); min-width: 80px; }
.flow-node-sm { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-family: 'Poppins', sans-serif; font-size: 0.74rem; box-shadow: 0 1px 4px rgba(193,95,60,0.04); text-align: center; color: var(--text); }
.flow-node-start { border-radius: 20px; background: rgba(120,140,93,0.1); border-color: var(--green); color: var(--green); }
.flow-node-end { border-radius: 20px; background: rgba(193,95,60,0.08); border-color: var(--primary); color: var(--primary); }
.flow-node-highlight { border-color: var(--accent); }
.flow-node-decision { border-radius: 8px; background: rgba(106,155,204,0.08); border-color: var(--blue); color: var(--blue); font-weight: 500; min-width: 100px; }
.flow-arrow { color: var(--accent); font-size: 1.1rem; font-weight: bold; padding: 0 2px; }
.flow-arrow-d { color: var(--accent); font-size: 1rem; line-height: 1; }
.flow-label { font-size: 0.7rem; color: var(--sub); font-family: 'Poppins', sans-serif; text-align: center; }
.flow-connector { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0 4px; }
.flow-branch { display: flex; gap: 40px; justify-content: center; margin: 4px 0; }
.flow-branch-col { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.flow-pairs { display: flex; flex-direction: column; gap: 5px; width: 100%; max-width: 680px; }
.flow-pair { display: grid; grid-template-columns: 1fr 30px 1fr; gap: 8px; align-items: center; }
.flow-pair .flow-arrow { text-align: center; }
```

## Sidebar Template (Collapsible, Default Collapsed)

```html
<body class="collapsed"> <!-- 默认折叠 -->
<div class="sidebar" id="sidebar">
  <div class="sidebar-header">📋 [标题]</div>
  <div class="sidebar-section">Part 0 · [主题]</div>
  <div class="sidebar-item" data-slide="0" onclick="showSlide(0)">[页面名]</div>
  <div class="sidebar-item" data-slide="1" onclick="showSlide(1)">[页面名]</div>
  <div class="sidebar-section">Part 1 · [主题]</div>
  <div class="sidebar-item" data-slide="N" onclick="showSlide(N)">[页面名]</div>
  ...
</div>
<div class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()">▶</div>
<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
<div class="slide-num" id="slideNum"></div>
```

## Slide Templates

### Title Slide
```html
<div class="slide active">
  <div class="slide-content title-slide">
    <div class="part-badge">技术分享</div>
    <h1 class="hero-title">[标题]</h1>
    <p class="subtitle">[副标题]</p>
    <div class="app-list">
      <div class="app-card"><strong>[app名]</strong><span>[描述]</span></div>
    </div>
  </div>
</div>
```

### Content Slide
```html
<div class="slide">
  <div class="slide-content">
    <div class="part-badge">Part X · 主题词 · 子题</div>
    <h2 class="slide-title">[标题]</h2>
    <p class="slide-subtitle">[副标题]</p>
    <!-- 内容：tables, code, callouts, cards, diagrams -->
  </div>
</div>
```

### Section Divider
```html
<div class="slide section-divider">
  <div class="slide-content">
    <div class="part-badge">PART X · 主题词</div>
    <h1>[Part 标题]</h1>
    <p>[Part 描述]</p>
  </div>
</div>
```

### Q&A Slide (Collapsible)
```html
<div class="slide">
  <div class="slide-content">
    <div class="part-badge">Part X · 主题词 · Q&A</div>
    <h2 class="slide-title">[标题]</h2>
    <p class="slide-subtitle">点击展开查看回答</p>
    <details class="qa">
      <summary>Q1：[问题]</summary>
      <div class="qa-body">
        <p>[回答段落1]</p>
        <p><strong>[要点]</strong> [详细说明]</p>
      </div>
    </details>
    <details class="qa">
      <summary>Q2：[问题]</summary>
      <div class="qa-body">
        <p>[回答]</p>
      </div>
    </details>
  </div>
</div>
```

## Flowchart Templates

### Vertical Linear Flow
```html
<div class="diagram">
  <div class="flow-v">
    <div class="flow-node flow-node-start">开始</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node">步骤一</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node flow-node-highlight">步骤二（高亮）</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node flow-node-end">结束</div>
  </div>
</div>
```

### Vertical Flow with Branch (Loop)
```html
<div class="diagram">
  <div class="flow-v">
    <div class="flow-node">主流程</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node flow-node-decision">判断?</div>
    <div class="flow-branch">
      <div class="flow-branch-col">
        <div class="flow-label">条件A</div>
        <div class="flow-arrow-d">↓</div>
        <div class="flow-node">分支A</div>
        <div class="flow-arrow-d">↺ 回到起点</div>
      </div>
      <div class="flow-branch-col">
        <div class="flow-label">条件B</div>
        <div class="flow-arrow-d">↓</div>
        <div class="flow-node flow-node-end">结束</div>
      </div>
    </div>
  </div>
</div>
```

### Horizontal Pipeline
```html
<div class="diagram">
  <div class="flow-h">
    <div class="flow-node">节点A</div>
    <div class="flow-connector"><div class="flow-label">动作 →</div></div>
    <div class="flow-node flow-node-highlight">节点B</div>
    <div class="flow-connector"><div class="flow-label">动作 →</div></div>
    <div class="flow-node">节点C</div>
  </div>
</div>
```

### Horizontal with Bidirectional
```html
<div class="diagram">
  <div class="flow-h">
    <div class="flow-node flow-node-start">前端</div>
    <div class="flow-connector">
      <div class="flow-label">请求 →</div>
      <div class="flow-label">← 响应</div>
    </div>
    <div class="flow-node flow-node-highlight">服务端</div>
  </div>
</div>
```

### Left-Right Comparison (Pairs)
```html
<div class="diagram">
  <div class="flow-pairs">
    <div class="flow-pair">
      <div class="flow-node">旧方案A</div>
      <span class="flow-arrow">→</span>
      <div class="flow-node flow-node-highlight">新方案A</div>
    </div>
    <div class="flow-pair">
      <div class="flow-node">旧方案B</div>
      <span class="flow-arrow">→</span>
      <div class="flow-node flow-node-highlight">新方案B</div>
    </div>
  </div>
</div>
```

### Tree / Supervisor Pattern
```html
<div class="diagram">
  <div class="flow-v">
    <div class="flow-node flow-node-start">根节点</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node flow-node-highlight">中间层</div>
    <div class="flow-arrow-d">↓ 分派</div>
    <div class="flow-h">
      <div class="flow-node">子节点A</div>
      <div class="flow-node">子节点B</div>
      <div class="flow-node">子节点C</div>
    </div>
    <div class="flow-arrow-d">↓ 汇总</div>
    <div class="flow-node flow-node-end">最终输出</div>
  </div>
</div>
```

### Compact Vertical (for small cards)
```html
<div class="diagram" style="margin:8px 0">
  <div class="flow-v-sm">
    <div class="flow-node-sm flow-node-start">开始</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node-sm">步骤</div>
    <div class="flow-arrow-d">↓</div>
    <div class="flow-node-sm flow-node-end">结束</div>
  </div>
</div>
```

### Compact Horizontal (for small cards)
```html
<div class="diagram" style="margin:8px 0">
  <div class="flow-h-sm">
    <div class="flow-node-sm">A</div>
    <span class="flow-arrow">→</span>
    <div class="flow-node-sm flow-node-highlight">B</div>
    <span class="flow-arrow">→</span>
    <div class="flow-node-sm flow-node-end">C</div>
  </div>
</div>
```

## Other Component Templates

### Table
```html
<table class="tbl">
  <thead><tr><th>列1</th><th>列2</th></tr></thead>
  <tbody>
    <tr><td><strong>行标</strong></td><td>内容</td></tr>
    <tr><td><span class="tag tag-primary">标签</span></td><td>内容</td></tr>
  </tbody>
</table>
```

### Code Block with Syntax Highlighting
```html
<div class="code-label">请求示例</div>
<pre class="code">{
  <span class="pn">"key"</span>: <span class="st">"value"</span>,
  <span class="pn">"num"</span>: 42,
  <span class="cm">// 注释</span>
  <span class="pn">"fn"</span>: <span class="kw">function</span>() { <span class="kw">return</span> <span class="st">"hello"</span>; }
}</pre>
```

### Callout
```html
<div class="callout">
  <strong>关键：</strong> 这是一个强调框，<code class="inline">code</code> 可以内联。
</div>
<div class="callout callout-blue">蓝色变体</div>
<div class="callout callout-green">绿色变体</div>
```

### Info Cards Grid
```html
<div class="cards cards-3">
  <div class="info-card">
    <span class="card-icon">🛠</span>
    <h4>标题</h4>
    <p>描述文字</p>
  </div>
  <div class="info-card">
    <span class="card-icon">📝</span>
    <h4>标题</h4>
    <p>描述文字</p>
  </div>
</div>
```

### Phase Flow
```html
<div class="phase-flow">
  <div class="phase-item">步骤一</div>
  <span class="step-arrow">→</span>
  <div class="phase-item">步骤二</div>
  <span class="step-arrow">→</span>
  <div class="phase-item active-phase">步骤三（当前）</div>
</div>
```

## Navigation UI + JavaScript

```html
<!-- Navigation -->
<div class="nav">
  <button id="prevBtn" onclick="navigate(-1)" title="上一页">←</button>
  <span class="counter" id="counter">1 / 1</span>
  <button id="nextBtn" onclick="navigate(1)" title="下一页">→</button>
</div>

<script>
let currentSlide = 0;
const slides = document.querySelectorAll('.slide');
const total = slides.length;
const counter = document.getElementById('counter');
const progressFill = document.getElementById('progressFill');
const slideNum = document.getElementById('slideNum');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

function showSlide(index) {
  if (index < 0 || index >= total) return;
  slides[currentSlide].classList.remove('active');
  currentSlide = index;
  slides[currentSlide].classList.add('active');
  const content = slides[currentSlide].querySelector('.slide-content');
  if (content) content.scrollTop = 0;
  updateUI();
}

function navigate(dir) { showSlide(currentSlide + dir); }

function updateUI() {
  counter.textContent = (currentSlide + 1) + ' / ' + total;
  progressFill.style.width = ((currentSlide + 1) / total * 100) + '%';
  slideNum.textContent = (currentSlide + 1) + ' / ' + total;
  prevBtn.disabled = currentSlide === 0;
  nextBtn.disabled = currentSlide === total - 1;
  document.querySelectorAll('.sidebar-item').forEach(item => {
    var isActive = parseInt(item.dataset.slide) === currentSlide;
    item.classList.toggle('active', isActive);
    if (isActive) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// Keyboard: ←→ / Space / PageUp/Down / Home/End
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); navigate(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); navigate(-1); }
  else if (e.key === 'Home') { e.preventDefault(); showSlide(0); }
  else if (e.key === 'End') { e.preventDefault(); showSlide(total - 1); }
});

// Touch swipe
let touchStartX = 0;
document.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
document.addEventListener('touchend', (e) => {
  const diff = touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 50) { if (diff > 0) navigate(1); else navigate(-1); }
});

function toggleSidebar() {
  document.body.classList.toggle('collapsed');
  document.getElementById('sidebarToggle').textContent = document.body.classList.contains('collapsed') ? '▶' : '◀';
}

// Init
showSlide(0);
</script>
```

## Code Syntax Highlight Classes

| Class | Color | Use |
|---|---|---|
| `.cm` | `#7a7568` (灰) | 注释 |
| `.kw` | `#D97757` (橙) | 关键字 (const/let/if/for/while/return) |
| `.st` | `#788C5D` (绿) | 字符串 |
| `.fn` | `#6A9BCC` (蓝) | 函数名 |
| `.pn` | `#C15F3C` (陶土橙) | 属性名/特殊标记 |
