// UI layer: image loading, canvas preprocessing, rendering cards, sharing. All work stays on the device.
import { EFFECTS, LABELS, labelSize, enhance, oneline, DPI, PX_PER_MM } from "./effects.js";

const $ = (s) => document.querySelector(s);
const ORDER = ["atkinson", "lineart", "sticker", "oneline", "floyd", "sketch", "halftone", "engraving", "threshold", "stencil", "silhouette"];
const KEYS = ["label", "rotate", "cover", "invert", "margin", "contrast", "gamma", "detail", "linePx", "source", "points"];
const status = (t) => ($("#status").textContent = t);

let source = null; // ImageBitmap
let runId = 0;

// ---------- settings ----------
for (const k of Object.keys(LABELS)) $("#label").add(new Option(k + (k === "50x30" ? " (רול ההתחלה)" : ""), k));

function settings() {
  const s = {};
  for (const k of KEYS) {
    const el = $("#" + k);
    s[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? parseFloat(el.value) : el.value;
  }
  return s;
}
function showValues() {
  for (const out of document.querySelectorAll("[data-out]")) {
    const v = $("#" + out.dataset.out).value;
    out.textContent = out.dataset.out === "points" && v === "0" ? "אוטומטי" : v;
  }
}
try {
  const saved = JSON.parse(localStorage.getItem("b1print") || "{}");
  for (const k of KEYS) if (k in saved) { const el = $("#" + k); el.type === "checkbox" ? (el.checked = saved[k]) : (el.value = saved[k]); }
} catch {}
showValues();

let timer;
$("#opts").addEventListener("input", () => {
  showValues();
  try { localStorage.setItem("b1print", JSON.stringify(settings())); } catch {}
  clearTimeout(timer);
  timer = setTimeout(run, 250);
});

// ---------- input ----------
async function useBlob(blob) {
  try {
    source = await createImageBitmap(blob); // honours EXIF rotation
  } catch {
    status("לא הצלחתי לפתוח את התמונה. נסו JPG או PNG.");
    return;
  }
  const url = URL.createObjectURL(blob);
  $("#preview img").src = url;
  $("#preview").style.display = "flex";
  run();
}

$("#file").addEventListener("change", (e) => e.target.files[0] && useBlob(e.target.files[0]));

$("#paste").addEventListener("click", async () => {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return useBlob(await item.getType(type));
    }
    status("אין תמונה בלוח. מעתיקים נושא מאפליקציית התמונות ומנסים שוב.");
  } catch {
    status("הדפדפן לא אישר גישה ללוח. אפשר גם לבחור תמונה מהגלריה.");
  }
});
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (f) useBlob(f);
});

// ---------- preprocessing ----------
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function prepare(s) {
  const [lw, lh] = LABELS[s.label];
  let [W, H] = labelSize(lw, lh);
  if (s.rotate) [W, H] = [H, W];

  // 1. working copy, capped size
  const scale0 = Math.min(1, 1600 / Math.max(source.width, source.height));
  let work = canvas(Math.round(source.width * scale0), Math.round(source.height * scale0));
  let ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, work.width, work.height);
  const px = ctx.getImageData(0, 0, work.width, work.height).data;

  // 2. transparent background? (iOS "copy subject", PNG cut-outs)
  let transparent = 0, x0 = work.width, y0 = work.height, x1 = 0, y1 = 0;
  for (let i = 3, p = 0; i < px.length; i += 4, p++) {
    if (px[i] < 250) transparent++;
    if (px[i] > 25) {
      const x = p % work.width, y = (p / work.width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const hasMask = transparent > px.length / 4 * 0.01;
  let crop = [0, 0, work.width, work.height];
  if (hasMask && x1 > x0) {
    const pad = Math.round(0.04 * Math.max(work.width, work.height));
    crop = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(work.width, x1 + pad + 1), Math.min(work.height, y1 + pad + 1)];
    crop = [crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1]];
  }

  // 3. fit onto the label canvas (stepwise halving keeps downscaling sharp)
  const m = Math.round(s.margin * PX_PER_MM), bw = W - 2 * m, bh = H - 2 * m;
  const k = (s.cover ? Math.max : Math.min)(bw / crop[2], bh / crop[3]);
  const nw = Math.max(1, Math.round(crop[2] * k)), nh = Math.max(1, Math.round(crop[3] * k));
  let src = work, [sx, sy, sw, sh] = crop;
  while (sw / 2 > nw * 1.5) {
    const half = canvas(Math.round(sw / 2), Math.round(sh / 2));
    const hc = half.getContext("2d");
    hc.imageSmoothingQuality = "high";
    hc.drawImage(src, sx, sy, sw, sh, 0, 0, half.width, half.height);
    src = half; sx = sy = 0; sw = half.width; sh = half.height;
  }
  const out = canvas(W, H), oc = out.getContext("2d", { willReadFrequently: true });
  oc.imageSmoothingQuality = "high";
  oc.drawImage(src, sx, sy, sw, sh, Math.round((W - nw) / 2), Math.round((H - nh) / 2), nw, nh);
  const d = oc.getImageData(0, 0, W, H).data;

  // 4. grey over white paper + subject mask
  const gray = new Float32Array(W * H), mask = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) {
    const a = d[i + 3] / 255, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = l * a + 255 * (1 - a);
    mask[p] = hasMask ? a : 1;
  }
  return enhance({ w: W, h: H, gray, mask, hasMask }, s.contrast);
}

