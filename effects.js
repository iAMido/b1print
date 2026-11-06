// b1print effects engine: pure functions on typed arrays, no DOM.
// Image = { w, h, gray: Float32Array (0..255), mask: Float32Array (0..1), hasMask: bool }
// Every effect returns Uint8Array ink of length w*h where 1 = black dot.

export const DPI = 203;
export const PX_PER_MM = DPI / 25.4;
export const PRINTHEAD_PX = 384; // 48 mm printhead

export const LABELS = {
  "50x30": [50, 30], "50x50": [50, 50], "50x80": [50, 80],
  "40x30": [40, 30], "40x60": [40, 60], "30x20": [30, 20], "30x15": [30, 15],
};

export function labelSize(wMM, hMM) {
  return [Math.min(Math.round(wMM * PX_PER_MM), PRINTHEAD_PX), Math.round(hMM * PX_PER_MM)];
}

// ---------------- helpers ----------------

export function gaussian(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        a += src[row + xx] * k[i + r];
      }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        a += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = a;
    }
  }
  return out;
}

/** 0 = white paper, 1 = black. gamma > 1 lightens (thermal dots spread on paper). */
export function darkness(gray, gamma = 1) {
  const d = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) d[i] = Math.pow(Math.max(0, 1 - gray[i] / 255), gamma);
  return d;
}

/** Otsu level on subject pixels only (a removed white background would skew it). */
export function otsu(gray, mask, useMask) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < gray.length; i++) {
    if (useMask && mask[i] < 0.5) continue;
    hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++; n++;
  }
  if (n < 50) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; t = i; }
  }
  return t;
}

/** Remove 8-connected blobs of value `val` smaller than minArea (specks print as dirt). */
export function removeSpecks(ink, w, h, minArea, val = 1) {
  if (minArea <= 0) return ink;
  const out = Uint8Array.from(ink), seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  const comp = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || out[s] !== val) continue;
    let top = 0; stack[top++] = s; seen[s] = 1; comp.length = 0;
    while (top) {
      const p = stack[--top]; comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!seen[q] && out[q] === val) { seen[q] = 1; stack[top++] = q; }
      }
    }
    if (comp.length < minArea) for (const p of comp) out[p] = 1 - val;
  }
  return out;
}

function diskOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) o.push([dx, dy]);
  return o;
}

export function dilate(ink, w, h, r) {
  if (r <= 0) return Uint8Array.from(ink);
  const out = new Uint8Array(w * h), off = diskOffsets(r);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue;
    for (const [dx, dy] of off) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

const invert = (a) => a.map((v) => 1 - v);
export const erode = (ink, w, h, r) => invert(dilate(invert(ink), w, h, r));

function rotated(x, y, angleDeg) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
}

/** Difference of Gaussians: dark side of each edge becomes an ink stroke. */
export function dogLines(gray, w, h, sigma = 1, thresh = 0.015) {
  const g = gray.map((v) => v / 255);
  const a = gaussian(g, w, h, sigma), b = gaussian(g, w, h, sigma * 1.6);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = a[i] - b[i] < -thresh ? 1 : 0;
  return ink;
}

/** Contrast for thermal: percentile stretch on the subject + unsharp local contrast. */
export function enhance(img, amount = 1) {
  const { w, h, gray, mask, hasMask } = img;
  if (amount <= 0) return img;
  const vals = [];
  for (let i = 0; i < gray.length; i += 3) if (!hasMask || mask[i] > 0.5) vals.push(gray[i]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.01)] ?? 0, hi = vals[Math.floor(vals.length * 0.99)] ?? 255;
  const span = Math.max(30, hi - lo);
  const blur = gaussian(gray, w, h, 8);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    let v = ((gray[i] - lo) / span) * 255;
    v += amount * 0.6 * (gray[i] - blur[i]);
    v = Math.max(0, Math.min(255, v));
    out[i] = hasMask && mask[i] < 0.5 ? 255 : v; // keep removed background paper-white
  }
  return { ...img, gray: out };
}

