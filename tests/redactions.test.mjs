import test from "node:test";
import assert from "node:assert/strict";
import { clipBox, detect, MASK_COLOR, paintClean } from "../src/redactions.js";

function recognized(lines) {
  const entries = lines.map((parts, i) => ({
    words: parts.map((text, j) => ({
      text,
      bbox: { x0: j * 80, y0: i * 40 + 2, x1: j * 80 + 75, y1: i * 40 + 22 },
    })),
  }));
  return detect([{ paragraphs: [{ lines: entries }] }], 1300, 650);
}
test("email split into OCR words retains every source word box", () => {
  const [b] = recognized([["Email:", "alex+work", "@", "example", ".", "org"]]);
  assert.equal(b.kind, "Email");
  assert.equal(b.selected, true);
  assert.ok(b.box.x <= 80 && b.box.x + b.box.w >= 475);
});
test("supports a US number and a grouped international number", () => {
  const results = recognized([
    ["Callback", "+1", "(415)", "555-0146"],
    ["Tel", "+44", "20", "7946", "0958"],
  ]);
  assert.deepEqual(
    results.map((x) => x.label),
    ["+1 (415) 555-0146", "+44 20 7946 0958"],
  );
});
test("requires context for an unformatted phone number and skips an IP", () => {
  assert.equal(
    recognized([
      ["Order", "9876543210"],
      ["IP", "192.168.100.200"],
    ]).length,
    0,
  );
  assert.equal(recognized([["Phone:", "4155550146"]])[0].kind, "Phone");
});
test("phone-like email local part and separate lines do not produce duplicates", () => {
  const found = recognized([
    ["4155550146@example.org"],
    ["user@"],
    ["example.org"],
  ]);
  assert.deepEqual(
    found.map((x) => x.kind),
    ["Email"],
  );
});
test("normalizes reversed drags, rounds outwards and clips to the image", () => {
  assert.deepEqual(clipBox(19.1, 22.4, -2.3, 3.2, 18, 20), {
    x: 0,
    y: 3,
    w: 18,
    h: 17,
  });
  assert.equal(clipBox(1, 3, 1, 6, 10, 10), null);
  assert.equal(clipBox(-5, -1, -3, 6, 10, 10), null);
  assert.equal(clipBox(NaN, 0, 2, 3, 10, 10), null);
});
test("only selected areas are written to the export", () => {
  const calls = [],
    ctx = {
      drawImage: (...args) => calls.push(args),
      fillRect: (...args) => calls.push(args),
    };
  paintClean(ctx, "source", [
    { box: { x: 2, y: 4, w: 6, h: 8 }, selected: false },
    { box: { x: 9, y: 7, w: 5, h: 3 }, selected: true },
  ]);
  assert.equal(ctx.fillStyle, MASK_COLOR);
  assert.deepEqual(calls, [
    ["source", 0, 0],
    [9, 7, 5, 3],
  ]);
});
