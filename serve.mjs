/**
 * 本地静态服务，方便手机在同一个 WiFi 下打开。
 *   node serve.mjs
 * 电脑访问 http://localhost:5180
 * 手机访问脚本打印出来的 http://<你的局域网IP>:5180
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5180);

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

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
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
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const local = `http://localhost:${PORT}`;
  console.log('');
  console.log('  时间账本已启动');
  console.log('  电脑：' + local);
  for (const ip of lanAddresses()) {
    console.log('  手机：http://' + ip + ':' + PORT + '   （需与电脑同一个 WiFi）');
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
