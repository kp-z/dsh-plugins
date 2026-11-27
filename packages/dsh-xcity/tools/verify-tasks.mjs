#!/usr/bin/env node
/**
 * H6 验收：三张工单真的做完。**只读**——不写世界、不改代码、不启任何进程。
 *
 * 用法：
 *   node tools/verify-tasks.mjs --base http://127.0.0.1:3190 --bridge http://127.0.0.1:7791
 *   node tools/verify-tasks.mjs --base http://127.0.0.1:3190 --timeout 30
 *
 * 判定（ok）：至少一张任务，且每张都有 owner、状态已完成、output 非空。
 * 失败时 stderr 打印卡在哪一步（no-tasks / no-owner / no-output / not-done / timeout / unreachable），退出码 1。
 *
 * --bridge 只回显到 stderr 头，不参与判定：世界快照只有 base 这一个出口。
 */

// [0] 参数：手写解析，不引依赖（与 tools/verify-bridge.mjs 同风格）
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const base = String(arg('base', 'http://127.0.0.1:3190')).replace(/\/+$/, '');
const bridge = arg('bridge', null);
const timeoutSec = Number(arg('timeout', 600));
if (!(Number.isFinite(timeoutSec) && timeoutSec > 0)) {
  console.error('--timeout 必须是正数（秒）');
  process.exit(2);
}

const POLL_MS = 2000;
const REQUEST_MS = 3000;
// 世界的 TaskStatus 用 done；completed 是协议/团队侧的叫法，一起认。
const DONE = new Set(['done', 'completed']);
const IN_FLIGHT = new Set(['pending', 'ready', 'in_progress']);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  return res.json();
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// [1] 轮询 {base}/agent-world/api/world，直到没有 pending/ready/in_progress 或超时
const deadline = Date.now() + timeoutSec * 1000;
let snap = null;
let lastError = null;
while (true) {
  try {
    snap = await getJson(base + '/agent-world/api/world');
    lastError = null;
  } catch (error) {
    lastError = error.message;
  }
  const current = snap === null ? null : snap.world;
  if (current !== null && (current.tasks ?? []).every((task) => !IN_FLIGHT.has(task.status))) break;
  const left = deadline - Date.now();
  if (left <= 0) break;
  await sleep(Math.min(POLL_MS, left));
}

// [2] 统计：status 计数 + 每张的 owner / output / station
const world = snap === null ? null : snap.world;
const tasks = (world === null ? [] : world.tasks ?? []).map((task) => {
  const output = typeof task.output === 'string' ? task.output : '';
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    station: task.station ?? null,
    owner: task.owner ?? null,
    hasOutput: output.trim() !== '',
    outputHead: output.trim() === '' ? null : output.trim().split('\n')[0].slice(0, 80),
  };
});
const byStatus = {};
for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;

// [3] 技能在 persona 存储里（world.agents 没有这个字段），按 agent id 取
const skillsOf = {};
try {
  const personas = await getJson(base + '/agent-world/api/personas');
  for (const persona of personas.personas ?? []) skillsOf[persona.id] = persona.skills ?? [];
} catch {
  // persona 存储没开不算验收失败：agents[].skills 会是空数组，看得见。
}
const agents = (world === null ? [] : world.agents ?? []).map((agent) => ({
  id: agent.id,
  name: agent.name,
  skills: skillsOf[agent.id] ?? [],
  commitments: (agent.commitments ?? []).length,
}));

// [4] 判定 + 卡点
function stuckIds(reason) {
  if (reason === 'no-owner') return tasks.filter((task) => task.owner === null).map((task) => task.id);
  if (reason === 'no-output') return tasks.filter((task) => DONE.has(task.status) && !task.hasOutput).map((task) => task.id);
  if (reason === 'not-done') return tasks.filter((task) => !DONE.has(task.status)).map((task) => task.id);
  if (reason === 'timeout') return tasks.filter((task) => IN_FLIGHT.has(task.status)).map((task) => task.id);
  return [];
}

let reason = null;
if (world === null) reason = 'unreachable';
else if (tasks.length === 0) reason = 'no-tasks';
else if (tasks.some((task) => IN_FLIGHT.has(task.status))) reason = 'timeout';
else if (tasks.some((task) => task.owner === null)) reason = 'no-owner';
else if (tasks.some((task) => !DONE.has(task.status))) reason = 'not-done';
else if (tasks.some((task) => !task.hasOutput)) reason = 'no-output';

const ok = reason === null;
const summary = {
  ok,
  ...(ok ? {} : { reason }),
  ticks: world === null ? null : world.tick,
  byStatus,
  tasks,
  agents,
};
console.log(JSON.stringify(summary, null, 1));

if (!ok) {
  const stuck = stuckIds(reason).join(', ') || '-';
  console.error('VERIFY FAIL ' + reason + ' · 卡在: ' + stuck + ' · base ' + base + (bridge === null ? '' : ' · bridge ' + bridge));
  if (lastError !== null) console.error('最后错误: ' + lastError);
  process.exit(1);
}
