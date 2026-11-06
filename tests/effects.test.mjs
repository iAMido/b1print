// node --test tests/   (no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, labelSize, enhance, oneline } from "../effects.js";

function sample() {
  const w = 192, h = 120, gray = new Float32Array(w * h), mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gray[i] = (255 * x) / w;
    if (y >= 30 && y < 90 && x >= 60 && x < 130) gray[i] = 30;
    mask[i] = y >= 20 && y < 100 && x >= 50 && x < 140 ? 1 : 0;
  }
  return { w, h, gray, mask, hasMask: true };
}

for (const name of Object.keys(EFFECTS)) {
  test(`${name} returns a non-blank, non-solid 1-bit image`, () => {
    const img = sample(), ink = EFFECTS[name].fn(img, {});
    assert.equal(ink.length, img.w * img.h);
    const black = ink.reduce((a, b) => a + b, 0) / ink.length;
    assert.ok(black > 0 && black < 1, `${name}: ${black}`);
    assert.ok(ink.every((v) => v === 0 || v === 1));
  });
}

test("label sizes clamp to the 384 px printhead", () => {
  assert.deepEqual(labelSize(50, 30), [384, 240]);
  assert.deepEqual(labelSize(30, 20), [240, 160]);
});

test("oneline returns svg", () => {
  const { svg } = oneline(sample(), { points: 200, timeMs: 200 });
  assert.ok(svg.startsWith("<svg") && svg.includes("<path"));
});

test("enhance keeps removed background white", () => {
  const out = enhance(sample(), 1);
  assert.equal(out.gray[0], 255);
});