// ---------------- effects ----------------

export const EFFECTS = {};
function effect(name, he, desc, fn) { EFFECTS[name] = { name, he, desc, fn }; }

effect("atkinson", "אטקינסון", "דיתור בסגנון מקינטוש קלאסי. הכי טוב לתמונות.", ({ w, h, gray }, p) => {
  const d = darkness(gray, p.gamma ?? 1.2), buf = new Float32Array(w * h), ink = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) buf[i] = 255 * (1 - d[i]);
  const nb = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, old = buf[i], nw = old < 128 ? 0 : 255;
    ink[i] = nw === 0 ? 1 : 0;
    const e = (old - nw) / 8;
    for (const [dx, dy] of nb) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy < h) buf[yy * w + xx] += e;
    }
  }
  return ink;
});

effect("floyd", "פלויד-סטיינברג", "דיתור עם הכי הרבה פירוט וגוונים.", ({ w, h, gray }, p) => {
  const d = darkness(gray, (p.gamma ?? 1.2) + 0.1), buf = new Float32Array(w * h), ink = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) buf[i] = 255 * (1 - d[i]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, old = buf[i], nw = old < 128 ? 0 : 255, e = old - nw;
    ink[i] = nw === 0 ? 1 : 0;
    if (x + 1 < w) buf[i + 1] += (e * 7) / 16;
    if (y + 1 < h) {
      if (x > 0) buf[i + w - 1] += (e * 3) / 16;
      buf[i + w] += (e * 5) / 16;
      if (x + 1 < w) buf[i + w + 1] += e / 16;
    }
  }
  return ink;
});

effect("lineart", "ציור קווים", "קווי מתאר בדיו. מעט שחור, חד מאוד.", ({ w, h, gray }, p) => {
  const pre = gaussian(gray, w, h, 0.6);
  let ink = dogLines(pre, w, h, 1.0, p.detail ?? 0.015);
  ink = removeSpecks(ink, w, h, 14);
  return dilate(ink, w, h, p.linePx ?? 0);
});

effect("sticker", "מדבקה", "קווים ומסגרת עבה מסביב לנושא. צריך רקע שקוף.", (img, p) => {
  const { w, h, mask, hasMask } = img, inner = EFFECTS.lineart.fn(img, p);
  if (!hasMask) return inner;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = mask[i] > 0.5 ? 1 : 0;
  const gap = 4, border = 3, outer = dilate(m, w, h, gap + border), near = dilate(m, w, h, gap);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = (outer[i] && !near[i]) || (inner[i] && m[i]) ? 1 : 0;
  return ink;
});

effect("oneline", "קו אחד", "קו רציף אחד שעובר על כל הציור. אפשר לשמור גם כ-SVG.", (img, p) => oneline(img, p).ink);

effect("sketch", "סקיצה", "רישום עיפרון עם הצללה.", (img, p) => {
  const { w, h, gray } = img;
  const inv = gaussian(gray.map((v) => 255 - v), w, h, 8);
  const dodge = new Float32Array(w * h);
  let mn = 255, mx = 0;
  for (let i = 0; i < dodge.length; i++) {
    const v = Math.min(255, (gray[i] * 256) / Math.max(1, 255 - inv[i]));
    dodge[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  for (let i = 0; i < dodge.length; i++) dodge[i] = ((dodge[i] - mn) / Math.max(1, mx - mn)) * 255;
  return EFFECTS.atkinson.fn({ ...img, gray: dodge }, { gamma: 1.6 });
});

effect("halftone", "רשת נקודות", "נקודות של עיתון ישן ב-45 מעלות. מראה רטרו.", ({ w, h, gray }, p) => {
  const cell = p.cell ?? 5, d = darkness(gaussian(gray, w, h, cell / 3), p.gamma ?? 1.1), ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [u, v] = rotated(x, y, 45);
    const screen = (Math.cos((2 * Math.PI * u) / cell) + Math.cos((2 * Math.PI * v) / cell) + 2) / 4;
    ink[y * w + x] = d[y * w + x] > screen ? 1 : 0;
  }
  return ink;
});

effect("engraving", "חריטה", "קווים שהעובי שלהם לפי הכהות, כמו בשטר כסף.", ({ w, h, gray }, p) => {
  const period = 5, d = darkness(gaussian(gray, w, h, 1), (p.gamma ?? 1.2) - 0.2), ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, [, v0] = rotated(x, y, 30), v = v0 + 2.5 * Math.sin(d[i] * Math.PI);
    ink[i] = d[i] > Math.abs(Math.sin((Math.PI * v) / period)) ? 1 : 0;
  }
  return removeSpecks(ink, w, h, 3);
});

