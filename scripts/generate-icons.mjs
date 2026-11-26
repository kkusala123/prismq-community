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
  const cx = Math.min(Math.max(x, rx + radius), rx + rw - radius);
  const cy = Math.min(Math.max(y, ry + radius), ry + rh - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function distSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const u = c2 > 0 ? Math.min(1, Math.max(0, c1 / c2)) : 0;
  return Math.hypot(px - (x1 + u * vx), py - (y1 + u * vy));
}

function mixColor(bg, fg, alpha) {
  return [
    bg[0] * (1 - alpha) + fg[0] * alpha,
    bg[1] * (1 - alpha) + fg[1] * alpha,
    bg[2] * (1 - alpha) + fg[2] * alpha,
  ];
}

function sampleIconPixel(px, py) {
  if (!insideRoundedRect(px, py, 0, 0, 512, 512, 116)) {
    return [0, 0, 0, 0];
  }

  const t = Math.min(1, Math.max(0, (px + py) / 1024));
  let rgb;
  if (t <= 0.52) {
    const k = t / 0.52;
    rgb = [15 * (1 - k) + 30 * k, 23 * (1 - k) + 58 * k, 42 * (1 - k) + 138 * k];
  } else {
    const k = (t - 0.52) / 0.48;
    rgb = [30 * (1 - k) + 37 * k, 58 * (1 - k) + 84 * k, 138 * (1 - k) + 168 * k];
  }

  // 三束折射光谱线
  if (distSegment(px, py, 274, 224, 408, 196) <= 10) {
    rgb = [56, 189, 248];
  } else if (distSegment(px, py, 292, 260, 420, 260) <= 10) {
    rgb = [52, 211, 153];
  } else if (distSegment(px, py, 308, 296, 408, 324) <= 10) {
    rgb = [251, 191, 36];
  }

  // 棱镜三折面几何体
  if (pointInTriangle(px, py, 240, 124, 124, 368, 228, 286)) {
    rgb = mixColor(rgb, [255, 255, 255], 0.97);
  } else if (pointInTriangle(px, py, 240, 124, 332, 368, 228, 286)) {
    rgb = mixColor(rgb, [147, 197, 253], 0.92);
  } else if (pointInTriangle(px, py, 124, 368, 332, 368, 228, 286)) {
    rgb = mixColor(rgb, [59, 130, 246], 0.96);
  }

  return [rgb[0], rgb[1], rgb[2], 255];
}

function renderIconPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const scale = size / 512;
  const offsets = [0.25, 0.75];

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const [r, g, b, a] = sampleIconPixel((x + offsets[sx]) / scale, (y + offsets[sy]) / scale);
          rSum += r * (a / 255);
          gSum += g * (a / 255);
          bSum += b * (a / 255);
          aSum += a;
        }
      }
      const avgA = aSum / 4;
      const offset = rowStart + 1 + x * 4;
      if (avgA > 0) {
        const premulDiv = avgA / 255;
        raw[offset] = Math.round(rSum / 4 / premulDiv);
        raw[offset + 1] = Math.round(gSum / 4 / premulDiv);
        raw[offset + 2] = Math.round(bSum / 4 / premulDiv);
        raw[offset + 3] = Math.round(avgA);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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
console.log('Generated PrismQ PWA PNG icons: public/icon-192.png, public/icon-512.png');
