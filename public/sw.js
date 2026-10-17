// 版本化快取：快取名稱帶部署 commit；首頁採網路優先，避免長期卡在舊版。
// 相容性修復（DL-069）：同一來源下還有子路徑應用（fun-exp-01/、core-skewer/、twin-slash/），各有自己的 service worker。
//  ① 只接手「根應用本身」的導航（範圍根目錄與 index.html），子路徑導航一律不攔截——不再把子頁 HTML 寫進根首頁快取。
//  ② 子路徑底下的資源請求也不攔截；根應用只讀寫自己這份快取。
//  ③ 啟用時只清 thecut-protob- 開頭的舊快取（根應用自己的），絕不刪子路徑應用的快取。
//  ④ 舊版可能已把子頁 HTML 寫進根首頁快取：新版 install 時 addAll 重新抓取根頁並覆寫同名快取裡的 ./index.html（線上根頁 SHA 不變時快取名稱相同，靠覆寫恢復）。
const PREFIX = 'thecut-protob-';
const CACHE = 'thecut-protob-__BUILD_SHA__';
const ASSETS = ['./', './index.html', './app.js?v=__BUILD_SHA__', './style.css?v=__BUILD_SHA__', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const BASE = new URL('./', self.location.href).pathname;
const isRootFile = (url) => url.origin === self.location.origin && url.pathname.startsWith(BASE) && !url.pathname.slice(BASE.length).includes('/');
const isRootPage = (url) => isRootFile(url) && (url.pathname === BASE || url.pathname === BASE + 'index.html');
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    if (!isRootPage(url)) return;                       // 子路徑或其他頁面：交給瀏覽器（子頁自己的 SW 或網路）
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); } return r; }).catch(() => caches.open(CACHE).then((c) => c.match('./index.html'))));
    return;
  }
  if (!isRootFile(url)) return;                         // 子路徑與跨來源資源：不攔截
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req)));
});
