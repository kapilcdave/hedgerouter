// Trace the blocky Hedgerouter mark out of the source PNG into a transparent SVG.
// The mark is axis-aligned rectangles, so a run/band decomposition is exact.
// Usage: node tools/png-to-svg.mjs assets/mark.png assets/mark.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/png-to-svg.mjs <in.png> <out.svg>');
  process.exit(1);
}

const buf = readFileSync(inPath);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

let pos = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];

while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
    if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') {
    break;
  }
  pos += 12 + len;
}

const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
if (!channels) throw new Error(`unsupported color type ${colorType}`);

const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const pixels = Buffer.alloc(height * stride);

// undo PNG per-scanline filters
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const out = pixels.subarray(y * stride, (y + 1) * stride);
  const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? out[x - channels] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= channels ? prev[x - channels] : 0;
    const v = line[x];
    switch (filter) {
      case 0: out[x] = v; break;
      case 1: out[x] = (v + a) & 0xff; break;
      case 2: out[x] = (v + b) & 0xff; break;
      case 3: out[x] = (v + ((a + b) >> 1)) & 0xff; break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[x] = (v + pred) & 0xff;
        break;
      }
      default: throw new Error(`bad filter ${filter}`);
    }
  }
}

const isInk = (x, y) => {
  const i = y * stride + x * channels;
  const alpha = channels === 4 ? pixels[i + 3] : channels === 2 ? pixels[i + 1] : 255;
  if (alpha < 128) return false;
  const lum = channels >= 3
    ? 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    : pixels[i];
  return lum < 128;
};

// runs of ink per row
const rowRuns = [];
for (let y = 0; y < height; y++) {
  const runs = [];
  let start = -1;
  for (let x = 0; x < width; x++) {
    if (isInk(x, y)) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      runs.push([start, x]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, width]);
  rowRuns.push(runs);
}

// merge vertically adjacent rows whose runs are identical
const key = (runs) => runs.map(([a, b]) => `${a}:${b}`).join(',');
const rects = [];
let y = 0;
while (y < height) {
  const k = key(rowRuns[y]);
  let end = y + 1;
  while (end < height && key(rowRuns[end]) === k) end++;
  if (rowRuns[y].length) {
    for (const [x0, x1] of rowRuns[y]) rects.push([x0, y, x1 - x0, end - y]);
  }
  y = end;
}

// trim to the ink bounding box so the SVG has no dead margin
const minX = Math.min(...rects.map((r) => r[0]));
const minY = Math.min(...rects.map((r) => r[1]));
const maxX = Math.max(...rects.map((r) => r[0] + r[2]));
const maxY = Math.max(...rects.map((r) => r[1] + r[3]));

const body = rects
  .map(([x, ry, w, h]) => `<rect x="${x - minX}" y="${ry - minY}" width="${w}" height="${h}"/>`)
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX - minX} ${maxY - minY}" fill="currentColor" shape-rendering="crispEdges">${body}</svg>\n`;
writeFileSync(outPath, svg);
console.log(`${rects.length} rects · ${maxX - minX}x${maxY - minY} · ${svg.length} bytes`);
