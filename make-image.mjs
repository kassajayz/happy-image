// make-image.mjs — draws entry.png procedurally with the Node standard library only.
// No packages, no network, no randomness: every run writes identical bytes.
//
// The picture: a bear cub holds up a spoon of honey for its bee friend. The bee
// hovers over the spoon, a drop is just about to fall, and the bear is beaming.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 1024;
const H = 1024;
const buf = new Float32Array(W * H * 3);

/* ------------------------------------------------------------------ math */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

/* -------------------------------------------------------------- palette */
const FUR = {
  deep: rgb('#5c3319'),
  dark: rgb('#7a4720'),
  mid: rgb('#b0743a'),
  light: rgb('#dda368'),
  rim: rgb('#ffe0b0'),
  cool: rgb('#6b3f4d'),
};
const C = {
  ink: rgb('#3a2115'),
  muzzle: rgb('#fff2d9'),
  muzzleShade: rgb('#e8c9a0'),
  blush: rgb('#f28d78'),
  innerEar: rgb('#eda893'),
  tongue: rgb('#e8736a'),
  honeyDeep: rgb('#b96f00'),
  honey: rgb('#ffb52e'),
  honeyLight: rgb('#ffe07a'),
  honeySpark: rgb('#fff6d8'),
  woodDark: rgb('#8a5526'),
  woodMid: rgb('#b9773a'),
  woodLight: rgb('#dfa765'),
  bee: rgb('#2b1a12'),
  beeGold: rgb('#f5b62e'),
  wing: rgb('#fffdf6'),
};
const BG = {
  top: rgb('#fffaf1'),
  mid: rgb('#ffeacd'),
  bottom: rgb('#f6c092'),
  glow: rgb('#fff3d6'),
  cell: rgb('#d99c52'),
  vignette: rgb('#b5713d'),
};
const LIGHT = (() => {
  const x = -0.55, y = -0.83;
  const l = Math.hypot(x, y);
  return [x / l, y / l];
})();
const LAMP = [280, 190, 1150];

/* ------------------------------------------------------------ sdf tools */
const sdCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const sdEllipse = (cx, cy, rx, ry) => (x, y) => {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
};
const sdEllipseRot = (cx, cy, rx, ry, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    const u = dx * c + dy * s;
    const v = -dx * s + dy * c;
    return (Math.hypot(u / rx, v / ry) - 1) * Math.min(rx, ry);
  };
};
const sdRoundRect = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const distSeg = (px, py, ax, ay, bx, by) => {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const len2 = bax * bax + bay * bay || 1e-6;
  const h = clamp((pax * bax + pay * bay) / len2);
  return Math.hypot(pax - bax * h, pay - bay * h);
};
const sdStroke = (pts, r0, r1 = r0) => (x, y) => {
  let best = Infinity;
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const v = distSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - lerp(r0, r1, i / last);
    if (v < best) best = v;
  }
  return best;
};
function arcPts(cx, cy, r, a0, a1, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
function normalAt(sdf, x, y, e = 1.8) {
  const dx = sdf(x + e, y) - sdf(x - e, y);
  const dy = sdf(x, y + e) - sdf(x, y - e);
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/* ------------------------------------------------------------ painting */
function fill(sdf, color, opts = {}) {
  const { alpha = 1, bbox = [0, 0, W, H], mode = 'over' } = opts;
  const x0 = Math.max(0, Math.floor(bbox[0]));
  const y0 = Math.max(0, Math.floor(bbox[1]));
  const x1 = Math.min(W, Math.ceil(bbox[2]));
  const y1 = Math.min(H, Math.ceil(bbox[3]));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = sdf(px, py);
      if (d > 1) continue;
      const cov = clamp(0.5 - d) * alpha;
      if (cov <= 0) continue;
      const c = typeof color === 'function' ? color(px, py, d) : color;
      const i = (y * W + x) * 3;
      if (mode === 'add') {
        buf[i] += c[0] * cov;
        buf[i + 1] += c[1] * cov;
        buf[i + 2] += c[2] * cov;
      } else {
        buf[i] = lerp(buf[i], c[0], cov);
        buf[i + 1] = lerp(buf[i + 1], c[1], cov);
        buf[i + 2] = lerp(buf[i + 2], c[2], cov);
      }
    }
  }
}

