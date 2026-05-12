/* eslint-disable no-console */
import { rmSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'

/**
 * Best-effort teardown. Kills the spawned binary, then removes the temp
 * config dir. Errors are logged but not thrown — Playwright's globalTeardown
 * runs even after failures, so we don't want to mask the underlying cause.
 */
export default async function globalTeardown(): Promise<void> {
  const pid = Number.parseInt(process.env.PANNA_PROC_PID ?? '', 10)
  if (Number.isFinite(pid) && pid > 0) {
    killProcessTree(pid)
  }

  const dir = process.env.PANNA_CONFIG_DIR_TEST
  if (dir && existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.warn(`[e2e-lan] failed to remove temp dir ${dir}: ${(err as Error).message}`)
    }
  }
}

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    // tree-kill equivalent via taskkill — child processes too.
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'])
    } catch (err) {
      console.warn(`[e2e-lan] taskkill failed: ${(err as Error).message}`)
    }
    return
  }
  // Unix: send SIGTERM, then SIGKILL after a grace period if still alive.
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    // already gone
    return
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0) // probe
    } catch {
      return // process gone
    }
    // 100ms busy-wait
    const end = Date.now() + 100
    while (Date.now() < end) {} // intentional
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}
