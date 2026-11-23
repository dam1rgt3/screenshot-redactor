import { clipBox, detect, paintClean } from "./redactions.js";
import { makeSample } from "./sample.js";

const $ = (id) => document.getElementById(id);
const preview = $("preview-canvas"),
  context = preview.getContext("2d");
const accepted = new Set(["image/png", "image/jpeg", "image/webp"]);
const limits = { bytes: 30 * 1024 * 1024, pixels: 32_000_000, side: 16384 };
let fileTicket = 0,
  scanTicket = 0,
  worker = null,
  source = null,
  areas = [],
  history = [];
let mode = "review",
  drawing = false,
  actual = false,
  drag = null,
  serial = 0,
  scanning = false;
let frame = 0;

function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}
function setScan(text) {
  $("scan").textContent = text;
}
function resizeView() {
  if (!source) return;
  $("surface").style.width = source.width + "px";
  $("surface").style.maxWidth = actual ? "none" : "100%";
}
function renderCanvas() {
  if (!source) return;
  context.clearRect(0, 0, preview.width, preview.height);
  if (mode === "clean") {
    paintClean(context, source, areas);
    return;
  }
  context.drawImage(source, 0, 0);
  const scale =
    source.width / Math.max(1, preview.getBoundingClientRect().width);
  context.lineWidth = Math.max(1, 2 * scale);
  for (const a of areas) {
    if (!a.selected) continue;
    const { x, y, w, h } = a.box;
    context.fillStyle =
      a.kind === "Manual" ? "rgba(86,101,174,.20)" : "rgba(248,167,70,.25)";
    context.strokeStyle = a.kind === "Manual" ? "#4e59a6" : "#ad5617";
    context.fillRect(x, y, w, h);
    context.strokeRect(x, y, w, h);
  }
  if (drag?.box) {
    const { x, y, w, h } = drag.box;
    context.fillStyle = "rgba(86,101,174,.22)";
    context.strokeStyle = "#4e59a6";
    context.fillRect(x, y, w, h);
    context.strokeRect(x, y, w, h);
  }
}
function queueRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderCanvas();
  });
}
function updateControls() {
  const selected = areas.filter((a) => a.selected).length;
  $("count").textContent = selected + " selected";
  $("review").setAttribute("aria-pressed", String(mode === "review"));
  $("cleaned").setAttribute("aria-pressed", String(mode === "clean"));
  $("draw").setAttribute("aria-pressed", String(drawing));
  $("zoom").setAttribute("aria-pressed", String(actual));
  $("zoom").textContent = actual ? "Fit image" : "Actual size";
  preview.classList.toggle("drawing", drawing);
  $("undo").disabled = history.length === 0;
  $("skip-scan").hidden = !scanning;
  $("copy").disabled = $("download").disabled = !selected || scanning;
  $("stage-hint").textContent =
    mode === "clean"
      ? "Export preview shows the pixels that will be copied or downloaded."
      : drawing
        ? "Drag across the image to cover a detail. Press Escape to leave drawing mode."
        : "Click a marked area to toggle it. Use Draw area to cover anything else.";
  queueRender();
}
function updateList() {
  const focused = document.activeElement?.dataset?.area;
  const list = $("area-list");
  list.replaceChildren();
  if (!areas.length && !scanning) {
    const p = document.createElement("p");
    p.className = "empty-list";
    p.textContent = "Draw a rectangle over any detail you want to hide.";
    list.append(p);
  }
  for (const area of areas) {
    const label = document.createElement("label");
    label.className = "area";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = area.selected;
    cb.dataset.area = String(area.id);
    cb.addEventListener("change", () => toggle(area));
    const words = document.createElement("span"),
      kind = document.createElement("small"),
      value = document.createElement("span");
    kind.textContent = area.kind;
    value.textContent = area.label;
    words.append(kind, value);
    label.append(cb, words);
    list.append(label);
  }
  if (focused)
    list
      .querySelector('[data-area="' + focused + '"]')
      ?.focus({ preventScroll: true });
  updateControls();
}
function toggle(area) {
  const prior = area.selected;
  history.push(() => {
    area.selected = prior;
  });
  area.selected = !prior;
  updateList();
}
function addManual(box) {
  const number = ++serial;
  const entry = {
    id: number,
    kind: "Manual",
    label: "Area at " + box.x + ", " + box.y + " · " + box.w + " × " + box.h,
    box,
    selected: true,
  };
  history.push(() => {
    areas = areas.filter((a) => a !== entry);
  });
  areas.push(entry);
  mode = "review";
  updateList();
}
function stopScanner() {
  scanTicket++;
  scanning = false;
  if (worker) {
    void worker.terminate().catch(() => {});
    worker = null;
  }
}
async function scan(image) {
  const ticket = ++scanTicket;
  let own = null;
  scanning = true;
  setScan("Starting on-device text recognition…");
  updateList();
  const base = new URL("vendor/", import.meta.url);
  try {
    let failWorker;
    const failure = new Promise((_, reject) => {
      failWorker = reject;
    });
    own = await Promise.race([
      failure,
      window.Tesseract.createWorker("eng", window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: new URL("worker.min.js", base).href,
        corePath: new URL("core", base).href,
        langPath: new URL("lang", base).href,
        workerBlobURL: false,
        cacheMethod: "none",
        errorHandler: (err) => failWorker(Error(String(err))),
        logger: (m) => {
          if (ticket === scanTicket && m.status === "recognizing text")
            setScan(
              "Finding private details… " + Math.round(m.progress * 100) + "%",
            );
        },
      }),
    ]);
    if (ticket !== scanTicket) return;
    worker = own;
    await Promise.race([
      failure,
      own.setParameters({
        tessedit_pageseg_mode: window.Tesseract.PSM.SPARSE_TEXT,
        user_defined_dpi: "150",
      }),
    ]);
    const factor = Math.min(
      1,
      6000 / Math.max(image.width, image.height),
      Math.sqrt(8_000_000 / (image.width * image.height)),
    );
    const input = document.createElement("canvas");
    input.width = Math.max(1, Math.round(image.width * factor));
    input.height = Math.max(1, Math.round(image.height * factor));
    const ctx = input.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, input.width, input.height);
    ctx.drawImage(image, 0, 0, input.width, input.height);
    const result = await Promise.race([
      failure,
      own.recognize(input, {}, { blocks: true, text: false }),
    ]);
    if (ticket !== scanTicket) return;
    const sx = image.width / input.width,
      sy = image.height / input.height;
    const found = detect(result.data.blocks, input.width, input.height);
    for (const a of found) {
      const b = a.box;
      a.box = clipBox(
        b.x * sx,
        b.y * sy,
        (b.x + b.w) * sx,
        (b.y + b.h) * sy,
        image.width,
        image.height,
      );
      if (a.box) areas.push({ ...a, id: ++serial });
    }
    input.width = input.height = 1;
    setScan(
      found.length
        ? found.length +
            " suggested " +
            (found.length === 1 ? "area" : "areas") +
            " found."
        : "No email or phone number detected.",
    );
  } catch {
    if (ticket === scanTicket)
      setScan(
        "Text recognition is unavailable. You can still draw areas manually.",
      );
  } finally {
    if (own && (worker === own || ticket !== scanTicket)) {
      if (worker === own) worker = null;
      void own.terminate().catch(() => {});
    }
    if (ticket === scanTicket) {
      scanning = false;
      updateList();
    }
  }
}
function enter(image, name) {
  stopScanner();
  source?.close?.();
  source = image;
  areas = [];
  history = [];
  drag = null;
  serial = 0;
  mode = "review";
  drawing = false;
  actual = false;
  $("coords").hidden = true;
  $("welcome").hidden = true;
  $("editor").hidden = false;
  $("file-info").textContent =
    name + "  ·  " + image.width + " × " + image.height + " px";
  preview.width = image.width;
  preview.height = image.height;
  resizeView();
  message("");
  scrollTo(0, 0);
  void scan(image);
}
function reset() {
  fileTicket++;
  stopScanner();
  source?.close?.();
  source = null;
  areas = [];
  history = [];
  drag = null;
  preview.width = preview.height = 1;
  $("area-list").replaceChildren();
  $("file-info").textContent = "";
  $("editor").hidden = true;
  $("welcome").hidden = false;
  message("");
  $("choose").focus();
  scrollTo(0, 0);
}
async function loadFile(file) {
  const ticket = ++fileTicket;
  if (!file) return;
  try {
    if (file.size > limits.bytes)
      throw Error("Choose an image smaller than 30 MB.");
    const sig = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const mime =
      sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47
        ? "image/png"
        : sig[0] === 0xff && sig[1] === 0xd8
          ? "image/jpeg"
          : String.fromCharCode(...sig.slice(0, 4)) === "RIFF" &&
              String.fromCharCode(...sig.slice(8, 12)) === "WEBP"
            ? "image/webp"
            : "";
    if (!accepted.has(mime)) throw Error("Choose a PNG, JPEG or WebP image.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw Error("This file could not be decoded as an image.");
    }
    if (ticket !== fileTicket) {
      bitmap.close();
      return;
    }
    if (
      bitmap.width * bitmap.height > limits.pixels ||
      Math.max(bitmap.width, bitmap.height) > limits.side
    ) {
      bitmap.close();
      throw Error(
        "Use an image up to 32 megapixels and 16,384 pixels per side.",
      );
    }
    enter(bitmap, file.name || "Pasted screenshot");
  } catch (err) {
    if (ticket === fileTicket) message(err.message, true);
  }
}
function point(event) {
  const rect = preview.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * source.width) / rect.width,
    y: ((event.clientY - rect.top) * source.height) / rect.height,
  };
}
preview.addEventListener("pointerdown", (e) => {
  if (!source || mode === "clean" || e.button !== 0 || !e.isPrimary) return;
  const p = point(e);
  if (drawing) {
    e.preventDefault();
    preview.setPointerCapture(e.pointerId);
    drag = { ...p, pointer: e.pointerId, box: null };
  } else {
    const hit = areas.findLast(
      (a) =>
        p.x >= a.box.x &&
        p.y >= a.box.y &&
        p.x < a.box.x + a.box.w &&
        p.y < a.box.y + a.box.h,
    );
    if (hit) toggle(hit);
  }
});
function dragBox(e) {
  const pt = point(e);
  return clipBox(drag.x, drag.y, pt.x, pt.y, source.width, source.height);
}
preview.addEventListener("pointermove", (e) => {
  if (drag?.pointer === e.pointerId) {
    drag.box = dragBox(e);
    queueRender();
  }
});
preview.addEventListener("pointerup", (e) => {
  if (drag?.pointer !== e.pointerId) return;
  const box = dragBox(e);
  drag = null;
  if (box && box.w >= 2 && box.h >= 2) {
    drawing = false;
    addManual(box);
  } else queueRender();
});
preview.addEventListener("lostpointercapture", () => {
  drag = null;
  queueRender();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawing) {
    drag = null;
    drawing = false;
    updateControls();
  }
});
$("draw").onclick = () => {
  mode = "review";
  drawing = !drawing;
  drag = null;
  updateControls();
};
$("review").onclick = () => {
  mode = "review";
  updateControls();
};
$("cleaned").onclick = () => {
  mode = "clean";
  drawing = false;
  drag = null;
  updateControls();
};
$("zoom").onclick = () => {
  actual = !actual;
  resizeView();
  updateControls();
};
$("undo").onclick = () => {
  history.pop()?.();
  updateList();
};
$("skip-scan").onclick = () => {
  stopScanner();
  setScan("Automatic scan stopped. You can draw areas manually.");
  updateList();
};
$("keyboard-area").onclick = () => {
  $("coords").hidden = !$("coords").hidden;
  if (!$("coords").hidden) $("cx").focus();
};
$("coords").onsubmit = (e) => {
  e.preventDefault();
  const [x, y, w, h] = ["cx", "cy", "cw", "ch"].map((id) =>
    Number($(id).value),
  );
  const box = clipBox(x, y, x + w, y + h, source.width, source.height);
  if (!box) {
    message("That rectangle is outside the image.", true);
    return;
  }
  addManual(box);
  $("coords").hidden = true;
  message("");
};
async function exported() {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  paintClean(out.getContext("2d"), source, areas);
  const blob = await new Promise((resolve, reject) =>
    out.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Could not export this image."))),
      "image/png",
    ),
  );
  out.width = out.height = 1;
  return blob;
}
$("copy").onclick = async () => {
  try {
    if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw Error();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": exported() }),
    ]);
    message("Cleaned image copied to your clipboard.");
  } catch {
    message(
      "Copy wasn’t available. Use Download PNG to save the cleaned image.",
      true,
    );
  }
};
$("download").onclick = async () => {
  try {
    const url = URL.createObjectURL(await exported()),
      a = document.createElement("a");
    a.href = url;
    a.download = "redacted-screenshot.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    message("Cleaned PNG exported.");
  } catch {
    message("Couldn’t create the PNG. Try a smaller image.", true);
  }
};
$("choose").onclick = $("replace").onclick = () => $("file").click();
$("clear").onclick = reset;
$("file").onchange = () => {
  const img = $("file").files[0];
  $("file").value = "";
  void loadFile(img);
};
$("sample").onclick = () => {
  fileTicket++;
  enter(makeSample(), "Sample support message");
};
document.addEventListener("paste", (e) => {
  const item = Array.from(e.clipboardData?.items || []).find(
    (i) => i.kind === "file" && i.type.startsWith("image/"),
  );
  if (item) {
    e.preventDefault();
    void loadFile(item.getAsFile());
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    $("drop-zone").classList.add("dragover");
  }
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) $("drop-zone").classList.remove("dragover");
});
document.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    $("drop-zone").classList.remove("dragover");
    void loadFile(e.dataTransfer.files[0]);
  }
});
window.addEventListener("resize", queueRender);
if (/Mac|iPad|iPhone/.test(navigator.platform))
  $("paste-key").textContent = "⌘";
const sample = $("sample-preview").getContext("2d");
sample.drawImage(makeSample(), 0, 0);
// These marks only illustrate the welcome thumbnail; the interactive sample always runs OCR.
sample.fillStyle = "rgba(248,167,70,.34)";
sample.fillRect(284, 373, 392, 39);
sample.fillRect(284, 442, 271, 39);
