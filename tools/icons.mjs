// 產生主畫面圖示（純程式繪製，無第三方素材）：深色底、血肉圓形、骨白斜切線。
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5, v = (y + 0.5) / size - 0.5;
      let c = [0x11, 0x15, 0x1b];
      const r = Math.hypot(u, v);
      if (r < 0.36) { const t = r / 0.36; c = [Math.round(0x8c - 40 * t), Math.round(0x26 - 10 * t), Math.round(0x35 - 10 * t)]; }
      const d = Math.abs(u + v * 0.85) / Math.hypot(1, 0.85);
      if (d < 0.025 && r < 0.42) c = [0xe6, 0xd7, 0xbf];
      const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) writeFileSync(`public/icon-${s}.png`, png(s));
console.log('icons ok');
