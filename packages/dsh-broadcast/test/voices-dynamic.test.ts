import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isKnownVoice,
  listOfflineVoices,
  listVoices,
  parseSayVoices,
  pickUsableVoices,
} from '../lib/voices.js'

/** 真实 `say -v '?'` 输出的节选（含带空格/括号的名字、带质量标记的、非中文的）。 */
const SAMPLE = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Eddy (中文（中国大陆）)  zh_CN    # 你好！我叫Eddy。',
  'Eddy (中文（台湾）)     zh_TW    # 你好，我叫Eddy。',
  'Meijia              zh_TW    # 你好，我叫美佳。',
  'Sinji               zh_HK    # 你好！我叫善怡。',
  'Tingting            zh_CN    # 你好！我叫婷婷。',
  'Tingting (增强)      zh_CN    # 你好！我叫婷婷。',
  'Grandma (英语（美国）)  en_US    # Hello! My name is Grandma.',
].join('\n')

test('解析 say -v "?"：名字带空格与括号也能切开，语言码与质量标记都认', () => {
  const parsed = parseSayVoices(SAMPLE)
  assert.equal(parsed.length, 8)
  const eddy = parsed.find((voice) => voice.name.startsWith('Eddy') && voice.lang === 'zh_CN')
  assert.equal(eddy?.name, 'Eddy (中文（中国大陆）)')
  const enhanced = parsed.find((voice) => voice.name.includes('增强'))
  assert.equal(enhanced?.lang, 'zh_CN')
  assert.equal(enhanced?.quality, '增强')
  assert.equal(parsed.find((voice) => voice.name === 'Tingting')?.quality, undefined)
})

test('解析：脏行直接跳过，不抛', () => {
  assert.deepEqual(parseSayVoices(''), [])
  assert.deepEqual(parseSayVoices('\n\n  \n'), [])
  assert.deepEqual(parseSayVoices('随便一行没有语言码的垃圾'), [])
})

test('排序：中文在前（普通话 > 台湾国语 > 粤语），增强版排在同名前面', () => {
  const picked = pickUsableVoices(parseSayVoices(SAMPLE))
  const ids = picked.map((voice) => voice.id)
  assert.ok(ids.indexOf('say:Tingting (增强)') < ids.indexOf('say:Tingting'), '增强版优先')
  assert.ok(ids.indexOf('say:Meijia') < ids.indexOf('say:Sinji'), '普通话/国语在粤语之前')
  assert.ok(picked.length > 0)
})

test('英文音色最多三个（菜单不该被英文名字淹掉）', () => {
  const many = ['EnOne', 'EnTwo', 'EnThree', 'EnFour', 'EnFive']
    .map((name) => `${name}    en_US    # Hello.`).join('\n')
  const picked = pickUsableVoices(parseSayVoices(`Tingting    zh_CN    # 你好\n${many}`))
  const english = picked.filter((voice) => voice.id.startsWith('say:En'))
  assert.equal(english.length, 3)
  assert.equal(picked.filter((voice) => voice.kind === 'offline').length, 4, '中文的全留下，英文只留 3 个')
})

test('增强版在标签里带出「增强」，好让人知道这是下载过的更高质量版本', () => {
  const picked = pickUsableVoices(parseSayVoices(SAMPLE))
  const enhanced = picked.find((voice) => voice.id.includes('增强'))
  assert.match(enhanced?.label ?? '', /增强/)
})

test('listVoices：在线一档排第一，本机那档是动态的', () => {
  const list = listVoices()
  assert.equal(list[0].kind, 'online')
  assert.ok(list.length >= 2)
  assert.ok(list.filter((voice) => voice.kind === 'offline').length > 0)
})

test('listOfflineVoices：本机真读得到音色；30 秒内走缓存', () => {
  const first = listOfflineVoices({ now: 1_000_000 })
  const second = listOfflineVoices({ now: 1_010_000 })
  assert.ok(first.length > 0)
  assert.deepEqual(second, first, '缓存期内结果一致')
})

test('isKnownVoice：认静态清单、认任意 say: 名字（现读到的音色），不认乱写的', () => {
  assert.equal(isKnownVoice('baidu'), true)
  assert.equal(isKnownVoice('say:Tingting'), true)
  assert.equal(isKnownVoice('say:Some Downloaded Voice (增强)'), true, '系统里新下的音色也该认')
  assert.equal(isKnownVoice('say:'), false)
  assert.equal(isKnownVoice('nonsense'), false)
})