// A feathered ellipse whose alpha reaches exactly zero at `outer`, so its
// bounding box can never show a seam.
function softFill(cx, cy, rx, ry, inner, outer, color, alpha = 1) {
  const field = (x, y) => 1 - smoothstep(inner, outer, Math.hypot((x - cx) / rx, (y - cy) / ry));
  fill((x, y) => 0.5 - field(x, y), color, {
    alpha,
    bbox: [cx - rx * outer - 2, cy - ry * outer - 2, cx + rx * outer + 2, cy + ry * outer + 2],
  });
}

function furColor(x, y, d, sdf) {
  const t = 1 - clamp(Math.hypot(x - LAMP[0], y - LAMP[1]) / LAMP[2]);
  let c = mixC(FUR.deep, FUR.light, smoothstep(0.02, 0.96, t));
  c = mixC(c, FUR.mid, 0.28);
  if (d > -110) {
    const n = normalAt(sdf, x, y);
    const dot = n[0] * LIGHT[0] + n[1] * LIGHT[1];
    const lit = clamp(dot);
    const rim = smoothstep(0.5, 1, clamp(1 + d / 90)) * lit ** 2;
    c = mixC(c, FUR.rim, rim * 0.6);
    const core = smoothstep(0.35, 1, clamp(1 + d / 80)) * clamp(-dot) ** 2;
    c = mixC(c, FUR.deep, core * 0.38);
    const cool = smoothstep(0.2, 1, clamp(1 + d / 90)) * clamp(-dot);
    c = mixC(c, FUR.cool, cool * 0.22);
  }
  const bounce = smoothstep(0.55, 1, clamp(1 + d / 130)) * smoothstep(620, 940, y);
  return mixC(c, C.honey, bounce * 0.22);
}

/* ------------------------------------------------------- 1. background */
for (let y = 0; y < H; y++) {
  const tv = y / (H - 1);
  const base = tv < 0.55
    ? mixC(BG.top, BG.mid, smoothstep(0, 0.55, tv))
    : mixC(BG.mid, BG.bottom, smoothstep(0.55, 1, (tv - 0.55) / 0.45));
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buf[i] = base[0];
    buf[i + 1] = base[1];
    buf[i + 2] = base[2];
  }
}

// warm glow behind the head, so the silhouette separates from the wall
softFill(440, 320, 520, 470, 0.08, 1.0, BG.glow, 0.7);

// faint honeycomb, fading out toward the floor
{
  const s = 60;
  const dx = s * Math.sqrt(3);
  const dy = s * 1.5;
  for (let row = -1; row * dy < 900; row++) {
    for (let col = -1; col * dx < W + dx; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * dy;
      const fade = 1 - smoothstep(240, 690, cy);
      if (fade <= 0.02) continue;
      const pts = [];
      for (let k = 0; k < 7; k++) {
        const a = (Math.PI / 180) * (30 + 60 * (k % 6));
        pts.push([cx + Math.cos(a) * s, cy + Math.sin(a) * s]);
      }
      fill(sdStroke(pts, 7), BG.cell, {
        alpha: 0.062 * fade,
        bbox: [cx - s - 12, cy - s - 12, cx + s + 12, cy + s + 12],
      });
    }
  }
}

// soft out-of-focus lights
for (const [x, y, r, a] of [
  [116, 142, 64, 0.2],
  [950, 232, 52, 0.13],
  [76, 590, 46, 0.1],
  [690, 88, 38, 0.09],
  [938, 726, 44, 0.09],
]) {
  softFill(x, y, r, r, 0.3, 1.05, BG.glow, a);
}

