# Panna Cotta — Native Smoke Tests

`tauri-driver`-based smoke tests that exercise the built native binary.
This is the last line of defense before release: it catches segfaults,
missing system libs, broken resource paths, and renderer crashes that
unit / Playwright tests can't see.

## Status

**Linux only.** `tauri-driver` macOS support is broken upstream
([tauri-apps/tauri-driver#41](https://github.com/tauri-apps/tauri-driver/issues/41)
and friends); Windows requires a separate Edge WebDriver setup we don't
maintain. CI runs this layer only on `ubuntu-latest`.

This is **scaffolded but not exercised in this branch.** The first run
through CI will tell us whether the wdio + tauri-driver wiring actually
works on `ubuntu-latest`. Expect to iterate.

## Local run (Linux)

```bash
# 1. system deps
sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb

# 2. tauri-driver
cargo install tauri-driver --locked

# 3. build the app (release)
cd packages/desktop
npm ci
npm run tauri build

# 4. install smoke deps
cd smoke
npm install

# 5. run (headed: requires an X server; headless: use xvfb-run)
xvfb-run -a npm run smoke
```

## What it covers

`specs/launch.e2e.ts` — single spec, five checks:

1. wdio session opens within 10s (binary didn't crash on launch).
2. Webview is queryable (`browser.getTitle()` doesn't throw).
3. JS round-trips through the renderer (`1 + 1 === 2`).
4. DOM exists (`document.body` parsed).
5. Session can be torn down cleanly.

## What it does *not* cover

- macOS / Windows binaries (no working tauri-driver).
- Plugin marketplace install flows.
- LAN HTTP server — covered by Playwright (`e2e-lan/`).
- Admin UI behavior — covered by Playwright (`e2e/`).

## CI

See `.github/workflows/test.yml`, job `smoke-linux`. It runs after `rust`
and `vitest` pass (no point smoke-testing a binary whose unit tests fail).
