/**
 * 自动同步的服务端协议测试
 *   node test-sync.mjs
 *
 * 只测服务端：版本号推进、乐观并发（409）、相同数据不增版本、持久化。
 * 客户端的合并逻辑由 test-logic.cjs 覆盖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sync-'));
process.env.TT_DATA_DIR = tmp;

const { createServer } = await import('./serve.mjs');

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

async function getSync() {
  const r = await fetch(base + '/api/sync');
  return { status: r.status, body: await r.json() };
}
async function postSync(since, payload) {
  const r = await fetch(base + '/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since, payload })
  });
  return { status: r.status, body: await r.json() };
}

function payload(entries, cats) {
  return { v: 1, cats: cats || [{ id: 'c1', name: '工作', color: '#000', subs: [{ id: 's1', name: '写代码' }] }], entries };
}
function entry(id, updatedAt, extra) {
  return Object.assign({ id, start: 1000, end: 2000, catId: 'c1', subId: 's1', note: '', updatedAt, deletedAt: null }, extra || {});
}

try {
  // 1. 初始状态
  let g = await getSync();
  ok('初始 rev 为 0', g.status === 200 && g.body.rev === 0);
  ok('初始 payload 为空', Array.isArray(g.body.payload.entries) && g.body.payload.entries.length === 0);

  // 2. 首次提交
  let p = await postSync(0, payload([entry('e1', 10)]));
  ok('首次提交成功', p.status === 200 && p.body.rev === 1, p.body);

  // 3. 读回
  g = await getSync();
  ok('读回数据一致', g.body.rev === 1 && g.body.payload.entries.length === 1 && g.body.payload.entries[0].id === 'e1');

  // 4. 相同数据不推进版本
  p = await postSync(1, payload([entry('e1', 10)]));
  ok('相同数据不增版本', p.status === 200 && p.body.rev === 1, p.body);

  // 5. 基于旧版本提交 → 409
  p = await postSync(0, payload([entry('e1', 10), entry('e2', 20)]));
  ok('旧版本提交返回 409', p.status === 409, p.status);
  ok('409 带上最新数据', p.body.rev === 1 && Array.isArray(p.body.payload.entries), p.body.rev);

  // 6. 两端各自写入后收敛
  const a = { entries: [entry('e1', 10)] };
  const b = { entries: [entry('e2', 20)] };

  // B 拉取并合并后提交
  let remote = (await getSync()).body;
  b.entries = b.entries.concat(remote.payload.entries);
  p = await postSync(remote.rev, payload(b.entries));
  ok('B 合并后提交成功', p.status === 200 && p.body.rev === 2, p.body);

  // A 拉取并合并
  remote = (await getSync()).body;
  const ids = remote.payload.entries.map((e) => e.id).sort();
  ok('A 拉取后看到双方数据', ids.join(',') === 'e1,e2', ids);

  // 7. 空提交不炸
  p = await postSync(remote.rev, payload([]));
  ok('空数据提交不报错', p.status === 200, p.status);

  // 8. 坏请求
  let r = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  ok('非法 JSON 返回 400', r.status === 400, r.status);
  r = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, payload: {} }) });
  ok('payload 缺 entries 返回 400', r.status === 400, r.status);

  // 9. 健康检查
  r = await fetch(base + '/api/health');
  const h = await r.json();
  ok('health 可用', r.status === 200 && h.ok === true);

  // 10. 持久化到磁盘
  const file = path.join(tmp, 'sync-state.json');
  ok('数据已落盘', fs.existsSync(file));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('落盘内容含 rev 与载荷', typeof saved.rev === 'number' && Array.isArray(saved.payload.entries));

  // 11. 静态目录不暴露 data
  r = await fetch(base + '/data/sync-state.json');
  ok('data 目录不可直接访问', r.status === 403 || r.status === 404, r.status);

  // 12. 未知接口
  r = await fetch(base + '/api/nope');
  ok('未知接口返回 404', r.status === 404, r.status);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n---');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
