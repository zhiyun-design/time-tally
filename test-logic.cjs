// 在 Node 里加载 index.html 的内联脚本，执行内置自测（不依赖浏览器 DOM）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) {
  console.error('未找到内联脚本');
  process.exit(1);
}
const code = scripts[scripts.length - 1];

const body = {};
const doc = {
  body,
  title: '',
  readyState: 'complete',
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};

const ctx = {
  document: doc,
  location: { search: '?selftest=1', protocol: 'file:' },
  navigator: { userAgent: 'node' },
  crypto: globalThis.crypto,
  console,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (f) => f(),
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
  },
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);

try {
  vm.runInContext(code, ctx, { filename: 'index.html#inline' });
} catch (err) {
  console.error('脚本执行抛错：');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

const out = (body.innerHTML || '').replace(/<\/?pre[^>]*>/g, '');
console.log(out);
const fails = (out.match(/^FAIL/gm) || []).length;
console.log('\n---');
console.log('通过 ' + ((out.match(/^PASS/gm) || []).length) + ' 项，失败 ' + fails + ' 项');
process.exit(fails ? 1 : 0);
