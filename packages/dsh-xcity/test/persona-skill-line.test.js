/**
 * R542 集成：成长那一行必须真的出现在人设提示词里，而且是「有记录才出现」。
 *
 * 为什么单独一个文件：skills.ts 的单测只证明函数返回值，没证明它被拼进 prompt；
 * 而 prompt 是唯一让模型知道自己练过什么的通道——断在这里等于成长对模型不可见。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCharacterSystemPrompt } from '../lib/bridge/persona-prompt.js'

const seat = {
  name: 'kp',
  role: 'lead',
  palette: 'skin.role.lead',
  appearance: 'model.agent.mv-tom',
  persona: '带团队的人，先看约束再动手。',
  speechStyle: '句子短，先给结论。',
}

const facts = {
  worldName: '小镇',
  tick: 100,
  state: 'idle',
  stationName: null,
  taskTitle: null,
  walkingTo: null,
}

test('有 skillLine 时提示词里有近期手感这一行，且落在事实区之后', () => {
  const prompt = buildCharacterSystemPrompt(seat, { ...facts, skillLine: '近期手感：工程 2 级（练了 11 次）' })
  assert.match(prompt, /近期手感：工程 2 级（练了 11 次）/)
  assert.ok(prompt.indexOf('此刻的事实') < prompt.indexOf('近期手感'), '这一行应当落在事实区之后')
})

test('skillLine 为空或 null 或缺省时不出现空行，也不出现 0 级这种虚构资历', () => {
  for (const value of [null, undefined, '']) {
    const prompt = buildCharacterSystemPrompt(seat, { ...facts, skillLine: value })
    assert.doesNotMatch(prompt, /近期手感/)
    assert.doesNotMatch(prompt, /0 级/)
  }
})

test('确定性：同样入参两次拼出来的 prompt 一字不差', () => {
  const a = buildCharacterSystemPrompt(seat, { ...facts, skillLine: '近期手感：工程 1 级（练了 5 次）' })
  const b = buildCharacterSystemPrompt(seat, { ...facts, skillLine: '近期手感：工程 1 级（练了 5 次）' })
  assert.equal(a, b)
})