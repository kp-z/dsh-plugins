import assert from 'node:assert/strict'
import { selectTaskList, DEFAULT_TASKLIST_NAME } from '../tasklistSchema.js'
assert.equal(DEFAULT_TASKLIST_NAME, 'DSH 任务清单')
assert.deepEqual(selectTaskList([{ tasklist_guid: 'a' }, { tasklist_guid: 'b' }], 'b'), { guid: 'b', ambiguous: false })
assert.deepEqual(selectTaskList([{ tasklist_guid: 'a' }, { tasklist_guid: 'b' }], ''), { guid: '', ambiguous: true })
assert.deepEqual(selectTaskList([{ tasklist_guid: 'a' }], ''), { guid: 'a', ambiguous: false })
assert.deepEqual(selectTaskList([], ''), { guid: '', ambiguous: false })
assert.deepEqual(selectTaskList([{ tasklist_guid: 'a' }, { tasklist_guid: 'a' }], ''), { guid: 'a', ambiguous: false })
console.log('TASKLIST_SELECT_OK: unique mapping, explicit managed list and ambiguity, no field contract')
