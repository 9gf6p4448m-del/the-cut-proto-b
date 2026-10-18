// 固定入口 play/（DL-092）換版：改 public-play/latest.json，把舊 latest 推進 history 最前面（同 sub 去重）。
//   node tools/set_latest.mjs --sub duel5 --label "v0.5 千節蛇" [--version 0.5] [--sha abc1234]
// 之後：git commit public-play/latest.json → git push → node tools/deploy_play.mjs（新版子路徑要先部署好）。
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const F = 'public-play/latest.json';
const argv = process.argv.slice(2);
const opt = (name) => { const k = argv.findIndex((a) => a === name || a.startsWith(`${name}=`)); if (k < 0) return null; return argv[k].includes('=') ? argv[k].split('=').slice(1).join('=') : argv[k + 1]; };
const sub = opt('--sub'), label = opt('--label');
if (!sub || !/^(?!play$)[a-z0-9][a-z0-9-]*$/.test(sub)) throw new Error(`--sub 必填，只能是小寫英數與連字號，且不得是 play（外殼自己）：${sub}`);
if (!label) throw new Error('--label 必填');
const old = JSON.parse(readFileSync(F, 'utf8'));
const version = opt('--version') ?? (label.match(/v(\d+(?:\.\d+)*)/) || [])[1] ?? '';
const sha = opt('--sha') ?? execSync('git rev-parse --short=7 HEAD').toString().trim();
const history = [{ label: old.label, sub: old.sub }, ...(old.history || [])].filter((h, i, a) => h.sub !== sub && a.findIndex((x) => x.sub === h.sub) === i);
const next = { version, label, sub, sha, history };
writeFileSync(F, JSON.stringify(next) + '\n');
console.log(`latest：${old.sub} → ${sub}（${label}）；history：${history.map((h) => h.sub).join('、') || '無'}`);