/* ---------------------------------------------------------- 2. the bear */
const headSDF = sdCircle(400, 330, 205);
const earL = sdCircle(236, 156, 88);
const earR = sdCircle(566, 146, 92);
const torso = sdRoundRect(400, 840, 300, 300, 200);
const bearSDF = (x, y) => {
  let d = smin(headSDF(x, y), torso(x, y), 150);
  d = smin(d, earL(x, y), 26);
  d = smin(d, earR(x, y), 26);
  return d;
};

// contact shadow on the ground
softFill(400, 1000, 330, 54, 0.2, 1.14, rgb('#a15a22'), 0.28);

// the body and head
fill(bearSDF, (x, y, d) => furColor(x, y, d, bearSDF), { bbox: [80, 50, 740, 1024] });

// honey light rising through the lower body, cool shadow in the near corner
softFill(760, 1010, 320, 200, 0.05, 1.0, C.honey, 0.15);
softFill(90, 1030, 210, 220, 0.05, 1.0, FUR.cool, 0.16);

// inner ears
for (const [ex, ey, er] of [[240, 160, 46], [564, 150, 48]]) {
  fill(sdEllipse(ex, ey, er, er * 0.94), (x, y) => mixC(C.innerEar, FUR.deep, clamp(0.1 + (y - ey) / 150)), {
    bbox: [ex - er - 8, ey - er - 8, ex + er + 8, ey + er + 8],
  });
}

// muzzle
const muzzleSDF = sdEllipse(400, 448, 126, 90);
fill(
  muzzleSDF,
  (x, y, d) => {
    const t = clamp(0.66 - (x - 400) / 900 - (y - 448) / 640);
    let c = mixC(C.muzzleShade, C.muzzle, smoothstep(0.1, 0.9, t));
    if (d > -30) c = mixC(c, C.muzzleShade, clamp(1 + d / 30) * 0.45);
    return c;
  },
  { bbox: [266, 350, 534, 550] },
);

// soft light pooling on the chest
softFill(356, 806, 196, 250, 0.05, 1.0, FUR.light, 0.26);
softFill(520, 980, 200, 150, 0.1, 1.0, FUR.deep, 0.24);

// cheeks
for (const ex of [268, 534]) softFill(ex, 414, 62, 40, 0.1, 1.0, C.blush, 0.52);

// eyes, closed and happy
for (const ex of [306, 492]) {
  fill(sdStroke(arcPts(ex, 312, 34, Math.PI * 1.1, Math.PI * 1.9, 22), 15, 11), C.ink, {
    bbox: [ex - 52, 248, ex + 52, 356],
  });
}

// nose
fill(sdEllipse(400, 404, 40, 30), (x, y) => mixC(C.ink, rgb('#5f3d2b'), clamp((y - 382) / 90)), {
  bbox: [352, 368, 448, 442],
});
softFill(385, 392, 13, 9, 0, 1, rgb('#8a5b48'), 0.9);

// open, laughing mouth
const mouthSDF = (x, y) => smax(sdEllipse(400, 470, 46, 42)(x, y), 476 - y, 14);
fill(mouthSDF, C.ink, { bbox: [346, 460, 454, 520] });
fill((x, y) => Math.max(mouthSDF(x, y), sdEllipse(400, 496, 28, 17)(x, y)), C.tongue, {
  bbox: [366, 476, 434, 520],
});
softFill(400, 488, 19, 8, 0.1, 1.0, rgb('#a35a4e'), 0.35);

/* ------------------------------------------- 3. the spoon and the bee */
const BOWL = { x: 752, y: 558, rx: 70, ry: 44, rot: -0.2 };
const PAW = { x: 626, y: 692, rx: 66, ry: 58 };

// spoon handle
const handleSDF = sdStroke([[620, 718], [722, 586]], 14, 12);
fill(handleSDF, (x, y, d) => {
  const t = clamp(0.55 - (x - 620) / 300);
  let c = mixC(C.woodDark, C.woodLight, smoothstep(0.05, 0.95, t));
  if (d > -6) c = mixC(c, C.woodDark, clamp(1 + d / 6) * 0.5);
  return c;
}, { bbox: [598, 566, 748, 748] });

