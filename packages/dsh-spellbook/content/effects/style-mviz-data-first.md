---
title: 风格 · DemoLite 数据优先
slug: style-dviz-data-first
category: 风格
tags: [custom-property, 表格, 看板, 色彩, 设计系统]
since: 2026-11
source: 取自 DemoLite / demo 评测平台前端的样式准则 style.md（demo-app），参照 Grafana、Linear、Bloomberg Terminal，整理成可抄的取值
when: 做内部数据平台、评测报告、监控看板：用户每天盯着看、要在大量数字里迅速找到异常
stage: plain
tier: core
---

## 描述

一套「数据优先」的亮色风格：页面底浅灰、卡片纯白加 1px 边线，**不用阴影**；字小而密（正文 13、辅助 12），靠字重而不是字号区分层级；一页只有一个强调色；成功/警告/危险三种语义色**只给数据着色**，不给背景色块。

机制是 ==克制：减少视觉噪音，让「异常」成为页面上唯一有颜色的东西==。原准则的每条几乎都在服务这一句：能用颜色区分就不加边框、卡片不用投影、正常数字用次要灰、危险按钮平时是次要样式只在悬停才变红、必填不用红星堆满而是标「选填」。克制不是极简，是把「跳出来」的预算只留给真正需要被看到的东西。

取值速查：

- 底：页面 `#f5f6f8`、卡片 `#fff`、悬停/选中 `#f0f2f5`、边线 `#e4e6eb`
- 文字：主 `#1a1d27`、次 `#5c6070`、弱 `#9ba3b5`
- 语义：强调 `#1f4ead`、成功 `#23a571`、警告 `#d97706`、危险 `#dc2626`、中性 `#6c7293`
- 字号：页面标题 18/600、模块标题 14/600、正文 13、辅助 12、数据大字 24+/600；数字等宽
- 间距：4px 栅格——4、8、12、16、24、32；卡片内边距 16；卡片间距 16
- 卡片标题区固定 40px；表格行高 36px

## 代码

```html
<div class="mv">
  <header class="mv-head">
    <h4>评测结果</h4>
    <span class="mv-spacer"></span>
    <button class="mv-btn">导出</button>
    <button class="mv-btn mv-primary">重新运行</button>
    <button class="mv-btn mv-danger">删除</button>
  </header>
  <div class="mv-stats">
    <div><small>通过率</small><b>94.2%</b></div>
    <div><small>碰撞</small><b class="bad">3</b></div>
  </div>
  <table>
    <tr><th>场景</th><th class="n">通过率</th></tr>
    <tr><td>直行跟车</td><td class="n">99.2%</td></tr>
    <tr><td>无保护左转</td><td class="n bad">71.5%</td></tr>
  </table>
</div>
```

```css
.mv {
  /* @mechanism 令牌：中性色全是蓝灰一族，彩色只有四个语义色 */
  --bg: #f5f6f8;
  --card: #fff;
  --hover: #f0f2f5;
  --line: #e4e6eb;
  --t1: #1a1d27;
  --t2: #5c6070;
  --t3: #9ba3b5;
  --accent: #1f4ead;
  --bad: #dc2626;

  width: 300px;
  border: 1px solid var(--line);
  border-radius: 8px;
  /* @mechanism 卡片 = 白底 + 1px 边线，没有投影 */
  background: var(--card);
  color: var(--t2);
  font: 400 13px/1.5 'Inter', 'PingFang SC', system-ui, sans-serif;
}

.mv-head {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 标题区固定 40px、内边距 0 16px */
  height: 40px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--line);
}
.mv-head h4 { margin: 0; color: var(--t1); font-size: 14px; font-weight: 600; }
.mv-spacer { flex: 1; }

.mv-btn {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: transparent;
  color: var(--t2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mv-btn:hover { background: var(--hover); }
/* 主操作：强调色填充，一个视图最多一个 */
.mv-primary { border-color: var(--accent); background: var(--accent); color: #fff; }
.mv-primary:hover { background: #1a43a0; }
/* @mechanism 危险操作平时和次操作一样安静，悬停才变红，避免页面一片红 */
.mv-danger:hover { border-color: var(--bad); background: transparent; color: var(--bad); }

.mv-stats { display: flex; gap: 24px; padding: 12px 16px 4px; }
.mv-stats small { display: block; color: var(--t3); font-size: 12px; }
.mv-stats b { color: var(--t1); font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }

.mv table { width: calc(100% - 32px); margin: 4px 16px 12px; border-collapse: collapse; }
.mv th, .mv td { height: 32px; padding: 0; text-align: left; }
.mv th { color: var(--t3); font-size: 12px; font-weight: 400; }
.mv td { border-top: 1px solid var(--bg); }
.mv .n { text-align: right; font-variant-numeric: tabular-nums; }
/* @mechanism 全页唯一的彩色：异常数据的文字色，不加底色块 */
.mv .bad { color: var(--bad); font-weight: 600; }
```

## 边界

- 这套风格**白底低饱和**，数据多、停留久时友好；做展示型落地页或营销页会显得寡淡。它是工具的衣服，不是橱窗的衣服。
- 「强调色每页只用一个」是纪律而非技术约束，必须靠评审守住。第二个强调色一旦出现，用户就不知道「这页最重要的是什么」了。
- 语义色严格对应语义：不能因为好看就把成功绿用在「已选中」上。选中用强调色或中性色，否则「绿 = 好」这个约定会被稀释。
- 暗色模式在原项目里是**特定场景按需开启**，不是全局方案：背景 `#0f1117`、卡片 `#1a1d27`、边线 `#2e3347`、主文字 `#e8eaf0`。把亮色令牌机械反转得不到好的暗色，要单独调一套。
- 13px 正文在高分屏上很舒服，在低分屏或视力不佳的用户那里偏小；提供一个整体缩放的入口比放大默认字号更稳妥。

## 备注

- 配套：`dense-data-table`（只让异常跳出来）、`tone-badge-mix`（语义徽章）、`kpi-tile`（指标卡）。
- 与「Cove 深色玻璃」是两个极端：一个把密度让给氛围，一个把氛围让给密度。同一个产品里，总览用前者、明细用后者，是合理的搭配。
