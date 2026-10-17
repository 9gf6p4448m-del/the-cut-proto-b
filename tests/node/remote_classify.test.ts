// Codex R3 MEDIUM（DL-070）：deploy_root_sw 的 --remote 分類——本機路徑才轉絕對路徑；URL 與 Git SCP 語法照原樣。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRemote } from '../../tools/deploy_lib.mjs';

test('isLocalRemote：本機路徑 vs URL／SCP（含省略 user、IPv6）', () => {
  const local = ['.review/pages.git', '../x.git', 'pages.git', 'C:/a/b.git', 'C:\\a\\b.git', 'D:\\x', '/c/x/y.git', './a:b/c.git', 'dir\\a:b.git'];
  const remote = ['https://github.com/a/b.git', 'file:///c/x', 'ssh://git@host/x.git', 'git@github.com:a/b.git', 'host:repo.git', 'git@[::1]:repo.git', '[::1]:repo.git', 'host:/abs/path.git'];
  for (const r of local) assert.equal(isLocalRemote(r), true, r);
  for (const r of remote) assert.equal(isLocalRemote(r), false, r);
});
