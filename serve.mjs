/**
 * 时间账本 · 本地服务
 *   node serve.mjs
 *
 * 除了托管静态文件，还提供自动同步接口：
 *   GET  /api/sync           → { rev, updatedAt, payload }
 *   POST /api/sync           → 请求体 { since, payload }；since 与当前 rev 不一致返回 409
 *
 * 同步数据存在 data/sync-state.json，不会随代码提交。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TT_DATA_DIR
  ? path.resolve(process.env.TT_DATA_DIR)
  : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sync-state.json');
const MAX_BODY = 16 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

/* ---------------- 同步存储 ---------------- */

let store = null;

function emptyPayload() {
  return { v: 1, cats: [], entries: [] };
}

function loadStore() {
  if (store) return store;
  store = { rev: 0, updatedAt: 0, payload: emptyPayload() };
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.rev === 'number' && j.payload && Array.isArray(j.payload.entries)) {
      store = { rev: j.rev, updatedAt: j.updatedAt || 0, payload: j.payload };
    }
  } catch (e) {
    /* 首次运行或文件损坏，用空状态 */
  }
  return store;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
  fs.renameSync(tmp, DATA_FILE); // 原子替换，避免写一半断电留下坏文件
}

function fingerprint(payload) {
  return JSON.stringify(payload || emptyPayload());
}

/* ---------------- HTTP 辅助 ---------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------------- 同步接口 ---------------- */

function handleSyncGet(res) {
  const s = loadStore();
  sendJson(res, 200, { rev: s.rev, updatedAt: s.updatedAt, payload: s.payload });
}

async function handleSyncPost(req, res) {
  let data;
  try {
    const body = await readBody(req);
    data = JSON.parse(body || '{}');
  } catch (e) {
    sendJson(res, e && e.code === 413 ? 413 : 400, { error: '请求体无法解析' });
    return;
  }

  if (!data || !data.payload || !Array.isArray(data.payload.entries)) {
    sendJson(res, 400, { error: 'payload 格式不正确' });
    return;
  }

  const s = loadStore();
  const since = typeof data.since === 'number' ? data.since : s.rev;

  // 乐观并发：客户端基于旧版本提交时，把最新状态退回去让它重新合并
  if (since !== s.rev) {
    sendJson(res, 409, { rev: s.rev, updatedAt: s.updatedAt, payload: s.payload });
    return;
  }

  const incoming = {
    v: 1,
    cats: Array.isArray(data.payload.cats) ? data.payload.cats : [],
    entries: data.payload.entries,
  };

  if (fingerprint(incoming) !== fingerprint(s.payload)) {
    s.payload = incoming;
    s.rev += 1;
    s.updatedAt = Date.now();
    persist();
  }

  sendJson(res, 200, { rev: s.rev, updatedAt: s.updatedAt });
}

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';

  // 同步数据目录不对外暴露
  if (pathname.startsWith('/data/') || pathname === '/data') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }

  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/* ---------------- 服务器 ---------------- */

export function createServer() {
  return http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const method = req.method || 'GET';

    if (rawPath.startsWith('/api/')) {
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      if (rawPath === '/api/sync') {
        if (method === 'GET') { handleSyncGet(res); return; }
        if (method === 'POST') { handleSyncPost(req, res); return; }
        sendJson(res, 405, { error: '方法不支持' });
        return;
      }
      if (rawPath === '/api/health') {
        sendJson(res, 200, { ok: true, app: 'time-tally', rev: loadStore().rev });
        return;
      }
      sendJson(res, 404, { error: '接口不存在' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }
    serveStatic(req, res, rawPath);
  });
}

export function lanAddresses() {
  const out = [];
  // 虚拟网卡（WSL / 虚拟机 / Docker 等）对手机毫无意义，必须排除
  const skipName = /vEthernet|WSL|VMware|VirtualBox|Hyper-V|Loopback|Docker|Teredo|Bluetooth|Npcap|Tailscale|ZeroTier/i;
  const nets = os.networkInterfaces();

  for (const name of Object.keys(nets)) {
    if (skipName.test(name)) continue;
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (/^169\.254\./.test(net.address)) continue; // 没有拿到 DHCP 时的自动地址
      out.push({ name, address: net.address });
    }
  }

  // 无线网卡优先，通常手机连的就是它
  const wireless = (s) => (/WLAN|Wi-?Fi|Wireless|无线/i.test(s.name) ? 0 : 1);
  out.sort((a, b) => wireless(a) - wireless(b));
  return out;
}

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch (e) {
    return false;
  }
})();

if (isMain) {
  const PORT = Number(process.env.PORT || 5180);
  // 默认只监听本机：服务里有 /api/sync 这类无鉴权接口，
  // 绑到 0.0.0.0 就等于把全部记录暴露给同网段任何人。
  const BIND_LAN = process.argv.includes('--lan') || process.env.TT_LAN === '1';
  const HOST = BIND_LAN ? '0.0.0.0' : '127.0.0.1';

  const server = createServer();
  server.listen(PORT, HOST, () => {
    const local = `http://localhost:${PORT}`;
    console.log('');
    console.log('  时间账本已启动');
    console.log('  电脑：' + local);

    if (BIND_LAN) {
      const lan = lanAddresses();
      for (const ip of lan) {
        console.log('  手机：http://' + ip.address + ':' + PORT + '   （' + ip.name + '）');
      }
      console.log('');
      console.log('  ⚠ 已开启局域网访问：同网络的任何人只要知道这个地址，');
      console.log('    就能读取和修改你的全部时间记录。只在自己信任的网络里用。');
      console.log('    校园网 / 公共 WiFi 请务必关掉，改用 Gist 同步。');
    } else {
      console.log('  仅本机可访问（手机连不上，这是默认的安全设置）');
      console.log('  需要手机访问时用：node serve.mjs --lan，并自行放行防火墙');
    }

    console.log('');
    console.log('  按 Ctrl+C 停止');
    console.log('');

    if (process.platform === 'win32' && !process.env.NO_OPEN) {
      exec(`start "" "${local}"`, () => {});
    } else if (process.platform === 'darwin' && !process.env.NO_OPEN) {
      exec(`open "${local}"`, () => {});
    }
  });
}
