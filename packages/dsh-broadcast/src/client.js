/**
 * dsh-broadcast — client half: the speaker switch + voice picker in the composer tool row.
 *
 * The sound comes out of the *host* (afplay / say), so the host owns the switch and this
 * half is only its remote control: read/write `/dsh-broadcast/state` and `/dsh-broadcast/voices`.
 *
 * Three behaviours worth stating:
 * - The switch is optimistic on click, then adopts whatever the host reads back — the host is
 *   the single source of truth (it also persists the value, so a refresh keeps it).
 * - While the host is speaking, the same button turns into "stop".
 * - The voice picker lists the voices the host actually has (each one auditions itself on
 *   click), so there is never a menu item that does nothing.
 *
 * When the host route is missing (old version still loaded) both controls hide themselves
 * instead of offering something that cannot work.
 */
window.__ModuleLoader__.load({
  id: "dsh-broadcast",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

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
    var VOICES_URL = "/dsh-broadcast/voices";
    var STYLE_ID = "dsh-broadcast-style";
    var POLL_MS = 2000;

    var CSS = [
      "@keyframes dbc-pulse{0%,100%{opacity:1}50%{opacity:.45}}",
      ".dbc-row{display:flex;align-items:center;gap:2px;flex:none}",
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
      ".dbc-caret{width:16px;height:28px;padding:0;display:grid;place-items:center;border:none;",
      "background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:6px}",
      ".dbc-caret:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dbc-panel{position:fixed;z-index:2147483000;min-width:210px;max-height:320px;overflow:auto;",
      "padding:6px;border-radius:12px;border:1px solid var(--dsw-alias-border-secondary,#0002);",
      "background:var(--dsw-alias-bg-elevated,#fff);box-shadow:0 8px 28px rgba(0,0,0,.18)}",
      ".dbc-panel-title{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:4px 8px 6px}",
      ".dbc-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:none;",
      "background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;padding:7px 8px;",
      "border-radius:8px;cursor:pointer}",
      ".dbc-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dbc-item[data-current='true']{color:var(--dsw-alias-state-business-primary);font-weight:600}",
      ".dbc-dot{width:5px;height:5px;border-radius:999px;background:currentColor;flex:none;opacity:0}",
      ".dbc-item[data-current='true'] .dbc-dot{opacity:1}",
    ].join("");

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    function SpeakerIcon(props) {
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

    function CaretIcon() {
      return h(
        "svg",
        {
          width: 8, height: 8, viewBox: "0 0 8 8", fill: "none",
          stroke: "currentColor", strokeWidth: 1.3,
          strokeLinecap: "round", strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M1.5 3l2.5 2.5L6.5 3" }),
      );
    }

    function useJson(url) {
      var pair = React.useState(null);
      var value = pair[0];
      var set = pair[1];
      React.useEffect(function () {
        var alive = true;
        fetch(url, { credentials: "same-origin" })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (json) { if (alive && json) set(json); })
          .catch(function () { /* 宿主路由不可用时静默隐藏 */ });
        return function () { alive = false; };
      }, [url]);
      return [value, set];
    }

    function useBroadcastSwitch() {
      var statePair = React.useState(null);
      var state = statePair[0];
      var setState = statePair[1];

      React.useEffect(function () {
        var alive = true;
        function read() {
          fetch(STATE_URL, { credentials: "same-origin" })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (value) {
              if (!alive || !value) return;
              setState(function (prev) {
                return prev && prev.pending === true
                  ? Object.assign({}, value, { pending: true })
                  : value;
              });
            })
            .catch(function () { /* 旧版本还没装好时静默 */ });
        }
        read();
        var timer = setInterval(read, POLL_MS);
        return function () { alive = false; clearInterval(timer); };
      }, []);

      var post = React.useCallback(function (url, body) {
        return fetch(url, {
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
        setState(function (prev) {
          return prev ? Object.assign({}, prev, { enabled: next, pending: true }) : prev;
        });
        post(STATE_URL, { enabled: next }).then(function (value) {
          setState(function (prev) {
            if (value) return Object.assign({}, value, { pending: false });
            return prev ? Object.assign({}, prev, { enabled: !next, pending: false }) : prev;
          });
        });
      }, [state, post]);

      var stop = React.useCallback(function () {
        post(STATE_URL, { stop: true }).then(function (value) {
          if (value) setState(function (prev) { return Object.assign({}, value, { pending: false }); });
        });
      }, [post]);

      return [state, toggle, stop, post, setState];
    }

    function BroadcastSwitch() {
      var hook = useBroadcastSwitch();
      var state = hook[0];
      var toggle = hook[1];
      var stop = hook[2];
      var post = hook[3];
      var setState = hook[4];

      var voicesPair = useJson(VOICES_URL);
      var voices = voicesPair[0];

      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var anchorPair = React.useState(null);
      var anchor = anchorPair[0];
      var setAnchor = anchorPair[1];

      if (!state || state.toggle !== true) return null;

      var enabled = state.enabled === true;
      var speaking = state.speaking === true;
      var currentVoice = (voices && voices.current) || state.voice || "";

      var label;
      if (speaking) {
        label = "语音播报：正在念这一轮的收尾\n点击停止";
      } else if (enabled) {
        label = "语音播报：每轮结束时用两句话讲完这一轮做了什么\n当前已开启 — 点击关闭";
      } else {
        label = "语音播报：每轮结束时用两句话讲完这一轮做了什么\n当前已关闭 — 点击开启";
      }
      var flat = label.replace("\n", " ");

      var buttonProps = {
        type: "button",
        className: "dbc-sw",
        "aria-label": flat,
        "aria-pressed": enabled ? "true" : "false",
        "data-pending": state.pending === true ? "true" : "false",
        "data-speaking": speaking ? "true" : "false",
        onClick: speaking ? stop : toggle,
      };
      if (!Tooltip) buttonProps.title = flat;
      var speaker = h("button", buttonProps, h(SpeakerIcon, { muted: !enabled, speaking: speaking }));

      function openPanel(event) {
        var rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ left: rect.right, top: rect.top });
        setOpen(!open);
      }

      var caret = h("button", {
        type: "button",
        className: "dbc-caret",
        "aria-label": "选择播报音色",
        "aria-expanded": open ? "true" : "false",
        title: "选择播报音色",
        onClick: openPanel,
      }, h(CaretIcon));

      var panel = null;
      if (open && voices && voices.voices && anchor) {
        var items = voices.voices.map(function (voice) {
          return h("button", {
            key: voice.id,
            type: "button",
            className: "dbc-item",
            "data-current": voice.id === currentVoice ? "true" : "false",
            onClick: function () {
              setOpen(false);
              post(VOICES_URL, { voice: voice.id }).then(function (value) {
                if (value) setState(function (prev) { return Object.assign({}, prev, { voice: value.current }); });
              });
            },
          }, h("span", { className: "dbc-dot" }), voice.label);
        });
        panel = h("div", {
          className: "dbc-panel",
          style: {
            left: Math.max(8, Math.min(anchor.left - 214, window.innerWidth - 222)),
            top: Math.max(8, anchor.top - 8),
            transform: "translateY(-100%)",
          },
        }, h("div", { className: "dbc-panel-title" }, "播报音色（点一下试听）"), items);
      }

      var speakerNode = Tooltip ? h(Tooltip, { label: label, side: "top" }, speaker) : speaker;

      return h(
        "span",
        { className: "dbc-row" },
        speakerNode,
        voices && voices.voices ? caret : null,
        panel,
      );
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      installStyles();
      return ctx.slots.inject(SLOT, function () {
        return ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: 100 }, BroadcastSwitch);
      });
    }

    module.exports = { name: "broadcast", inject: ["slots"], apply: apply };
    return module.exports;
  },
});
