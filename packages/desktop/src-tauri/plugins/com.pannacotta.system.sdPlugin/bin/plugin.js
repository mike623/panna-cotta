'use strict';
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const { execSync } = require('child_process');

function createWebSocket(url) {
  const em = new EventEmitter();
  const parsed = new URL(url);
  const key = crypto.randomBytes(16).toString('base64');
  const socket = net.createConnection(parseInt(parsed.port) || 80, parsed.hostname);
  let buffer = Buffer.alloc(0);
  let upgraded = false;

  socket.on('connect', () => {
    const path = parsed.pathname + (parsed.search || '');
    socket.write(
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${parsed.host}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`
    );
  });

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      upgraded = true;
      buffer = buffer.slice(headerEnd + 4);
      em.emit('open');
    }
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLen = buffer[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) break;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const totalLen = offset + (masked ? 4 : 0) + payloadLen;
      if (buffer.length < totalLen) break;
      let data = buffer.slice(offset + (masked ? 4 : 0), totalLen);
      if (masked) {
        const mk = buffer.slice(offset, offset + 4);
        for (let i = 0; i < data.length; i++) data[i] ^= mk[i % 4];
      }
      buffer = buffer.slice(totalLen);
      if (opcode === 1) em.emit('message', data.toString());
      else if (opcode === 8) { socket.destroy(); em.emit('close'); }
    }
  });

  socket.on('error', (err) => em.emit('error', err));
  socket.on('close', () => em.emit('close'));

  em.send = (text) => {
    const payload = Buffer.from(text);
    const mask = crypto.randomBytes(4);
    const hlen = payload.length < 126 ? 6 : 8;
    const header = Buffer.alloc(hlen);
    header[0] = 0x81;
    if (payload.length < 126) {
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else {
      header[1] = 0xfe;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    socket.write(Buffer.concat([header, masked]));
  };

  em.close = () => socket.destroy();
  return em;
}

const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) {
  args[process.argv[i]] = process.argv[i + 1];
}
const PORT = args['-port'];
const UUID = args['-pluginUUID'];
const REGISTER_EVENT = args['-registerEvent'] || 'registerPlugin';

const ws = createWebSocket(`ws://127.0.0.1:${PORT}/ws`);

ws.on('open', () => {
  ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: UUID }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (msg.event === 'keyDown') {
    handleKeyDown(msg).catch((err) => {
      try {
        ws.send(JSON.stringify({ event: 'logMessage', payload: { message: `Error: ${err.message}` } }));
      } catch {}
    });
  }
});

function run(cmd) {
  execSync(cmd, { stdio: 'ignore' });
}

async function handleKeyDown(msg) {
  const action = msg.action;
  const settings = (msg.payload && msg.payload.settings) || {};
  switch (action) {
    case 'com.pannacotta.system.open-app': {
      const appName = settings.appName;
      if (!appName) throw new Error('missing appName');
      if (process.platform === 'darwin') run(`open -a "${appName.replace(/"/g, '\\"')}"`);
      else if (process.platform === 'win32') run(`start "" "${appName.replace(/"/g, '\\"')}"`);
      else run(`xdg-open "${appName.replace(/"/g, '\\"')}"`);
      break;
    }
    case 'com.pannacotta.system.volume-up':
      if (process.platform === 'darwin')
        run(`osascript -e 'set volume output volume (output volume of (get volume settings) + 10)'`);
      break;
    case 'com.pannacotta.system.volume-down':
      if (process.platform === 'darwin')
        run(`osascript -e 'set volume output volume (output volume of (get volume settings) - 10)'`);
      break;
    case 'com.pannacotta.system.volume-mute':
      if (process.platform === 'darwin')
        run(`osascript -e 'set volume with output muted'`);
      break;
    case 'com.pannacotta.system.brightness-up':
      if (process.platform === 'darwin')
        run(`osascript -e 'tell application "System Events" to key code 113'`);
      break;
    case 'com.pannacotta.system.brightness-down':
      if (process.platform === 'darwin')
        run(`osascript -e 'tell application "System Events" to key code 107'`);
      break;
    case 'com.pannacotta.system.sleep':
      if (process.platform === 'darwin')
        run(`osascript -e 'tell app "System Events" to sleep'`);
      else if (process.platform === 'win32')
        run(`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`);
      else
        run(`systemctl suspend`);
      break;
    case 'com.pannacotta.system.lock':
      if (process.platform === 'darwin')
        run(`'/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession' -suspend`);
      else if (process.platform === 'win32')
        run(`rundll32.exe user32.dll,LockWorkStation`);
      else
        run(`loginctl lock-session`);
      break;
    case 'com.pannacotta.system.run-command': {
      const command = settings.command;
      if (!command) throw new Error('missing command');
      run(command);
      break;
    }
    default:
      break;
  }
}

ws.on('error', (err) => process.stderr.write(`WS error: ${err.message}\n`));
ws.on('close', () => process.exit(0));
