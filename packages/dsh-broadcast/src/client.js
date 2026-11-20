/**
 * dsh-broadcast — client half：输入框左侧一个「播报」胶囊，点开是音色菜单。
 *
 * 一个控件，两个用途：
 *   关着时  → [🔇 播报 ▾]，胶囊变淡
 *   开着时  → [🔊 在线女声 ▾]，显示当前音色
 *   播报中  → 同样的胶囊，图标脉冲；菜单顶部一行是开关
 *
 * 为什么把「开关」和「选音色」合成一个按钮：拆成两个相邻控件（图标 + 胶囊）时，
 * 用户看不出该点哪个，视觉上也挤成一团。现在只有一条路径：点胶囊 → 菜单，
 * 菜单第一行就是总开关，往下是音色清单。
 *
 * ## 菜单为什么 portal 到 body
 *
 * 输入框是带 `backdrop-filter` 的玻璃卡片，**它会为 position:fixed 造一个包含块**，
 * 于是 fixed 元素按卡片而不是视口定位——上一版菜单因此飞到屏幕角落。
 * portal 到 document.body 就绕开了这个包含块。
 */
window.__ModuleLoader__.load({
  id: "dsh-broadcast",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    var ReactDOM = null;
    try {
      ReactDOM = require("react-dom");
    } catch (error) {
      ReactDOM = null;
    }

    var SLOT = "conversation.input.left";
    var ENTRY_ID = "broadcast.switch";
    var STATE_URL = "/dsh-broadcast/state";
    var VOICES_URL = "/dsh-broadcast/voices";
    var STYLE_ID = "dsh-broadcast-style";
    var POLL_MS = 2000;
    var PANEL_WIDTH = 244;
    var PANEL_GAP = 10;

    var CSS = [
      "@keyframes dbc-pulse{0%,100%{opacity:1}50%{opacity:.45}}",

      /* 胶囊：与它右边的权限 chip 同高同圆角，但靠"有无边框"区分可交互性 */
      ".dbc-chip{height:26px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;",
      "border-radius:999px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.12));",
      "background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;",
      "font-size:12.5px;font-weight:500;line-height:1;white-space:nowrap;letter-spacing:.01em;",
      "transition:background-color .12s,color .12s,border-color .12s}",
      ".dbc-chip>span{display:block;line-height:1;position:relative;top:-.5px}",  /* 中文字形下沉，微调半个像素 */
      ".dbc-chip:hover{background:var(--dsw-alias-interactive-bg-hover-solid);",
      "color:var(--dsw-alias-label-primary)}",
      ".dbc-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
      /* 开：完全回归中性灰；关：整体压暗，一眼能分辨 */
      ".dbc-chip[data-off='true']{opacity:.55}",
      /* 播报中：填充 + 蓝字，三种状态一眼可分 */
      ".dbc-chip[data-speaking='true']{color:var(--dsw-alias-state-business-primary);",
      "border-color:var(--dsw-alias-state-business-primary);",
      "background:var(--dsw-alias-state-business-tertiary,rgba(47,107,255,.1))}",
      ".dbc-chip svg{flex:none}",
      ".dbc-chip .dbc-caret{opacity:.5;margin-left:1px}",
      ".dbc-chip[data-speaking='true'] .dbc-wave{animation:dbc-pulse 1.05s ease-in-out infinite}",
      ".dbc-chip[data-speaking='true'] .dbc-wave-2{animation-delay:.16s}",

      /* 菜单 */
      ".dbc-panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:" + PANEL_WIDTH + "px;",
      "max-height:min(62vh,360px);overflow:auto;padding:4px;border-radius:14px;",
      "border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.1));",
      "background:var(--dsw-alias-bg-elevated,#fff);",
      "box-shadow:0 12px 40px rgba(0,0,0,.13),0 2px 6px rgba(0,0,0,.06)}",
      ".dbc-panel::-webkit-scrollbar{width:8px}",
      ".dbc-panel::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:8px}",

      /* 顶部开关行 */
      ".dbc-switch{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;",
      "padding:9px 9px;border:none;border-radius:10px;background:transparent;cursor:pointer;",
      "color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.2;text-align:left}",
      ".dbc-switch:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dbc-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}",
      ".dbc-track{width:26px;height:15px;border-radius:999px;flex:none;margin-left:auto;position:relative;",
      "background:var(--dsw-alias-border-secondary,rgba(0,0,0,.18));transition:background-color .16s}",
      ".dbc-track[data-on='true']{background:var(--dsw-alias-state-business-primary)}",
      ".dbc-knob{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:999px;",
      "background:#fff;transition:transform .16s;box-shadow:0 1px 2px rgba(0,0,0,.25)}",
      ".dbc-track[data-on='true'] .dbc-knob{transform:translateX(11px)}",
      ".dbc-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}",
      /* 分组之间用留白分开，不靠线——线多了显得碎 */
      ".dbc-gap{height:10px}",

      /* 分组与条目 */
      ".dbc-group{font-size:11px;font-weight:600;line-height:1;color:var(--dsw-alias-label-tertiary);",
      "padding:10px 9px 2px;letter-spacing:.03em}",
      /* 分组说明紧贴标题，不挂在最后一个条目下面 */
      ".dbc-ghint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);padding:4px 9px 6px}",
      ".dbc-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;",
      "min-height:34px;border:none;background:transparent;color:var(--dsw-alias-label-primary);",
      "font-size:13px;line-height:1.3;padding:7px 9px;border-radius:9px;cursor:pointer;text-align:left}",
      ".dbc-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dbc-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}",
      ".dbc-item[data-current='true']{background:var(--dsw-alias-state-business-tertiary,rgba(47,107,255,.1))}",
      ".dbc-check{width:11px;height:11px;flex:none;margin-left:auto;margin-right:2px;opacity:0;",
      "stroke-width:1.6;color:var(--dsw-alias-state-business-primary)}",
      ".dbc-item[data-current='true'] .dbc-check{opacity:1}",
    ].join("");

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* ---------- 图标（16px 线性，描边 1.35，与 composer 里其它图标同族） ---------- */

    function SpeakerIcon(props) {
      var on = props.on === true;
      var speaking = props.speaking === true;
      var children = [h("path", { key: "body", d: "M2.7 5.9h2.4L8.4 3.4v9.2L5.1 9.9H2.7z" })];
      if (on) {
        children.push(h("path", { key: "w1", className: "dbc-wave", d: "M10.5 5.8a3.1 3.1 0 0 1 0 4.4" }));
        if (speaking) {
          children.push(h("path", { key: "w2", className: "dbc-wave dbc-wave-2", d: "M12.4 4a5.5 5.5 0 0 1 0 8" }));
        }
      } else {
        children.push(h("path", { key: "slash", d: "M10.6 5.9l3.2 4.2M13.8 5.9l-3.2 4.2" }));
      }
      return h("svg", {
        width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
        strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      }, children);
    }

    function CaretIcon() {
      return h("svg", {
        className: "dbc-caret", width: 8, height: 8, viewBox: "0 0 10 10", fill: "none",
        stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": "true",
      }, h("path", { d: "M2.2 4.1L5 6.9l2.8-2.8" }));
    }

    function CheckIcon() {
      return h("svg", {
        className: "dbc-check", viewBox: "0 0 12 12", fill: "none", stroke: "currentColor",
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      }, h("path", { d: "M2.4 6.4l2.2 2.2 5-5.2" }));
    }

    /* ---------- 定位 ---------- */

    /**
     * 最近的、会给 fixed 造成包含块的祖先（transform / filter / backdrop-filter / perspective）。
     * portal 到 body 时用不到；没有 react-dom 时的兜底要把坐标减掉它的位置。
     */
    function containingBlockOf(element) {
      var node = element && element.parentElement;
      while (node && node !== document.body) {
        var style = window.getComputedStyle(node);
        if (
          style.transform !== "none" ||
          style.filter !== "none" ||
          style.backdropFilter !== "none" ||
          style.perspective !== "none" ||
          (style.willChange && style.willChange.indexOf("transform") >= 0)
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    /** 优先在胶囊上方展开；上方放不下且下方放得下就翻到下方；都放不下则贴底并允许滚动。 */
    function panelPosition(rect, panelHeight) {
      var viewportW = window.innerWidth;
      var viewportH = window.innerHeight;
      var left = Math.max(
        PANEL_GAP,
        Math.min(rect.left, viewportW - PANEL_WIDTH - PANEL_GAP),
      );
      var top;
      if (rect.top - PANEL_GAP - panelHeight >= PANEL_GAP) {
        top = rect.top - PANEL_GAP - panelHeight;
      } else if (rect.bottom + PANEL_GAP + panelHeight <= viewportH - PANEL_GAP) {
        top = rect.bottom + PANEL_GAP;
      } else {
        top = Math.max(PANEL_GAP, viewportH - PANEL_GAP - panelHeight);
      }
      return { left: left, top: top };
    }

    /* ---------- 数据 ---------- */

    function useJson(url, pollMs) {
      var pair = React.useState(null);
      var value = pair[0];
      var set = pair[1];
      React.useEffect(function () {
        var alive = true;
        function read() {
          fetch(url, { credentials: "same-origin" })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (json) {
              if (!alive || !json) return;
              set(function (prev) {
                return prev && prev.pending === true ? Object.assign({}, json, { pending: true }) : json;
              });
            })
            .catch(function () { /* 宿主路由不可用（旧版本）时保持隐藏 */ });
        }
        read();
        var timer = pollMs ? setInterval(read, pollMs) : null;
        return function () { alive = false; if (timer) clearInterval(timer); };
      }, [url, pollMs]);
      return [value, set];
    }

    function post(url, body) {
      return fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    }

    /* ---------- 菜单 ---------- */

    function VoiceMenu(props) {
      var anchorRef = props.anchorRef;
      var panelRef = React.useRef(null);
      var posPair = React.useState(null);
      var pos = posPair[0];
      var setPos = posPair[1];

      React.useLayoutEffect(function () {
        function place() {
          var trigger = anchorRef.current;
          if (!trigger) return;
          var rect = trigger.getBoundingClientRect();
          var height = panelRef.current ? panelRef.current.offsetHeight : 300;
          var next = panelPosition(rect, height);
          if (!props.ported) {
            var block = containingBlockOf(trigger);
            if (block) {
              var blockRect = block.getBoundingClientRect();
              next = { left: next.left - blockRect.left, top: next.top - blockRect.top };
            }
          }
          setPos(next);
        }
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return function () {
          window.removeEventListener("resize", place);
          window.removeEventListener("scroll", place, true);
        };
      }, [anchorRef, props.ported]);

      React.useEffect(function () {
        function onKey(event) {
          if (event.key === "Escape") props.onClose();
        }
        function onDown(event) {
          var panel = panelRef.current;
          if (panel && panel.contains(event.target)) return;
          if (anchorRef.current && anchorRef.current.contains(event.target)) return;
          props.onClose();
        }
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown, true);
        return function () {
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onDown, true);
        };
      }, [props, anchorRef]);

      var online = [];
      var offline = [];
      for (var i = 0; i < props.voices.length; i += 1) {
        (props.voices[i].kind === "offline" ? offline : online).push(props.voices[i]);
      }

      function item(voice) {
        var current = voice.id === props.current;
        return h("button", {
          key: voice.id,
          type: "button",
          role: "menuitemradio",
          "aria-checked": current ? "true" : "false",
          className: "dbc-item",
          "data-current": current ? "true" : "false",
          onClick: function () { props.onPick(voice.id); },
        }, h("span", null, voice.label), h(CheckIcon));
      }

      var children = [
        h("button", {
          key: "switch",
          type: "button",
          role: "switch",
          "aria-checked": props.enabled ? "true" : "false",
          className: "dbc-switch",
          onClick: props.onToggle,
        },
          h("span", null, "自动播报"),
          h("span", { className: "dbc-track", "data-on": props.enabled ? "true" : "false" },
            h("span", { className: "dbc-knob" }))),
        h("div", { key: "sep", className: "dbc-sep" }),
        h("div", { key: "g-online", className: "dbc-group" }, "在线音色"),
        h("div", { key: "h-online", className: "dbc-ghint" }, "神经网络合成，中文最自然"),
      ];
      for (var j = 0; j < online.length; j += 1) children.push(item(online[j]));
      children.push(h("div", { key: "gap", className: "dbc-gap" }));
      children.push(h("div", { key: "g-offline", className: "dbc-group" }, "本机音色 · 离线"));
      children.push(h("div", { key: "h-offline", className: "dbc-ghint" }, "系统自带，断网可用，语调偏机械"));
      for (var k = 0; k < offline.length; k += 1) children.push(item(offline[k]));

      return h("div", {
        ref: panelRef,
        className: "dbc-panel",
        role: "menu",
        style: pos === null ? { left: -9999, top: 0, visibility: "hidden" } : { left: pos.left, top: pos.top },
      }, children);
    }

    /* ---------- 主组件 ---------- */

    function BroadcastControls() {
      var statePair = useJson(STATE_URL, POLL_MS);
      var state = statePair[0];
      var setState = statePair[1];
      var voicesPair = useJson(VOICES_URL, 0);
      var voicesData = voicesPair[0];
      var voicesSet = voicesPair[1];

      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var chipRef = React.useRef(null);

      var closeMenu = React.useCallback(function () { setOpen(false); }, []);

      if (!state || state.toggle !== true) return null;

      var enabled = state.enabled === true;
      var speaking = state.speaking === true;
      var current = state.voice || (voicesData && voicesData.current) || "";
      var voices = (voicesData && voicesData.voices) || [];
      var currentLabel = "";
      for (var i = 0; i < voices.length; i += 1) {
        if (voices[i].id === current) currentLabel = voices[i].label;
      }
      // 文案始终是音色名：状态变化时文字宽度不跳，靠图标（斜杠/脉冲）与底色表达开与关
      if (currentLabel === "") currentLabel = "播报";

      function applyState(value, revert) {
        setState(function (prev) {
          if (value) return Object.assign({}, value, { pending: false });
          return revert && prev ? Object.assign({}, prev, { pending: false }) : prev;
        });
      }

      function toggle() {
        var next = !enabled;
        setState(function (prev) { return prev ? Object.assign({}, prev, { enabled: next, pending: true }) : prev; });
        post(STATE_URL, { enabled: next }).then(function (value) { applyState(value, true); });
      }

      function stopPlayback() {
        post(STATE_URL, { stop: true }).then(function (value) { applyState(value, false); });
      }

      function pick(voiceId) {
        setState(function (prev) { return prev ? Object.assign({}, prev, { voice: voiceId }) : prev; });
        post(VOICES_URL, { voice: voiceId }).then(function (value) {
          if (value) voicesSet(Object.assign({}, value, { current: value.current }));
        });
      }

      var label = speaking
        ? "正在播报这一轮的收尾 · " + currentLabel
        : enabled
          ? "语音播报已开启 · " + currentLabel
          : "语音播报已关闭 · " + currentLabel;

      var chipProps = {
        type: "button",
        ref: chipRef,
        className: "dbc-chip",
        "aria-label": label + "（点击打开播报设置）",
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        "data-on": enabled ? "true" : "false",
        "data-off": enabled ? "false" : "true",
        "data-speaking": speaking ? "true" : "false",
        title: label,
        onClick: function () { setOpen(!open); },
      };
      var chip = h("button", chipProps,
        h(SpeakerIcon, { on: enabled, speaking: speaking }),
        h("span", null, currentLabel),
        h(CaretIcon));

      var menu = null;
      if (open && voices.length > 0) {
        var panel = h(VoiceMenu, {
          voices: voices,
          current: current,
          enabled: enabled,
          speaking: speaking,
          onToggle: toggle,
          onPick: pick,
          onClose: closeMenu,
          anchorRef: chipRef,
          ported: !!(ReactDOM && typeof ReactDOM.createPortal === "function"),
        });
        menu = ReactDOM && typeof ReactDOM.createPortal === "function"
          ? ReactDOM.createPortal(panel, document.body)
          : panel;
      }

      return h("span", { style: { display: "inline-flex", flex: "none" } }, chip, menu);
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      installStyles();
      return ctx.slots.inject(SLOT, function () {
        return ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: 100 }, BroadcastControls);
      });
    }

    module.exports = { name: "broadcast", inject: ["slots"], apply: apply };
    return module.exports;
  },
});
