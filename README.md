# Panna Cotta

A web-based Stream Deck for controlling your Mac from any device on your network.

## Features

- **Configurable button grid** — set rows and columns to match your layout
- **TOML configuration** — define buttons in a simple `stream-deck.config.toml` file
- **Browser & system actions** — open URLs in the browser or launch macOS apps
- **Dark / light theme** — toggle or match your system preference
- **PWA installable** — add to your phone or tablet home screen for a native feel
- **Pagination** — buttons overflow into multiple pages automatically

## Quick Start

**Prerequisites:** [Deno 2+](https://deno.land), macOS

```sh
git clone https://github.com/mwong-io/panna-cotta.git
cd panna-cotta
deno task start:backend
```

Open `http://localhost:8000` in any browser. To control your Mac from another device, use your Mac's local IP address instead (e.g. `http://192.168.1.x:8000`).

## Configuration

Edit `stream-deck.config.toml` in the project root:

```toml
[grid]
rows = 2
cols = 3

[[buttons]]
name = "GitHub"
type = "browser"
icon = "github"
action = "https://github.com"

[[buttons]]
name = "VS Code"
type = "system"
icon = "code"
action = "Visual Studio Code"
```

### Button types

| Type      | Behavior                                       |
| --------- | ---------------------------------------------- |
| `browser` | Opens the `action` URL in the client's browser |
| `system`  | Launches the named macOS application on the Mac |

### Icons

The `icon` field accepts any [Lucide](https://lucide.dev/icons) icon name.

### Pagination

When you define more buttons than fit in `rows × cols`, the grid automatically paginates with navigation controls.

## Development

### Project structure

```
packages/
  backend/    # Deno HTTP server, API routes, macOS integration
  frontend/   # Static HTML/CSS/JS served by the backend
stream-deck.config.toml
deno.json
```

### Commands

| Task                            | Description                            |
| ------------------------------- | -------------------------------------- |
| `deno task start:backend`       | Start the server                       |
| `deno task start:backend:watch` | Start with file-watching (auto-reload) |
| `deno task compile`             | Compile to a standalone binary         |
| `deno test`                     | Run tests                              |
| `deno fmt`                      | Format source files                    |
| `deno lint`                     | Lint source files                      |

## Building

### Standalone binary

```sh
deno task compile
```

Produces a self-contained executable at `packages/backend/stream-backend` with the frontend assets embedded. No Deno installation required to run.

### GitHub Actions

On tagged commits (`v*`), GitHub Actions builds binaries for three targets and publishes a GitHub Release:

- `stream-backend-linux-x86_64`
- `stream-backend-macos-x86_64`
- `stream-backend-macos-aarch64`

## License

MIT
