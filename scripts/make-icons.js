// Minimal PNG icon generator (no deps) — pure Node zlib + manual PNG encoding.
// Produces icon-192.png, icon-512.png (rounded, padded) and icon-maskable.png (full-bleed).
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');

function crc32(buf) {
  let c, crcTable = crc32.table;
  if (!crcTable) {
    crcTable = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Warm terracotta -> amber diagonal gradient, matching app accent (#c1622d -> #e8a33d)
function bgColor(x, y, w, h) {
  const t = (x / w + y / h) / 2;
  return [
    Math.round(lerp(0x35, 0xE8, t) * 0 + lerp(0xC1, 0xE8, t)), // r
    Math.round(lerp(0x4A, 0xA3, t)), // g
    Math.round(lerp(0x2A, 0x3D, t)), // b
  ];
}

function setPx(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

// Draw a rounded-rect mask (for non-maskable icons) and a simple "M" chevron glyph mark.
function drawIcon(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const radius = maskable ? 0 : size * 0.22;
  const cx = size / 2, cy = size / 2;

  function insideRoundedSquare(x, y) {
    if (radius === 0) return true;
    const rx = Math.max(0, Math.abs(x - cx) - (size / 2 - radius));
    const ry = Math.max(0, Math.abs(y - cy) - (size / 2 - radius));
    return rx * rx + ry * ry <= radius * radius;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedSquare(x, y)) continue;
      const [r, g, b] = bgColor(x, y, size, size);
      setPx(buf, size, x, y, r, g, b, 255);
    }
  }

  // Subtle inner glow (radial, lighter center-top) for depth
  const glowR = size * 0.65;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy * 0.75;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < glowR) {
        const t = 1 - d / glowR;
        const i = (y * size + x) * 4;
        if (buf[i + 3] > 0) {
          buf[i] = Math.min(255, buf[i] + t * 30);
          buf[i + 1] = Math.min(255, buf[i + 1] + t * 22);
          buf[i + 2] = Math.min(255, buf[i + 2] + t * 10);
        }
      }
    }
  }

  // Monogram: a rising chevron/"peak" mark (like a mountain / momentum arrow) in cream,
  // sized within the maskable-safe zone (inner 80% for maskable, ~62% for standard).
  const safe = maskable ? size * 0.5 : size * 0.62;
  const half = safe / 2;
  const strokeW = size * 0.085;
  const baseY = cy + half * 0.62;
  const peakY = cy - half * 0.75;
  const leftX = cx - half * 0.85;
  const rightX = cx + half * 0.85;

  function distToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 === 0 ? 0 : (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cxp = ax + abx * t, cyp = ay + aby * t;
    const dx = px - cxp, dy = py - cyp;
    return Math.sqrt(dx * dx + dy * dy);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = distToSegment(x, y, leftX, baseY, cx, peakY);
      const d2 = distToSegment(x, y, cx, peakY, rightX, baseY);
      const d = Math.min(d1, d2);
      if (d <= strokeW / 2) {
        const edge = strokeW / 2 - d;
        const alpha = Math.min(1, edge / 1.2) * 255;
        setPx(buf, size, x, y, 0xFB, 0xF3, 0xE7, Math.max(buf[(y * size + x) * 4 + 3], alpha));
      }
      // small dot accent above the peak
      const dotDx = x - cx, dotDy = y - (peakY - strokeW * 1.3);
      if (Math.sqrt(dotDx * dotDx + dotDy * dotDy) <= strokeW * 0.55) {
        setPx(buf, size, x, y, 0xFB, 0xF3, 0xE7, 255);
      }
    }
  }

  return buf;
}

fs.mkdirSync(OUT, { recursive: true });

const sizes = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable.png', 512, true],
];

for (const [name, size, maskable] of sizes) {
  const buf = drawIcon(size, { maskable });
  const png = encodePNG(size, size, buf);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('wrote', name, png.length, 'bytes');
}

// favicon: reuse the 192 render but write as favicon.png (simple, browsers accept PNG favicons)
fs.copyFileSync(path.join(OUT, 'icon-192.png'), path.join(OUT, 'favicon.png'));
console.log('wrote favicon.png');
