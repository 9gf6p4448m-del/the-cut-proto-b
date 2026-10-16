// 測試用靜態伺服器（只在本機）：/ → dist/，/dist-test/、/golden/ → 對應目錄。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function serve(root = '.', port = 0) {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = p.startsWith('/dist-test/') || p.startsWith('/golden/') ? join(root, p) : join(root, 'dist', p);
      if (!normalize(file).startsWith(normalize(root))) { rsp.writeHead(403); return rsp.end(); }
      try { const b = await readFile(file); rsp.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); rsp.end(b); }
      catch { rsp.writeHead(404); rsp.end('not found'); }
    });
    srv.listen(port, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
