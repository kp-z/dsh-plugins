/**
 * 后端注入的调试采集（只在 slowvale.debug 打开时下发）。
 *
 * 不碰前端构建产物：脚本作为额外 <script> 插在 module 之前，
 * 把 console 与未捕获错误收进 window.__svlog。排查"画布在但场景没起来"这类问题时，
 * 第一手信息就是前端自己的日志——而它的 bundle 是压缩混淆的，只能靠运行时抓。
 */
export function debugScript(forceVisible = false): string {
  return [
    '(function(){',
    'var log = window.__svlog = [];',
    'function push(kind, args) {',
    '  try {',
    '    log.push(kind + ": " + Array.prototype.map.call(args, function (a) {',
    '      if (typeof a === "string") return a;',
    '      if (a instanceof Error) return (a.name + ": " + a.message + " | " + String(a.stack || "").slice(0, 700));',
    '      if (a && a.message) return String(a.name || "Error") + ": " + a.message + " | " + String(a.stack || "").slice(0, 700);',
    '      try { return JSON.stringify(a) } catch (e) { return String(a) }',
    '    }).join(" ").slice(0, 500));',
    '    if (log.length > 800) log.shift();',
    '  } catch (e) {}',
    '}',
    '["log", "info", "warn", "error", "debug"].forEach(function (level) {',
    '  var original = console[level];',
    '  console[level] = function () { push(level, arguments); return original && original.apply(console, arguments) };',
    '});',
    'window.addEventListener("error", function (e) { push("onerror", [e.message]) });',
    'window.addEventListener("unhandledrejection", function (e) { push("rejection", [String(e.reason && (e.reason.message || e.reason))]) });',
    // 画布探针：回答"到底有没有人试图建 canvas / 谁在什么时候插进来的"。
    // 只在 debug 打开时下发，不进入正式产物。
    // 仅用于本机调试：无头/后台窗口里 visibilityState 是 hidden，
    // 前端就不建 Phaser 游戏。这个开关只是把"看不见的窗口"当成"看得见"，不改任何前端代码。
    ...(forceVisible ? [
      'Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "visible" } });',
      'Object.defineProperty(document, "hidden", { configurable: true, get: function () { return false } });',
      'push("visibility", ["forced visible"]);',
    ] : []),
    'var created = 0;',
    'var originalCreate = document.createElement.bind(document);',
    'document.createElement = function (tag) {',
    '  var el = originalCreate(tag);',
    '  if (String(tag).toLowerCase() === "canvas") {',
    '    push("canvas", ["createElement " + String(new Error().stack || "").split(String.fromCharCode(10)).slice(1, 4).join(" <- ")]);',
    '  }',
    '  return el;',
    '};',
    'var originalGetContext = HTMLCanvasElement.prototype.getContext;',
    'HTMLCanvasElement.prototype.getContext = function () {',
    '  created += 1;',
    '  push("canvas", ["getContext #" + created + " " + this.width + "x" + this.height + " parent=" + (this.parentElement && this.parentElement.className || "none")]);',
    '  return originalGetContext.apply(this, arguments);',
    '};',
    'new MutationObserver(function (records) {',
    '  records.forEach(function (record) {',
    '    Array.prototype.forEach.call(record.addedNodes, function (node) {',
    '      if (node && node.nodeName === "CANVAS") push("canvas", ["inserted " + node.width + "x" + node.height + " into " + (node.parentElement && node.parentElement.className || "none")]);',
    '      else if (node && node.nodeName === "DIV" && node.className === "phaser-canvas") push("canvas", ["phaser-canvas container appeared"]);',
    '    });',
    '    if (record.type === "childList" && record.target && record.target.className === "phaser-canvas") push("canvas", ["phaser-canvas children " + record.target.childElementCount]);',
    '  });',
    '}).observe(document.documentElement, { childList: true, subtree: true });',
    // 心跳：把"父元素尺寸 / canvas 数 / 字体状态"打成时间线，
    // 用来判断是不是"创建那一刻父元素尺寸为 0"这种一次性守门。
    'var beat = 0;',
    'var timer = setInterval(function () {',
    '  beat += 1;',
    '  var stage = document.querySelector(".fishtank__stage");',
    '  var host = document.querySelector(".phaser-canvas");',
    '  push("beat", [beat + " canvas=" + document.querySelectorAll("canvas").length +',
    '    " stage=" + (stage ? stage.clientWidth + "x" + stage.clientHeight : "none") +',
    '    " hostChildren=" + (host ? host.childElementCount : "none") +',
    '    " fonts=" + (document.fonts ? document.fonts.status : "?")]);',
    '  if (beat >= 40) clearInterval(timer);',
    '}, 500);',
    '})();',
  ].join('')
}