// the bowl of the spoon
const bowlSDF = sdEllipseRot(BOWL.x, BOWL.y, BOWL.rx, BOWL.ry, BOWL.rot);
fill(bowlSDF, (x, y, d) => {
  const t = clamp(0.72 - (x - BOWL.x) / 320 - (y - BOWL.y) / 400);
  let c = mixC(C.woodDark, C.woodLight, smoothstep(0.02, 0.96, t));
  if (d > -12) c = mixC(c, C.woodDark, clamp(1 + d / 12) * 0.62);
  return c;
}, { bbox: [BOWL.x - 86, BOWL.y - 60, BOWL.x + 86, BOWL.y + 60] });

// honey pooled in the bowl
const honeySDF = sdEllipseRot(BOWL.x + 5, BOWL.y + 5, BOWL.rx - 13, BOWL.ry - 12, BOWL.rot);
fill(honeySDF, (x, y, d) => {
  const t = clamp(0.72 - (x - BOWL.x) / 260 - (y - BOWL.y) / 260);
  let c = mixC(C.honeyDeep, C.honey, smoothstep(0.15, 0.95, t));
  c = mixC(c, C.honeyLight, smoothstep(0.55, 1, t) * 0.75);
  if (d > -7) c = mixC(c, C.honeyDeep, clamp(1 + d / 7) * 0.6);
  return c;
}, { bbox: [BOWL.x - 68, BOWL.y - 46, BOWL.x + 68, BOWL.y + 46] });
softFill(BOWL.x - 10, BOWL.y - 4, 30, 10, 0.05, 1.0, C.honeySpark, 0.85);

// honey running over the lip and gathering into a drop
fill(sdStroke([[762, 601], [766, 646], [767, 668]], 12, 9), C.honey, { bbox: [740, 578, 798, 692] });
fill((x, y) => smin(sdStroke([[767, 662], [768, 676]], 10, 8)(x, y), sdCircle(768, 692, 20)(x, y), 13), C.honey, {
  bbox: [740, 644, 796, 720],
});
softFill(760, 684, 7, 6, 0.1, 1.0, C.honeySpark, 0.95);
softFill(778, 701, 9, 7, 0.1, 1.0, C.honeyDeep, 0.45);

// the paw: palm behind the handle, fingers curled over it in front
softFill(PAW.x - 8, PAW.y + 34, 66, 26, 0.15, 1.05, FUR.deep, 0.28);
const palmSDF = (() => {
  const palm = sdEllipseRot(PAW.x, PAW.y, PAW.rx, PAW.ry, -0.25);
  return (x, y) => {
    let d = palm(x, y);
    d = smin(d, sdCircle(PAW.x - 30, PAW.y - 26, 22)(x, y), 16);
    d = smin(d, sdCircle(PAW.x - 4, PAW.y - 44, 21)(x, y), 16);
    return d;
  };
})();
fill(palmSDF, (x, y, d) => furColor(x, y, d, palmSDF), { bbox: [PAW.x - 80, PAW.y - 78, PAW.x + 74, PAW.y + 64] });
const fingers = [[640, 690, 25], [661, 664, 23], [681, 638, 20]].map(([fx, fy, fr]) => sdEllipseRot(fx, fy, fr, fr * 0.62, 0.658));
for (const f of fingers) {
  fill(f, (x, y, d) => furColor(x, y, d, f), { bbox: [616, 604, 720, 720] });
  fill((x, y) => Math.abs(f(x, y)) - 2, FUR.deep, { alpha: 0.32, bbox: [616, 604, 720, 720] });
}

