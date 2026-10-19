// 測試用靜態伺服器（只在本機）：/ → dist/，/fun-exp-01/ → dist-exp/、/core-skewer/ → dist-skewer/、/twin-slash/ → dist-twin/、/twin-sim/ → dist-sim/、/rt-cut/ → dist-rt/、/rt-cut2/ → dist-rt2/、/art-kit/ → dist-art/（模擬子路徑部署），/dist-test/、/golden/ → 對應目錄。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function serve(root = '.', port = 0) {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/fun-exp-01') { rsp.writeHead(301, { location: '/fun-exp-01/' }); return rsp.end(); }
      if (p === '/core-skewer') { rsp.writeHead(301, { location: '/core-skewer/' }); return rsp.end(); }
      if (p === '/core-skewer/') p = '/core-skewer/index.html';
      if (p === '/twin-slash') { rsp.writeHead(301, { location: '/twin-slash/' }); return rsp.end(); }
      if (p === '/twin-slash/') p = '/twin-slash/index.html';
      if (p === '/art-kit') { rsp.writeHead(301, { location: '/art-kit/' }); return rsp.end(); }
      if (p === '/art-kit/') p = '/art-kit/index.html';
      if (p === '/rt-cut2') { rsp.writeHead(301, { location: '/rt-cut2/' }); return rsp.end(); }
      if (p === '/rt-cut2/') p = '/rt-cut2/index.html';
      if (p === '/duel') { rsp.writeHead(301, { location: '/duel/' }); return rsp.end(); }
      if (p === '/duel/') p = '/duel/index.html';
      if (p === '/duel6') { rsp.writeHead(301, { location: '/duel6/' }); return rsp.end(); }
      if (p === '/duel6/') p = '/duel6/index.html';
      if (p === '/duel5') { rsp.writeHead(301, { location: '/duel5/' }); return rsp.end(); }
      if (p === '/duel5/') p = '/duel5/index.html';
      if (p === '/duel4') { rsp.writeHead(301, { location: '/duel4/' }); return rsp.end(); }
      if (p === '/duel4/') p = '/duel4/index.html';
      if (p === '/duel3') { rsp.writeHead(301, { location: '/duel3/' }); return rsp.end(); }
      if (p === '/duel3/') p = '/duel3/index.html';
      if (p === '/duel2') { rsp.writeHead(301, { location: '/duel2/' }); return rsp.end(); }
      if (p === '/duel2/') p = '/duel2/index.html';
      if (p === '/rt-cut') { rsp.writeHead(301, { location: '/rt-cut/' }); return rsp.end(); }
      if (p === '/rt-cut/') p = '/rt-cut/index.html';
      if (p === '/twin-sim') { rsp.writeHead(301, { location: '/twin-sim/' }); return rsp.end(); }
      if (p === '/twin-sim/') p = '/twin-sim/index.html';
      if (p === '/') p = '/index.html';
      if (p === '/fun-exp-01/') p = '/fun-exp-01/index.html';
      const file = p.startsWith('/dist-test/') || p.startsWith('/golden/') ? join(root, p) : p.startsWith('/duel6/') ? join(root, 'dist-duel6', p.slice('/duel6/'.length)) : p.startsWith('/duel5/') ? join(root, 'dist-duel5', p.slice('/duel5/'.length)) : p.startsWith('/duel4/') ? join(root, 'dist-duel4', p.slice('/duel4/'.length)) : p.startsWith('/duel3/') ? join(root, 'dist-duel3', p.slice('/duel3/'.length)) : p.startsWith('/duel2/') ? join(root, 'dist-duel2', p.slice('/duel2/'.length)) : p.startsWith('/duel/') ? join(root, 'dist-duel', p.slice('/duel/'.length)) : p.startsWith('/art-kit/') ? join(root, 'dist-art', p.slice('/art-kit/'.length)) : p.startsWith('/rt-cut2/') ? join(root, 'dist-rt2', p.slice('/rt-cut2/'.length)) : p.startsWith('/rt-cut/') ? join(root, 'dist-rt', p.slice('/rt-cut/'.length)) : p.startsWith('/twin-sim/') ? join(root, 'dist-sim', p.slice('/twin-sim/'.length)) : p.startsWith('/twin-slash/') ? join(root, 'dist-twin', p.slice('/twin-slash/'.length)) : p.startsWith('/core-skewer/') ? join(root, 'dist-skewer', p.slice('/core-skewer/'.length)) : p.startsWith('/fun-exp-01/') ? join(root, 'dist-exp', p.slice('/fun-exp-01/'.length)) : join(root, 'dist', p);
      if (!normalize(file).startsWith(normalize(root))) { rsp.writeHead(403); return rsp.end(); }
      try { const b = await readFile(file); rsp.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); rsp.end(b); }
      catch { rsp.writeHead(404); rsp.end('not found'); }
    });
    srv.listen(port, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
