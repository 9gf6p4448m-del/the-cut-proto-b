// BH-09：列出 gh-pages 根網址與各子路徑線上的 build-sha（部署前後各跑一次比對）。用法：node tests/browser/live_shas.mjs <站台根網址> <子路徑...>
const [root, ...subs] = process.argv.slice(2);
const out = {};
for (const s of ['', ...subs]) {
  const u = root.replace(/\/$/, '') + '/' + (s ? s + '/' : '') + `?nocache=${Date.now()}`;
  try { const r = await fetch(u, { cache: 'no-store' }); const t = await r.text(); out[s || '(root)'] = r.ok ? (t.match(/name="build-sha" content="([^"]+)"/)?.[1] ?? 'no-meta') : `HTTP ${r.status}`; }
  catch (e) { out[s || '(root)'] = `ERR ${e.message}`; }
}
console.log(JSON.stringify(out));
