/* 时间账本 service worker
 * 策略：
 *   页面导航 → 网络优先（保证部署后能拿到新版），断网时回落缓存
 *   静态资源 → 缓存优先
 */
const CACHE = 'time-tally-v4';
const SHELL = new URL('./index.html', self.location).href;
const ASSETS = [
  SHELL,
  new URL('./manifest.webmanifest', self.location).href,
  new URL('./icons/icon-192.png', self.location).href,
  new URL('./icons/icon-512.png', self.location).href
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 页面本身：网络优先，离线回落缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || caches.match(e.request)))
    );
    return;
  }

  // 其余静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL));
    })
  );
});
