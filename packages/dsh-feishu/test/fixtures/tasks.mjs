/**
 * 任务卡夹具：model / view 测试共用。
 *
 * 覆盖 6 类真实形态：最简（无会话无文档）、全字段、挂起、运行中、重开待同步、无工作区。
 * 时间字段用固定值，避免测试依赖「今天」。
 */
export const NOW = Date.parse('2026-11-15T11:40:00+08:00')

export const minimalTask = {
  id: 't-min',
  no: 25,
  title: '排查访客地图无数据',
  priority: 'P2',
  done: false,
  workspaceTitle: 'blog_dev',
  workspacePath: '/Users/demo/blog_dev',
}

export const fullTask = {
  id: 't-full',
  no: 32,
  title: '更新本地 feishu 插件到最新版本',
  priority: 'P2',
  done: false,
  started: true,
  boundOnly: true,
  start: '2026-11-14 18:19',
  end: '2026-11-20',
  due: '2026-11-20',
  listName: '日常',
  meta: { trigger: 'manual' },
  schedule: { summary: '每周一 09:00', short: '每周一 09:00', nextText: '2026-11-17 09:00', state: 'active' },
  commitment: {
    expectedText: '2026-11-18 18:00',
    expectedAt: Date.parse('2026-11-18T18:00:00+08:00'),
    state: 'soon',
    label: '剩 3.3 天',
    delayCount: 1,
    firstPromiseText: '2026-11-10 18:00',
    syncState: 'pending',
  },
  delayAttribution: { label: '等接口', reason: '飞书接口限流', evidence: '11-10 到 11-12 三次 429' },
  customFields: [
    { name: '优先级', value: 'P2', type: 'text' },
    { name: '模块', value: '插件', type: 'text' },
    { name: '环境', value: 'dev', type: 'text' },
  ],
  members: [
    { id: 'u1', name: '张三', role: 'assignee', avatar: 'https://example.com/a.png' },
    { id: 'u2', name: '李四', role: 'assignee' },
    { id: 'u3', role: 'follower' },
    { id: 'u4', name: '王五', role: 'follower' },
    { id: 'u5', name: '赵六', role: 'follower' },
  ],
  docs: [
    { url: 'https://feishu.cn/docx/abc123', title: '设计稿' },
    { url: 'https://feishu.cn/docx/abc123', title: '设计稿' },
    { url: 'https://feishu.cn/docx/def456' },
  ],
  relations: {
    predecessors: [{ id: 'p1', title: '前置任务' }],
    successors: [],
    sourceTasks: [],
    derivedTasks: [{ id: 'd1', title: '派生任务' }],
  },
  workspaceTitle: 'dsh-plugin',
  workspacePath: '/Users/demo/项目/Proj/dsh-plugin',
  sessionId: 'sess-1',
  sessionAlive: true,
  sessionPhase: 'running',
  sessionUnread: false,
}

export const suspendedTask = {
  id: 't-susp',
  no: 40,
  title: '被挂起的任务',
  done: false,
  suspension: { active: true, reason: '等对方回复' },
}

export const runningTask = {
  id: 't-run',
  no: 41,
  title: '正在跑的任务',
  done: false,
  sessionId: 'sess-run',
  sessionAlive: true,
  sessionPhase: 'running',
}

export const reopenedTask = {
  id: 't-reopen',
  no: 42,
  title: '重开待同步',
  done: false,
  reopenPending: true,
  reopenError: '写回失败',
}

export const noWorkspaceTask = {
  id: 't-nows',
  no: 43,
  title: '没有工作区',
  done: true,
}

export const allFixtures = { minimalTask, fullTask, suspendedTask, runningTask, reopenedTask, noWorkspaceTask }
