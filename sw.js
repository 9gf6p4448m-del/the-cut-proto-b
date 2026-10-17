// 版本化快取：快取名稱帶部署 commit；首頁採網路優先，避免長期卡在舊版。
// 相容性修復（DL-069）：同一來源下還有子路徑應用（fun-exp-01/、core-skewer/、twin-slash/），各有自己的 service worker。
//  ① 只接手「根應用本身」的導航（範圍根目錄與 index.html），子路徑導航一律不攔截——不再把子頁 HTML 寫進根首頁快取。
//  ② 子路徑底下的資源請求也不攔截；根應用只讀寫自己這份快取。
//  ③ 啟用時只清 thecut-protob- 開頭的舊快取（根應用自己的），絕不刪子路徑應用的快取。
//  ④ 舊版（同一個快取名稱）會把子頁 HTML 寫進 ./index.html，而且可能在新版裝好之後才寫（DL-070，Codex R2 HIGH）。
//     所以根頁另存一份「根殼」（SHELL 鍵，只有新版會寫），離線時只從根殼或 ./ 取，絕不讀 ./index.html；啟用時再用根殼把 ./index.html 覆寫乾淨。
const PREFIX = 'thecut-protob-';
const CACHE = 'thecut-protob-42fdb21';
const ASSETS = ['./', './index.html', './app.js?v=42fdb21', './style.css?v=42fdb21', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const BASE = new URL('./', self.location.href).pathname;
const SHELL = './__root_shell__';                       // 根頁副本的快取鍵（不是真的網址；舊版 SW 不知道它，不會寫入）
const isRootFile = (url) => url.origin === self.location.origin && url.pathname.startsWith(BASE) && !url.pathname.slice(BASE.length).includes('/');
const isRootPage = (url) => isRootFile(url) && (url.pathname === BASE || url.pathname === BASE + 'index.html');
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => { await c.addAll(ASSETS); const r = await c.match('./'); if (r) await c.put(SHELL, r); }).then(() => self.skipWaiting()));
});
const offlineRoot = () => caches.open(CACHE).then(async (c) => (await c.match(SHELL)) || (await c.match('./')));
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => caches.open(CACHE)).then(async (c) => { const r = await c.match(SHELL); if (r) await c.put('./index.html', r); })   // 用根殼蓋掉可能被汙染的 ./index.html
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    if (!isRootPage(url)) return;                       // 子路徑或其他頁面：交給瀏覽器（子頁自己的 SW 或網路）
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const a = r.clone(), b = r.clone(); caches.open(CACHE).then((c) => Promise.all([c.put('./index.html', a), c.put(SHELL, b)])); }
      return r;
    }).catch(() => offlineRoot()));
    return;
  }
  if (!isRootFile(url)) return;                         // 子路徑與跨來源資源：不攔截
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req)));
});
