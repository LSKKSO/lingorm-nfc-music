/* NFC 音乐站 Service Worker —— 仅用于「可安装 PWA」+ 应用壳缓存。
   歌曲 mp3（几百 MB）不缓存，直接走网络；player.js / index.html 走网络优先，保证逻辑永远最新。 */
const CACHE = 'nfc-music-shell-v1';
const SHELL = [
  './',
  './index.html',
  './player.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // 歌曲：网络优先且不缓存（体积太大）
  if (/\.mp3(\?|$)/i.test(u.pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 应用壳（html/js/json/webmanifest/icon）：网络优先，失败回退缓存 —— 保证逻辑常新又能离线打开
  if (/(\.html|\.js|manifest\.webmanifest|icon-)/i.test(u.pathname)) {
    e.respondWith(
      fetch(req).then((r) => {
        const cp = r.clone();
        caches.open(CACHE).then((c) => c.put(req, cp));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 其余：网络优先，回退缓存
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
