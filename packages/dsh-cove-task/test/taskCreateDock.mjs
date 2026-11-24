/**
 * 新会话「创建为飞书任务」勾选条的纯逻辑与接口口径。
 *
 * 这里不渲染 React：组件接线由 test/client.mjs 钉（slot id/order/组件函数），
 * 真正渲染与点击在宿主里验收。此处保证：
 *   1. 任务名输入折叠空白并截断；
 *   2. 界面只有勾选框 + 可选任务名，没有「创建任务」按钮/编号提示；
 *   3. 客户端请求打到正确路由。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createApi } from '../src/client/api.js'
import { normalizeTitleInput, TITLE_MAX } from '../src/client/taskCreateDock.js'

const checks = []
function check(name, fn) {
  try {
    fn()
    checks.push([name, true])
    console.log(`  ok  ${name}`)
  } catch (error) {
    checks.push([name, false])
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

check('任务名：首尾空白与换行折叠', () => {
  assert.equal(normalizeTitleInput('  修复 登录\n问题  '), '修复 登录 问题')
})
check('任务名：空值 / null / undefined 都变成空串（自动命名）', () => {
  assert.equal(normalizeTitleInput(''), '')
  assert.equal(normalizeTitleInput(null), '')
  assert.equal(normalizeTitleInput(undefined), '')
  assert.equal(normalizeTitleInput('   '), '')
})
check('任务名：超过上限截断', () => {
  assert.equal(normalizeTitleInput('一'.repeat(TITLE_MAX + 20)).length, TITLE_MAX)
})

/* 客户端接口：sessionTask 走 GET 查询串，intent 勾选写 POST。 */
{
  const calls = []
  const api = createApi({
    fetchImpl: async (input, init) => {
      calls.push({ input, init })
      return { ok: true, status: 200, async json() { return { ok: true, task: null, intent: null } } }
    },
  })
  await api.sessionTask('session a/b')
  assert.equal(calls[0].input, '/dsh-cove-task/api/sessions/task?sessionId=session%20a%2Fb')
  assert.equal(calls[0].init.method, undefined)
  await api.setTaskCreateIntent('session-1', true, '修复登录', 'P1', '🎯')
  const body = JSON.parse(calls[1].init.body)
  assert.deepEqual(body, { sessionId: 'session-1', enabled: true, title: '修复登录', priority: 'P1', emoji: '🎯', taskId: '' })
  assert.equal(calls[1].input, '/dsh-cove-task/api/sessions/task-intent')
  /* 选了已有任务：只带 taskId，标题/优先级/表情留空（以任务本身为准） */
  await api.setTaskCreateIntent('session-1', true, '', '', '', 'guid-9')
  assert.deepEqual(JSON.parse(calls[2].init.body), { sessionId: 'session-1', enabled: true, title: '', priority: '', emoji: '', taskId: 'guid-9' })
  console.log('  ok  客户端接口：sessionTask / setTaskCreateIntent 路由与 body 口径')
  checks.push(['客户端接口', true])
}