effect("threshold", "חותמת", "שחור או לבן מוחלט. ללוגואים, טקסט וניגודיות גבוהה.", ({ w, h, gray, mask, hasMask }, p) => {
  const b = gaussian(gray, w, h, 0.8), t = otsu(b, mask, hasMask), ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = b[i] < t + (p.offset ?? 0) ? 1 : 0;
  return removeSpecks(ink, w, h, 8);
});

effect("stencil", "שבלונה", "כתמים חלקים ונועזים בסגנון פופ ארט.", ({ w, h, gray, mask, hasMask }, p) => {
  const g = gaussian(gray, w, h, 2.5), t = otsu(g, mask, hasMask);
  let ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = g[i] < t + (p.offset ?? 0) ? 1 : 0;
  ink = dilate(erode(ink, w, h, 2), w, h, 2); // open
  ink = erode(dilate(ink, w, h, 2), w, h, 2); // close
  ink = removeSpecks(ink, w, h, 40, 1);
  return removeSpecks(ink, w, h, 40, 0);
});

effect("silhouette", "צללית", "צללית שחורה מלאה של הנושא. צריך רקע שקוף.", (img, p) => {
  const { w, h, mask, hasMask } = img;
  if (!hasMask) return EFFECTS.threshold.fn(img, p);
  return removeSpecks(Uint8Array.from(mask, (v) => (v > 0.5 ? 1 : 0)), w, h, 30);
});

// ---------------- one line (TSP art) ----------------

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nearestGrid(px, py, n, w, h, cell) {
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  const buckets = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < n; i++) {
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(px[i] / cell)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(py[i] / cell)));
    buckets[gy * gw + gx].push(i);
  }
  return (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r < Math.max(gw, gh); r++) {
      for (let gy = cy - r; gy <= cy + r; gy++) for (let gx = cx - r; gx <= cx + r; gx++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
        for (const i of buckets[gy * gw + gx]) {
          const d = (px[i] - x) ** 2 + (py[i] - y) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0 && bd <= (r * cell) ** 2) break;
    }
    return best;
  };
}

