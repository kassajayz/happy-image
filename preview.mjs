// preview.mjs — throwaway helper: downsamples entry.png to 300px so the entry
// can be judged at the size the brief asks for. Not part of the deliverable.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const src = readFileSync(new URL('./entry.png', import.meta.url));
let pos = 8;
let W = 0, H = 0;
const idat = [];
while (pos < src.length) {
  const len = src.readUInt32BE(pos);
  const type = src.toString('ascii', pos + 4, pos + 8);
  const data = src.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const stride = W * 3;
const img = Buffer.alloc(H * stride);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < H; y++) {
  const ft = raw[y * (stride + 1)];
  const off = y * (stride + 1) + 1;
  for (let i = 0; i < stride; i++) {
    const cur = raw[off + i];
    const a = i >= 3 ? img[y * stride + i - 3] : 0;
    const b = y > 0 ? img[(y - 1) * stride + i] : 0;
    const c = i >= 3 && y > 0 ? img[(y - 1) * stride + i - 3] : 0;
    let v;
    if (ft === 0) v = cur;
    else if (ft === 1) v = cur + a;
    else if (ft === 2) v = cur + b;
    else if (ft === 3) v = cur + ((a + b) >> 1);
    else v = cur + paeth(a, b, c);
    img[y * stride + i] = v & 0xff;
  }
}

const N = 300;
const out = Buffer.alloc(N * N * 3);
const scale = W / N;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const x0 = Math.floor(x * scale), x1 = Math.min(W, Math.floor((x + 1) * scale));
    const y0 = Math.floor(y * scale), y1 = Math.min(H, Math.floor((y + 1) * scale));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 3;
        r += img[i]; g += img[i + 1]; b += img[i + 2]; n++;
      }
    }
    const o = (y * N + x) * 3;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const o = Buffer.alloc(12 + data.length);
  o.writeUInt32BE(data.length, 0);
  o.write(type, 4, 'ascii');
  data.copy(o, 8);
  o.writeUInt32BE(crc32(o.subarray(4, 8 + data.length)), 8 + data.length);
  return o;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(out, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('./preview300.png', import.meta.url), png);
console.log(`preview300.png ${N}x${N} ${(png.length / 1024).toFixed(1)} KiB`);
