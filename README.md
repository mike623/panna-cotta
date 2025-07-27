# Stream Deck Web App Development Prompt

## Project Overview
You are helping to build a **Stream Deck-like web application** that provides a customizable grid of buttons for controlling a Mac laptop remotely. The app should be accessible from any device (including phones/tablets) via web browser, with a Deno backend running on the Mac for system integration.

## Technology Stack

### Architecture: Deno Backend + Web Frontend
- **Frontend**: Pure HTML/CSS/JavaScript (served as static files, embedded in the backend executable)
- **Backend**: Native Deno HTTP server running on Mac for system integration
- **Communication**: HTTP API between frontend and backend
- **UI Components**: Tailwind CSS for styling, Lucide icons
- **Layout**: CSS Grid or JavaScript grid system for button layout

### Why Deno Backend + Web Frontend:
- **Cross-device access**: Control Mac from phone, tablet, or any browser
- **No installation needed**: Pure web app, no desktop app required
- **Modern runtime**: Deno with TypeScript support and secure-by-default
- **Simple deployment**: Backend runs on Mac, frontend served via web
- **Real-time updates**: WebSocket for instant feedback and system status (Note: WebSocket implementation is a placeholder and needs further development with native Deno APIs)

## Core Features to Implement
- **Customizable Grid Layout**: Drag-and-drop button arrangement
- **Button Sizes**: Support 1x1, 2x1, 2x2 button sizes
- **Multiple Pages**: Different profiles/pages of buttons
- **Visual Customization**: Icon picker, colors, labels
- **Import/Export**: Save and share button configurations

## Configuration

The Stream Deck application loads its configuration from a `stream-deck.config.toml` file located in the project root directory. This file defines the grid layout and the actions associated with each button.

### `stream-deck.config.toml` Structure

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

# Add more buttons as needed. The application supports pagination if there are more buttons than the grid can display.
```

### Configuration Details

-   **`[grid]`**: Defines the layout of the button grid.
    -   `rows`: The number of rows in the grid.
    -   `cols`: The number of columns in the grid.

-   **`[[buttons]]`**: An array of button definitions. Each button can have the following properties:
    -   `name`: A display name for the button.
    -   `type`: The type of action the button performs. Can be either `"browser"` or `"system"`.
        -   `"browser"`: Opens a URL in the default web browser.
        -   `"system"`: Executes a system command or opens a system application.
    -   `icon`: The name of the Lucide icon to display on the button (e.g., `"github"`, `"code"`, `"youtube"`).
    -   `action`: The value associated with the button's action.
        -   For `"browser"` type, this should be a URL (e.g., `"https://github.com"`).
        -   For `"system"` type, this should be the name of the application to open (e.g., `"Visual Studio Code"`, `"Calculator"`).

### Pagination
If the number of defined buttons exceeds the capacity of the grid (`rows * cols`), the application will automatically enable pagination, allowing you to navigate through multiple pages of buttons using the navigation controls in the bottom toolbar.

### 2. Button Action Types
- **Application Launchers**: Open specific applications
- **URL Shortcuts**: Open websites in browsers
- **System Commands**: Volume, brightness, sleep, shutdown
- **Hotkey Triggers**: Send keyboard shortcuts
- **Multi-Actions**: Execute multiple commands in sequence
- **File/Folder Access**: Quick access to directories

### 3. System Integration Features
- **Window Management**: Switch between apps, minimize/maximize
- **Audio Control**: Volume adjustment, device switching
- **Display Control**: Brightness, resolution changes
- **Network Control**: WiFi toggle, VPN connection
- **Process Management**: Kill applications, monitor resources

### 4. Advanced Features
- **Global Shortcuts**: Hotkeys to trigger buttons when app is minimized
- **System Tray Integration**: Minimize to tray functionality
- **Automation Sequences**: Conditional logic and timed actions
- **Web API Integration**: Weather, stocks, social media posting
- **Plugin System**: Extensible architecture for custom actions

## Deno Backend Implementation Guidelines

### Backend Server Structure
```typescript
// server.ts - Main Deno server
import { serve } from "https://deno.land/std/http/server.ts";
import { serveFile } from "https://deno.land/std/http/file_server.ts";
import { join } from "https://deno.land/std/path/mod.ts";

// Import service functions
import { executeCommand, getSystemStatus, openApplication } from "./services/system.ts";

