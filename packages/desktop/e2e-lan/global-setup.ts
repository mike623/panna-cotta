/* eslint-disable no-console */
import { spawn, ChildProcess } from 'child_process'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, createWriteStream } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

// ESM-compatible __dirname (the parent desktop package is "type": "module").
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Seed config — 3x3 grid, 5 buttons, one with `lanAllowed: false` so the
 * LAN-filter spec has something to assert. Contexts are 12-char nanoid-ish
 * strings matching the canonical format used by the Rust backend.
 */
const SEED_CONFIG = {
  grid: { rows: 3, cols: 3 },
  buttons: [
    {
      name: 'Calculator',
      icon: 'calculator',
      actionUUID: 'com.pannacotta.system.open-app',
      context: 'aaa111aaa111',
      settings: { appName: 'Calculator' },
      lanAllowed: null,
    },
    {
      name: 'Google',
      icon: 'chrome',
      actionUUID: 'com.pannacotta.browser.open-url',
      context: 'bbb222bbb222',
      settings: { url: 'https://google.com' },
      lanAllowed: null,
    },
    {
      name: 'Secret',
      icon: 'lock',
      actionUUID: 'com.pannacotta.system.open-app',
      context: 'ccc333ccc333',
      settings: { appName: 'Terminal' },
      lanAllowed: false,
    },
    {
      name: 'GitHub',
      icon: 'github',
      actionUUID: 'com.pannacotta.browser.open-url',
      context: 'ddd444ddd444',
      settings: { url: 'https://github.com' },
      lanAllowed: null,
    },
    {
      name: 'VolUp',
      icon: 'volume-2',
      actionUUID: 'com.pannacotta.system.volume-up',
      context: 'eee555eee555',
      settings: {},
      lanAllowed: null,
    },
  ],
}

/**
 * Poll a predicate until truthy or timeout. Returns the resolved value.
 * Used to wait for the port file to be written by the spawned binary.
 */
async function waitFor<T>(
  predicate: () => T | undefined | null,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const start = Date.now()
  const interval = opts.intervalMs ?? 100
  while (Date.now() - start < opts.timeoutMs) {
    const value = predicate()
    if (value) return value
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timed out after ${opts.timeoutMs}ms waiting for ${opts.label}`)
}

function resolveBinary(): { kind: 'binary'; path: string } | { kind: 'cargo' } {
  if (process.env.PANNA_BINARY) {
    if (!existsSync(process.env.PANNA_BINARY)) {
      throw new Error(`PANNA_BINARY does not exist: ${process.env.PANNA_BINARY}`)
    }
    return { kind: 'binary', path: process.env.PANNA_BINARY }
  }
  // Default: prebuilt release binary inside src-tauri target
  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const releaseBin = path.join(
    repoRoot,
    'packages',
    'desktop',
    'src-tauri',
    'target',
    'release',
    'panna-cotta',
  )
  if (existsSync(releaseBin)) {
    return { kind: 'binary', path: releaseBin }
  }
  return { kind: 'cargo' }
}

export default async function globalSetup(): Promise<void> {
  // Temp config dir — torn down by global-teardown.
  const dir = mkdtempSync(path.join(tmpdir(), 'panna-e2e-'))
  mkdirSync(path.join(dir, 'profiles'), { recursive: true })
  writeFileSync(
    path.join(dir, 'profiles', 'Default.json'),
    JSON.stringify(SEED_CONFIG, null, 2),
  )
  writeFileSync(path.join(dir, 'active-profile'), 'Default')

  // Log file for binary stdout/stderr — helps diagnose failures.
  const logPath = path.join(dir, 'binary.log')
  const logStream = createWriteStream(logPath)

  const bin = resolveBinary()
  let proc: ChildProcess
  if (bin.kind === 'binary') {
    console.log(`[e2e-lan] using prebuilt binary: ${bin.path}`)
    proc = spawn(bin.path, [], {
      env: {
        ...process.env,
        PANNA_CONFIG_DIR: dir,
        // Avoid auto-update side effects during tests
        RUST_LOG: process.env.RUST_LOG ?? 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
  } else {
    // Fallback: cargo run (slow first time)
    console.log('[e2e-lan] no prebuilt binary — falling back to cargo run --release')
    const srcTauriDir = path.resolve(__dirname, '..', 'src-tauri')
    proc = spawn('cargo', ['run', '--release', '--quiet'], {
      cwd: srcTauriDir,
      env: {
        ...process.env,
        PANNA_CONFIG_DIR: dir,
        RUST_LOG: process.env.RUST_LOG ?? 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
  }

  proc.stdout?.pipe(logStream, { end: false })
  proc.stderr?.pipe(logStream, { end: false })

  proc.on('exit', (code, signal) => {
    logStream.write(`\n[e2e-lan] process exited code=${code} signal=${signal}\n`)
  })

  // Wait for port file to appear and contain a valid port.
  const portFile = path.join(dir, '.panna-cotta.port')
  let port: number | null = null
  try {
    port = await waitFor(
      () => {
        if (!existsSync(portFile)) return null
        const raw = readFileSync(portFile, 'utf8').trim()
        const n = Number.parseInt(raw, 10)
        return Number.isFinite(n) && n >= 30000 && n < 40000 ? n : null
      },
      { timeoutMs: 60_000, intervalMs: 250, label: 'port file' },
    )
  } catch (err) {
    // Best-effort: dump the tail of the log to help debugging.
    try {
      const log = readFileSync(logPath, 'utf8')
      console.error('[e2e-lan] binary log tail:\n' + log.split('\n').slice(-50).join('\n'))
    } catch {}
    throw err
  }

  // Read CSRF token (written by start() when PANNA_CONFIG_DIR is set).
  const csrfPath = path.join(dir, '.csrf-token')
  const csrfToken = await waitFor(
    () => {
      if (!existsSync(csrfPath)) return null
      const raw = readFileSync(csrfPath, 'utf8').trim()
      return raw.length >= 32 ? raw : null
    },
    { timeoutMs: 10_000, intervalMs: 100, label: 'csrf token' },
  )

  // Quick liveness probe.
  const baseURL = `http://127.0.0.1:${port}`
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${baseURL}/api/health`)
        return res.ok ? true : null
      } catch {
        return null
      }
    },
    { timeoutMs: 15_000, intervalMs: 200, label: 'GET /api/health' },
  )

  // Publish to tests + teardown via env.
  process.env.PANNA_PORT = String(port)
  process.env.PANNA_BASE_URL = baseURL
  process.env.PANNA_CSRF_TOKEN = csrfToken
  process.env.PANNA_PROC_PID = String(proc.pid ?? '')
  process.env.PANNA_CONFIG_DIR_TEST = dir
  process.env.PANNA_LOG_PATH = logPath

  console.log(`[e2e-lan] server ready: ${baseURL}  pid=${proc.pid}  dir=${dir}`)
}
