/**
 * 一个 stateDir 只允许一个推进者（R509）。
 *
 * 为什么需要：插件是**按会话**加载的，每个会话都会 ensureWorld 并从同一个
 * stateDir 读档；于是角色会话一多，就有多个实例各跑一套循环、各自存盘，
 * 互相覆盖——表现为 tick 倒退、派单凭空消失（H6 现场）。
 *
 * 用 pid 锁把"推进者"收敛成一个：拿到锁的会话跑循环、占端口、存盘；
 * 其余会话只读世界，不推进、不落盘。
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const LOCK_NAME = '.owner.lock'

export interface OwnerLock {
  /** 本会话是否是推进者。 */
  owned: boolean
  /** 不是推进者时，占用者的 pid（读不到就是 null）。 */
  ownerPid: number | null
  /** 释放（只在自己持有时真正删文件）。 */
  release: () => void
}

function aliveOf(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM = 进程在，只是不归我们管（比如 launchd 的 1 号）。当成活着，
    // 否则会把别人的锁当残留抢掉——那就等于没有锁。
    return (error as { code?: string } | null)?.code === 'EPERM'
  }
}

const noop = (): void => {}

/**
 * 拿锁。**同日两次调用不会再抢**：文件里是本进程 pid 时也算自己持有。
 * 持有者已经死掉（崩溃残留）时接管一次，避免永久卡死。
 */
/**
 * 进程内缓存：插件是**按会话**加载的，同一个进程里会有多个实例，
 * 而世界状态是进程内共享的——所以"推进者"是**进程**级别的身份，
 * 不是实例级别的。同进程的第二次调用直接复用第一次的结果。
 */
const byDir = new Map<string, OwnerLock>()

export function acquireOwnerLock(stateDir: string): OwnerLock {
  const cached = byDir.get(stateDir)
  if (cached !== undefined) return cached
  const lock = acquireOnce(stateDir)
  byDir.set(stateDir, lock)
  return lock
}

function acquireOnce(stateDir: string): OwnerLock {
  const file = join(stateDir, LOCK_NAME)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return {
        owned: true,
        ownerPid: process.pid,
        release: () => {
          try {
            unlinkSync(file)
          } catch {
            // 已经被清掉就不必再删。
          }
        },
      }
    } catch (error: unknown) {
      const code = (error as { code?: string } | null)?.code
      if (code !== 'EEXIST') return { owned: false, ownerPid: null, release: noop }
      let pid = 0
      try {
        pid = Number(readFileSync(file, 'utf8').trim())
      } catch {
        pid = 0
      }
      if (pid === process.pid) return { owned: true, ownerPid: pid, release: noop }
      if (aliveOf(pid)) return { owned: false, ownerPid: pid, release: noop }
      // 残留锁：删掉再试一次。
      try {
        unlinkSync(file)
      } catch {
        // 别人抢先删了也算巧合，下一轮会重新判断。
      }
    }
  }
  return { owned: false, ownerPid: null, release: noop }
}
