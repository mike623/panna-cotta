/**
 * Playwright screenshot capture for Panna Cotta LAN panel.
 *
 * Starts a local HTTP server, mocks API responses, and captures
 * the full range of UI states into docs/screenshots/.
 *
 * Usage: cd packages/desktop && npm run screenshots
 * Requires: npx playwright install chromium  (one-time)
 */

import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, statSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at packages/desktop/ — root is two levels up
const ROOT = join(__dirname, '../..');
const FRONTEND = join(ROOT, 'packages', 'frontend');
const OUT = join(ROOT, 'docs', 'screenshots');

mkdirSync(OUT, { recursive: true });

// ── Mock config ───────────────────────────────────────────────────────────────
const MOCK_CONFIG = {
  grid: { rows: 3, cols: 3 },
  buttons: [
    { name: 'GitHub',    icon: 'code',      context: 'b1', type: 'browser', action: 'https://github.com' },
    { name: 'Terminal',  icon: 'terminal',  context: 'b2', type: 'system',  action: 'Terminal' },
    { name: 'YouTube',   icon: 'video',     context: 'b3', type: 'browser', action: 'https://youtube.com' },
    { name: 'Gmail',     icon: 'mail',      context: 'b4', type: 'browser', action: 'https://mail.google.com' },
    { name: 'Calendar',  icon: 'calendar',  context: 'b5', type: 'browser', action: 'https://calendar.google.com' },
    { name: 'Spotify',   icon: 'play',      context: 'b6', type: 'system',  action: 'Spotify' },
    { name: 'Discord',   icon: 'chat',      context: 'b7', type: 'system',  action: 'Discord' },
    { name: 'Home',      icon: 'home',      context: 'b8', type: 'browser', action: 'https://apple.com' },
    { name: 'Files',     icon: 'folder',    context: 'b9', type: 'system',  action: 'Finder' },
    // Page 2
    { name: 'Volume Up', icon: 'volup',     context: 'b10', type: 'system', action: '' },
    { name: 'Mute',      icon: 'mute',      context: 'b11', type: 'system', action: '' },
    { name: 'Lock',      icon: 'lock',      context: 'b12', type: 'system', action: '' },
  ],
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
};

// ── HTTP server ───────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      // Health
      if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Config
      if (pathname === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(MOCK_CONFIG));
        return;
      }

      // Plugin render (no plugins)
      if (pathname === '/api/plugin-render') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ images: {}, titles: {}, states: {} }));
        return;
      }

      // SSE streams — keep alive, send nothing
      if (pathname === '/api/config/events' || pathname === '/api/autocomplete') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': keep-alive\n\n');
        req.socket.on('close', () => res.end());
        return;
      }

      // POST execute — accept silently
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }

      // Static files: /apps/* → packages/frontend/*
      let filePath = '';
      if (pathname.startsWith('/apps/')) {
        filePath = join(FRONTEND, pathname.slice('/apps/'.length));
      } else if (pathname === '/' || pathname === '/apps') {
        filePath = join(FRONTEND, 'index.html');
      }

      if (filePath) {
        try {
          const stat = statSync(filePath);
          if (stat.isDirectory()) filePath = join(filePath, 'index.html');
          const body = readFileSync(filePath);
          const ext = extname(filePath);
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          res.end(body);
          return;
        } catch {
          // fall through to 404
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// ── Screenshot helpers ────────────────────────────────────────────────────────
async function loadPanel(page, port, { dark = true, listMode = false } = {}) {
  // Block Google Fonts so the render isn't gated on an external network call
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());

  // Set localStorage before app.js runs via init script
  await page.addInitScript(({ isDark, isList }) => {
    localStorage.setItem('pc.theme', isDark ? 'dark' : 'light');
    if (isList) localStorage.setItem('viewMode', 'list');
  }, { isDark: dark, isList: listMode });

  await page.goto(`http://127.0.0.1:${port}/apps/index.html`, { waitUntil: 'domcontentloaded' });

  // Wait for grid/list items to appear (async after config fetch)
  const selector = listMode ? '.list-item' : '.grid-button';
  await page.waitForSelector(selector, { timeout: 10000 });
}

async function injectSuggestions(page, words) {
  await page.evaluate((ws) => {
    autocompleteWords = ws;
    autocompletePartial = ws[0]?.slice(0, 2) ?? '';
    renderSuggestionStrip();
  }, words);
  await page.waitForSelector('.suggestion-chip', { timeout: 3000 });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const { server, port } = await startServer();
  console.log(`Server on http://127.0.0.1:${port}`);

  const browser = await chromium.launch();

  // Viewport matching a typical phone screen (iPhone 14 Pro size)
  const viewport = { width: 390, height: 844 };

  const captures = [
    { name: 'lan-grid-dark',       dark: true,  listMode: false, suggestions: null  },
    { name: 'lan-grid-light',      dark: false, listMode: false, suggestions: null  },
    { name: 'lan-list-dark',       dark: true,  listMode: true,  suggestions: null  },
    { name: 'lan-list-light',      dark: false, listMode: true,  suggestions: null  },
    { name: 'lan-autocomplete',    dark: true,  listMode: false, suggestions: ['good', 'great', 'got', 'going'] },
  ];

  for (const cap of captures) {
    console.log(`Capturing ${cap.name}…`);
    const page = await browser.newPage();
    await page.setViewportSize(viewport);

    await loadPanel(page, port, { dark: cap.dark, listMode: cap.listMode });

    if (cap.suggestions) {
      await injectSuggestions(page, cap.suggestions);
    }

    // Brief settle for fonts/layout
    await page.waitForTimeout(400);

    await page.screenshot({ path: join(OUT, `${cap.name}.png`) });
    await page.close();
    console.log(`  ✓ docs/screenshots/${cap.name}.png`);
  }

  // Disconnected banner state
  {
    console.log('Capturing lan-disconnected…');
    const page = await browser.newPage();
    await page.setViewportSize(viewport);
    await loadPanel(page, port, { dark: true });
    await page.evaluate(() => {
      updateBanner('retrying', 30);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, 'lan-disconnected.png') });
    await page.close();
    console.log('  ✓ docs/screenshots/lan-disconnected.png');
  }

  // Page 2 (pagination) — dark grid
  {
    console.log('Capturing lan-page2…');
    const page = await browser.newPage();
    await page.setViewportSize(viewport);
    await loadPanel(page, port, { dark: true });
    await page.evaluate(() => {
      currentPage = 1;
      renderGrid();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'lan-page2.png') });
    await page.close();
    console.log('  ✓ docs/screenshots/lan-page2.png');
  }

  await browser.close();
  server.close();

  console.log('\nDone. Screenshots in docs/screenshots/');
})();