// the bee, landing on the spoon
{
  const bx = 826, by = 488;
  const bodySDF = sdEllipseRot(bx, by, 38, 29, 0.42);
  fill(bodySDF, (x, y) => mixC(C.beeGold, rgb('#ffe08a'), clamp(0.66 - (x - bx) / 120)), {
    bbox: [bx - 44, by - 36, bx + 44, by + 36],
  });
  for (const o of [-9, 17]) {
    fill((x, y) => Math.max(bodySDF(x, y), sdEllipseRot(bx + o, by, 7, 36, 0.42)(x, y)), C.bee, {
      alpha: 0.92,
      bbox: [bx + o - 12, by - 38, bx + o + 12, by + 38],
    });
  }
  fill(sdCircle(bx - 40, by + 6, 21), C.bee, { bbox: [bx - 64, by - 18, bx - 16, by + 32] });
  softFill(bx - 47, by - 2, 6, 4.5, 0.1, 1.0, C.wing, 0.9);
  fill(sdStroke([[bx - 52, by - 6], [bx - 64, by - 22]], 2.6), C.bee, { bbox: [bx - 80, by - 36, bx - 36, by + 6] });
  fill(sdStroke([[bx - 44, by - 12], [bx - 50, by - 30]], 2.4), C.bee, { bbox: [bx - 68, by - 44, bx - 28, by - 2] });
  for (const [wx, wy, rot, wr, wh] of [[bx - 4, by - 34, -0.66, 30, 17], [bx + 27, by - 31, 0.3, 27, 16]]) {
    const wing = sdEllipse(0, 0, wr, wh);
    const c = Math.cos(rot), s = Math.sin(rot);
    const shape = (x, y) => {
      const dx = x - wx, dy = y - wy;
      return wing(dx * c - dy * s, dx * s + dy * c);
    };
    fill(shape, C.wing, { alpha: 0.9, bbox: [wx - 36, wy - 30, wx + 36, wy + 30] });
    fill((x, y) => Math.abs(shape(x, y)) - 1.5, rgb('#c08a44'), {
      alpha: 0.45,
      bbox: [wx - 36, wy - 30, wx + 36, wy + 30],
    });
  }
  // little legs reaching for the honey
  fill(sdStroke([[bx - 26, by + 26], [bx - 34, by + 44]], 2.6), C.bee, { bbox: [bx - 46, by + 16, bx - 14, by + 54] });
  fill(sdStroke([[bx - 8, by + 26], [bx - 10, by + 46]], 2.6), C.bee, { bbox: [bx - 28, by + 16, bx + 8, by + 56] });
}

/* -------------------------------------------------------- 4. finishing */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - 512) / 512;
    const dy = (y - 512) / 512;
    const v = smoothstep(0.68, 1.5, Math.hypot(dx, dy));
    const i = (y * W + x) * 3;
    const c = mixC([buf[i], buf[i + 1], buf[i + 2]], BG.vignette, v * 0.1);
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
  }
}

/* ------------------------------------------------------- png encoding */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// ordered dithering: smooth gradients, cheap to compress
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v / 64 - 0.5) * 1.2);

const stride = W * 3;
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(stride);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const n = BAYER[(y % 8) * 8 + (x % 8)] / 255;
    for (let ch = 0; ch < 3; ch++) row[x * 3 + ch] = Math.round(clamp(buf[i + ch] + n) * 255);
  }
  rows.push(row);
}

const zeroRow = Buffer.alloc(stride);
const raw = Buffer.alloc((stride + 1) * H);
const cand = Buffer.alloc(stride);
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < H; y++) {
  const cur = rows[y];
  const prev = y > 0 ? rows[y - 1] : zeroRow;
  let bestType = 0;
  let bestScore = Infinity;
  const base = y * (stride + 1);
  for (let t = 0; t < 5; t++) {
    let score = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let v;
      if (t === 0) v = cur[i];
      else if (t === 1) v = cur[i] - a;
      else if (t === 2) v = cur[i] - b;
      else if (t === 3) v = cur[i] - ((a + b) >> 1);
      else v = cur[i] - paeth(a, b, c);
      cand[i] = v & 0xff;
      score += v < 0 ? -v : v;
    }
    if (score < bestScore) {
      bestScore = score;
      bestType = t;
      cand.copy(raw, base + 1);
    }
  }
  raw[base] = bestType;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('./entry.png', import.meta.url), png);
console.log(`entry.png written: ${W}x${H}, ${(png.length / 1024).toFixed(1)} KiB`);
