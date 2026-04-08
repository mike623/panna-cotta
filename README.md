# Panna Cotta

A web-based Stream Deck for controlling your Mac from any device on your
network.

## Features

- **Configurable button grid** — set rows and columns to match your layout
- **TOML configuration** — define buttons in a simple `stream-deck.config.toml`
  file
- **Browser & system actions** — open URLs in the browser or launch macOS apps
- **Dark / light theme** — adapts to your system preference
- **PWA installable** — add to your phone or tablet home screen for a native
  feel
- **Pagination** — buttons overflow into multiple pages automatically when they
  exceed the grid

## Quick Start

**Prerequisites:** [Deno 2+](https://deno.land), macOS

```sh
git clone https://github.com/mwong-io/panna-cotta.git
cd panna-cotta
deno task start:backend
```

Open <http://localhost:8000> on any device on your network (use your Mac's IP
address).

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

| Type      | Behavior                                        |
| --------- | ----------------------------------------------- |
| `browser` | Opens the `action` URL in the client's browser  |
| `system`  | Launches the named macOS application on the Mac |

### Icons

The `icon` field accepts any [Lucide](https://lucide.dev/icons) icon name.

### Pagination

When you define more buttons than fit in `rows × cols`, the grid automatically
paginates with navigation controls.

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

This produces a self-contained executable at `packages/backend/stream-backend`
with the frontend assets embedded.

### GitHub Actions

Releases are built automatically via GitHub Actions on tagged commits.

## License

MIT
