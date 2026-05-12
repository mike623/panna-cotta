/**
 * WebdriverIO config for Panna Cotta tauri-driver smoke tests.
 *
 * LINUX ONLY. macOS support in tauri-driver is broken upstream and
 * Windows requires a separate Edge WebDriver setup; we only run this
 * config on `ubuntu-latest` in CI.
 *
 * Prerequisites:
 *   - `cargo install tauri-driver --locked`
 *   - Tauri release build present at
 *     `packages/desktop/src-tauri/target/release/panna-cotta`
 *     (run `npm run tauri build` from `packages/desktop`)
 *   - `webkit2gtk-driver` apt package installed
 *
 * tauri-driver listens on port 4444 by default and bridges to WebKitWebDriver.
 */
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Resolve the built Tauri binary. CI builds with `cargo build --release` or
// `npm run tauri build`; both produce the same path on Linux.
const TAURI_BINARY = resolve(
  __dirname,
  '..',
  'src-tauri',
  'target',
  'release',
  'panna-cotta',
)

let tauriDriver: ChildProcessWithoutNullStreams | null = null

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: [resolve(__dirname, 'specs/**/*.e2e.ts')],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  hostname: '127.0.0.1',
  port: 4444,

  capabilities: [
    {
      // @ts-expect-error tauri:options is a non-standard capability
      'tauri:options': {
        application: TAURI_BINARY,
      },
      maxInstances: 1,
      browserName: 'wry',
      // platformName is required by some WebDriver implementations
      platformName: 'linux',
    },
  ],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  // Spawn tauri-driver before the session, kill it after.
  onPrepare() {
    if (!existsSync(TAURI_BINARY)) {
      throw new Error(
        `Tauri binary not found at ${TAURI_BINARY}. ` +
          `Run \`npm run tauri build\` from packages/desktop first.`,
      )
    }

    // Verify tauri-driver is on PATH so we fail fast with a clear message.
    const which = spawnSync('which', ['tauri-driver'])
    if (which.status !== 0) {
      throw new Error(
        'tauri-driver not found on PATH. Install with `cargo install tauri-driver --locked`.',
      )
    }
  },

  beforeSession() {
    tauriDriver = spawn('tauri-driver', [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    tauriDriver.stdout.on('data', (chunk) =>
      process.stdout.write(`[tauri-driver] ${chunk}`),
    )
    tauriDriver.stderr.on('data', (chunk) =>
      process.stderr.write(`[tauri-driver] ${chunk}`),
    )
    tauriDriver.on('error', (err) => {
      console.error('[tauri-driver] failed to spawn:', err)
    })
  },

  afterSession() {
    if (tauriDriver && !tauriDriver.killed) {
      tauriDriver.kill('SIGTERM')
      tauriDriver = null
    }
  },
}