export function oneline(img, p = {}) {
  const { w, h, gray } = img, source = p.source ?? "contour";
  const rnd = mulberry32(p.seed ?? 7);
  let wt;
  if (source === "contour") {
    const lines = removeSpecks(dogLines(gaussian(gray, w, h, 0.6), w, h, 1, p.detail ?? 0.015), w, h, 14);
    wt = gaussian(Float32Array.from(lines), w, h, 0.8);
  } else {
    wt = darkness(gray, 2.2).map((v) => (v < 0.08 ? 0 : v));
  }
  const n = p.points || Math.round((w * h) / (source === "tone" ? 70 : 110));

  // sample points proportional to weight
  const cum = new Float64Array(w * h);
  let acc = 0;
  for (let i = 0; i < wt.length; i++) cum[i] = acc += wt[i];
  const px = new Float64Array(n), py = new Float64Array(n);
  if (acc === 0) return { ink: new Uint8Array(w * h), svg: toSVG([], w, h, 1.6), path: [] };
  for (let k = 0; k < n; k++) {
    const r = rnd() * acc;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    px[k] = (lo % w) + rnd(); py[k] = Math.floor(lo / w) + rnd();
  }

  // weighted Lloyd relaxation spreads points evenly
  const pix = [];
  for (let i = 0; i < wt.length; i++) if (wt[i] > 0.02) pix.push(i);
  const cell = Math.max(4, Math.sqrt((w * h) / n));
  for (let it = 0; it < (p.relax ?? 10); it++) {
    const near = nearestGrid(px, py, n, w, h, cell);
    const sx = new Float64Array(n), sy = new Float64Array(n), sw = new Float64Array(n);
    for (const i of pix) {
      const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5, j = near(x, y), ww = wt[i];
      sx[j] += ww * x; sy[j] += ww * y; sw[j] += ww;
    }
    for (let j = 0; j < n; j++) if (sw[j] > 0) { px[j] = sx[j] / sw[j]; py[j] = sy[j] / sw[j]; }
  }

  // nearest neighbour tour from the top-left
  const used = new Uint8Array(n), order = new Int32Array(n);
  let cur = 0;
  for (let i = 1; i < n; i++) if (px[i] + py[i] < px[cur] + py[cur]) cur = i;
  for (let k = 0; k < n; k++) {
    order[k] = cur; used[cur] = 1;
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (!used[i]) {
      const d = (px[i] - px[cur]) ** 2 + (py[i] - py[cur]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    cur = best;
  }
  const X = Float64Array.from(order, (i) => px[i]), Y = Float64Array.from(order, (i) => py[i]);

  // 2-opt: uncross the path within a time budget
  const dist = (a, b) => Math.hypot(X[a] - X[b], Y[a] - Y[b]);
  const t0 = Date.now(), budget = p.timeMs ?? 1500;
  let improved = true;
  while (improved && Date.now() - t0 < budget) {
    improved = false;
    for (let i = 1; i < n - 2; i++) {
      const dab = dist(i - 1, i);
      let bestJ = -1, bestD = -1e-6;
      for (let j = i + 1; j < n - 1; j++) {
        const delta = dist(i - 1, j) + dist(i, j + 1) - dab - dist(j, j + 1);
        if (delta < bestD) { bestD = delta; bestJ = j; }
      }
      if (bestJ > 0) {
        for (let a = i, b = bestJ; a < b; a++, b--) {
          [X[a], X[b]] = [X[b], X[a]]; [Y[a], Y[b]] = [Y[b], Y[a]];
        }
        improved = true;
      }
      if ((i & 63) === 0 && Date.now() - t0 > budget) break;
    }
  }

  // Chaikin smoothing
  let path = Array.from(X, (x, i) => [x, Y[i]]);
  for (let s = 0; s < 2; s++) {
    const q = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    q.push(path[path.length - 1]);
    path = q;
  }

  const lineW = p.lineW ?? 1.6;
  return { ink: rasterize(path, w, h, lineW), svg: toSVG(path, w, h, lineW), path };
}

/** Stroke a polyline at 4x and box-downsample, so the line is smooth but still 1-bit. */
export function rasterize(path, w, h, lineW) {
  const s = 4, W = w * s, H = h * s, big = new Uint8Array(W * H);
  const r = Math.max(0.5, (lineW * s) / 2), off = [];
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r) off.push(dx + dy * W);
  const R = Math.ceil(r);
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * s));
    for (let k = 0; k <= steps; k++) {
      const x = Math.round((ax + ((bx - ax) * k) / steps) * s), y = Math.round((ay + ((by - ay) * k) / steps) * s);
      if (x < R || y < R || x >= W - R || y >= H - R) continue;
      const c = y * W + x;
      for (const o of off) big[c + o] = 1;
    }
  }
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) c += big[(y * s + yy) * W + x * s + xx];
    ink[y * w + x] = c >= 7 ? 1 : 0;
  }
  return ink;
}

export function toSVG(path, w, h, lineW) {
  const d = path.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${(w / PX_PER_MM).toFixed(1)}mm" height="${(h / PX_PER_MM).toFixed(1)}mm">` +
    `<rect width="100%" height="100%" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="${lineW}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function render(name, img, params = {}) {
  return EFFECTS[name].fn(img, params);
}
