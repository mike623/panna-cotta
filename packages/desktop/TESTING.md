# Testing Panna Cotta

Panna Cotta has five test layers, each catching a different class of bug.
Run them locally before pushing; CI runs all of them in parallel on every PR.

| Layer            | Tool                 | Where                                          | Speed   | Scope                                                                 |
|------------------|----------------------|------------------------------------------------|---------|-----------------------------------------------------------------------|
| Rust unit        | `cargo test`         | `src-tauri/src/**`                             | seconds | Pure logic: config parsing, profile CRUD, server bootstrapping.       |
| Rust lint        | `cargo clippy`       | `src-tauri/src/**`                             | seconds | Style + correctness lints. CI fails on any warning.                   |
| Frontend unit    | `vitest`             | `src/__tests__/**`, `src/**/*.test.ts`         | seconds | TS/React logic: bridge mapping, action library, helpers.              |
| Admin E2E        | Playwright           | `e2e/**`                                       | ~1 min  | Admin Svelte/React SPA in Chromium against the Vite dev server.       |
| LAN E2E          | Playwright           | `e2e-lan/**`                                   | ~3 min  | Real Tauri release binary serving the LAN frontend; full HTTP loop.   |
| Native smoke     | `tauri-driver` + wdio| `smoke/**`                                     | ~2 min  | Built binary actually launches and renders. Linux only (see below).   |

The admin E2E and LAN E2E layers depend on Phase 4 scaffolding
(`e2e/` and `e2e-lan/` directories). The CI workflow assumes those
directories exist; if Phase 4 hasn't merged yet those jobs will fail
fast on the missing config and you'll see a clear error in the logs.

## Running locally

All commands are run from `packages/desktop/` unless noted.

### Rust unit + clippy

```bash
cd src-tauri
cargo test --all-features
cargo clippy --all-targets -- -D warnings
```

### Frontend unit (vitest)

```bash
npm test           # runs vitest in run mode (no watch)
npm test -- --watch
```

### Admin E2E (Playwright)

Requires Phase 4's `e2e/` directory and `playwright.config.ts` at
`packages/desktop/`.

```bash
npx playwright install --with-deps chromium   # first time only
npx playwright test                            # all admin tests
npx playwright test --ui                       # interactive UI mode
npx playwright test --debug                    # step-through debugger
```

### LAN E2E (Playwright)

Requires a release build of the Tauri binary so the embedded Axum
server is exercised. Also requires Phase 4's `e2e-lan/` config.

```bash
npm run build                              # build the React frontend
cd src-tauri && cargo build --release      # build the Tauri binary
cd ..
npx playwright test --config=e2e-lan/playwright.config.ts
```

Tests should set `PANNA_CONFIG_DIR` to a temp directory to avoid
clobbering your real `~/.panna-cotta/` state. (Phase 4 introduces this
env var — see the LAN config for details.)

### Native smoke (Linux only)

`tauri-driver`'s macOS support is broken upstream and Windows needs a
separate WebDriver setup; we only run this on Linux.

```bash
# system deps (Ubuntu/Debian)
sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb

# rust-side driver
cargo install tauri-driver --locked

# build the app (release)
npm ci
npm run tauri build

# run the smoke test
npm run smoke               # invokes wdio under xvfb-run if no DISPLAY
```

See `smoke/README.md` for what each spec covers.

## CI

Workflow: `.github/workflows/test.yml`. Triggered on every pull request
and on every push to `main`. Concurrency cancels redundant runs for the
same ref.

| Job              | OS matrix                                      | Notes                                                  |
|------------------|------------------------------------------------|--------------------------------------------------------|
| `rust`           | ubuntu-latest, macos-latest, windows-latest    | Catches platform-specific path / FFI bugs.             |
| `vitest`         | ubuntu-latest                                  | Frontend unit tests.                                   |
| `playwright-admin` | ubuntu-latest                                | Admin SPA against Vite dev server.                     |
| `playwright-lan` | ubuntu-latest                                  | Real release binary + Axum LAN routes. ~5min slot.     |
| `smoke-linux`    | ubuntu-latest                                  | Built binary launches. Gated on `rust` + `vitest`.     |

The Rust matrix is the long pole on Windows (~10 min cold cache). Worth
the cost: it's the only thing that catches Windows-specific path bugs
and unicode-path regressions before they hit the release pipeline.

`.github/workflows/tauri_release.yml` is the *release* workflow and runs
only on tag push (`v*`). The test workflow above does **not** touch
release artifacts.

## Debugging a failing CI run

1. Click the failing job in the GitHub Actions UI.
2. Expand the step that failed; the first red error is usually
   load-bearing.
3. If it's a Playwright job, scroll to the bottom of the run page —
   the workflow uploads `playwright-report/` as an artifact named
   `playwright-admin-report` or `playwright-lan-report` on failure.
   Download and run `npx playwright show-report` locally to see the
   full HTML report (with screenshots, traces, and video on failure).
4. If it's the smoke job, the artifact `smoke-linux-logs` contains any
   logs the spec wrote. tauri-driver itself logs to stdout, so check
   the job log first.
5. To reproduce locally, copy the exact command from the failing step
   and run it from `packages/desktop/`. The CI env mirrors a clean
   Ubuntu 22.04 with Node 20 and stable Rust.

## Known limitations

- **No macOS smoke.** `tauri-driver` macOS support is unreliable; the
  release workflow's notarization step is our macOS canary instead.
- **No plugin marketplace E2E.** The marketplace install flow involves
  external network calls (Elgato registry + deep-link handling); we
  exercise the unit pieces and rely on manual QA for the end-to-end
  install path.
- **Phase 4 dependencies.** `playwright-admin` and `playwright-lan`
  expect Phase 4's `e2e/`, `e2e-lan/`, and `PANNA_CONFIG_DIR` support
  to exist. If you see "config file not found" errors in those jobs,
  Phase 4 hasn't landed on this branch yet.

## Adding a new test

- Pure logic (parsing, mapping, helpers): **vitest** or **cargo test**.
- Anything that touches the DOM but not the binary: **Playwright admin**.
- Anything that touches the LAN HTTP server: **Playwright LAN**.
- "Does the binary even launch?": **smoke** (Linux only).

If you're adding a test that doesn't fit any of these, you're probably
about to add a new layer — talk to the team first.
