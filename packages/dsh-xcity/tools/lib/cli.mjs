/**
 * tools 共用的 CLI 骨架（R529 减法：13 个脚本里抄了 2~12 份的同一段代码，收成一份）。
 *
 * 收进来的标准：**两份以上、语义已经完全一致**。所以这里只有纯骨架：
 *   [0] arg / baseUrl   手写参数解析、base 去尾斜杠 —— 12 / 11 份拷贝
 *   [1] getJson         带超时的 GET，错误归一成 `<url> → HTTP <status> <body 前 120 字>` —— 11 份
 *   [2] emit / fail     输出契约：结果 JSON 进 stdout，按退出码退出；失败体固定 {ok:false, reason}
 *   [3] failVerify      「VERIFY FAIL …」一行卡点进 stderr、退出码 1 —— 9 份
 *   [4] sleep           轮询等待 —— 4 份
 *   [5] percentile      最近秩分位数（空数组返回 null：量不到 ≠ 0）—— 3 份
 *
 * 明确**不收**的：JSON 缩进、抽样窗口、卡点(stuck)文案、世界快照的领域形状（world/agents/tasks）。
 * 那些是每个脚本自己的口径，收进公共件只会把差异藏进参数里——那是加法不是减法。
 */

// [0] 参数：`--name value`，只给 flag 不给值时返回 true，没出现时返回 fallback。
export function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

// [0a] base：缺省打本机宿主，尾斜杠一律去掉（拼路径时不出现双斜杠）。
export function baseUrl(fallback = 'http://127.0.0.1:3190') {
  return String(arg('base', fallback)).replace(/\/+$/, '');
}

// [1] GET 一次 JSON：超时由调用方给（每个脚本的取样窗口不同），HTTP 非 2xx 一律抛。
export async function getJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  return res.json();
}

// [2] 结果 JSON 进 stdout 并按退出码退出。stdout 是下游在用的机器接口，缩进由调用方给（各脚本不同）。
export function emit(payload, code, indent = 2) {
  process.stdout.write(JSON.stringify(payload, null, indent) + '\n');
  process.exit(code);
}

// [2a] 失败体：形状固定 { ok: false, reason, ...extra }，退出码 1。
export function fail(reason, extra = {}) {
  emit({ ok: false, reason, ...extra }, 1);
}

// [3] 核对脚本的失败收尾：一行 `VERIFY FAIL <reason> · 卡在: <stuck> · base <base><tail>`，
//     有抓取错误再补一行「最后错误」，退出码 1。tail 留给脚本拼自己的上下文（bridge / state）。
export function failVerify(reason, { stuck = '-', base = null, tail = '', error = null } = {}) {
  console.error('VERIFY FAIL ' + reason + ' · 卡在: ' + stuck + (base === null ? '' : ' · base ' + base) + tail);
  if (error !== null) console.error('最后错误: ' + error);
  process.exit(1);
}

// [4] 等待：轮询间隔都是几百毫秒到几秒，不需要可取消。
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// [5] 最近秩分位数：percent 取 0..100；先排序是调用方的责任。
export function percentile(sorted, percent) {
  if (sorted.length === 0) return null;
  const index = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}