// ---------- output ----------
function inkToCanvas(ink, w, h, invert) {
  const c = canvas(w, h), ctx = c.getContext("2d"), id = ctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const v = (ink[p] ^ (invert ? 1 : 0)) ? 0 : 255;
    id.data[p * 4] = id.data[p * 4 + 1] = id.data[p * 4 + 2] = v;
    id.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function rotate90(c) {
  const r = canvas(c.height, c.width), ctx = r.getContext("2d");
  ctx.translate(r.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(c, 0, 0);
  return r;
}

// add a pHYs chunk so apps know the image is 203 DPI
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function pngWithDpi(c) {
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const png = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(DPI / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const outp = new Uint8Array(png.length + 21);
  outp.set(png.subarray(0, 33)); outp.set(chunk, 33); outp.set(png.subarray(33), 54);
  return new Blob([outp], { type: "image/png" });
}

async function share(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- main loop ----------
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  if (!source) return;
  const id = ++runId, s = settings();
  status("מעבד...");
  await tick();
  const img = prepare(s);
  const grid = $("#grid");
  grid.innerHTML = "";
  const cards = {};
  for (const name of ORDER) {
    const e = EFFECTS[name], card = document.createElement("div");
    card.className = "card pending";
    card.innerHTML = `<h3>${e.he}</h3><p>${e.desc}</p><canvas width="${img.w}" height="${img.h}"></canvas><div class="row"><button class="btn small" disabled>שיתוף / שמירה</button></div>`;
    grid.append(card);
    cards[name] = card;
  }
  if (!img.hasMask) status("אין רקע שקוף, אז צללית ומדבקה עובדות על כל התמונה. להסרת רקע: ראו טיפ למעלה.");

  const params = { gamma: s.gamma, detail: s.detail, linePx: s.linePx };
  for (const name of ORDER) {
    await tick();
    if (id !== runId) return; // a newer run started
    let ink, svg;
    if (name === "oneline") ({ ink, svg } = oneline(img, { source: s.source, points: s.points, detail: s.detail }));
    else ink = EFFECTS[name].fn(img, params);
    const view = inkToCanvas(ink, img.w, img.h, s.invert);
    const card = cards[name], cv = card.querySelector("canvas");
    cv.getContext("2d").drawImage(view, 0, 0);
    card.classList.remove("pending");

    const label = s.rotate ? rotate90(view) : view;
    const file = new File([await pngWithDpi(label)], `b1-${name}-${s.label}.png`, { type: "image/png" });
    const btn = card.querySelector("button");
    btn.disabled = false;
    btn.onclick = () => share(file);
    if (svg) {
      const b2 = document.createElement("button");
      b2.className = "btn small ghost"; b2.textContent = "SVG";
      const svgFile = new File([svg], `b1-oneline.svg`, { type: "image/svg+xml" });
      b2.onclick = () => share(svgFile);
      card.querySelector(".row").append(b2);
    }
  }
  if (img.hasMask) status("");
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
