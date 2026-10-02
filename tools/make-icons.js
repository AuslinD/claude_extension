// Generates icons/icon{16,48,128}.png (a four-color pie) with no dependencies: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COLORS = [[239, 68, 68], [234, 179, 8], [34, 197, 94], [59, 130, 246]];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = (size - 1) / 2, r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const d = Math.hypot(dx, dy);
      const alpha = Math.max(0, Math.min(1, r - d + 0.5));
      const quadrant = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 4) % 4;
      const [R, G, B] = d < r * 0.38 ? [255, 255, 255] : COLORS[quadrant];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(out, `icon${s}.png`), png(s));
console.log('icons written to', out);
