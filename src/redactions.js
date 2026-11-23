// The boxes and the original image always use the same pixel coordinate system.
export const MASK_COLOR = "#202925";

export function clipBox(x0, y0, x1, y1, width, height) {
  if (![x0, y0, x1, y1, width, height].every(Number.isFinite)) return null;
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const right = Math.min(width, Math.ceil(Math.max(x0, x1)));
  const bottom = Math.min(height, Math.ceil(Math.max(y0, y1)));
  return right > left && bottom > top
    ? { x: left, y: top, w: right - left, h: bottom - top }
    : null;
}

const email =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+\s*@\s*[a-z0-9-]+(?:\s*\.\s*[a-z0-9-]+)*\s*\.\s*[a-z]{2,63}\b/gi;
const phone =
  /(?<![\w@+])(?:\+\s*\d{1,3}[\s.()-]*)?(?:\(\s*\d{2,4}\s*\)|\d{2,4})[ \t.\-]*\d{2,4}[ \t.\-]*\d{3,4}(?![\w@])/g;

function crediblePhone(text, line) {
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return false;
  if (/^\d+$/.test(text))
    return /\b(phone|mobile|tel|call|cell|contact)\b/i.test(line);
  return true;
}

function matches(line, words, width, height) {
  const found = [],
    spans = [];
  let offset = 0;
  for (const word of words) {
    spans.push({
      start: offset,
      end: offset + word.text.length,
      box: word.bbox,
    });
    offset += word.text.length + 1;
  }
  for (const [kind, pattern] of [
    ["Email", email],
    ["Phone", phone],
  ]) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index,
        end = start + match[0].length;
      if (kind === "Phone" && !crediblePhone(match[0], line)) continue;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const boxes = spans
        .filter((w) => w.start < end && w.end > start)
        .map((w) => w.box);
      if (!boxes.length) continue;
      const pad = Math.max(
        2,
        Math.ceil(Math.max(...boxes.map((b) => b.y1 - b.y0)) * 0.14),
      );
      const box = clipBox(
        Math.min(...boxes.map((b) => b.x0)) - pad,
        Math.min(...boxes.map((b) => b.y0)) - pad,
        Math.max(...boxes.map((b) => b.x1)) + pad,
        Math.max(...boxes.map((b) => b.y1)) + pad,
        width,
        height,
      );
      if (box) found.push({ start, end, kind, label: match[0].trim(), box });
    }
  }
  return found.map(({ kind, label, box }) => ({
    kind,
    label,
    box,
    selected: true,
  }));
}

export function detect(blocks, width, height) {
  const areas = [];
  for (const block of blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const entry of para.lines || []) {
        const words = (entry.words || []).filter((w) => w.text && w.bbox);
        areas.push(
          ...matches(words.map((w) => w.text).join(" "), words, width, height),
        );
      }
    }
  }
  return areas;
}

export function paintClean(context, source, areas) {
  context.drawImage(source, 0, 0);
  context.fillStyle = MASK_COLOR;
  for (const { box, selected } of areas) {
    if (selected) context.fillRect(box.x, box.y, box.w, box.h);
  }
}