/* 源码口径：E1 徽章条的结构与红线。 */
const component = await readFile(new URL('../src/client/taskCreateDock.js', import.meta.url), 'utf8')
check('没有「创建 / 保存」提交按钮（勾选即生效，没有第二步）', () => {
  assert.equal(component.includes("'创建任务'"), false)
  assert.equal(component.includes("'保存'"), false)
  assert.equal(component.includes("'提交'"), false)
})
check('没有「编号自动生成」这类多余文字', () => {
  assert.equal(component.includes('编号自动生成'), false)
  assert.equal(component.includes('编号生成中'), false)
})
check('来源标记：logo + CoveTask 字样 + 分隔线，占位符说清「留空会自动起名」', () => {
  assert.ok(component.includes("/dsh-cove-task/logo.png"), '要用插件自己的 logo')
  assert.ok(component.includes("'ftc-logo'"))
  assert.ok(component.includes("className: 'ftc-brand'"), '要有 CoveTask 字样')
  assert.ok(component.includes("'CoveTask'"))
  assert.ok(component.includes("className: 'ftc-sep'"))
  assert.ok(component.includes('任务名（可选，留空按会话内容起名）'))
  assert.equal(component.includes('创建为飞书任务'), false, '不写旧标签')
})
check('图块本身就是开关（role=checkbox + aria-checked）', () => {
  assert.ok(component.includes("role: 'checkbox'"))
  assert.ok(component.includes("'aria-checked': checked ? 'true' : 'false'"))
})
check('优先级做成彩色胶囊（点开是图标/优先级浮层），默认 P2', () => {
  assert.ok(component.includes("className: 'ftc-prio-pill'"), '行内是优先级胶囊')
  assert.ok(component.includes("className: 'ftc-prio-pill is-static'"), '绑定态是只读胶囊')
  assert.ok(component.includes('EMOJI_OPTIONS.map'))
  assert.ok(component.includes("h('option', { value: '' }, '默认')"))
  assert.ok(component.includes("h('option', { value: '' }, '无')"))
  assert.ok(component.includes("useState('P2')"), '默认优先级是 P2')
})
check('绑定态有「待绑定」状态胶囊（不提前假装已开始）', () => {
  assert.ok(component.includes("className: 'ftc-pill-state'"))
  assert.ok(component.includes('待绑定'))
  assert.ok(component.includes("icon('timer', 10)"))
})
check('优先级色只从 data-prio 出（与任务卡同一套语义色）', () => {
  assert.ok(component.includes("'data-prio': prioKey"))
  assert.ok(component.includes("PRIORITY_KEYS = ['P0', 'P1', 'P2', 'P3']"))
  assert.ok(component.includes('PRIORITY_KEYS.includes(prioText)'))
})
check('勾选后把 intent 交给宿主，而不是直接建任务', () => {
  assert.ok(component.includes('api.setTaskCreateIntent(sessionId, enabled, normalizeTitleInput(nextTitle), nextPriority || \'\', nextEmoji || \'\', nextTaskId || \'\')'))
  assert.equal(component.includes('promoteSession'), false)
})
check('只在 session.blank 且未绑定任务时出现', () => {
  assert.ok(component.includes('props.session.blank === true'))
  assert.ok(component.includes('data && data.task'))
})
check('勾选后会话开始会自动打开右侧Cove Task 页签', () => {
  assert.ok(component.includes('host.openFeishuTab(sessionId)'))
  assert.ok(component.includes('wasBlank.current = true'))
})

