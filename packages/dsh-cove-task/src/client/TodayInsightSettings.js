const MAX_BUTTONS = 6
const MAX_LABEL_LENGTH = 12

function defaultPromptFor(kind, promptDefaults) {
  if (kind === 'export') return ''
  return promptDefaults[kind === 'morning' ? 'morning' : 'insight'] || ''
}

function newInsightButton(buttons) {
  let suffix = Date.now() % 100000
  while (buttons.some(({ id }) => id === `btn${suffix}`)) suffix += 1
  return { id: `btn${suffix}`, label: '新按钮', prompt: null, kind: 'ai' }
}

/** Mount when the settings open; onSave persists the patch and refreshes the settings props. */
export function createTodayInsightSettings({ React, h }) {
  const { useState } = React

  return function TodayInsightSettings({ buttons = [], ignore = [], promptDefaults = {}, onSave, onClose }) {
    const [draft, setDraft] = useState(null)
    const [saving, setSaving] = useState(false)
    const [status, setStatus] = useState('')
    const current = draft ?? {
      ignoreText: ignore.join(', '),
      buttons: buttons.map(({ id, label, prompt, kind }) => ({
        id, label, prompt: (prompt || '').trim() || null, kind: kind || 'ai',
      })),
    }

    function editDraft(update) {
      setDraft(previous => update(previous ?? current))
      setStatus('')
    }

    function editButtons(update) {
      editDraft(previous => ({ ...previous, buttons: update(previous.buttons) }))
    }

    function editButton(id, changes) {
      editButtons(list => list.map(button => button.id === id ? { ...button, ...changes } : button))
    }

    async function save(thenClose) {
      if (saving) return
      const patch = {
        insightIgnore: current.ignoreText.split(/[,，]/).map(word => word.trim()).filter(Boolean),
        insightButtons: current.buttons.map(({ id, label, prompt, kind }) => {
          const text = (prompt ?? '').trim()
          return { id, label, prompt: text === defaultPromptFor(kind, promptDefaults).trim() ? '' : text, kind }
        }),
      }
      setSaving(true)
      setStatus('')
      try {
        await onSave(patch)
      } catch {
        setStatus('保存失败')
        return
      } finally {
        setSaving(false)
      }
      setDraft(null)
      setStatus('已保存')
      if (thenClose) onClose()
    }

    function action(label, onClick, { primary = false, disabled = false } = {}) {
      return h('button', {
        type: 'button', className: primary ? 'fd-ai-btn' : 'fd-ai-jump', disabled: saving || disabled, onClick,
      }, label)
    }

    function renderButton({ id, label, prompt, kind }) {
      return h('div', { key: id, className: 'fd-today-settings-row' },
        h('div', { className: 'fd-today-actions' },
          h('input', {
            className: 'fd-today-field', type: 'text', value: label, disabled: saving,
            placeholder: '按钮文字', 'aria-label': '按钮文字', maxLength: MAX_LABEL_LENGTH,
            onChange: event => editButton(id, { label: event.target.value }),
          }),
          action('删除', () => editButtons(list => list.filter(button => button.id !== id)), {
            disabled: current.buttons.length <= 1,
          })),
        kind === 'export'
          ? null
          : h(React.Fragment, null,
            h('textarea', {
              className: 'fd-today-field', rows: 8, spellCheck: false, disabled: saving,
              'aria-label': label ? label + '的 Prompt' : '按钮 Prompt',
              value: prompt ?? defaultPromptFor(kind, promptDefaults),
              onChange: event => editButton(id, { prompt: event.target.value }),
            }),
            h('div', { className: 'fd-today-actions' }, action('恢复默认', () => editButton(id, { prompt: null })))))
    }

    return h('div', { className: 'fd-today-settings' },
      h('div', { className: 'fd-today-settings-head fd-today-actions' },
        h('strong', null, '洞察设置'),
        action('完成', () => save(true), { primary: true })),
      h('label', null,
        '忽略关键词（逗号分隔）',
        h('input', {
          className: 'fd-today-field', type: 'text', value: current.ignoreText, disabled: saving,
          onChange: event => {
            const ignoreText = event.target.value
            editDraft(previous => ({ ...previous, ignoreText }))
          },
        })),
      current.buttons.map(renderButton),
      h('div', { className: 'fd-today-actions' },
        action('+ 添加按钮', () => {
          const button = newInsightButton(current.buttons)
          editButtons(list => [...list, button])
        }, { disabled: current.buttons.length >= MAX_BUTTONS })),
      h('div', { className: 'fd-today-actions' },
        action('保存', () => save(false), { primary: true }),
        action('全部恢复默认 Prompt', () => {
          editButtons(list => list.map(button => ({ ...button, prompt: null })))
        }),
        h('span', { className: 'fd-today-settings-status', role: 'status' }, status)))
  }
}
