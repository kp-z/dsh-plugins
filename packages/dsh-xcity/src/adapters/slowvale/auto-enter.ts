/**
 * 自动进入游戏（开发/演示用）。
 *
 * ## 为什么不改构建产物
 *
 * 静态站是逐字节固化的（2401 个文件 + sha256），改它会让"镜像还是不是原来那一份"
 * 永远说不清。所以脚本是**运行时注入**的：适配层在返回 index.html 时插一段 script，
 * 磁盘上的文件一个字节都不动。
 *
 * ## 为什么用"点按钮"而不是直接改路由
 *
 * 前端的准入是分级的：登录 → AI 数据授权 → 新手引导 → 世界 → 角色 → 世界。
 * 直接 history 到 /world/w1 会被守卫踢回角色页，而且 select-role 没调过，游戏内请求全 401。
 * 沿着真实流程走一遍是最不容易错的做法——反正界面文案是冻结的。
 */
export function autoEnterScript(credentials: { email: string; password: string }): string {
  return (
    "(function(){\n" +
    "  var EMAIL = " + JSON.stringify(credentials.email) + ";\n" +
    "  var PASSWORD = " + JSON.stringify(credentials.password) + ";\n" +
    "  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }); };\n" +
    "  function byText(text) {\n" +
    "    return Array.prototype.find.call(document.querySelectorAll('button'), function (b) {\n" +
    "      return (b.innerText || '').trim().indexOf(text) >= 0;\n" +
    "    });\n" +
    "  }\n" +
    "  function setValue(el, value) {\n" +
    "    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;\n" +
    "    setter.call(el, value);\n" +
    "    el.dispatchEvent(new Event('input', { bubbles: true }));\n" +
    "  }\n" +
    "  var busy = false;\n" +
    "  async function step() {\n" +
    "    if (busy) return;\n" +
    "    busy = true;\n" +
    "    try {\n" +
    "      var path = location.pathname;\n" +
    "      if (path.indexOf('/world/') === 0 && !path.endsWith('/roles')) {\n" +
    "        document.documentElement.setAttribute('data-slowvale', 'entered');\n" +
    "        return;\n" +
    "      }\n" +
    "      if (path === '/' || path === '') {\n" +
    "        var inputs = document.querySelectorAll('input');\n" +
    "        if (inputs.length >= 2) {\n" +
    "          setValue(inputs[0], EMAIL);\n" +
    "          setValue(inputs[1], PASSWORD);\n" +
    "          await sleep(150);\n" +
    "          var submit = document.querySelector('button[type=submit]');\n" +
    "          if (submit) submit.click();\n" +
    "        }\n" +
    "        return;\n" +
    "      }\n" +
    "      if (path === '/data-use') { var allow = byText('允许并继续'); if (allow) allow.click(); return; }\n" +
    "      if (path === '/welcome') { var known = byText('我知道了'); if (known) known.click(); return; }\n" +
    "      if (path === '/survey') { var next = byText('继续') || byText('提交'); if (next) next.click(); return; }\n" +
    "      if (path === '/worlds') {\n" +
    "        var card = document.querySelector('.world-card');\n" +
    "        if (card) card.click();\n" +
    "        return;\n" +
    "      }\n" +
    "      if (path.indexOf('/roles') >= 0) {\n" +
    "        var enter = byText('进入游戏');\n" +
    "        if (enter) { enter.click(); return; }\n" +
    "        var role = document.querySelector('.role-card');\n" +
    "        if (role) role.click();\n" +
    "        return;\n" +
    "      }\n" +
    "    } finally {\n" +
    "      busy = false;\n" +
    "    }\n" +
    "  }\n" +
    "  setInterval(function () { step().catch(function () {}) }, 600);\n" +
    "  console.log('[slowvale] 自动进入已启用（账号 ' + EMAIL + '）');\n" +
    "})();\n"
  )
}