/* E1 结构：一行不变；选任务 / 图标 / 优先级都在浮层里。 */
{
  check('任务条：未勾选是「一句提示 + 建立任务」，勾选后行内出现名字输入', () => {
    assert.ok(component.includes("className: 'ftc-ph'"), '未勾选时的整行提示')
    assert.ok(component.includes("className: 'ftc-start'"), '未勾选时的建立按钮')
    assert.ok(component.includes("className: 'ftc-body'"))
    assert.ok(component.includes("className: 'ftc-input'"))
  })
  check('任务条：选已有是一个图标按钮（不只是文字）', () => {
    assert.ok(component.includes("className: 'ftc-act'"))
    assert.ok(component.includes("icon('list-plus', 14)"))
    assert.ok(component.includes("'aria-label': '选已有任务'"))
  })
  check('任务条：图标全部来自内置 Lucide，没有字符画', () => {
    for (const name of ['sparkles', 'bookmark', 'flag', 'timer', 'list-plus']) {
      assert.ok(component.includes("'" + name + "'"), name + ' 要用 lucide 图标')
    }
    assert.equal(component.includes("'⋯'"), false, '不再用 ⋯ 字符')
    assert.equal(component.includes("'⌕'"), false, '不再用 ⌕ 字符')
  })
  check('任务条：绑定态是只读胶囊（T号 · 标题 · ×），不再伪装成输入框', () => {
    assert.ok(component.includes("className: 'ftc-chip'"))
    assert.ok(component.includes("className: 'ftc-chip-no'"))
    assert.ok(component.includes("className: 'ftc-chip-clear'"))
    assert.ok(component.includes('改成新建任务'))
  })
  check('任务条：选任务是一个浮层（搜索 + 候选 + 新建项 + 空态）', () => {
    assert.ok(component.includes("className: 'ftc-pop'"))
    assert.ok(component.includes("className: 'ftc-search'"))
    assert.ok(component.includes("className: 'ftc-cands'"))
    assert.ok(component.includes('role: \'listbox\''))
    assert.ok(component.includes("role: 'option'"), '每行是 option')
    assert.ok(component.includes('没有匹配的任务'), '空态要有说明')
    assert.ok(component.includes('＋ 新建任务（用上面的名字）'))
  })
  check('任务条：键盘路径（↑↓ 选择、Enter 选中、Esc 关闭）', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      assert.ok(component.includes("'" + key + "'"), key + ' 要处理')
    }
    assert.ok(component.includes("document.addEventListener('mousedown'"), '点外面要能关')
  })
  check('任务条：可访问性（aria-expanded / aria-selected / label）', () => {
    assert.ok(component.includes("'aria-expanded': pop === 'pick'"))
    assert.ok(component.includes("'aria-expanded': pop === 'more'"))
    assert.ok(component.includes("'aria-selected': index === active"))
    assert.ok(component.includes("'aria-label': '搜索任务'"))
  })
  check('任务条：绑定态图标/优先级置灰（以任务为准）', () => {
    assert.equal(component.split('disabled: Boolean(picked)').length - 1, 2, '图标与优先级两处')
    assert.ok(component.includes('以任务为准'))
  })
  check('任务条：绑定时以任务自身的优先级显示（可能不同于当初填的）', () => {
    assert.ok(component.includes('String((picked && picked.priority) || priority'))
  })
  check('任务条：所有 save 调用都带 taskId（漏一个就会把已选任务清掉）', () => {
    const calls = component.match(/save\([^)]*\)/g) || []
    assert.ok(calls.length >= 5, 'save 调用数量不对：' + calls.length)
    /* 第 5 个参数必须是任务 id（组件里形参叫 taskId，changeTask 里传的是局部 id） */
    const missing = calls.filter((row) => !/,\s*(taskId|id)\)$/.test(row))
    assert.deepEqual(missing, [], '这些 save 少了 taskId：' + missing.join(' | '))
  })
  const styleSource = await readFile(new URL('../src/client/taskCreateDockStyles.js', import.meta.url), 'utf8')
  check('任务条样式：一行 36px、浮层、只读胶囊、左缘色带都有规则', () => {
    assert.ok(styleSource.includes('height: 36px'), '一行仍是 36px')
    assert.ok(styleSource.includes('.ftc-pop'))
    assert.ok(styleSource.includes('.ftc-cand.is-active'))
    assert.ok(styleSource.includes('.ftc-chip-no'))
    assert.ok(styleSource.includes('.ftc-edge'))
    assert.ok(styleSource.includes('.ftc-tile'))
    assert.ok(styleSource.includes('prefers-reduced-motion'), '减弱动效要关掉过渡')
  })
  check('任务条样式：字面量颜色只有优先级那 4 个，且只出现在 data-prio 映射里', () => {
    const literals = (styleSource.match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || [])
    assert.deepEqual([...new Set(literals)].sort(), ['#3b82f6', '#94a3b8', '#e5484d', '#f59e0b'])
    /* 每一条都必须挂在 data-prio 的选择器上，不能散落在别处 */
    for (const key of ['P0', 'P1', 'P2', 'P3']) {
      assert.ok(styleSource.includes('.ftc-dock[data-prio="' + key + '"]'), key + ' 的映射')
    }
    assert.equal(/--ftc-prio:\s*#/.test(styleSource.replace(/\.ftc-dock\[data-prio="\w+"\]\s*\{\s*--ftc-prio:\s*#\w+;\s*\}/g, '')), false,
      '优先级色只能出现在 data-prio 映射里')
  })
}

const failed = checks.filter(([, ok]) => !ok)
console.log(`\ntaskCreateDock.mjs: ${checks.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
