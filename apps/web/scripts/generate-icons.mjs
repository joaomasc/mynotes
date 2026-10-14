#!/usr/bin/env node
/**
 * Generates the MyNotes app icons (PNG + SVG) without native dependencies.
 * Run once after changing the design: `node scripts/generate-icons.mjs`.
 * Glyph: a page with a folded corner and three text lines, on the accent color.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const ACCENT = [15, 110, 106];
const PAGE = [255, 255, 255];
const FOLD = [196, 226, 222];

const page = { x0: 0.29, y0: 0.2, x1: 0.71, y1: 0.8, fold: 0.13 };
const lines = [
  { y: 0.47, x0: 0.37, x1: 0.63 },
  { y: 0.57, x0: 0.37, x1: 0.63 },
  { y: 0.67, x0: 0.37, x1: 0.55 },
];
const LINE_HALF = 0.022;

function inRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const pagePoly = [
  [page.x0, page.y0],
  [page.x1 - page.fold, page.y0],
  [page.x1, page.y0 + page.fold],
  [page.x1, page.y1],
  [page.x0, page.y1],
];
const foldPoly = [
  [page.x1 - page.fold, page.y0],
  [page.x1 - page.fold, page.y0 + page.fold],
  [page.x1, page.y0 + page.fold],
];

function inLine(x, y) {
  return lines.some((l) => {
    const cx = Math.min(Math.max(x, l.x0), l.x1);
    return (x - cx) ** 2 + (y - l.y) ** 2 <= LINE_HALF ** 2;
  });
}

/** Color at normalized point (u,v) in glyph space; null = transparent. */
function sample(u, v, opts) {
  const bg = opts.fullBleed ? true : inRoundedRect(u, v, 0.22);
  if (!bg) return null;
  // Map into glyph space (maskable icons keep the glyph inside the safe zone).
  const s = opts.glyphScale;
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;
  if (inPolygon(x, y, foldPoly)) return FOLD;
  if (inPolygon(x, y, pagePoly)) return inLine(x, y) ? ACCENT : PAGE;
  return ACCENT;
}

function render(size, opts) {
  const SS = 4;
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    data[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      data[o] = a ? Math.round(r / a) : 0;
      data[o + 1] = a ? Math.round(g / a) : 0;
      data[o + 2] = a ? Math.round(b / a) : 0;
      data[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return png(size, size, data);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, { fullBleed: false, glyphScale: 1 }],
  ['icon-512.png', 512, { fullBleed: false, glyphScale: 1 }],
  ['icon-maskable-512.png', 512, { fullBleed: true, glyphScale: 0.78 }],
  ['apple-touch-icon.png', 180, { fullBleed: true, glyphScale: 0.85 }],
  ['favicon-32.png', 32, { fullBleed: false, glyphScale: 1.1 }],
];
for (const [name, size, opts] of icons) writeFileSync(join(out, name), render(size, opts));

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const pts = (poly) => poly.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(' ');
writeFileSync(
  join(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${hex(ACCENT)}"/>
  <polygon points="${pts(pagePoly)}" fill="${hex(PAGE)}"/>
  <polygon points="${pts(foldPoly)}" fill="${hex(FOLD)}"/>
  ${lines
    .map(
      (l) =>
        `<line x1="${l.x0 * 100}" y1="${l.y * 100}" x2="${l.x1 * 100}" y2="${l.y * 100}" stroke="${hex(ACCENT)}" stroke-width="${LINE_HALF * 200}" stroke-linecap="round"/>`,
    )
    .join('\n  ')}
</svg>
`,
);
console.log(`Icons written to ${out}`);
