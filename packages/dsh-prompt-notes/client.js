/**
 * dsh-prompt-notes —— client 半体：右侧栏里的「便签」页签。
 *
 * 整个界面是一本横向的便签簿：顶上是索引标签（全部/全局/工作区/会话/系统），
 * 簿面是横线纸，每条配置是贴在上面的一张横向纸条——图钉钉住 = 生效，拔掉图钉 = 不生效。
 *   黄纸 = 提示词   蓝纸 = 技能   绿纸 = MCP   描图纸 = 系统自带（只读）
 *
 * 真值全在 host（/dsh-prompt-notes/*），这里只是遥控器 + 展示：
 *   - 读写都带 ?session=&cwd=，所以「哪些便签对我生效」由服务端相对当前会话算好；
 *   - 写操作先乐观更新，再用 host 回的全量状态覆盖；
 *   - 每 5 秒（页面可见时）与窗口聚焦时重读，手改数据文件也看得到；
 *   - 轮询的结果若在「写入进行中」到达，直接丢弃，免得旧状态把刚拔的图钉按回去。
 *
 * 只用主题 token（--dsw-alias-*）画「桌面」；纸张、墨水、图钉是拟物插画，用字面色
 * （纸在明暗两种主题下都是浅色，所以纸上的字一律用深色墨水，不跟主题走）。
 * 弹出的编辑页是盖在面板内部的 absolute 层，不碰 document.body。
 */
