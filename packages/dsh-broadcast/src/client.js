/**
 * dsh-broadcast — client half: the speaker switch in the composer tool row.
 *
 * The sound comes out of the *host* (afplay / say), so the host owns the switch and
 * this half is only its remote control: read/write `/dsh-broadcast/state`.
 *
 * Two behaviours worth stating:
 * - The control is optimistic on click, then adopts whatever the host reads back —
 *   the host is the single source of truth (it also persists the value, so a page
 *   refresh keeps the switch where it was).
 * - While the host is speaking, the same button turns into "stop": one click ends
 *   the announcement. The indicator is polled (2s) rather than pushed, so a broken
 *   route can never leave the button stuck in a lying state.
 *
 * When the host route is missing (e.g. the new version is not loaded yet) the
 * button hides itself instead of offering a control that does nothing.
 */
window.__ModuleLoader__.load({
  id: "dsh-broadcast",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    // 官方 Tooltip（与 composer 里的按钮同款）；拿不到就退回原生 title。
    var Tooltip = null;
    try {
      var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
      Tooltip = primitives && primitives.Tooltip ? primitives.Tooltip : null;
    } catch (error) {
      Tooltip = null;
    }

    var SLOT = "conversation.input.left";
    var ENTRY_ID = "broadcast.switch";
    var STATE_URL = "/dsh-broadcast/state";
    var STYLE_ID = "dsh-broadcast-style";
    var POLL_MS = 2000;

    /* Same geometry as the official composer tool-row buttons (28x28 round), so the
       switch reads as part of the row. States use the existing business pair —
       never a literal colour — so it stays legible in both themes. */
    var CSS = [
      "@keyframes dbc-pulse{0%,100%{opacity:1}50%{opacity:.45}}",
      ".dbc-sw{corner-shape:round;background:transparent;width:28px;height:28px;",
      "color:var(--dsw-alias-label-secondary);cursor:pointer;border:none;border-radius:999px;",
      "flex:none;place-items:center;display:grid;padding:0;position:relative;",
      "transition:background-color .12s ease,color .12s ease}",
      ".dbc-sw:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);",
      "color:var(--dsw-alias-label-primary)}",
      ".dbc-sw:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
      ".dbc-sw[aria-pressed='true']{background:var(--dsw-alias-state-business-tertiary);",
      "color:var(--dsw-alias-state-business-primary)}",
      ".dbc-sw[aria-pressed='true']:hover:not(:disabled){",
      "background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}",
      ".dbc-sw[data-pending='true']{opacity:.55;cursor:default}",
      ".dbc-sw[data-speaking='true']{color:var(--dsw-alias-state-business-primary)}",
      ".dbc-sw[data-speaking='true'] .dbc-wave{animation:dbc-pulse 1.1s ease-in-out infinite}",
      ".dbc-sw[data-speaking='true'] .dbc-wave-2{animation-delay:.18s}",
      ".dbc-sw[data-speaking='true']::after{content:'';position:absolute;inset:2px;border-radius:999px;",
      "border:1.5px solid var(--dsw-alias-state-business-primary);opacity:.5;pointer-events:none}",
    ].join("");

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* Speaker with two waves; muted adds a slash; speaking animates the waves. */
    function Icon(props) {
      var muted = props.muted === true;
      var speaking = props.speaking === true;
      var children = [
        h("path", {
          key: "body",
          d: muted
            ? "M3 6h2.6L9 3.4v7.2L5.6 8H3z"
            : "M2.6 6h2.5L8.3 3.4v9.2L5.1 10H2.6z",
        }),
      ];
      if (muted) {
        children.push(h("path", { key: "slash", d: "M11.4 5.2l3 4.6M14.4 5.2l-3 4.6" }));
      } else {
        children.push(h("path", { key: "w1", className: "dbc-wave", d: "M10.4 5.6a3.1 3.1 0 0 1 0 4.8" }));
        if (speaking) {
          children.push(h("path", { key: "w2", className: "dbc-wave dbc-wave-2", d: "M12.4 3.9a5.6 5.6 0 0 1 0 8.2" }));
        }
      }
      return h(
        "svg",
        {
          width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
          stroke: "currentColor", strokeWidth: 1.3,
          strokeLinecap: "round", strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        children,
      );
    }

    function useBroadcastSwitch() {
      var pair = React.useState(null);
      var state = pair[0];
      var setState = pair[1];

      // 首次读 + 之后定时轮询：宿主是唯一真值来源（刷新页面、别的标签页改了开关都能跟上）
      React.useEffect(function () {
        var alive = true;
        function read() {
          fetch(STATE_URL, { credentials: "same-origin" })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (value) {
              if (!alive || !value) return;
              setState(function (prev) {
                // 保留本地 pending 标记，别让轮询把「刚点下去」的状态覆盖没了
                return prev && prev.pending === true
                  ? Object.assign({}, value, { pending: true })
                  : value;
              });
            })
            .catch(function () { /* 宿主路由不可用（未重启）时静默隐藏 */ });
        }
        read();
        var timer = setInterval(read, POLL_MS);
        return function () { alive = false; clearInterval(timer); };
      }, []);

      var post = React.useCallback(function (body) {
        return fetch(STATE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        })
          .then(function (res) { return res.ok ? res.json() : null; })
          .catch(function () { return null; });
      }, []);

      var toggle = React.useCallback(function () {
        var next = !(state && state.enabled === true);
        // 乐观更新：按钮立刻响应；宿主回读后以真值为准（失败则回滚）
        setState(function (prev) {
          return prev ? Object.assign({}, prev, { enabled: next, pending: true }) : prev;
        });
        post({ enabled: next }).then(function (value) {
          setState(function (prev) {
            if (value) return Object.assign({}, value, { pending: false });
            return prev ? Object.assign({}, prev, { enabled: !next, pending: false }) : prev;
          });
        });
      }, [state, post]);

      var stop = React.useCallback(function () {
        post({ stop: true }).then(function (value) {
          if (value) setState(function (prev) { return Object.assign({}, value, { pending: false }); });
        });
      }, [post]);

      return [state, toggle, stop];
    }

    function BroadcastSwitch() {
      var triple = useBroadcastSwitch();
      var state = triple[0];
      var toggle = triple[1];
      var stop = triple[2];

      if (!state || state.toggle !== true) return null;

      var enabled = state.enabled === true;
      var speaking = state.speaking === true;
      var label;
      if (speaking) {
        label = "语音播报：正在念这一轮的收尾\n点击停止";
      } else if (enabled) {
        label = "语音播报：每轮结束时用两句话讲完这一轮做了什么\n当前已开启 — 点击关闭";
      } else {
        label = "语音播报：每轮结束时用两句话讲完这一轮做了什么\n当前已关闭 — 点击开启";
      }
      var flat = label.replace("\n", " ");

      var props = {
        type: "button",
        className: "dbc-sw",
        "aria-label": flat,
        "aria-pressed": enabled ? "true" : "false",
        "data-pending": state.pending === true ? "true" : "false",
        "data-speaking": speaking ? "true" : "false",
        onClick: speaking ? stop : toggle,
      };
      if (!Tooltip) props.title = flat;
      var button = h("button", props, h(Icon, { muted: !enabled, speaking: speaking }));

      return Tooltip ? h(Tooltip, { label: label, side: "top" }, button) : button;
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      installStyles();
      // 必须 return disposer：槽声明被折叠时会 dispose 这个 effect，连带注销本条目
      return ctx.slots.inject(SLOT, function () {
        return ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: 100 }, BroadcastSwitch);
      });
    }

    module.exports = { name: "broadcast", inject: ["slots"], apply: apply };
    return module.exports;
  },
});
