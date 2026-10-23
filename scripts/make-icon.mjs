/**
 * Génère l'icône de l'application (PNG + ICO multi-résolutions) sans dépendance
 * binaire externe. Rendu par suréchantillonnage pour un anti-aliasing propre.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngFromRgba(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Distance signée d'un rectangle arrondi centré sur (cx, cy). */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Distance signée approchée d'une « étincelle » à quatre branches : une
 * superellipse d'exposant < 1, dont les flancs sont concaves. Reprend le
 * pictogramme Sparkles de la barre latérale pour que l'icône du bureau et
 * l'identité de l'application coïncident.
 */
function sparkleSdf(x, y, cx, cy, r, sharpness = 0.58) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  const value = (dx ** sharpness + dy ** sharpness) ** (1 / sharpness);
  return (value - 1) * r * 0.5;
}

function renderIcon(size) {
  const SS = 4;
  const W = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  const pad = W * 0.035;
  const half = W / 2 - pad;
  const radius = W * 0.235;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px * SS + sx + 0.5;
          const y = py * SS + sy + 0.5;
          // Fond : carré arrondi avec dégradé diagonal violet -> indigo.
          const d = roundedRectSdf(x, y, W / 2, W / 2, half, half, radius);
          const bgCov = 1 - smoothstep(-1.2, 1.2, d);
          if (bgCov <= 0) continue;
          const t = clamp((x / W) * 0.6 + (y / W) * 0.4);
          let cr = mix(124, 67, t);
          let cg = mix(92, 56, t);
          let cb = mix(246, 225, t);
          // Léger halo lumineux en haut à gauche.
          const glow = clamp(1 - Math.hypot(x - W * 0.3, y - W * 0.22) / (W * 0.55)) * 0.35;
          cr = mix(cr, 255, glow * 0.35);
          cg = mix(cg, 255, glow * 0.3);
          cb = mix(cb, 255, glow * 0.35);

          // Marque : grande étincelle + petite étincelle, comme la sidebar.
          const big = 1 - smoothstep(-1.1, 1.1, sparkleSdf(x, y, W * 0.455, W * 0.545, W * 0.285));
          const small = 1 - smoothstep(-1.1, 1.1, sparkleSdf(x, y, W * 0.705, W * 0.315, W * 0.135));
          const mark = Math.max(big, small);

          cr = mix(cr, 255, mark);
          cg = mix(cg, 255, mark);
          cb = mix(cb, 255, mark);

          r += cr * bgCov;
          g += cg * bgCov;
          b += cb * bgCov;
          a += bgCov;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const idx = (py * size + px) * 4;
      buf[idx] = alpha > 0 ? Math.round(r / a) : 0;
      buf[idx + 1] = alpha > 0 ? Math.round(g / a) : 0;
      buf[idx + 2] = alpha > 0 ? Math.round(b / a) : 0;
      buf[idx + 3] = Math.round(alpha * 255);
    }
  }
  return pngFromRgba(size, size, buf);
}

function icoFromPngs(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

await mkdir(BUILD, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, png: renderIcon(size) }));
await writeFile(path.join(BUILD, 'icon.ico'), icoFromPngs(pngs));
const png512 = renderIcon(512);
await writeFile(path.join(BUILD, 'icon.png'), png512);
await writeFile(path.join(BUILD, 'icon-256.png'), pngs[pngs.length - 1].png);
// eslint-disable-next-line no-console
console.log('Icons written to build/icon.ico, build/icon.png');
