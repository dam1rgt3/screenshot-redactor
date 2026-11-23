import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

let server, browser, origin;
before(async () => {
  server = spawn(process.execPath, ["scripts/serve.mjs"], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [line] = await once(server.stdout, "data");
  origin = new URL(line.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0])
    .origin;
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
});
after(async () => {
  try {
    await browser?.close();
  } finally {
    server?.kill();
  }
});

async function openPage(t, options) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  const requests = [];
  context.on("request", (req) => {
    if (req.url().startsWith("http")) requests.push([req.method(), req.url()]);
  });
  t.after(() => {
    assert.ok(requests.length > 0);
    for (const [method, url] of requests) {
      assert.equal(new URL(url).origin, origin);
      assert.equal(method, "GET");
    }
  });
  return context.newPage();
}

test("OCR, drag selection, undo and flattened export on the sample", async (t) => {
  const page = await openPage(t, { viewport: { width: 1400, height: 950 } });
  // Capture the actual ClipboardItem payload without touching the tester's OS clipboard.
  await page.addInitScript(() =>
    Object.defineProperty(navigator.clipboard, "write", {
      value: async (items) => {
        window.copiedPng = await items[0].getType("image/png");
      },
    }),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByText("2 suggested areas found.", { exact: true }).waitFor();
  const email = page.getByRole("checkbox", {
    name: /avery\.morgan@example\.org/,
  });
  const phone = page.getByRole("checkbox", { name: /415.*555-0146/ });
  assert.equal(await email.isChecked(), true);
  assert.equal(await phone.isChecked(), true);
  await email.uncheck();
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal(await email.isChecked(), true);

  await page.getByRole("button", { name: "Draw area" }).click();
  const canvas = await page.locator("#preview-canvas").boundingBox();
  const moveToPixel = (x, y) =>
    page.mouse.move(
      canvas.x + (x * canvas.width) / 1000,
      canvas.y + (y * canvas.height) / 600,
    );
  await moveToPixel(280, 504);
  await page.mouse.down();
  await moveToPixel(570, 548);
  await page.mouse.up();
  await page.getByText("3 selected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Export preview" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), "redacted-screenshot.png");
  const bytes = await readFile(await download.path());
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  await page.getByRole("button", { name: "Copy cleaned image" }).click();
  await page.getByText("Cleaned image copied to your clipboard.").waitFor();

  const report = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const { makeSample } = await import("./sample.js");
    const original = makeSample()
      .getContext("2d")
      .getImageData(0, 0, 1000, 600).data;
    const out = document.createElement("canvas");
    out.width = bitmap.width;
    out.height = bitmap.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const clean = ctx.getImageData(0, 0, out.width, out.height).data;
    const darkTextCounts = [];
    // Find the actual ink in the reference, including edges and descenders.
    for (const [top, bottom] of [
      [370, 413],
      [437, 483],
      [502, 548],
    ]) {
      let originalInk = 0,
        uncoveredInk = 0;
      for (let y = top; y < bottom; y++)
        for (let x = 289; x < 800; x++) {
          const i = (y * 1000 + x) * 4;
          if (original[i] >= 190) continue;
          originalInk++;
          if (
            clean[i] !== 32 ||
            clean[i + 1] !== 41 ||
            clean[i + 2] !== 37 ||
            clean[i + 3] !== 255
          )
            uncoveredInk++;
        }
      darkTextCounts.push({ originalInk, uncoveredInk });
    }
    const headerUnchanged = clean
      .subarray(0, 1000 * 276 * 4)
      .every((v, i) => v === original[i]);
    const clipboardBytes = new Uint8Array(await window.copiedPng.arrayBuffer());
    return {
      size: [out.width, out.height],
      darkTextCounts,
      headerUnchanged,
      sameClipboard:
        clipboardBytes.length === bytes.length &&
        clipboardBytes.every((v, i) => v === bytes[i]),
    };
  }, bytes.toString("base64"));
  assert.deepEqual(report.size, [1000, 600]);
  for (const region of report.darkTextCounts) {
    assert.ok(region.originalInk > 200);
    assert.equal(region.uncoveredInk, 0);
  }
  assert.equal(report.headerUnchanged, true);
  assert.equal(report.sameClipboard, true);
});

test("file, pasted image, and drop use image content at mobile width", async (t) => {
  const page = await openPage(t, { viewport: { width: 390, height: 844 } });
  await page.goto(origin);
  const buffer = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1050;
      c.height = 260;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = "36px Arial";
      ctx.fillStyle = "black";
      ctx.fillText("Email: blair.chen@example.net", 42, 90);
      ctx.fillText("Phone: +1 (212) 555-0178", 42, 170);
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  for (const input of ["upload", "paste", "drop"]) {
    if (input === "upload") {
      await page
        .locator("#file")
        .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer });
    } else {
      await page.evaluate(
        ([action, encoded]) => {
          const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
          const data = new DataTransfer();
          data.items.add(
            new File([bytes], "fixture.png", { type: "image/png" }),
          );
          const event =
            action === "paste"
              ? new ClipboardEvent("paste", {
                  clipboardData: data,
                  bubbles: true,
                })
              : new DragEvent("drop", { dataTransfer: data, bubbles: true });
          document.dispatchEvent(event);
        },
        [input, buffer.toString("base64")],
      );
    }
    await page.getByText("2 suggested areas found.", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("checkbox", { name: /blair\.chen@example\.net/ })
        .isChecked(),
      true,
    );
    assert.equal(
      await page.getByRole("checkbox", { name: /212.*555-0178/ }).isChecked(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "Clear image" }).click();
  }
});

test("a missing OCR model still allows manual redaction", async (t) => {
  const page = await openPage(t);
  await page.context().route("**/eng.traineddata.gz", (route) => route.abort());
  await page.goto(origin);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page
    .getByText("Text recognition is unavailable.", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Add area by coordinates" }).click();
  await page.getByRole("button", { name: "Add area", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Download PNG" }).isEnabled(),
    true,
  );
});
