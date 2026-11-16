import assert from 'node:assert/strict'
import { tasklistFields, selectTaskList, schemaSignature } from '../tasklistSchema.js'
const fields = tasklistFields({}, ['A','A','B'])
assert.equal(fields.length, 12)
assert.equal(fields.find(f=>f.key==='eta').type,'text')
assert.equal(fields.find(f=>f.key==='startCol').type,'datetime')
/* 旧清单的日期列可能是 text；schema 只读不改，初始化要能沿用。 */
for (const key of ['startCol','endCol']) assert.ok(fields.find(f=>f.key===key).accepts.includes('text'), key + ' 应接受旧的文本日期列')
assert.deepEqual(fields.find(f=>f.key==='workspace').options,['A','B'])
assert.throws(()=>tasklistFields({taskFields:{doc:'工作区'}}), /重复/)
assert.deepEqual(selectTaskList([{tasklist_guid:'a'},{tasklist_guid:'b'}],'b'),{guid:'b',ambiguous:false})
assert.deepEqual(selectTaskList([{tasklist_guid:'a'},{tasklist_guid:'b'}],''),{guid:'',ambiguous:true})
assert.deepEqual(selectTaskList([{tasklist_guid:'a'}],''),{guid:'a',ambiguous:false})
assert.notEqual(schemaSignature({}),schemaSignature({taskFields:{eta:'ETA'}}))
console.log('TASKLIST_SCHEMA_OK: complete contract, unique mappings, explicit managed list and ambiguity')