// Define the path to the frontend static files
const frontendPath = new URL("../frontend", import.meta.url).pathname;

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // API routes
  if (path.startsWith("/api")) {
    if (path === "/api/execute" && req.method === "POST") {
      return executeCommand(req);
    } else if (path === "/api/system-status" && req.method === "GET") {
      return getSystemStatus(req);
    } else if (path === "/api/open-app" && req.method === "POST") {
      return openApplication(req);
    } else if (path === "/api/health" && req.method === "GET") {
      return new Response("OK");
    }
  }

  // Serve static files
  try {
    const filePath = join(frontendPath, path);
    const file = await Deno.stat(filePath);
    if (file.isFile) {
      return serveFile(req, filePath);
    } else if (file.isDirectory) {
      // Serve index.html for directories
      return serveFile(req, join(filePath, "index.html"));
    }
  } catch (e) {
    // File not found, continue to next handler or return 404
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

console.log("Server running on http://localhost:8000");
Deno.serve({ port: 8000 }, handler);
```

### Key Deno APIs and Libraries
- **Deno.Command**: Execute system commands and applications
- **Deno.serve**: Native Deno HTTP server
- **Deno.stat / serveFile**: For serving static files
- **WebSocket API**: Real-time communication with frontend (needs to be implemented)
- **File System API**: Save/load button configurations
- **Process Management**: Launch and control applications

### Mac System Integration Examples
```typescript
// Execute macOS commands
export const executeCommand = async (req: Request): Promise<Response> => {
  const { action, target } = await req.json();
  
  switch (action) {
    case 'open-app':
      const cmd = new Deno.Command("open", {
        args: ["-a", target]
      });
      await cmd.output();
      break;
      
    case 'system-volume':
      const volumeCmd = new Deno.Command("osascript", {
        args: ["-e", `set volume output volume ${target}`]
      });
      await volumeCmd.output();
      break;
      
    case 'brightness':
      const brightnessCmd = new Deno.Command("brightness", {
        args: [target]
      });
      await brightnessCmd.output();
      break;
  }
  return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
};

// Get system status
export const getSystemStatus = async (req: Request): Promise<Response> => {
  const batteryCmd = new Deno.Command("pmset", {
    args: ["-g", "batt"],
  });
  const batteryOutput = await batteryCmd.output();
  const batteryText = new TextDecoder().decode(batteryOutput.stdout);

  const wifiCmd = new Deno.Command("networksetup", {
    args: ["-getairportpower", "en0"],
  });
  const wifiOutput = await wifiCmd.output();
  const wifiText = new TextDecoder().decode(wifiOutput.stdout);

  return new Response(JSON.stringify({ battery: batteryText, wifi: wifiText }), { headers: { "Content-Type": "application/json" } });
};
```

### Frontend-Backend Communication
```javascript
// Frontend HTTP requests
class StreamDeckAPI {
  async executeAction(action, target) {
    const response = await fetch(`http://YOUR_MAC_IP:8000/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target })
    });
    return response.json();
  }
  
  async getSystemStatus() {
    const response = await fetch(`http://YOUR_MAC_IP:8000/api/system-status`);
    return response.json();
  }
}
```

## Development Phases

### Phase 1: Backend Foundation (Week 1-2)
1. Set up native Deno HTTP server
2. Implement basic REST API endpoints
3. Add WebSocket support for real-time communication (placeholder, needs implementation)
4. Create Mac system integration commands

### Phase 2: Frontend Interface (Week 3-4)
1. Create responsive 3x2 grid layout (mobile-friendly)
2. Implement button configuration system
3. Add WebSocket client for real-time updates
4. Create mobile-optimized touch interface

### Phase 3: Advanced Features (Week 5-6)
1. Add authentication/security for remote access
2. Implement multiple device support
3. Create button templates and presets
4. Add system monitoring and status updates

### Phase 4: Polish & Deployment (Week 7-8)
1. Optimize for mobile/tablet interfaces
2. Add offline detection and reconnection
3. Create setup documentation
4. Implement error handling and logging

## Common Patterns and Solutions

### Mac System Command Execution
```typescript
// Application launching
const openApplication = async (appName: string) => {
  const cmd = new Deno.Command("open", {
    args: ["-a", appName]
  });
  return await cmd.output();
};

// System controls
const systemControl = async (action: string, value?: string) => {
  const commands = {
    volume: ["osascript", ["-e", `set volume output volume ${value}`]],
    brightness: ["brightness", [value]],
    sleep: ["pmset", ["sleepnow"]],
    wifi_on: ["networksetup", ["-setairportpower", "en0", "on"]],
    wifi_off: ["networksetup", ["-setairportpower", "en0", "off"]]
  };
  
  const [command, args] = commands[action];
  const cmd = new Deno.Command(command, { args });
  return await cmd.output();
};
```

### Mobile-Responsive Grid Layout
```css
/* 3x2 grid that adapts to screen size */
.stream-deck-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 1rem;
  padding: 1rem;
  height: 100vh;
  max-width: 800px;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .stream-deck-grid {
    padding: 0.5rem;
    gap: 0.5rem;
  }
}

.stream-deck-button {
  aspect-ratio: 1;
  border-radius: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  touch-action: manipulation; /* Better mobile touch */
}
```

### WebSocket State Management
```javascript
class StreamDeckStore {
  constructor() {
    this.buttons = [];
    this.systemStatus = {};
    this.connected = false;
    this.listeners = [];
  }
  
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }
  
  updateSystemStatus(status) {
    this.systemStatus = { ...this.systemStatus, ...status };
    this.notifyListeners();
  }
}

