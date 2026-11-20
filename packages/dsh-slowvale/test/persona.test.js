
import assert from 'node:assert/strict'
import test from 'node:test'
import { CHARACTERS } from '../lib/content/characters.js'
import { personaPrompt } from '../lib/model/persona.js'

test('三个角色的人设能编成 prompt，且彼此不同', () => {
  const prompts = CHARACTERS.map((character) =>
    personaPrompt(character.persona, { channel: 'work', situation: '在便利店结账' }),
  )
  assert.equal(new Set(prompts).size, 3)
  for (const prompt of prompts) {
    assert.match(prompt, /说话方式/)
    assert.match(prompt, /此刻的处境/)
  }
  assert.match(prompts[0] ?? '', /林野/)
  assert.match(prompts[1] ?? '', /小满/)
})
