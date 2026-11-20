# dsh-broadcast

**Every turn ends, DSH says what it did — out loud.** Two or three sentences of plain
spoken Chinese, in a voice close to a human's, played from the host (no browser tab
needed). A speaker button in the composer turns it on and off.

## Why "rewrite, then speak" instead of reading the reply

Measured on real turns from this workspace (macOS `say` + `afinfo`, 205 wpm):

| Reply | Read raw | After rewrite |
| --- | --- | --- |
| 4 903 chars | **261 s** | **7.5 s** |
| 4 570 chars | **345 s** | **14.8 s** |
| 4 208 chars | **329 s** | **13.4 s** |

Raw replies are full of code fences, paths and tables; a path comes out as
"s r c slash auth slash retry dot t s". So the pipeline is always:
**collect the turn → let the host model say it in 2–3 sentences → speak that**.

## What it does per turn

1. Listens to `session/event` and accumulates the turn's `assistant/message` text and tool names.
2. On `turn/end` it decides whether to speak: switch on, reply long enough (≥ 30 chars),
   not a subagent session (unless enabled), not within the 2 s debounce, not in quiet hours.
   Error / aborted / blocked turns get one short sentence instead of the summary.
3. Asks the **host's own model** (`ctx.get('llm').stream()`, route from
   `agentDefaultModel.currentSelection()`) for 2–3 spoken sentences, ≤ 80 chars.
   If the model is missing, slow (6 s), or returns nothing, it falls back to the cleaned
   first paragraph, then to the first sentence of the raw reply.
4. Speaks it with the **online neural voice** (Baidu's free TTS endpoint — no key
   needed), falling back to the macOS system `say` only if the online synthesis fails.
   Audio lands in `os.tmpdir()/dsh-broadcast/` and is deleted right after playback.
5. Playback is serialised: two sessions ending at once never overlap; a new announcement
   can be stopped from the composer button.

## One chip: switch + voice

A single 28 px round button in `conversation.input.left` — the same size as the composer's
own icon buttons, so it costs no extra width. Clicking it opens one menu that holds both
controls: the **automatic-announce switch** on top, then the voice list.

One button instead of a label + caret: the label was the widest thing in the tool row and
said something the menu can say better. State is carried by the icon alone — slashed and
dimmed when off, waves pulsing with a tinted background while speaking — so the button
never changes size. The current voice is in the tooltip and, of course, in the menu.

The host owns both values (persisted at `$DSH_PROFILE_DIR/broadcast/state.json`, so a page
refresh and a restart keep them); the button is a remote control — optimistic on click, then
it adopts whatever the host reads back.

Every entry in the list is a voice that really exists on this machine, and clicking one
switches to it **and speaks a sample immediately** — you hear the choice instead of guessing
from a name. Picking an offline voice really means offline: no hidden substitution.

## Configuration

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `false` | Master switch. Off by default: install quietly, listen once, then turn it on. |
| `voice` | `zh-CN-XiaoxiaoNeural` | edge-tts voice. Any of its Chinese voices works. |
| `sayVoice` | `''` | The offline voice you actually hear (a `say -v` name). Empty = derive from `voice`. The picker in the composer writes this. |
| `rate` | `'+8%'` | Speech rate (edge-tts `+N%`; converted to `say -r` on fallback). |
| `volume` | `100` | Volume 0–100 (SSML prosody). |
| `voiceId` | `''` | Which voice to use: `baidu` (online) or `say:<name>` (offline). The picker writes this. |
| `engine` | `auto` | `auto` follows `voiceId` (online, falling back to `say`); `edge` / `baidu` / `say` force one engine, and a forced engine fails loudly instead of substituting. |
| `maxChars` | `80` | Spoken-length cap. 80 chars ≈ 16 s — longer is "can't stand it", not "can't finish it". |
| `minChars` | `30` | Replies shorter than this are not worth a voice. |
| `announceSubagent` | `false` | Also announce subagent sessions. |
| `announceFailure` | `true` | One short sentence when a turn errors / is aborted / is blocked. |
| `quietHours` | `''` | Local-time window such as `23:00-08:00`; empty disables. |
| `debounceMs` | `2000` | Minimum gap between announcements in one session. |
| `useModel` | `true` | Ask the host model to rewrite. Off = local truncation only. |
| `modelTimeoutMs` | `6000` | Model budget. Hitting it falls back to local text — never blocks playback. |

## Install

```bash
dsh plugin --profile web add file:packages/dsh-broadcast
# then restart dsh
```

The packaged desktop app has no `dsh` on PATH, and **it usually runs the `desktop` profile, not
`web`** — install into the profile your app actually boots, or the button will never appear:

```bash
node packages/dsh-broadcast/scripts/link-profile.mjs desktop --dry-run   # see what it would change
node packages/dsh-broadcast/scripts/link-profile.mjs desktop             # backup → manifest → symlink → import check
# restart DSH, then: curl -s http://127.0.0.1:52559/dsh-broadcast/state
```

## Debug

`broadcast_say(text)` (a tool, always available) speaks a line on demand and reports which
engine actually produced the sound:

```
已播报（say 兜底，8241ms）；回落原因：edge-tts 连接失败（握手被拒或网络不可达）
```

## Notes and limits

- Both online endpoints are unofficial (Baidu's `gettts`, and edge-tts which is currently
  403 to this machine and therefore not in the automatic chain). When they fail the plugin
  falls back to `say` and says so in the tool result — never silent.
- macOS `say` is concatenative synthesis: correct, but flat. That is why the online voice is
  the default and why the picker labels the offline group as "偏机械".
- The summary is one extra model call per turn (≤ 80 output tokens).
- Nothing is recorded: audio is deleted after playing, and the only persisted state is the
  switch.