window.__ModuleLoader__.load({
  id: "@kpeace/dsh-prompt-notes",
  factory: function (require) {
    var React = require("react");
    var h = React.createElement;

    var ROUTE = "/dsh-prompt-notes";
    var GUARD = { "x-dsh-prompt-notes": "1" };
    var STYLE_ID = "dsh-prompt-notes-style";
    var POLL_MS = 5000;
    var SYSTEM_POLL_MS = 15000;
    var PAPERS = ["yellow", "pink", "blue", "green", "lilac"];
    var KINDS = ["prompt", "skill", "mcp"];
    var sidebarApi = null; // 分屏窗格里拿不到 scope 时，从侧栏服务读当前会话

    // ───────────────────────── i18n ─────────────────────────
    var STR = {
      zh: {
        tab: "便签", tabDesc: "按作用域管理注入会话的提示词、技能与 MCP", title: "便签",
        tAll: "全部", tGlobal: "全局", tWorkspace: "工作区", tSession: "会话", tSystem: "系统",
        kPrompt: "提示词", kSkill: "技能", kMcp: "MCP",
        master: "总开关", masterOn: "开", masterOff: "关", preview: "查看实际注入的文本", previewTitle: "实际注入的文本", previewEmpty: "这个会话里当前没有任何便签文本被注入。",
        copy: "复制", copied: "已复制", close: "关闭", refresh: "刷新",
        search: "搜索便签", used: "已用 {used} / {max} 字", usedNoMax: "已用 {used} 字（不限）", budgetNote: "仅提示词便签占用预算",
        gInjected: "生效中", gOverflow: "超出预算", gPaused: "总开关已关", gElsewhere: "在别处生效", gOff: "未钉住",
        overflowHint: "放不下预算，未注入", pausedHint: "总开关关闭中", elsewhereHint: "不适用于当前会话/工作区",
        pinOn: "已钉住（生效）— 点击拔掉", pinOff: "未钉住 — 点击钉上",
        stGlobal: "全局", stWorkspace: "工作区", stSession: "会话", stThisSession: "本会话", stThisWorkspace: "本工作区",
        empty: "这里还没有便签。", emptyFilter: "没有匹配的便签。", emptyTab: "这个分类下还没有便签。",
        quickPh: "写一张提示词便签，回车贴上去…", quickScope: "作用域", more: "技能 / MCP / 详细编辑", stick: "贴上",
        newPrompt: "新提示词", newSkill: "新技能", newMcp: "新 MCP",
        fTitle: "标题（可选）", fBody: "提示词内容", fBodySkill: "技能正文（模型加载后看到的指令）", fBodyMcp: "备注（可选）", fTags: "标签，逗号分隔",
        fSkillName: "技能名（kebab-case，如 go-review）", fSkillDesc: "一句话描述：模型靠它决定何时加载",
        fSkillWhen: "何时使用（可选）", invBoth: "两者", invModel: "仅模型", invUser: "仅用户",
        fMcpName: "名字（成为工具前缀 mcp__名__）", fCommand: "启动命令，如 npx", fArgs: "参数，如 -y @scope/server", fUrl: "http(s) 地址，如 http://localhost:3000/mcp",
        transportStdio: "本地命令", transportHttp: "HTTP 服务",
        scope: "贴在哪里",
        workspacePath: "工作区目录（绝对路径）", sessionId: "会话 id",
        paper: "纸色", pinned: "钉住（生效）", cancel: "取消", save: "保存", saving: "保存中…", create: "贴上去", del: "删除", confirmDel: "确认删除", dup: "复制一份",
        createdAt: "创建", updatedAt: "更新", lenInfo: "{n} 字", discardHint: "有未保存的修改，再按一次 Esc 放弃",
        mcpWarn: "钉上后会在本机以 DSH 的权限启动这条命令。只在信任来源时启用。",
        mcpDisabled: "这个部署关闭了 MCP 便签（配置 mcp: false），钉上也不会生效。",
        retry: "重试", loadFail: "无法连接便签服务", untitled: "(无标题)", copySuffix: "（副本）", loading: "加载中…",
        deleted: "已移入回收站", undo: "撤销",
        share: "导入 / 导出", exportAll: "导出全部", shareHint: "把分享文件粘到这里，先预览再导入。", importPreview: "预览", importConfirm: "确认导入",
        conflictOn: "冲突时", sRename: "重命名", sSkip: "跳过", sOverwrite: "覆盖", badJson: "不是合法的 JSON", importedN: "已导入 {n} 条",
        actCreate: "新建", actRename: "重命名", actOverwrite: "覆盖", actSkip: "跳过", droppedN: "{n} 条无法导入",
        sysTitle: "系统自带的注入内容",
        sysNoSession: "没有活动会话：下面是不带会话上下文时的组装结果。",
        sgIdentity: "身份与人设", sgTools: "工具指引", sgOthers: "其他插件的提示段", sgContext: "动态上下文", sgSkills: "技能目录", sgMcp: "MCP 服务器",
        sysTools: "{n} 个工具（其中 MCP {m} 个）", sysMine: "来自便签", fork: "复制为我的便签", truncated: "（内容过长，已截断显示）", readOnly: "只读",
        sysErr: "部分系统信息读取失败：", sysEmpty: "没有读到系统注入内容。",
        mcpState_connected: "已连接", mcpState_connecting: "连接中", mcpState_failed: "失败", mcpState_disabled: "已停用", mcpState_reconnecting: "重连中",
      },
      en: {
        tab: "Notes", tabDesc: "Manage prompts, skills and MCP servers injected into sessions, by scope", title: "Notes",
        tAll: "All", tGlobal: "Global", tWorkspace: "Workspace", tSession: "Session", tSystem: "System",
        kPrompt: "Prompt", kSkill: "Skill", kMcp: "MCP",
        master: "Master", masterOn: "ON", masterOff: "OFF", preview: "Show the text actually injected", previewTitle: "Injected text", previewEmpty: "No note text is injected into this session right now.",
        copy: "Copy", copied: "Copied", close: "Close", refresh: "Refresh",
        search: "Search notes", used: "{used} / {max} chars used", usedNoMax: "{used} chars used (no limit)", budgetNote: "Only prompt notes use the budget",
        gInjected: "In effect", gOverflow: "Over budget", gPaused: "Master is off", gElsewhere: "In effect elsewhere", gOff: "Unpinned",
        overflowHint: "does not fit the budget", pausedHint: "master switch is off", elsewhereHint: "not for this session/workspace",
        pinOn: "Pinned (in effect) — click to unpin", pinOff: "Unpinned — click to pin",
        stGlobal: "Global", stWorkspace: "Workspace", stSession: "Session", stThisSession: "This session", stThisWorkspace: "This workspace",
        empty: "No notes yet.", emptyFilter: "No matching notes.", emptyTab: "No notes in this category yet.",
        quickPh: "Write a prompt note, Enter to stick it…", quickScope: "Scope", more: "Skill / MCP / full editor", stick: "Stick",
        newPrompt: "New prompt", newSkill: "New skill", newMcp: "New MCP",
        fTitle: "Title (optional)", fBody: "Prompt text", fBodySkill: "Skill body (the instructions the model sees once it loads it)", fBodyMcp: "Remarks (optional)", fTags: "Tags, comma separated",
        fSkillName: "Skill name (kebab-case, e.g. go-review)", fSkillDesc: "One line: the model decides when to load it from this",
        fSkillWhen: "When to use (optional)", invBoth: "both", invModel: "model only", invUser: "user only",
        fMcpName: "Name (becomes the tool prefix mcp__name__)", fCommand: "Command, e.g. npx", fArgs: "Arguments, e.g. -y @scope/server", fUrl: "http(s) URL, e.g. http://localhost:3000/mcp",
        transportStdio: "Local command", transportHttp: "HTTP server",
        scope: "Stick it to",
        workspacePath: "Workspace directory (absolute path)", sessionId: "Session id",
        paper: "Paper", pinned: "Pinned (in effect)", cancel: "Cancel", save: "Save", saving: "Saving…", create: "Stick it", del: "Delete", confirmDel: "Confirm delete", dup: "Duplicate",
        createdAt: "Created", updatedAt: "Updated", lenInfo: "{n} chars", discardHint: "Unsaved changes — press Esc again to discard",
        mcpWarn: "Pinning starts this command on this machine with DSH's permissions. Enable only sources you trust.",
        mcpDisabled: "MCP notes are turned off in this deployment (config mcp: false); pinning has no effect.",
        retry: "Retry", loadFail: "Cannot reach the notes service", untitled: "(untitled)", copySuffix: " (copy)", loading: "Loading…",
        deleted: "Moved to trash", undo: "Undo",
        share: "Import / export", exportAll: "Export all", shareHint: "Paste a shared file here, preview, then import.", importPreview: "Preview", importConfirm: "Import",
        conflictOn: "On conflict", sRename: "rename", sSkip: "skip", sOverwrite: "overwrite", badJson: "Not valid JSON", importedN: "Imported {n}",
        actCreate: "new", actRename: "rename", actOverwrite: "overwrite", actSkip: "skip", droppedN: "{n} could not be imported",
        sysTitle: "What the system already injects",
        sysNoSession: "No live session: this is the assembly without a session context.",
        sgIdentity: "Identity & persona", sgTools: "Tool guidance", sgOthers: "Other plugins' sections", sgContext: "Runtime context", sgSkills: "Skill catalog", sgMcp: "MCP servers",
        sysTools: "{n} tools ({m} from MCP)", sysMine: "from notes", fork: "Copy as my note", truncated: "(long content, truncated)", readOnly: "read-only",
        sysErr: "Some system info could not be read: ", sysEmpty: "No system injection was read.",
        mcpState_connected: "connected", mcpState_connecting: "connecting", mcpState_failed: "failed", mcpState_disabled: "disabled", mcpState_reconnecting: "reconnecting",
      },
    };
    function lang() {
      var l = (document.documentElement.getAttribute("lang") || navigator.language || "zh").toLowerCase();
      return l.indexOf("en") === 0 ? "en" : "zh";
    }
    function t(key, vars) {
      var s = (STR[lang()] || STR.zh)[key] || STR.zh[key] || key;
      if (vars) for (var k in vars) s = s.replace("{" + k + "}", vars[k]);
      return s;
    }
    function num(n) { return Number(n || 0).toLocaleString(); }

    // ───────────────────────── api ─────────────────────────
    function qsOf(viewer) {
      var p = [];
      if (viewer && viewer.sessionId) p.push("session=" + encodeURIComponent(viewer.sessionId));
      if (viewer && viewer.cwd) p.push("cwd=" + encodeURIComponent(viewer.cwd));
      return p.length ? "?" + p.join("&") : "";
    }
    function api(path, method, body) {
      var m = method || "GET";
      var headers = m === "GET" ? {} : Object.assign({ "content-type": "application/json" }, GUARD);
      var init = { method: m, credentials: "same-origin", headers: headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      return fetch(ROUTE + path, init).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          if (!res.ok) throw new Error((json && json.error) || "HTTP " + res.status);
          return json;
        });
      });
    }

    /** 当前观察者：优先用侧栏传来的 scope；分屏窗格没有 props 时退回侧栏服务的快照。 */
    function useViewer(props) {
      var s = props && props.scope;
      if (s && s.sessionId) return { sessionId: s.sessionId, cwd: s.cwd || "" };
      try {
        var snap = sidebarApi && sidebarApi.getSnapshot && sidebarApi.getSnapshot();
        if (snap && snap.sessionId) return { sessionId: snap.sessionId, cwd: "" };
      } catch (e) { /* 取不到就当没有会话 */ }
      return { sessionId: "", cwd: "" };
    }

    function useNotes(viewer) {
      var st = React.useState(null), state = st[0], setState = st[1];
      var er = React.useState(""), error = er[0], setError = er[1];
      var seq = React.useRef(0);
      var qs = qsOf(viewer);

      var load = React.useCallback(function () {
        var startedAt = seq.current;
        return api("/state" + qs).then(function (value) {
          if (seq.current !== startedAt) return; // 读的过程中有写入：这份已是旧的
          setState(value); setError("");
        }).catch(function (e) { setError(String(e && e.message || e)); });
      }, [qs]);

      React.useEffect(function () {
        load();
        var timer = setInterval(function () { if (document.visibilityState === "visible") load(); }, POLL_MS);
        var onFocus = function () { load(); };
        window.addEventListener("focus", onFocus);
        return function () { clearInterval(timer); window.removeEventListener("focus", onFocus); };
      }, [load]);

      /** optimistic(state) → 新 state；失败则回读真值并抛给调用方（调用方可在自己的界面里显示原因）。 */
      var write = React.useCallback(function (path, method, body, optimistic) {
        seq.current++;
        if (optimistic) setState(function (prev) { return prev ? optimistic(prev) : prev; });
        return api(path + qs, method, body).then(function (value) {
          seq.current++; setState(value); setError(""); return value;
        }).catch(function (e) {
          seq.current++; load();
          throw e;
        });
      }, [load, qs]);

      return { state: state, error: error, setError: setError, reload: load, write: write };
    }

    function useSystem(viewer, active) {
      var st = React.useState(null), data = st[0], setData = st[1];
      var ld = React.useState(false), loading = ld[0], setLoading = ld[1];
      var qs = qsOf(viewer);
      var load = React.useCallback(function () {
        setLoading(true);
        return api("/system" + qs).then(function (v) { setData(v); }).catch(function (e) {
          setData({ sections: [], contexts: [], skills: [], mcp: [], tools: { count: 0, mcpCount: 0 }, errors: [String(e && e.message || e)], session: {} });
        }).then(function () { setLoading(false); });
      }, [qs]);
      React.useEffect(function () {
        if (!active) return undefined;
        load();
        var timer = setInterval(function () { if (document.visibilityState === "visible") load(); }, SYSTEM_POLL_MS);
        return function () { clearInterval(timer); };
      }, [active, load]);
      return { data: data, loading: loading, reload: load };
    }

    // ───────────────────────── helpers ─────────────────────────
    function rot(id, k) {
      var n = 0;
      for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
      return (((n >>> 0) % 1000) / 1000 - 0.5) * 2 * k;
    }
    function basename(p) { var s = String(p || "").replace(/[\\/]+$/, ""); var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\")); return i >= 0 ? s.slice(i + 1) || s : s; }
    function noteTitle(n) {
      if (n.title) return n.title;
      if (n.kind === "skill" && n.skill) return n.skill.name;
      if (n.kind === "mcp" && n.mcp) return n.mcp.name;
      var line = String(n.body || "").split("\n").filter(function (s) { return s.trim(); })[0] || "";
      line = line.replace(/^#+\s*/, "").trim();
      return line ? (line.length > 40 ? line.slice(0, 40) + "…" : line) : t("untitled");
    }
    function excerptOf(n) {
      if (n.kind === "skill") return n.skill ? n.skill.description : "";
      if (n.kind === "mcp" && n.mcp) return n.mcp.transport === "stdio" ? (n.mcp.command + " " + (n.mcp.args || []).join(" ")).trim() : n.mcp.url;
      return n.body;
    }
    function scopeLabel(n, viewer) {
      if (n.scope === "global") return t("stGlobal");
      if (n.scope === "session") return n.target === viewer.sessionId ? t("stThisSession") : t("stSession") + " " + String(n.target).slice(0, 6);
      return n.applies ? t("stThisWorkspace") : basename(n.target) || t("stWorkspace");
    }
    function kindLabel(k) { return k === "skill" ? t("kSkill") : k === "mcp" ? t("kMcp") : t("kPrompt"); }
    function tagsToString(tags) { return (tags || []).join(", "); }

    function Icon(props) {
      var d = { eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
        plus: "M8 3v10M3 8h10", x: "M4 4l8 8M12 4l-8 8", copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
        trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5", search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5L14 14",
        refresh: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3", chev: "M5 6.5l3 3 3-3",
        share: "M4.5 7.5v5.5h7V7.5M8 2v6.5M5.5 4.5L8 2l2.5 2.5" };
      return h("svg", { width: props.size || 14, height: props.size || 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: d[props.name] }));
    }

    // ───────────────────────── 图钉：生效开关 ─────────────────────────
    function Pin(props) {
      return h("button", {
        type: "button", role: "switch", "aria-checked": props.on ? "true" : "false",
        "aria-label": props.label, title: props.label, disabled: props.disabled,
        className: "pn-pin" + (props.on ? " is-on" : " is-off") + (props.big ? " is-big" : ""),
        onClick: function (e) { e.stopPropagation(); props.onChange(!props.on); },
      }, h("span", { className: "pn-pin-shadow" }), h("span", { className: "pn-pin-head" }));
    }

    /** 总开关：金属拨动开关，印着 ON / OFF。 */
    function Slide(props) {
      return h("button", { type: "button", role: "switch", "aria-checked": props.on ? "true" : "false", "aria-label": props.label, title: props.label,
        className: "pn-slide" + (props.on ? " is-on" : ""), onClick: function () { props.onChange(!props.on); } },
        h("span", { className: "pn-slide-print" }, props.on ? t("masterOn") : t("masterOff")),
        h("span", { className: "pn-slide-knob" }));
    }

    // ───────────────────────── 纸条 ─────────────────────────
    function Slip(props) {
      var n = props.note, v = props.viewer;
      var on = n.enabled;
      var dim = n.status === "elsewhere" || n.status === "paused";
      var r = rot(n.id, on ? 0.28 : 0.55);
      var state = "";
      if (n.status === "overflow") state = t("overflowHint");
      else if (n.status === "paused") state = t("pausedHint");
      else if (n.status === "elsewhere") state = t("elsewhereHint");
      var rt = n.runtime;
      var open = function () { props.onOpen(n.id); };
      // 外层只管旋转与投影；真正可点、可聚焦的是 .pn-paper，图钉是它的兄弟 ——
      // 这样就不会出现「role=button 里再塞一个 button」这种非法嵌套。
      return h("div", {
        "data-note-id": n.id,
        className: "pn-slip pn-p-" + n.color + (on ? "" : " is-off") + (dim ? " is-dim" : "") + (n.status === "overflow" ? " is-over" : ""),
        style: { "--pn-r": r + "deg" },
      },
        h("div", {
          role: "button", tabIndex: 0, "aria-label": noteTitle(n), className: "pn-paper",
          onClick: open,
          onKeyDown: function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); open(); } },
        },
          h("div", { className: "pn-slip-head" },
            h("span", { className: "pn-dymo pn-k-" + n.kind }, kindLabel(n.kind)),
            h("span", { className: "pn-slip-title" }, noteTitle(n))),
          h("div", { className: "pn-excerpt" + (n.kind === "mcp" ? " is-mono" : "") }, excerptOf(n)),
          h("div", { className: "pn-slip-foot" },
            h("span", { className: "pn-stamp pn-s-" + n.scope, title: n.scope === "workspace" ? n.target : undefined }, scopeLabel(n, v)),
            n.tags.slice(0, 2).map(function (tag) { return h("span", { key: tag, className: "pn-hashtag" }, "#" + tag); }),
            h("span", { className: "pn-spacer" }),
            rt ? h("span", { className: "pn-led pn-led-" + rt.state, title: rt.error || "" }, t("mcpState_" + rt.state)) : null,
            state ? h("span", { className: "pn-state" }, state) : null)),
        n.status === "overflow" ? h("span", { className: "pn-ink-stamp", "aria-hidden": "true" }, t("gOverflow")) : null,
        h(Pin, { on: on, label: on ? t("pinOn") : t("pinOff"), onChange: function (val) { props.onToggle(n.id, val); } }));
    }

    /** 系统自带的内容：描图纸 + 回形针，只读。 */
    function SysSlip(props) {
      var it = props.item;
      return h("div", { className: "pn-slip pn-p-trace", "data-sys": it.key, style: { "--pn-r": rot(it.key, 0.25) + "deg" } },
        h("div", { role: "button", tabIndex: 0, className: "pn-paper", "aria-label": it.title,
          onClick: function () { props.onOpen(it); },
          onKeyDown: function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); props.onOpen(it); } } },
          h("div", { className: "pn-slip-head" },
            h("span", { className: "pn-dymo pn-k-sys" }, it.badge),
            h("span", { className: "pn-slip-title is-mono" }, it.title)),
          h("div", { className: "pn-excerpt" + (it.mono ? " is-mono" : "") }, it.excerpt),
          h("div", { className: "pn-slip-foot" },
            it.mine ? h("span", { className: "pn-stamp pn-s-mine" }, t("sysMine")) : null,
            h("span", { className: "pn-spacer" }),
            it.meta ? h("span", { className: "pn-state" }, it.meta) : null)));
    }

    function Group(props) {
      var s = React.useState(false), collapsed = s[0], setCollapsed = s[1];
      if (!props.count) return null;
      return h("section", { className: "pn-group pn-g-" + props.kind },
        h("button", { type: "button", className: "pn-washi", "aria-expanded": collapsed ? "false" : "true", onClick: function () { setCollapsed(!collapsed); } },
          h("span", { className: "pn-chev" + (collapsed ? " is-collapsed" : "") }, h(Icon, { name: "chev", size: 12 })),
          h("span", { className: "pn-washi-name" }, props.label),
          h("span", { className: "pn-washi-count" }, props.count)),
        collapsed ? null : h("div", { className: "pn-list" }, props.children));
    }

    // ───────────────────────── 弹层 ─────────────────────────
    function Sheet(props) {
      React.useEffect(function () {
        var opener = document.activeElement;
        return function () { if (opener && opener.focus && document.contains(opener)) opener.focus(); };
      }, []);
      return h("div", { className: "pn-backdrop", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onBackdrop(); } },
        h("div", { className: "pn-sheet" + (props.trace ? " is-trace" : ""), role: "dialog", "aria-modal": "true", "aria-label": props.label,
          onKeyDown: function (e) {
            if (e.key === "Escape") { e.stopPropagation(); props.onEscape(); return; }
            if (e.key !== "Tab") return;
            // 焦点陷阱：模态弹层里 Tab 只能在自己内部绕圈，不能跑到背后的便签上
            var nodes = e.currentTarget.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
            var list = [].filter.call(nodes, function (n) { return !n.disabled && n.offsetParent !== null; });
            if (!list.length) return;
            var first = list[0], last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          } }, props.children));
    }

    function CopyButton(props) {
      var c = React.useState(false), copied = c[0], setCopied = c[1];
      return h("button", { type: "button", className: "pn-btn", disabled: !props.text, onClick: function () {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(props.text).then(function () { setCopied(true); setTimeout(function () { setCopied(false); }, 1500); });
      } }, h(Icon, { name: "copy", size: 13 }), copied ? t("copied") : t("copy"));
    }

    function PreviewSheet(props) {
      var s = React.useState(null), data = s[0], setData = s[1];
      React.useEffect(function () { api("/preview" + qsOf(props.viewer)).then(setData).catch(function () { setData({ text: "", chars: 0 }); }); }, [props.revision]);
      return h(Sheet, { label: t("previewTitle"), trace: true, onBackdrop: props.onClose, onEscape: props.onClose },
        h("div", { className: "pn-sheet-head" },
          h("strong", { className: "pn-hand" }, t("previewTitle")),
          data ? h("span", { className: "pn-faint" }, num(data.chars) + " " + t("lenInfo", { n: "" }).trim()) : null,
          h("span", { className: "pn-spacer" }),
          h(CopyButton, { text: data && data.text }),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("close"), onClick: props.onClose, autoFocus: true }, h(Icon, { name: "x" }))),
        h("pre", { className: "pn-pre" }, !data ? t("loading") : data.text || t("previewEmpty")));
    }

    /** 导入 / 导出：一个入口、一个弹层；导出全部、粘贴文件、预览、确认。 */
    function ShareSheet(props) {
      var tx = React.useState(""), text = tx[0], setText = tx[1];
      var pv = React.useState(null), preview = pv[0], setPreview = pv[1];
      var sg = React.useState("rename"), strategy = sg[0], setStrategy = sg[1];
      var er = React.useState(""), error = er[0], setError = er[1];
      var bz = React.useState(false), busy = bz[0], setBusy = bz[1];
      var rs = React.useState(null), result = rs[0], setResult = rs[1];
      var qs = qsOf(props.viewer);

      var exportAll = function () {
        setError(""); setResult(null);
        api("/export" + qs).then(function (bundle) { setText(JSON.stringify(bundle, null, 2)); setPreview(null); })
          .catch(function (e) { setError(String(e && e.message || e)); });
      };
      var doPreview = function () {
        var bundle;
        try { bundle = JSON.parse(text); } catch (e) { setError(t("badJson")); return; }
        setError(""); setResult(null); setBusy(true);
        api("/import/preview" + qs, "POST", { bundle: bundle, strategy: strategy }).then(function (p) { setPreview(p); })
          .catch(function (e) { setPreview(null); setError(String(e && e.message || e)); })
          .then(function () { setBusy(false); });
      };
      var doImport = function () {
        var bundle;
        try { bundle = JSON.parse(text); } catch (e) { setError(t("badJson")); return; }
        setError(""); setBusy(true);
        api("/import" + qs, "POST", { bundle: bundle, strategy: strategy }).then(function (res) {
          setResult(res.imported || { added: 0 });
          if (props.onImported) props.onImported(res);
        }).catch(function (e) { setError(String(e && e.message || e)); }).then(function () { setBusy(false); });
      };

      var actionLabel = function (a) {
        if (a.action === "create") return t("actCreate");
        if (a.action === "rename") return t("actRename");
        if (a.action === "overwrite") return t("actOverwrite");
        return t("actSkip");
      };

      return h(Sheet, { label: t("share"), onBackdrop: props.onClose, onEscape: props.onClose },
        h("div", { className: "pn-sheet-head" },
          h("strong", { className: "pn-hand" }, t("share")),
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-btn", onClick: exportAll }, t("exportAll")),
          h(CopyButton, { text: text }),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("close"), onClick: props.onClose, autoFocus: true }, h(Icon, { name: "x" }))),
        h("div", { className: "pn-sheet-body pn-lined" },
          h("textarea", { className: "pn-input pn-textarea is-short is-mono", value: text, placeholder: t("shareHint"),
            "aria-label": t("share"), spellCheck: false, onChange: function (e) { setText(e.target.value); setPreview(null); setResult(null); } }),
          h("div", { className: "pn-foot-row" },
            h("button", { type: "button", className: "pn-btn", onClick: doPreview, disabled: busy || !text }, t("importPreview")),
            h("span", { className: "pn-faint" }, t("conflictOn")),
            h("div", { className: "pn-seg", role: "radiogroup" }, ["rename", "skip", "overwrite"].map(function (k) {
              return h("button", { key: k, type: "button", role: "radio", "aria-checked": strategy === k ? "true" : "false",
                className: "pn-seg-btn" + (strategy === k ? " is-on" : ""), onClick: function () { setStrategy(k); setPreview(null); } },
                t(k === "rename" ? "sRename" : k === "skip" ? "sSkip" : "sOverwrite"));
            }))),
          error ? h("div", { className: "pn-banner is-error", role: "alert" }, error) : null,
          result ? h("div", { className: "pn-banner is-warn" }, t("importedN", { n: result.added || 0 })) : null,
          preview ? h("div", { className: "pn-meta" },
            h("strong", null, [t("actCreate") + " " + preview.counts.create, t("actRename") + " " + preview.counts.rename,
              t("actOverwrite") + " " + preview.counts.overwrite, t("actSkip") + " " + preview.counts.skip].join(" · ")),
            preview.actions.map(function (a, i) {
              var name = a.name && a.name !== a.title ? " · " + a.name : "";
              return h("span", { key: i }, actionLabel(a) + " · " + (a.title || "") + name + (a.reason ? "（" + a.reason + "）" : ""));
            }),
            preview.dropped && preview.dropped.length ? h("span", { className: "pn-state" }, t("droppedN", { n: preview.dropped.length })) : null,
            preview.warnings.map(function (w, i) { return h("span", { key: "w" + i, className: "pn-state" }, w); })) : null),
        h("div", { className: "pn-sheet-foot" },
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-btn is-primary", onClick: doImport, disabled: busy || !preview }, t("importConfirm")),
          h("button", { type: "button", className: "pn-btn", onClick: props.onClose }, t("close"))));
    }

    function SystemSheet(props) {
      var it = props.item;
      return h(Sheet, { label: it.title, trace: true, onBackdrop: props.onClose, onEscape: props.onClose },
        h("div", { className: "pn-sheet-head" },
          h("span", { className: "pn-dymo pn-k-sys" }, it.badge),
          h("strong", { className: "pn-hand pn-clip-text" }, it.title),
          h("span", { className: "pn-stamp pn-s-ro" }, t("readOnly")),
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("close"), onClick: props.onClose, autoFocus: true }, h(Icon, { name: "x" }))),
        h("pre", { className: "pn-pre" }, it.full || it.excerpt || ""),
        it.truncated ? h("div", { className: "pn-banner" }, t("truncated")) : null,
        h("div", { className: "pn-sheet-foot" },
          h(CopyButton, { text: it.full || it.excerpt }),
          h("span", { className: "pn-spacer" }),
          it.forkable ? h("button", { type: "button", className: "pn-btn is-primary", onClick: function () { props.onFork(it); } }, h(Icon, { name: "plus", size: 13 }), t("fork")) : null));
    }

    function Swatches(props) {
      return h("div", { className: "pn-swatches", role: "radiogroup", "aria-label": t("paper") },
        PAPERS.map(function (c) {
          return h("button", { key: c, type: "button", role: "radio", "aria-checked": props.value === c ? "true" : "false", "aria-label": c,
            className: "pn-swatch pn-p-" + c + (props.value === c ? " is-on" : ""), onClick: function () { props.onChange(c); } });
        }));
    }

    function blankDraft(kind, viewer, scope) {
      var sc = scope || "global";
      return {
        kind: kind, title: "", body: "", tags: "", color: kind === "skill" ? "blue" : kind === "mcp" ? "green" : "yellow",
        enabled: kind !== "mcp", scope: sc,
        target: sc === "workspace" ? viewer.cwd || "" : sc === "session" ? viewer.sessionId || "" : "",
        skillName: "", skillDesc: "", skillWhen: "", skillModel: true, skillUser: true,
        mcpName: "", transport: "stdio", command: "", args: "", url: "",
      };
    }
    function draftOf(n) {
      var d = blankDraft(n.kind, {}, n.scope);
      d.title = n.title; d.body = n.body; d.tags = tagsToString(n.tags); d.color = n.color; d.enabled = n.enabled; d.target = n.target;
      if (n.skill) {
        d.skillName = n.skill.name; d.skillDesc = n.skill.description; d.skillWhen = n.skill.whenToUse || "";
        d.skillModel = n.skill.invocation ? n.skill.invocation.modelInvocable !== false : true;
        d.skillUser = n.skill.invocation ? n.skill.invocation.userInvocable !== false : true;
      }
      if (n.mcp) { d.mcpName = n.mcp.name; d.transport = n.mcp.transport; d.command = n.mcp.command; d.args = (n.mcp.args || []).join(" "); d.url = n.mcp.url; }
      return d;
    }
    function payloadOf(d, creating) {
      var p = { title: d.title, body: d.body, tags: d.tags, color: d.color, enabled: d.enabled, scope: d.scope, target: d.scope === "global" ? "" : d.target };
      if (creating) p.kind = d.kind;
      if (d.kind === "skill") {
        // 整个技能对象一起送：服务端是「没给的字段不动」的合并语义，
        // 只送变化的部分会让「清空何时使用」「改回两者都能调用」永远生效不了。
        p.skill = {
          name: d.skillName, description: d.skillDesc, whenToUse: d.skillWhen.trim(),
          invocation: { modelInvocable: d.skillModel, userInvocable: d.skillUser },
        };
      }
      if (d.kind === "mcp") p.mcp = { name: d.mcpName, transport: d.transport, command: d.command, args: d.args, url: d.url };
      return p;
    }

    /** 编辑页：一张摊开的、带红色页边线的横线纸。新建与编辑共用。 */
    function EditorSheet(props) {
      var n = props.note, v = props.viewer, creating = !n;
      var d0 = React.useMemo(function () { return n ? draftOf(n) : props.blank; }, []);
      var d = React.useState(d0), draft = d[0], setDraft = d[1];
      var sv = React.useState(false), saving = sv[0], setSaving = sv[1];
      var er = React.useState(""), err = er[0], setErr = er[1];
      var cf = React.useState(false), confirmDel = cf[0], setConfirmDel = cf[1];
      var ds = React.useState(false), discardWarn = ds[0], setDiscardWarn = ds[1];
      var set = function (patch) { setDraft(function (p) { return Object.assign({}, p, patch); }); setDiscardWarn(false); setErr(""); };
      var dirty = creating ? true : JSON.stringify(draft) !== JSON.stringify(d0);
      var kind = draft.kind;
      var bodyOk = kind === "mcp" ? true : draft.body.trim().length > 0;
      var ok = bodyOk && (kind !== "skill" || (draft.skillName && draft.skillDesc)) && (kind !== "mcp" || (draft.mcpName && (draft.transport === "stdio" ? draft.command : draft.url))) && (draft.scope === "global" || draft.target.trim());
      var firstRef = React.useRef(null);
      React.useEffect(function () { if (firstRef.current) firstRef.current.focus(); }, []);

      var tryClose = function () { if (dirty && !creating && !discardWarn) { setDiscardWarn(true); return; } props.onClose(); };
      var save = function () {
        if (!dirty || !ok || saving) return;
        setSaving(true); setErr("");
        var p = payloadOf(draft, creating);
        (creating ? props.onCreate(p) : props.onSave(n.id, p)).then(props.onClose, function (e) { setSaving(false); setErr(String(e && e.message || e)); });
      };
      var onKey = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } };
      var pickKind = function (k) { if (creating) setDraft(function (p) { var b = blankDraft(k, v, p.scope); return Object.assign(b, { title: p.title, tags: p.tags, scope: p.scope, target: p.target, body: p.body }); }); };
      var pickScope = function (sc) { set({ scope: sc, target: sc === "global" ? "" : sc === "workspace" ? (draft.scope === "workspace" ? draft.target : v.cwd || "") : (draft.scope === "session" ? draft.target : v.sessionId || "") }); };

      var field = function (cls, value, ph, key, extra) {
        return h("input", Object.assign({ className: "pn-input " + cls, value: value, placeholder: ph, onChange: function (e) { var p = {}; p[key] = e.target.value; set(p); } }, extra || {}));
      };

      return h(Sheet, { label: creating ? t(kind === "skill" ? "newSkill" : kind === "mcp" ? "newMcp" : "newPrompt") : noteTitle(n), onBackdrop: tryClose, onEscape: tryClose },
        h("div", { className: "pn-sheet-head" },
          creating
            ? h("div", { className: "pn-kindpick", role: "radiogroup" }, KINDS.map(function (k) {
                return h("button", { key: k, type: "button", role: "radio", "aria-checked": kind === k ? "true" : "false", className: "pn-dymo pn-k-" + k + (kind === k ? " is-on" : ""), onClick: function () { pickKind(k); } }, kindLabel(k));
              }))
            : h("span", { className: "pn-dymo pn-k-" + kind }, kindLabel(kind)),
          h(Swatches, { value: draft.color, onChange: function (c) { set({ color: c }); } }),
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("close"), onClick: tryClose }, h(Icon, { name: "x" }))),
        h("div", { className: "pn-sheet-body pn-lined pn-p-" + draft.color, onKeyDown: onKey },
          field("pn-input-title", draft.title, t("fTitle"), "title", { maxLength: 80 }),
          kind === "skill" ? h(React.Fragment, null,
            field("", draft.skillName, t("fSkillName"), "skillName", { spellCheck: false, ref: firstRef }),
            field("", draft.skillDesc, t("fSkillDesc"), "skillDesc", { maxLength: 300 }),
            field("", draft.skillWhen, t("fSkillWhen"), "skillWhen", { maxLength: 300 }),
            h("div", { className: "pn-seg", role: "radiogroup", "aria-label": t("fSkillWhen") }, [
              ["both", true, true], ["model", true, false], ["user", false, true],
            ].map(function (o) {
              var on = draft.skillModel === o[1] && draft.skillUser === o[2];
              return h("button", { key: o[0], type: "button", role: "radio", "aria-checked": on ? "true" : "false",
                className: "pn-seg-btn" + (on ? " is-on" : ""),
                onClick: function () { set({ skillModel: o[1], skillUser: o[2] }); } },
                t(o[0] === "both" ? "invBoth" : o[0] === "model" ? "invModel" : "invUser"));
            }))) : null,
          kind === "mcp" ? h(React.Fragment, null,
            field("", draft.mcpName, t("fMcpName"), "mcpName", { spellCheck: false, maxLength: 32, ref: firstRef }),
            h("div", { className: "pn-seg", role: "radiogroup" }, ["stdio", "streamable-http"].map(function (tr) {
              return h("button", { key: tr, type: "button", role: "radio", "aria-checked": draft.transport === tr ? "true" : "false", className: "pn-seg-btn" + (draft.transport === tr ? " is-on" : ""), onClick: function () { set({ transport: tr }); } }, tr === "stdio" ? t("transportStdio") : t("transportHttp"));
            })),
            draft.transport === "stdio"
              ? h(React.Fragment, null, field("is-mono", draft.command, t("fCommand"), "command", { spellCheck: false }), field("is-mono", draft.args, t("fArgs"), "args", { spellCheck: false }))
              : field("is-mono", draft.url, t("fUrl"), "url", { spellCheck: false }),
            h("div", { className: "pn-banner is-warn" }, state_mcp_warn(props.mcpAllowed))) : null,
          h("textarea", { ref: kind === "prompt" ? firstRef : null, className: "pn-input pn-textarea" + (kind === "mcp" ? " is-short" : ""), value: draft.body,
            placeholder: kind === "skill" ? t("fBodySkill") : kind === "mcp" ? t("fBodyMcp") : t("fBody"), spellCheck: false, onChange: function (e) { set({ body: e.target.value }); } }),
          field("", draft.tags, t("fTags"), "tags"),
          h("div", { className: "pn-scopebox" },
            h("div", { className: "pn-label" }, t("scope")),
            h("div", { className: "pn-scopes", role: "radiogroup" }, [["global", "stGlobal"], ["workspace", "stWorkspace"], ["session", "stSession"]].map(function (s) {
              return h("button", { key: s[0], type: "button", role: "radio", "aria-checked": draft.scope === s[0] ? "true" : "false", className: "pn-scopebtn" + (draft.scope === s[0] ? " is-on" : ""), onClick: function () { pickScope(s[0]); } },
                h("b", null, t(s[1])));
            })),
            draft.scope === "workspace" ? field("is-mono", draft.target, t("workspacePath"), "target", { spellCheck: false }) : null,
            draft.scope === "session" ? h(React.Fragment, null,
              field("is-mono", draft.target, t("sessionId"), "target", { spellCheck: false, list: "pn-live-sessions" }),
              h("datalist", { id: "pn-live-sessions" }, (props.liveSessions || []).map(function (id) { return h("option", { key: id, value: id }); }))) : null),
          h("label", { className: "pn-row" }, h("span", null, t("pinned")), h(Pin, { on: draft.enabled, big: true, label: draft.enabled ? t("pinOn") : t("pinOff"), onChange: function (val) { set({ enabled: val }); } })),
          n ? h("div", { className: "pn-meta" },
            h("span", null, t("lenInfo", { n: num((draft.body || "").length) })),
            h("span", null, t("createdAt") + " " + new Date(n.createdAt).toLocaleString()),
            h("span", null, t("updatedAt") + " " + new Date(n.updatedAt).toLocaleString())) : null),
        err ? h("div", { className: "pn-banner is-error", role: "alert" }, err) : null,
        discardWarn ? h("div", { className: "pn-banner is-warn", role: "status" }, t("discardHint")) : null,
        h("div", { className: "pn-sheet-foot" },
          n ? h(React.Fragment, null,
            h("button", { type: "button", className: "pn-btn is-danger", onClick: function () {
              if (!confirmDel) { setConfirmDel(true); return; }
              props.onDelete(n.id).then(props.onClose, function (e) { setErr(String(e && e.message || e)); });
            }, onBlur: function () { setConfirmDel(false); } }, h(Icon, { name: "trash", size: 13 }), confirmDel ? t("confirmDel") : t("del")),
            h("button", { type: "button", className: "pn-btn", onClick: function () { props.onDuplicate(n); } }, h(Icon, { name: "copy", size: 13 }), t("dup"))) : null,
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-btn", onClick: tryClose }, t("cancel")),
          h("button", { type: "button", className: "pn-btn is-primary", disabled: !dirty || !ok || saving, onClick: save }, saving ? t("saving") : creating ? t("create") : t("save"))));
    }
    function state_mcp_warn(allowed) { return allowed === false ? t("mcpDisabled") : t("mcpWarn"); }

    // ───────────────────────── 底部：随手写一张 ─────────────────────────
    function Composer(props) {
      var s = React.useState(""), text = s[0], setText = s[1];
      var sc = React.useState("global"), scope = sc[0], setScope = sc[1];
      var b = React.useState(false), busy = b[0], setBusy = b[1];
      var v = props.viewer;
      var canScope = function (k) { return k === "global" || (k === "workspace" && v.cwd) || (k === "session" && v.sessionId); };
      var ok = text.trim().length > 0 && canScope(scope);
      var submit = function () {
        if (!ok || busy) return;
        setBusy(true);
        props.onCreate({ kind: "prompt", body: text, scope: scope, target: scope === "workspace" ? v.cwd : scope === "session" ? v.sessionId : "" })
          .then(function () { setBusy(false); setText(""); }, function () { setBusy(false); });
      };
      return h("div", { className: "pn-foot" },
        h("div", { className: "pn-quick" },
          h("textarea", { className: "pn-quick-input", rows: 1, value: text, placeholder: t("quickPh"), spellCheck: false, "aria-label": t("quickPh"),
            onChange: function (e) { setText(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } } }),
          h("button", { type: "button", className: "pn-btn is-primary", disabled: !ok || busy, onClick: submit }, t("stick"))),
        h("div", { className: "pn-foot-row" },
          h("div", { className: "pn-miniscopes", role: "radiogroup", "aria-label": t("quickScope") }, ["global", "workspace", "session"].map(function (k) {
            return h("button", { key: k, type: "button", role: "radio", "aria-checked": scope === k ? "true" : "false", disabled: !canScope(k),
              className: "pn-stamp pn-s-" + k + " pn-stamp-btn" + (scope === k ? " is-on" : ""), onClick: function () { setScope(k); } }, t(k === "global" ? "stGlobal" : k === "workspace" ? "stWorkspace" : "stSession"));
          })),
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-linkbtn", onClick: props.onMore }, h(Icon, { name: "plus", size: 12 }), t("more"))));
    }

    // ───────────────────────── 簿头：标签、总开关、墨水量尺 ─────────────────────────
    var TABS = [["all", "tAll"], ["global", "tGlobal"], ["workspace", "tWorkspace"], ["session", "tSession"], ["system", "tSystem"]];

    function Gauge(props) {
      var b = props.budget;
      var pct = b.max > 0 ? Math.min(100, Math.round((b.used / b.max) * 100)) : (b.used ? 100 : 0);
      return h("div", { className: "pn-gauge", title: t("budgetNote") },
        h("div", { className: "pn-ruler", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": b.max || undefined, "aria-valuenow": b.used, "aria-label": t("budgetNote") },
          h("div", { className: "pn-hl" + (pct >= 90 ? " is-hot" : ""), style: { width: pct + "%" } })),
        h("div", { className: "pn-gauge-text" }, b.max > 0 ? t("used", { used: num(b.used), max: num(b.max) }) : t("usedNoMax", { used: num(b.used) })));
    }

    // ───────────────────────── 系统页 ─────────────────────────
    function groupOfSection(name) {
      var p = String(name).split(":")[0];
      if (p === "harness" || p === "deployment" || p === "agent") return "identity";
      if (p === "tool" || p === "tools") return "tools";
      return "others";
    }
    function buildSystemItems(data) {
      var out = { identity: [], tools: [], others: [], context: [], skills: [], mcp: [] };
      (data.sections || []).forEach(function (s) {
        if (!String(s.text || "").trim() && !s.chars) return;
        var g = groupOfSection(s.name);
        out[g].push({ key: "sec:" + s.name, badge: g === "identity" ? "ID" : g === "tools" ? "TOOL" : "SEC", title: s.name, excerpt: String(s.text || "").replace(/\s+/g, " ").trim().slice(0, 200),
          full: s.text, truncated: s.truncated, mine: s.mine, forkable: !s.mine, meta: num(s.chars) + " " + t("lenInfo", { n: "" }).trim() });
      });
      (data.contexts || []).forEach(function (c) {
        out.context.push({ key: "ctx:" + c.name, badge: "CTX", title: c.name, excerpt: String(c.text || "").replace(/\s+/g, " ").trim().slice(0, 200), full: c.text, truncated: c.truncated, forkable: true, meta: num(c.chars) + " " + t("lenInfo", { n: "" }).trim() });
      });
      (data.skills || []).forEach(function (s) {
        out.skills.push({ key: "skill:" + s.name, badge: "SKILL", title: s.name, excerpt: s.description, full: s.name + "\n\n" + s.description + "\n\nsource: " + s.source + " · provider: " + s.provider, mine: s.mine, meta: s.source });
      });
      (data.mcp || []).forEach(function (m) {
        out.mcp.push({ key: "mcp:" + m.name, badge: "MCP", title: m.name, mono: true, excerpt: m.error || t("mcpState_" + m.state), full: m.name + "\nstate: " + m.state + (m.error ? "\nerror: " + m.error : "") + "\ntools: " + m.tools, meta: m.tools + " tools" });
      });
      return out;
    }

    function SystemView(props) {
      var data = props.sys.data;
      if (!data) return h("div", { className: "pn-empty" }, t("loading"));
      var items = buildSystemItems(data);
      var total = items.identity.length + items.tools.length + items.others.length + items.context.length + items.skills.length + items.mcp.length;
      var open = props.onOpen;
      var G = function (kind, label, list) {
        return h(Group, { key: kind, kind: "sys", label: label, count: list.length }, list.map(function (it) { return h(SysSlip, { key: it.key, item: it, onOpen: open }); }));
      };
      return h(React.Fragment, null,
        h("div", { className: "pn-sys-intro" },
          h("div", { className: "pn-hand" }, t("sysTitle")),
          data.session && !data.session.found ? h("div", { className: "pn-faint" }, t("sysNoSession")) : null,
          h("div", { className: "pn-sys-tools" }, t("sysTools", { n: data.tools ? data.tools.count : 0, m: data.tools ? data.tools.mcpCount : 0 }),
            h("button", { type: "button", className: "pn-icon-btn" + (props.sys.loading ? " is-spin" : ""), "aria-label": t("refresh"), title: t("refresh"), onClick: props.sys.reload }, h(Icon, { name: "refresh", size: 13 })))),
        data.errors && data.errors.length ? h("div", { className: "pn-banner is-warn" }, t("sysErr") + data.errors.join("; ")) : null,
        total === 0 ? h("div", { className: "pn-empty" }, t("sysEmpty")) : null,
        G("identity", t("sgIdentity"), items.identity), G("tools", t("sgTools"), items.tools), G("others", t("sgOthers"), items.others),
        G("context", t("sgContext"), items.context), G("skills", t("sgSkills"), items.skills), G("mcp", t("sgMcp"), items.mcp));
    }

    // ───────────────────────── 主面板 ─────────────────────────
    function Panel(props) {
      var viewer = useViewer(props);
      var nn = useNotes(viewer), state = nn.state;
      var tb = React.useState("all"), tab = tb[0], setTab = tb[1];
      var qq = React.useState(""), query = qq[0], setQuery = qq[1];
      var kf = React.useState({}), kindOff = kf[0], setKindOff = kf[1];
      var op = React.useState(null), openId = op[0], setOpenId = op[1];
      var cr = React.useState(null), creating = cr[0], setCreating = cr[1];
      var sy = React.useState(null), sysItem = sy[0], setSysItem = sy[1];
      var pv = React.useState(false), showPreview = pv[0], setShowPreview = pv[1];
      var sh = React.useState(false), showShare = sh[0], setShowShare = sh[1];
      var ud = React.useState(null), undo = ud[0], setUndo = ud[1];
      var undoTimer = React.useRef(null);
      React.useEffect(function () { return function () { if (undoTimer.current) clearTimeout(undoTimer.current); }; }, []);
      var sys = useSystem(viewer, tab === "system");

      var notes = state ? state.notes : [];
      var live = state ? state.viewer : viewer;
      var opened = openId ? notes.filter(function (n) { return n.id === openId; })[0] : null;
      React.useEffect(function () { if (state && openId && !opened) setOpenId(null); }, [state, openId, opened]);

      var counts = { all: notes.length, global: 0, workspace: 0, session: 0 };
      notes.forEach(function (n) { counts[n.scope]++; });
      var ql = query.trim().toLowerCase();
      var visible = notes.filter(function (n) {
        if (tab !== "all" && tab !== "system" && n.scope !== tab) return false;
        if (kindOff[n.kind]) return false;
        if (!ql) return true;
        return (noteTitle(n) + "\n" + n.body + "\n" + n.tags.join(" ") + "\n" + excerptOf(n)).toLowerCase().indexOf(ql) >= 0;
      });
      var by = function (s) { return visible.filter(function (n) { return n.status === s; }); };

      var toggle = function (id, v) {
        nn.write("/notes/" + id, "PUT", { enabled: v }, function (prev) {
          return Object.assign({}, prev, { notes: prev.notes.map(function (n) {
            if (n.id !== id) return n;
            var status = !v ? "off" : !n.applies ? "elsewhere" : prev.paused ? "paused" : "injected";
            return Object.assign({}, n, { enabled: v, status: status });
          }) });
        }).catch(function (e) { nn.setError(String(e && e.message || e)); });
      };
      var create = function (body) { return nn.write("/notes", "POST", body); };
      var update = function (id, body) { return nn.write("/notes/" + id, "PUT", body); };
      var remove = function (id) {
        var gone = notes.filter(function (n) { return n.id === id; })[0];
        if (undoTimer.current) clearTimeout(undoTimer.current);
        setUndo(gone ? { id: id, title: noteTitle(gone) } : null);
        undoTimer.current = setTimeout(function () { setUndo(null); }, 8000);
        return nn.write("/notes/" + id, "DELETE");
      };
      var restore = function () {
        if (!undo) return;
        api("/notes/" + undo.id + "/restore" + qsOf(live), "POST").then(function () {
          setUndo(null);
          if (undoTimer.current) clearTimeout(undoTimer.current);
          nn.reload();
        }).catch(function (e) { nn.setError(String(e && e.message || e)); });
      };
      var duplicate = function (n) {
        var p = { kind: n.kind, title: (n.title || noteTitle(n)) + t("copySuffix"), body: n.body, tags: n.tags, color: n.color, enabled: false, scope: n.scope, target: n.target };
        if (n.skill) p.skill = { name: n.skill.name + "-copy", description: n.skill.description };
        if (n.mcp) p.mcp = Object.assign({}, n.mcp, { name: n.mcp.name + "-copy" });
        nn.write("/notes", "POST", p).then(function (s) { var last = s.notes[s.notes.length - 1]; if (last) setOpenId(last.id); }, function (e) { nn.setError(String(e && e.message || e)); });
      };
      var fork = function (it) {
        setSysItem(null);
        setCreating(Object.assign(blankDraft("prompt", live, "global"), { title: it.title, body: it.full || it.excerpt || "" }));
      };
      var setPaused = function (on) {
        nn.write("/paused", "PUT", { paused: !on }, function (prev) { return Object.assign({}, prev, { paused: !on }); }).catch(function () {});
      };

      var head = h("div", { className: "pn-head" },
        h("div", { className: "pn-title-row" },
          h("span", { className: "pn-title" }, t("title")),
          h("span", { className: "pn-spacer" }),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("share"), title: t("share"), onClick: function () { setShowShare(true); } }, h(Icon, { name: "share", size: 15 })),
          h("button", { type: "button", className: "pn-icon-btn", "aria-label": t("preview"), title: t("preview"), onClick: function () { setShowPreview(true); } }, h(Icon, { name: "eye", size: 15 })),
          state ? h(Slide, { on: !state.paused, label: t("master"), onChange: setPaused }) : null),
        state ? h(Gauge, { budget: state.budget }) : null);

      var tools = tab === "system" || !notes.length ? null : h("div", { className: "pn-tools" },
        h("label", { className: "pn-search" }, h(Icon, { name: "search", size: 13 }),
          h("input", { value: query, placeholder: t("search"), "aria-label": t("search"), onChange: function (e) { setQuery(e.target.value); } })),
        h("div", { className: "pn-kinds", role: "group" }, KINDS.map(function (k) {
          return h("button", { key: k, type: "button", "aria-pressed": kindOff[k] ? "false" : "true", className: "pn-dymo pn-k-" + k + (kindOff[k] ? " is-muted" : ""),
            onClick: function () { var q = Object.assign({}, kindOff); q[k] = !q[k]; setKindOff(q); } }, kindLabel(k));
        })));

      var body;
      if (tab === "system") {
        body = h(SystemView, { sys: sys, onOpen: setSysItem });
      } else if (!state) {
        body = nn.error
          ? h("div", { className: "pn-empty" }, h("div", null, t("loadFail")), h("div", { className: "pn-faint" }, nn.error), h("button", { type: "button", className: "pn-btn", onClick: nn.reload }, t("retry")))
          : h("div", { className: "pn-empty pn-faint" }, t("loading"));
      } else if (!notes.length) {
        body = h("div", { className: "pn-empty pn-faint" }, t("empty"));
      } else if (!visible.length) {
        body = h("div", { className: "pn-empty pn-faint" }, tab !== "all" && !ql ? t("emptyTab") : t("emptyFilter"));
      } else {
        var G = function (kind, label, list) {
          return h(Group, { key: kind, kind: kind, label: label, count: list.length },
            list.map(function (n) { return h(Slip, { key: n.id, note: n, viewer: live, onOpen: setOpenId, onToggle: toggle }); }));
        };
        body = h(React.Fragment, null, G("injected", t("gInjected"), by("injected")), G("overflow", t("gOverflow"), by("overflow")),
          G("paused", t("gPaused"), by("paused")), G("elsewhere", t("gElsewhere"), by("elsewhere")), G("off", t("gOff"), by("off")));
      }

      return h("div", { className: "pn-root" + (state && state.paused ? " is-paused" : "") },
        h("div", { className: "pn-tabs", role: "tablist",
          onKeyDown: function (e) {
            var keys = TABS.map(function (x) { return x[0]; });
            var i = keys.indexOf(tab);
            var next = e.key === "ArrowRight" ? (i + 1) % keys.length
              : e.key === "ArrowLeft" ? (i - 1 + keys.length) % keys.length
              : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            setTab(keys[next]);
            var list = e.currentTarget.querySelectorAll('[role="tab"]');
            if (list[next] && list[next].focus) list[next].focus();
          } }, TABS.map(function (x) {
          return h("button", { key: x[0], type: "button", role: "tab", "aria-selected": tab === x[0] ? "true" : "false", className: "pn-tab pn-t-" + x[0] + (tab === x[0] ? " is-on" : ""),
            ref: tab === x[0] ? function (el) { if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" }); } : null,
            onClick: function () { setTab(x[0]); } },
            t(x[1]), x[0] !== "system" && state ? h("span", { className: "pn-tab-n" }, counts[x[0]]) : null);
        })),
        h("div", { className: "pn-pad" },
          h("div", { className: "pn-glue", "aria-hidden": "true" }),
          head, tools,
          nn.error && state ? h("div", { className: "pn-banner is-error", role: "alert" }, nn.error) : null,
          undo ? h("div", { className: "pn-banner is-warn", role: "status" }, t("deleted") + " · " + undo.title,
            h("button", { type: "button", className: "pn-linkbtn", onClick: restore }, t("undo"))) : null,
          h("div", { className: "pn-scroll pn-lined" }, body),
          state && tab !== "system" ? h(Composer, { viewer: live, onCreate: create, onMore: function () { setCreating(blankDraft("prompt", live, tab === "workspace" || tab === "session" ? tab : "global")); } }) : null),
        opened ? h(EditorSheet, { key: opened.id, note: opened, viewer: live, mcpAllowed: state.mcpAllowed, liveSessions: state.liveSessions, onClose: function () { setOpenId(null); }, onSave: update, onDelete: remove, onDuplicate: duplicate }) : null,
        creating ? h(EditorSheet, { key: "new", note: null, blank: creating, viewer: live, mcpAllowed: state && state.mcpAllowed, liveSessions: state && state.liveSessions, onClose: function () { setCreating(null); }, onCreate: create }) : null,
        sysItem ? h(SystemSheet, { item: sysItem, onClose: function () { setSysItem(null); }, onFork: fork }) : null,
        showPreview ? h(PreviewSheet, { viewer: live, revision: state && state.revision, onClose: function () { setShowPreview(false); } }) : null,
        showShare ? h(ShareSheet, { viewer: live, onClose: function () { setShowShare(false); }, onImported: function () { nn.reload(); } }) : null);
    }

    // ───────────────────────── styles ─────────────────────────
    // 桌面用主题 token；纸/墨/图钉是拟物插画，用字面色。纸上的字一律深墨水。
    var HAND = '"Bradley Hand","Marker Felt","Segoe Print","Comic Sans MS","Kaiti SC","STKaiti","KaiTi",cursive';
    var MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    var INK = "#2f2410", INK2 = "rgba(47,36,16,.8)", INK3 = "rgba(47,36,16,.74)";
    var paper = function (name, top, bot) { return ".pn-p-" + name + "{--pn-paper-a:" + top + ";--pn-paper-b:" + bot + "}"; };
    var CSS = [
      paper("yellow", "#fff6b0", "#ffe985"), paper("pink", "#ffdbe4", "#ffbfd0"), paper("blue", "#d7ecff", "#b6dbff"),
      paper("green", "#dcf5d0", "#bfe8ae"), paper("lilac", "#e8deff", "#d2c2ff"), paper("trace", "#f7f6f1", "#ecebe4"),
      ".pn-root{position:relative;box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;container-type:inline-size;padding:8px 10px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45}",
      ".pn-root *{box-sizing:border-box}.pn-spacer{flex:1}",
      ".pn-faint{color:var(--dsw-alias-label-secondary)}",
      // —— 索引标签
      ".pn-tabs{display:flex;gap:2px;padding:0 10px;position:relative;z-index:1;margin-bottom:-1px;overflow-x:auto;scrollbar-width:none}",
      ".pn-tab{flex:none;display:inline-flex;align-items:center;gap:2px;height:24px;padding:0 4px;border:1px solid rgba(60,45,10,.25);border-bottom:0;border-radius:7px 7px 0 0;cursor:pointer;font:inherit;font-size:11px;color:" + INK + ";background:#e6dcb4;transform:translateY(2px);transition:transform .12s,background .12s}",
      ".pn-tab:hover{transform:translateY(0)}",
      ".pn-tab.is-on{height:27px;color:" + INK + ";font-weight:600;background:#fdf8e2;transform:none}",
      ".pn-t-system{background:#e4e3dd}.pn-t-system.is-on{background:#f7f7f2}",
      ".pn-tab-n{min-width:14px;padding:0 3px;border-radius:7px;background:rgba(60,45,10,.14);font-size:9.5px;line-height:14px;text-align:center}",
      // 面板很窄时先让计数退场，五个索引标签才放得下（英文标签比中文长得多）
      "@container (max-width:340px){.pn-tab-n{display:none}}",
      // —— 簿面
      ".pn-pad{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;border-radius:3px 6px 8px 8px;color:" + INK + ";background:linear-gradient(#fffdf0,#fbf3d4);",
      "box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 2px 2px rgba(0,0,0,.18),0 14px 22px -10px rgba(0,0,0,.5);border:1px solid rgba(60,45,10,.22)}",
      ".pn-root.is-paused .pn-pad{filter:saturate(.55)}",
      ".pn-glue{flex:none;height:12px;border-radius:3px 6px 0 0;border-bottom:1px dashed rgba(60,45,10,.28);background:linear-gradient(#f1e4a6,#fbf0c0)}",
      ".pn-head{flex:none;padding:8px 12px 6px;display:flex;flex-direction:column;gap:6px}",
      ".pn-title-row{display:flex;align-items:center;gap:8px}",
      ".pn-title{font-family:" + HAND + ";font-size:22px;line-height:1;font-weight:700;color:" + INK + ";background:linear-gradient(transparent 62%,rgba(255,140,90,.45) 62% 88%,transparent 88%);padding:0 4px}",
      ".pn-hand{font-family:" + HAND + ";font-size:15px;color:" + INK + "}",
      // 墨水量尺
      ".pn-gauge{display:flex;flex-direction:column;gap:3px}",
      ".pn-ruler{position:relative;height:12px;border-radius:2px;border:1px solid rgba(60,45,10,.4);background:repeating-linear-gradient(90deg,rgba(60,45,10,.5) 0 1px,transparent 1px 8px) 0 100%/100% 5px no-repeat,repeating-linear-gradient(90deg,rgba(60,45,10,.7) 0 1px,transparent 1px 40px) 0 100%/100% 8px no-repeat,#fff9d6;overflow:hidden}",
      ".pn-hl{position:absolute;left:0;top:0;bottom:0;background:rgba(255,196,0,.55);mix-blend-mode:multiply;transition:width .25s ease}.pn-hl.is-hot{background:rgba(255,80,60,.5)}",
      ".pn-gauge-text{font-size:11px;color:" + INK2 + ";font-variant-numeric:tabular-nums}",
      // 总开关
      ".pn-slide{position:relative;flex:none;width:52px;height:22px;padding:0;border-radius:5px;border:1px solid #6d6753;cursor:pointer;background:linear-gradient(#cfc9b4,#e9e4d2);box-shadow:inset 0 2px 3px rgba(0,0,0,.35),0 1px 0 rgba(255,255,255,.7)}",
      ".pn-slide-print{position:absolute;top:0;bottom:0;display:flex;align-items:center;font-size:9px;font-weight:700;letter-spacing:.06em;color:#6d6753;left:7px;right:auto}.pn-slide.is-on .pn-slide-print{left:auto;right:7px;color:#2a7a3b}",
      ".pn-slide-knob{position:absolute;top:2px;bottom:2px;width:22px;left:2px;border-radius:3px;background:linear-gradient(#fafaf5,#bdb8a4);box-shadow:0 1px 2px rgba(0,0,0,.45),inset 0 1px 0 #fff;transition:left .15s}.pn-slide.is-on .pn-slide-knob{left:calc(100% - 24px)}",
      // 工具条
      ".pn-tools{flex:none;padding:0 12px 6px;display:flex;align-items:center;gap:6px}",
      ".pn-search{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:3px;color:" + INK2 + ";border:1px solid rgba(60,45,10,.3);background:rgba(255,255,255,.55)}.pn-search:focus-within{border-color:#c0561f;background:#fff}",
      ".pn-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:" + INK + ";font:inherit}.pn-search input::placeholder{color:" + INK3 + "}",
      ".pn-kinds{display:flex;gap:4px;flex:none}",
      // 标签机（Dymo）
      ".pn-dymo{flex:none;display:inline-block;height:17px;padding:0 6px;border:0;border-radius:2px;font:700 9.5px/17px " + MONO + ";letter-spacing:.08em;text-transform:uppercase;color:#f4f1e6;background:#2d2f33;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 1px 1px rgba(0,0,0,.35);cursor:default}",
      "button.pn-dymo{cursor:pointer}.pn-dymo.is-muted{opacity:.35}.pn-kindpick{display:flex;gap:4px}.pn-kindpick .pn-dymo{opacity:.45}.pn-kindpick .pn-dymo.is-on{opacity:1;box-shadow:0 0 0 2px #c0561f}",
      ".pn-k-skill{background:#1f4f86}.pn-k-mcp{background:#1f6b3a}.pn-k-sys{background:#6b6a63}",
      // 列表
      ".pn-scroll{flex:1;min-height:0;overflow:auto;padding:6px 12px 14px;display:flex;flex-direction:column;gap:10px;background:repeating-linear-gradient(transparent 0 23px,rgba(70,110,170,.22) 23px 24px) 0 4px;background-attachment:local;border-top:1px solid rgba(60,45,10,.12);position:relative}",
      ".pn-scroll::before{content:'';position:absolute;left:30px;top:0;bottom:0;width:1px;background:rgba(220,70,60,.35);pointer-events:none}",
      ".pn-empty{margin:auto;padding:24px 8px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:" + HAND + ";font-size:14px}",
      ".pn-group{display:flex;flex-direction:column;gap:12px}",
      ".pn-washi{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px 0 7px;margin-left:-2px;border:0;border-left:3px solid rgba(60,45,10,.35);border-radius:0 3px 3px 0;cursor:pointer;font:inherit;font-size:11.5px;font-weight:600;letter-spacing:.02em;color:" + INK + ";background:rgba(60,45,10,.06)}",
      ".pn-g-injected .pn-washi{border-left-color:#3f8a4f}.pn-g-overflow .pn-washi{border-left-color:#b8452f}.pn-g-paused .pn-washi,.pn-g-elsewhere .pn-washi{border-left-color:#9a7b16}.pn-g-off .pn-washi{border-left-color:#8a8676}.pn-g-sys .pn-washi{border-left-color:#6b6a63}",
      ".pn-washi-count{min-width:14px;padding:0 3px;border-radius:7px;background:rgba(60,45,10,.1);font-size:10px;line-height:15px;text-align:center}",
      ".pn-chev{display:grid;transition:transform .15s}.pn-chev.is-collapsed{transform:rotate(-90deg)}",
      ".pn-list{display:flex;flex-direction:column;gap:14px;padding:2px 2px 4px}",
      // —— 一张纸条
      ".pn-slip{position:relative;flex:none;min-height:84px;transform:rotate(var(--pn-r,0deg));transform-origin:50% 0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.24));transition:transform .18s ease,filter .18s ease}",
      ".pn-slip:hover{transform:rotate(calc(var(--pn-r,0deg) * .3)) translateY(-2px);filter:drop-shadow(0 6px 8px rgba(0,0,0,.26))}",
      ".pn-paper{cursor:pointer}.pn-paper:focus-visible{outline:2px solid #c0561f;outline-offset:3px}",
      ".pn-paper{position:relative;min-height:84px;padding:9px 34px 8px 12px;display:flex;flex-direction:column;gap:3px;overflow:hidden;color:" + INK + ";background:repeating-linear-gradient(transparent 0 17px,rgba(60,45,10,.07) 17px 18px),linear-gradient(170deg,var(--pn-paper-a),var(--pn-paper-b));clip-path:polygon(0 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%)}",
      ".pn-paper::after{content:'';position:absolute;right:0;bottom:0;width:14px;height:14px;background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.2) 50%,rgba(255,255,255,.55) 52%)}",
      ".pn-slip-head{display:flex;align-items:center;gap:7px;min-width:0}",
      ".pn-slip-title{flex:1;min-width:0;font-family:" + HAND + ";font-size:16px;line-height:1.15;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pn-slip-title.is-mono,.pn-excerpt.is-mono{font-family:" + MONO + ";font-size:11.5px;font-weight:600}",
      ".pn-excerpt{flex:1;min-height:0;font-family:" + HAND + ";font-size:13px;line-height:1.35;color:" + INK2 + ";overflow:hidden;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:pre-line}.pn-excerpt.is-mono{font-weight:400;-webkit-line-clamp:1;white-space:nowrap;display:block;text-overflow:ellipsis}",
      ".pn-slip-foot{display:flex;align-items:center;gap:6px;min-height:20px;min-width:0}",
      // 橡皮图章
      ".pn-stamp{flex:none;display:inline-block;padding:0 6px;border:1.5px solid currentColor;border-radius:3px;font:700 10.5px/16px " + HAND + ";letter-spacing:.04em;color:#9a2820;opacity:1;background:transparent;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis}",
      ".pn-s-workspace{color:#14487f}.pn-s-session{color:#64288a}.pn-s-global{color:#9a2820}.pn-s-mine{color:#145229}.pn-s-ro{color:#6b6a63}",
      "button.pn-stamp-btn{cursor:pointer;opacity:.45}button.pn-stamp-btn.is-on{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.7),0 0 0 3px currentColor}button.pn-stamp-btn:disabled{opacity:.2;cursor:not-allowed}",
      ".pn-hashtag{flex:none;font-family:" + HAND + ";font-size:11.5px;color:" + INK2 + ";max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".pn-state{font-size:10.5px;color:#85320e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
      ".pn-led{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:" + INK2 + "}.pn-led::before{content:'';width:8px;height:8px;border-radius:50%;background:#9a9a90;box-shadow:inset 0 -1px 2px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.25)}",
      ".pn-led-connected::before{background:radial-gradient(circle at 35% 30%,#b9ffc8,#2fbf57);box-shadow:0 0 5px #46d36e,inset 0 -1px 2px rgba(0,0,0,.3)}.pn-led-connecting::before,.pn-led-reconnecting::before{background:radial-gradient(circle at 35% 30%,#fff0b0,#e8a820);box-shadow:0 0 5px #f0b830}.pn-led-failed::before{background:radial-gradient(circle at 35% 30%,#ffb8b0,#d6362a);box-shadow:0 0 5px #e04a3c}",
      // 未钉住 / 别处生效 / 超预算
      ".pn-slip.is-off{--pn-r:var(--pn-r);transform:rotate(calc(var(--pn-r,0deg) * 1.6 + .6deg)) translateY(3px);transform-origin:10% 0;filter:drop-shadow(0 4px 6px rgba(0,0,0,.22)) saturate(.55) brightness(.97)}",
      ".pn-slip.is-off:hover{transform:rotate(calc(var(--pn-r,0deg) * 1.2 + .3deg)) translateY(0)}",
      ".pn-slip.is-dim .pn-paper{opacity:.72}",
      ".pn-ink-stamp{position:absolute;z-index:3;right:46px;top:26px;padding:1px 8px;border:2px solid #c0392b;border-radius:3px;font:800 12.5px/1.3 " + HAND + ";color:#c0392b;opacity:.85;pointer-events:none}",
      // 图钉
      ".pn-pin{position:absolute;z-index:4;top:-6px;right:10px;width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}",
      ".pn-pin-shadow{position:absolute;left:7px;top:11px;width:16px;height:7px;border-radius:50%;background:rgba(0,0,0,.32);filter:blur(2px);transform:rotate(-20deg);transition:opacity .15s}",
      ".pn-pin-head{position:absolute;left:3px;top:1px;width:17px;height:17px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#ffc0b8 0 14%,#e8493d 40%,#8e1e16 100%);box-shadow:0 2px 3px rgba(0,0,0,.5),inset 0 -2px 3px rgba(0,0,0,.28);transition:transform .15s,background .15s}",
      ".pn-pin:hover .pn-pin-head{transform:translateY(-1px) scale(1.06)}",
      ".pn-pin.is-off .pn-pin-head{transform:scale(.38) translate(6px,10px);background:radial-gradient(circle,#3a3022,#6b5a3a);box-shadow:inset 0 1px 2px rgba(0,0,0,.7)}.pn-pin.is-off .pn-pin-shadow{opacity:0}.pn-pin.is-off:hover .pn-pin-head{transform:scale(.55) translate(4px,6px)}",
      ".pn-pin:focus-visible{outline:2px solid #c0561f;outline-offset:2px;border-radius:50%}",
      ".pn-pin.is-big{position:relative;top:0;right:0;width:30px;height:30px}.pn-pin.is-big .pn-pin-head{left:4px;top:3px;width:21px;height:21px}",
      // 按钮
      ".pn-btn,.pn-icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;padding:0 10px;border-radius:3px;border:1px solid rgba(60,45,10,.4);background:linear-gradient(#fffdf2,#efe6c4);color:" + INK + ";font:inherit;cursor:pointer;box-shadow:0 1px 0 rgba(0,0,0,.2)}",
      ".pn-btn:hover:not(:disabled){background:linear-gradient(#fff,#f5ecca)}.pn-btn:active:not(:disabled){transform:translateY(1px);box-shadow:none}.pn-btn:disabled{opacity:.45;cursor:default}",
      ".pn-icon-btn{width:26px;padding:0;border-color:transparent;background:transparent;box-shadow:none;color:" + INK2 + "}.pn-icon-btn:hover{color:" + INK + ";background:rgba(60,45,10,.1)}.pn-icon-btn.is-spin svg{animation:pn-spin .8s linear infinite}",
      ".pn-btn.is-primary{background:linear-gradient(#e8683a,#c0471f);border-color:#8e2f12;color:#fff}.pn-btn.is-primary:hover:not(:disabled){background:linear-gradient(#f07a4c,#cc5128)}",
      ".pn-btn.is-danger{color:#a3281d;border-color:rgba(163,40,29,.5)}",
      ".pn-btn:focus-visible,.pn-icon-btn:focus-visible,.pn-tab:focus-visible,.pn-washi:focus-visible,.pn-dymo:focus-visible,.pn-slide:focus-visible,.pn-swatch:focus-visible,.pn-scopebtn:focus-visible,.pn-seg-btn:focus-visible,.pn-linkbtn:focus-visible,.pn-stamp-btn:focus-visible{outline:2px solid #c0561f;outline-offset:2px}",
      ".pn-linkbtn{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:2px 0;color:#85320e;font:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline dotted}.pn-linkbtn:hover{color:#c0561f}",
      // 底部：随手写一张
      ".pn-foot{flex:none;padding:8px 12px 10px;display:flex;flex-direction:column;gap:6px;border-top:1px dashed rgba(60,45,10,.3);background:linear-gradient(rgba(255,255,255,.35),transparent)}",
      ".pn-quick{display:flex;gap:6px;align-items:flex-end}",
      ".pn-quick-input{flex:1;min-width:0;min-height:30px;max-height:96px;resize:none;padding:5px 8px;border-radius:2px;border:1px solid rgba(60,45,10,.35);background:rgba(255,255,255,.7);color:" + INK + ";font-family:" + HAND + ";font-size:14px;line-height:1.35;field-sizing:content}.pn-quick-input:focus{outline:0;border-color:#c0561f;background:#fff}.pn-quick-input::placeholder{color:" + INK3 + "}",
      ".pn-foot-row{display:flex;align-items:center;gap:6px}.pn-miniscopes{display:flex;gap:6px}",
      // 弹层（摊开的横线纸）
      ".pn-backdrop{position:absolute;inset:0;z-index:10;display:flex;background:rgba(10,10,12,.45);backdrop-filter:blur(2px)}",
      ".pn-sheet{margin:8px;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;border-radius:4px;color:" + INK + ";background:linear-gradient(#fffdf0,#fbf3d4);box-shadow:0 18px 40px rgba(0,0,0,.5);border:1px solid rgba(60,45,10,.25);overflow:hidden}",
      ".pn-sheet.is-trace{background:linear-gradient(#fbfbf8,#f1f0ea)}",
      ".pn-sheet-head{flex:none;display:flex;align-items:center;gap:8px;padding:9px 10px 8px 12px;border-bottom:1px solid rgba(60,45,10,.2);background:rgba(255,255,255,.3)}",
      ".pn-clip-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:" + MONO + ";font-size:12px}",
      ".pn-sheet-body{flex:1;min-height:0;overflow:auto;padding:12px 12px 12px 36px;display:flex;flex-direction:column;gap:8px;position:relative;background:repeating-linear-gradient(transparent 0 25px,rgba(70,110,170,.2) 25px 26px),linear-gradient(170deg,var(--pn-paper-a),var(--pn-paper-b))}",
      ".pn-sheet-body::before{content:'';position:absolute;left:26px;top:0;bottom:0;width:1px;background:rgba(220,70,60,.4)}",
      ".pn-lined{}",
      ".pn-sheet-foot{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid rgba(60,45,10,.2);background:rgba(255,255,255,.3)}",
      ".pn-input{width:100%;padding:5px 8px;border-radius:2px;border:1px solid rgba(60,45,10,.3);background:rgba(255,255,255,.6);color:" + INK + ";font-family:" + HAND + ";font-size:14px}.pn-input.is-mono{font-family:" + MONO + ";font-size:12px}",
      ".pn-input:focus{outline:0;border-color:#c0561f;background:#fff}.pn-input::placeholder{color:" + INK3 + "}",
      ".pn-input-title{font-weight:700;font-size:17px}",
      ".pn-textarea{flex:1;min-height:150px;resize:vertical;line-height:1.5;font-family:" + MONO + ";font-size:12px}.pn-textarea.is-short{min-height:64px;flex:none}",
      ".pn-label{font-weight:700;font-size:11px;letter-spacing:.06em;color:" + INK2 + ";margin-bottom:4px}",
      ".pn-scopebox{display:flex;flex-direction:column;gap:6px}.pn-scopes{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}",
      ".pn-scopebtn{display:flex;align-items:center;justify-content:center;padding:5px 8px;border-radius:3px;border:1px dashed rgba(60,45,10,.4);background:rgba(255,255,255,.4);color:" + INK + ";font:inherit;cursor:pointer;text-align:left}",
      ".pn-scopebtn.is-on{border-style:solid;border-color:#c0561f;background:#fff;box-shadow:0 0 0 1px #c0561f}",
      ".pn-seg{display:flex;gap:0}.pn-seg-btn{flex:1;height:26px;border:1px solid rgba(60,45,10,.4);background:rgba(255,255,255,.4);color:" + INK + ";font:inherit;cursor:pointer}.pn-seg-btn:first-child{border-radius:3px 0 0 3px}.pn-seg-btn:last-child{border-radius:0 3px 3px 0;border-left:0}.pn-seg-btn.is-on{background:#2d2f33;color:#f4f1e6}",
      ".pn-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0;cursor:pointer;font-weight:600}",
      ".pn-meta{display:flex;flex-direction:column;gap:2px;color:" + INK2 + ";font-size:11px}",
      ".pn-swatches{display:flex;gap:7px}.pn-swatch{width:18px;height:18px;padding:0;border-radius:3px;border:1px solid rgba(60,45,10,.4);background:linear-gradient(170deg,var(--pn-paper-a),var(--pn-paper-b));cursor:pointer;box-shadow:0 1px 1px rgba(0,0,0,.25)}.pn-swatch.is-on{box-shadow:0 0 0 2px #fff,0 0 0 3px #c0561f}",
      ".pn-pre{flex:1;min-height:0;margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:" + MONO + ";font-size:11.5px;line-height:1.55;color:" + INK + "}",
      ".pn-banner{flex:none;padding:6px 12px;font-size:11.5px;color:" + INK2 + "}.pn-banner.is-error{color:#a3281d;background:rgba(214,54,42,.12)}.pn-banner.is-warn{color:#6f3a00;background:rgba(255,170,0,.2);border-radius:2px}",
      ".pn-sys-intro{display:flex;flex-direction:column;gap:2px;padding:4px 2px 2px}.pn-sys-tools{display:flex;align-items:center;gap:6px;font-size:11.5px;color:" + INK2 + "}",
      "@keyframes pn-spin{to{transform:rotate(360deg)}}",
      "@media (prefers-reduced-motion:reduce){.pn-slip,.pn-pin-head,.pn-pin-shadow,.pn-slide-knob,.pn-tab,.pn-hl,.pn-chev{transition:none}.pn-slip:hover{transform:rotate(var(--pn-r,0deg))}.pn-icon-btn.is-spin svg{animation:none}}",
    ].join("\n");

    // ───────────────────────── registration ─────────────────────────
    function TabIcon(size) {
      return h("svg", { width: size || 16, height: size || 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M3 2.5h7.5L13 5v8.5H3zM10.5 2.5V5H13M5.5 8h5M5.5 10.5h3" }));
    }

    function apply(ctx) {
      var effect = function (fn) { if (ctx.effect) ctx.effect(fn); else fn(); };
      effect(function () {
        var old = document.getElementById(STYLE_ID);
        if (old) old.remove();
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
        return function () { style.remove(); };
      });

      var betterSidebar;
      try { betterSidebar = ctx.betterSidebar || (ctx.get ? ctx.get("betterSidebar") : undefined); } catch (e) { betterSidebar = undefined; }
      sidebarApi = betterSidebar || null;
      if (betterSidebar && betterSidebar.registerTab) {
        var disposeTab = betterSidebar.registerTab({
          id: "prompt-notes",
          title: function () { return t("tab"); },
          description: function () { return t("tabDesc"); },
          icon: TabIcon,
          order: 27,
          single: true,
          component: function (props) { return h(Panel, props); },
        });
        effect(function () { return disposeTab; });
      } else {
        console.warn("[dsh-prompt-notes] dsh-better-sidebar not found: the notes tab needs it");
      }

      // 分屏窗格（装了 dsh-tab-split 才有这个槽位；没有就不注册）
      var slots = ctx.slots || (ctx.get ? ctx.get("slots") : undefined);
      if (slots && slots.inject && slots.register) {
        slots.inject("tabsplit.pane", function () {
          return slots.register(
            { name: "tabsplit.pane", id: "prompt-notes-pane", order: 22, label: function () { return t("tab"); } },
            function () { return h(Panel, null); }
          );
        });
      }
    }

    return { inject: ["slots", "betterSidebar"], apply: apply };
  },
});
