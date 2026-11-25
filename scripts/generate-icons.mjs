import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function insideRoundedRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + radius), rx + rw - radius - 1);
  const cy = Math.min(Math.max(y, ry + radius), ry + rh - radius - 1);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIconPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const scale = size / 512;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x += 1) {
      const px = x / scale;
      const py = y / scale;
      const t = (px + py) / 1024;
      // 品牌渐变蓝
      let r = Math.round(47 * (1 - t) + 19 * t);
      let g = Math.round(130 * (1 - t) + 77 * t);
      let b = Math.round(255 * (1 - t) + 225 * t);
      let a = 255;

      // 白色试卷卡片
      if (insideRoundedRect(px, py, 108, 92, 296, 328, 34)) {
        r = 252;
        g = 253;
        b = 255;
        if (insideRoundedRect(px, py, 152, 148, 144, 22, 11)) {
          r = 26;
          g = 98;
          b = 245;
        } else if (insideRoundedRect(px, py, 152, 196, 208, 18, 9)) {
          r = 148;
          g = 163;
          b = 184;
        } else if (insideRoundedRect(px, py, 152, 236, 184, 18, 9)) {
          r = 148;
          g = 163;
          b = 184;
        }
      }

      // 绿色对勾徽章
      const dx = px - 330;
      const dy = py - 336;
      const distSq = dx * dx + dy * dy;
      if (distSq <= 78 * 78) {
        r = 16;
        g = 185;
        b = 129;

        // 简化对勾线条距离判定
        const distSeg = (x1, y1, x2, y2) => {
          const vx = x2 - x1;
          const vy = y2 - y1;
          const wx = px - x1;
          const wy = py - y1;
          const c1 = vx * wx + vy * wy;
          const c2 = vx * vx + vy * vy;
          const u = c2 > 0 ? Math.min(1, Math.max(0, c1 / c2)) : 0;
          const ix = x1 + u * vx;
          const iy = y1 + u * vy;
          return Math.hypot(px - ix, py - iy);
        };
        if (distSeg(292, 336, 318, 362) <= 10 || distSeg(318, 362, 370, 306) <= 10) {
          r = 255;
          g = 255;
          b = 255;
        }
      }

      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const publicDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), renderIconPng(192));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), renderIconPng(512));
console.log('Generated PWA PNG icons: public/icon-192.png, public/icon-512.png');