## UI/UX Guidelines
- **Modern Design**: Use contemporary design trends (glassmorphism, dark mode support)
- **Responsive Layout**: Adapt to different window sizes
- **Accessibility**: Proper contrast, keyboard navigation, screen reader support
- **Performance**: Smooth animations, efficient rendering
- **Intuitive Configuration**: Visual editor with drag-and-drop ease

## File Structure Suggestion
```
stream-deck-web/
├── backend/                      # Deno backend (runs on Mac)
│   ├── server.ts                 # Main server entry point, handles API and static files
│   ├── services/
│   │   ├── system.ts            # Mac system integration
│   │   ├── apps.ts              # Application management (not implemented yet)
│   │   └── config.ts            # Configuration management (not implemented yet)
│   ├── types/
│   └── deno.json                # Deno configuration
├── frontend/                     # Web frontend (static files)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── components/
│   │   ├── grid.js
│   │   ├── button.js
│   │   └── config-modal.js
│   └── assets/
└── README.md
```

## Deployment and Setup

### Backend Setup (Mac)
```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Run the Deno application
deno run --allow-net --allow-run --allow-read --allow-write packages/backend/server.ts

# Or, run in watch mode for development
deno run --watch --allow-net --allow-run --allow-read --allow-write packages/backend/server.ts

# Compile to a standalone executable
deno compile --allow-net --allow-run --allow-read --allow-write --include packages/frontend --output packages/backend/stream-backend packages/backend/server.ts

# Run the compiled executable
./packages/backend/stream-backend

# Server will run on http://YOUR_MAC_IP:8000
```

### Frontend Access
- **Desktop**: Navigate to `http://YOUR_MAC_IP:8000`
- **Mobile**: Connect to same network, access via IP address
- **Tablet**: Same URL, optimized touch interface
- **Multiple Devices**: All can connect simultaneously

### Security Considerations
- **Network Security**: Consider VPN or local network only
- **Authentication**: Add basic auth for remote access
- **Input Validation**: Sanitize all commands before execution
- **Rate Limiting**: Prevent command spam from clients
- **HTTPS**: Use SSL certificates for secure communication

---

## When Assisting with This Project:
1. **Prioritize Deno APIs** and built-in capabilities over external dependencies
2. **Focus on Mac system integration** using native macOS commands and AppleScript
3. **Design mobile-first** - ensure touch-friendly interfaces for phone/tablet access
4. **Emphasize real-time communication** - use WebSockets for instant feedback
5. **Create responsive layouts** - 3x2 grid that works on all screen sizes
6. **Include proper error handling** for network disconnections and command failures
7. **Consider multi-device scenarios** - multiple clients controlling the same Mac
8. **Provide complete examples** that work with Deno's permission system

### Key Deno Commands to Remember:
```bash
# Run with required permissions
deno run --allow-net --allow-run --allow-read --allow-write server.ts

# Format and lint
deno fmt && deno lint

# Check for updates
deno cache --reload server.ts
```

### Mac System Integration Examples:
- **Applications**: `open -a "Application Name"`
- **Volume**: `osascript -e "set volume output volume 50"`
- **Brightness**: `brightness 0.5`
- **WiFi**: `networksetup -setairportpower en0 on/off`
- **Sleep**: `pmset sleepnow`
- **Bluetooth**: `blueutil -p 1/0`

Remember: The goal is a **cross-device accessible** Stream Deck that lets you control your Mac from anywhere on your network, with a focus on mobile-friendly interfaces and real-time responsiveness.
