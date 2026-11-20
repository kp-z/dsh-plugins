/**
 * 后端注入的调试采集（只在 slowvale.debug 打开时下发）。
 *
 * 不碰前端构建产物：脚本作为额外 <script> 插在 module 之前，
 * 把 console 与未捕获错误收进 window.__svlog。排查"画布在但场景没起来"这类问题时，
 * 第一手信息就是前端自己的日志——而它的 bundle 是压缩混淆的，只能靠运行时抓。
 */
export function debugScript(): string {
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
    '})();',
  ].join('')
}
